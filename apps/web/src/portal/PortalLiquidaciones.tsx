import { useQuery } from "@tanstack/react-query";
import { EmptyState, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { formatPortalDate, PortalLoading, PortalPageHeader } from "./PortalUI";
import "./portal.css";

/**
 * Liquidaciones publicadas (Puerta 3, G3-11).
 *
 * El portal sólo ve liquidaciones FINALIZED (publicadas por el estudio).
 * Puede descargar el papel de trabajo (artifact) cuando existe.
 */

interface PublishedSettlement {
  id: string;
  version: number;
  status: string;
  cutoff: string;
  totals: Record<string, string> | null;
  period?: { label: string | null; startDate: string; endDate: string };
  regime?: { code: string; name: string; taxType?: { code: string; name: string } };
  filings?: Array<{ filedAt: string; amountFiled: string; externalId: string | null }>;
  payments?: Array<{ paidAt: string; amount: string; method: string }>;
}

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

export function PortalLiquidaciones() {
  const { clientId } = useClientContext();
  const query = useQuery({
    queryKey: ["portal-tax-settlements", clientId],
    queryFn: () => api.get<PublishedSettlement[]>(`/portal/clients/${clientId}/tax-settlements`),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Impuestos"
        title="Liquidaciones publicadas"
        description="Resultados finalizados que tu estudio compartió con vos."
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar sus liquidaciones."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando liquidaciones…" />
      ) : query.isError ? (
        <EmptyState
          title="No pudimos cargar las liquidaciones"
          description="Reintentá en unos minutos."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin liquidaciones publicadas"
          description="Cuando tu estudio finalice una liquidación, aparecerá acá."
        />
      ) : (
        <section className="portal-page__section" aria-labelledby="settlements-title">
          <div className="portal-section-bar">
            <div>
              <h2 id="settlements-title">Resultados finalizados</h2>
              <p>Podés descargar el papel de trabajo de cada período.</p>
            </div>
          </div>
          <Table<PublishedSettlement>
            className="portal-data-table"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "periodo",
                header: "Período",
                render: (row) => row.period?.startDate ?? "—",
              },
              {
                key: "impuesto",
                header: "Impuesto",
                render: (row) => row.regime?.taxType?.name ?? row.regime?.code ?? "—",
              },
              {
                key: "version",
                header: "Versión",
                render: (row) => `v${row.version}`,
              },
              {
                key: "estado",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "total",
                header: "Total a ingresar",
                align: "right",
                render: (row) => formatMoney(row.totals?.["TOTAL_A_INGRESAR"] ?? row.totals?.["totalDue"]),
              },
              {
                key: "presentacion",
                header: "Presentación",
                render: (row) => {
                  const filing = row.filings?.[0];
                  return filing ? formatPortalDate(filing.filedAt) : "—";
                },
              },
              {
                key: "pago",
                header: "Pago",
                render: (row) => {
                  const payment = row.payments?.[0];
                  return payment ? formatMoney(payment.amount) : "—";
                },
              },
            ]}
            empty="Sin liquidaciones publicadas."
          />
        </section>
      )}
    </div>
  );
}