import { Prisma } from "@prisma/client";
import { arcaTipoClase, taxHash } from "@contable/tax-engine";
import { filtroVigenciaRango, vigenteEnFecha } from "./activity-coverage.js";

export type ClassificationWorkpaper = {
  id: string;
  firmId: string;
  clientId: string;
  periodStart: Date;
  periodEnd: Date;
};

type VoucherForClassification = Prisma.FiscalVoucherGetPayload<{
  include: { components: true; lines: true };
}>;

/**
 * Clase de documento de un comprobante. `type` guarda la letra del libro («NC», «ND») o, en
 * comprobantes cargados a mano, el código de ARCA: en ambos casos se decide por la tabla oficial
 * de tipos de comprobante (la misma del importador), no por códigos sueltos: el 6 es Factura B.
 */
export function voucherDocumentKind(voucher: { type: string; letter: string | null }) {
  const value = `${voucher.type}:${voucher.letter ?? ""}`.trim().toUpperCase();
  const clase = /^\s*\d+/.test(voucher.type) ? arcaTipoClase(voucher.type) : null;
  if (
    voucher.letter?.toUpperCase() === "NC" ||
    clase === "NC" ||
    value.includes("NOTA_CREDITO") ||
    value.includes("NOTA DE CREDITO")
  ) {
    return "CREDIT_NOTE";
  }
  if (
    voucher.letter?.toUpperCase() === "ND" ||
    clase === "ND" ||
    value.includes("NOTA_DEBITO") ||
    value.includes("NOTA DE DEBITO")
  ) {
    return "DEBIT_NOTE";
  }
  return "INVOICE";
}

// Facturas, notas de crédito y notas de débito con letra B o C según la tabla oficial de ARCA
// («Libro IVA Digital - Tablas del Sistema»): el IVA de estos comprobantes no es crédito fiscal.
const ARCA_CODES_LETRA_B: ReadonlySet<number> = new Set([6, 7, 8, 206, 207, 208]);
const ARCA_CODES_LETRA_C: ReadonlySet<number> = new Set([11, 12, 13, 15, 211, 212, 213]);

/**
 * Una compra con factura (o nota) B o C no genera crédito fiscal de IVA. La letra se toma de `letter`
 * cuando guarda «B» o «C» y, si el tipo es un código de ARCA (en notas `letter` guarda «NC» o «ND»),
 * de la tabla oficial de códigos. Una venta nunca es «sin crédito»: el crédito es de las compras.
 */
export function voucherGivesIvaCredit(voucher: {
  direction: string;
  type: string;
  letter: string | null;
}): boolean {
  if (voucher.direction !== "PURCHASE") return true;
  const letter = voucher.letter?.trim().toUpperCase() ?? "";
  if (letter === "B" || letter === "C") return false;
  const code = /^\s*(\d+)/.exec(voucher.type)?.[1];
  if (code === undefined) return true;
  const numero = Number(code);
  return !(ARCA_CODES_LETRA_B.has(numero) || ARCA_CODES_LETRA_C.has(numero));
}

function rateBuckets(voucher: VoucherForClassification) {
  const labels: Record<string, string> = {
    IVA_21: "21",
    IVA_105: "10.5",
    IVA_27: "27",
    EXENTO: "EXENTO",
    NO_GRAVADO: "NO_GRAVADO",
  };
  return voucher.components
    .filter((component) => labels[component.concept])
    .map((component) => ({
      rate: labels[component.concept]!,
      base: component.base.abs().toFixed(4),
      amount: component.amount.abs().toFixed(4),
    }))
    .sort((left, right) => left.rate.localeCompare(right.rate));
}

function snapshotHash(input: {
  voucher: VoucherForClassification;
  documentKind: string;
  categoryCode: string | null;
  activityCode: string | null;
  buckets: Array<{ rate: string; base: string; amount: string }>;
  supplierProfileId: string | null;
  ivaCredit?: boolean;
}) {
  return taxHash({
    voucherId: input.voucher.id,
    voucherVersion: input.voucher.version,
    voucherHash: input.voucher.hash,
    direction: input.voucher.direction,
    documentKind: input.documentKind,
    categoryCode: input.categoryCode,
    activityCode: input.activityCode,
    rateBuckets: input.buckets,
    supplierProfileId: input.supplierProfileId,
    // Solo cuando no hay crédito: los hashes de las clasificaciones anteriores no cambian.
    ...(input.ivaCredit === false ? { ivaCredit: false } : {}),
  });
}

