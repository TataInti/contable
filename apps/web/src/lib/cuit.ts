/** Muestra un CUIT de 11 dígitos como 20-12345678-9; deja intacto cualquier otro valor. */
export function formatCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

/** Formatea mientras se tipea: 20, 20-1, 20-11111119, 20-11111119-9. Solo dígitos. */
export function formatCuitParcial(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}
