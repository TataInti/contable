import { arcaTipoClase } from "@contable/tax-engine";

/**
 * Tipos de comprobante que el cliente puede emitir (corte 4B).
 *
 * Catálogo de sistema: la clase de cada comprobante sale de su letra o de su código oficial de
 * ARCA (atributos fiables), nunca del texto que escribió el usuario. El estudio solo tilda clases
 * de este catálogo. Las vigencias se guardan por año, igual que la categoría TEM.
 */

export const CLASES_COMPROBANTE = [
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
  "FACTURA_E",
  "NOTAS_A",
  "NOTAS_B",
  "NOTAS_C",
  "NOTAS_E",
] as const;

export type ClaseComprobante = (typeof CLASES_COMPROBANTE)[number];

export const CLASE_LABELS: Record<ClaseComprobante, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  FACTURA_E: "Factura E (exportación)",
  NOTAS_A: "Notas de crédito y débito A",
  NOTAS_B: "Notas de crédito y débito B",
  NOTAS_C: "Notas de crédito y débito C",
  NOTAS_E: "Notas de crédito y débito E (exportación)",
};

export const GRUPO_EXENTO = "EXENTO";
export const GRUPO_TIPO_NO_RECONOCIDO = "TIPO_NO_RECONOCIDO";

export type GrupoPerfil = ClaseComprobante | typeof GRUPO_EXENTO | typeof GRUPO_TIPO_NO_RECONOCIDO;

export const GRUPO_LABELS: Record<GrupoPerfil, string> = {
  FACTURA_A: "Facturas A",
  FACTURA_B: "Facturas B",
  FACTURA_C: "Facturas C",
  FACTURA_E: "Facturas E",
  NOTAS_A: "Notas de crédito y débito A",
  NOTAS_B: "Notas de crédito y débito B",
  NOTAS_C: "Notas de crédito y débito C",
  NOTAS_E: "Notas de crédito y débito E",
  EXENTO: "Comprobantes exentos",
  TIPO_NO_RECONOCIDO: "Tipo no reconocido",
};

/** Prefijo del código del control materializado: `PERFIL_COMPROBANTE:<grupo>`. */
export const PREFIJO_CONTROL_PERFIL = "PERFIL_COMPROBANTE:";

export interface PermitidoPerfil {
  clases: readonly ClaseComprobante[];
  exentos: boolean;
}

/** Letra de las facturas y notas según la tabla oficial de ARCA (A, B, C y E; el resto no tiene clase). */
const LETRA_POR_CODIGO_ARCA: Readonly<Record<number, "A" | "B" | "C" | "E">> = {
  1: "A", 2: "A", 3: "A",
  6: "B", 7: "B", 8: "B",
  11: "C", 12: "C", 13: "C",
  19: "E", 20: "E", 21: "E",
  201: "A", 202: "A", 203: "A",
  206: "B", 207: "B", 208: "B",
  211: "C", 212: "C", 213: "C",
};

/** Notas de exportación (20 y 21) que la tabla de importación todavía no reconoce como notas. */
const NOTA_POR_CODIGO_EXTRA: Readonly<Record<number, "NC" | "ND">> = { 20: "ND", 21: "NC" };

function codigoArca(value: unknown): number | null {
  const texto = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const digitos = /^\s*(\d+)/.exec(texto)?.[1];
  return digitos === undefined ? null : Number(digitos);
}

/** Código ARCA del renglón original (columna «Tipo» o «Tipo de comprobante») si la importación lo guardó. */
function codigoDesdeRenglon(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const encabezado = key
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (encabezado === "tipo" || encabezado === "tipo de comprobante") {
      const code = codigoArca(value);
      if (code !== null) return code;
    }
  }
  return null;
}

function clasePorCodigo(code: number): "NC" | "ND" | "FACTURA" | null {
  if (NOTA_POR_CODIGO_EXTRA[code]) return NOTA_POR_CODIGO_EXTRA[code] ?? null;
  return arcaTipoClase(code);
}

export interface ComprobanteParaPerfil {
  type: string;
  letter: string | null;
  /** Renglón original de la importación, si lo hay: de ahí sale el código de ARCA de las notas. */
  raw?: unknown;
}

/** Clase del comprobante para el perfil, o null si no se puede determinar (va a «Tipo no reconocido»). */
export function clasePerfil(comprobante: ComprobanteParaPerfil): ClaseComprobante | null {
  const codigo = codigoArca(comprobante.type) ?? codigoDesdeRenglon(comprobante.raw);
  const claseArca = codigo === null ? null : clasePorCodigo(codigo);
  const letraColumna = comprobante.letter?.trim().toUpperCase() ?? "";
  const esNota =
    claseArca === "NC" ||
    claseArca === "ND" ||
    letraColumna === "NC" ||
    letraColumna === "ND" ||
    /NOTA/i.test(comprobante.type);
  const letra =
    letraColumna === "A" || letraColumna === "B" || letraColumna === "C" || letraColumna === "E"
      ? letraColumna
      : codigo === null
        ? null
        : (LETRA_POR_CODIGO_ARCA[codigo] ?? null);
  if (letra === null) return null;
  return `${esNota ? "NOTAS" : "FACTURA"}_${letra}` as ClaseComprobante;
}

/** Hay exento cuando el comprobante trae un componente EXENTO con importe distinto de cero. */
export function esExento(components: ReadonlyArray<{ concept: string; amount: unknown }>): boolean {
  return components.some((component) => {
    if (component.concept !== "EXENTO") return false;
    const importe = Number(String(component.amount));
    return Number.isFinite(importe) && importe !== 0;
  });
}

/** Clases que el catálogo ofrece según la condición frente al IVA (E se ofrece a los dos regímenes). */
export function clasesOfrecidas(condicion: string | null): readonly ClaseComprobante[] {
  if (condicion === "RESPONSABLE_INSCRIPTO") {
    return ["FACTURA_A", "FACTURA_B", "FACTURA_E", "NOTAS_A", "NOTAS_B", "NOTAS_E"];
  }
  if (condicion === "MONOTRIBUTISTA") {
    return ["FACTURA_C", "FACTURA_E", "NOTAS_C", "NOTAS_E"];
  }
  return CLASES_COMPROBANTE;
}

/** Propuesta inicial de tildes por condición. Sin propuesta, el estudio elige. */
export function propuestaPerfil(condicion: string | null): PermitidoPerfil {
  if (condicion === "RESPONSABLE_INSCRIPTO") {
    return { clases: ["FACTURA_A", "FACTURA_B", "NOTAS_A", "NOTAS_B"], exentos: false };
  }
  if (condicion === "MONOTRIBUTISTA") {
    return { clases: ["FACTURA_C", "NOTAS_C"], exentos: false };
  }
  return { clases: [], exentos: false };
}

/**
 * Grupo al que pertenece un comprobante de venta que no corresponde al perfil, o null si corresponde.
 * El tipo tiene prioridad sobre el exento: un comprobante con las dos cosas se cuenta por su tipo.
 */
export function grupoPerfil(
  comprobante: ComprobanteParaPerfil & { exento: boolean },
  permitido: PermitidoPerfil,
): GrupoPerfil | null {
  const clase = clasePerfil(comprobante);
  if (clase === null) return GRUPO_TIPO_NO_RECONOCIDO;
  if (!permitido.clases.includes(clase)) return clase;
  if (comprobante.exento && !permitido.exentos) return GRUPO_EXENTO;
  return null;
}