export async function reviewedSourceFacts(
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
  const factsBySourceCode: Record<
    string,
    Array<{
      rowId: string;
      sourceType: string;
      sourceId: string;
      normalized: Prisma.JsonValue | null;
    }>
  > = {};
  for (const link of links) {
    const target = factsBySourceCode[link.sourceCode] ?? [];
    target.push(
      ...link.importBatch.rows
        .filter((row) => row.sourceType && row.sourceId)
        .map((row) => ({
          rowId: row.id,
          sourceType: row.sourceType!,
          sourceId: row.sourceId!,
          normalized: row.normalized,
        })),
    );
    factsBySourceCode[link.sourceCode] = target;
  }
  const facts = Object.values(factsBySourceCode).flat();
  return {
    voucherIds: [...new Set(facts.filter((fact) => fact.sourceType === "FISCAL_VOUCHER").map((fact) => fact.sourceId))],
    withholdingIds: [...new Set(facts.filter((fact) => fact.sourceType === "WITHHOLDING").map((fact) => fact.sourceId))],
    perceptionIds: [...new Set(facts.filter((fact) => fact.sourceType === "PERCEPTION").map((fact) => fact.sourceId))],
    f931RunIds: [...new Set(facts.filter((fact) => fact.sourceType === "F931_RUN").map((fact) => fact.sourceId))],
    bySourceCode: factsBySourceCode,
  };
}

/**
 * Crea el snapshot de clasificación por revisión del expediente. Nunca copia
 * los datos del maestro en tiempo de cálculo: quedan congelados aquí.
 */
