import { Prisma } from "@prisma/client";
import {
  FILING_DECLARATION_DOCUMENT_CATEGORY,
  FILING_DECLARATION_TOLERANCE,
  type DeclarationCreditLotResult,
  type TaxFilingCreditDetailItem,
  type TaxFilingDeclarationBody,
  type TaxFilingDeclarationWarning,
} from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { creditOriginProblem, type CreditOriginProblem } from "./workpaper-service.js";
import {
  aplicarLotesDeclaracion,
  CreditLotError,
  planificarLotesDeclaracion,
} from "./declaration-credit-lots.js";

/**
 * Declaración jurada (DJ) de una presentación FILED (corte 5a, D-DJ2). Reglas:
 * (a) la presentación existe, es del cliente y del estudio y está FILED;
 * (b) el documento es del mismo estudio y cliente, está READY o APPLIED y su
 *     categoría es DECLARACION_JURADA;
 * (c) una presentación de liquidación SUPERSEDED no admite DJ;
 * (d) cargar de nuevo reemplaza la anterior y deja auditoría con el valor previo.
 * Las advertencias de diferencia no bloquean.
 * Corte 6a: la misma transacción genera los saldos del libro (saldosGenerados): IVA técnico y
 * libre, y saldo a favor del detalle del propio impuesto y régimen (declaration-credit-lots.ts).
 */

export type FilingDeclarationErrorCode =
  | "FILING_NOT_FOUND"
  | "FILING_NOT_FILED"
  | "FILING_SETTLEMENT_SUPERSEDED"
  | "DECLARATION_DOCUMENT_NOT_FOUND"
  | "DECLARATION_DOCUMENT_NOT_READY"
  | "DECLARATION_DOCUMENT_WRONG_CATEGORY"
  | "DECLARATION_CREDIT_TAX_NOT_FOUND"
  | "DECLARATION_CREDIT_IVA_NOT_ALLOWED"
  | "DECLARATION_CREDIT_REGIME_NOT_OF_TAX"
  | "DECLARATION_CREDIT_CM_REQUIRES_JURISDICTION"
  | "DECLARATION_CREDIT_JURISDICTION_MISMATCH"
  | "DECLARATION_CREDIT_JURISDICTION_NOT_ACTIVE"
  | "DECLARATION_CREDIT_ALREADY_USED";

export class FilingDeclarationError extends Error {
  readonly code: FilingDeclarationErrorCode;
  readonly httpStatus: number;
  readonly path: string[];

  constructor(
    code: FilingDeclarationErrorCode,
    message: string,
    httpStatus: number,
    path: string[],
  ) {
    super(message);
    this.name = "FilingDeclarationError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.path = path;
  }
}

export interface RecordDeclarationInput extends TaxFilingDeclarationBody {
  clientId: string;
  obligationId: string;
  filingId: string;
}

/** Saldos finales de la liquidación que la DJ debe reflejar (cuando la liquidación los informa). */
function settlementBalance(
  totals: Record<string, string> | null,
  key: string,
): Prisma.Decimal | null {
  if (!totals || !(key in totals)) return null;
  return new Prisma.Decimal(totals[key] ?? "0");
}

