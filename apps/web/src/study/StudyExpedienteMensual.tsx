import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
interface FiscalTaxPeriod { id: string; taxTypeId: string; startDate: string; endDate: string; label: string | null; taxType: { name: string } }
interface EvidenceDocument { id: string; category: string | null; createdAt: string; fileVersions?: Array<{ originalName: string }> }
type PositionAction = { kind: "PAYMENT" | "FILING"; position: TaxPosition } | null;

const STEPS = ["Saldos", "Fuentes", "Clasificación", "Cálculo", "Controles", "Cierre"] as const;

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

export function StudyExpedienteMensual() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [showOpening, setShowOpening] = useState(false);
  const [opening, setOpening] = useState({ taxTypeId: "", taxPeriodId: "", regimeId: "", jurisdictionId: "", kind: "SALDO_A_FAVOR", amount: "", evidenceDocumentId: "" });
  const [controlResolutions, setControlResolutions] = useState<Record<string, string>>({});
  const [positionAction, setPositionAction] = useState<PositionAction>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paidAt: new Date().toISOString().slice(0, 10), method: "TRANSFERENCIA", reference: "" });
  const [filingForm, setFilingForm] = useState({ amountFiled: "", filedAt: new Date().toISOString().slice(0, 10), externalId: "", evidenceDocumentId: "" });

  const listQuery = useQuery({
    queryKey: ["monthly-workpapers", firmId, clientId, periodId],
    queryFn: () =>
      api.get<Workpaper[]>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers?accountingPeriodId=${encodeURIComponent(periodId ?? "")}`,
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
    queryFn: () => api.get<TaxPosition[]>(`/firms/${firmId}/clients/${clientId}/tax-position?accountingPeriodId=${encodeURIComponent(periodId ?? "")}`),
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
  const taxPeriodsQuery = useQuery({
    queryKey: ["tax-periods", firmId, clientId],
    queryFn: () => api.get<FiscalTaxPeriod[]>(`/firms/${firmId}/clients/${clientId}/tax-periods`),
    enabled: Boolean(firmId && clientId),
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", firmId, clientId],
    queryFn: () => api.get<EvidenceDocument[]>(`/firms/${firmId}/clients/${clientId}/documents`),
    enabled: Boolean(firmId && clientId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers`, {
        accountingPeriodId: periodId,
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
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/review`, {
        approved,
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
  const rectifyMutation = useMutation({
    mutationFn: (id: string) => api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/rectify`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });
  const resolveControlMutation = useMutation({
    mutationFn: ({ workpaperId, findingId, status }: { workpaperId: string; findingId: string; status: "RESOLVED" | "WAIVED" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${workpaperId}/controls/${findingId}/resolve`, {
        resolution: controlResolutions[findingId]?.trim(),
        status,
      }),
    onSuccess: (_, variables) => {
      setControlResolutions((values) => ({ ...values, [variables.findingId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-coverage", firmId, clientId] });
    },
  });
  const recordPaymentMutation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-obligations/${positionAction?.position.obligationId}/payments`, {
      ...(positionAction?.position.settlement ? { settlementId: positionAction.position.settlement.id } : {}),
      paidAt: paymentForm.paidAt,
      amount: paymentForm.amount,
      method: paymentForm.method,
      ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
    }),
    onSuccess: () => {
      setPositionAction(null);
      setPaymentForm({ amount: "", paidAt: new Date().toISOString().slice(0, 10), method: "TRANSFERENCIA", reference: "" });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId, periodId] });
    },
  });
  const recordFilingMutation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-obligations/${positionAction?.position.obligationId}/filings`, {
      settlementId: positionAction?.position.settlement?.id,
      filedAt: filingForm.filedAt,
      amountFiled: filingForm.amountFiled,
      ...(filingForm.externalId.trim() ? { externalId: filingForm.externalId.trim() } : {}),
      ...(filingForm.evidenceDocumentId ? { evidenceDocumentId: filingForm.evidenceDocumentId } : {}),
    }),
    onSuccess: () => {
      setPositionAction(null);
      setFilingForm({ amountFiled: "", filedAt: new Date().toISOString().slice(0, 10), externalId: "", evidenceDocumentId: "" });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId, periodId] });
    },
  });

  const openingMutation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-credit-ledger/opening`, {
      taxTypeId: opening.taxTypeId,
      ...(opening.regimeId ? { regimeId: opening.regimeId } : {}),
      ...(opening.jurisdictionId ? { jurisdictionId: opening.jurisdictionId } : {}),
      periodId: opening.taxPeriodId,
      kind: opening.kind,
      amount: opening.amount,
      evidenceDocumentId: opening.evidenceDocumentId,
    }),
    onSuccess: () => {
      setShowOpening(false);
      setOpening({ taxTypeId: "", taxPeriodId: "", regimeId: "", jurisdictionId: "", kind: "SALDO_A_FAVOR", amount: "", evidenceDocumentId: "" });
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
  const openingRegimes = (regimesQuery.data ?? []).filter(
    (regime) => !opening.taxTypeId || regime.taxTypeId === opening.taxTypeId,
  );
  const openingTaxPeriods = (taxPeriodsQuery.data ?? []).filter(
    (taxPeriod) => !opening.taxTypeId || taxPeriod.taxTypeId === opening.taxTypeId,
  );

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
          disabled={createMutation.isPending || !capabilities.has("tax.settlements.calculate")}
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
          action={capabilities.has("tax.settlements.calculate") ? <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>Crear expediente</Button> : undefined}
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
                  {activeStep === 0 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading">
                        <div><strong>Saldos a favor y arrastres</strong><small>Disponibles por impuesto, régimen y jurisdicción. Cada saldo conserva su respaldo.</small></div>
                        <span className="workpaper-stage__actions"><Button size="sm" variant="ghost" onClick={() => void ledgerQuery.refetch()}>Actualizar</Button>{capabilities.has("tax.settlements.calculate") ? <Button size="sm" variant="secondary" onClick={() => setShowOpening((visible) => !visible)}><Icon name="plus" size={15} /> Cargar saldo inicial</Button> : null}</span>
                      </div>
                      {showOpening ? (
                        <form className="opening-credit-form" onSubmit={(event) => { event.preventDefault(); openingMutation.mutate(); }}>
                          <div className="ds-field"><label className="ds-field__label" htmlFor="opening-tax-type">Impuesto</label><select id="opening-tax-type" className="ds-field__input" value={opening.taxTypeId} onChange={(event) => setOpening((value) => ({ ...value, taxTypeId: event.target.value, taxPeriodId: "", regimeId: "", jurisdictionId: "", kind: event.target.value && taxTypesQuery.data?.find((type) => type.id === event.target.value)?.code === "IVA" ? "IVA_LIBRE" : "SALDO_A_FAVOR" }))} required><option value="">Seleccioná…</option>{taxTypesQuery.data?.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div>
                          <div className="ds-field"><label className="ds-field__label" htmlFor="opening-tax-period">Período fiscal</label><select id="opening-tax-period" className="ds-field__input" value={opening.taxPeriodId} onChange={(event) => setOpening((value) => ({ ...value, taxPeriodId: event.target.value }))} required disabled={!opening.taxTypeId}><option value="">Seleccioná…</option>{openingTaxPeriods.map((taxPeriod) => <option key={taxPeriod.id} value={taxPeriod.id}>{taxPeriod.label ?? `${taxPeriod.startDate.slice(0, 10)} a ${taxPeriod.endDate.slice(0, 10)}`}</option>)}</select></div>
                          <div className="ds-field"><label className="ds-field__label" htmlFor="opening-regime">Régimen</label><select id="opening-regime" className="ds-field__input" value={opening.regimeId} onChange={(event) => { const regime = openingRegimes.find((item) => item.id === event.target.value); setOpening((value) => ({ ...value, regimeId: event.target.value, jurisdictionId: regime?.jurisdictionId ?? "" })); }}><option value="">Sin régimen específico</option>{openingRegimes.map((regime) => <option key={regime.id} value={regime.id}>{regime.name} · {regime.jurisdiction.name}</option>)}</select></div>
                          <div className="ds-field"><label className="ds-field__label" htmlFor="opening-kind">Naturaleza</label><select id="opening-kind" className="ds-field__input" value={opening.kind} onChange={(event) => setOpening((value) => ({ ...value, kind: event.target.value }))}><option value="SALDO_A_FAVOR">Saldo a favor</option>{taxTypesQuery.data?.find((type) => type.id === opening.taxTypeId)?.code === "IVA" ? <><option value="IVA_TECNICO">IVA · saldo técnico</option><option value="IVA_LIBRE">IVA · libre disponibilidad</option></> : null}</select></div>
                          <Field label="Importe" id="opening-amount" inputMode="decimal" value={opening.amount} onChange={(event) => setOpening((value) => ({ ...value, amount: event.target.value }))} required />
                          <div className="ds-field"><label className="ds-field__label" htmlFor="opening-evidence">Documento de respaldo</label><select id="opening-evidence" className="ds-field__input" value={opening.evidenceDocumentId} onChange={(event) => setOpening((value) => ({ ...value, evidenceDocumentId: event.target.value }))} required><option value="">Seleccioná evidencia…</option>{documentsQuery.data?.map((document) => <option key={document.id} value={document.id}>{document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"}</option>)}</select></div>
                          <div className="opening-credit-form__actions"><Button type="submit" loading={openingMutation.isPending} disabled={!opening.taxTypeId || !opening.taxPeriodId || !opening.amount || !opening.evidenceDocumentId}>Registrar saldo</Button><Button type="button" variant="ghost" onClick={() => setShowOpening(false)}>Cancelar</Button></div>
                        </form>
                      ) : null}
                      {ledgerQuery.isLoading ? <p className="muted-copy">Cargando saldos…</p> : <Table<CreditLot>
                        rows={ledgerQuery.data ?? []}
                        rowKey={(lot) => lot.id}
                        empty="No hay saldos a favor disponibles para este cliente."
                        columns={[
                          { key: "kind", header: "Saldo", render: (lot) => <><strong>{lot.kind.replaceAll("_", " ")}</strong><br /><small>{lot.movements.length} movimiento(s)</small></> },
                          { key: "scope", header: "Alcance", render: (lot) => lot.regimeId ? "Régimen específico" : "Impuesto" },
                          { key: "original", header: "Original", align: "right", render: (lot) => formatMoney(lot.originalAmount) },
                          { key: "available", header: "Disponible", align: "right", render: (lot) => <strong>{formatMoney(lot.available)}</strong> },
                          { key: "evidence", header: "Respaldo", render: (lot) => lot.evidenceDocumentId ? "Documentado" : "Cierre de liquidación" },
                        ]}
                      />}
                    </div>
                  ) : activeStep === 1 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading"><div><strong>Cobertura de fuentes</strong><small>El expediente declara qué llegó y qué todavía bloquea el cálculo.</small></div><span className="workpaper-stage__actions"><Button size="sm" variant="ghost" onClick={() => void coverageQuery.refetch()}>Actualizar</Button><Button size="sm" variant="secondary" onClick={() => navigate("/bandeja")}>Ir a bandeja</Button></span></div>
                      {coverageQuery.isLoading ? <p className="muted-copy">Verificando cobertura…</p> : <><Table
                        rows={coverageQuery.data?.sources ?? []}
                        rowKey={(source) => source.code}
                        empty="No hay fuentes definidas para el expediente."
                        columns={[{ key: "source", header: "Fuente", render: (source) => source.code }, { key: "required", header: "Tipo", render: (source) => source.required ? "Obligatoria" : "Opcional" }, { key: "state", header: "Estado", render: (source) => <StatusBadge status={source.present ? "READY" : source.required ? "WAITING_INPUTS" : "PENDING"} /> }]}
                      /><Table
                        rows={coverageQuery.data?.components ?? []}
                        rowKey={(component) => component.obligationId}
                        empty="No hay obligaciones vinculadas."
                        columns={[{ key: "regime", header: "Componente", render: (component) => `${component.taxTypeCode} · ${component.regimeCode}` }, { key: "required", header: "Requerido", render: (component) => component.required ? "Sí" : "No" }, { key: "state", header: "Liquidación", render: (component) => component.settlementStatus ? <StatusBadge status={component.settlementStatus} /> : "Pendiente de vincular" }]}
                      /></>}
                    </div>
                  ) : activeStep === 2 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading"><div><strong>Clasificación</strong><small>Las actividades adheridas determinan la alícuota aplicable. Completá las que falten antes de calcular.</small></div><span className="workpaper-stage__actions"><Button size="sm" variant="ghost" onClick={() => void coverageQuery.refetch()}>Actualizar controles</Button><Button size="sm" variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>Ver configuración fiscal</Button></span></div>
                      <p className="workpaper-stage__note">La clasificación de comprobantes se controla contra las actividades y regímenes vigentes del cliente; los controles abiertos aparecerán antes del cierre.</p>
                    </div>
                  ) : activeStep === 3 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading"><div><strong>Posición fiscal del período</strong><small>Devengado fiscal, pagos e intereses sin mezclarlo con el resultado gerencial.</small></div><Button size="sm" variant="ghost" onClick={() => void positionQuery.refetch()}>Actualizar posición</Button></div>
                      {positionQuery.isLoading ? <p className="muted-copy">Calculando posición…</p> : <><Table<TaxPosition>
                        rows={positionQuery.data ?? []}
                        rowKey={(position) => position.obligationId}
                        empty="No hay obligaciones fiscales para el período seleccionado."
                        columns={[
                          { key: "tax", header: "Impuesto", render: (position) => <><strong>{position.regime.taxType.name}</strong><br /><small>{position.regime.name} · {position.regime.jurisdiction.name}</small></> },
                          { key: "accrued", header: "Devengado", align: "right", render: (position) => formatMoney(position.accrued) },
                          { key: "interest", header: "Interés", align: "right", render: (position) => formatMoney(position.interest) },
                          { key: "paid", header: "Pagado", align: "right", render: (position) => formatMoney(position.paid) },
                          { key: "pending", header: "Pendiente", align: "right", render: (position) => <strong>{formatMoney(position.pending)}</strong> },
                          { key: "credit", header: "A favor", align: "right", render: (position) => formatMoney(position.availableCredit) },
                          { key: "status", header: "Estado", render: (position) => <StatusBadge status={position.status} /> },
                          { key: "actions", header: "Acciones", render: (position) => <span className="study-table__actions">{position.settlement && capabilities.has("tax.filings.record") ? <Button size="sm" variant="ghost" onClick={() => { setPositionAction({ kind: "FILING", position }); setFilingForm({ amountFiled: position.accrued, filedAt: new Date().toISOString().slice(0, 10), externalId: "", evidenceDocumentId: "" }); }}>Registrar presentación</Button> : null}{Number(position.pending) > 0 && capabilities.has("tax.payments.record") ? <Button size="sm" variant="secondary" onClick={() => { setPositionAction({ kind: "PAYMENT", position }); setPaymentForm({ amount: position.pending, paidAt: new Date().toISOString().slice(0, 10), method: "TRANSFERENCIA", reference: "" }); }}>Registrar pago</Button> : null}</span> },
                        ]}
                      />
                      {wp.id === activeWorkpaperId && positionAction?.kind === "PAYMENT" ? <form className="study-panel study-form study-form--compact fiscal-action-form" onSubmit={(event) => { event.preventDefault(); recordPaymentMutation.mutate(); }}><div className="study-panel__heading"><div><h2>Registrar pago · {positionAction.position.regime.name}</h2><p>El pago se registrará de forma manual y actualizará el saldo pendiente.</p></div></div><Field label="Importe" id="tax-payment-amount" inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required /><Field label="Fecha de pago" id="tax-payment-date" type="date" value={paymentForm.paidAt} onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })} required /><div className="ds-field"><label className="ds-field__label" htmlFor="tax-payment-method">Medio</label><select id="tax-payment-method" className="ds-field__input" value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="TRANSFERENCIA">Transferencia</option><option value="VEP">VEP</option><option value="EFECTIVO">Efectivo</option><option value="OTRO">Otro</option></select></div><Field label="Referencia" id="tax-payment-reference" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} placeholder="Opcional" /><div className="study-form__actions"><Button type="submit" loading={recordPaymentMutation.isPending} disabled={!paymentForm.amount}>Registrar pago</Button><Button type="button" variant="ghost" onClick={() => setPositionAction(null)}>Cancelar</Button></div></form> : null}
                      {wp.id === activeWorkpaperId && positionAction?.kind === "FILING" ? <form className="study-panel study-form study-form--compact fiscal-action-form" onSubmit={(event) => { event.preventDefault(); recordFilingMutation.mutate(); }}><div className="study-panel__heading"><div><h2>Registrar presentación · {positionAction.position.regime.name}</h2><p>Conservá la referencia y el respaldo de la presentación manual.</p></div></div><Field label="Importe presentado" id="tax-filing-amount" inputMode="decimal" value={filingForm.amountFiled} onChange={(event) => setFilingForm({ ...filingForm, amountFiled: event.target.value })} required /><Field label="Fecha de presentación" id="tax-filing-date" type="date" value={filingForm.filedAt} onChange={(event) => setFilingForm({ ...filingForm, filedAt: event.target.value })} required /><Field label="Identificador externo" id="tax-filing-external-id" value={filingForm.externalId} onChange={(event) => setFilingForm({ ...filingForm, externalId: event.target.value })} placeholder="Opcional" /><div className="ds-field"><label className="ds-field__label" htmlFor="tax-filing-evidence">Documento de respaldo</label><select id="tax-filing-evidence" className="ds-field__input" value={filingForm.evidenceDocumentId} onChange={(event) => setFilingForm({ ...filingForm, evidenceDocumentId: event.target.value })}><option value="">Sin adjuntar por ahora</option>{documentsQuery.data?.map((document) => <option key={document.id} value={document.id}>{document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"}</option>)}</select></div><div className="study-form__actions"><Button type="submit" loading={recordFilingMutation.isPending} disabled={!positionAction.position.settlement || !filingForm.amountFiled}>Registrar presentación</Button><Button type="button" variant="ghost" onClick={() => setPositionAction(null)}>Cancelar</Button></div></form> : null}</>}
                    </div>
                  ) : activeStep === 4 ? (
                    <div className="workpaper-controls">
                      {wp.controls.length === 0 ? (
                        <p>No hay controles registrados para este expediente.</p>
                      ) : (
                        wp.controls.map((control) => (
                          <div className="workpaper-control" key={control.id}>
                            <span><strong>{control.code}</strong>{control.message ? <small>{control.message}</small> : null}</span>
                            <StatusBadge status={control.status} />
                            <span>{control.severity}</span>
                            {control.status === "OPEN" && capabilities.has("tax.settlements.review") ? <span className="workpaper-control__resolution"><input aria-label={`Resolución ${control.code}`} value={controlResolutions[control.id] ?? ""} placeholder="Explicá la resolución…" onChange={(event) => setControlResolutions((values) => ({ ...values, [control.id]: event.target.value }))} /><Button size="sm" disabled={!controlResolutions[control.id]?.trim()} loading={resolveControlMutation.isPending} onClick={() => resolveControlMutation.mutate({ workpaperId: wp.id, findingId: control.id, status: "RESOLVED" })}>Resolver</Button>{control.severity !== "BLOCKING" ? <Button size="sm" variant="ghost" disabled={!controlResolutions[control.id]?.trim()} onClick={() => resolveControlMutation.mutate({ workpaperId: wp.id, findingId: control.id, status: "WAIVED" })}>Eximir</Button> : null}</span> : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading"><div><strong>Cierre y arrastre</strong><small>Finalizar congela los hashes y genera los saldos de cierre para el siguiente período.</small></div></div>
                      <dl className="workpaper-close-details"><div><dt>Hash de entrada</dt><dd>{wp.inputHash ? `${wp.inputHash.slice(0, 16)}…` : "Se genera al calcular"}</dd></div><div><dt>Hash de salida</dt><dd>{wp.outputHash ? `${wp.outputHash.slice(0, 16)}…` : "Se genera al finalizar"}</dd></div><div><dt>Controles bloqueantes</dt><dd>{blocking.length}</dd></div></dl>
                    </div>
                  )}
                </div>

                <div className="workpaper-card__actions">
                  {wp.status === "DRAFT" || wp.status === "COLLECTING_INPUTS" ? (
                    <Button
                      variant="primary"
                      disabled={calculateMutation.isPending || !capabilities.has("tax.settlements.calculate")}
                      onClick={() => void calculateMutation.mutate(wp.id)}
                    >
                      Calcular
                    </Button>
                  ) : null}
                  {wp.status === "CHANGES_REQUESTED" ? <Button variant="primary" disabled={calculateMutation.isPending || !capabilities.has("tax.settlements.calculate")} onClick={() => calculateMutation.mutate(wp.id)}>Recalcular</Button> : null}
                  {wp.status === "CALCULATED" ? (
                    <Button
                      variant="primary"
                      disabled={submitMutation.isPending || !capabilities.has("tax.settlements.submit_review")}
                      onClick={() => void submitMutation.mutate(wp.id)}
                    >
                      Enviar a revisión
                    </Button>
                  ) : null}
                  {wp.status === "IN_REVIEW" ? (
                    <span className="study-table__actions">{capabilities.has("tax.settlements.review") ? <><Button variant="primary" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: wp.id, approved: true })}>Aprobar revisión</Button><Button variant="secondary" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: wp.id, approved: false })}>Solicitar cambios</Button></> : null}</span>
                  ) : null}
                  {wp.status === "REVIEWED" ? (
                    <Button
                      variant="primary"
                      disabled={finalizeMutation.isPending || !capabilities.has("tax.settlements.finalize")}
                      onClick={() => void finalizeMutation.mutate(wp.id)}
                    >
                      Finalizar
                    </Button>
                  ) : null}
                  {wp.status === "FINALIZED" && capabilities.has("tax.settlements.rectify") ? <Button variant="secondary" disabled={rectifyMutation.isPending} onClick={() => rectifyMutation.mutate(wp.id)}>Crear rectificativa</Button> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {createMutation.isError || calculateMutation.isError || submitMutation.isError || reviewMutation.isError || finalizeMutation.isError || openingMutation.isError || resolveControlMutation.isError || rectifyMutation.isError || recordPaymentMutation.isError || recordFilingMutation.isError ? <p className="form-error" role="alert">{(createMutation.error ?? calculateMutation.error ?? submitMutation.error ?? reviewMutation.error ?? finalizeMutation.error ?? openingMutation.error ?? resolveControlMutation.error ?? rectifyMutation.error ?? recordPaymentMutation.error ?? recordFilingMutation.error)?.message}</p> : null}
    </div>
  );
}
