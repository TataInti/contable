import type { Document, DocumentCuitControl } from "../../lib/api";

/** Etiqueta corta del estado de CUIT para la lista y el panel (un concepto, un nombre). */
export function etiquetaCuitEstado(estado: DocumentCuitControl["estado"]): string {
  return estado === "OTRO_CLIENTE" ? "CUIT de otro cliente" : "CUIT no leído";
}

/** El motivo de «Aceptar con motivo» tiene que decir algo: al menos tres caracteres. */
export function validarMotivoCuit(texto: string): string | null {
  return texto.trim().length >= 3 ? null : "Escribí el motivo: al menos 3 caracteres.";
}

export interface PlanDeBloque {
  /** Documentos con el CUIT pendiente en la vista actual. */
  pendientes: Document[];
  /** Cliente al que se pueden mover todos a la vez: solo si todos sugieren el mismo. */
  destino: { clientId: string; legalName: string } | null;
}

/** Calcula qué acciones en bloque ofrece la Bandeja sobre los documentos visibles. */
export function planDeBloqueCuit(documentos: ReadonlyArray<Document>): PlanDeBloque {
  const pendientes = documentos.filter((d) => d.cuitControl?.pendiente);
  const sugeridos = new Set(pendientes.map((d) => d.cuitControl?.sugerido?.clientId ?? ""));
  const primero = pendientes[0]?.cuitControl?.sugerido;
  const destino =
    pendientes.length > 0 && sugeridos.size === 1 && primero
      ? { clientId: primero.clientId, legalName: primero.legalName }
      : null;
  return { pendientes, destino };
}