export async function materializeWorkpaperClassifications(
  tx: Prisma.TransactionClient,
  workpaper: ClassificationWorkpaper,
  requestedVoucherIds?: readonly string[],
) {
  const sourceFacts = requestedVoucherIds
    ? { voucherIds: [...new Set(requestedVoucherIds)] }
    : await reviewedSourceFacts(tx, workpaper.id);
  const voucherIds = sourceFacts.voucherIds;
  if (voucherIds.length === 0) return [];

  const [vouchers, profiles, clientActivities, rules] = await Promise.all([
    tx.fiscalVoucher.findMany({
      where: {
        id: { in: voucherIds },
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
      },
      include: { components: true, lines: true },
    }),
    tx.supplierTaxProfile.findMany({
      where: {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        status: "ACTIVE",
        validFrom: { lte: workpaper.periodEnd },
        OR: [{ validTo: null }, { validTo: { gte: workpaper.periodStart } }],
      },
      orderBy: [{ cuitNormalized: "asc" }, { version: "desc" }],
    }),
    tx.clientActivity.findMany({
      where: {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        ...filtroVigenciaRango(workpaper.periodStart, workpaper.periodEnd),
        profile: { status: "ACTIVE" },
      },
      include: { activity: true },
    }),
    tx.classificationRule.findMany({
      where: { firmId: workpaper.firmId, clientId: workpaper.clientId, revokedAt: null },
    }),
  ]);

  for (const voucher of vouchers) {
    const existing = await tx.workpaperVoucherClassification.findUnique({
      where: { workpaperId_voucherId: { workpaperId: workpaper.id, voucherId: voucher.id } },
    });
    if (existing) continue;

    const counterpartyCuit =
      voucher.direction === "PURCHASE" ? voucher.issuerCuit : voucher.receiverCuit;
    const activeProfiles = profiles.filter(
      (profile) =>
        profile.cuitNormalized === counterpartyCuit &&
        profile.validFrom <= voucher.issuedOn &&
        (!profile.validTo || profile.validTo >= voucher.issuedOn),
    );
    const supplierProfile = activeProfiles[0] ?? null;

    const lineActivities = [
      ...new Set(voucher.lines.map((line) => line.activityCode).filter(Boolean) as string[]),
    ];
    const validLinks = clientActivities.filter((link) => vigenteEnFecha(link, voucher.issuedOn));
    const validClientActivities = [...new Set(validLinks.map((link) => link.activity.code))];
    // Una actividad por nivel (provincial, municipal): cada impuesto toma la suya al liquidar.
    const activitiesByJurisdiction = new Map<string, Set<string>>();
    for (const link of validLinks) {
      const codes = activitiesByJurisdiction.get(link.activity.jurisdictionId) ?? new Set<string>();
      codes.add(link.activity.code);
      activitiesByJurisdiction.set(link.activity.jurisdictionId, codes);
    }
    const onePerLevel =
      activitiesByJurisdiction.size > 1 &&
      [...activitiesByJurisdiction.values()].every((codes) => codes.size === 1);

    let categoryCode: string | null = null;
    let activityCode: string | null = null;
    let origin: string | null = null;
    // La regla «recordar» del cliente manda sobre el maestro del proveedor y sobre la actividad única.
    const rule = rules.find(
      (item) => item.direction === voucher.direction && item.counterpartyCuit === counterpartyCuit,
    );
    if (rule && (voucher.direction === "PURCHASE" ? rule.categoryCode : rule.activityCode)) {
      categoryCode = voucher.direction === "PURCHASE" ? rule.categoryCode : null;
      activityCode = rule.activityCode;
      origin = "RULE";
    } else if (voucher.direction === "PURCHASE" && supplierProfile?.categoryCode) {
      categoryCode = supplierProfile.categoryCode;
      activityCode = supplierProfile.activityCode;
      origin = "SUPPLIER_PROFILE";
    } else if (voucher.direction === "SALE" && lineActivities.length === 1) {
      activityCode = lineActivities[0]!;
      origin = "VOUCHER_LINE";
    } else if (voucher.direction === "SALE" && validClientActivities.length === 1) {
      activityCode = validClientActivities[0]!;
      origin = "SINGLE_CLIENT_ACTIVITY";
    } else if (voucher.direction === "SALE" && onePerLevel) {
      // Sin código único: cada impuesto asigna la venta a la única actividad de su nivel al calcular.
      origin = "SINGLE_ACTIVITY_PER_LEVEL";
    }

    const status =
      voucher.direction === "PURCHASE"
        ? categoryCode
          ? "CLASSIFIED"
          : "PENDING"
        : activityCode || origin === "SINGLE_ACTIVITY_PER_LEVEL"
          ? "CLASSIFIED"
          : "PENDING";
    const buckets = rateBuckets(voucher);
    const documentKind = voucherDocumentKind(voucher);
    const profileId = supplierProfile?.id ?? null;
    const ivaCredit = voucherGivesIvaCredit(voucher);

    await tx.workpaperVoucherClassification.create({
      data: {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        workpaperId: workpaper.id,
        voucherId: voucher.id,
        supplierProfileId: profileId,
        direction: voucher.direction,
        counterpartyCuit,
        documentKind,
        categoryCode,
        activityCode,
        rateBuckets: buckets,
        status,
        origin,
        ivaCredit,
        snapshotHash: snapshotHash({
          voucher,
          documentKind,
          categoryCode,
          activityCode,
          buckets,
          supplierProfileId: profileId,
          ivaCredit,
        }),
        ...(status === "CLASSIFIED" ? { classifiedAt: new Date() } : {}),
      },
    });
  }

  return tx.workpaperVoucherClassification.findMany({
    where: { workpaperId: workpaper.id },
    include: { voucher: { include: { components: true, lines: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

export async function classificationCoverage(
  tx: Prisma.TransactionClient,
  workpaperId: string,
) {
  const items = await tx.workpaperVoucherClassification.findMany({
    where: { workpaperId },
    include: {
      voucher: {
        select: {
          id: true,
          type: true,
          letter: true,
          pointOfSale: true,
          number: true,
          issuedOn: true,
          total: true,
        },
      },
      excludedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  // Un comprobante excluido no se clasifica ni se calcula: no cuenta como pendiente ni como clasificado.
  const excluded = items.filter((item) => item.excludedAt !== null).length;
  const pending = items.filter(
    (item) => item.excludedAt === null && item.status !== "CLASSIFIED",
  ).length;
  return {
    total: items.length,
    classified: items.length - pending - excluded,
    pending,
    excluded,
    ready: pending === 0,
    items,
  };
}

export function classificationHash(input: {
  voucher: VoucherForClassification;
  documentKind: string;
  categoryCode: string | null;
  activityCode: string | null;
  rateBuckets: Prisma.JsonValue;
  supplierProfileId: string | null;
  ivaCredit?: boolean;
}) {
  return taxHash({
    voucherId: input.voucher.id,
    voucherVersion: input.voucher.version,
    voucherHash: input.voucher.hash,
    direction: input.voucher.direction,
    documentKind: input.documentKind,
    categoryCode: input.categoryCode,
    activityCode: input.activityCode,
    rateBuckets: input.rateBuckets,
    supplierProfileId: input.supplierProfileId,
    ...(input.ivaCredit === false ? { ivaCredit: false } : {}),
  });
}
