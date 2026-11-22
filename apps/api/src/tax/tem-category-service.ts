import { Prisma } from "@prisma/client";
import { taxEngineKeyForVersion } from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Categoría anual del TEM (Ordenanza 4.536 y categorización anual de la DIM).
 *
 * El contador indica una vez por año la categoría del cliente y la liquidación
 * mensual toma el mínimo de esa categoría. Los mínimos por categoría y año son
 * un catálogo (`tem_category_minimums`): el código no conoce ningún importe.
 */

export type TemCategoryErrorCode = "TEM_CATEGORY_UNKNOWN" | "TEM_CATEGORY_YEAR_WITHOUT_MINIMUMS";

/** Error con el campo y el motivo (P4): la ruta lo devuelve como `details.path`. */
export class TemCategoryError extends Error {
  readonly code: TemCategoryErrorCode;
  readonly path: string[];
  readonly httpStatus = 422;
  constructor(code: TemCategoryErrorCode, message: string, path: string[]) {
    super(message);
    this.name = "TemCategoryError";
    this.code = code;
    this.path = path;
  }
}

export interface TemCategoryOption {
  category: string;
  label: string;
  /** Mínimo mensual del año, con dos decimales. */
  minimum: string;
}

/** Claves del catálogo de sistema que identifican al TEM: familia de cálculo y motores. */
const TEM_FAMILY_KEY = "TEM";
const TEM_ENGINE_KEYS: ReadonlySet<string> = new Set(["tem-smt", "tem-smt-legacy"]);

export interface TemCategoryState {
  year: number;
  category: string | null;
  label: string | null;
  minimum: string | null;
  /** Categorías que ofrece el catálogo para el año, en el orden de la DIM. */
  options: TemCategoryOption[];
  /** Regímenes con inscripción vigente del cliente cuyo mínimo sale de esta categoría (por id). */
  regimeIds: string[];
}

/** Qué mínimo corresponde a un cliente en un año (lo usa la liquidación). */
export type TemMinimumResolution =
  | { kind: "CATEGORY"; year: number; category: string; label: string; amount: Prisma.Decimal }
  | { kind: "MISSING"; year: number }
  | { kind: "NO_CATALOG"; year: number };

/** Texto único del faltante: lo ven la cobertura del período y el bloqueo del cálculo. */
export function temCategoryMissingText(year: number): string {
  return `Falta la categoría TEM ${year}`;
}

export function temCategoryMissingGuidance(year: number): string {
  return `${temCategoryMissingText(year)}: elegila en Configuración fiscal, Regímenes, en la fila del TEM, para calcular el mínimo mensual.`;
}

