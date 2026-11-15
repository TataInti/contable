// Textos del Legajo: pluralización e identificadores cortos. Un solo lugar para ambos (P3).

/** Cantidad con su nombre en singular o plural: «1 control bloqueante», «2 controles bloqueantes», «0 movimientos». */
export function pluralizar(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

const IDENTIFICADOR_LARGO = /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Deja los ocho primeros caracteres de cada identificador largo del texto; el completo va en `title`. */
export function identificadorCorto(texto: string): string {
  return texto.replace(IDENTIFICADOR_LARGO, "$1");
}
