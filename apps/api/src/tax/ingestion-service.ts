import { Prisma } from "@prisma/client";
import { taxHash } from "@contable/tax-engine";
import {
  normalizeArcaVoucherBatch,
  normalizeCm03Batch,
  normalizeF931Batch,
  normalizeIibbTucBatch,
  normalizeTemSmtBatch,
  normalizeWithholdingBatch,
  parseSifereWorkbook,
  type ArcaVoucherInput,
  type Cm03ImportRow,
  type F931Input,
  type IibbTucImportRow,
  type ImportTotals,
  type TemSmtImportRow,
  type WithholdingInput,
  type SifereDirection,
} from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { getWorkpaperSourcePolicy, WORKPAPER_SOURCE_POLICIES } from "./workpaper-source-policy.js";

/**
 * Servicio de ingestión fiscal (Puerta 2).
 *
 * G2-01: ImportBatch + ImportRow.
 * G2-02: adaptador ARCA compras/ventas.
 * G2-03: adaptador retenciones/percepciones.
 * G2-04: FiscalVoucher, líneas y componentes.
 * G2-05: deduplicación de comprobantes.
 * G2-10: importación atómica, idempotente y reanudable.
 *
 * Invariantes:
 * - Una importación nunca se confirma parcialmente sin mostrar qué filas
 *   quedaron fuera (cada fila ERROR queda visible en el lote).
 * - Reintentar el mismo lote (mismo fileHash) no duplica hechos.
 * - Un voucher aprobado es inmutable (status APPROVED no se edita).
 */

export type ImportErrorCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_VALIDATED"
  | "BATCH_ALREADY_COMMITTED"
  | "BATCH_HAS_ERRORS"
  | "PERIOD_NOT_FOUND"
  | "TAX_TYPE_NOT_FOUND"
  | "VOUCHER_NOT_FOUND"
  | "VOUCHER_IMMUTABLE"
  | "DUPLICATE_VOUCHER"
  | "NO_ROWS"
  | "WORKPAPER_NOT_FOUND"
  | "SOURCE_POLICY_INVALID"
  | "UNKNOWN_ADAPTER"
  | "INVALID_TRANSITION";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

type NormalizedImportRow = {
  status: "VALID" | "ERROR";
  data?: Record<string, unknown>;
  errors?: string[];
};

function enforceBatchPeriod(
  rows: readonly NormalizedImportRow[],
  period: { startDate: Date; endDate: Date },
) {
  return rows.map((row) => {
    if (row.status !== "VALID" || !row.data || typeof row.data["issuedOn"] !== "string") {
      return row;
    }
    const issuedOn = new Date(`${row.data["issuedOn"]}T00:00:00.000Z`);
    if (issuedOn < period.startDate || issuedOn > period.endDate) {
      return { status: "ERROR" as const, errors: ["PERIOD_MISMATCH"] };
    }
    return row;
  });
}

function summarizeNormalizedRows(rows: readonly NormalizedImportRow[]) {
  let net = new Prisma.Decimal(0);
  let iva = new Prisma.Decimal(0);
  let withholding = new Prisma.Decimal(0);
  let perception = new Prisma.Decimal(0);
  let validRows = 0;
  let errorRows = 0;

  for (const row of rows) {
    if (row.status !== "VALID" || !row.data) {
      errorRows += 1;
      continue;
    }
    validRows += 1;
    const data = row.data;
    const netValue = data["net"] ?? data["income"] ?? data["netRemuneration"];
    if (typeof netValue === "string") net = net.plus(netValue);
    for (const key of ["iva21", "iva105", "iva27"]) {
      if (typeof data[key] === "string") iva = iva.plus(data[key] as string);
    }
    if (typeof data["amount"] === "string" && data["kind"] === "RETENCION") {
      withholding = withholding.plus(data["amount"] as string);
    }
    if (typeof data["amount"] === "string" && data["kind"] === "PERCEPCION") {
      perception = perception.plus(data["amount"] as string);
    }
  }

  return {
    net: net.toFixed(4),
    iva: iva.toFixed(4),
    withholding: withholding.toFixed(4),
    perception: perception.toFixed(4),
    validRows,
    errorRows,
  };
}

type AdapterNormalizer = (rows: readonly unknown[]) => {
  rows: unknown[];
  totals: ImportTotals;
};

type CommitBranch = "VOUCHER" | "WITHHOLDING" | "IIBB" | "TEM" | "CM03" | "F931";

type SourceAdapter = {
  normalize: AdapterNormalizer;
  commitBranch: CommitBranch;
};

/**
 * P2: el normalizador y la rama de escritura se eligen por la política de
 * fuente resuelta, no por el texto de `adapterVersion`. La tabla es explícita:
 * una política sin entrada no se procesa (nunca cae a un adaptador por defecto).
 */
const SOURCE_ADAPTERS: Readonly<Record<string, SourceAdapter>> = {
  ARCA_IVA_SALES: {
    normalize: (rows) => normalizeArcaVoucherBatch(rows as ArcaVoucherInput[]),
    commitBranch: "VOUCHER",
  },
  ARCA_IVA_PURCHASES: {
    normalize: (rows) => normalizeArcaVoucherBatch(rows as ArcaVoucherInput[]),
    commitBranch: "VOUCHER",
  },
  SICORE_IVA: {
    normalize: (rows) => normalizeWithholdingBatch(rows as WithholdingInput[]),
    commitBranch: "WITHHOLDING",
  },
  F931: {
    normalize: (rows) => normalizeF931Batch(rows as F931Input[]),
    commitBranch: "F931",
  },
  DGR_IIBB_TUC: {
    normalize: (rows) => normalizeIibbTucBatch(rows as IibbTucImportRow[]),
    commitBranch: "IIBB",
  },
  SIFERE_CM03: {
    normalize: (rows) => normalizeCm03Batch(rows as Cm03ImportRow[]),
    commitBranch: "CM03",
  },
  IIBB_RPI_TUC: {
    normalize: (rows) => normalizeWithholdingBatch(rows as WithholdingInput[]),
    commitBranch: "WITHHOLDING",
  },
  SIFERE_RPI_CM: {
    normalize: (rows) => normalizeWithholdingBatch(rows as WithholdingInput[]),
    commitBranch: "WITHHOLDING",
  },
  SMT_TEM: {
    normalize: (rows) => normalizeTemSmtBatch(rows as TemSmtImportRow[]),
    commitBranch: "TEM",
  },
  SMT_RPI_TEM: {
    normalize: (rows) => normalizeWithholdingBatch(rows as WithholdingInput[]),
    commitBranch: "WITHHOLDING",
  },
};

