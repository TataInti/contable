import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { Icon } from "../ui/Icon";
import "./study.css";

type FiscalStep = "perfil" | "inscripcion" | "actividades" | "periodos" | "obligaciones";
type ProfileForm = {
  legalName: string;
  cuit: string;
  personType: "FISICA" | "JURIDICA";
  nationalCondition: keyof typeof CONDITION_LABELS;
  validFrom: string;
};

interface TaxRegime { id: string; code: string; name: string }
interface EconomicActivity { id: string; code: string; name: string }
interface TaxType { id: string; code: string; name: string }
interface TaxpayerProfileVersion {
  id: string;
  version: number;
  legalName: string;
  cuit: string;
  personType: "FISICA" | "JURIDICA";
  nationalCondition: keyof typeof CONDITION_LABELS;
  status: "DRAFT" | "IN_REVIEW" | "ACTIVE" | "SUPERSEDED";
}
interface TaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { id: string; code: string; name: string };
}
interface TaxObligation {
  id: string;
  status: string;
  dueDate: string | null;
  regime: { id: string; code: string; name: string; taxType: { name: string }; jurisdiction: { name: string } };
  period: { id: string; label: string | null; startDate: string; endDate: string };
}
interface TaxRegistration {
  id: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  registrationNumber: string | null;
  regime: { id: string; code: string; name: string; taxType: { id: string; name: string }; jurisdiction: { name: string } };
}
interface ClientActivityLink {
  id: string;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
  activity: { code: string; name: string; jurisdiction: { name: string } };
}

const today = new Date().toISOString().slice(0, 10);
const CONDITION_LABELS = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No Responsable",
} as const;

function dateLabel(value: string) {
  return value.slice(0, 10);
}

function periodLabel(period: Pick<TaxPeriod, "label" | "startDate" | "endDate">) {
  return period.label ?? `${dateLabel(period.startDate)} a ${dateLabel(period.endDate)}`;
}

