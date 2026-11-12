import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { memberActionCopy, memberRecoveryCopy, memberRowActions, roleChangeCopy } from "./member-row-actions.js";
import { ActionDrawer } from "../ui/ActionDrawer";
import {
  DenseHeader,
  DensePage,
  DenseSearch,
  DensitySwitch,
  DenseTable,
  DenseTabs,
  DenseToolbar,
  DenseWorkspace,
  Inspector,
  InspectorFacts,
  InspectorSection,
  ShortcutHint,
  StatStrip,
  normalizeSearch,
  useDenseShortcuts,
  useDensity,
  type DenseColumn,
  type DenseTab,
} from "../ui/Dense";
import { credentialsCsv, parseBatchUsers, type BatchUserLine } from "./batch-users.js";
import "./study.css";

interface PortalInvitation {
  id: string;
  emailNormalized: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
interface PortalMembership {
  id: string;
  role: string;
  status: string;
  revokedAt: string | null;
  user: { name: string; emailNormalized: string };
}
interface CreatedInvitation {
  invitationToken: string;
  email: string;
  expiresAt: string;
}

interface InternalMember {
  id: string;
  userId: string;
  role: string;
  status: string;
  acceptedAt: string | null;
  user?: { name: string; emailNormalized: string; status: string } | null;
}
interface CreatedInternalUser {
  userId: string;
  email: string;
  name: string;
  role: string;
  temporaryPassword: string;
}

// Recuperación de acceso: el enlace se muestra UNA sola vez; en la base sólo
// vive el hash del token. El gestor nunca ve ni define la contraseña.
interface CreatedAccessRecovery {
  recoveryId: string;
  expiresAt: string;
  sessionsRevoked: number;
  recoveryToken: string;
}

interface AccountingStandardRow {
  id: string;
  name: string;
  isActive: boolean;
}

const INTERNAL_ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  ADMIN: "Administrador",
  PREPARER: "Preparador",
  REVIEWER: "Revisor",
  AUDITOR_READONLY: "Auditor · sólo lectura",
};

const INTERNAL_MODULES_BY_ROLE: Record<string, string[]> = {
  OWNER: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Expediente mensual", "Rentabilidad"],
  ADMIN: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Expediente mensual", "Rentabilidad"],
  PREPARER: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Expediente mensual", "Rentabilidad"],
  REVIEWER: ["Clientes", "Bandeja documental", "Configuración fiscal", "Trabajo", "Liquidaciones", "Expediente mensual", "Rentabilidad"],
  AUDITOR_READONLY: ["Clientes", "Configuración fiscal", "Liquidaciones", "Rentabilidad"],
};

const INTERNAL_ROLE_OPTIONS = Object.entries(INTERNAL_ROLE_LABELS);
const INTERNAL_MODULES = INTERNAL_MODULES_BY_ROLE.OWNER ?? [];
const PORTAL_ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  COLLABORATOR: "Colaborador",
  READONLY: "Sólo lectura",
};

type AdminTab = "internal" | "portal" | "standards";

interface PortalRow {
  key: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  detail?: string;
  onRevoke: (() => void) | null;
  pending: boolean;
}

interface BatchResult {
  line: BatchUserLine;
  created: CreatedInternalUser | null;
  error: string | null;
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase("es-AR");
}

/** Resumen textual de los módulos internos habilitados para el rol. */
function ModuleFingerprint({ role }: { role: string }) {
  const enabled = INTERNAL_MODULES_BY_ROLE[role] ?? [];
  return (
    <span
      className="dense-fp"
      title={enabled.join(" · ") || "Sin módulos internos"}
      aria-label={`${enabled.length} de ${INTERNAL_MODULES.length} módulos habilitados`}
    >
      <span>{enabled.length} de {INTERNAL_MODULES.length}</span>
    </span>
  );
}

