import { Prisma } from "@prisma/client";
import { taxHash } from "@contable/tax-engine";
import { getWorkpaperSourcePolicy } from "./workpaper-source-policy.js";

export class WorkpaperAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkpaperAllocationError";
  }
}

type AllocationSource = {
  id: string;
  amount: Prisma.Decimal;
  cuitAgent: string;
  certificateNumber: string | null;
  creditKind: string;
  issuedOn: Date;
};

export function taxInputAllocationHash(input: {
  sourceType: string;
  source: AllocationSource;
  obligationId: string;
  taxTypeId: string;
  regimeId: string;
  jurisdictionId: string;
  periodId: string;
  amount: Prisma.Decimal;
}) {
  return taxHash({
    sourceType: input.sourceType,
    sourceId: input.source.id,
    sourceAmount: input.source.amount.toFixed(4),
    cuitAgent: input.source.cuitAgent,
    certificateNumber: input.source.certificateNumber,
    creditKind: input.source.creditKind,
    issuedOn: input.source.issuedOn.toISOString().slice(0, 10),
    obligationId: input.obligationId,
    taxTypeId: input.taxTypeId,
    regimeId: input.regimeId,
    jurisdictionId: input.jurisdictionId,
    periodId: input.periodId,
    allocatedAmount: input.amount.toFixed(4),
  });
}

/**
 * Imputa automáticamente cada certificado de una fuente revisada a la
 * obligación declarada por su política. Convenio Multilateral exige que la
 * fila declare jurisdicción; para regímenes locales se usa la de la obligación.
 */
export async function materializeWorkpaperAllocations(
  tx: Prisma.TransactionClient,
  workpaperId: string,
) {
  const workpaper = await tx.monthlyTaxWorkpaper.findUnique({ where: { id: workpaperId } });
  if (!workpaper) throw new WorkpaperAllocationError("Expediente no encontrado");

  const [links, obligations] = await Promise.all([
    tx.workpaperImportBatch.findMany({
      where: {
        workpaperId,
        status: "REVIEWED",
        importBatch: { status: "COMMITTED" },
      },
      include: { importBatch: { include: { rows: { orderBy: { position: "asc" } } } } },
    }),
    tx.taxObligation.findMany({
      where: {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        status: { not: "NOT_APPLICABLE" },
        period: {
          startDate: { gte: workpaper.periodStart },
          endDate: { lte: workpaper.periodEnd },
        },
      },
      include: { period: true, regime: { include: { taxType: true, jurisdiction: true } } },
    }),
  ]);

  for (const link of links) {
    const policy = getWorkpaperSourcePolicy(link.sourceCode);
    if (!policy?.allocationJurisdiction) continue;
    const matching = obligations.filter(
      (obligation) =>
        obligation.regime.taxType.code === policy.taxTypeCode &&
        (!policy.regimeCode || obligation.regime.code === policy.regimeCode),
    );
    if (matching.length !== 1) {
      throw new WorkpaperAllocationError(
        `La fuente ${policy.label} no identifica una única obligación activa`,
      );
    }
    const obligation = matching[0]!;
    const sourceRows = link.importBatch.rows.filter(
      (row) =>
        (row.sourceType === "WITHHOLDING" || row.sourceType === "PERCEPTION") &&
        row.sourceId,
    );

    for (const row of sourceRows) {
      const sourceType = row.sourceType!;
      const source =
        sourceType === "WITHHOLDING"
          ? await tx.withholdingCertificate.findUnique({ where: { id: row.sourceId! } })
          : await tx.perceptionCertificate.findUnique({ where: { id: row.sourceId! } });
      if (!source) {
        throw new WorkpaperAllocationError(
          `La fila ${row.position + 1} de ${policy.label} no conserva su certificado`,
        );
      }

      let jurisdictionId = obligation.regime.jurisdictionId;
      if (policy.allocationJurisdiction === "ROW_REQUIRED") {
        const normalized = (row.normalized ?? {}) as Record<string, unknown>;
        const jurisdictionValue =
          typeof normalized["jurisdiction"] === "string"
            ? normalized["jurisdiction"].trim().toUpperCase()
            : "";
        if (!jurisdictionValue) {
          throw new WorkpaperAllocationError(
            `La fila ${row.position + 1} de ${policy.label} requiere jurisdicción`,
          );
        }
        const jurisdiction = await tx.jurisdiction.findFirst({
          where: {
            isActive: true,
            OR: [{ id: jurisdictionValue }, { code: jurisdictionValue }],
          },
        });
        if (!jurisdiction) {
          throw new WorkpaperAllocationError(
            `La jurisdicción ${jurisdictionValue} de la fila ${row.position + 1} no existe`,
          );
        }
        jurisdictionId = jurisdiction.id;
      }

      const amount = source.amount;
      const snapshotHash = taxInputAllocationHash({
        sourceType,
        source,
        obligationId: obligation.id,
        taxTypeId: obligation.regime.taxTypeId,
        regimeId: obligation.regimeId,
        jurisdictionId,
        periodId: obligation.periodId,
        amount,
      });
      const existing = await tx.taxInputAllocation.findFirst({
        where: {
          workpaperId,
          sourceType,
          sourceId: source.id,
          obligationId: obligation.id,
        },
      });
      // Una corrección manual de jurisdicción es parte del estado del
      // expediente. La materialización sólo crea la imputación inicial: no
      // debe volver a imponer la jurisdicción declarada por el archivo.
      if (existing) continue;
      const data = {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        workpaperId,
        obligationId: obligation.id,
        sourceCode: policy.code,
        sourceType,
        sourceId: source.id,
        taxTypeId: obligation.regime.taxTypeId,
        regimeId: obligation.regimeId,
        jurisdictionId,
        periodId: obligation.periodId,
        amount,
        status: "ALLOCATED",
        snapshotHash,
        allocatedByUserId: link.reviewedByUserId,
        allocatedAt: link.reviewedAt ?? new Date(),
      };
      await tx.taxInputAllocation.create({ data });

      const scope = {
        taxTypeId: obligation.regime.taxTypeId,
        regimeId: obligation.regimeId,
        jurisdictionId,
        taxPeriodId: obligation.periodId,
      };
      if (sourceType === "WITHHOLDING") {
        await tx.withholdingCertificate.update({ where: { id: source.id }, data: scope });
      } else {
        await tx.perceptionCertificate.update({ where: { id: source.id }, data: scope });
      }
    }
  }
}

