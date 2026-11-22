import { Button, EmptyState, SearchSelect } from "@contable/design-system";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { DenseTable, type DenseColumn } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { INTERNAL_ROLE_LABELS, INTERNAL_ROLE_OPTIONS, type InternalMember } from "../tipos";
import { initials } from "../utilidades";
import { footerWith } from "./pieDeTabla";

type Props = {
  allMembers: InternalMember[];
  visibleMembers: InternalMember[];
  selectedUserId: string | null;
  setSelectedUserId: Dispatch<SetStateAction<string | null>>;
  internalInspector: ReactNode;
  internalRoleDrafts: Record<string, string>;
  updateInternalRole: { isPending: boolean; variables?: { userId: string; role: string } };
  changeRole: (item: InternalMember, nextRole: string) => void;
  effectiveStatus: (item: InternalMember) => string;
};

export function TablaUsuariosInternos({
  allMembers,
  visibleMembers,
  selectedUserId,
  setSelectedUserId,
  internalInspector,
  internalRoleDrafts,
  updateInternalRole,
  changeRole,
  effectiveStatus,
}: Props) {
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
          <SearchSelect
            id={`internal-role-${item.userId}`}
            label={`Rol de ${item.user?.name ?? "usuario eliminado"}`}
            hideLabel
            className="dense-select dense-select--inline"
            value={internalRoleDrafts[item.userId] ?? item.role}
            disabled={updateInternalRole.isPending && updateInternalRole.variables?.userId === item.userId}
            onChange={(value) => changeRole(item, value)}
            allowEmpty={false}
            options={INTERNAL_ROLE_OPTIONS.map(([value, label]) => ({ value, label }))}
          />
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
            onClick={(event) => {
              event.stopPropagation();
              setSelectedUserId(item.userId);
            }}
          >
            Editar
          </Button>
        </span>
      ),
    },
  ];

  return (
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
  );
}
