import { Button } from "@contable/design-system";
import type { DenseColumn } from "../../ui/Dense";
import { formatCuit } from "../../lib/cuit";
import { StatusBadge } from "../../ui/StatusBadge";
import { MONTH_SHORT, configurationGaps, vatLabel } from "./etiquetas";
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
      width: inspectorOpen ? "24%" : "18%",
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
      width: "11%",
      className: "client-list__cuit-column",
      sortValue: (row) => row.cuit,
      render: (row) => <span className="tabular-copy">{formatCuit(row.cuit)}</span>,
    },
    {
      key: "cuitEnding",
      header: "Terminación de CUIT",
      width: "10%",
      className: "client-list__ending-column",
      sortValue: (row) => (row.cuitEnding == null ? 10 : Number(row.cuitEnding)),
      render: (row) =>
        row.cuitEnding == null ? (
          <span className="dense-dim">Sin CUIT</span>
        ) : (
          <span className="tabular-copy">{row.cuitEnding}</span>
        ),
    },
    {
      key: "vat",
      header: "Condición IVA",
      width: inspectorOpen ? "12%" : "10%",
      className: "client-list__vat-column",
      sortValue: (row) => vatLabel(row.profile?.vatCondition),
      render: (row) => vatLabel(row.profile?.vatCondition) || <span className="dense-dim">—</span>,
    },
    {
      key: "province",
      header: "Provincia",
      width: inspectorOpen ? "0%" : "5%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.province ?? "",
      render: (row) => row.profile?.province || <span className="dense-dim">—</span>,
    },
    {
      key: "activity",
      header: "Actividad",
      width: inspectorOpen ? "0%" : "5%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.activity ?? "",
      render: (row) => row.profile?.activity || <span className="dense-dim">—</span>,
    },
    {
      key: "standard",
      header: "Norma",
      width: inspectorOpen ? "0%" : "4%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.accountingStandard ?? "",
      render: (row) => row.profile?.accountingStandard || <span className="dense-dim">—</span>,
    },
    {
      key: "closing",
      header: "Cierre",
      width: inspectorOpen ? "0%" : "4%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.fiscalYearEndMonth ?? 0,
      render: (row) =>
        row.profile?.fiscalYearEndMonth ? (
          MONTH_SHORT[row.profile.fiscalYearEndMonth - 1]
        ) : (
          <span className="dense-dim">—</span>
        ),
    },
    {
      key: "gaps",
      header: "Ficha",
      width: inspectorOpen ? "16%" : "14%",
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
      width: inspectorOpen ? "16%" : "11%",
      className: "client-list__status-column",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "open",
      header: "",
      width: inspectorOpen ? "13%" : "9%",
      className: "client-list__action-column",
      sticky: "right",
      align: "right",
      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
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
