import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, EmptyState, Notice, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import {
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
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
  lines: Array<{
    concept: string;
    formula: string;
    inputs: Record<string, string>;
    result: string;
  }> | null;
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
  const [density] = useDensity();
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const notify = useNotify();
  const confirm = useConfirmAction();

  const periodsQuery = useQuery({
    queryKey: ["tax-obligations", firmId, clientId],
    queryFn: () => api.get<Obligation[]>(`/firms/${firmId}/clients/${clientId}/tax-obligations`),
    enabled: Boolean(firmId && clientId),
  });

  // F2.4: selector de período local que se refleja en la URL (?period=).
  // No asume periods[0]: usa el período de la URL, del contexto o el primero.
  const urlPeriod = searchParams.get("period");
  const availablePeriods = useMemo(
    () => [
      ...new Map(
        (periodsQuery.data ?? []).map((obligation) => [obligation.period.id, obligation.period]),
      ).values(),
    ],
    [periodsQuery.data],
  );
  const selectedPeriod =
    availablePeriods.find((period) => period.id === (urlPeriod ?? periodId)) ??
    availablePeriods.find((period) => period.id === periodId) ??
    availablePeriods[0] ??
    null;
  const activePeriodId = selectedPeriod?.id ?? periodId;

  const selectPeriod = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("period", next);
    else params.delete("period");
    navigate(`?${params.toString()}`, { replace: true });
  };

  const listQuery = useQuery({
    queryKey: ["profitability", firmId, clientId, activePeriodId],
    queryFn: () =>
      api.get<Snapshot[]>(
        `/firms/${firmId}/clients/${clientId}/profitability?periodId=${encodeURIComponent(activePeriodId ?? "")}`,
      ),
    enabled: Boolean(firmId && clientId && activePeriodId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["profitability", firmId, clientId] });
  };

  const calculateMutation = useMutation({
    mutationFn: ({ basis }: { basis: "DEVENGADO" | "CAJA" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/profitability/calculate`, {
        periodId: selectedPeriod?.id,
        basis,
        // Prisma serializa Date como ISO completo; el contrato de cálculo
        // recibe una fecha civil YYYY-MM-DD.
        cutoff: selectedPeriod?.endDate?.slice(0, 10),
      }),
    onSuccess: () => {
      invalidate();
      notify.success("La rentabilidad fue calculada para el período activo.");
    },
  });

  const publishMutation = useMutation({
    mutationFn: ({ basis }: { basis: "DEVENGADO" | "CAJA" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/profitability/publish`, {
        periodId: selectedPeriod?.id,
        basis,
      }),
    onSuccess: () => {
      invalidate();
      notify.success("La versión fue publicada y ya está disponible en el portal del cliente.");
    },
  });

  const snapshots = listQuery.data ?? [];
  const devengado = snapshots.find((s) => s.basis === "DEVENGADO");
  const caja = snapshots.find((s) => s.basis === "CAJA");

  const renderView = (snapshot: Snapshot | undefined, basis: "DEVENGADO" | "CAJA") => (
    <section
      className="profitability-view"
      aria-labelledby={`profitability-${basis.toLowerCase()}-title`}
    >
      <div className="profitability-view__header">
        <div>
          <p className="study-page__eyebrow">{basisLabel(basis)}</p>
          <h3
            id={`profitability-${basis.toLowerCase()}-title`}
            className="profitability-view__title"
          >
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
              disabled={!selectedPeriod || calculateMutation.isPending}
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
              onClick={() =>
                confirm.ask({
                  title: "¿Publicar esta versión?",
                  description:
                    "El cliente podrá consultar este resultado en el portal del cliente.",
                  confirmLabel: "Publicar",
                  onConfirm: () => publishMutation.mutate({ basis }),
                })
              }
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
          action={
            capabilities.has("profitability.calculate") && selectedPeriod ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={calculateMutation.isPending}
                onClick={() => calculateMutation.mutate({ basis })}
              >
                Calcular {basis === "DEVENGADO" ? "devengado" : "caja"}
              </Button>
            ) : undefined
          }
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
                <div
                  className="profitability-line"
                  role="listitem"
                  key={`${line.concept}-${index}`}
                >
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
    <DensePage density={density} flow>
      <DenseHeader
        title="Rentabilidad"
        description="Devengado y caja se calculan por separado; la gestión sin respaldo fiscal nunca reduce impuestos por defecto."
        actions={
          <>
          {availablePeriods.length > 0 ? (
            <label className="period-select">
              <span>Período</span>
              <select
                value={activePeriodId ?? ""}
                onChange={(event) => selectPeriod(event.target.value)}
                aria-label="Seleccionar período de rentabilidad"
              >
                {availablePeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label ?? period.startDate.slice(0, 7)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void Promise.all([periodsQuery.refetch(), listQuery.refetch()]);
            }}
          >
            Actualizar
          </Button>
        
          </>
        }
      />

      <StatStrip
        label="Resultado del período"
        items={[
          { key: "accrual", label: "Devengado", value: devengado ? `v${devengado.version}` : "Sin calcular" },
          { key: "cash", label: "Caja", value: caja ? `v${caja.version}` : "Sin calcular" },
        ]}
      />

      <Notice
        tone="info"
        action={
          !clientId ? null : !selectedPeriod ? <Button size="sm" variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>Configurar período</Button> : !devengado && capabilities.has("profitability.calculate") ? <Button size="sm" onClick={() => calculateMutation.mutate({ basis: "DEVENGADO" })}>Calcular devengado</Button> : !caja && capabilities.has("profitability.calculate") ? <Button size="sm" onClick={() => calculateMutation.mutate({ basis: "CAJA" })}>Calcular caja</Button> : devengado?.status === "DRAFT" && capabilities.has("profitability.publish") ? <Button size="sm" onClick={() => confirm.ask({ title: "¿Publicar esta versión?", description: "El cliente podrá consultar este resultado en el portal del cliente.", confirmLabel: "Publicar", onConfirm: () => publishMutation.mutate({ basis: "DEVENGADO" }) })}>Publicar devengado</Button> : null
        }
      >
        <strong>Próximo paso:</strong> {!clientId ? "Seleccioná un cliente para consultar su resultado." : !selectedPeriod ? "Configurá un período fiscal con obligaciones materializadas." : !devengado ? "Calculá primero la rentabilidad devengada del período activo." : !caja ? "Calculá la vista de caja para completar el análisis." : devengado.status === "DRAFT" && capabilities.has("profitability.publish") ? "Publicá la versión devengada cuando esté lista para el cliente." : "Revisá las dos vistas y sus versiones publicadas."}
      </Notice>



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
        <Notice
          tone="error"
          title="No se pudo cargar la rentabilidad"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void Promise.all([periodsQuery.refetch(), listQuery.refetch()]);
              }}
            >
              Reintentar
            </Button>
          }
        >
          Reintentá en unos minutos.
        </Notice>
      ) : !selectedPeriod ? (
        <EmptyState
          title="Sin período fiscal para calcular"
          description="Completá la configuración fiscal y materializá las obligaciones antes de calcular rentabilidad."
          action={
            capabilities.has("tax.profile.write") ? (
              <Button variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
                Configurar período fiscal
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="profitability-grid">
            {renderView(devengado, "DEVENGADO")}
            {renderView(caja, "CAJA")}
          </div>
          {calculateMutation.isError || publishMutation.isError ? (
            <Notice tone="error">
              {(calculateMutation.error ?? publishMutation.error)?.message ??
                "No se pudo completar la acción. Reintentá en unos minutos."}
            </Notice>
          ) : null}
        </>
      )}
      <ConfirmDialog confirm={confirm} />
    
    </DensePage>
  );
}