const AVAILABLE_ADAPTERS = [
  ...new Set(WORKPAPER_SOURCE_POLICIES.map((policy) => policy.adapterVersion)),
].sort();

function unknownAdapterError(adapterVersion: string) {
  return new ImportError(
    "UNKNOWN_ADAPTER",
    `El adaptador de importación "${adapterVersion}" no tiene una política de fuente registrada. ` +
      `Adaptadores disponibles: ${AVAILABLE_ADAPTERS.join(", ")}.`,
  );
}

/**
 * Resuelve la política de fuente de un lote. La fuente con la que se vinculó
 * el lote manda; para lotes sin vínculo se busca la política por su
 * `adapterVersion` exacto. Sin política no hay comportamiento por defecto.
 */
function resolveSourceAdapter(
  batch: { adapterVersion: string },
  linkedSourceCode: string | null,
): SourceAdapter {
  const linkedPolicy = linkedSourceCode
    ? getWorkpaperSourcePolicy(linkedSourceCode)
    : undefined;
  const policy =
    linkedPolicy ??
    WORKPAPER_SOURCE_POLICIES.find(
      (candidate) => candidate.adapterVersion === batch.adapterVersion,
    );
  if (!policy) throw unknownAdapterError(batch.adapterVersion);
  const adapter = SOURCE_ADAPTERS[policy.code];
  if (!adapter) throw unknownAdapterError(batch.adapterVersion);
  return adapter;
}

