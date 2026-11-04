/**
 * Acciones de ciclo de vida disponibles por fila en la tabla de usuarios
 * internos (Administración). Helper puro: sin React, testeable por unidad.
 *
 * Reglas (corte F2):
 *   * OWNER protegido: nadie lo suspende desde la UI (la plataforma lo
 *     rechaza en backend). La transferencia de titularidad es cambio de rol.
 *   * Membresía suspendida -> sólo reactivar (reactivación explícita del
 *     administrador: no hay re-creación de sesiones).
 *   * Membresía activa y no-OWNER -> suspender (baja reversible).
 *   * Sin usuario (cuenta inexistente) o invitación pendiente -> nada.
 */

export interface MemberLifecycleState {
  role: string;
  membershipStatus: string;
  /** Estado real de la cuenta (users.status). Puede faltar si el join no la encuentra. */
  userStatus?: string | null;
}

export type MemberRowAction = "suspend" | "reactivate" | "recover-access";

export function memberRowActions(member: MemberLifecycleState): MemberRowAction[] {
  if (!member.userStatus) return [];
  const effectiveStatus = member.userStatus || member.membershipStatus;
  if (effectiveStatus === "SUSPENDED") return ["reactivate"];
  if (member.membershipStatus === "ACTIVE") {
    // Recuperar acceso aplica a cualquier miembro activo (también al titular:
    // si lo pierde, sólo otro titular puede emitirle el enlace; el backend lo
    // verifica). Suspender sigue reservado a no-OWNER.
    return member.role !== "OWNER" ? ["suspend", "recover-access"] : ["recover-access"];
  }
  return [];
}

export interface MemberActionCopy {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "default";
}

/** Texto de confirmación por acción (patrón ConfirmDialog del estudio). */
export function memberActionCopy(action: MemberRowAction, memberName: string): MemberActionCopy {
  if (action === "suspend") {
    return {
      title: `¿Suspender a ${memberName}?`,
      description:
        "Pierde el acceso de inmediato: se cierran todas sus sesiones activas. Sus datos e historial se conservan; podés reactivarlo cuando quieras.",
      confirmLabel: "Suspender",
      tone: "danger",
    };
  }
  return {
    title: `¿Reactivar a ${memberName}?`,
    description:
      "Vuelve a tener acceso con el mismo rol. Deberá iniciar sesión nuevamente con sus credenciales.",
    confirmLabel: "Reactivar",
    tone: "default",
  };
}

/** Aviso para el cambio de rol que puede dejar al estudio sin administrador. */
export function roleChangeCopy(memberName: string, currentRole: string, nextRole: string): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const demotesAdmin =
    (currentRole === "OWNER" || currentRole === "ADMIN") &&
    nextRole !== "OWNER" &&
    nextRole !== "ADMIN";
  return {
    title: `¿Cambiar el rol de ${memberName} a ${nextRole}?`,
    description: demotesAdmin
      ? "Baja de privilegios de administración: cierra sus sesiones activas y deja de gestionar usuarios. El cambio se rechaza si es el último titular o administrador activo."
      : "El rol define qué módulos internos puede usar. El cambio queda registrado en la auditoría.",
    confirmLabel: "Cambiar rol",
  };
}

/** Texto de confirmación para generar el enlace de recuperación de acceso. */
export function memberRecoveryCopy(memberName: string): MemberActionCopy {
  return {
    title: `¿Generar enlace de recuperación para ${memberName}?`,
    description:
      "Se cierran todas sus sesiones activas y se genera un enlace de un solo uso, válido 30 minutos, para que defina una contraseña nueva. Vos no ves ni definís esa contraseña: entregale el enlace por un canal seguro.",
    confirmLabel: "Generar enlace",
    tone: "default",
  };
}
