import { Prisma } from "@prisma/client";
import { taxHash } from "@contable/tax-engine";

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

export function voucherDocumentKind(voucher: { type: string; letter: string | null }) {
  const value = `${voucher.type}:${voucher.letter ?? ""}`.trim().toUpperCase();
  if (
    voucher.letter?.toUpperCase() === "NC" ||
    ["3", "6", "8"].includes(voucher.type) ||
    value.includes("NOTA_CREDITO") ||
    value.includes("NOTA DE CREDITO")
  ) {
    return "CREDIT_NOTE";
  }
  if (
    voucher.letter?.toUpperCase() === "ND" ||
    value.includes("NOTA_DEBITO") ||
    value.includes("NOTA DE DEBITO")
  ) {
    return "DEBIT_NOTE";
  }
  return "INVOICE";
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

  const [vouchers, profiles, clientActivities] = await Promise.all([
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
        validFrom: { lte: workpaper.periodEnd },
        OR: [{ validTo: null }, { validTo: { gte: workpaper.periodStart } }],
        profile: { status: "ACTIVE" },
      },
      include: { activity: true },
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
    const validClientActivities = [
      ...new Set(
        clientActivities
          .filter(
            (link) =>
              link.validFrom <= voucher.issuedOn &&
              (!link.validTo || link.validTo >= voucher.issuedOn),
          )
          .map((link) => link.activity.code),
      ),
    ];

    let categoryCode: string | null = null;
    let activityCode: string | null = null;
    let origin: string | null = null;
    if (voucher.direction === "PURCHASE" && supplierProfile?.categoryCode) {
      categoryCode = supplierProfile.categoryCode;
      activityCode = supplierProfile.activityCode;
      origin = "SUPPLIER_PROFILE";
    } else if (voucher.direction === "SALE" && lineActivities.length === 1) {
      activityCode = lineActivities[0]!;
      origin = "VOUCHER_LINE";
    } else if (voucher.direction === "SALE" && validClientActivities.length === 1) {
      activityCode = validClientActivities[0]!;
      origin = "SINGLE_CLIENT_ACTIVITY";
    }

    const status =
      voucher.direction === "PURCHASE"
        ? categoryCode
          ? "CLASSIFIED"
          : "PENDING"
        : activityCode
          ? "CLASSIFIED"
          : "PENDING";
    const buckets = rateBuckets(voucher);
    const documentKind = voucherDocumentKind(voucher);
    const profileId = supplierProfile?.id ?? null;

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
        snapshotHash: snapshotHash({
          voucher,
          documentKind,
          categoryCode,
          activityCode,
          buckets,
          supplierProfileId: profileId,
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
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const pending = items.filter((item) => item.status !== "CLASSIFIED").length;
  return {
    total: items.length,
    classified: items.length - pending,
    pending,
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
  });
}