/** Diferencias que informan al usuario sin bloquear: total a pagar frente al presentado y saldos frente a la liquidación. */
export function declarationWarnings(input: {
  totalAPagar: string;
  saldoFavorTecnico: string;
  saldoLibreDisponibilidad: string;
  amountFiled: Prisma.Decimal;
  settlementTotals: Record<string, string> | null;
}): TaxFilingDeclarationWarning[] {
  const tolerance = new Prisma.Decimal(FILING_DECLARATION_TOLERANCE);
  const warnings: TaxFilingDeclarationWarning[] = [];
  const totalAPagar = new Prisma.Decimal(input.totalAPagar);
  if (totalAPagar.minus(input.amountFiled).abs().greaterThan(tolerance)) {
    warnings.push({
      code: "TOTAL_A_PAGAR_DISTINTO_DE_PRESENTADO",
      field: "totalAPagar",
      message: `totalAPagar: la declaración jurada informa ${totalAPagar.toFixed(2)} y la presentación registró ${input.amountFiled.toFixed(2)}. Revisá cuál es el importe a pagar.`,
    });
  }
  const tecnico = settlementBalance(input.settlementTotals, "SALDO_TECNICO_AFTER");
  const saldoTecnico = new Prisma.Decimal(input.saldoFavorTecnico);
  if (tecnico && saldoTecnico.minus(tecnico).abs().greaterThan(tolerance)) {
    warnings.push({
      code: "SALDO_TECNICO_DISTINTO_DE_LIQUIDACION",
      field: "saldoFavorTecnico",
      message: `saldoFavorTecnico: la declaración jurada informa ${saldoTecnico.toFixed(2)} y la liquidación cierra con ${tecnico.toFixed(2)}. Revisá el saldo a favor técnico antes de arrastrarlo.`,
    });
  }
  const libre = settlementBalance(input.settlementTotals, "SALDO_LIBRE_AFTER");
  const saldoLibre = new Prisma.Decimal(input.saldoLibreDisponibilidad);
  if (libre && saldoLibre.minus(libre).abs().greaterThan(tolerance)) {
    warnings.push({
      code: "SALDO_LIBRE_DISTINTO_DE_LIQUIDACION",
      field: "saldoLibreDisponibilidad",
      message: `saldoLibreDisponibilidad: la declaración jurada informa ${saldoLibre.toFixed(2)} y la liquidación cierra con ${libre.toFixed(2)}. Revisá la disponibilidad libre antes de arrastrarla.`,
    });
  }
  return warnings;
}

/** Ítem del detalle tal como se guarda en tax_filings.saldosFavorDetalle (importes con 4 decimales). */
type StoredCreditDetailItem = {
  taxTypeId: string;
  regimeId: string | null;
  jurisdictionId: string | null;
  amount: string;
};

/** Código, campo y motivo en la DJ para cada problema de origen (creditOriginProblem). */
const CREDIT_ORIGIN_DECLARATION_ERRORS: Record<
  CreditOriginProblem,
  { code: FilingDeclarationErrorCode; campo: "regimeId" | "jurisdictionId"; motivo: string }
> = {
  REGIME_NOT_OF_TAX: {
    code: "DECLARATION_CREDIT_REGIME_NOT_OF_TAX",
    campo: "regimeId",
    motivo: "el régimen no corresponde al impuesto del saldo. Elegí un régimen de ese impuesto.",
  },
  CM_REQUIRES_JURISDICTION: {
    code: "DECLARATION_CREDIT_CM_REQUIRES_JURISDICTION",
    campo: "jurisdictionId",
    motivo: "el saldo de Convenio Multilateral requiere una jurisdicción.",
  },
  JURISDICTION_MISMATCH: {
    code: "DECLARATION_CREDIT_JURISDICTION_MISMATCH",
    campo: "jurisdictionId",
    motivo: "la jurisdicción no coincide con el régimen del saldo.",
  },
  JURISDICTION_NOT_ACTIVE: {
    code: "DECLARATION_CREDIT_JURISDICTION_NOT_ACTIVE",
    campo: "jurisdictionId",
    motivo: "la jurisdicción no existe o está inactiva. Elegí una jurisdicción activa.",
  },
};

/**
 * Valida cada ítem del detalle (D13-4 a): el impuesto existe y no es IVA (sus saldos tienen campos
 * propios) y el origen cumple las reglas del saldo inicial. Devuelve lo que se guarda, o null sin
 * detalle. Corta en el primer ítem inválido e indica el campo y el motivo (P4).
 */
