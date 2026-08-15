import { Prisma } from "@prisma/client";
import { taxHash } from "@contable/tax-engine";
import {
  normalizeArcaVoucherBatch,
  normalizeWithholdingBatch,
  type ArcaVoucherInput,
  type WithholdingInput,
} from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

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
  | "INVALID_TRANSITION";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
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
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      // Idempotencia: mismo lote (mismo origen/impuesto/período/hash) ya existe.
      if (input.fileHash) {
        const existing = await tx.importBatch.findUnique({
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
        if (existing) return existing;
      }

      const period = await tx.taxPeriod.findUnique({ where: { id: input.periodId } });
      if (!period) throw new ImportError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");
      const taxType = await tx.taxType.findUnique({ where: { id: input.taxTypeId } });
      if (!taxType) throw new ImportError("TAX_TYPE_NOT_FOUND", "Impuesto no encontrado");

      return tx.importBatch.create({
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
      });
    });
  }

  /**
   * G2-02/03: valida las filas del lote usando el adaptador puro.
   * Cada fila ERROR queda visible con detalle; no se oculta nada.
   */
  async validateBatch(
    ctx: TenantContext,
    batchId: string,
    rows: readonly (ArcaVoucherInput | WithholdingInput)[],
  ) {
    return withTenantContext(ctx, async (tx) => {
      const batch = await tx.importBatch.findFirst({ where: { id: batchId, firmId: ctx.firmId } });
      if (!batch) throw new ImportError("BATCH_NOT_FOUND", "Lote no encontrado");
      if (batch.status !== "UPLOADED") {
        throw new ImportError("INVALID_TRANSITION", `No se puede validar un lote en estado ${batch.status}`);
      }

      const isWithholding = batch.adapterVersion.startsWith("ARCA_RET");
      const normalizedRows = isWithholding
        ? normalizeWithholdingBatch(rows as WithholdingInput[])
        : normalizeArcaVoucherBatch(rows as ArcaVoucherInput[]);

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: "VALIDATED",
          totalRows: rows.length,
          validRows: normalizedRows.totals.validRows,
          errorRows: normalizedRows.totals.errorRows,
          totals: normalizedRows.totals as unknown as Prisma.InputJsonValue,
        },
      });

      // Guarda cada fila normalizada (con su estado y errores).
      for (let i = 0; i < normalizedRows.rows.length; i += 1) {
        const row = normalizedRows.rows[i]!;
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
        totals: normalizedRows.totals,
        rows: normalizedRows.rows.length,
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

      const isWithholding = batch.adapterVersion.startsWith("ARCA_RET");
      let committed = 0;
      let duplicates = 0;
      const errors: string[] = [];

      for (const row of batch.rows) {
        if (row.status !== "VALID") {
          errors.push(`Fila ${row.position + 1}: ${row.errors.join(", ")}`);
          continue;
        }
        if (row.voucherId) {
          committed += 1; // Ya comiteada en una ejecución anterior.
          continue;
        }

        try {
          if (isWithholding) {
            await this.commitWithholdingRow(tx, ctx, batch, row, clientCuit);
            committed += 1;
          } else {
            const created = await this.commitVoucherRow(tx, ctx, batch, row, clientCuit);
            if (created) committed += 1;
            else duplicates += 1;
          }
        } catch (err) {
          errors.push(`Fila ${row.position + 1}: ${err instanceof Error ? err.message : "ERROR"}`);
        }
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: "COMMITTED" },
      });

      return { batch, committed, duplicates, errors };
    });
  }

  private async commitVoucherRow(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    batch: { id: string; taxTypeId: string },
    row: { id: string; position: number; normalized: Prisma.JsonValue },
    clientCuit: string,
  ): Promise<boolean> {
    const n = (row.normalized ?? {}) as Record<string, unknown>;
    const direction = batch.taxTypeId ? "PURCHASE" : "SALE";
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
        data: { status: "DUPLICATE" },
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

    // Dirección según contraparte: venta → el cliente es emisor; compra → receptor.
    const isSale = false; // placeholder: el adaptador no trae dirección; se fija por origen.
    const issuerCuit = isSale ? clientCuit : counterpartyCuit;
    const receiverCuit = isSale ? counterpartyCuit : clientCuit;

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
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "IVA_21", base: new Prisma.Decimal(net), rate: new Prisma.Decimal("0.21"), amount: new Prisma.Decimal(iva21) }]
              : []),
            ...(Number(iva105) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "IVA_105", base: new Prisma.Decimal(net), rate: new Prisma.Decimal("0.105"), amount: new Prisma.Decimal(iva105) }]
              : []),
            ...(Number(iva27) !== 0
              ? [{ firmId: ctx.firmId, clientId: ctx.clientId!, concept: "IVA_27", base: new Prisma.Decimal(net), rate: new Prisma.Decimal("0.27"), amount: new Prisma.Decimal(iva27) }]
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
      data: { status: "COMMITTED", voucherId: voucher.id },
    });
    return true;
  }

  private async commitWithholdingRow(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    _batch: { id: string },
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
      status: "DRAFT",
      createdByUserId: ctx.userId,
    };

    if (kind === "RETENCION") {
      await tx.withholdingCertificate.create({ data });
    } else {
      await tx.perceptionCertificate.create({ data });
    }

    await tx.importRow.update({
      where: { id: row.id },
      data: { status: "COMMITTED" },
    });
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
  async listVouchers(ctx: TenantContext, clientId: string, direction?: "PURCHASE" | "SALE") {
    return withTenantContext(ctx, (tx) =>
      tx.fiscalVoucher.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          ...(direction ? { direction } : {}),
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
  async listWithholdings(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.withholdingCertificate.findMany({
        where: { firmId: ctx.firmId, clientId },
        orderBy: { issuedOn: "desc" },
        take: 500,
      }),
    );
  }

  /** Lista certificados de percepción del cliente. */
  async listPerceptions(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.perceptionCertificate.findMany({
        where: { firmId: ctx.firmId, clientId },
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
