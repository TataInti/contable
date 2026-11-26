import { Button } from "@contable/design-system";
import type { DenseColumn } from "../../ui/Dense";
import { formatCuit } from "../../lib/cuit";
import { StatusBadge } from "../../ui/StatusBadge";
import { configurationGaps, vatLabel, vatShort } from "./etiquetas";
import type { ClientWithProfile } from "./tipos";

interface ColumnasCarteraProps {
  openConfiguration: (id: string, step: string) => void;
  inspectorOpen: boolean;
  clientId: string | null;
  openClientWorkspace: (id: string) => void;
  openClientSummary: (id: string) => void;
}

export function columnasCartera({
  inspectorOpen,
  clientId,
  openClientWorkspace,
  openClientSummary,
  openConfiguration,
}: ColumnasCarteraProps): DenseColumn<ClientWithProfile>[] {
  const columns: DenseColumn<ClientWithProfile>[] = [
    {
      key: "legalName",
      header: "Cliente",
      width: inspectorOpen ? "40%" : "30%",
      className: "client-list__client-column",
      sortValue: (row) => row.legalName.toLocaleLowerCase("es-AR"),
      render: (row) => (
        <Button
          type="button"
          variant="text"
          size="row"
          className="dense-name-action"
          aria-label={row.legalName}
          title={`${row.legalName}${row.tradeName ? ` — ${row.tradeName}` : ""}`}
          aria-current={clientId === row.id ? "true" : undefined}
          onClick={() => openClientWorkspace(row.id)}
        >
          <span className="dense-avatar" aria-hidden="true">
            {row.legalName.slice(0, 1).toLocaleUpperCase("es-AR")}
          </span>
          <span className="dense-name__text">
            <strong>{row.legalName}</strong>
            {row.tradeName || clientId === row.id ? (
              <span className="dense-name__secondary">
                {row.tradeName ? <small>{row.tradeName}</small> : null}
                {clientId === row.id ? <span className="dense-tag dense-tag--context">En contexto</span> : null}
              </span>
            ) : null}
          </span>
        </Button>
      ),
    },
    {
      key: "cuit",
      header: "CUIT",
      width: "14%",
      className: "client-list__cuit-column",
      secondary: true,
      sortValue: (row) => row.cuit,
      render: (row) =>
        !row.cuit ? (
          <span className="dense-dim">Sin CUIT</span>
        ) : (
          <span className="tabular-copy">{formatCuit(row.cuit)}</span>
        ),
    },
    {
      key: "vat",
      header: "Condición IVA",
      width: "13%",
      className: "client-list__vat-column",
      secondary: true,
      sortValue: (row) => vatLabel(row.profile?.vatCondition),
      render: (row) =>
        row.profile?.vatCondition ? (
          <span title={vatLabel(row.profile.vatCondition)}>{vatShort(row.profile.vatCondition)}</span>
        ) : (
          <span className="dense-dim">—</span>
        ),
    },
    {
      key: "province",
      header: "Provincia",
      width: "13%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.province ?? "",
      render: (row) => row.profile?.province || <span className="dense-dim">—</span>,
    },
    {
      key: "gaps",
      header: "Ficha",
      width: inspectorOpen ? "30%" : "18%",
      className: "client-list__profile-column",
      sortValue: (row) => configurationGaps(row).length,
      render: (row) => {
        const gaps = configurationGaps(row);
        return gaps.length === 0 ? (
          <span className="dense-dim">Completa</span>
        ) : (
          <Button type="button" variant="text" size="row" className="client-list__gaps" title={`Falta: ${gaps.map((gap) => gap.label).join(", ")}`} onClick={(event) => { event.stopPropagation(); openConfiguration(row.id, gaps[0]!.step); }}>
            <span>
              Falta: {gaps.slice(0, 2).map((gap) => gap.label).join(", ")}
              {gaps.length > 2 ? ` y ${gaps.length - 2} más` : ""}
            </span>
          </Button>
        );
      },
    },
    {
      key: "status",
      header: "Cuenta",
      width: inspectorOpen ? "16%" : "12%",
      className: "client-list__status-column",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "open",
      header: "",
      width: inspectorOpen ? "14%" : "8%",
      className: "client-list__action-column",
      sticky: "right",
      align: "right",
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Abrir ficha de ${row.legalName}`}
          onClick={(event) => {
            event.stopPropagation();
            openClientSummary(row.id);
          }}
        >
          Abrir
        </Button>
      ),
    },
  ];
  return columns;
}
