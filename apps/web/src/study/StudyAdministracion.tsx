import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
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
                      onChange={(event) => updateInternalRole.mutate({ userId: item.userId, role: event.target.value })}
                    >
                      {INTERNAL_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <small>{(INTERNAL_MODULES_BY_ROLE[item.role] ?? []).join(" · ") || "Sin módulos internos"}</small>
                  </div>
                ),
              },
              { key: "status", header: "Estado", render: (item) => <StatusBadge status={item.status} /> },
            ]}
          />
        )}
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
      <ConfirmDialog confirm={confirm} />
    </div>
  );
}