/** Referencia rol × módulo: reemplaza repetir la lista de módulos en cada fila. */
function RoleMatrix({ highlight }: { highlight: string | null }) {
  return (
    <table className="dense-matrix" aria-label="Módulos habilitados por rol">
      <thead>
        <tr>
          <th scope="col">Módulo</th>
          {INTERNAL_ROLE_OPTIONS.map(([value, label]) => (
            <th
              key={value}
              scope="col"
              title={label}
              className={highlight === value ? "is-hi" : undefined}
            >
              {ROLE_SHORT_LABELS[value] ?? label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {INTERNAL_MODULES.map((module) => (
          <tr key={module}>
            <th scope="row">{module}</th>
            {INTERNAL_ROLE_OPTIONS.map(([value, label]) => {
              const allowed = (INTERNAL_MODULES_BY_ROLE[value] ?? []).includes(module);
              return (
                <td key={value} className={highlight === value ? "is-hi" : undefined}>
                  {allowed ? (
                    <span aria-label={`${label}: habilitado`}>Sí</span>
                  ) : (
                    <span className="dense-matrix__no" aria-label={`${label}: sin acceso`}>
                      –
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ROLE_SHORT_LABELS: Record<string, string> = {
  OWNER: "Tit.",
  ADMIN: "Adm.",
  PREPARER: "Prep.",
  REVIEWER: "Rev.",
  AUDITOR_READONLY: "Aud.",
};

export function StudyAdministracion() {
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [internalEmail, setInternalEmail] = useState("");
  const [internalName, setInternalName] = useState("");
  const [internalRole, setInternalRole] = useState("PREPARER");
  const [showInternalInviteForm, setShowInternalInviteForm] = useState(false);
  const [createdInternalUser, setCreatedInternalUser] = useState<CreatedInternalUser | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("OWNER");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);
  const [recoverySummary, setRecoverySummary] = useState<{ memberName: string; expiresAt: string; sessionsRevoked: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("internal");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showRoles, setShowRoles] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "ACTIVE" | "SUSPENDED">("");
  const [createMode, setCreateMode] = useState<"single" | "batch">("single");
  const [batchText, setBatchText] = useState("");
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [density, setDensity] = useDensity();
  const canManageSelfReview = capabilities.has("firm.self_review.manage");
  const searchRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<() => void>(() => undefined);
  useDenseShortcuts({
    searchRef,
    onNew: () => newRef.current(),
    onEscape: () => {
      setSelectedUserId(null);
      setShowRoles(false);
    },
  });
  const confirm = useConfirmAction();
  const internalMembers = useQuery({
    queryKey: ["internal-members", firmId],
    queryFn: () => api.get<InternalMember[]>(`/firms/${firmId}/members`),
    enabled: Boolean(firmId && capabilities.has("firm.users.manage")),
  });
  const selfReviewSetting = useQuery({
    queryKey: ["firm-self-review", firmId],
    queryFn: () => api.get<{ allowSelfReview: boolean }>(`/firms/${firmId}/settings/self-review`),
    enabled: Boolean(firmId && capabilities.has("firm.manage")),
  });
  const updateSelfReviewSetting = useMutation({
    mutationFn: (allowSelfReview: boolean) =>
      api.patch<{ allowSelfReview: boolean }>(`/firms/${firmId}/settings/self-review`, {
        allowSelfReview,
      }),
    onSuccess: (setting) => {
      setActionError(null);
      setNotice(
        setting.allowSelfReview
          ? "La autorrevisión quedó habilitada para este estudio. Cada uso queda auditado."
          : "La autorrevisión quedó deshabilitada para este estudio.",
      );
      queryClient.setQueryData(["firm-self-review", firmId], setting);
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-coverage", firmId] });
    },
  });
  const inviteInternal = useMutation({
    mutationFn: () =>
      api.post<CreatedInternalUser>(`/firms/${firmId}/users`, {
        email: internalEmail.trim(), name: internalName.trim(), role: internalRole,
      }),
    onSuccess: (created) => {
      setActionError(null);
      setNotice("El usuario fue creado. Entregale la contraseña temporal por un canal seguro.");
      setCreatedInternalUser(created);
      setInternalEmail("");
      setInternalName("");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo crear el usuario interno."),
  });
  const updateInternalRole = useMutation({
    mutationFn: ({ userId, role: nextRole }: { userId: string; role: string }) =>
      api.patch(`/firms/${firmId}/members/${userId}`, { role: nextRole }),
    onSuccess: () => {
      setActionError(null);
      setNotice("El rol del usuario interno fue actualizado.");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo actualizar el rol."),
  });
  // Ciclo de vida (baja reversible): suspender cierra las sesiones activas del
  // usuario en el servidor y preserva datos/historial; reactivar exige una
  // acción explícita del admin. La validación de último OWNER/ADMIN la hace
  // el backend (app_suspend_internal_member / app_reactivate_internal_member).
  const suspendInternalMember = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      api.post(`/firms/${firmId}/members/${userId}/suspend`, reason ? { reason } : {}),
    onSuccess: () => {
      setActionError(null);
      setNotice("El usuario quedó suspendido: pierde el acceso de inmediato y sus sesiones activas se cerraron. Sus datos e historial se conservan.");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo suspender al usuario."),
  });
  const reactivateInternalMember = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      api.post(`/firms/${firmId}/members/${userId}/reactivate`, reason ? { reason } : {}),
    onSuccess: () => {
      setActionError(null);
      setNotice("El usuario fue reactivado con su mismo rol. Tendrá que iniciar sesión nuevamente.");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo reactivar al usuario."),
  });
  // Renovación de claves: el admin genera un enlace de un solo uso para que el
  // miembro defina una contraseña nueva. El backend cierra sus sesiones
  // activas al emitir, valida OWNER-protegido y audita; el enlace se muestra
  // una sola vez acá y no se vuelve a obtener.
  const createAccessRecovery = useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      api.post<CreatedAccessRecovery>(`/firms/${firmId}/members/${userId}/access-recovery`, {}),
    onSuccess: (created, { userId }) => {
      setActionError(null);
      const memberName =
        internalMembers.data?.find((item) => item.userId === userId)?.user?.name ?? "el usuario";
      setRecoverySummary({
        memberName,
        expiresAt: new Date(created.expiresAt).toLocaleString("es-AR"),
        sessionsRevoked: created.sessionsRevoked,
      });
      setRecoveryLink(
        `${window.location.origin}/recuperar-acceso#token=${encodeURIComponent(created.recoveryToken)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo generar el enlace de recuperación."),
  });
  const invitations = useQuery({
    queryKey: ["portal-invitations", firmId, clientId],
    queryFn: () =>
      api.get<PortalInvitation[]>(`/firms/${firmId}/clients/${clientId}/portal-invitations`),
    enabled: Boolean(firmId && clientId && capabilities.has("firm.manage")),
  });
  const memberships = useQuery({
    queryKey: ["portal-memberships", firmId, clientId],
    queryFn: () =>
      api.get<PortalMembership[]>(`/firms/${firmId}/clients/${clientId}/portal-memberships`),
    enabled: Boolean(firmId && clientId && capabilities.has("firm.manage")),
  });
  const invite = useMutation({
    mutationFn: () =>
      api.post<CreatedInvitation>(`/firms/${firmId}/clients/${clientId}/portal-invitations`, {
        email: email.trim(),
        role,
      }),
    onSuccess: (created) => {
      setActionError(null);
      setInvitationLink(
        `${window.location.origin}/aceptar-invitacion?token=${encodeURIComponent(created.invitationToken)}`,
      );
      setEmail("");
      setShowInviteForm(false);
      void queryClient.invalidateQueries({ queryKey: ["portal-invitations", firmId, clientId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo crear la invitación."),
  });
  const revokeMembership = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/portal-memberships/${id}/revoke`),
    onSuccess: () => {
      setActionError(null);
      setNotice("El acceso al portal fue revocado.");
      void queryClient.invalidateQueries({ queryKey: ["portal-memberships", firmId, clientId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo revocar el acceso."),
  });
  const revokeInvitation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/portal-invitations/${id}/revoke`),
    onSuccess: () => {
      setActionError(null);
      setNotice("La invitación quedó revocada.");
      void queryClient.invalidateQueries({ queryKey: ["portal-invitations", firmId, clientId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo revocar la invitación."),
  });

  // Catálogo de normas contables del estudio: parámetro estandarizado que se
  // define acá, en Administración. La ficha de cliente selecciona de este
  // catálogo (sin texto libre). No hay valores precargados: arranca vacío.
  const [showStandardForm, setShowStandardForm] = useState(false);
  const [standardEditing, setStandardEditing] = useState<AccountingStandardRow | null>(null);
  const [standardName, setStandardName] = useState("");
  const accountingStandards = useQuery({
    queryKey: ["accounting-standards", firmId],
    queryFn: () => api.get<AccountingStandardRow[]>(`/firms/${firmId}/accounting-standards`),
    enabled: Boolean(firmId && capabilities.has("firm.manage")),
  });
  const invalidateStandards = () =>
    void queryClient.invalidateQueries({ queryKey: ["accounting-standards", firmId] });
  const createStandard = useMutation({
    mutationFn: () =>
      api.post<AccountingStandardRow>(`/firms/${firmId}/accounting-standards`, {
        name: standardName.trim(),
      }),
    onSuccess: (created) => {
      setActionError(null);
      setNotice(`La norma contable "${created.name}" quedó activa en el catálogo.`);
      setStandardName("");
      setShowStandardForm(false);
      invalidateStandards();
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo crear la norma contable."),
  });
  const updateStandard = useMutation({
    mutationFn: ({ id, name, isActive }: { id: string; name?: string; isActive?: boolean }) =>
      api.patch<AccountingStandardRow>(`/firms/${firmId}/accounting-standards/${id}`, {
        ...(name !== undefined ? { name } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      }),
    onSuccess: (updated) => {
      setActionError(null);
      setNotice(`La norma contable "${updated.name}" quedó actualizada.`);
      setStandardEditing(null);
      setStandardName("");
      setShowStandardForm(false);
      invalidateStandards();
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "No se pudo actualizar la norma contable.",
      ),
  });
  const openStandardForm = () => {
    setActionError(null);
    setStandardEditing(null);
    setStandardName("");
    setShowStandardForm(true);
  };
  const openStandardEdit = (row: AccountingStandardRow) => {
    setActionError(null);
    setStandardEditing(row);
    setStandardName(row.name);
    setShowStandardForm(true);
  };
  const toggleStandard = (row: AccountingStandardRow) =>
    confirm.ask({
      title: row.isActive
        ? `¿Desactivar la norma contable "${row.name}"?`
        : `¿Reactivar la norma contable "${row.name}"?`,
      description: row.isActive
        ? "Deja de ofrecerse en la ficha de clientes. Los clientes que ya la tienen asignada conservan su valor."
        : "Vuelve a aparecer como opción en la ficha de clientes.",
      confirmLabel: row.isActive ? "Desactivar" : "Reactivar",
      tone: row.isActive ? "danger" : "default",
      onConfirm: () => updateStandard.mutate({ id: row.id, isActive: !row.isActive }),
    });

  const copyInvitationLink = async () => {
    if (!invitationLink) return;
    try {
      await navigator.clipboard.writeText(invitationLink);
      setActionError(null);
      setNotice("El enlace de invitación se copió al portapapeles.");
    } catch {
      setActionError("No se pudo copiar el enlace. Seleccionalo y copialo manualmente.");
    }
  };

  const copyRecoveryLink = async () => {
    if (!recoveryLink) return;
    try {
      await navigator.clipboard.writeText(recoveryLink);
      setActionError(null);
      setNotice("El enlace de recuperación se copió al portapapeles.");
    } catch {
      setActionError("No se pudo copiar el enlace. Seleccionalo y copialo manualmente.");
    }
  };

  const closeRecoveryReceipt = () => {
    setRecoveryLink(null);
    setRecoverySummary(null);
  };

  const activePortalMembershipCount = memberships.data?.filter((item) => !item.revokedAt).length;
  const pendingInvitationCount = invitations.data?.filter(
    (item) =>
      !item.revokedAt &&
      !item.acceptedAt &&
      new Date(item.expiresAt) >= new Date(),
  ).length;
  const activeInternalMemberCount = internalMembers.data?.filter((item) => item.status === "ACTIVE").length;
  const openInternalInviteForm = () => {
    setActionError(null);
    setCreatedInternalUser(null);
    setShowInternalInviteForm(true);
  };
  const openInviteForm = () => {
    setActionError(null);
    setShowInviteForm(true);
  };

  if (!capabilities.has("firm.users.manage"))
    return (
      <div className="study-page">
        <EmptyState
          title="Acceso restringido"
          description="Sólo titulares y administradores pueden gestionar usuarios internos del estudio."
        />
      </div>
    );

  const effectiveStatus = (item: InternalMember) => item.user?.status ?? item.status;
  const allMembers = internalMembers.data ?? [];
  const suspendedInternalMemberCount = allMembers.filter(
    (item) => effectiveStatus(item) === "SUSPENDED",
  ).length;
  const ownerCount = allMembers.filter((item) => item.role === "OWNER").length;

  const searchQuery = normalizeSearch(search);
  const visibleMembers = allMembers.filter(
    (item) =>
      (!searchQuery ||
        normalizeSearch(`${item.user?.name ?? ""} ${item.user?.emailNormalized ?? ""}`).includes(
          searchQuery,
        )) &&
      (!roleFilter || item.role === roleFilter) &&
      (!statusFilter || effectiveStatus(item) === statusFilter),
  );
  const selectedMember = allMembers.find((item) => item.userId === selectedUserId) ?? null;
  const anyMemberActionPending =
    suspendInternalMember.isPending ||
    reactivateInternalMember.isPending ||
    createAccessRecovery.isPending;

  const memberActionButtons = (item: InternalMember, variant: "ghost" | "secondary") => {
    const actions = memberRowActions({
      role: item.role,
      membershipStatus: item.status,
      userStatus: item.user?.status,
    });
    const memberName = item.user?.name ?? "este usuario";
    return (
      <>
        {actions.includes("recover-access") ? (
          <Button
            size="row"
            variant={variant}
            loading={
              createAccessRecovery.isPending && createAccessRecovery.variables?.userId === item.userId
            }
            disabled={anyMemberActionPending}
            onClick={() => {
              const copy = memberRecoveryCopy(memberName);
              confirm.ask({
                title: copy.title,
                description: copy.description,
                confirmLabel: copy.confirmLabel,
                tone: copy.tone,
                onConfirm: () => createAccessRecovery.mutate({ userId: item.userId }),
              });
            }}
          >
            Recuperar acceso
          </Button>
        ) : null}
        {actions.includes("suspend") ? (
          <Button
            size="row"
            variant={variant}
            className="dense-action--danger"
            loading={
              suspendInternalMember.isPending && suspendInternalMember.variables?.userId === item.userId
            }
            disabled={anyMemberActionPending}
            onClick={() => {
              const copy = memberActionCopy("suspend", memberName);
              confirm.ask({
                title: copy.title,
                description: copy.description,
                confirmLabel: copy.confirmLabel,
                tone: "danger",
                onConfirm: () => suspendInternalMember.mutate({ userId: item.userId }),
              });
            }}
          >
            Suspender
          </Button>
        ) : null}
        {actions.includes("reactivate") ? (
          <Button
            size="row"
            variant={variant}
            loading={
              reactivateInternalMember.isPending &&
              reactivateInternalMember.variables?.userId === item.userId
            }
            disabled={anyMemberActionPending}
            onClick={() => {
              const copy = memberActionCopy("reactivate", memberName);
              confirm.ask({
                title: copy.title,
                description: copy.description,
                confirmLabel: copy.confirmLabel,
                tone: "default",
                onConfirm: () => reactivateInternalMember.mutate({ userId: item.userId }),
              });
            }}
          >
            Reactivar
          </Button>
        ) : null}
        {actions.length === 0 ? <small>—</small> : null}
      </>
    );
  };

  const changeRole = (item: InternalMember, nextRole: string) => {
    if (nextRole === item.role) return;
    const copy = roleChangeCopy(item.user?.name ?? "este usuario", item.role, nextRole);
    confirm.ask({
      title: copy.title,
      description: copy.description,
      confirmLabel: "Cambiar rol",
      tone: item.role === "OWNER" ? "danger" : "default",
      onConfirm: () => updateInternalRole.mutate({ userId: item.userId, role: nextRole }),
    });
  };

  const internalColumns: DenseColumn<InternalMember>[] = [
    {
      key: "person",
      header: "Persona",
      sortValue: (item) => item.user?.name ?? "",
      render: (item) => (
        <span className="dense-person">
          <span className="dense-avatar" aria-hidden="true">
            {initials(item.user?.name)}
          </span>
          <strong>{item.user?.name ?? "Usuario eliminado"}</strong>
          <span className="dense-person__email">{item.user?.emailNormalized ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Rol",
      width: "190px",
      sortValue: (item) => INTERNAL_ROLE_LABELS[item.role] ?? item.role,
      render: (item) => (
        <>
          <label className="sr-only" htmlFor={`internal-role-${item.userId}`}>
            Rol de {item.user?.name ?? "usuario eliminado"}
          </label>
          <select
            id={`internal-role-${item.userId}`}
            className="dense-select dense-select--inline"
            value={item.role}
            disabled={
              updateInternalRole.isPending && updateInternalRole.variables?.userId === item.userId
            }
            onChange={(event) => changeRole(item, event.target.value)}
          >
            {INTERNAL_ROLE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </>
      ),
    },
    {
      key: "modules",
      header: "Módulos",
      width: "120px",
      sortValue: (item) => (INTERNAL_MODULES_BY_ROLE[item.role] ?? []).length,
      render: (item) => <ModuleFingerprint role={item.role} />,
    },
    {
      key: "status",
      header: "Estado",
      width: "120px",
      sortValue: (item) => effectiveStatus(item),
      render: (item) => <StatusBadge status={effectiveStatus(item)} />,
    },
    {
      key: "actions",
      header: "Acciones",
      secondary: true,
      align: "right",
      render: (item) => <span className="dense-row-actions">{memberActionButtons(item, "ghost")}</span>,
    },
  ];

  let internalInspector: ReactNode = null;
  if (tab === "internal" && selectedMember) {
    const modules = INTERNAL_MODULES_BY_ROLE[selectedMember.role] ?? [];
    internalInspector = (
      <Inspector
        label="Detalle del usuario"
        leading={
          <span className="dense-avatar dense-avatar--lg" aria-hidden="true">
            {initials(selectedMember.user?.name)}
          </span>
        }
        title={selectedMember.user?.name ?? "Usuario eliminado"}
        subtitle={selectedMember.user?.emailNormalized ?? "—"}
        onClose={() => setSelectedUserId(null)}
        footer={memberActionButtons(selectedMember, "secondary")}
      >
        <InspectorSection title="Acceso">
          <InspectorFacts
            items={[
              ["Rol", INTERNAL_ROLE_LABELS[selectedMember.role] ?? selectedMember.role],
              ["Estado", <StatusBadge key="status" status={effectiveStatus(selectedMember)} />],
              [
                "Módulos",
                `${modules.length} de ${INTERNAL_MODULES.length} habilitados`,
              ],
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Qué puede hacer cada rol">
          <RoleMatrix highlight={selectedMember.role} />
        </InspectorSection>
      </Inspector>
    );
  } else if (tab === "internal" && showRoles) {
    internalInspector = (
      <Inspector
        label="Roles y módulos"
        eyebrow="Referencia"
        title="Roles y módulos"
        subtitle="Qué módulos internos abre cada rol."
        onClose={() => setShowRoles(false)}
      >
        <InspectorSection title="Matriz">
          <RoleMatrix highlight={null} />
        </InspectorSection>
        <InspectorSection title="Reglas">
          <p>
            El rol es la fuente de verdad del acceso: no se asignan permisos sueltos. La
            transferencia de titularidad es un cambio de rol. Los módulos habilitados para el estudio
            se definen en administración general.
          </p>
        </InspectorSection>
      </Inspector>
    );
  }

  // Accesos del portal: miembros activos e invitaciones en una sola tabla.
  const portalRows: PortalRow[] = [
    ...(memberships.data ?? []).map<PortalRow>((item) => ({
      key: `membership-${item.id}`,
      name: item.user?.name ?? "Usuario eliminado",
      email: item.user?.emailNormalized ?? "—",
      role: item.role,
      status: item.revokedAt ? "REVOKED" : item.status,
      onRevoke: item.revokedAt
        ? null
        : () =>
            confirm.ask({
              title: `¿Revocar el acceso de ${item.user?.name ?? "este usuario"}?`,
              description:
                "Perderá acceso al portal de inmediato. La acción queda registrada en la auditoría.",
              confirmLabel: "Revocar acceso",
              tone: "danger",
              onConfirm: () => revokeMembership.mutate(item.id),
            }),
      pending: revokeMembership.isPending && revokeMembership.variables === item.id,
    })),
    ...(invitations.data ?? [])
      .filter((item) => !item.acceptedAt)
      .map<PortalRow>((item) => {
        const isPending = !item.revokedAt && new Date(item.expiresAt) >= new Date();
        return {
          key: `invitation-${item.id}`,
          name: null,
          email: item.emailNormalized,
          role: item.role,
          status: item.revokedAt ? "REVOKED" : isPending ? "PENDING" : "EXPIRED",
          detail: isPending ? `vence ${new Date(item.expiresAt).toLocaleDateString("es-AR")}` : undefined,
          onRevoke: isPending
            ? () =>
                confirm.ask({
                  title: `¿Revocar la invitación para ${item.emailNormalized}?`,
                  description:
                    "El enlace dejará de funcionar y la persona no podrá aceptar la invitación.",
                  confirmLabel: "Revocar invitación",
                  tone: "danger",
                  onConfirm: () => revokeInvitation.mutate(item.id),
                })
            : null,
          pending: revokeInvitation.isPending && revokeInvitation.variables === item.id,
        };
      }),
  ].filter(
    (row) =>
      !searchQuery || normalizeSearch(`${row.name ?? ""} ${row.email}`).includes(searchQuery),
  );

  const portalColumns: DenseColumn<PortalRow>[] = [
    {
      key: "person",
      header: "Persona",
      sortValue: (row) => row.name ?? row.email,
      render: (row) => (
        <span className="dense-person">
          <span className="dense-avatar" aria-hidden="true">
            {initials(row.name)}
          </span>
          {row.name ? <strong>{row.name}</strong> : null}
          <span className="dense-person__email">{row.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Rol",
      width: "140px",
      sortValue: (row) => PORTAL_ROLE_LABELS[row.role] ?? row.role,
      render: (row) => PORTAL_ROLE_LABELS[row.role] ?? row.role,
    },
    {
      key: "status",
      header: "Estado",
      width: "260px",
      sortValue: (row) => row.status,
      render: (row) => (
        <span className="dense-cell-inline">
          <StatusBadge status={row.status} />
          {row.detail ? <small className="muted-copy">{row.detail}</small> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Acción",
      width: "120px",
      align: "right",
      render: (row) =>
        row.onRevoke ? (
          <Button
            size="sm"
            variant="ghost"
            className="dense-action--danger"
            loading={row.pending}
            onClick={row.onRevoke}
          >
            Revocar
          </Button>
        ) : null,
    },
  ];

  const standardsRows = (accountingStandards.data ?? []).filter(
    (item) => !searchQuery || normalizeSearch(item.name).includes(searchQuery),
  );
  const standardColumns: DenseColumn<AccountingStandardRow>[] = [
    {
      key: "name",
      header: "Norma",
      sortValue: (item) => item.name,
      render: (item) => <span className="dense-code">{item.name}</span>,
    },
    {
      key: "status",
      header: "Estado",
      width: "140px",
      sortValue: (item) => item.isActive,
      render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      key: "action",
      header: "Acción",
      width: "220px",
      align: "right",
      render: (item) => (
        <span className="dense-row-actions">
          <Button size="sm" variant="secondary" onClick={() => openStandardEdit(item)}>
            Editar
          </Button>
          <Button
            size="sm"
            variant={item.isActive ? "ghost" : "secondary"}
            loading={updateStandard.isPending && updateStandard.variables?.id === item.id}
            onClick={() => toggleStandard(item)}
          >
            {item.isActive ? "Desactivar" : "Reactivar"}
          </Button>
        </span>
      ),
    },
  ];

  const footerWith = (count: number, noun: string, hint: string) => (
    <>
      <span>
        {count} {noun}
      </span>
      <span>{hint}</span>
      <span className="dense-table-foot__spacer" />
      <ShortcutHint
        items={[
          ["/", "buscar"],
          ["N", "nuevo"],
          ["Esc", "cerrar"],
        ]}
      />
    </>
  );

  const queryState = (loading: boolean, label: string) =>
    loading ? (
      <div className="dense-table-card">
        <div className="query-state" role="status">
          <span className="loading-copy">{label}</span>
        </div>
      </div>
    ) : null;

  let tableBody: ReactNode;
  if (tab === "internal") {
    tableBody =
      queryState(internalMembers.isLoading, "Cargando usuarios internos…") ??
      (internalMembers.isError ? (
        <EmptyState
          title="No se pudieron cargar los usuarios"
          description="No asumimos que no haya usuarios mientras la consulta está fallando."
          action={
            <Button size="sm" variant="secondary" onClick={() => void internalMembers.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <DenseTable<InternalMember>
          label="Usuarios internos"
          columns={internalColumns}
          rows={visibleMembers}
          rowKey={(item) => item.userId}
          selectedKey={selectedUserId}
          onSelect={setSelectedUserId}
          inspectorOpen={Boolean(internalInspector)}
          rowClassName={(item) => (effectiveStatus(item) === "SUSPENDED" ? "dense-row--muted" : undefined)}
          footer={footerWith(
            visibleMembers.length,
            visibleMembers.length === 1 ? "usuario" : "usuarios",
            "El titular no puede suspenderse desde la UI. El rol define el acceso a módulos.",
          )}
          empty={
            <EmptyState
              size="compact"
              title={
                allMembers.length === 0
                  ? "Todavía no hay usuarios internos"
                  : "Ningún usuario coincide con los filtros"
              }
              description={
                allMembers.length === 0
                  ? "Creá la primera cuenta del estudio para asignarle un rol."
                  : "Probá con otro nombre o email, o quitá filtros."
              }
            />
          }
        />
      ));
  } else if (tab === "portal") {
    tableBody = !clientId ? (
      <EmptyState
        title="Seleccioná un cliente"
        description="El acceso al portal siempre se administra dentro de una empresa cliente."
        action={
          <Button variant="secondary" onClick={() => navigate("/clientes")}>
            Ir a clientes
          </Button>
        }
      />
    ) : (
      (queryState(
        memberships.isLoading || invitations.isLoading,
        "Actualizando accesos del portal…",
      ) ??
      (memberships.isError || invitations.isError ? (
        <EmptyState
          size="compact"
          title="No se pudieron cargar los accesos"
          description="No asumimos que no haya accesos mientras la consulta está fallando."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void memberships.refetch();
                void invitations.refetch();
              }}
            >
              Reintentar
            </Button>
          }
        />
      ) : (
        <DenseTable<PortalRow>
          label="Accesos del portal"
          columns={portalColumns}
          rows={portalRows}
          rowKey={(row) => row.key}
          rowClassName={(row) => (row.status === "REVOKED" ? "dense-row--muted" : undefined)}
          footer={footerWith(
            portalRows.length,
            "accesos e invitaciones",
            "La invitación vence a los siete días y sólo puede usarse con el correo indicado.",
          )}
          empty={
            <EmptyState
              size="compact"
              title="Todavía nadie tiene acceso"
              description="Usá “Invitar al portal” para habilitar a una persona del cliente."
            />
          }
        />
      )))
    );
  } else {
    tableBody =
      queryState(accountingStandards.isLoading, "Cargando normas contables…") ??
      (accountingStandards.isError ? (
        <EmptyState
          title="No se pudieron cargar las normas contables"
          description="No asumimos que no haya normas mientras la consulta está fallando."
          action={
            <Button size="sm" variant="secondary" onClick={() => void accountingStandards.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <DenseTable<AccountingStandardRow>
          label="Normas contables"
          columns={standardColumns}
          rows={standardsRows}
          rowKey={(item) => item.id}
          rowClassName={(item) => (item.isActive ? undefined : "dense-row--muted")}
          footer={footerWith(
            standardsRows.length,
            standardsRows.length === 1 ? "norma" : "normas",
            "La ficha de cada cliente elige de acá, sin texto libre. Desactivar no altera a los clientes que ya la tienen.",
          )}
          empty={
            <EmptyState
              size="compact"
              title={
                (accountingStandards.data?.length ?? 0) === 0
                  ? "Todavía no hay normas contables"
                  : "Ninguna norma coincide con la búsqueda"
              }
              description={
                (accountingStandards.data?.length ?? 0) === 0
                  ? "Creá las normas que usa el estudio para poder seleccionarlas en la ficha de clientes."
                  : "Probá con otro nombre."
              }
            />
          }
        />
      ));
  }

  const openNewForTab = () => {
    if (tab === "internal") {
      setCreateMode("single");
      openInternalInviteForm();
    } else if (tab === "portal") {
      if (clientId) openInviteForm();
    } else {
      openStandardForm();
    }
  };
  newRef.current = openNewForTab;

  const openBatchForm = () => {
    setCreateMode("batch");
    setBatchResults(null);
    openInternalInviteForm();
  };
  const closeInternalDrawer = () => {
    setShowInternalInviteForm(false);
    setCreatedInternalUser(null);
    setBatchResults(null);
  };

  const batchLines = parseBatchUsers(batchText);
  const validBatchLines = batchLines.filter((line) => !line.error);
  const runBatch = async () => {
    if (!firmId || validBatchLines.length === 0) return;
    setBatchRunning(true);
    setActionError(null);
    const results: BatchResult[] = [];
    for (const line of validBatchLines) {
      try {
        const created = await api.post<CreatedInternalUser>(`/firms/${firmId}/users`, {
          email: line.email,
          name: line.name,
          role: line.role,
        });
        results.push({ line, created, error: null });
      } catch (error) {
        results.push({
          line,
          created: null,
          error: error instanceof Error ? error.message : "No se pudo crear el usuario.",
        });
      }
    }
    setBatchRunning(false);
    setBatchResults(results);
    const okCount = results.filter((item) => item.created).length;
    setNotice(
      `Se crearon ${okCount} de ${results.length} usuarios. Entregá las contraseñas temporales por un canal seguro.`,
    );
    void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
  };
  const downloadBatchCredentials = () => {
    const rows = (batchResults ?? [])
      .filter((item): item is BatchResult & { created: CreatedInternalUser } => Boolean(item.created))
      .map((item) => ({
        name: item.created.name,
        email: item.created.email,
        role: INTERNAL_ROLE_LABELS[item.created.role] ?? item.created.role,
        temporaryPassword: item.created.temporaryPassword,
      }));
    const blob = new Blob([credentialsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "usuarios-temporales.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const createTabs: DenseTab<"single" | "batch">[] = [
    { id: "single", label: "Individual" },
    { id: "batch", label: "En lote" },
  ];
  const primaryLabel = { internal: "Nuevo usuario", portal: "Invitar al portal", standards: "Nueva norma" }[
    tab
  ];

  return (
    <DensePage density={density} className="administration-users">
      <DenseHeader
        eyebrow="Configuración del estudio"
        title="Usuarios y accesos"
        description="El rol define qué módulos internos puede usar cada persona. No hay permisos sueltos: cada cambio queda en la auditoría."
        actions={
          <>
            {tab === "internal" ? (
              <Button size="sm" variant="secondary" onClick={openBatchForm}>
                Alta en lote
              </Button>
            ) : null}
            {tab !== "portal" || clientId ? (
              <Button size="sm" onClick={openNewForTab}>
                <Icon name="plus" size={16} /> {primaryLabel}
              </Button>
            ) : null}
          </>
        }
      />

      {capabilities.has("firm.manage") ? (
        <section className="study-panel self-review-setting" aria-labelledby="self-review-setting-title">
          <div className="study-panel__heading">
            <div>
              <p className="study-page__eyebrow">Control interno</p>
              <h2 id="self-review-setting-title">Permitir autorrevisión de fuentes y expedientes</h2>
              <p>
                Permite que quien importó un lote revise su fuente y que quien preparó un expediente
                lo revise y finalice. La opción reduce el control interno de cuatro ojos; cada
                autorrevisión queda registrada en la auditoría.
              </p>
            </div>
          </div>
          <label className="self-review-setting__toggle">
            <input
              type="checkbox"
              aria-label="Permitir autorrevisión de fuentes y expedientes"
              checked={selfReviewSetting.data?.allowSelfReview ?? false}
              disabled={
                !canManageSelfReview ||
                selfReviewSetting.isLoading ||
                selfReviewSetting.isError ||
                updateSelfReviewSetting.isPending
              }
              onChange={(event) => updateSelfReviewSetting.mutate(event.target.checked)}
            />
            <span>{selfReviewSetting.data?.allowSelfReview ? "Activada" : "Desactivada"}</span>
          </label>
          {!canManageSelfReview ? (
            <small className="muted-copy">Solo el Titular puede cambiar esta opción.</small>
          ) : null}
          {selfReviewSetting.isError ? (
            <p className="form-error" role="alert">
              {selfReviewSetting.error instanceof Error
                ? selfReviewSetting.error.message
                : "No se pudo consultar la configuración de autorrevisión."}
            </p>
          ) : null}
          {updateSelfReviewSetting.isError ? (
            <p className="form-error" role="alert">
              {updateSelfReviewSetting.error instanceof Error
                ? updateSelfReviewSetting.error.message
                : "No se pudo actualizar la configuración de autorrevisión."}
            </p>
          ) : null}
        </section>
      ) : null}

      <StatStrip
        label="Resumen de accesos"
        items={[
          {
            key: "internal",
            label: "Usuarios internos",
            value: internalMembers.data ? allMembers.length : "—",
            active: tab === "internal",
            onSelect: () => setTab("internal"),
          },
          { key: "active", label: "Activos", value: activeInternalMemberCount ?? "—" },
          { key: "suspended", label: "Suspendidos", value: internalMembers.data ? suspendedInternalMemberCount : "—" },
          { key: "owners", label: "Titulares", value: internalMembers.data ? ownerCount : "—" },
          {
            key: "portal",
            label: "Accesos del portal",
            value: activePortalMembershipCount ?? "—",
            detail: clientId ? undefined : "sin cliente",
            active: tab === "portal",
            onSelect: () => setTab("portal"),
          },
          {
            key: "pending",
            label: "Invitaciones pendientes",
            value: pendingInvitationCount ?? "—",
            tone: pendingInvitationCount ? "warn" : undefined,
          },
        ]}
      />

      {notice ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={18} />
          <span>
            <strong>Acción completada</strong>
            <small>{notice}</small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={15} />
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <DenseTabs<AdminTab>
        label="Secciones de usuarios y accesos"
        idPrefix="admin-tab"
        active={tab}
        onChange={(next) => {
          setTab(next);
          setSelectedUserId(null);
        }}
        tabs={[
          { id: "internal", label: "Usuarios internos", count: internalMembers.data ? allMembers.length : undefined },
          { id: "portal", label: "Accesos del portal", count: clientId ? portalRows.length : undefined },
          { id: "standards", label: "Normas contables", count: accountingStandards.data?.length },
        ]}
      />

      <DenseToolbar>
        <DenseSearch
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          placeholder={tab === "standards" ? "Buscar norma…" : "Buscar nombre o email…"}
        />
        {tab === "internal" ? (
          <>
            <select
              className="dense-select"
              aria-label="Filtrar por rol"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">Rol: todos</option>
              {INTERNAL_ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="dense-select"
              aria-label="Filtrar por estado"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "" | "ACTIVE" | "SUSPENDED")}
            >
              <option value="">Estado: todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="SUSPENDED">Suspendidos</option>
            </select>
            <Button
              type="button"
              variant="secondary"
              size="row"
              aria-pressed={showRoles}
              onClick={() => {
                setSelectedUserId(null);
                setShowRoles((current) => !current);
              }}
            >
              Roles y módulos
            </Button>
          </>
        ) : null}
        {tab === "portal" ? (
          <span className="dense-toolbar__hint">
            {clientId
              ? "Accesos del cliente seleccionado en el contexto superior."
              : "El acceso al portal siempre se administra dentro de una empresa cliente."}
          </span>
        ) : null}
        <span className="dense-toolbar__spacer" />
        <DensitySwitch value={density} onChange={setDensity} />
      </DenseToolbar>

      {recoveryLink ? (
        <div className="invitation-link" role="status">
          <p>
            Enlace de recuperación para <strong>{recoverySummary?.memberName}</strong>. Copialo
            ahora: se muestra una sola vez y vence el {recoverySummary?.expiresAt}.
            {recoverySummary && recoverySummary.sessionsRevoked > 0
              ? ` Se cerraron ${recoverySummary.sessionsRevoked} sesión(es) activa(s) del usuario.`
              : " El usuario no tenía sesiones activas abiertas."}{" "}
            Vos no ves ni definís la contraseña: la define el usuario con este enlace.
          </p>
          <input readOnly value={recoveryLink} aria-label="Enlace de recuperación de acceso" />
          <Button size="sm" variant="secondary" onClick={() => void copyRecoveryLink()}>
            Copiar enlace
          </Button>
          <Button size="sm" variant="ghost" onClick={closeRecoveryReceipt}>
            Cerrar
          </Button>
        </div>
      ) : null}
      {tab === "portal" && invitationLink ? (
        <div className="invitation-link" role="status">
          <p>Enlace generado. Copialo ahora; el token no se vuelve a mostrar.</p>
          <input readOnly value={invitationLink} aria-label="Enlace de invitación" />
          <Button size="sm" variant="secondary" onClick={() => void copyInvitationLink()}>
            Copiar enlace
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setInvitationLink(null)}>
            Cerrar
          </Button>
        </div>
      ) : null}

      <DenseWorkspace panelId="admin-tab-panel" inspector={internalInspector}>
        {tableBody}
      </DenseWorkspace>

      <ActionDrawer
        isOpen={showInternalInviteForm}
        onClose={closeInternalDrawer}
        eyebrow="Acceso interno"
        title="Crear usuarios del estudio"
        description="Se genera una contraseña temporal por cuenta, que se muestra una sola vez. Cada persona deberá cambiarla al ingresar."
        size={createMode === "batch" ? "wide" : "default"}
      >
        <DenseTabs<"single" | "batch">
          label="Modo de alta"
          idPrefix="create-user-mode"
          tabs={createTabs}
          active={createMode}
          onChange={setCreateMode}
        />
        <div className="dense-drawer-body">
          {createMode === "single" ? (
            createdInternalUser ? (
              <div className="study-form study-form--compact" role="status">
                <p>
                  Cuenta creada para <strong>{createdInternalUser.email}</strong>.
                </p>
                <Field
                  id="internal-temporary-password"
                  label="Contraseña temporal"
                  type="text"
                  readOnly
                  value={createdInternalUser.temporaryPassword}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(createdInternalUser.temporaryPassword)}
                >
                  Copiar contraseña
                </Button>
                <div className="study-form__actions">
                  <Button type="button" onClick={closeInternalDrawer}>
                    Terminar
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCreatedInternalUser(null)}>
                    Crear otro
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="study-form study-form--compact dense-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setActionError(null);
                  inviteInternal.mutate();
                }}
              >
                <Field
                  id="internal-invite-name"
                  label="Nombre"
                  value={internalName}
                  onChange={(event) => setInternalName(event.target.value)}
                  required
                />
                <Field
                  id="internal-invite-email"
                  label="Email"
                  type="email"
                  value={internalEmail}
                  onChange={(event) => setInternalEmail(event.target.value)}
                  required
                />
                <fieldset className="dense-roles dense-form__full">
                  <legend className="ds-field__label">Rol interno</legend>
                  {INTERNAL_ROLE_OPTIONS.map(([value, label]) => (
                    <label
                      key={value}
                      className={`dense-role${internalRole === value ? " dense-role--on" : ""}`}
                    >
                      <input
                        type="radio"
                        name="internal-role"
                        value={value}
                        checked={internalRole === value}
                        onChange={() => setInternalRole(value)}
                      />
                      <span>
                        <strong>{label}</strong>{" "}
                        <small>
                          · {(INTERNAL_MODULES_BY_ROLE[value] ?? []).length} de {INTERNAL_MODULES.length} módulos
                        </small>
                      </span>
                    </label>
                  ))}
                  <small className="muted-copy">
                    {(INTERNAL_MODULES_BY_ROLE[internalRole] ?? []).join(" · ")}
                  </small>
                </fieldset>
                {inviteInternal.isError && actionError ? (
                  <p className="form-error" role="alert">
                    {actionError}
                  </p>
                ) : null}
                {!internalEmail.trim() || !internalName.trim() ? (
                  <p className="form-submit-hint" role="note">
                    Ingresá nombre y email para poder crear el usuario.
                  </p>
                ) : null}
                <div className="study-form__actions">
                  <Button
                    type="submit"
                    loading={inviteInternal.isPending}
                    disabled={!internalEmail.trim() || !internalName.trim()}
                  >
                    <Icon name="plus" size={17} /> Crear usuario
                  </Button>
                  <Button type="button" variant="ghost" onClick={closeInternalDrawer}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )
          ) : batchResults ? (
            <div className="dense-stack" role="status">
              <p>
                Se crearon <strong>{batchResults.filter((item) => item.created).length}</strong> de{" "}
                {batchResults.length} usuarios. Las contraseñas temporales se muestran una sola vez:
                descargalas ahora.
              </p>
              <div className="dense-batch-preview">
                <table aria-label="Resultado del alta en lote">
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Rol</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map((item) => (
                      <tr key={item.line.line} className={item.error ? "is-bad" : undefined}>
                        <td>
                          <strong>{item.line.name}</strong> <span className="muted-copy">{item.line.email}</span>
                        </td>
                        <td>{INTERNAL_ROLE_LABELS[item.line.role ?? ""] ?? "—"}</td>
                        <td>
                          {item.created ? (
                            <code>{item.created.temporaryPassword}</code>
                          ) : (
                            (item.error ?? "Error")
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="study-form__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={downloadBatchCredentials}
                  disabled={!batchResults.some((item) => item.created)}
                >
                  Descargar CSV
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setBatchText("");
                    closeInternalDrawer();
                  }}
                >
                  Terminar
                </Button>
              </div>
            </div>
          ) : (
            <div className="dense-stack">
              <label className="ds-field">
                <span className="ds-field__label">Una persona por línea: nombre, email, rol</span>
                <textarea
                  className="ds-field__input dense-textarea"
                  rows={6}
                  value={batchText}
                  onChange={(event) => setBatchText(event.target.value)}
                  placeholder={"Lucía Fernández, lucia@estudio.com, Preparador\nMartín Acosta, martin@estudio.com, Revisor"}
                />
                <span className="ds-field__hint">
                  Si falta el rol se asigna Preparador. Podés cambiarlo después desde la tabla.
                </span>
              </label>
              {batchLines.length > 0 ? (
                <div className="dense-batch-preview">
                  <table aria-label="Vista previa del alta en lote">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Email</th>
                        <th>Rol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchLines.map((line) => (
                        <tr key={line.line} className={line.error ? "is-bad" : undefined}>
                          <td>{line.name || "—"}</td>
                          <td>{line.email || "—"}</td>
                          <td>
                            {line.error ? line.error : (INTERNAL_ROLE_LABELS[line.role ?? ""] ?? "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="study-form__actions">
                <Button
                  type="button"
                  loading={batchRunning}
                  disabled={validBatchLines.length === 0}
                  onClick={() => void runBatch()}
                >
                  <Icon name="plus" size={17} /> Crear {validBatchLines.length}{" "}
                  {validBatchLines.length === 1 ? "usuario" : "usuarios"}
                </Button>
                <Button type="button" variant="ghost" onClick={closeInternalDrawer}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </ActionDrawer>

      {clientId ? (
        <ActionDrawer
          isOpen={showInviteForm}
          onClose={() => setShowInviteForm(false)}
          eyebrow="Acceso del cliente"
          title="Invitar al portal"
          description="La invitación vence a los siete días y sólo puede usarse con el correo indicado."
        >
          <form
            className="study-form study-form--compact dense-form"
            onSubmit={(event) => {
              event.preventDefault();
              setActionError(null);
              invite.mutate();
            }}
          >
            <div className="dense-form__full">
              <Field
                id="portal-invite-email"
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <label className="ds-field dense-form__full">
              <span className="ds-field__label">Rol</span>
              <select
                className="ds-field__input"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="OWNER">Titular</option>
                <option value="COLLABORATOR">Colaborador</option>
                <option value="READONLY">Sólo lectura</option>
              </select>
            </label>
            {invite.isError && actionError ? (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="study-form__actions">
              <Button type="submit" loading={invite.isPending} disabled={!email.trim()}>
                <Icon name="plus" size={17} /> Enviar invitación
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowInviteForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </ActionDrawer>
      ) : null}

      <ActionDrawer
        isOpen={showStandardForm}
        onClose={() => {
          setShowStandardForm(false);
          setStandardEditing(null);
          setStandardName("");
        }}
        eyebrow="Parámetro del estudio"
        title={standardEditing ? "Editar norma contable" : "Nueva norma contable"}
        description="El nombre es el valor que se muestra y se guarda en la ficha de clientes. No se precargan normas: el estudio define las suyas."
      >
        <form
          className="study-form study-form--compact"
          onSubmit={(event) => {
            event.preventDefault();
            setActionError(null);
            if (standardEditing)
              updateStandard.mutate({ id: standardEditing.id, name: standardName.trim() });
            else createStandard.mutate();
          }}
        >
          <Field
            id="accounting-standard-name"
            label="Nombre de la norma"
            value={standardName}
            onChange={(event) => setStandardName(event.target.value)}
            maxLength={100}
            required
          />
          {createStandard.isError || updateStandard.isError ? (
            actionError ? (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            ) : null
          ) : null}
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createStandard.isPending || updateStandard.isPending}
              disabled={!standardName.trim()}
            >
              {standardEditing ? "Guardar cambios" : "Crear norma"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowStandardForm(false);
                setStandardEditing(null);
                setStandardName("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>
      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
