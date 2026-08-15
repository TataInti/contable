import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

/**
 * Liquidaciones fiscales (Puerta 3, G3-10).
 *
 * Worklist de liquidaciones del cliente con su estado y las acciones
 * siguientes: enviar a revisión, revisar, finalizar, rectificar.
 * El cálculo se dispara una vez que hay comprobantes aprobados.
 */

interface TaxSettlement {
  id: string;
  version: number;
  status: string;
  cutoff: string;
  engineVersion: string;
  rulesHash: string;
  totals: Record<string, string> | null;
  period?: { label: string | null; startDate: string; endDate: string };
  regime?: { code: string; name: string; taxType?: { code: string; name: string } };
}

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

export function StudyLiquidaciones() {
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["tax-settlements", firmId, clientId],
    queryFn: () =>
      api.get<TaxSettlement[]>(`/firms/${firmId}/clients/${clientId}/tax-settlements`),
    enabled: Boolean(firmId && clientId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax-settlements", firmId, clientId] });
  };

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/submit-review`),
    onSuccess: invalidate,
  });
  const reviewMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/review`),
    onSuccess: invalidate,
  });
  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/finalize`),
    onSuccess: invalidate,
  });
  const rectifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/rectify`, {
        reason: "Rectificación iniciada desde la cartera",
      }),
    onSuccess: invalidate,
  });

  const data = listQuery.data ?? [];

  return (
    <section className="study-page" aria-labelledby="liquidaciones-title">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Impuestos</p>
          <h1 id="liquidaciones-title" className="study-page__title">
            Liquidaciones
          </h1>
        </div>
        <p className="study-page__hint">
          Cada liquidación es una versión determinista: misma entrada + misma
          regla produce el mismo hash.
        </p>
      </header>

      {listQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando liquidaciones…
        </div>
      ) : listQuery.isError ? (
        <div className="study-state" role="alert">
          No se pudieron cargar las liquidaciones. Reintentá más tarde.
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          title="Todavía no hay liquidaciones"
          description="Calculá la primera desde un cliente con comprobantes aprobados."
        />
      ) : (
        <Table<TaxSettlement>
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
              header: "Total",
              align: "right",
              render: (row) => formatMoney(row.totals?.["TOTAL_A_INGRESAR"] ?? row.totals?.["totalDue"]),
            },
            {
              key: "acciones",
              header: "Acciones",
              render: (row) => (
                <span className="study-table__actions">
                  {row.status === "CALCULATED" ? (
                    <Button size="sm" onClick={() => submitMutation.mutate(row.id)}>
                      Enviar a revisión
                    </Button>
                  ) : null}
                  {row.status === "IN_REVIEW" ? (
                    <Button size="sm" onClick={() => reviewMutation.mutate(row.id)}>
                      Revisar
                    </Button>
                  ) : null}
                  {row.status === "REVIEWED" ? (
                    <Button size="sm" onClick={() => finalizeMutation.mutate(row.id)}>
                      Finalizar
                    </Button>
                  ) : null}
                  {row.status === "FINALIZED" ? (
                    <Button size="sm" onClick={() => rectifyMutation.mutate(row.id)}>
                      Rectificar
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
          rows={data}
          rowKey={(row) => row.id}
          empty="Sin liquidaciones."
        />
      )}
    </section>
  );
}