export class IngestionService {
  /**
   * G2-01: crea un lote (idempotente por origen + impuesto + período + fileHash).
   * G2-10: reintentar la misma carga no duplica el lote.
   */
  async createBatch(
    ctx: TenantContext,
    input: {
      clientId: string;
      origin: string;
      taxTypeId: string;
      periodId: string;
      adapterVersion: string;
      fileName?: string;
      fileHash?: string;
      workpaperId?: string;
      sourceCode?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      if (Boolean(input.workpaperId) !== Boolean(input.sourceCode)) {
        throw new ImportError(
          "SOURCE_POLICY_INVALID",
          "El expediente y el código de fuente deben informarse juntos",
        );
      }

      const period = await tx.taxPeriod.findFirst({
        where: { id: input.periodId, firmId: ctx.firmId, clientId: input.clientId },
      });
      if (!period) throw new ImportError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");
      const taxType = await tx.taxType.findUnique({ where: { id: input.taxTypeId } });
      if (!taxType) throw new ImportError("TAX_TYPE_NOT_FOUND", "Impuesto no encontrado");

      if (input.workpaperId && input.sourceCode) {
        const policy = getWorkpaperSourcePolicy(input.sourceCode);
        if (
          !policy ||
          policy.taxTypeCode !== taxType.code ||
          policy.origin !== input.origin ||
          policy.adapterVersion !== input.adapterVersion
        ) {
          throw new ImportError(
            "SOURCE_POLICY_INVALID",
            "La fuente, el impuesto y el adaptador no corresponden entre sí",
          );
        }
        const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
          where: {
            id: input.workpaperId,
            firmId: ctx.firmId,
            clientId: input.clientId,
            status: {
              in: ["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE", "CHANGES_REQUESTED"],
            },
            periodStart: { lte: period.startDate },
            periodEnd: { gte: period.endDate },
          },
        });
        if (!workpaper) {
          throw new ImportError(
            "WORKPAPER_NOT_FOUND",
            "El expediente no admite nuevas fuentes en su estado actual o no contiene el período del lote",
          );
        }
        const obligation = await tx.taxObligation.findFirst({
          where: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            periodId: input.periodId,
            status: { not: "NOT_APPLICABLE" },
            regime: {
              taxTypeId: input.taxTypeId,
              ...(policy.regimeCode ? { code: policy.regimeCode } : {}),
            },
          },
        });
        if (!obligation) {
          throw new ImportError(
            "SOURCE_POLICY_INVALID",
            "El expediente no espera esa fuente para sus obligaciones activas",
          );
        }
      }

      // Idempotencia: mismo lote (mismo origen/impuesto/período/hash) ya existe.
      let existing = null;
      if (input.fileHash) {
        existing = await tx.importBatch.findUnique({
          where: {
            firmId_clientId_origin_taxTypeId_periodId_fileHash: {
              firmId: ctx.firmId,
              clientId: input.clientId,
              origin: input.origin,
              taxTypeId: input.taxTypeId,
              periodId: input.periodId,
              fileHash: input.fileHash,
            },
          },
        });
      }

      const batch =
        existing ??
        (await tx.importBatch.create({
          data: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            origin: input.origin,
            taxTypeId: input.taxTypeId,
            periodId: input.periodId,
            adapterVersion: input.adapterVersion,
            status: "UPLOADED",
            ...(input.fileName ? { fileName: input.fileName } : {}),
            ...(input.fileHash ? { fileHash: input.fileHash } : {}),
            createdByUserId: ctx.userId,
          },
        }));

      if (input.workpaperId && input.sourceCode) {
        const existingLink = await tx.workpaperImportBatch.findUnique({
          where: {
            workpaperId_importBatchId: {
              workpaperId: input.workpaperId,
              importBatchId: batch.id,
            },
          },
        });
        if (existingLink && existingLink.sourceCode !== input.sourceCode) {
          throw new ImportError(
            "SOURCE_POLICY_INVALID",
            "El mismo lote no puede representar dos fuentes distintas del expediente",
          );
        }
        await tx.workpaperImportBatch.upsert({
          where: {
            workpaperId_importBatchId: {
              workpaperId: input.workpaperId,
              importBatchId: batch.id,
            },
          },
          create: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            workpaperId: input.workpaperId,
            importBatchId: batch.id,
            sourceCode: input.sourceCode,
          },
          update: {},
        });
      }

      return batch;
    });
  }

  /**
   * G2-02/03: valida las filas del lote usando el adaptador puro.
   * Cada fila ERROR queda visible con detalle; no se oculta nada.
   */
  async validateBatch(
    ctx: TenantContext,
    batchId: string,
    rows: readonly (
      | ArcaVoucherInput
      | WithholdingInput
      | IibbTucImportRow
      | TemSmtImportRow
      | Cm03ImportRow
      | F931Input
    )[],
  ) {
    return withTenantContext(ctx, async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, firmId: ctx.firmId },
        include: { period: true },
      });
      if (!batch) throw new ImportError("BATCH_NOT_FOUND", "Lote no encontrado");
      if (batch.status !== "UPLOADED") {
        throw new ImportError("INVALID_TRANSITION", `No se puede validar un lote en estado ${batch.status}`);
      }

      const adapter = await this.sourceAdapterForBatch(tx, ctx, batch);
      const normalizedRows = adapter.normalize(rows as readonly unknown[]);

      const checkedRows = enforceBatchPeriod(
        normalizedRows.rows as unknown as NormalizedImportRow[],
        batch.period,
      );
      const hasPeriodMismatch = checkedRows.some((row) => row.errors?.includes("PERIOD_MISMATCH"));
      const totals = hasPeriodMismatch
        ? summarizeNormalizedRows(checkedRows)
        : normalizedRows.totals;

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: "VALIDATED",
          totalRows: rows.length,
          validRows: totals.validRows,
          errorRows: totals.errorRows,
          totals: totals as unknown as Prisma.InputJsonValue,
        },
      });

      // Guarda cada fila normalizada (con su estado y errores).
      for (let i = 0; i < checkedRows.length; i += 1) {
        const row = checkedRows[i]!;
        const raw = (rows[i] ?? {}) as Record<string, unknown>;
        await tx.importRow.create({
          data: {
            firmId: ctx.firmId,
            clientId: ctx.clientId!,
            batchId,
            position: i,
            raw: raw as unknown as Prisma.InputJsonValue,
            normalized: row.status === "VALID" && row.data
              ? (row.data as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            status: row.status === "VALID" ? "VALID" : "ERROR",
            errors: row.errors ?? [],
          },
        });
      }

      return {
        batchId,
        totals,
        rows: checkedRows.length,
      };
    });
  }

  /**
   * G2-04/05: convierte un lote validado en vouchers fiscales.
   * - Deduplicación por clave fiscal (dirección + CUIT contraparte + tipo + punto de venta + número).
   * - Atómico: si falla una fila, el lote queda COMMITTED parcialmente visible
   *   con las filas que quedaron fuera (nunca se oculta un error).
   * - Idempotente: un lote ya COMMITTED no se vuelve a comitear.
   */
  async commitBatch(ctx: TenantContext, batchId: string, clientCuit: string) {
    return withTenantContext(ctx, async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, firmId: ctx.firmId },
        include: { rows: { orderBy: { position: "asc" } } },
      });
      if (!batch) throw new ImportError("BATCH_NOT_FOUND", "Lote no encontrado");
      if (batch.status === "COMMITTED") {
        // Reanudable: devolver el lote ya comiteado sin duplicar.
        return { batch, committed: 0, duplicates: 0, errors: [] as string[] };
      }
      if (batch.status !== "VALIDATED") {
        throw new ImportError("BATCH_NOT_VALIDATED", "El lote debe validarse antes de comitear");
      }
      if (batch.errorRows > 0) {
        throw new ImportError("BATCH_HAS_ERRORS", `El lote tiene ${batch.errorRows} filas con error`);
      }

      const adapter = await this.sourceAdapterForBatch(tx, ctx, batch);
      const branch = adapter.commitBranch;
      let committed = 0;
      let duplicates = 0;

      if (branch === "F931") {
        committed = await this.commitF931Rows(tx, ctx, batch);
      }

      // F0.4: commit estrictamente atómico. Si una fila crítica falla al
      // escribir o una regla de unicidad revela un conflicto no resuelto, la
      // excepción propaga y la transacción hace rollback de TODAS las
      // escrituras de negocio. El lote nunca queda COMMITTED parcialmente.
      for (const row of batch.rows) {
        if (branch === "F931") break;
        if (row.status !== "VALID") {
          throw new ImportError(
            "BATCH_HAS_ERRORS",
            `El lote contiene la fila ${row.position + 1} inválida: ${row.errors.join(", ")}`,
          );
        }
        if (row.voucherId) {
          committed += 1; // Ya comiteada en una ejecución anterior.
          continue;
        }

        if (branch === "WITHHOLDING") {
          await this.commitWithholdingRow(tx, ctx, batch, row, clientCuit);
          committed += 1;
        } else if (branch === "IIBB") {
          await this.commitIibbRow(tx, ctx, batch, row, clientCuit);
          committed += 1;
        } else if (branch === "TEM") {
          await this.commitTemRow(tx, ctx, batch, row, clientCuit);
          committed += 1;
        } else if (branch === "CM03") {
          await this.commitCm03Row(tx, ctx, batch, row, clientCuit);
          committed += 1;
        } else {
          const created = await this.commitVoucherRow(tx, ctx, batch, row, clientCuit);
          if (created) committed += 1;
          else duplicates += 1;
        }
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: "COMMITTED" },
      });

      return { batch, committed, duplicates, errors: [] as string[] };
    });
  }

  /**
   * Persistencia de un libro IVA digital (.xlsx) en un solo paso: parsea,
   * crea el lote, valida y comitea. Devuelve el análisis del parser + el
   * resultado del commit. Idempotente por fileHash del archivo original.
   */
  async importSifereWorkbook(
    ctx: TenantContext,
    input: {
      clientId: string;
      clientCuit: string;
      direction: SifereDirection;
      raw: Uint8Array;
      fileName: string;
      fileHash: string;
      taxTypeId: string;
      periodId: string;
      workpaperId?: string;
    },
  ) {
    const parsed = parseSifereWorkbook(input.raw, input.direction);
    const rows = parsed.rows
      .filter((row) => row.errors.length === 0)
      .map((row) => row.input as ArcaVoucherInput);

    const sourceCode =
      input.direction === "SALE" ? "ARCA_IVA_SALES" : "ARCA_IVA_PURCHASES";
    const policy = getWorkpaperSourcePolicy(sourceCode)!;

    const batch = await this.createBatch(ctx, {
      clientId: input.clientId,
      origin: policy.origin,
      taxTypeId: input.taxTypeId,
      periodId: input.periodId,
      adapterVersion: policy.adapterVersion,
      fileName: input.fileName,
      fileHash: input.fileHash,
      ...(input.workpaperId ? { workpaperId: input.workpaperId } : {}),
      sourceCode,
    });

    const validated = await this.validateBatch(ctx, batch.id, rows);
    const committed = await this.commitBatch(ctx, batch.id, input.clientCuit);

    // Persiste el análisis derivado (alícuotas, tributos, hoja) en el lote.
    // El lote ya asocia firmId/clientId/createdByUserId/createdAt.
    const analysis = {
      direction: parsed.direction,
      sheetName: parsed.sheetName,
      totals: parsed.totals,
      rates: parsed.rates,
      taxes: parsed.taxes,
      detailRows: parsed.detailRows,
      validRows: parsed.validRows,
      errorRows: parsed.errorRows,
    };
    await withTenantContext(ctx, async (tx) => {
      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          totals: {
            ...(validated.totals as unknown as Record<string, unknown>),
            analysis: analysis as unknown as Prisma.InputJsonValue,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return {
      analysis,
      batch: {
        id: batch.id,
        status: committed.batch.status,
        committed: committed.committed,
        duplicates: committed.duplicates,
      },
      validation: validated.totals,
    };
  }

  /**
   * P2: la política de fuente del lote decide el adaptador. El vínculo con el
   * expediente aporta el `sourceCode`; un lote suelto se resuelve por su
   * `adapterVersion` exacto. Sin política registrada, error explícito.
   */
  private async sourceAdapterForBatch(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string; adapterVersion: string },
  ): Promise<SourceAdapter> {
    const link = await tx.workpaperImportBatch.findFirst({
      where: { importBatchId: batch.id, firmId: ctx.firmId },
      select: { sourceCode: true },
    });
    return resolveSourceAdapter(batch, link?.sourceCode ?? null);
  }

  private async commitVoucherRow(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string },
    row: { id: string; position: number; normalized: Prisma.JsonValue },
    clientCuit: string,
  ): Promise<boolean> {
    const n = (row.normalized ?? {}) as Record<string, unknown>;
    // F0.4: la dirección viene del adaptador tipado (nunca se infiere de taxTypeId).
    const direction = n["direction"] === "SALE" ? "SALE" : "PURCHASE";
    const counterpartyCuit = n["counterpartyCuit"] as string;
    const letter = n["letter"] as string;
    const pointOfSale = n["pointOfSale"] as number;
    const numberFrom = n["numberFrom"] as number;

    // G2-05: clave de duplicidad fiscal.
    const existing = await tx.fiscalVoucher.findFirst({
      where: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        direction,
        issuerCuit: { in: [counterpartyCuit, clientCuit] },
        receiverCuit: { in: [counterpartyCuit, clientCuit] },
        type: letter,
        pointOfSale,
        number: numberFrom,
      },
    });
    if (existing) {
      await tx.importRow.update({
        where: { id: row.id },
        data: {
          status: "DUPLICATE",
          sourceType: "FISCAL_VOUCHER",
          sourceId: existing.id,
        },
      });
      return false;
    }

    const total = n["total"] as string;
    const net = n["net"] as string;
    const iva21 = n["iva21"] as string;
    const iva105 = n["iva105"] as string;
    const iva27 = n["iva27"] as string;
    const exempt = n["exempt"] as string;
    const otherTaxes = n["otherTaxes"] as string;
    const exchangeRate = n["exchangeRate"] as string | null;
    const currency = n["currency"] as string;

    // F0.4: dirección según el adaptador. Venta → el cliente es emisor;
    // compra → el cliente es receptor.
    const issuerCuit = direction === "SALE" ? clientCuit : counterpartyCuit;
    const receiverCuit = direction === "SALE" ? counterpartyCuit : clientCuit;

    const hashInput = {
      firmId: ctx.firmId,
      clientId: ctx.clientId,
      direction,
      type: letter,
      pointOfSale,
      number: numberFrom,
      issuerCuit,
      receiverCuit,
      issuedOn: n["issuedOn"],
      net,
      total,
    };
    const hash = taxHash(hashInput);

    const voucher = await tx.fiscalVoucher.create({
      data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        direction,
        type: letter,
        letter,
        pointOfSale,
        number: numberFrom,
        issuerCuit,
        receiverCuit,
        issuedOn: new Date(n["issuedOn"] as string),
        currency,
        ...(exchangeRate ? { exchangeRate: new Prisma.Decimal(exchangeRate) } : {}),
        total: new Prisma.Decimal(total),
        status: "DRAFT",
        version: 1,
        hash,
        createdByUserId: ctx.userId,
        components: {
          create: [
            ...(Number(net) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "NETO", base: new Prisma.Decimal(net), amount: new Prisma.Decimal(net) }]
              : []),
            ...(Number(iva21) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "IVA_21", base: new Prisma.Decimal(iva21).div("0.21"), rate: new Prisma.Decimal("0.21"), amount: new Prisma.Decimal(iva21) }]
              : []),
            ...(Number(iva105) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "IVA_105", base: new Prisma.Decimal(iva105).div("0.105"), rate: new Prisma.Decimal("0.105"), amount: new Prisma.Decimal(iva105) }]
              : []),
            ...(Number(iva27) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "IVA_27", base: new Prisma.Decimal(iva27).div("0.27"), rate: new Prisma.Decimal("0.27"), amount: new Prisma.Decimal(iva27) }]
              : []),
            ...(Number(exempt) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "EXENTO", base: new Prisma.Decimal(exempt), amount: new Prisma.Decimal(exempt) }]
              : []),
            ...(Number(otherTaxes) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "OTROS_TRIBUTOS", base: new Prisma.Decimal(otherTaxes), amount: new Prisma.Decimal(otherTaxes) }]
              : []),
          ],
        },
      },
    });

    await tx.importRow.update({
      where: { id: row.id },
      data: {
        status: "COMMITTED",
        voucherId: voucher.id,
        sourceType: "FISCAL_VOUCHER",
        sourceId: voucher.id,
      },
    });
    return true;
  }

  /**
   * G2-02 IIBB: convierte una fila DGR Tucumán en un voucher SALE con línea
   * de actividad. La línea (activityCode + netAmount) es la fuente que el
   * motor IIBB agrupa por actividad.
   */
  private async commitIibbRow(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string; periodId: string },
    row: { id: string; position: number; normalized: Prisma.JsonValue },
    clientCuit: string,
  ): Promise<void> {
    const n = (row.normalized ?? {}) as Record<string, unknown>;
    const activityCode = n["activityCode"] as string;
    const income = n["income"] as string;
    const description = (n["description"] as string | null) ?? activityCode;
    const rate = n["rate"] as string | null;
    const minimum = n["minimum"] as string | null;
    const exemption = n["exemption"] as string;

    // Fecha dentro del período (el resumen DGR es mensual; se usa el fin del
    // período para que el voucher quede dentro del rango del cálculo).
    const period = await tx.taxPeriod.findUnique({ where: { id: batch.periodId } });
    const issuedOn = period?.endDate ?? new Date();

    // Un voucher por actividad (resumen mensual de ingresos gravados).
    const hash = taxHash({
      firmId: ctx.firmId,
      clientId: ctx.clientId,
      origin: "DGR_IIBB",
      activityCode,
      income,
      rate,
      minimum,
      exemption,
    });

    const voucher = await tx.fiscalVoucher.create({
      data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        direction: "SALE",
        type: "IIBB_RESUMEN",
        letter: "R",
        pointOfSale: 0,
        number: row.position + 1,
        issuerCuit: clientCuit,
        receiverCuit: clientCuit,
        issuedOn,
        currency: "ARS",
        total: new Prisma.Decimal(income).plus(exemption),
        status: "DRAFT",
        version: 1,
        hash,
        createdByUserId: ctx.userId,
        lines: {
          create: [
            {
              firmId: ctx.firmId,
              clientId: ctx.clientId!,
              position: 1,
              description,
              activityCode,
              netAmount: new Prisma.Decimal(income),
            },
          ],
        },
        components: {
          create: [
            {
              firmId: ctx.firmId,
              clientId: ctx.clientId!,
              concept: "NETO",
              base: new Prisma.Decimal(income),
              amount: new Prisma.Decimal(income),
            },
            ...(Number(exemption) !== 0
              ? [{
                  firmId: ctx.firmId,
                  clientId: ctx.clientId!,
                  concept: "EXENTO",
                  base: new Prisma.Decimal(exemption),
                  amount: new Prisma.Decimal(exemption),
                }]
              : []),
          ],
        },
      },
    });

    await tx.importRow.update({
      where: { id: row.id },
      data: {
        status: "COMMITTED",
        voucherId: voucher.id,
        sourceType: "FISCAL_VOUCHER",
        sourceId: voucher.id,
      },
    });
  }

  /**
   * G4 TEM: convierte una fila SMT en un voucher SALE con línea de actividad.
   * Mismo patrón que commitIibbRow: el resumen municipal es mensual y se usa
   * el fin del período como fecha para que el voucher quede dentro del rango.
   */
  private async commitTemRow(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string; periodId: string },
    row: { id: string; position: number; normalized: Prisma.JsonValue },
    clientCuit: string,
  ): Promise<void> {
    const n = (row.normalized ?? {}) as Record<string, unknown>;
    const activityCode = n["activityCode"] as string;
    const income = n["income"] as string;
    const description = (n["description"] as string | null) ?? activityCode;
    const rate = n["rate"] as string | null;
    const minimum = n["minimum"] as string | null;
    const exemption = n["exemption"] as string;

    const period = await tx.taxPeriod.findUnique({ where: { id: batch.periodId } });
    const issuedOn = period?.endDate ?? new Date();

    const hash = taxHash({
      firmId: ctx.firmId,
      clientId: ctx.clientId,
      origin: "SMT_TEM",
      activityCode,
      income,
      rate,
      minimum,
      exemption,
    });

    const voucher = await tx.fiscalVoucher.create({
      data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        direction: "SALE",
        type: "TEM_RESUMEN",
        letter: "R",
        pointOfSale: 0,
        number: row.position + 1,
        issuerCuit: clientCuit,
        receiverCuit: clientCuit,
        issuedOn,
        currency: "ARS",
        total: new Prisma.Decimal(income).plus(exemption),
        status: "DRAFT",
        version: 1,
        hash,
        createdByUserId: ctx.userId,
        lines: {
          create: [
            {
              firmId: ctx.firmId,
              clientId: ctx.clientId!,
              position: 1,
              description,
              activityCode,
              netAmount: new Prisma.Decimal(income),
            },
          ],
        },
        components: {
          create: [
            {
              firmId: ctx.firmId,
              clientId: ctx.clientId!,
              concept: "NETO",
              base: new Prisma.Decimal(income),
              amount: new Prisma.Decimal(income),
            },
            ...(Number(exemption) !== 0
              ? [{
                  firmId: ctx.firmId,
                  clientId: ctx.clientId!,
                  concept: "EXENTO",
                  base: new Prisma.Decimal(exemption),
                  amount: new Prisma.Decimal(exemption),
                }]
              : []),
          ],
        },
      },
    });

    await tx.importRow.update({
      where: { id: row.id },
      data: {
        status: "COMMITTED",
        voucherId: voucher.id,
        sourceType: "FISCAL_VOUCHER",
        sourceId: voucher.id,
      },
    });
  }

  /**
   * G4 CM03: convierte una fila de ingreso en un voucher SALE con línea de
   * actividad (base país). Las filas de coeficiente (activityCode COEF_<jur>)
   * no generan voucher: los coeficientes viven en las reglas del rule pack.
   */
  private async commitCm03Row(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string; periodId: string },
    row: { id: string; position: number; normalized: Prisma.JsonValue },
    clientCuit: string,
  ): Promise<void> {
    const n = (row.normalized ?? {}) as Record<string, unknown>;
    const activityCode = n["activityCode"] as string;
    const income = n["income"] as string;
    const description = (n["description"] as string | null) ?? activityCode;
    const coefficient = n["coefficient"] as string | null;

    // Fila de coeficiente: no genera voucher (se marca COMMITTED sin voucher).
    if (coefficient !== null) {
      await tx.importRow.update({
        where: { id: row.id },
        data: { status: "COMMITTED", sourceType: "CM03_COEFFICIENT", sourceId: row.id },
      });
      return;
    }

    const period = await tx.taxPeriod.findUnique({ where: { id: batch.periodId } });
    const issuedOn = period?.endDate ?? new Date();

    const hash = taxHash({
      firmId: ctx.firmId,
      clientId: ctx.clientId,
      origin: "CM03",
      activityCode,
      income,
    });

    const voucher = await tx.fiscalVoucher.create({
      data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        direction: "SALE",
        type: "CM03_RESUMEN",
        letter: "R",
        pointOfSale: 0,
        number: row.position + 1,
        issuerCuit: clientCuit,
        receiverCuit: clientCuit,
        issuedOn,
        currency: "ARS",
        total: new Prisma.Decimal(income),
        status: "DRAFT",
        version: 1,
        hash,
        createdByUserId: ctx.userId,
        lines: {
          create: [
            {
              firmId: ctx.firmId,
              clientId: ctx.clientId!,
              position: 1,
              description,
              activityCode,
              netAmount: new Prisma.Decimal(income),
            },
          ],
        },
        components: {
          create: [
            {
              firmId: ctx.firmId,
              clientId: ctx.clientId!,
              concept: "NETO",
              base: new Prisma.Decimal(income),
              amount: new Prisma.Decimal(income),
            },
          ],
        },
      },
    });

    await tx.importRow.update({
      where: { id: row.id },
      data: {
        status: "COMMITTED",
        voucherId: voucher.id,
        sourceType: "FISCAL_VOUCHER",
        sourceId: voucher.id,
      },
    });
  }

  private async commitWithholdingRow(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string; periodId: string },
    row: { id: string; position: number; normalized: Prisma.JsonValue },
    _clientCuit: string,
  ): Promise<void> {
    const n = (row.normalized ?? {}) as Record<string, unknown>;
    const kind = n["kind"] as "RETENCION" | "PERCEPCION";
    const cuitResponsible = n["cuitResponsable"] as string;
    const cuitAgent = n["cuitAgente"] as string;
    const concept = n["concept"] as string;
    const base = n["base"] as string;
    const amount = n["amount"] as string;
    const rate = n["rate"] as string | null;
    const issuedOn = n["issuedOn"] as string;
    const certificateNumber = n["certificateNumber"] as string | null;
    const documentKind = n["documentKind"] as "INVOICE" | "CREDIT_NOTE";

    const data = {
      firmId: ctx.firmId,
      clientId: ctx.clientId!,
      direction: "SUFFERED",
      cuitResponsible,
      cuitAgent,
      concept,
      base: new Prisma.Decimal(base),
      amount: new Prisma.Decimal(amount),
      ...(rate ? { rate: new Prisma.Decimal(rate) } : {}),
      issuedOn: new Date(issuedOn),
      ...(certificateNumber ? { certificateNumber } : {}),
      taxPeriodId: batch.periodId,
      status: "DRAFT",
      createdByUserId: ctx.userId,
    };

    const source =
      kind === "RETENCION"
        ? await tx.withholdingCertificate.create({
            data: {
              ...data,
              creditKind: documentKind === "CREDIT_NOTE" ? "WITHHOLDING_CREDIT_NOTE" : "WITHHOLDING",
            },
          })
        : await tx.perceptionCertificate.create({
            data: {
              ...data,
              creditKind: documentKind === "CREDIT_NOTE" ? "PERCEPTION_CREDIT_NOTE" : "PERCEPTION",
            },
          });

    await tx.importRow.update({
      where: { id: row.id },
      data: {
        status: "COMMITTED",
        sourceType: kind === "RETENCION" ? "WITHHOLDING" : "PERCEPTION",
        sourceId: source.id,
      },
    });
  }

  private async commitF931Rows(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: {
      id: string;
      periodId: string;
      rows: Array<{
        id: string;
        position: number;
        status: string;
        normalized: Prisma.JsonValue;
      }>;
    },
  ) {
    const existing = await tx.f931Run.findUnique({ where: { importBatchId: batch.id } });
    if (existing) return batch.rows.length;

    const rows = batch.rows.map((row) => {
      const normalized = (row.normalized ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        position: row.position,
        cuit: normalized["cuit"] as string,
        remuneration: new Prisma.Decimal(normalized["remuneration"] as string),
        deduction: new Prisma.Decimal(normalized["deduction"] as string),
        netRemuneration: new Prisma.Decimal(normalized["netRemuneration"] as string),
      };
    });
    const totalRemuneration = rows.reduce(
      (sum, row) => sum.plus(row.remuneration),
      new Prisma.Decimal(0),
    );
    const deduction = rows.reduce(
      (sum, row) => sum.plus(row.deduction),
      new Prisma.Decimal(0),
    );
    const netRemuneration = rows.reduce(
      (sum, row) => sum.plus(row.netRemuneration),
      new Prisma.Decimal(0),
    );
    const hash = taxHash({
      batchId: batch.id,
      periodId: batch.periodId,
      rows: rows.map((row) => ({
        position: row.position,
        cuit: row.cuit,
        remuneration: row.remuneration.toFixed(4),
        deduction: row.deduction.toFixed(4),
        netRemuneration: row.netRemuneration.toFixed(4),
      })),
    });

    const run = await tx.f931Run.create({
      data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        periodId: batch.periodId,
        importBatchId: batch.id,
        totalRemuneration,
        deduction,
        netRemuneration,
        hash,
        lines: {
          create: rows.map((row) => ({
            firmId: ctx.firmId,
            clientId: ctx.clientId!,
            cuit: row.cuit,
            remuneration: row.remuneration,
            deduction: row.deduction,
            netRemuneration: row.netRemuneration,
            position: row.position,
          })),
        },
      },
    });

    await tx.importRow.updateMany({
      where: { batchId: batch.id },
      data: { status: "COMMITTED", sourceType: "F931_RUN", sourceId: run.id },
    });
    return rows.length;
  }

  /**
   * G2-04: crea un voucher manual con componentes (para documentos/OCR).
   */
  async createVoucher(
    ctx: TenantContext,
    input: {
      clientId: string;
      direction: "PURCHASE" | "SALE";
      type: string;
      letter?: string;
      pointOfSale: number;
      number: number;
      issuerCuit: string;
      receiverCuit: string;
      issuedOn: string;
      currency?: string;
      exchangeRate?: string;
      total: string;
      documentId?: string;
      periodId?: string;
      components: { concept: string; base: string; rate?: string; amount: string }[];
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const hash = taxHash({
        firmId: ctx.firmId,
        clientId: input.clientId,
        direction: input.direction,
        type: input.type,
        pointOfSale: input.pointOfSale,
        number: input.number,
        issuerCuit: input.issuerCuit,
        receiverCuit: input.receiverCuit,
        issuedOn: input.issuedOn,
        total: input.total,
      });

      return tx.fiscalVoucher.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          direction: input.direction,
          type: input.type,
          ...(input.letter ? { letter: input.letter } : {}),
          pointOfSale: input.pointOfSale,
          number: input.number,
          issuerCuit: input.issuerCuit,
          receiverCuit: input.receiverCuit,
          issuedOn: new Date(input.issuedOn),
          currency: input.currency ?? "ARS",
          ...(input.exchangeRate ? { exchangeRate: new Prisma.Decimal(input.exchangeRate) } : {}),
          total: new Prisma.Decimal(input.total),
          status: "DRAFT",
          version: 1,
          hash,
          ...(input.documentId ? { documentId: input.documentId } : {}),
          ...(input.periodId ? { periodId: input.periodId } : {}),
          createdByUserId: ctx.userId,
          components: {
            create: input.components.map((c) => ({
              firmId: ctx.firmId,
              clientId: input.clientId,
              concept: c.concept,
              base: new Prisma.Decimal(c.base),
              ...(c.rate ? { rate: new Prisma.Decimal(c.rate) } : {}),
              amount: new Prisma.Decimal(c.amount),
            })),
          },
        },
        include: { components: true },
      });
    });
  }

  /**
   * G2-09: revisión independiente de vouchers (maker-checker).
   * El revisor no puede ser el creador.
   */
  /** Envía un voucher a revisión (DRAFT → IN_REVIEW). */
  async submitVoucherForReview(ctx: TenantContext, voucherId: string) {
    return withTenantContext(ctx, async (tx) => {
      const voucher = await tx.fiscalVoucher.findFirst({
        where: { id: voucherId, firmId: ctx.firmId },
      });
      if (!voucher) throw new ImportError("VOUCHER_NOT_FOUND", "Comprobante no encontrado");
      if (voucher.status !== "DRAFT") {
        throw new ImportError("VOUCHER_IMMUTABLE", `El comprobante está en estado ${voucher.status}`);
      }
      return tx.fiscalVoucher.update({
        where: { id: voucherId },
        data: { status: "IN_REVIEW" },
      });
    });
  }

  /** Aprueba un voucher (IN_REVIEW o DRAFT → APPROVED, maker-checker). */
  async approveVoucher(ctx: TenantContext, voucherId: string) {
    return withTenantContext(ctx, async (tx) => {
      const voucher = await tx.fiscalVoucher.findFirst({
        where: { id: voucherId, firmId: ctx.firmId },
      });
      if (!voucher) throw new ImportError("VOUCHER_NOT_FOUND", "Comprobante no encontrado");
      if (voucher.status !== "IN_REVIEW" && voucher.status !== "DRAFT") {
        throw new ImportError("VOUCHER_IMMUTABLE", `El comprobante está en estado ${voucher.status}`);
      }
      if (voucher.createdByUserId === ctx.userId) {
        throw new ImportError(
          "INVALID_TRANSITION",
          "El preparador no puede revisar su propio comprobante (maker-checker)",
        );
      }
      return tx.fiscalVoucher.update({
        where: { id: voucherId },
        data: {
          status: "APPROVED",
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
          approvedByUserId: ctx.userId,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
    });
  }

  /** Rechaza un voucher (IN_REVIEW o DRAFT → REJECTED, maker-checker). */
  async rejectVoucher(ctx: TenantContext, voucherId: string, _comment?: string) {
    return withTenantContext(ctx, async (tx) => {
      const voucher = await tx.fiscalVoucher.findFirst({
        where: { id: voucherId, firmId: ctx.firmId },
      });
      if (!voucher) throw new ImportError("VOUCHER_NOT_FOUND", "Comprobante no encontrado");
      if (voucher.status !== "IN_REVIEW" && voucher.status !== "DRAFT") {
        throw new ImportError("VOUCHER_IMMUTABLE", `El comprobante está en estado ${voucher.status}`);
      }
      if (voucher.createdByUserId === ctx.userId) {
        throw new ImportError(
          "INVALID_TRANSITION",
          "El preparador no puede revisar su propio comprobante (maker-checker)",
        );
      }
      return tx.fiscalVoucher.update({
        where: { id: voucherId },
        data: {
          status: "REJECTED",
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
        },
      });
    });
  }

  /**
   * Revisa un voucher con decisión booleana (compatibilidad legacy).
   * Para flujos productivos usar submitVoucherForReview/approveVoucher/rejectVoucher.
   */
  async reviewVoucher(ctx: TenantContext, voucherId: string, approve: boolean, _comment?: string) {
    return withTenantContext(ctx, async (tx) => {
      const voucher = await tx.fiscalVoucher.findFirst({
        where: { id: voucherId, firmId: ctx.firmId },
      });
      if (!voucher) throw new ImportError("VOUCHER_NOT_FOUND", "Comprobante no encontrado");
      if (voucher.status !== "DRAFT" && voucher.status !== "IN_REVIEW") {
        throw new ImportError("VOUCHER_IMMUTABLE", `El comprobante está en estado ${voucher.status}`);
      }
      if (voucher.createdByUserId === ctx.userId) {
        throw new ImportError(
          "INVALID_TRANSITION",
          "El preparador no puede revisar su propio comprobante (maker-checker)",
        );
      }

      if (approve) {
        return tx.fiscalVoucher.update({
          where: { id: voucherId },
          data: {
            status: "APPROVED",
            reviewedByUserId: ctx.userId,
            reviewedAt: new Date(),
            approvedByUserId: ctx.userId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        });
      }
      return tx.fiscalVoucher.update({
        where: { id: voucherId },
        data: {
          status: "REJECTED",
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
        },
      });
    });
  }

  /** Lista vouchers del cliente con sus componentes. */
  async listVouchers(
    ctx: TenantContext,
    clientId: string,
    direction?: "PURCHASE" | "SALE",
    from?: string,
    to?: string,
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.fiscalVoucher.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          ...(direction ? { direction } : {}),
          ...(from || to
            ? {
                issuedOn: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        include: { components: true, importRow: { select: { position: true, batchId: true } } },
        orderBy: { issuedOn: "desc" },
        take: 500,
      }),
    );
  }

  /** Lista filas de un lote (con estado y errores). */
  async listBatchRows(ctx: TenantContext, batchId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.importRow.findMany({
        where: { firmId: ctx.firmId, clientId: ctx.clientId!, batchId },
        orderBy: { position: "asc" },
        take: 20_000,
      }),
    );
  }

  /** Lista certificados de retención del cliente. */
  async listWithholdings(ctx: TenantContext, clientId: string, from?: string, to?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.withholdingCertificate.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          ...(from || to
            ? {
                issuedOn: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        orderBy: { issuedOn: "desc" },
        take: 500,
      }),
    );
  }

  /** Lista certificados de percepción del cliente. */
  async listPerceptions(ctx: TenantContext, clientId: string, from?: string, to?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.perceptionCertificate.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          ...(from || to
            ? {
                issuedOn: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        orderBy: { issuedOn: "desc" },
        take: 500,
      }),
    );
  }

  /**
   * G2-05: reconcilia los totales del lote contra los vouchers comiteados.
   * Devuelve diferencias de importe para conciliación con la fuente oficial.
   */
  async reconcileBatch(ctx: TenantContext, batchId: string) {
    return withTenantContext(ctx, async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, firmId: ctx.firmId },
      });
      if (!batch) throw new ImportError("BATCH_NOT_FOUND", "Lote no encontrado");

      const rows = await tx.importRow.findMany({
        where: { firmId: ctx.firmId, clientId: ctx.clientId!, batchId, status: "COMMITTED" },
        include: { voucher: { include: { components: true } } },
      });

      const totals = batch.totals as Record<string, unknown> | null;
      const sourceNet = totals && typeof totals["net"] === "string" ? new Prisma.Decimal(totals["net"] as string) : new Prisma.Decimal(0);
      const sourceIva = totals && typeof totals["iva"] === "string" ? new Prisma.Decimal(totals["iva"] as string) : new Prisma.Decimal(0);

      let normalizedNet = new Prisma.Decimal(0);
      let normalizedIva = new Prisma.Decimal(0);
      for (const row of rows) {
        const voucher = row.voucher;
        if (!voucher) continue;
        const neto = voucher.components.find((c) => c.concept === "NETO");
        const iva = voucher.components
          .filter((c) => c.concept.startsWith("IVA_"))
          .reduce((acc, c) => acc.plus(c.amount), new Prisma.Decimal(0));
        if (neto) normalizedNet = normalizedNet.plus(neto.amount);
        normalizedIva = normalizedIva.plus(iva);
      }

      const differences = [
        ...(sourceNet.minus(normalizedNet).isZero()
          ? []
          : [{ concepto: "NETO", fuente: sourceNet.toString(), normalizado: normalizedNet.toString() }]),
        ...(sourceIva.minus(normalizedIva).isZero()
          ? []
          : [{ concepto: "IVA", fuente: sourceIva.toString(), normalizado: normalizedIva.toString() }]),
      ];

      return {
        batchId,
        sourceNet: sourceNet.toString(),
        normalizedNet: normalizedNet.toString(),
        sourceIva: sourceIva.toString(),
        normalizedIva: normalizedIva.toString(),
        differences,
        reconciled: differences.length === 0,
      };
    });
  }
}
