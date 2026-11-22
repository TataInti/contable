/**
 * Control de CUIT de un comprobante leído por la IA (brief 4A-2).
 *
 * Función pura: compara el emisor y el receptor que leyó la IA con el CUIT del cliente al que
 * se cargó el documento. En una venta el cliente es el emisor; en una compra, el receptor. Como la
 * Bandeja no guarda el sentido, el cliente se reconoce por su CUIT en cualquiera de los dos lados.
 *
 * Estados:
 * - CORRECTO: el CUIT del cliente figura como emisor o receptor.
 * - OTRO_CLIENTE: el comprobante es de otro CUIT (con sugerencia si es de otro cliente del estudio).
 * - NO_LEIDO: la IA no leyó un lado y el otro no identifica a otro cliente; hay que revisarlo a mano.
 */

export const CUIT_ESTADO = {
  CORRECTO: "CORRECTO",
  OTRO_CLIENTE: "OTRO_CLIENTE",
  NO_LEIDO: "NO_LEIDO",
} as const;

export type CuitEstado = (typeof CUIT_ESTADO)[keyof typeof CUIT_ESTADO];

export interface ClienteDelEstudio {
  id: string;
  legalName: string;
  cuit: string;
}

export interface EvaluacionCuit {
  estado: CuitEstado;
  emisor: string | null;
  receptor: string | null;
  sugerido: ClienteDelEstudio | null;
  /** Texto para el contador. Null cuando el estado es CORRECTO. */
  mensaje: string | null;
}

/** Deja solo los dígitos y devuelve el CUIT si tiene once; si no, null (la IA no lo leyó bien). */
export function normalizarCuit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digitos = value.replace(/\D/g, "");
  return digitos.length === 11 ? digitos : null;
}

/** Muestra el CUIT con guiones (XX-XXXXXXXX-X), como lo escribe el contador. */
export function formatearCuit(cuit: string): string {
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

export function evaluarCuitDocumento(input: {
  clienteNombre: string;
  clienteCuit: string;
  emisor: unknown;
  receptor: unknown;
  /** Otros clientes del mismo estudio a los que el usuario puede acceder. */
  otrosClientes: readonly ClienteDelEstudio[];
}): EvaluacionCuit {
  const cuitCliente = normalizarCuit(input.clienteCuit);
  const emisor = normalizarCuit(input.emisor);
  const receptor = normalizarCuit(input.receptor);
  const base = { emisor, receptor };

  const sugeridoEntre = (cuits: ReadonlyArray<string | null>): ClienteDelEstudio | null => {
    for (const cuit of cuits) {
      if (!cuit) continue;
      const hallado = input.otrosClientes.find((c) => normalizarCuit(c.cuit) === cuit);
      if (hallado) return hallado;
    }
    return null;
  };

  if (cuitCliente && (emisor === cuitCliente || receptor === cuitCliente)) {
    return { estado: CUIT_ESTADO.CORRECTO, ...base, sugerido: null, mensaje: null };
  }

  const sugerido = sugeridoEntre([emisor, receptor]);
  if (sugerido) {
    const cuitDelOtro = normalizarCuit(sugerido.cuit);
    return {
      estado: CUIT_ESTADO.OTRO_CLIENTE,
      ...base,
      sugerido,
      mensaje: `Este comprobante es del CUIT ${cuitDelOtro ? formatearCuit(cuitDelOtro) : ""}, que corresponde a ${sugerido.legalName} (no a ${input.clienteNombre}).`,
    };
  }

  if (emisor === null || receptor === null) {
    const falta = emisor === null && receptor === null
      ? "del emisor ni del receptor"
      : emisor === null
        ? "del emisor"
        : "del receptor";
    return {
      estado: CUIT_ESTADO.NO_LEIDO,
      ...base,
      sugerido: null,
      mensaje: `No se pudo leer el CUIT ${falta} del comprobante. Revisalo a mano y, si es de ${input.clienteNombre}, aceptalo con motivo.`,
    };
  }

  return {
    estado: CUIT_ESTADO.OTRO_CLIENTE,
    ...base,
    sugerido: null,
    mensaje: `Los CUIT del comprobante (emisor ${formatearCuit(emisor)}, receptor ${formatearCuit(receptor)}) no son de ${input.clienteNombre}. Si corresponde igual, aceptalo con motivo.`,
  };
}
