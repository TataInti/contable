import type { BatchUserLine } from "../batch-users.js";

export interface PortalInvitation {
  id: string;
  emailNormalized: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
export interface PortalMembership {
  id: string;
  role: string;
  status: string;
  revokedAt: string | null;
  user: { name: string; emailNormalized: string };
}
export interface CreatedInvitation {
  invitationToken: string;
  email: string;
  expiresAt: string;
}

export interface InternalMember {
  id: string;
  userId: string;
  role: string;
  status: string;
  acceptedAt: string | null;
  user?: { name: string; emailNormalized: string; status: string } | null;
}
export interface FirmProfile {
  legalName: string;
  displayName: string;
  taxId: string | null;
  timezone: string;
}
export interface CreatedInternalUser {
  userId: string;
  email: string;
  name: string;
  role: string;
  temporaryPassword: string;
}

// Recuperación de acceso: el enlace se muestra UNA sola vez; en la base sólo
// vive el hash del token. El gestor nunca ve ni define la contraseña.
export interface CreatedAccessRecovery {
  recoveryId: string;
  expiresAt: string;
  sessionsRevoked: number;
  recoveryToken: string;
}

export interface AccountingStandardRow {
  id: string;
  name: string;
  isActive: boolean;
}

export const INTERNAL_ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  ADMIN: "Administrador",
  PREPARER: "Preparador",
  REVIEWER: "Revisor",
  AUDITOR_READONLY: "Auditor · sólo lectura",
};

export const INTERNAL_MODULES_BY_ROLE: Record<string, string[]> = {
  OWNER: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Legajo", "Rentabilidad"],
  ADMIN: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Legajo", "Rentabilidad"],
  PREPARER: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Legajo", "Rentabilidad"],
  REVIEWER: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Legajo", "Rentabilidad"],
  AUDITOR_READONLY: ["Clientes", "Configuración fiscal", "Liquidaciones", "Rentabilidad"],
};

export const INTERNAL_ROLE_OPTIONS = Object.entries(INTERNAL_ROLE_LABELS);
export const INTERNAL_MODULES = INTERNAL_MODULES_BY_ROLE.OWNER ?? [];
export const PORTAL_ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  COLLABORATOR: "Colaborador",
  READONLY: "Sólo lectura",
};

export type AdminTab = "internal" | "portal" | "standards" | "profile" | "controls";

export interface PortalRow {
  key: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  detail?: string;
  membership: PortalMembership | null;
  onRevoke: (() => void) | null;
  onToggleStatus: (() => void) | null;
  onEdit: (() => void) | null;
  pending: boolean;
}

export interface BatchResult {
  line: BatchUserLine;
  created: CreatedInternalUser | null;
  error: string | null;
}
