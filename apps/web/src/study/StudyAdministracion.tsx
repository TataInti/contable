import { useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { memberRecoveryCopy, memberRowActions } from "./member-row-actions.js";
import { ActionDrawer } from "../ui/ActionDrawer";
import { StudyUserAssignments } from "./StudyUserAssignments";
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
interface FirmProfile {
  legalName: string;
  displayName: string;
  taxId: string | null;
  timezone: string;
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

type AdminTab = "internal" | "portal" | "standards" | "profile" | "controls";

const ARGENTINA_TIME_ZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Catamarca",
  "America/Argentina/Cordoba",
  "America/Argentina/Jujuy",
  "America/Argentina/La_Rioja",
  "America/Argentina/Mendoza",
  "America/Argentina/Rio_Gallegos",
  "America/Argentina/Salta",
  "America/Argentina/San_Juan",
  "America/Argentina/San_Luis",
  "America/Argentina/Tucuman",
  "America/Argentina/Ushuaia",
];

const TIME_ZONE_GROUP_LABELS: Record<string, string> = {
  Africa: "África",
  America: "América",
  Antarctica: "Antártida",
  Arctic: "Ártico",
  Asia: "Asia",
  Atlantic: "Atlántico",
  Australia: "Australia",
  Etc: "Otros",
  Europe: "Europa",
  Indian: "Océano Índico",
  Pacific: "Pacífico",
  UTC: "UTC",
};

interface TimeZoneOption {
  value: string;
  label: string;
}

interface TimeZoneGroup {
  key: string;
  label: string;
  options: TimeZoneOption[];
}

function timeZoneCityName(timeZone: string): string {
  return timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone;
}

const TIME_ZONE_LABEL_CACHE = new Map<string, string>();

function timeZoneLabel(timeZone: string): string {
  const cached = TIME_ZONE_LABEL_CACHE.get(timeZone);
  if (cached) return cached;
  const city = timeZoneCityName(timeZone);
  try {
    const offset = new Intl.DateTimeFormat("es-AR", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    const label = offset ? `${city} (${offset})` : city;
    TIME_ZONE_LABEL_CACHE.set(timeZone, label);
    return label;
  } catch {
    TIME_ZONE_LABEL_CACHE.set(timeZone, city);
    return city;
  }
}

const SUPPORTED_TIME_ZONES =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ARGENTINA_TIME_ZONES;
const TIME_ZONE_OPTIONS = Array.from(
  new Set([...SUPPORTED_TIME_ZONES, "UTC", ...ARGENTINA_TIME_ZONES]),
).sort((left, right) => timeZoneCityName(left).localeCompare(timeZoneCityName(right), "es-AR"));

function groupTimeZones(currentTimeZone?: string): TimeZoneGroup[] {
  const zones = currentTimeZone && !TIME_ZONE_OPTIONS.includes(currentTimeZone)
    ? [...TIME_ZONE_OPTIONS, currentTimeZone]
    : TIME_ZONE_OPTIONS;
  const labelCounts = new Map<string, number>();
  for (const timeZone of zones) {
    const label = timeZoneLabel(timeZone);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const groups = new Map<string, TimeZoneOption[]>();
  for (const timeZone of zones) {
    const key = timeZone.split("/")[0] ?? "UTC";
    const baseLabel = timeZoneLabel(timeZone);
    const parts = timeZone.split("/");
    const qualifier = parts.length > 1 ? parts[parts.length - 2] ?? key : key;
    const label = (labelCounts.get(baseLabel) ?? 0) > 1
      ? `${baseLabel} · ${TIME_ZONE_GROUP_LABELS[qualifier] ?? qualifier.replaceAll("_", " ")}`
      : baseLabel;
    groups.set(key, [...(groups.get(key) ?? []), { value: timeZone, label }]);
  }
  return [...groups.entries()]
    .map(([key, options]) => ({
      key,
      label: TIME_ZONE_GROUP_LABELS[key] ?? key,
      options,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "es-AR"));
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim());
}

function batchUserErrorLabel(error: string): string {
  return error.replace(/\bEmail\b/g, "Correo").replace(/\bemail\b/g, "correo");
}

interface PortalRow {
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

function userMutationError(error: unknown, fallback: string): string {
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
  const [identityEditing, setIdentityEditing] = useState<InternalMember | null>(null);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identitySubmitted, setIdentitySubmitted] = useState(false);
  const [internalRoleDrafts, setInternalRoleDrafts] = useState<Record<string, string>>({});
  const [assigningMember, setAssigningMember] = useState<InternalMember | null>(null);
  const [portalEditing, setPortalEditing] = useState<PortalMembership | null>(null);
  const [portalRoleDraft, setPortalRoleDraft] = useState("READONLY");
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileDraft, setProfileDraft] = useState<FirmProfile | null>(null);
  const [showRoles, setShowRoles] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "ACTIVE" | "SUSPENDED">("");
  const [createMode, setCreateMode] = useState<"single" | "batch">("single");
  const [batchText, setBatchText] = useState("");
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [density, setDensity] = useDensity();
  const identityNameError = identitySubmitted && !identityName.trim() ? "Ingresá el nombre" : undefined;
  const identityEmailError =
    identitySubmitted && !isValidEmail(identityEmail)
      ? "Ingresá un correo válido, por ejemplo nombre@estudio.com"
      : undefined;
  const profileTimeZoneGroups = useMemo(
    () => (profileDraft ? groupTimeZones(profileDraft.timezone) : []),
    [profileDraft?.timezone],
  );
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
  const firmProfile = useQuery({
    queryKey: ["firm-profile", firmId],
    queryFn: () => api.get<FirmProfile>(`/firms/${firmId}/profile`),
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
    onSuccess: (_updated, { userId }) => {
      setActionError(null);
      setInternalRoleDrafts((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      setNotice("El rol del usuario quedó actualizado.");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error, { userId }) => {
      setInternalRoleDrafts((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      setActionError(userMutationError(error, "No se pudo actualizar el rol."));
    },
  });
  const updateMemberIdentity = useMutation({
    mutationFn: ({ userId, name, email: nextEmail }: { userId: string; name: string; email: string }) =>
      api.patch(`/firms/${firmId}/users/${userId}`, { name: name.trim(), email: nextEmail.trim() }),
    onSuccess: () => {
      setActionError(null);
      setNotice("Los datos del usuario quedaron actualizados.");
      setIdentityEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(userMutationError(error, "No se pudieron actualizar los datos del usuario.")),
  });
  const updateFirmProfile = useMutation({
    mutationFn: (profile: FirmProfile) =>
      api.patch<FirmProfile>(`/firms/${firmId}/profile`, {
        legalName: profile.legalName.trim(),
        displayName: profile.displayName.trim(),
        taxId: profile.taxId?.trim() || null,
        timezone: profile.timezone.trim(),
      }),
    onSuccess: (updated) => {
      setActionError(null);
      setNotice("Los datos del estudio quedaron actualizados.");
      setShowProfileForm(false);
      setProfileDraft(null);
      queryClient.setQueryData(["firm-profile", firmId], updated);
    },
    onError: (error) =>
      setActionError(userMutationError(error, "No se pudieron actualizar los datos del estudio.")),
  });
  const suspendInternalMember = useMutation({
    mutationFn: (userId: string) => api.post(`/firms/${firmId}/members/${userId}/suspend`, {}),
    onSuccess: () => {
      setActionError(null);
      setNotice("El usuario quedó suspendido.");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(userMutationError(error, "No se pudo suspender al usuario.")),
  });
  const reactivateInternalMember = useMutation({
    mutationFn: (userId: string) => api.post(`/firms/${firmId}/members/${userId}/reactivate`, {}),
    onSuccess: () => {
      setActionError(null);
      setNotice("El usuario fue reactivado.");
      void queryClient.invalidateQueries({ queryKey: ["internal-members", firmId] });
    },
    onError: (error) =>
      setActionError(userMutationError(error, "No se pudo reactivar al usuario.")),
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
    enabled: Boolean(firmId && clientId && capabilities.has("firm.users.manage")),
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
  const updatePortalMembership = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { role?: string; status?: string };
    }) => api.patch<PortalMembership>(`/firms/${firmId}/clients/${clientId}/portal-memberships/${id}`, patch),
    onSuccess: (_updated, { id, patch }) => {
      setActionError(null);
      if (patch.role !== undefined) {
        setNotice("El rol del acceso al portal quedó actualizado.");
        if (portalEditing?.id === id) setPortalEditing(null);
      } else if (patch.status === "SUSPENDED") {
        setNotice("El acceso al portal quedó suspendido.");
      } else {
        setNotice("El acceso al portal fue reactivado.");
      }
      void queryClient.invalidateQueries({ queryKey: ["portal-memberships", firmId, clientId] });
    },
    onError: (error) =>
      setActionError(userMutationError(error, "No se pudo actualizar el acceso al portal.")),
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

  const pendingInvitationCount = invitations.data?.filter(
    (item) =>
      !item.revokedAt &&
      !item.acceptedAt &&
      new Date(item.expiresAt) >= new Date(),
  ).length;
  const openInternalInviteForm = () => {
    setActionError(null);
    setCreatedInternalUser(null);
    setShowInternalInviteForm(true);
  };
  const openInviteForm = () => {
    setActionError(null);
    setShowInviteForm(true);
  };
  const openIdentityEdit = (item: InternalMember) => {
    setActionError(null);
    setIdentitySubmitted(false);
    setIdentityEditing(item);
    setIdentityName(item.user?.name ?? "");
    setIdentityEmail(item.user?.emailNormalized ?? "");
  };
  const openPortalEdit = (item: PortalMembership) => {
    setActionError(null);
    setPortalEditing(item);
    setPortalRoleDraft(item.role);
  };
  const openProfileEdit = () => {
    if (!firmProfile.data) return;
    setActionError(null);
    setProfileDraft(firmProfile.data);
    setShowProfileForm(true);
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
            aria-label={`Recuperar acceso de ${memberName}`}
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
        {effectiveStatus(item) === "ACTIVE" ? (
          <Button
            size="row"
            variant={variant}
            className="dense-action--danger"
            aria-label={`Suspender a ${memberName}`}
            loading={
              suspendInternalMember.isPending && suspendInternalMember.variables === item.userId
            }
            disabled={anyMemberActionPending}
            onClick={() => {
              setActionError(null);
              setNotice(null);
              suspendInternalMember.mutate(item.userId);
            }}
          >
            Suspender
          </Button>
        ) : null}
        {effectiveStatus(item) === "SUSPENDED" ? (
          <Button
            size="row"
            variant={variant}
            aria-label={`Reactivar acceso de ${memberName}`}
            loading={
              reactivateInternalMember.isPending &&
              reactivateInternalMember.variables === item.userId
            }
            disabled={anyMemberActionPending}
            onClick={() => {
              setActionError(null);
              setNotice(null);
              reactivateInternalMember.mutate(item.userId);
            }}
          >
            Reactivar
          </Button>
        ) : null}
      </>
    );
  };

  const changeRole = (item: InternalMember, nextRole: string) => {
    if (nextRole === item.role) return;
    setActionError(null);
    setNotice(null);
    setInternalRoleDrafts((current) => ({ ...current, [item.userId]: nextRole }));
    updateInternalRole.mutate({ userId: item.userId, role: nextRole });
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
            value={internalRoleDrafts[item.userId] ?? item.role}
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
      key: "status",
      header: "Estado",
      width: "120px",
      sortValue: (item) => effectiveStatus(item),
      render: (item) => <StatusBadge status={effectiveStatus(item)} />,
    },
    {
      key: "actions",
      header: "Acciones",
      width: "180px",
      secondary: true,
      align: "right",
      render: (item) => (
        <span className="dense-row-actions">
          <Button
            size="row"
            variant="secondary"
            aria-label={`Editar a ${item.user?.name ?? "este usuario"}`}
            onClick={() => openIdentityEdit(item)}
          >
            Editar
          </Button>
          <details className="dense-inspector-actions__menu administration-user-actions">
            <summary
              className="dense-inspector-actions__trigger"
              aria-label={`Más acciones de ${item.user?.name ?? "este usuario"}`}
              onClick={(event) => event.stopPropagation()}
            >
              Más acciones
            </summary>
            <div
              className="dense-inspector-actions__items"
              role="group"
              aria-label={`Acciones de ${item.user?.name ?? "este usuario"}`}
            >
              <Button
                size="row"
                variant="ghost"
                aria-label={`Administrar clientes de ${item.user?.name ?? "este usuario"}`}
                onClick={() => setAssigningMember(item)}
              >
                Clientes
              </Button>
              {memberActionButtons(item, "ghost")}
            </div>
          </details>
        </span>
      ),
    },
  ];

  let internalInspector: ReactNode = null;
  if (tab === "internal" && selectedMember) {
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
        footer={
          <span className="dense-row-actions">
            <Button
              size="row"
              variant="secondary"
              aria-label={`Editar a ${selectedMember.user?.name ?? "este usuario"}`}
              onClick={() => openIdentityEdit(selectedMember)}
            >
              Editar
            </Button>
            <Button
              size="row"
              variant="ghost"
              aria-label={`Administrar clientes de ${selectedMember.user?.name ?? "este usuario"}`}
              onClick={() => setAssigningMember(selectedMember)}
            >
              Clientes
            </Button>
            {memberActionButtons(selectedMember, "secondary")}
          </span>
        }
      >
        <InspectorSection title="Acceso">
          <InspectorFacts
            items={[
              ["Rol", INTERNAL_ROLE_LABELS[selectedMember.role] ?? selectedMember.role],
              ["Estado", <StatusBadge key="status" status={effectiveStatus(selectedMember)} />],
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
            El acceso depende del rol; no se asignan permisos por separado. La transferencia de
            titularidad es un cambio de rol. Cada estudio define los módulos disponibles para sus
            usuarios.
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
      membership: item,
      onRevoke: null,
      onToggleStatus: () => {
        setActionError(null);
        setNotice(null);
        updatePortalMembership.mutate({
          id: item.id,
          patch: { status: item.status === "ACTIVE" && !item.revokedAt ? "SUSPENDED" : "ACTIVE" },
        });
      },
      onEdit: () => openPortalEdit(item),
      pending: updatePortalMembership.isPending && updatePortalMembership.variables?.id === item.id,
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
          membership: null,
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
          onToggleStatus: null,
          onEdit: null,
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
      width: "240px",
      align: "right",
      render: (row) => (
        <span className="dense-row-actions">
          {row.onEdit ? (
            <Button
              size="row"
              variant="secondary"
              aria-label={`Editar acceso de ${row.name ?? row.email}`}
              disabled={row.pending}
              onClick={row.onEdit}
            >
              Editar
            </Button>
          ) : null}
          {row.onToggleStatus ? (
            <Button
              size="row"
              variant={row.status === "ACTIVE" ? "ghost" : "secondary"}
              className={row.status === "ACTIVE" ? "dense-action--danger" : undefined}
              aria-label={`${row.status === "ACTIVE" ? "Suspender" : "Reactivar"} acceso de ${row.name ?? row.email}`}
              loading={row.pending}
              onClick={row.onToggleStatus}
            >
              {row.status === "ACTIVE" ? "Suspender" : "Reactivar"}
            </Button>
          ) : null}
          {row.onRevoke ? (
            <Button
              size="row"
              variant="ghost"
              className="dense-action--danger"
              aria-label={`Revocar invitación para ${row.email}`}
              loading={row.pending}
              onClick={row.onRevoke}
            >
              Revocar
            </Button>
          ) : null}
        </span>
      ),
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

  const footerWith = (hint: string) => (
    <>
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
          footer={footerWith("El estudio debe conservar al menos un titular o administrador activo.")}
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
                  : "Probá con otro nombre o correo, o quitá filtros."
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
          footer={footerWith("La invitación vence a los siete días y sólo puede usarse con el correo indicado.")}
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
  } else if (tab === "profile") {
    tableBody =
      queryState(firmProfile.isLoading, "Cargando datos del estudio…") ??
      (firmProfile.isError ? (
        <EmptyState
          title="No se pudieron cargar los datos del estudio"
          description="No asumimos que falten datos mientras la consulta está fallando."
          action={
            <Button size="sm" variant="secondary" onClick={() => void firmProfile.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : firmProfile.data ? (
        <section className="administration-profile" aria-label="Datos del estudio">
          <div className="administration-profile__heading">
            <h2>Datos del estudio</h2>
            <Button size="sm" variant="secondary" onClick={openProfileEdit}>
              Editar datos
            </Button>
          </div>
          <dl className="administration-profile__facts">
            <div>
              <dt>Razón social</dt>
              <dd>{firmProfile.data.legalName || "—"}</dd>
            </div>
            <div>
              <dt>Nombre del estudio</dt>
              <dd>{firmProfile.data.displayName || "—"}</dd>
            </div>
            <div>
              <dt>CUIT</dt>
              <dd>{firmProfile.data.taxId || "—"}</dd>
            </div>
            <div>
              <dt>Zona horaria</dt>
              <dd>{timeZoneLabel(firmProfile.data.timezone)}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <EmptyState
          title="Datos del estudio no disponibles"
          description="Reintentá para consultar la información del estudio."
          action={
            <Button size="sm" variant="secondary" onClick={() => void firmProfile.refetch()}>
              Reintentar
            </Button>
          }
        />
      ));
  } else if (tab === "controls") {
    tableBody = (
      <section className="study-panel self-review-setting" aria-labelledby="self-review-setting-title">
        <div className="self-review-setting__heading">
          <p className="study-page__eyebrow">Control interno</p>
          <h2 className="self-review-setting__title" id="self-review-setting-title">
            Permitir autorrevisión de fuentes y expedientes
          </h2>
          <p>
            Permite que quien importó un lote revise su fuente y que quien preparó un expediente
            lo revise y finalice. La opción reduce el control interno de cuatro ojos; cada
            autorrevisión queda registrada en la auditoría.
          </p>
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
          footer={footerWith("La ficha de cada cliente elige de acá, sin texto libre. Desactivar no altera a los clientes que ya la tienen.")}
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
    } else if (tab === "standards") {
      openStandardForm();
    } else if (tab === "profile") {
      openProfileEdit();
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
  const pageDescriptions: Record<AdminTab, string> = {
    internal: "Administrá las cuentas del estudio, los roles y los clientes asignados.",
    portal: clientId
      ? "Accesos del portal del cliente seleccionado. Para cambiar de cliente, volvé a Inicio."
      : "Elegí un cliente en Inicio para consultar y administrar sus accesos al portal.",
    standards: "Configurá las normas contables que pueden elegir los clientes del estudio.",
    profile: "Consultá y actualizá los datos de identificación y la zona horaria del estudio.",
    controls: "Configurá los controles internos del estudio.",
  };
  const pageDescription = pageDescriptions[tab];
  const adminTabs: DenseTab<AdminTab>[] = [
    { id: "internal", label: "Usuarios internos", count: internalMembers.data ? allMembers.length : undefined },
    { id: "portal", label: "Accesos del portal", count: clientId ? portalRows.length : undefined },
    { id: "standards", label: "Normas contables", count: accountingStandards.data?.length },
    { id: "profile", label: "Datos del estudio" },
    ...(capabilities.has("firm.manage") ? [{ id: "controls" as const, label: "Controles" }] : []),
  ];

  return (
    <DensePage density={density} className="administration-users">
      <DenseHeader
        eyebrow="Configuración del estudio"
        title="Usuarios y accesos"
        description={pageDescription}
        actions={
          <>
            {tab === "internal" ? (
              <>
                <Button size="sm" variant="secondary" onClick={openBatchForm}>
                  Alta en lote
                </Button>
                <Button size="sm" onClick={openNewForTab}>
                  <Icon name="plus" size={16} /> Nuevo usuario
                </Button>
              </>
            ) : null}
            {tab === "portal" && clientId ? (
              <Button size="sm" onClick={openNewForTab}>
                <Icon name="plus" size={16} /> Invitar al portal
              </Button>
            ) : null}
            {tab === "standards" ? (
              <Button size="sm" onClick={openNewForTab}>
                <Icon name="plus" size={16} /> Nueva norma
              </Button>
            ) : null}
          </>
        }
      />

      <StatStrip
        label="Resumen de accesos"
        items={[
          { key: "suspended", label: "Suspendidos", value: internalMembers.data ? suspendedInternalMemberCount : "—" },
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
      {actionError && !identityEditing && !portalEditing && !showProfileForm ? (
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
        tabs={adminTabs}
      />

      {tab !== "profile" && tab !== "controls" ? (
        <DenseToolbar>
          <DenseSearch
            inputRef={searchRef}
            value={search}
            onChange={setSearch}
            placeholder={tab === "standards" ? "Buscar norma…" : "Buscar nombre o correo…"}
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
          <span className="dense-toolbar__spacer" />
          <DensitySwitch value={density} onChange={setDensity} />
        </DenseToolbar>
      ) : null}

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
                  label="Correo"
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
                    Ingresá nombre y correo para poder crear el usuario.
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
                <span className="ds-field__label">Una persona por línea: nombre, correo, rol</span>
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
                        <th>Correo</th>
                        <th>Rol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchLines.map((line) => (
                        <tr key={line.line} className={line.error ? "is-bad" : undefined}>
                          <td>{line.name || "—"}</td>
                          <td>{line.email || "—"}</td>
                          <td>
                            {line.error
                              ? batchUserErrorLabel(line.error)
                              : (INTERNAL_ROLE_LABELS[line.role ?? ""] ?? "—")}
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

      {identityEditing ? (
        <ActionDrawer
          isOpen
          onClose={() => setIdentityEditing(null)}
          eyebrow="Usuario del estudio"
          title="Editar usuario"
          description="Actualizá el nombre y el correo de la cuenta."
          footer={
            <>
              <Button type="submit" form="member-edit-form" loading={updateMemberIdentity.isPending}>
                Guardar cambios
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIdentityEditing(null)}>
                Cancelar
              </Button>
            </>
          }
        >
          <form
            id="member-edit-form"
            className="study-form study-form--compact administration-user-edit-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setIdentitySubmitted(true);
              if (!identityName.trim() || !isValidEmail(identityEmail)) return;
              setActionError(null);
              setNotice(null);
              updateMemberIdentity.mutate({
                userId: identityEditing.userId,
                name: identityName,
                email: identityEmail,
              });
            }}
          >
            <Field
              id="member-edit-name"
              label="Nombre"
              value={identityName}
              onChange={(event) => setIdentityName(event.target.value)}
              error={identityNameError}
              required
            />
            <Field
              id="member-edit-email"
              label="Correo"
              type="email"
              value={identityEmail}
              onChange={(event) => setIdentityEmail(event.target.value)}
              error={identityEmailError}
              required
            />
            {updateMemberIdentity.isError && actionError ? (
              <p className="form-error" role="alert">{actionError}</p>
            ) : null}
          </form>
        </ActionDrawer>
      ) : null}

      {portalEditing ? (
        <ActionDrawer
          isOpen
          onClose={() => setPortalEditing(null)}
          eyebrow="Acceso del portal"
          title="Editar acceso"
          description={`Cambiar el rol de ${portalEditing.user?.name ?? "esta persona"}.`}
        >
          <form
            className="study-form study-form--compact"
            onSubmit={(event) => {
              event.preventDefault();
              setActionError(null);
              setNotice(null);
              updatePortalMembership.mutate({
                id: portalEditing.id,
                patch: { role: portalRoleDraft },
              });
            }}
          >
            <label className="ds-field">
              <span className="ds-field__label">Rol del portal</span>
              <select
                className="ds-field__input"
                value={portalRoleDraft}
                onChange={(event) => setPortalRoleDraft(event.target.value)}
              >
                {Object.entries(PORTAL_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {updatePortalMembership.isError && actionError ? (
              <p className="form-error" role="alert">{actionError}</p>
            ) : null}
            <div className="study-form__actions">
              <Button type="submit" loading={updatePortalMembership.isPending}>
                Guardar cambios
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPortalEditing(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        </ActionDrawer>
      ) : null}

      {showProfileForm && profileDraft ? (
        <ActionDrawer
          isOpen
          onClose={() => {
            setShowProfileForm(false);
            setProfileDraft(null);
          }}
          eyebrow="Configuración del estudio"
          title="Editar datos del estudio"
          description="Actualizá la razón social, el nombre, el CUIT y la zona horaria."
        >
          <form
            className="study-form study-form--compact"
            onSubmit={(event) => {
              event.preventDefault();
              setActionError(null);
              setNotice(null);
              updateFirmProfile.mutate(profileDraft);
            }}
          >
            <Field
              id="firm-profile-legal-name"
              label="Razón social"
              value={profileDraft.legalName}
              onChange={(event) => setProfileDraft({ ...profileDraft, legalName: event.target.value })}
            />
            <Field
              id="firm-profile-display-name"
              label="Nombre del estudio"
              value={profileDraft.displayName}
              onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })}
            />
            <Field
              id="firm-profile-tax-id"
              label="CUIT"
              value={profileDraft.taxId ?? ""}
              onChange={(event) => setProfileDraft({ ...profileDraft, taxId: event.target.value })}
            />
            <label className="ds-field">
              <span className="ds-field__label">Zona horaria</span>
              <select
                id="firm-profile-timezone"
                className="ds-field__input"
                value={profileDraft.timezone}
                onChange={(event) => setProfileDraft({ ...profileDraft, timezone: event.target.value })}
              >
                {profileTimeZoneGroups.map((group) => (
                  <optgroup key={group.key} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {updateFirmProfile.isError && actionError ? (
              <p className="form-error" role="alert">{actionError}</p>
            ) : null}
            <div className="study-form__actions">
              <Button type="submit" loading={updateFirmProfile.isPending}>
                Guardar cambios
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowProfileForm(false);
                  setProfileDraft(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </ActionDrawer>
      ) : null}

      {clientId ? (
        <ActionDrawer
          isOpen={showInviteForm}
          onClose={() => setShowInviteForm(false)}
          eyebrow="Acceso del cliente"
          title="Invitar al portal"
          description="Invitación para el cliente seleccionado. Vence a los siete días y sólo puede usarse con el correo indicado."
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
                label="Correo"
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

      {firmId && assigningMember ? (
        <StudyUserAssignments
          firmId={firmId}
          userId={assigningMember.userId}
          userName={assigningMember.user?.name ?? "este usuario"}
          isOpen
          onClose={() => setAssigningMember(null)}
        />
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
