/** Muestra un CUIT de 11 dígitos como 20-12345678-9; deja intacto cualquier otro valor. */
export function formatCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}