export async function workpaperAllocationCoverage(
  tx: Prisma.TransactionClient,
  workpaperId: string,
) {
  const links = await tx.workpaperImportBatch.findMany({
    where: {
      workpaperId,
      status: "REVIEWED",
      importBatch: { status: "COMMITTED" },
    },
    include: { importBatch: { include: { rows: true } } },
  });
  const expected = links.flatMap((link) => {
    const policy = getWorkpaperSourcePolicy(link.sourceCode);
    if (!policy?.allocationJurisdiction) return [];
    return link.importBatch.rows
      .filter(
        (row) =>
          (row.sourceType === "WITHHOLDING" || row.sourceType === "PERCEPTION") &&
          row.sourceId,
      )
      .map((row) => ({ sourceType: row.sourceType!, sourceId: row.sourceId! }));
  });
  const expectedKeys = new Set(expected.map((item) => `${item.sourceType}:${item.sourceId}`));
  const allocations = await tx.taxInputAllocation.findMany({
    where: { workpaperId },
    include: {
      obligation: {
        include: { period: true, regime: { include: { taxType: true, jurisdiction: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const allocatedKeys = new Set(
    allocations
      .filter((item) => item.status === "ALLOCATED")
      .map((item) => `${item.sourceType}:${item.sourceId}`),
  );
  const pending = [...expectedKeys].filter((key) => !allocatedKeys.has(key)).length;
  const jurisdictionIds = [
    ...new Set(allocations.map((item) => item.jurisdictionId).filter(Boolean) as string[]),
  ];
  const jurisdictions = await tx.jurisdiction.findMany({
    where: { id: { in: jurisdictionIds } },
  });
  const jurisdictionById = new Map(jurisdictions.map((item) => [item.id, item]));
  const withholdingIds = allocations
    .filter((item) => item.sourceType === "WITHHOLDING")
    .map((item) => item.sourceId);
  const perceptionIds = allocations
    .filter((item) => item.sourceType === "PERCEPTION")
    .map((item) => item.sourceId);
  const [withholdings, perceptions] = await Promise.all([
    tx.withholdingCertificate.findMany({ where: { id: { in: withholdingIds } } }),
    tx.perceptionCertificate.findMany({ where: { id: { in: perceptionIds } } }),
  ]);
  const sources = new Map<string, AllocationSource>([
    ...withholdings.map((item) => [`WITHHOLDING:${item.id}`, item] as const),
    ...perceptions.map((item) => [`PERCEPTION:${item.id}`, item] as const),
  ]);

  return {
    total: expectedKeys.size,
    allocated: expectedKeys.size - pending,
    pending,
    ready: pending === 0,
    items: allocations.map((allocation) => {
      const source = sources.get(`${allocation.sourceType}:${allocation.sourceId}`);
      const jurisdiction = allocation.jurisdictionId
        ? jurisdictionById.get(allocation.jurisdictionId)
        : null;
      return {
        ...allocation,
        certificate: source
          ? {
              cuitAgent: source.cuitAgent,
              certificateNumber: source.certificateNumber,
              creditKind: source.creditKind,
              issuedOn: source.issuedOn,
              sourceAmount: source.amount,
            }
          : null,
        allocatedJurisdiction: jurisdiction
          ? { id: jurisdiction.id, code: jurisdiction.code, name: jurisdiction.name }
          : null,
      };
    }),
  };
}
