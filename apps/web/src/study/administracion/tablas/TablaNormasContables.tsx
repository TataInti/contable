import { Button, EmptyState } from "@contable/design-system";
import { DenseTable, type DenseColumn, normalizeSearch } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import type { AccountingStandardRow } from "../tipos";
import { footerWith } from "./pieDeTabla";

type Props = {
  accountingStandards: { data?: AccountingStandardRow[] };
  searchQuery: string;
  openStandardEdit: (row: AccountingStandardRow) => void;
  updateStandard: { isPending: boolean; variables?: { id: string; name?: string; isActive?: boolean } };
  toggleStandard: (row: AccountingStandardRow) => void;
};

export function TablaNormasContables({ accountingStandards, searchQuery, openStandardEdit, updateStandard, toggleStandard }: Props) {
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

  return (
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
  );
}
