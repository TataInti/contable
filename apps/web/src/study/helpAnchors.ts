/** Capítulo del manual que corresponde a cada pantalla del estudio. */
export const HELP_DEFAULT_ANCHOR = "circuito";

export const HELP_ANCHOR_BY_PATH: Readonly<Record<string, string>> = {
  "/": "circuito",
  "/clientes": "clientes",
  "/resumen-cliente": "clientes",
  "/bandeja": "bandeja",
  "/configuracion-fiscal": "configuracion-fiscal",
  "/trabajo": "trabajo",
  "/expediente-mensual": "expediente",
  "/liquidaciones": "liquidaciones",
  "/rentabilidad": "rentabilidad",
  "/administracion": "usuarios",
  "/administracion-plataforma": "usuarios",
  "/reglas-fiscales": "reglas",
  "/ayuda": "indice",
};

export function helpHrefForPath(pathname: string): string {
  const anchor = HELP_ANCHOR_BY_PATH[pathname] ?? HELP_DEFAULT_ANCHOR;
  return `/ayuda#${anchor}`;
}
