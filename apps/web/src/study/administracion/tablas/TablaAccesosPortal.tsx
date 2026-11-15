import { Button, EmptyState } from "@contable/design-system";
import type { useConfirmAction } from "../../../ui/ConfirmAction";
import { formatearFechaHora } from "../../../lib/formatoFechas";
import { DenseTable, type DenseColumn, normalizeSearch } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { PORTAL_ROLE_LABELS, type PortalInvitation, type PortalMembership, type PortalRow } from "../tipos";
import { initials } from "../utilidades";
import { footerWith } from "./pieDeTabla";

export function filasDelPortal({
  memberships,
  invitations,
  searchQuery,
  updatePortalMembership,
  openPortalEdit,
  setActionError,
  confirm,
  revokeInvitation,
}: {
  memberships: { data?: PortalMembership[] };
  invitations: { data?: PortalInvitation[] };
  searchQuery: string;
  updatePortalMembership: {
    isPending: boolean;
    variables?: { id: string; patch: { role?: string; status?: string } };
    mutate: (variables: { id: string; patch: { role?: string; status?: string } }) => void;
  };
  openPortalEdit: (item: PortalMembership) => void;
  setActionError: (value: string | null) => void;
  confirm: ReturnType<typeof useConfirmAction>;
  revokeInvitation: { isPending: boolean; variables?: string; mutate: (id: string) => void };
}): PortalRow[] {
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
          detail: isPending ? `vence ${formatearFechaHora(item.expiresAt)}` : undefined,
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
  return portalRows;
}

export function TablaAccesosPortal({ portalRows }: { portalRows: PortalRow[] }) {
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

  return (
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
  );
}
