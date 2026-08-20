import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { Icon } from "../ui/Icon";
import "./study.css";

/**
 * Rentabilidad gerencial (Puerta 5, G5-01..G5-05).
 *
 * Estación de trabajo del estudio con dos vistas separadas:
 * - DEVENGADO: resultado gerencial luego de impuestos.
 * - CAJA: flujo neto luego de impuestos.
 *
 * Publicar crea un snapshot inmutable versionado; el portal sólo ve lo
 * publicado (G5-05, G5-07).
 */

interface Snapshot {
  id: string;
  basis: "DEVENGADO" | "CAJA";
  version: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  cutoff: string;
  totals: Record<string, string> | null;
  lines: Array<{ concept: string; formula: string; inputs: Record<string, string>; result: string }> | null;
  outputHash: string;
  publishedAt: string | null;
  period?: { label: string | null; startDate: string; endDate: string } | null;
}

interface Obligation {
  id: string;
  regimeId: string;
  periodId: string;
  status: string;
  period: { id: string; startDate: string; endDate: string; label: string | null };
  regime: { id: string; name: string; taxType: { id: string; name: string } };
}

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

function basisLabel(basis: string): string {
  return basis === "CAJA" ? "Caja (flujo real)" : "Devengado (acumulado)";
}

export function StudyRentabilidad() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [receipt, setReceipt] = useState<string | null>(null);

  const periodsQuery = useQuery({
    queryKey: ["tax-obligations", firmId, clientId],
    queryFn: () =>
      api.get<Obligation[]>(`/firms/${firmId}/clients/${clientId}/tax-obligations`),
    enabled: Boolean(firmId && clientId),
  });

  const selected = periodsQuery.data?.find((obligation) => obligation.period.id === periodId) ?? null;

  const listQuery = useQuery({
    queryKey: ["profitability", firmId, clientId, periodId],
    queryFn: () =>
      api.get<Snapshot[]>(
        `/firms/${firmId}/clients/${clientId}/profitability?periodId=${encodeURIComponent(periodId ?? "")}`,
      ),
    enabled: Boolean(firmId && clientId && periodId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["profitability", firmId, clientId] });
  };

  const calculateMutation = useMutation({
    mutationFn: ({ basis }: { basis: "DEVENGADO" | "CAJA" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/profitability/calculate`, {
        periodId: selected?.period.id,
        basis,
        cutoff: selected?.period.endDate,
      }),
    onSuccess: () => {
      invalidate();
      setReceipt("La rentabilidad fue calculada para el período activo.");
    },
  });

  const publishMutation = useMutation({
    mutationFn: ({ basis }: { basis: "DEVENGADO" | "CAJA" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/profitability/publish`, {
        periodId: selected?.period.id,
        basis,
      }),
    onSuccess: () => {
      invalidate();
      setReceipt("La versión fue publicada y ya está disponible en el portal del cliente.");
    },
  });

  const snapshots = listQuery.data ?? [];
  const devengado = snapshots.find((s) => s.basis === "DEVENGADO");
  const caja = snapshots.find((s) => s.basis === "CAJA");

  const renderView = (snapshot: Snapshot | undefined, basis: "DEVENGADO" | "CAJA") => (
    <section className="profitability-view" aria-labelledby={`profitability-${basis.toLowerCase()}-title`}>
      <div className="profitability-view__header">
        <div>
          <p className="study-page__eyebrow">{basisLabel(basis)}</p>
          <h3 id={`profitability-${basis.toLowerCase()}-title`} className="profitability-view__title">
            {basis === "DEVENGADO" ? "Resultado gerencial" : "Flujo neto"}
          </h3>
        </div>
        <div className="profitability-view__actions">
          {snapshot ? <StatusBadge status={snapshot.status} /> : null}
          {snapshot ? (
            <span className="profitability-view__version">v{snapshot.version}</span>
          ) : null}
          {capabilities.has("profitability.calculate") ? (
            <Button
              size="sm"
              disabled={!selected || calculateMutation.isPending}
              onClick={() => calculateMutation.mutate({ basis })}
            >
              {snapshot && snapshot.status === "DRAFT" ? "Recalcular" : "Calcular"}
            </Button>
          ) : null}
          {snapshot && snapshot.status === "DRAFT" && capabilities.has("profitability.publish") ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate({ basis })}
            >
              Publicar
            </Button>
          ) : null}
        </div>
      </div>

      {!snapshot ? (
        <EmptyState
          title={basis === "DEVENGADO" ? "Devengado sin calcular" : "Caja sin calcular"}
          description="Calculá la vista para ver el resultado del período."
        />
      ) : (
        <>
          <dl className="profitability-totals">
            {(Object.entries(snapshot.totals ?? {}) as [string, string][]).map(([key, value]) => (
              <div key={key} className="profitability-total" data-key={key}>
                <dt>{key.replaceAll("_", " ").toLowerCase()}</dt>
                <dd>{formatMoney(value)}</dd>
              </div>
            ))}
          </dl>

          {snapshot.lines && snapshot.lines.length > 0 ? (
            <div className="profitability-lines" role="list">
              {snapshot.lines.map((line, index) => (
                <div className="profitability-line" role="listitem" key={`${line.concept}-${index}`}>
                  <div className="profitability-line__head">
                    <strong>{line.concept}</strong>
                    <span>{formatMoney(line.result)}</span>
                  </div>
                  <p className="profitability-line__formula">{line.formula}</p>
                </div>
              ))}
            </div>
          ) : null}

          <p className="study-page__hint">
            Hash de salida: <code>{snapshot.outputHash.slice(0, 16)}…</code>
            {snapshot.publishedAt
              ? ` · Publicado ${new Date(snapshot.publishedAt).toLocaleString("es-AR")}`
              : " · Borrador (no visible para el cliente)"}
          </p>
        </>
      )}
    </section>
  );

  return (
    <section className="study-page" aria-labelledby="rentabilidad-title">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Gerencia</p>
          <h1 id="rentabilidad-title" className="study-page__title">
            Rentabilidad
          </h1>
        </div>
        <p className="study-page__hint">
          Devengado y caja se calculan por separado; la gestión sin respaldo
          fiscal nunca reduce impuestos por defecto.
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

      {!clientId ? (
        <EmptyState
          title="Elegí un cliente"
          description="La rentabilidad se calcula por cliente y período fiscal."
        />
      ) : periodsQuery.isLoading || listQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando rentabilidad…
        </div>
      ) : periodsQuery.isError || listQuery.isError ? (
        <div className="study-state" role="alert">
          No se pudo cargar la rentabilidad. Reintentá más tarde.
        </div>
      ) : !selected ? (
        <EmptyState
          title="Sin obligación fiscal para el período activo"
          description="Completá la configuración fiscal y materializá las obligaciones antes de calcular rentabilidad."
        />
      ) : (
        <>
          <div className="profitability-grid">
            {renderView(devengado, "DEVENGADO")}
            {renderView(caja, "CAJA")}
          </div>
          {calculateMutation.isError || publishMutation.isError ? (
            <p className="form-error" role="alert">
              {(calculateMutation.error ?? publishMutation.error)?.message ??
                "No se pudo completar la acción. Reintentá en unos minutos."}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
