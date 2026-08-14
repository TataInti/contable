import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api, type FeatureFlag } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
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

export function StudyAdministracion() {
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("OWNER");
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const flags = useQuery({
    queryKey: ["flags", firmId],
    queryFn: () => api.get<FeatureFlag[]>(`/firms/${firmId}/feature-flags`),
    enabled: Boolean(firmId && capabilities.has("firm.manage")),
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
  const updateFlag = useMutation({
    mutationFn: (flag: FeatureFlag) =>
      api.put(`/firms/${firmId}/feature-flags/${flag.code}`, { enabled: !flag.enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["flags", firmId] }),
  });
  const invite = useMutation({
    mutationFn: () =>
      api.post<CreatedInvitation>(`/firms/${firmId}/clients/${clientId}/portal-invitations`, {
        email,
        role,
      }),
    onSuccess: (created) => {
      setInvitationLink(
        `${window.location.origin}/aceptar-invitacion?token=${encodeURIComponent(created.invitationToken)}`,
      );
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["portal-invitations", firmId, clientId] });
    },
  });
  const revokeMembership = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/portal-memberships/${id}/revoke`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["portal-memberships", firmId, clientId] }),
  });

  if (!capabilities.has("firm.manage"))
    return (
      <div className="study-page">
        <EmptyState
          title="Acceso restringido"
          description="Sólo owners y administradores pueden cambiar la configuración del estudio."
        />
      </div>
    );
  return (
    <div className="study-page">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Configuración del estudio</p>
          <h1 className="study-page__title">Administración</h1>
          <p className="study-page__subtitle">
            Gestioná accesos al portal y módulos habilitados para el contexto actual.
          </p>
        </div>
      </div>
      <section className="study-panel">
        <div className="study-panel__heading">
          <div>
            <h2>Acceso del cliente</h2>
            <p>La invitación vence a los siete días y sólo puede usarse con el correo indicado.</p>
          </div>
        </div>
        {!clientId ? (
          <EmptyState title="Seleccioná un cliente" />
        ) : (
          <>
            <form
              className="study-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
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
                  className="ctxbar__input"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  <option value="OWNER">Titular</option>
                  <option value="COLLABORATOR">Colaborador</option>
                  <option value="READONLY">Sólo lectura</option>
                </select>
              </label>
              <Button type="submit" loading={invite.isPending} disabled={!email}>
                <Icon name="plus" size={17} /> Invitar
              </Button>
            </form>
            {invite.isError ? (
              <p className="form-error" role="alert">
                {invite.error.message}
              </p>
            ) : null}
            {invitationLink ? (
              <div className="invitation-link" role="status">
                <p>Enlace generado. Copialo ahora; el token no se vuelve a mostrar.</p>
                <input readOnly value={invitationLink} aria-label="Enlace de invitación" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(invitationLink)}
                >
                  Copiar enlace
                </Button>
              </div>
            ) : null}
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
                        <strong>{item.user.name}</strong>
                        <br />
                        <small>{item.user.emailNormalized}</small>
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
                          loading={revokeMembership.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Revocar el acceso de ${item.user.name}? Perderá acceso al portal de inmediato.`,
                              )
                            )
                              revokeMembership.mutate(item.id);
                          }}
                        >
                          Revocar
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ) : null}
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
                  ]}
                />
              </div>
            ) : null}
          </>
        )}
      </section>
      <section className="study-page__section">
        <h2 className="study-page__section-title">Módulos</h2>
        {flags.isLoading ? (
          <div className="query-state">
            <span className="loading-copy">Cargando módulos…</span>
          </div>
        ) : flags.isError ? (
          <EmptyState title="No se pudo cargar la configuración" />
        ) : (flags.data?.length ?? 0) === 0 ? (
          <EmptyState title="Sin módulos configurados" />
        ) : (
          <Table<FeatureFlag>
            rows={flags.data ?? []}
            rowKey={(flag) => flag.id}
            columns={[
              { key: "code", header: "Módulo", render: (flag) => flag.code },
              {
                key: "enabled",
                header: "Estado",
                render: (flag) => <StatusBadge status={flag.enabled ? "ACTIVE" : "DISABLED"} />,
              },
              {
                key: "action",
                header: "Acción",
                render: (flag) => (
                  <Button
                    size="sm"
                    variant={flag.enabled ? "danger" : "secondary"}
                    loading={updateFlag.isPending}
                    onClick={() => {
                      if (
                        !flag.enabled ||
                        window.confirm(
                          `¿Deshabilitar ${flag.code}? La función dejará de estar disponible para este estudio.`,
                        )
                      )
                        updateFlag.mutate(flag);
                    }}
                  >
                    {flag.enabled ? "Deshabilitar" : "Habilitar"}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </section>
    </div>
  );
}