async function validarSaldosFavorDetalle(
  tx: Prisma.TransactionClient,
  items: TaxFilingCreditDetailItem[],
): Promise<StoredCreditDetailItem[] | null> {
  if (items.length === 0) return null;
  const iva = await tx.taxType.findUnique({ where: { code: "IVA" }, select: { id: true } });
  const guardados: StoredCreditDetailItem[] = [];
  for (const [index, item] of items.entries()) {
    const ruta = (campo: string) => ["saldosFavorDetalle", String(index), campo];
    const impuesto = await tx.taxType.findUnique({
      where: { id: item.taxTypeId },
      select: { id: true },
    });
    if (!impuesto) {
      throw new FilingDeclarationError(
        "DECLARATION_CREDIT_TAX_NOT_FOUND",
        `saldosFavorDetalle.${index}.taxTypeId: el impuesto del saldo no existe. Elegí un impuesto del catálogo.`,
        422,
        ruta("taxTypeId"),
      );
    }
    if (iva && impuesto.id === iva.id) {
      throw new FilingDeclarationError(
        "DECLARATION_CREDIT_IVA_NOT_ALLOWED",
        `saldosFavorDetalle.${index}.taxTypeId: el IVA se declara con sus saldos técnico y libre, no en el detalle.`,
        422,
        ruta("taxTypeId"),
      );
    }
    const problema = await creditOriginProblem(tx, item);
    if (problema) {
      const error = CREDIT_ORIGIN_DECLARATION_ERRORS[problema];
      throw new FilingDeclarationError(
        error.code,
        `saldosFavorDetalle.${index}.${error.campo}: ${error.motivo}`,
        422,
        ruta(error.campo),
      );
    }
    guardados.push({
      taxTypeId: item.taxTypeId,
      regimeId: item.regimeId ?? null,
      jurisdictionId: item.jurisdictionId ?? null,
      amount: new Prisma.Decimal(item.amount).toFixed(4),
    });
  }
  return guardados;
}

/** Traduce el error de los lotes al de la DJ (mismo código, mismo estado HTTP y motivo). */
async function aplicarSaldos(
  tx: Prisma.TransactionClient,
  args: Parameters<typeof aplicarLotesDeclaracion>[1],
): Promise<DeclarationCreditLotResult[]> {
  try {
    return await aplicarLotesDeclaracion(tx, args);
  } catch (err) {
    if (err instanceof CreditLotError) {
      throw new FilingDeclarationError(
        err.code as FilingDeclarationErrorCode,
        err.message,
        err.httpStatus,
        err.path,
      );
    }
    throw err;
  }
}

