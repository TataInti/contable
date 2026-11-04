/**
 * Ciclo de vida de miembros internos (F2, corte de administración de usuarios).
 *
 * La lógica de autorización e invariantes vive en SQL SECURITY DEFINER
 * (migración user_lifecycle_administration): suspension/reactivación/cambio de
 * rol con guard de último administrador, OWNER protegido, revocación de
 * sesiones y auditoría. Esta capa sólo:
 *   1. mapea los errores de SQL a respuestas HTTP consistentes, y
 *   2. declara qué intentos rechazados se auditan (actor/acción), para que el
 *      rastro quede aunque la transacción de la operación haya abortado.
 */

export type LifecycleErrorCode =
  | "MEMBER_ACTOR_REQUIRED"
  | "MEMBER_NOT_FOUND"
  | "MEMBER_SELF_TARGET"
  | "OWNER_PROTECTED"
  | "MEMBER_NOT_SUSPENDIBLE"
  | "MEMBER_NOT_SUSPENDED"
  | "LAST_ADMIN_REQUIRED"
  | "RECOVERY_TTL_INVALID"
  | "RECOVERY_TARGET_NOT_ACTIVE"
  | "RECOVERY_NOT_FOUND"
  | "RECOVERY_NOT_ACTIVE"
  | "RECOVERY_INVALID";

export interface LifecycleHttpError {
  statusCode: number;
  code: LifecycleErrorCode;
  message: string;
}

const LIFECYCLE_ERROR_MAP: Record<LifecycleErrorCode, { statusCode: number; message: string }> = {
  // El actor no es OWNER/ADMIN activo de la firma: capacidad no satisfecha.
  MEMBER_ACTOR_REQUIRED: {
    statusCode: 403,
    message: "Sólo el titular o un administrador del estudio puede realizar esta acción",
  },
  MEMBER_NOT_FOUND: {
    statusCode: 404,
    message: "Usuario interno no encontrado",
  },
  MEMBER_SELF_TARGET: {
    statusCode: 403,
    message: "No se puede operar sobre la propia cuenta; usá otra sesión con un administrador",
  },
  // OWNER protegido: nadie lo suspende; sólo un OWNER cambia su rol o lo reactiva.
  OWNER_PROTECTED: {
    statusCode: 403,
    message: "El titular del estudio está protegido: sólo un titular puede modificarlo",
  },
  MEMBER_NOT_SUSPENDIBLE: {
    statusCode: 409,
    message: "El usuario no está en un estado que permita suspenderlo",
  },
  MEMBER_NOT_SUSPENDED: {
    statusCode: 409,
    message: "El usuario no está suspendido",
  },
  // Guard de último administrador: la firma debe conservar un OWNER/ADMIN activo.
  LAST_ADMIN_REQUIRED: {
    statusCode: 409,
    message: "El estudio debe conservar un titular o administrador activo",
  },
  // Recuperación de acceso (renovación de claves iniciada por el admin).
  RECOVERY_TTL_INVALID: {
    statusCode: 400,
    message: "La vigencia del enlace de recuperación debe estar entre 5 minutos y 24 horas",
  },
  RECOVERY_TARGET_NOT_ACTIVE: {
    statusCode: 409,
    message: "El usuario no está activo: reactivá su cuenta antes de generar un enlace de recuperación",
  },
  RECOVERY_NOT_FOUND: {
    statusCode: 404,
    message: "Enlace de recuperación no encontrado",
  },
  RECOVERY_NOT_ACTIVE: {
    statusCode: 409,
    message: "El enlace de recuperación ya no está pendiente",
  },
  // Genérico a propósito (canje): sin oráculo entre inexistente/usado/expirado/
  // revocado/usuario no activo.
  RECOVERY_INVALID: {
    statusCode: 400,
    message: "El enlace de recuperación es inválido, expiró o ya fue usado",
  },
};

/**
 * Mapea el mensaje de una excepción SQL del ciclo de vida a un error HTTP.
 * Devuelve null cuando el error no pertenece al ciclo de vida (se re-propaga).
 */
export function lifecycleHttpError(errorMessage: string): LifecycleHttpError | null {
  const known = (Object.keys(LIFECYCLE_ERROR_MAP) as LifecycleErrorCode[]).find((code) =>
    errorMessage.includes(code),
  );
  if (!known) return null;
  const mapped = LIFECYCLE_ERROR_MAP[known];
  return { statusCode: mapped.statusCode, code: known, message: mapped.message };
}

/**
 * Intentos rechazados que se auditan con actor/acción, aunque la operación no
 * se haya aplicado. El objetivo (userId) viaja como entityId; el detalle del
 * rechazo queda en `after`.
 */
export const AUDITED_REJECTIONS: Partial<Record<LifecycleErrorCode, string>> = {
  OWNER_PROTECTED: "internal_member.owner_protected.rejected",
  LAST_ADMIN_REQUIRED: "internal_member.last_admin_guard.rejected",
  MEMBER_SELF_TARGET: "internal_member.self_target.rejected",
};

export function isAuditedRejection(code: LifecycleErrorCode): boolean {
  return code in AUDITED_REJECTIONS;
}
