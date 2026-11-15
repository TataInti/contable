export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim());
}

export function batchUserErrorLabel(error: string): string {
  return error.replace(/\bEmail\b/g, "Correo").replace(/\bemail\b/g, "correo");
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase("es-AR");
}

export function userMutationError(error: unknown, fallback: string): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "LAST_ADMIN_REQUIRED") {
    return "El estudio debe conservar al menos un titular o administrador activo.";
  }
  if (code === "USER_EMAIL_CONFLICT") {
    return "Ese correo ya está asociado a otra cuenta.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
