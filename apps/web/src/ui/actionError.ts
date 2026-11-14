/**
 * Texto para avisar que una acción falló: el motivo que dio el servidor o, si
 * no hay uno legible, el texto de respaldo de la pantalla.
 */
export function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
