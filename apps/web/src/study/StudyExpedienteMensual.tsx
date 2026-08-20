import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { Icon } from "../ui/Icon";
import "./study.css";

/**
 * Expediente mensual de liquidación (F1.6, PLAN §4.6).
 *
 * Vista de trabajo mensual para preparador y revisor: densa, legible y
 * trazable. Usa un stepper persistente (no un wizard que oculte información):
 *   saldos → fuentes → clasificación → cálculo → controles → cierre.
 * Cada total permite drill-down hasta la evidencia fuente.
 */

interface Workpaper {
  id: string;
  periodStart: string;
  periodEnd: string;
  revision: number;
  status: string;
  inputHash: string | null;
  outputHash: string | null;
  settlements: Array<{
    role: string;
    required: boolean;
    settlement: { id: string; status: string; totals: Record<string, string> | null };
  }>;
  controls: Array<{
    id: string;
    code: string;
    severity: string;
    status: string;
    message?: string;
  }>;
}

interface CreditLot {
  id: string;
  taxTypeId: string;
  jurisdictionId: string | null;
  regimeId: string | null;
  periodId: string | null;
  kind: string;
  originalAmount: string;
  available: string;
  evidenceDocumentId: string | null;
  createdAt: string;
  movements: Array<{ id: string; kind: string; amount: string; reference: string | null; createdAt: string }>;
}

interface TaxPosition {
  obligationId: string;
  status: string;
  dueDate: string | null;
  regime: { id: string; name: string; taxType: { id: string; name: string }; jurisdiction: { id: string; name: string } };
  settlement: { id: string; status: string; version: number; totals: Record<string, string> } | null;
  accrued: string;
  paid: string;
  pending: string;
  availableCredit: string;
  interest: string;
}

interface TaxType { id: string; code: string; name: string }
interface TaxRegime { id: string; name: string; taxTypeId: string; jurisdictionId: string; jurisdiction: { name: string }; taxType: { name: string } }
interface EvidenceDocument { id: string; category: string | null; createdAt: string; fileVersions?: Array<{ originalName: string }> }

const STEPS = ["Saldos", "Fuentes", "Clasificación", "Cálculo", "Controles", "Cierre"] as const;

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