export class FilingDeclarationService {
  async recordDeclaration(ctx: TenantContext, input: RecordDeclarationInput) {
    return withTenantContext(ctx, async (tx) => {
      const filing = await tx.taxFiling.findFirst({
        where: {
          id: input.filingId,
          firmId: ctx.firmId,
          clientId: input.clientId,
          obligationId: input.obligationId,
        },
      });
      if (!filing) {
        throw new FilingDeclarationError(
          "FILING_NOT_FOUND",
          "La presentación no existe en esta obligación del cliente",
          404,
          ["filingId"],
        );
      }
      if (filing.status !== "FILED") {
        throw new FilingDeclarationError(
          "FILING_NOT_FILED",
          "Falta: presentación con acuse. Registrá la presentación con su acuse y después cargá la declaración jurada.",
          409,
          ["filingId"],
        );
      }
      const settlement = filing.settlementId
        ? await tx.taxSettlement.findUnique({
            where: { id: filing.settlementId },
            select: { status: true, totals: true, regimeId: true, jurisdictionId: true },
          })
        : null;
      if (settlement?.status === "SUPERSEDED") {
        throw new FilingDeclarationError(
          "FILING_SETTLEMENT_SUPERSEDED",
          "La presentación corresponde a una liquidación reemplazada. Su declaración jurada no cuenta para la versión vigente: cargala en la presentación de la versión nueva.",
          409,
          ["filingId"],
        );
      }
      const document = await tx.document.findFirst({
        where: { id: input.declarationDocumentId, firmId: ctx.firmId, clientId: input.clientId },
        select: { status: true, category: true },
      });
      if (!document) {
        throw new FilingDeclarationError(
          "DECLARATION_DOCUMENT_NOT_FOUND",
          "No encontramos el documento en este cliente. Usá la declaración jurada cargada para este cliente.",
          422,
          ["declarationDocumentId"],
        );
      }
      if (document.status !== "READY" && document.status !== "APPLIED") {
        throw new FilingDeclarationError(
          "DECLARATION_DOCUMENT_NOT_READY",
          "El documento todavía no está listo. Falta: que termine de procesarse. Volvé a cargar la declaración jurada cuando esté listo.",
          422,
          ["declarationDocumentId"],
        );
      }
      if (document.category !== FILING_DECLARATION_DOCUMENT_CATEGORY) {
        throw new FilingDeclarationError(
          "DECLARATION_DOCUMENT_WRONG_CATEGORY",
          "El documento no tiene la categoría Declaración jurada. Elegí un documento con esa categoría.",
          422,
          ["declarationDocumentId"],
        );
      }

      const detalle = await validarSaldosFavorDetalle(tx, input.saldosFavorDetalle ?? []);

      const obligacion = await tx.taxObligation.findUniqueOrThrow({
        where: { id: filing.obligationId },
        include: { regime: { select: { taxTypeId: true, jurisdictionId: true } } },
      });
      // P2: IVA se reconoce por id del catálogo, no por el texto del código.
      const iva = await tx.taxType.findUnique({ where: { code: "IVA" }, select: { id: true } });
      // Una liquidación con versión posterior (supersedesId) ya no genera saldos: la DJ vigente es la de la versión nueva.
      const sucesora = filing.settlementId
        ? await tx.taxSettlement.findFirst({
            where: { firmId: ctx.firmId, supersedesId: filing.settlementId },
            select: { id: true },
          })
        : null;
      const plan = planificarLotesDeclaracion({
        obligacion: {
          taxTypeId: obligacion.regime.taxTypeId,
          regimeId: obligacion.regimeId,
          jurisdictionId: obligacion.regime.jurisdictionId,
          esIva: iva !== null && obligacion.regime.taxTypeId === iva.id,
        },
        liquidacion: settlement
          ? { regimeId: settlement.regimeId, jurisdictionId: settlement.jurisdictionId }
          : null,
        saldoFavorTecnico: input.saldoFavorTecnico,
        saldoLibreDisponibilidad: input.saldoLibreDisponibilidad,
        saldosFavorDetalle: input.saldosFavorDetalle,
        reemplazada: sucesora !== null,
      });
      const saldosGenerados = await aplicarSaldos(tx, {
        firmId: ctx.firmId,
        clientId: input.clientId,
        userId: ctx.userId,
        actorKind: ctx.actorKind,
        filingId: filing.id,
        settlementId: filing.settlementId,
        periodId: obligacion.periodId,
        plan,
      });

      const previous = filing.declarationDocumentId
        ? {
            declarationDocumentId: filing.declarationDocumentId,
            impuestoDeterminado: filing.impuestoDeterminado?.toFixed(4) ?? null,
            saldoFavorTecnico: filing.saldoFavorTecnico?.toFixed(4) ?? null,
            saldoLibreDisponibilidad: filing.saldoLibreDisponibilidad?.toFixed(4) ?? null,
            totalAPagar: filing.totalAPagar?.toFixed(4) ?? null,
            declaredByUserId: filing.declaredByUserId,
            declaredAt: filing.declaredAt?.toISOString() ?? null,
            saldosFavorDetalle: filing.saldosFavorDetalle ?? null,
          }
        : null;

      const updated = await tx.taxFiling.update({
        where: { id: filing.id },
        data: {
          declarationDocumentId: input.declarationDocumentId,
          impuestoDeterminado: new Prisma.Decimal(input.impuestoDeterminado),
          saldoFavorTecnico: new Prisma.Decimal(input.saldoFavorTecnico),
          saldoLibreDisponibilidad: new Prisma.Decimal(input.saldoLibreDisponibilidad),
          totalAPagar: new Prisma.Decimal(input.totalAPagar),
          declaredByUserId: ctx.userId,
          declaredAt: new Date(),
          saldosFavorDetalle: detalle ?? Prisma.DbNull,
        },
      });

      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "FILING_DECLARATION_RECORDED",
          entityType: "TaxFiling",
          entityId: filing.id,
          ...(previous ? { before: previous } : {}),
          after: {
            declarationDocumentId: input.declarationDocumentId,
            impuestoDeterminado: new Prisma.Decimal(input.impuestoDeterminado).toFixed(4),
            saldoFavorTecnico: new Prisma.Decimal(input.saldoFavorTecnico).toFixed(4),
            saldoLibreDisponibilidad: new Prisma.Decimal(input.saldoLibreDisponibilidad).toFixed(4),
            totalAPagar: new Prisma.Decimal(input.totalAPagar).toFixed(4),
            saldosFavorDetalle: detalle,
          },
        },
      });

      const warnings = declarationWarnings({
        totalAPagar: input.totalAPagar,
        saldoFavorTecnico: input.saldoFavorTecnico,
        saldoLibreDisponibilidad: input.saldoLibreDisponibilidad,
        amountFiled: filing.amountFiled,
        settlementTotals: (settlement?.totals ?? null) as Record<string, string> | null,
      });
      return { filing: updated, warnings, saldosGenerados };
    });
  }
}
