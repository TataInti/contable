import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
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

interface TaxPeriod {
  id: string;
  label: string | null;
  startDate: string;
  endDate: string;
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
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();

  const periodsQuery = useQuery({
    queryKey: ["tax-obligations", firmId, clientId],
    queryFn: () =>
      api.get<Obligation[]>(`/firms/${firmId}/clients/${clientId}/tax-obligations`),
    enabled: Boolean(firmId && clientId),
  });

  const obligations = periodsQuery.data ?? [];
  const periods: TaxPeriod[] = obligations
    .map((o) => o.period)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const selected = periodsQuery.data
    ? (periodsQuery.data as Obligation[]).find((o) => o.period.id === periods[0]?.id)
    : null;

  const listQuery = useQuery({
    queryKey: ["profitability", firmId, clientId, selected?.period.id],
    queryFn: () =>
      api.get<Snapshot[]>(
        `/firms/${firmId}/clients/${clientId}/profitability?periodId=${selected?.period.id}`,
      ),
    enabled: Boolean(firmId && clientId && selected?.period.id),
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
    onSuccess: invalidate,
  });

  const publishMutation = useMutation({
    mutationFn: ({ basis }: { basis: "DEVENGADO" | "CAJA" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/profitability/publish`, {
        periodId: selected?.period.id,
        basis,
      }),
    onSuccess: invalidate,
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
          <Button
            size="sm"
            disabled={!selected || calculateMutation.isPending}
            onClick={() => calculateMutation.mutate({ basis })}
          >
            {snapshot && snapshot.status === "DRAFT" ? "Recalcular" : "Calcular"}
          </Button>
          {snapshot && snapshot.status === "DRAFT" ? (
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

      {!clientId ? (
        <EmptyState
          title="Elegí un cliente"
          description="La rentabilidad se calcula por cliente y período fiscal."
        />
      ) : listQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando rentabilidad…
        </div>
      ) : listQuery.isError ? (
        <div className="study-state" role="alert">
          No se pudo cargar la rentabilidad. Reintentá más tarde.
        </div>
      ) : periods.length === 0 ? (
        <EmptyState
          title="Sin períodos fiscales"
          description="Creá el perfil fiscal y las obligaciones del cliente para calcular rentabilidad."
        />
      ) : (
        <div className="profitability-grid">
          {renderView(devengado, "DEVENGADO")}
          {renderView(caja, "CAJA")}
        </div>
      )}
    </section>
  );
}