function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} o ${labels[labels.length - 1]}`;
}

type Tx = Prisma.TransactionClient;

async function catalogForYear(tx: Tx, year: number) {
  const rows = await tx.temCategoryMinimum.findMany({
    where: { year },
    orderBy: [{ sortOrder: "asc" }, { category: "asc" }],
  });
  return rows.map((row): TemCategoryOption => ({
    category: row.category,
    label: row.label,
    minimum: row.amount.toFixed(2),
  }));
}

export class TemCategoryService {
  /** Categoría elegida para el año (si la hay) y las que ofrece el catálogo. */
  async get(
    ctx: TenantContext,
    input: { clientId: string; year: number },
  ): Promise<TemCategoryState> {
    return withTenantContext(ctx, (tx) => this.stateWithTransaction(tx, ctx.firmId, input));
  }

  /** Elige o cambia la categoría del año: una sola fila por cliente y año. */
  async set(
    ctx: TenantContext,
    input: { clientId: string; year: number; category: string },
  ): Promise<TemCategoryState> {
    return withTenantContext(ctx, async (tx) => {
      const options = await catalogForYear(tx, input.year);
      if (options.length === 0) {
        throw new TemCategoryError(
          "TEM_CATEGORY_YEAR_WITHOUT_MINIMUMS",
          `No hay mínimos del TEM cargados para ${input.year}: todavía no se puede elegir la categoría de ese año.`,
          ["year"],
        );
      }
      const wanted = input.category.trim().toUpperCase();
      const chosen = options.find((option) => option.category === wanted);
      if (!chosen) {
        throw new TemCategoryError(
          "TEM_CATEGORY_UNKNOWN",
          `La categoría "${input.category.trim()}" no existe para ${input.year}. Elegí una de ${listLabels(options.map((option) => option.label))}.`,
          ["category"],
        );
      }
      await tx.clientTemCategory.upsert({
        where: {
          firmId_clientId_year: { firmId: ctx.firmId, clientId: input.clientId, year: input.year },
        },
        update: { category: chosen.category },
        create: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          year: input.year,
          category: chosen.category,
          ...(ctx.userId ? { createdByUserId: ctx.userId } : {}),
        },
      });
      return this.stateWithTransaction(tx, ctx.firmId, {
        clientId: input.clientId,
        year: input.year,
      });
    });
  }

  /**
   * Mínimo mensual del TEM del cliente para el año del período.
   * `NO_CATALOG`: el año no tiene mínimos cargados (el paquete de reglas decide).
   * `MISSING`: el año tiene catálogo y el cliente no eligió categoría.
   */
  async resolveMinimum(
    tx: Tx,
    input: { firmId: string; clientId: string; year: number },
  ): Promise<TemMinimumResolution> {
    const catalogSize = await tx.temCategoryMinimum.count({ where: { year: input.year } });
    if (catalogSize === 0) return { kind: "NO_CATALOG", year: input.year };
    const chosen = await tx.clientTemCategory.findUnique({
      where: {
        firmId_clientId_year: { firmId: input.firmId, clientId: input.clientId, year: input.year },
      },
      include: { minimum: true },
    });
    if (!chosen) return { kind: "MISSING", year: input.year };
    return {
      kind: "CATEGORY",
      year: input.year,
      category: chosen.category,
      label: chosen.minimum.label,
      amount: chosen.minimum.amount,
    };
  }

  private async stateWithTransaction(
    tx: Tx,
    firmId: string,
    input: { clientId: string; year: number },
  ): Promise<TemCategoryState> {
    const options = await catalogForYear(tx, input.year);
    const chosen = await tx.clientTemCategory.findUnique({
      where: { firmId_clientId_year: { firmId, clientId: input.clientId, year: input.year } },
      include: { minimum: true },
    });
    const registrations = await tx.taxRegistration.findMany({
      where: { firmId, clientId: input.clientId, status: "ACTIVE" },
      select: { regimeId: true },
      distinct: ["regimeId"],
    });
    const regimeIds: string[] = [];
    for (const { regimeId } of registrations) {
      if (await this.usesCategory(tx, regimeId)) regimeIds.push(regimeId);
    }
    return {
      year: input.year,
      category: chosen?.category ?? null,
      label: chosen?.minimum.label ?? null,
      minimum: chosen ? chosen.minimum.amount.toFixed(2) : null,
      options,
      regimeIds,
    };
  }

  /**
   * ¿El mínimo mensual del régimen sale de la categoría anual del TEM?
   * Se resuelve por el catálogo de sistema, nunca por el código o el nombre que escribió el
   * usuario: la familia de cálculo del régimen (o la de su impuesto) o el motor de su versión de reglas.
   * Con `period`, el motor es el de la versión que cubre ese período; sin él, el de la última versión.
   */
  async usesCategory(
    tx: Tx,
    regimeId: string,
    period?: { startDate: Date; endDate: Date },
  ): Promise<boolean> {
    const regime = await tx.taxRegime.findUnique({
      where: { id: regimeId },
      select: {
        calcFamily: { select: { key: true } },
        taxType: { select: { defaultFamily: { select: { key: true } } } },
      },
    });
    if (!regime) return false;
    const familyKey = regime.calcFamily?.key ?? regime.taxType.defaultFamily?.key;
    if (familyKey === TEM_FAMILY_KEY) return true;
    const pack = await tx.taxRulePack.findFirst({ where: { regimeId }, select: { id: true } });
    if (!pack) return false;
    const version = await tx.taxRuleVersion.findFirst({
      where: {
        packId: pack.id,
        status: { in: ["ACTIVE", "RETIRED"] },
        ...(period
          ? {
              validFrom: { lte: period.startDate },
              OR: [{ validTo: null }, { validTo: { gte: period.endDate } }],
            }
          : {}),
      },
      orderBy: [{ validFrom: "desc" }, { version: "desc" }],
      select: { engineId: true, engineVersion: true },
    });
    if (!version) return false;
    const engine = version.engineId
      ? await tx.taxEngine.findUnique({
          where: { id: version.engineId },
          select: { engineKey: true },
        })
      : null;
    const engineKey = engine?.engineKey ?? taxEngineKeyForVersion(version.engineVersion);
    return engineKey !== null && engineKey !== undefined && TEM_ENGINE_KEYS.has(engineKey);
  }
}
