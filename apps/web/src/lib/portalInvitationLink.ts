/**
 * Enlace que el estudio le entrega al cliente para aceptar la invitación al
 * portal. El token va en el fragmento (`#token=`), igual que el enlace de
 * recuperación de acceso: el fragmento no se envía al servidor ni queda en sus
 * logs ni en los de los proxies.
 */
export function buildPortalInvitationLink(origin: string, token: string): string {
  return `${origin}/aceptar-invitacion#token=${encodeURIComponent(token)}`;
}