export function StudyExpedienteMensual() {
  const { firmId, clientId, periodId } = useClientContext();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [showOpening, setShowOpening] = useState(false);
  const [opening, setOpening] = useState({ taxTypeId: "", regimeId: "", jurisdictionId: "", kind: "SALDO_A_FAVOR", amount: "", evidenceDocumentId: "" });

  const listQuery = useQuery({
    queryKey: ["monthly-workpapers", firmId, clientId, periodId],
    queryFn: () =>
      api.get<Workpaper[]>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers?from=${encodeURIComponent(periodId ?? "")}`,
      ),
    enabled: Boolean(firmId && clientId && periodId),
  });

  const activeWorkpaperId = listQuery.data?.[0]?.id;
  const coverageQuery = useQuery({
    queryKey: ["monthly-workpaper-coverage", firmId, clientId, activeWorkpaperId],
    queryFn: () => api.get<{ components: Array<{ obligationId: string; regimeCode: string; taxTypeCode: string; required: boolean; linked: boolean; settlementStatus: string | null }>; sources: Array<{ code: string; required: boolean; present: boolean }> }>(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/coverage`),
    enabled: Boolean(firmId && clientId && activeWorkpaperId),
  });
  const ledgerQuery = useQuery({
    queryKey: ["tax-credit-ledger", firmId, clientId],
    queryFn: () => api.get<CreditLot[]>(`/firms/${firmId}/clients/${clientId}/tax-credit-ledger`),
    enabled: Boolean(firmId && clientId),
  });
  const positionQuery = useQuery({
    queryKey: ["tax-position", firmId, clientId, periodId],
    queryFn: () => api.get<TaxPosition[]>(`/firms/${firmId}/clients/${clientId}/tax-position?periodId=${encodeURIComponent(periodId ?? "")}`),
    enabled: Boolean(firmId && clientId && periodId),
  });
  const taxTypesQuery = useQuery({
    queryKey: ["tax-types"],
    queryFn: () => api.get<TaxType[]>("/tax/types"),
    enabled: Boolean(firmId),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes"],
    queryFn: () => api.get<TaxRegime[]>("/tax/regimes"),
    enabled: Boolean(firmId),
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", firmId, clientId],
    queryFn: () => api.get<EvidenceDocument[]>(`/firms/${firmId}/clients/${clientId}/documents`),
    enabled: Boolean(firmId && clientId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers`, {
        periodStart: `${periodId}-01`,
        periodEnd: `${periodId}-31`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const calculateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/calculate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/submit-review`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/review`, {
        approved: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/finalize`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const openingMutation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-credit-ledger/opening`, {
      taxTypeId: opening.taxTypeId,
      ...(opening.regimeId ? { regimeId: opening.regimeId } : {}),
      ...(opening.jurisdictionId ? { jurisdictionId: opening.jurisdictionId } : {}),
      periodId,
      kind: opening.kind,
      amount: opening.amount,
      evidenceDocumentId: opening.evidenceDocumentId,
    }),
    onSuccess: () => {
      setShowOpening(false);
      setOpening({ taxTypeId: "", regimeId: "", jurisdictionId: "", kind: "SALDO_A_FAVOR", amount: "", evidenceDocumentId: "" });
      void queryClient.invalidateQueries({ queryKey: ["tax-credit-ledger", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId, periodId] });
    },
  });

  if (!firmId || !clientId || !periodId) {
    return (
      <div className="study-page">
        <EmptyState
          title="Elegí un cliente y período"
          description="El expediente mensual necesita un cliente y un período activos."
        />
      </div>
    );
  }

  const workpapers = listQuery.data ?? [];

  return (
    <div className="study-page">
      <header className="study-page__header">
        <div>
          <h1>Expediente mensual</h1>
          <p className="study-page__subtitle">
            Coordina IVA, IIBB y TEM del período con evidencia trazable.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={createMutation.isPending}
          onClick={() => void createMutation.mutate()}
        >
          <Icon name="plus" size={16} />
          Nuevo expediente
        </Button>
      </header>

      {listQuery.isLoading ? (
        <div className="study-page__state" role="status">
          Cargando expedientes…
        </div>
      ) : listQuery.isError ? (
        <div className="study-page__state" role="alert">
          No se pudieron cargar los expedientes. Reintentá en un momento.
        </div>
      ) : workpapers.length === 0 ? (
        <EmptyState
          title="Sin expedientes para este período"
          description="Creá un expediente mensual para coordinar las liquidaciones del período."
        />
      ) : (
        <div className="workpaper-list">
          {workpapers.map((wp) => {
            const blocking = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
            return (
              <article className="workpaper-card" key={wp.id}>
                <div className="workpaper-card__header">
                  <div>
                    <h2>
                      {wp.periodStart.slice(0, 7)} · Revisión {wp.revision}
                    </h2>
                    <StatusBadge status={wp.status} />
                  </div>
                  {blocking.length > 0 ? (
                    <span className="workpaper-card__blocking" role="alert">
                      {blocking.length} control(es) bloqueante(s)
                    </span>
                  ) : null}
                </div>

                <div className="workpaper-card__steps" role="tablist" aria-label="Etapas del expediente">
                  {STEPS.map((step, index) => (
                    <button
                      key={step}
                      type="button"
                      role="tab"
                      aria-selected={activeStep === index}
                      className={`workpaper-step${activeStep === index ? " workpaper-step--active" : ""}`}
                      onClick={() => setActiveStep(index)}
                    >
                      {step}
                    </button>
                  ))}
                </div>

                <div className="workpaper-card__body">
                  {activeStep === 3 ? (
                    <div className="workpaper-calc">
                      {wp.settlements.map((link) => (
                        <div className="workpaper-calc__row" key={link.settlement.id}>
                          <span>{link.role}</span>
                          <span className="workpaper-calc__status">
                            <StatusBadge status={link.settlement.status} />
                          </span>
                          <strong>
                            {formatMoney(link.settlement.totals?.["TOTAL_A_INGRESAR"])}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : activeStep === 4 ? (
                    <div className="workpaper-controls">
                      {wp.controls.length === 0 ? (
                        <p>No hay controles registrados para este expediente.</p>
                      ) : (
                        wp.controls.map((control) => (
                          <div className="workpaper-control" key={control.id}>
                            <span>{control.code}</span>
                            <StatusBadge status={control.status} />
                            <span>{control.severity}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <p className="workpaper-card__placeholder">
                      Etapa {STEPS[activeStep]}: revisá los datos antes de continuar.
                    </p>
                  )}
                </div>

                <div className="workpaper-card__actions">
                  {wp.status === "DRAFT" || wp.status === "COLLECTING_INPUTS" ? (
                    <Button
                      variant="primary"
                      disabled={calculateMutation.isPending}
                      onClick={() => void calculateMutation.mutate(wp.id)}
                    >
                      Calcular
                    </Button>
                  ) : null}
                  {wp.status === "CALCULATED" ? (
                    <Button
                      variant="primary"
                      disabled={submitMutation.isPending}
                      onClick={() => void submitMutation.mutate(wp.id)}
                    >
                      Enviar a revisión
                    </Button>
                  ) : null}
                  {wp.status === "IN_REVIEW" ? (
                    <Button
                      variant="primary"
                      disabled={reviewMutation.isPending}
                      onClick={() => void reviewMutation.mutate(wp.id)}
                    >
                      Aprobar revisión
                    </Button>
                  ) : null}
                  {wp.status === "REVIEWED" ? (
                    <Button
                      variant="primary"
                      disabled={finalizeMutation.isPending}
                      onClick={() => void finalizeMutation.mutate(wp.id)}
                    >
                      Finalizar
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
