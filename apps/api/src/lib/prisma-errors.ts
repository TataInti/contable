/**
 * Detección de la restricción única de PostgreSQL (P2002) que Prisma devuelve.
 * Es un código técnico de base de datos para traducir una carrera a un conflicto
 * de negocio; no decide comportamiento fiscal.
 */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "P2002",
  );
}
