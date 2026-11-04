import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { memberActionCopy, memberRecoveryCopy, memberRowActions, roleChangeCopy } from "./member-row-actions.js";
import { ActionDrawer } from "../ui/ActionDrawer";
import { SectionIndex } from "../ui/SectionIndex";
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
  const confirm = useConfirmAction();
  const internalMembers = useQuery({
    queryKey: ["internal-members", firmId],
    queryFn: () => api.get<InternalMember[]>(`/firms/${firmId}/members`),
    enabled: Boolean(firmId && capabilities.has("firm.users.manage")),
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
  return (
    <div className="study-page">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Configuración del estudio</p>
          <h1 className="study-page__title">Usuarios y accesos</h1>
          <p className="study-page__subtitle">
            Gestioná las personas del estudio. El rol define qué módulos internos puede usar cada usuario.
          </p>
        </div>
      </div>
      <SectionIndex
        items={[
          { id: "admin-context-title", label: "Resumen" },
          { id: "internal-users-title", label: "Usuarios internos" },
          { id: "portal-access-title", label: "Accesos del portal" },
          { id: "accounting-standards-title", label: "Normas contables" },
        ]}
      />
      {notice ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={18} />
          <span>
            <strong>Acción completada</strong>
            <small>{notice}</small>
          </span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <section className="study-panel administration-context" aria-labelledby="admin-context-title">
        <div className="administration-context__heading">
          <div>
            <p className="study-page__eyebrow">Contexto operativo</p>
            <h2 id="admin-context-title">Resumen de accesos</h2>
            <p>Los módulos habilitados para el estudio se definen en administración general; acá se asignan por rol.</p>
          </div>
          <StatusBadge status={clientId ? "ACTIVE" : "PENDING"} />
        </div>
        <dl className="administration-context__facts">
          <div><dt>Cliente</dt><dd>{clientId ? "Seleccionado" : "Sin seleccionar"}</dd></div>
          <div><dt>Usuarios internos</dt><dd>{activeInternalMemberCount ?? "—"}</dd></div>
          <div><dt>Accesos del portal</dt><dd>{activePortalMembershipCount ?? "—"}</dd></div>
          <div><dt>Invitaciones pendientes</dt><dd>{pendingInvitationCount ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="administration-next-step" aria-labelledby="admin-next-step-title">
        <div>
          <p className="study-page__eyebrow">Flujo guiado</p>
          <h2 id="admin-next-step-title">Próximo paso</h2>
          <p>{activeInternalMemberCount ? "Podés crear otra cuenta o ajustar el rol de un usuario interno." : "Todavía no hay usuarios internos activos en este estudio."}</p>
        </div>
        <Button onClick={openInternalInviteForm}>
          <Icon name="plus" size={17} /> Crear usuario
        </Button>
      </section>

      <section className="study-panel administration-operational-section" aria-labelledby="internal-users-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="internal-users-title">Usuarios internos</h2>
            <p>El rol es la fuente de verdad del acceso a módulos internos. No se asignan permisos sueltos por persona.</p>
          </div>
          <Button size="sm" onClick={openInternalInviteForm}>
            <Icon name="plus" size={17} /> Crear usuario
          </Button>
        </div>
        <ActionDrawer
          isOpen={showInternalInviteForm}
          onClose={() => { setShowInternalInviteForm(false); setCreatedInternalUser(null); }}
          eyebrow="Acceso interno"
          title="Crear usuario del estudio"
          description="Se generará una contraseña temporal que deberás entregar una sola vez. El usuario tendrá que cambiarla al ingresar."
        >
          {createdInternalUser ? (
            <div className="study-form study-form--compact" role="status">
              <p>Cuenta creada para <strong>{createdInternalUser.email}</strong>.</p>
              <Field id="internal-temporary-password" label="Contraseña temporal" type="text" readOnly value={createdInternalUser.temporaryPassword} />
              <Button type="button" variant="secondary" onClick={() => void navigator.clipboard.writeText(createdInternalUser.temporaryPassword)}>Copiar contraseña</Button>
              <Button type="button" onClick={() => { setCreatedInternalUser(null); setShowInternalInviteForm(false); }}>Terminar</Button>
            </div>
          ) : (
          <form
            className="study-form study-form--compact"
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
            <label className="ds-field">
              <span className="ds-field__label">Rol interno</span>
              <select className="ds-field__input" value={internalRole} onChange={(event) => setInternalRole(event.target.value)}>
                {INTERNAL_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {inviteInternal.isError && actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
            <div className="study-form__actions">
              <Button type="submit" loading={inviteInternal.isPending} disabled={!internalEmail.trim() || !internalName.trim()}>
                <Icon name="plus" size={17} /> Crear usuario
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowInternalInviteForm(false)}>Cancelar</Button>
            </div>
          </form>
          )}
        </ActionDrawer>
        {internalMembers.isLoading ? (
          <div className="query-state" role="status"><span className="loading-copy">Cargando usuarios internos…</span></div>
        ) : internalMembers.isError ? (
          <EmptyState
            title="No se pudieron cargar los usuarios"
            description="No asumimos que no haya usuarios mientras la consulta está fallando."
            action={<Button size="sm" variant="secondary" onClick={() => void internalMembers.refetch()}>Reintentar</Button>}
          />
        ) : (internalMembers.data?.length ?? 0) === 0 ? (
          <EmptyState title="Todavía no hay usuarios internos" description="Creá la primera cuenta del estudio para asignarle un rol." />
        ) : (
          <Table<InternalMember>
            rows={internalMembers.data ?? []}
            rowKey={(item) => item.id}
            columns={[
              {
                key: "person",
                header: "Persona",
                render: (item) => <><strong>{item.user?.name ?? "Usuario eliminado"}</strong><br /><small>{item.user?.emailNormalized ?? "—"}</small></>,
              },
              {
                key: "role",
                header: "Rol y acceso",
                render: (item) => (
                  <div className="internal-access-cell">
                    <label className="sr-only" htmlFor={`internal-role-${item.userId}`}>Rol de {item.user?.name ?? "usuario eliminado"}</label>
                    <select
                      id={`internal-role-${item.userId}`}
                      className="ds-field__input"
                      value={item.role}
                      disabled={updateInternalRole.isPending && updateInternalRole.variables?.userId === item.userId}
                      onChange={(event) => {
                        const nextRole = event.target.value;
                        if (nextRole === item.role) return;
                        const copy = roleChangeCopy(item.user?.name ?? "este usuario", item.role, nextRole);
                        confirm.ask({
                          title: copy.title,
                          description: copy.description,
                          confirmLabel: "Cambiar rol",
                          tone: item.role === "OWNER" ? "danger" : "default",
                          onConfirm: () => updateInternalRole.mutate({ userId: item.userId, role: nextRole }),
                        });
                      }}
                    >
                      {INTERNAL_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <small>{(INTERNAL_MODULES_BY_ROLE[item.role] ?? []).join(" · ") || "Sin módulos internos"}</small>
                  </div>
                ),
              },
              { key: "status", header: "Estado", render: (item) => <StatusBadge status={item.user?.status ?? item.status} /> },
              {
                key: "actions",
                header: "Acciones",
                render: (item) => {
                  const actions = memberRowActions({
                    role: item.role,
                    membershipStatus: item.status,
                    userStatus: item.user?.status,
                  });
                  const memberName = item.user?.name ?? "este usuario";
                  const anyPending =
                    suspendInternalMember.isPending ||
                    reactivateInternalMember.isPending ||
                    createAccessRecovery.isPending;
                  return (
                    <div className="internal-access-cell">
                      {actions.includes("suspend") ? (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={suspendInternalMember.isPending && suspendInternalMember.variables?.userId === item.userId}
                          disabled={anyPending}
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
                      {actions.includes("recover-access") ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={createAccessRecovery.isPending && createAccessRecovery.variables?.userId === item.userId}
                          disabled={anyPending}
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
                      {actions.includes("reactivate") ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={reactivateInternalMember.isPending && reactivateInternalMember.variables?.userId === item.userId}
                          disabled={anyPending}
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
                    </div>
                  );
                },
              },
            ]}
          />
        )}
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
      </section>

      <section className="study-panel administration-operational-section" aria-labelledby="portal-access-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="portal-access-title">Accesos del portal</h2>
            <p>La invitación vence a los siete días y sólo puede usarse con el correo indicado.</p>
          </div>
          {clientId ? (
            <Button size="sm" onClick={openInviteForm}>
              <Icon name="plus" size={17} /> Invitar al portal
            </Button>
          ) : null}
        </div>
        {!clientId ? (
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
          <>
            <ActionDrawer
              isOpen={showInviteForm}
              onClose={() => setShowInviteForm(false)}
              eyebrow="Acceso del cliente"
              title="Invitar al portal"
              description="La invitación vence a los siete días y sólo puede usarse con el correo indicado."
            >
              <form
                className="study-form study-form--compact"
                onSubmit={(event) => {
                  event.preventDefault();
                  setActionError(null);
                  invite.mutate();
                }}
              >
                <Field
                  id="portal-invite-email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <label className="ds-field">
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
                {invite.isError && actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
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
            {invitationLink ? (
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
            {memberships.isLoading || invitations.isLoading ? (
              <div className="query-state query-state--compact" role="status">
                <span className="loading-copy">Actualizando accesos del portal…</span>
              </div>
            ) : memberships.isError || invitations.isError ? (
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
              <>
                {(memberships.data?.length ?? 0) > 0 ? (
                  <Table<PortalMembership>
                    rows={memberships.data ?? []}
                    rowKey={(item) => item.id}
                    columns={[
                      {
                        key: "person",
                        header: "Persona",
                        render: (item) => (
                          <>
                            <strong>{item.user?.name ?? "Usuario eliminado"}</strong>
                            <br />
                            <small>{item.user?.emailNormalized ?? "—"}</small>
                          </>
                        ),
                      },
                      { key: "role", header: "Rol", render: (item) => item.role },
                      {
                        key: "status",
                        header: "Estado",
                        render: (item) => (
                          <StatusBadge status={item.revokedAt ? "REVOKED" : item.status} />
                        ),
                      },
                      {
                        key: "action",
                        header: "Acción",
                        render: (item) =>
                          !item.revokedAt ? (
                            <Button
                              size="sm"
                              variant="danger"
                              loading={
                                revokeMembership.isPending && revokeMembership.variables === item.id
                              }
                              onClick={() =>
                                confirm.ask({
                                  title: `¿Revocar el acceso de ${item.user?.name ?? "este usuario"}?`,
                                  description:
                                    "Perderá acceso al portal de inmediato. La acción queda registrada en la auditoría.",
                                  confirmLabel: "Revocar acceso",
                                  tone: "danger",
                                  onConfirm: () => revokeMembership.mutate(item.id),
                                })
                              }
                            >
                              Revocar
                            </Button>
                          ) : null,
                      },
                    ]}
                  />
                ) : (
                  <EmptyState
                    size="compact"
                    title="Todavía nadie tiene acceso"
                    description="Usá el formulario anterior para habilitar el portal a una persona del cliente."
                  />
                )}
                {(invitations.data?.length ?? 0) > 0 ? (
                  <div className="administration-subsection">
                    <h3>Invitaciones recientes</h3>
                    <Table<PortalInvitation>
                      rows={invitations.data ?? []}
                      rowKey={(item) => item.id}
                      columns={[
                        { key: "email", header: "Email", render: (item) => item.emailNormalized },
                        { key: "role", header: "Rol", render: (item) => item.role },
                        {
                          key: "status",
                          header: "Estado",
                          render: (item) => (
                            <StatusBadge
                              status={
                                item.revokedAt
                                  ? "REVOKED"
                                  : item.acceptedAt
                                    ? "ACCEPTED"
                                    : new Date(item.expiresAt) < new Date()
                                      ? "EXPIRED"
                                      : "PENDING"
                              }
                            />
                          ),
                        },
                        {
                          key: "action",
                          header: "Acción",
                          render: (item) => {
                            const pending =
                              !item.revokedAt &&
                              !item.acceptedAt &&
                              new Date(item.expiresAt) >= new Date();
                            return pending ? (
                              <Button
                                size="sm"
                                variant="danger"
                                loading={
                                  revokeInvitation.isPending &&
                                  revokeInvitation.variables === item.id
                                }
                                onClick={() =>
                                  confirm.ask({
                                    title: `¿Revocar la invitación para ${item.emailNormalized}?`,
                                    description:
                                      "El enlace dejará de funcionar y la persona no podrá aceptar la invitación.",
                                    confirmLabel: "Revocar invitación",
                                    tone: "danger",
                                    onConfirm: () => revokeInvitation.mutate(item.id),
                                  })
                                }
                              >
                                Revocar
                              </Button>
                            ) : null;
                          },
                        },
                      ]}
                    />
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </section>

      <section className="study-panel administration-operational-section" aria-labelledby="accounting-standards-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="accounting-standards-title">Normas contables</h2>
            <p>
              Catálogo propio del estudio. La ficha de cada cliente selecciona de acá, sin texto
              libre. Desactivar una norma no altera a los clientes que ya la tienen asignada.
            </p>
          </div>
          <Button size="sm" onClick={openStandardForm}>
            <Icon name="plus" size={17} /> Nueva norma
          </Button>
        </div>
        <ActionDrawer
          isOpen={showStandardForm}
          onClose={() => { setShowStandardForm(false); setStandardEditing(null); setStandardName(""); }}
          eyebrow="Parámetro del estudio"
          title={standardEditing ? "Editar norma contable" : "Nueva norma contable"}
          description="El nombre es el valor que se muestra y se guarda en la ficha de clientes. No se precargan normas: el estudio define las suyas."
        >
          <form
            className="study-form study-form--compact"
            onSubmit={(event) => {
              event.preventDefault();
              setActionError(null);
              if (standardEditing) updateStandard.mutate({ id: standardEditing.id, name: standardName.trim() });
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
              actionError ? <p className="form-error" role="alert">{actionError}</p> : null
            ) : null}
            <div className="study-form__actions">
              <Button type="submit" loading={createStandard.isPending || updateStandard.isPending} disabled={!standardName.trim()}>
                {standardEditing ? "Guardar cambios" : "Crear norma"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setShowStandardForm(false); setStandardEditing(null); setStandardName(""); }}>
                Cancelar
              </Button>
            </div>
          </form>
        </ActionDrawer>
        {accountingStandards.isLoading ? (
          <div className="query-state" role="status"><span className="loading-copy">Cargando normas contables…</span></div>
        ) : accountingStandards.isError ? (
          <EmptyState
            title="No se pudieron cargar las normas contables"
            description="No asumimos que no haya normas mientras la consulta está fallando."
            action={<Button size="sm" variant="secondary" onClick={() => void accountingStandards.refetch()}>Reintentar</Button>}
          />
        ) : (accountingStandards.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Todavía no hay normas contables"
            description="Creá las normas que usa el estudio para poder seleccionarlas en la ficha de clientes."
          />
        ) : (
          <Table<AccountingStandardRow>
            rows={accountingStandards.data ?? []}
            rowKey={(item) => item.id}
            columns={[
              { key: "name", header: "Norma", render: (item) => item.name },
              {
                key: "status",
                header: "Estado",
                render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
              },
              {
                key: "action",
                header: "Acción",
                render: (item) => (
                  <div className="study-form__actions">
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
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
      <ConfirmDialog confirm={confirm} />
    </div>
  );
}
