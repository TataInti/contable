import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { Icon } from "../ui/Icon";
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
  period?: { id: string; label: string | null; startDate: string; endDate: string };
  regime?: { code: string; name: string; taxType?: { code: string; name: string } };
}

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

export function StudyLiquidaciones() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [receipt, setReceipt] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["tax-settlements", firmId, clientId, periodId],
    queryFn: () =>
      api.get<TaxSettlement[]>(
        `/firms/${firmId}/clients/${clientId}/tax-settlements?periodId=${encodeURIComponent(periodId ?? "")}`,
      ),
    enabled: Boolean(firmId && clientId && periodId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax-settlements", firmId, clientId] });
  };

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/submit-review`),
    onSuccess: () => {
      invalidate();
      setReceipt("La liquidación fue enviada a revisión.");
    },
  });
  const reviewMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/review`),
    onSuccess: () => {
      invalidate();
      setReceipt("La liquidación quedó revisada.");
    },
  });
  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/finalize`),
    onSuccess: () => {
      invalidate();
      setReceipt("La liquidación fue finalizada y quedó inmutable.");
    },
  });
  const rectifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/rectify`, {
        reason: "Rectificación iniciada desde la cartera",
      }),
    onSuccess: () => {
      invalidate();
      setReceipt("Se inició una rectificación de la liquidación.");
    },
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

      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={19} />
          <span>
            <strong>Acción completada</strong>
            <small>{receipt}</small>
          </span>
          <button type="button" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}

      {listQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando liquidaciones…
        </div>
      ) : listQuery.isError ? (
        <EmptyState
          title="No se pudieron cargar las liquidaciones"
          description="Reintentá en unos minutos. No interpretamos esta falla como una cartera vacía."
          action={
            <Button variant="secondary" onClick={() => void listQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
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
                  {row.status === "CALCULATED" && capabilities.has("tax.settlements.submit_review") ? (
                    <Button size="sm" onClick={() => submitMutation.mutate(row.id)}>
                      Enviar a revisión
                    </Button>
                  ) : null}
                  {row.status === "IN_REVIEW" && capabilities.has("tax.settlements.review") ? (
                    <Button size="sm" onClick={() => reviewMutation.mutate(row.id)}>
                      Revisar
                    </Button>
                  ) : null}
                  {row.status === "REVIEWED" && capabilities.has("tax.settlements.finalize") ? (
                    <Button size="sm" onClick={() => finalizeMutation.mutate(row.id)}>
                      Finalizar
                    </Button>
                  ) : null}
                  {row.status === "FINALIZED" && capabilities.has("tax.settlements.rectify") ? (
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
      {submitMutation.isError || reviewMutation.isError || finalizeMutation.isError || rectifyMutation.isError ? (
        <p className="form-error" role="alert">
          {(submitMutation.error ?? reviewMutation.error ?? finalizeMutation.error ?? rectifyMutation.error)
            ?.message ?? "No se pudo completar la acción. Reintentá en unos minutos."}
        </p>
      ) : null}
    </section>
  );
}