export function StudyOnboardingFiscal() {
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const canWrite = capabilities.has("tax.profile.write");
  const [step, setStep] = useState<FiscalStep>("perfil");
  const [form, setForm] = useState<ProfileForm>({
    legalName: "",
    cuit: "",
    personType: "JURIDICA",
    nationalCondition: "RESPONSABLE_INSCRIPTO",
    validFrom: today,
  });
  const [profileId, setProfileId] = useState<string | null>(null);
  const [regimeId, setRegimeId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [periodForm, setPeriodForm] = useState({ taxTypeId: "", startDate: today, endDate: today, label: "" });
  const [obligationForm, setObligationForm] = useState({ regimeId: "", periodId: "", dueDate: "" });

  const profileQuery = useQuery({
    queryKey: ["tax-profile", firmId, clientId],
    queryFn: () => api.get<TaxpayerProfileVersion[]>(`/firms/${firmId}/clients/${clientId}/tax-profile-versions`),
    enabled: Boolean(firmId && clientId),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes"],
    queryFn: () => api.get<TaxRegime[]>("/tax/regimes"),
    enabled: Boolean(firmId),
  });
  const activitiesQuery = useQuery({
    queryKey: ["tax-activities"],
    queryFn: () => api.get<EconomicActivity[]>("/tax/activities"),
    enabled: Boolean(firmId),
  });
  const typesQuery = useQuery({
    queryKey: ["tax-types"],
    queryFn: () => api.get<TaxType[]>("/tax/types"),
    enabled: Boolean(firmId),
  });
  const periodsQuery = useQuery({
    queryKey: ["tax-periods", firmId, clientId],
    queryFn: () => api.get<TaxPeriod[]>(`/firms/${firmId}/clients/${clientId}/tax-periods`),
    enabled: Boolean(firmId && clientId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["tax-obligations", firmId, clientId],
    queryFn: () => api.get<TaxObligation[]>(`/firms/${firmId}/clients/${clientId}/tax-obligations`),
    enabled: Boolean(firmId && clientId),
  });
  const registrationsQuery = useQuery({
    queryKey: ["tax-registrations", firmId, clientId],
    queryFn: () => api.get<TaxRegistration[]>(`/firms/${firmId}/clients/${clientId}/tax-registrations`),
    enabled: Boolean(firmId && clientId),
  });
  const clientActivitiesQuery = useQuery({
    queryKey: ["client-tax-activities", firmId, clientId],
    queryFn: () => api.get<ClientActivityLink[]>(`/firms/${firmId}/clients/${clientId}/activities`),
    enabled: Boolean(firmId && clientId),
  });

  const activeProfile = useMemo(
    () => profileQuery.data?.find((profile) => profile.status === "ACTIVE") ?? profileQuery.data?.find((profile) => profile.status === "DRAFT") ?? profileQuery.data?.[0],
    [profileQuery.data],
  );
  const effectiveProfileId = profileId ?? activeProfile?.id;
  const selectedPeriod = periodsQuery.data?.find((period) => period.id === obligationForm.periodId);
  const eligibleRegistrations = (registrationsQuery.data ?? []).filter(
    (registration) => registration.status === "ACTIVE" && (!selectedPeriod || registration.regime.taxType.id === selectedPeriod.taxTypeId),
  );

  const invalidateClientFiscal = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tax-profile", firmId, clientId] }),
      queryClient.invalidateQueries({ queryKey: ["tax-registrations", firmId, clientId] }),
      queryClient.invalidateQueries({ queryKey: ["client-tax-activities", firmId, clientId] }),
      queryClient.invalidateQueries({ queryKey: ["tax-periods", firmId, clientId] }),
      queryClient.invalidateQueries({ queryKey: ["tax-obligations", firmId, clientId] }),
    ]);
  };

  const createProfile = useMutation({
    mutationFn: () => api.post<TaxpayerProfileVersion>(`/firms/${firmId}/clients/${clientId}/tax-profile-versions`, {
      legalName: form.legalName.trim(), cuit: form.cuit, personType: form.personType, nationalCondition: form.nationalCondition, validFrom: form.validFrom,
    }),
    onSuccess: (profile) => { setProfileId(profile.id); invalidateClientFiscal(); setStep("inscripcion"); },
  });
  const submitReview = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-profile-versions/${effectiveProfileId}/submit-review`),
    onSuccess: invalidateClientFiscal,
  });
  const activate = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-profile-versions/${effectiveProfileId}/activate`),
    onSuccess: invalidateClientFiscal,
  });
  const addRegistration = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-registrations`, { profileVersionId: effectiveProfileId, regimeId, validFrom: form.validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setRegimeId(""); setStep("actividades"); },
  });
  const addActivity = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/activities`, { profileVersionId: effectiveProfileId, activityId, isPrimary: true, validFrom: form.validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setActivityId(""); setStep("periodos"); },
  });
  const cancelRegistration = useMutation({
    mutationFn: (id: string) => api.post(`/firms/${firmId}/clients/${clientId}/tax-registrations/${id}/cancel`, { validTo: today }),
    onSuccess: invalidateClientFiscal,
  });
  const endActivity = useMutation({
    mutationFn: (id: string) => api.post(`/firms/${firmId}/clients/${clientId}/activities/${id}/end`, { validTo: today }),
    onSuccess: invalidateClientFiscal,
  });
  const createPeriod = useMutation({
    mutationFn: () => api.post<TaxPeriod>(`/firms/${firmId}/clients/${clientId}/tax-periods`, {
      taxTypeId: periodForm.taxTypeId, startDate: periodForm.startDate, endDate: periodForm.endDate,
      ...(periodForm.label.trim() ? { label: periodForm.label.trim() } : {}),
    }),
    onSuccess: (period) => {
      invalidateClientFiscal();
      setPeriodForm({ taxTypeId: "", startDate: today, endDate: today, label: "" });
      setObligationForm({ regimeId: "", periodId: period.id, dueDate: "" });
      setStep("obligaciones");
    },
  });
  const createObligation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-obligations`, {
      profileVersionId: effectiveProfileId, regimeId: obligationForm.regimeId, periodId: obligationForm.periodId,
      ...(obligationForm.dueDate ? { dueDate: obligationForm.dueDate } : {}),
    }),
    onSuccess: () => { invalidateClientFiscal(); setObligationForm({ regimeId: "", periodId: "", dueDate: "" }); },
  });

  if (!firmId || !clientId) return <EmptyState title="Seleccioná un cliente" description="Elegí un cliente para configurar su perfil fiscal." />;

  const steps: Array<{ key: FiscalStep; label: string }> = [
    { key: "perfil", label: "Perfil fiscal" }, { key: "inscripcion", label: "Inscripción" }, { key: "actividades", label: "Actividades" }, { key: "periodos", label: "Períodos" }, { key: "obligaciones", label: "Obligaciones" },
  ];
  const mutationError = createProfile.error ?? submitReview.error ?? activate.error ?? addRegistration.error ?? addActivity.error ?? cancelRegistration.error ?? endActivity.error ?? createPeriod.error ?? createObligation.error;

  return (
    <div className="study-page">
      <header className="study-page__header">
        <div><p className="study-page__eyebrow">Configuración fiscal</p><h1>Onboarding fiscal del cliente</h1><p className="study-page__subtitle">Perfil, adhesiones, actividades, períodos y obligaciones. Cada paso persiste y queda auditado.</p></div>
        {canWrite ? <Button onClick={() => setStep("perfil")}><Icon name="plus" size={16} /> Nueva versión fiscal</Button> : null}
      </header>

      <nav className="onboarding-steps" aria-label="Pasos del onboarding fiscal">
        {steps.map((item) => <button key={item.key} type="button" className={`onboarding-steps__item${step === item.key ? " onboarding-steps__item--active" : ""}`} onClick={() => setStep(item.key)}>{item.label}</button>)}
      </nav>

      {activeProfile ? <section className="study-panel" aria-labelledby="profile-status">
        <div className="study-panel__heading"><div><h2 id="profile-status">Perfil vigente</h2><p>{activeProfile.legalName} · CUIT {activeProfile.cuit} · v{activeProfile.version}</p></div><StatusBadge status={activeProfile.status} /></div>
        {canWrite ? <div className="study-panel__actions">
          {activeProfile.status === "DRAFT" ? <Button variant="secondary" onClick={() => submitReview.mutate()} loading={submitReview.isPending}>Enviar a revisión</Button> : null}
          {activeProfile.status === "IN_REVIEW" ? <Button onClick={() => activate.mutate()} loading={activate.isPending}>Activar perfil</Button> : null}
          {activeProfile.status === "ACTIVE" ? <Button variant="secondary" onClick={() => { setProfileId(null); setForm({ legalName: activeProfile.legalName, cuit: activeProfile.cuit, personType: activeProfile.personType, nationalCondition: activeProfile.nationalCondition, validFrom: today }); setStep("perfil"); }}>Crear nueva versión</Button> : null}
        </div> : null}
      </section> : null}

      <section className="study-panel fiscal-client-overview" aria-labelledby="fiscal-setup-title">
        <div className="study-panel__heading"><div><h2 id="fiscal-setup-title">Configuración vigente</h2><p>Adhesiones, actividades y períodos disponibles para abrir una liquidación.</p></div></div>
        <div className="fiscal-client-overview__columns fiscal-client-overview__columns--three">
          <div>
            <div className="fiscal-client-overview__heading"><h3>Regímenes adheridos</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => setStep("inscripcion")}>Agregar</Button> : null}</div>
            {registrationsQuery.isLoading ? <p className="muted-copy">Cargando adhesiones…</p> : (registrationsQuery.data?.length ?? 0) === 0 ? <p className="muted-copy">Todavía no hay regímenes adheridos.</p> : <Table<TaxRegistration> rows={registrationsQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "regime", header: "Régimen", render: (row) => <><strong>{row.regime.name}</strong><br /><small>{row.regime.taxType.name} · {row.regime.jurisdiction.name}</small></> },
              { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
              { key: "actions", header: "", render: (row) => canWrite && row.status === "ACTIVE" ? <Button size="sm" variant="ghost" loading={cancelRegistration.isPending} onClick={() => { if (window.confirm(`Dar de baja ${row.regime.name}?`)) cancelRegistration.mutate(row.id); }}>Dar de baja</Button> : null },
            ]} />}
          </div>
          <div>
            <div className="fiscal-client-overview__heading"><h3>Actividades</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => setStep("actividades")}>Agregar</Button> : null}</div>
            {clientActivitiesQuery.isLoading ? <p className="muted-copy">Cargando actividades…</p> : (clientActivitiesQuery.data?.length ?? 0) === 0 ? <p className="muted-copy">Todavía no hay actividades vinculadas.</p> : <Table<ClientActivityLink> rows={clientActivitiesQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "activity", header: "Actividad", render: (row) => <><strong>{row.activity.code}</strong><br /><small>{row.activity.name}</small></> },
              { key: "status", header: "Estado", render: (row) => row.validTo ? "Finalizada" : row.isPrimary ? "Principal" : "Vigente" },
              { key: "actions", header: "", render: (row) => canWrite && !row.validTo ? <Button size="sm" variant="ghost" loading={endActivity.isPending} onClick={() => { if (window.confirm(`Finalizar ${row.activity.name}?`)) endActivity.mutate(row.id); }}>Finalizar</Button> : null },
            ]} />}
          </div>
          <div>
            <div className="fiscal-client-overview__heading"><h3>Períodos fiscales</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => setStep("periodos")}>Agregar</Button> : null}</div>
            {periodsQuery.isLoading ? <p className="muted-copy">Cargando períodos…</p> : (periodsQuery.data?.length ?? 0) === 0 ? <p className="muted-copy">Todavía no hay períodos fiscales.</p> : <Table<TaxPeriod> rows={periodsQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "period", header: "Período", render: (row) => <><strong>{row.taxType.name}</strong><br /><small>{periodLabel(row)}</small></> },
              { key: "actions", header: "", render: (row) => canWrite ? <Button size="sm" variant="ghost" onClick={() => { setObligationForm({ regimeId: "", periodId: row.id, dueDate: "" }); setStep("obligaciones"); }}>Crear obligación</Button> : null },
            ]} />}
          </div>
        </div>
      </section>

      {step === "perfil" ? <section className="study-panel" aria-labelledby="perfil-title">
        <div className="study-panel__heading"><div><h2 id="perfil-title">Datos del perfil fiscal</h2><p>Identidad y condición fiscal del contribuyente.</p></div></div>
        {canWrite ? <form className="study-form" onSubmit={(event) => { event.preventDefault(); createProfile.mutate(); }}>
          <Field label="Razón social" id="pf-legal-name" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required />
          <Field label="CUIT" id="pf-cuit" value={form.cuit} onChange={(event) => setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" pattern="\d{11}" required />
          <div className="ds-field"><label className="ds-field__label" htmlFor="pf-person-type">Tipo de persona</label><select id="pf-person-type" className="ds-field__input" value={form.personType} onChange={(event) => setForm({ ...form, personType: event.target.value as "FISICA" | "JURIDICA" })}><option value="JURIDICA">Jurídica</option><option value="FISICA">Física</option></select></div>
          <div className="ds-field"><label className="ds-field__label" htmlFor="pf-condition">Condición nacional</label><select id="pf-condition" className="ds-field__input" value={form.nationalCondition} onChange={(event) => setForm({ ...form, nationalCondition: event.target.value as keyof typeof CONDITION_LABELS })}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <Field label="Vigencia desde" id="pf-valid-from" type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
          <div className="study-form__actions"><Button type="submit" loading={createProfile.isPending}>Crear perfil</Button></div>
        </form> : <p className="muted-copy">Tenés acceso de consulta. Pedí permiso de edición para crear o versionar este perfil.</p>}
      </section> : null}

      {step === "inscripcion" ? <section className="study-panel" aria-labelledby="inscripcion-title">
        <div className="study-panel__heading"><div><h2 id="inscripcion-title">Inscripción en régimen</h2><p>Registra el régimen fiscal aplicable al contribuyente.</p></div></div>
        {canWrite ? <form className="study-form" onSubmit={(event) => { event.preventDefault(); addRegistration.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="reg-regime">Régimen</label><select id="reg-regime" className="ds-field__input" value={regimeId} onChange={(event) => setRegimeId(event.target.value)} required><option value="">Seleccioná un régimen…</option>{regimesQuery.data?.map((regime) => <option key={regime.id} value={regime.id}>{regime.name} ({regime.code})</option>)}</select></div>
          <div className="study-form__actions"><Button type="submit" loading={addRegistration.isPending} disabled={!regimeId || !effectiveProfileId}>Registrar inscripción</Button></div>
        </form> : <p className="muted-copy">Tenés acceso de consulta para las adhesiones de este cliente.</p>}
      </section> : null}

      {step === "actividades" ? <section className="study-panel" aria-labelledby="actividades-title">
        <div className="study-panel__heading"><div><h2 id="actividades-title">Actividad económica</h2><p>Vinculá la actividad principal del contribuyente.</p></div></div>
        {canWrite ? <form className="study-form" onSubmit={(event) => { event.preventDefault(); addActivity.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="act-activity">Actividad</label><select id="act-activity" className="ds-field__input" value={activityId} onChange={(event) => setActivityId(event.target.value)} required><option value="">Seleccioná una actividad…</option>{activitiesQuery.data?.map((activity) => <option key={activity.id} value={activity.id}>{activity.code} — {activity.name}</option>)}</select></div>
          <div className="study-form__actions"><Button type="submit" loading={addActivity.isPending} disabled={!activityId || !effectiveProfileId}>Vincular actividad</Button></div>
        </form> : <p className="muted-copy">Tenés acceso de consulta para las actividades de este cliente.</p>}
      </section> : null}

      {step === "periodos" ? <section className="study-panel" aria-labelledby="periodos-title">
        <div className="study-panel__heading"><div><h2 id="periodos-title">Período fiscal</h2><p>Definí fechas reales antes de materializar obligaciones.</p></div></div>
        {canWrite ? <form className="study-form" onSubmit={(event) => { event.preventDefault(); createPeriod.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="per-tax-type">Impuesto</label><select id="per-tax-type" className="ds-field__input" value={periodForm.taxTypeId} onChange={(event) => setPeriodForm({ ...periodForm, taxTypeId: event.target.value })} required><option value="">Seleccioná un impuesto…</option>{typesQuery.data?.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}</select></div>
          <Field label="Desde" id="per-start" type="date" value={periodForm.startDate} onChange={(event) => setPeriodForm({ ...periodForm, startDate: event.target.value })} required />
          <Field label="Hasta" id="per-end" type="date" value={periodForm.endDate} onChange={(event) => setPeriodForm({ ...periodForm, endDate: event.target.value })} required />
          <Field label="Etiqueta (opcional)" id="per-label" value={periodForm.label} onChange={(event) => setPeriodForm({ ...periodForm, label: event.target.value })} placeholder="Ej. IVA · Agosto 2026" />
          <div className="study-form__actions"><Button type="submit" loading={createPeriod.isPending} disabled={!periodForm.taxTypeId || periodForm.endDate < periodForm.startDate}>Crear período</Button></div>
        </form> : <p className="muted-copy">Tenés acceso de consulta para los períodos fiscales de este cliente.</p>}
      </section> : null}

      {step === "obligaciones" ? <section className="study-panel" aria-labelledby="obligaciones-title">
        <div className="study-panel__heading"><div><h2 id="obligaciones-title">Obligaciones materializadas</h2><p>Vinculá un régimen activo con su período fiscal y vencimiento.</p></div></div>
        {canWrite ? <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); createObligation.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="obl-period">Período fiscal</label><select id="obl-period" className="ds-field__input" value={obligationForm.periodId} onChange={(event) => setObligationForm({ ...obligationForm, periodId: event.target.value, regimeId: "" })} required><option value="">Seleccioná un período…</option>{periodsQuery.data?.map((period) => <option key={period.id} value={period.id}>{period.taxType.name} · {periodLabel(period)}</option>)}</select></div>
          <div className="ds-field"><label className="ds-field__label" htmlFor="obl-regime">Régimen adherido</label><select id="obl-regime" className="ds-field__input" value={obligationForm.regimeId} onChange={(event) => setObligationForm({ ...obligationForm, regimeId: event.target.value })} required disabled={!obligationForm.periodId}><option value="">Seleccioná un régimen…</option>{eligibleRegistrations.map((registration) => <option key={registration.id} value={registration.regime.id}>{registration.regime.name} · {registration.regime.jurisdiction.name}</option>)}</select></div>
          <Field label="Vencimiento (opcional)" id="obl-due-date" type="date" value={obligationForm.dueDate} onChange={(event) => setObligationForm({ ...obligationForm, dueDate: event.target.value })} />
          <div className="study-form__actions"><Button type="submit" loading={createObligation.isPending} disabled={!effectiveProfileId || !obligationForm.regimeId || !obligationForm.periodId}>Crear obligación</Button></div>
        </form> : null}
        {(obligationsQuery.data?.length ?? 0) > 0 ? <Table<TaxObligation> rowKey={(row) => row.id} columns={[
          { key: "regime", header: "Régimen", render: (row) => <><strong>{row.regime.name}</strong><br /><small>{row.regime.taxType.name} · {row.regime.jurisdiction.name}</small></> },
          { key: "period", header: "Período", render: (row) => row.period.label ?? `${dateLabel(row.period.startDate)} a ${dateLabel(row.period.endDate)}` },
          { key: "due", header: "Vencimiento", render: (row) => row.dueDate ? dateLabel(row.dueDate) : "Sin informar" },
          { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
        ]} rows={obligationsQuery.data ?? []} /> : <EmptyState title="Sin obligaciones todavía" description="Creá una obligación al terminar de definir un período fiscal y un régimen adherido." action={canWrite ? <Button variant="secondary" onClick={() => setStep("periodos")}>Crear período fiscal</Button> : undefined} />}
      </section> : null}

      {mutationError ? <p className="form-error" role="alert">{mutationError.message}</p> : null}
    </div>
  );
}
