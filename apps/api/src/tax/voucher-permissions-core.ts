import type { Prisma } from "@prisma/client";
import {
  CLASES_COMPROBANTE,
  esExento,
  grupoPerfil,
  propuestaPerfil,
  type ClaseComprobante,
  type GrupoPerfil,
  type PermitidoPerfil,
} from "./voucher-profile.js";

/**
 * Tipos de comprobante permitidos por cliente (corte 4B). Las tildes se guardan por año, como la
 * categoría TEM. Sin fila para el año, rige la propuesta de la condición frente al IVA.
 */

type Tx = Prisma.TransactionClient;

export interface PermitidoEfectivo extends PermitidoPerfil {
  /** «GUARDADO» si el estudio tildó ese año; «PROPUESTA» si rige la propuesta por condición. */
  origen: "GUARDADO" | "PROPUESTA";
  condicion: string | null;
}

/** Tildes que rigen para el cliente en el año: las guardadas o, si no hay, la propuesta de su condición. */
export async function loadPerfilPermitido(
  tx: Tx,
  input: { firmId: string; clientId: string; year: number },
): Promise<PermitidoEfectivo> {
  const [saved, profile] = await Promise.all([
    tx.clientVoucherPermission.findUnique({
      where: { firmId_clientId_year: { firmId: input.firmId, clientId: input.clientId, year: input.year } },
    }),
    tx.taxpayerProfileVersion.findFirst({
      where: { firmId: input.firmId, clientId: input.clientId, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: { nationalCondition: true },
    }),
  ]);
  const condicion = profile?.nationalCondition ?? null;
  if (saved) {
    return {
      origen: "GUARDADO",
      condicion,
      clases: saved.allowedClasses.filter((clase): clase is ClaseComprobante =>
        (CLASES_COMPROBANTE as readonly string[]).includes(clase),
      ),
      exentos: saved.exemptAllowed,
    };
  }
  return { origen: "PROPUESTA", condicion, ...propuestaPerfil(condicion) };
}

/** Comprobantes de venta de la lista que no corresponden al perfil, agrupados por motivo. Los aceptados quedan fuera. */
export function gruposDeComprobantes<
  T extends {
    direction: string;
    profileAcceptedAt: Date | null;
    voucher: {
      type: string;
      letter: string | null;
      components: ReadonlyArray<{ concept: string; amount: unknown }>;
      importRow?: { raw: unknown } | null;
    };
  },
>(rows: readonly T[], permitido: PermitidoPerfil): Map<GrupoPerfil, T[]> {
  const grupos = new Map<GrupoPerfil, T[]>();
  for (const row of rows) {
    if (row.direction !== "SALE" || row.profileAcceptedAt !== null) continue;
    const grupo = grupoPerfil(
      {
        type: row.voucher.type,
        letter: row.voucher.letter,
        raw: row.voucher.importRow?.raw ?? null,
        exento: esExento(row.voucher.components),
      },
      permitido,
    );
    if (grupo === null) continue;
    grupos.set(grupo, [...(grupos.get(grupo) ?? []), row]);
  }
  return grupos;
}
