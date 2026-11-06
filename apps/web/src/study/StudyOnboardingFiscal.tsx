import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import {
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
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

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function periodDisplayLabel(period: Pick<TaxPeriod, "label" | "startDate" | "endDate">) {
  const range = `${formatDate(period.startDate)} – ${formatDate(period.endDate)}`;
  return period.label && !/\d{6,}/.test(period.label) ? period.label : range;
}

const FISCAL_STEPS: Array<{ key: FiscalStep; label: string }> = [
  { key: "perfil", label: "Perfil fiscal" },
  { key: "inscripcion", label: "Inscripción" },
  { key: "actividades", label: "Actividades" },
  { key: "periodos", label: "Períodos" },
  { key: "obligaciones", label: "Obligaciones" },
];

function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
  return <p className="form-error" role="alert">{message}</p>;
}

export function StudyOnboardingFiscal() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const canWrite = capabilities.has("tax.profile.write");
  const [step, setStep] = useState<FiscalStep>("perfil");
  const [openFormStep, setOpenFormStep] = useState<FiscalStep | null>(null);
  const [showProfileHistory, setShowProfileHistory] = useState(false);
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
  const confirm = useConfirmAction();

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

  const latestProfile = useMemo(
    () =>
      (profileQuery.data ?? []).reduce<TaxpayerProfileVersion | undefined>(
        (latest, profile) => (!latest || profile.version > latest.version ? profile : latest),
        undefined,
      ),
    [profileQuery.data],
  );
  const effectiveProfileId = profileId ?? latestProfile?.id;
  const selectedPeriod = periodsQuery.data?.find((period) => period.id === obligationForm.periodId);
  const eligibleRegistrations = (registrationsQuery.data ?? []).filter(
    (registration) => registration.status === "ACTIVE" && (!selectedPeriod || registration.regime.taxType.id === selectedPeriod.taxTypeId),
  );
  const stepCompletion: Record<FiscalStep, boolean> = {
    perfil: Boolean(latestProfile),
    inscripcion: (registrationsQuery.data?.length ?? 0) > 0,
    actividades: (clientActivitiesQuery.data?.length ?? 0) > 0,
    periodos: (periodsQuery.data?.length ?? 0) > 0,
    obligaciones: (obligationsQuery.data?.length ?? 0) > 0,
  };
  const nextRequiredStep = FISCAL_STEPS.find((item) => !stepCompletion[item.key]);
  const fiscalQueries = [
    { key: "perfil", label: "el perfil fiscal", query: profileQuery },
    { key: "regimenes", label: "los regímenes", query: regimesQuery },
    { key: "actividades", label: "las actividades", query: activitiesQuery },
    { key: "impuestos", label: "los impuestos", query: typesQuery },
    { key: "periodos", label: "los períodos fiscales", query: periodsQuery },
    { key: "obligaciones", label: "las obligaciones", query: obligationsQuery },
    { key: "adhesiones", label: "las adhesiones", query: registrationsQuery },
    { key: "actividades-cliente", label: "las actividades del cliente", query: clientActivitiesQuery },
  ];
  const failedQueries = fiscalQueries.filter((item) => item.query.isError);

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
    onSuccess: (profile) => { setProfileId(profile.id); invalidateClientFiscal(); setOpenFormStep(null); setStep("inscripcion"); },
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
    onSuccess: () => { invalidateClientFiscal(); setRegimeId(""); setOpenFormStep(null); setStep("actividades"); },
  });
  const addActivity = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/activities`, { profileVersionId: effectiveProfileId, activityId, isPrimary: true, validFrom: form.validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setActivityId(""); setOpenFormStep(null); setStep("periodos"); },
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
      setOpenFormStep(null);
      setStep("obligaciones");
    },
  });
  const createObligation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-obligations`, {
      profileVersionId: effectiveProfileId, regimeId: obligationForm.regimeId, periodId: obligationForm.periodId,
      ...(obligationForm.dueDate ? { dueDate: obligationForm.dueDate } : {}),
    }),
    onSuccess: () => { invalidateClientFiscal(); setObligationForm({ regimeId: "", periodId: "", dueDate: "" }); setOpenFormStep(null); },
  });

  if (!firmId || !clientId) return <EmptyState title="Seleccioná un cliente" description="Elegí un cliente para configurar su perfil fiscal." />;

  const mutationError = createProfile.error ?? submitReview.error ?? activate.error ?? addRegistration.error ?? addActivity.error ?? cancelRegistration.error ?? endActivity.error ?? createPeriod.error ?? createObligation.error;
  const openStepForm = (nextStep: FiscalStep) => {
    setStep(nextStep);
    setOpenFormStep(nextStep);
  };
  return (
    <DensePage density={density} flow>
      <DenseHeader
        eyebrow="Configuración fiscal"
        title="Onboarding fiscal del cliente"
        description="Perfil, adhesiones, actividades, períodos y obligaciones. Cada paso persiste y queda auditado."
      />

      <StatStrip
        label="Avance del onboarding fiscal"
        items={FISCAL_STEPS.map((item) => ({
          key: item.key,
          label: item.label,
          value: stepCompletion[item.key] ? "Completo" : "Pendiente",
          tone: stepCompletion[item.key] ? undefined : ("warn" as const),
          active: step === item.key,
          onSelect: () => openStepForm(item.key),
        }))}
      />


      <div className="fiscal-onboarding-layout">
        <nav className="fiscal-steps" aria-label="Pasos del onboarding fiscal">
          <ol className="fiscal-steps__list">
            {FISCAL_STEPS.map((item, index) => (
              <li key={item.key} className="fiscal-steps__item">
                <button
                  type="button"
                  className={`fiscal-steps__button${step === item.key ? " fiscal-steps__button--active" : ""}${stepCompletion[item.key] ? " fiscal-steps__button--done" : ""}`}
                  aria-current={step === item.key ? "step" : undefined}
                  onClick={() => openStepForm(item.key)}
                >
                  <span className="fiscal-steps__marker" aria-hidden="true">{stepCompletion[item.key] ? <Icon name="check" size={13} /> : index + 1}</span>
                  <span className="fiscal-steps__label">{item.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="fiscal-onboarding-content">
          {failedQueries.length > 0 ? <div className="form-error" role="alert">
            <p><strong>No pudimos cargar {failedQueries.length === 1 ? failedQueries[0]?.label ?? "la información" : "parte de la información"}.</strong> Revisá tu conexión e intentá de nuevo.</p>
            {failedQueries.map((item) => item.query.isError ? <button key={item.key} type="button" className="fiscal-retry" onClick={() => item.query.refetch()}>Reintentar {item.label}</button> : null)}
          </div> : null}

          <section className="study-panel fiscal-contributor" aria-labelledby="contributor-title">
            <div className="fiscal-contributor__heading">
              <div>
                <p className="study-page__eyebrow">Identidad fiscal</p>
                <h2 id="contributor-title">Datos del contribuyente</h2>
                <p>Identidad, condición frente al impuesto y estado de la última versión.</p>
              </div>
              {latestProfile ? <StatusBadge status={latestProfile.status} /> : null}
            </div>
            {latestProfile ? (
              <>
                <dl className="fiscal-contributor__facts">
                  <div><dt>Razón social</dt><dd>{latestProfile.legalName}</dd></div>
                  <div><dt>CUIT</dt><dd>{latestProfile.cuit}</dd></div>
                  <div><dt>Tipo</dt><dd>{latestProfile.personType === "JURIDICA" ? "Persona jurídica" : "Persona física"}</dd></div>
                  <div><dt>Condición</dt><dd>{CONDITION_LABELS[latestProfile.nationalCondition]}</dd></div>
                  <div><dt>Versión</dt><dd>v{latestProfile.version}</dd></div>
                </dl>
                {canWrite || (profileQuery.data?.length ?? 0) > 1 ? <div className="study-panel__actions fiscal-contributor__actions">
                  {canWrite && latestProfile.status === "DRAFT" ? <Button variant="secondary" onClick={() => submitReview.mutate()} loading={submitReview.isPending}>Enviar a revisión</Button> : null}
                  {canWrite && latestProfile.status === "IN_REVIEW" ? <Button onClick={() => activate.mutate()} loading={activate.isPending}>Activar perfil</Button> : null}
                  {canWrite && latestProfile.status === "ACTIVE" ? <Button variant="secondary" onClick={() => { setProfileId(null); setForm({ legalName: latestProfile.legalName, cuit: latestProfile.cuit, personType: latestProfile.personType, nationalCondition: latestProfile.nationalCondition, validFrom: today }); openStepForm("perfil"); }}>Crear nueva versión</Button> : null}
                  {(profileQuery.data?.length ?? 0) > 1 ? <Button type="button" variant="ghost" onClick={() => setShowProfileHistory((visible) => !visible)} aria-expanded={showProfileHistory}>{showProfileHistory ? "Ocultar historial" : "Ver historial"}</Button> : null}
                </div> : null}
                {showProfileHistory ? <ul className="fiscal-contributor__history" aria-label="Historial de versiones fiscales">
                  {profileQuery.data?.map((profile) => <li key={profile.id}><span>v{profile.version} · {profile.legalName}</span><StatusBadge status={profile.status} /></li>)}
                </ul> : null}
                {submitReview.error || activate.error ? <MutationError error={submitReview.error ?? activate.error} /> : null}
              </>
            ) : (
              <div className="fiscal-contributor__empty">
                <p>Todavía no hay un perfil fiscal configurado para este cliente.</p>
                {canWrite ? <Button onClick={() => openStepForm("perfil")}>Crear perfil fiscal</Button> : <p className="muted-copy">Tenés acceso de consulta. Pedí permiso de edición para crear el perfil.</p>}
              </div>
            )}
          </section>

          <section className="fiscal-next-step" aria-labelledby="next-fiscal-step-title">
            <div>
              <p className="study-page__eyebrow">Flujo guiado</p>
              <h2 id="next-fiscal-step-title">{nextRequiredStep ? "Próximo paso" : "Configuración completa"}</h2>
              <p>{nextRequiredStep ? `Completá ${nextRequiredStep.label.toLowerCase()} para continuar con la configuración fiscal.` : "El perfil, las adhesiones, las actividades, los períodos y las obligaciones ya están configurados."}</p>
            </div>
            {nextRequiredStep && canWrite ? <Button onClick={() => openStepForm(nextRequiredStep.key)}>Completar {nextRequiredStep.label}</Button> : null}
          </section>

      <section className="study-panel fiscal-client-overview" aria-labelledby="fiscal-setup-title">
        <div className="study-panel__heading"><div><h2 id="fiscal-setup-title">Configuración vigente</h2><p>Adhesiones, actividades y períodos disponibles para abrir una liquidación.</p></div></div>
        <div className="fiscal-client-overview__columns">
          <div>
            <div className="fiscal-client-overview__heading"><h3>Regímenes adheridos</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Agregar</Button> : null}</div>
            {registrationsQuery.isLoading ? <p className="muted-copy">Cargando adhesiones…</p> : (registrationsQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin regímenes adheridos" description="Registrá el régimen fiscal que aplica al contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Registrar inscripción</Button> : undefined} /> : <Table<TaxRegistration> rows={registrationsQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "regime", header: "Régimen", render: (row) => <><strong>{row.regime.name}</strong><br /><small>{row.regime.taxType.name} · {row.regime.jurisdiction.name}</small></> },
              { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
              { key: "actions", header: "", render: (row) => canWrite && row.status === "ACTIVE" ? <Button size="sm" variant="ghost" loading={cancelRegistration.isPending} onClick={() => confirm.ask({ title: `¿Dar de baja ${row.regime.name}?`, description: "La adhesión al régimen quedará cancelada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Dar de baja", tone: "danger", onConfirm: () => cancelRegistration.mutate(row.id) })}>Dar de baja</Button> : null },
            ]} />}
          </div>
          <div>
            <div className="fiscal-client-overview__heading"><h3>Actividades</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Agregar</Button> : null}</div>
            {clientActivitiesQuery.isLoading ? <p className="muted-copy">Cargando actividades…</p> : (clientActivitiesQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin actividades vinculadas" description="Vinculá la actividad económica principal del contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Vincular actividad</Button> : undefined} /> : <Table<ClientActivityLink> rows={clientActivitiesQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "activity", header: "Actividad", render: (row) => <><strong>{row.activity.code}</strong><br /><small>{row.activity.name}</small></> },
              { key: "status", header: "Estado", render: (row) => row.validTo ? "Finalizada" : row.isPrimary ? "Principal" : "Vigente" },
              { key: "actions", header: "", render: (row) => canWrite && !row.validTo ? <Button size="sm" variant="ghost" loading={endActivity.isPending} onClick={() => confirm.ask({ title: `¿Finalizar ${row.activity.name}?`, description: "La actividad quedará finalizada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Finalizar", tone: "danger", onConfirm: () => endActivity.mutate(row.id) })}>Finalizar</Button> : null },
            ]} />}
          </div>
        </div>
        <div className="fiscal-client-overview__periods">
          <div className="fiscal-client-overview__heading"><h3>Períodos fiscales</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("periodos")}>Agregar</Button> : null}</div>
          {periodsQuery.isLoading ? <p className="muted-copy">Cargando períodos…</p> : (periodsQuery.data?.length ?? 0) === 0 ? <p className="muted-copy">Todavía no hay períodos fiscales.</p> : <Table<TaxPeriod> rows={periodsQuery.data ?? []} rowKey={(row) => row.id} columns={[
            { key: "period", header: "Período", render: (row) => <><strong>{row.taxType.name}</strong><br /><small>{periodDisplayLabel(row)}</small></> },
            { key: "actions", header: "", render: (row) => canWrite ? <Button size="sm" variant="ghost" onClick={() => { setObligationForm({ regimeId: "", periodId: row.id, dueDate: "" }); openStepForm("obligaciones"); }}>Crear obligación</Button> : null },
          ]} />}
        </div>
      </section>

          <MutationError error={mutationError} />
        </div>
      </div>

      <ActionDrawer
        isOpen={openFormStep === "perfil"}
        onClose={() => setOpenFormStep(null)}
        eyebrow="Onboarding fiscal"
        title={latestProfile ? "Crear nueva versión del perfil" : "Crear perfil fiscal"}
        description="Completá la identidad y condición fiscal del contribuyente."
        size="wide"
      >
        <form className="study-form" onSubmit={(event) => { event.preventDefault(); createProfile.mutate(); }}>
          <Field label="Razón social" id="pf-legal-name" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required />
          <Field label="CUIT" id="pf-cuit" value={form.cuit} onChange={(event) => setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" pattern="\d{11}" required />
          <div className="ds-field"><label className="ds-field__label" htmlFor="pf-person-type">Tipo de persona</label><select id="pf-person-type" className="ds-field__input" value={form.personType} onChange={(event) => setForm({ ...form, personType: event.target.value as "FISICA" | "JURIDICA" })}><option value="JURIDICA">Jurídica</option><option value="FISICA">Física</option></select></div>
          <div className="ds-field"><label className="ds-field__label" htmlFor="pf-condition">Condición nacional</label><select id="pf-condition" className="ds-field__input" value={form.nationalCondition} onChange={(event) => setForm({ ...form, nationalCondition: event.target.value as keyof typeof CONDITION_LABELS })}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <Field label="Vigencia desde" id="pf-valid-from" type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
          <MutationError error={createProfile.error} />
          <div className="study-form__actions"><Button type="submit" loading={createProfile.isPending}>Crear perfil</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={openFormStep === "inscripcion"}
        onClose={() => setOpenFormStep(null)}
        eyebrow="Onboarding fiscal"
        title="Registrar inscripción"
        description="Elegí el régimen fiscal aplicable al contribuyente."
      >
        <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); addRegistration.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="reg-regime">Régimen</label><select id="reg-regime" className="ds-field__input" value={regimeId} onChange={(event) => setRegimeId(event.target.value)} required><option value="">Seleccioná un régimen…</option>{regimesQuery.data?.map((regime) => <option key={regime.id} value={regime.id}>{regime.name} ({regime.code})</option>)}</select></div>
          <MutationError error={addRegistration.error} />
          <div className="study-form__actions"><Button type="submit" loading={addRegistration.isPending} disabled={!regimeId || !effectiveProfileId}>Registrar inscripción</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={openFormStep === "actividades"}
        onClose={() => setOpenFormStep(null)}
        eyebrow="Onboarding fiscal"
        title="Vincular actividad económica"
        description="Seleccioná la actividad principal del contribuyente."
      >
        <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); addActivity.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="act-activity">Actividad</label><select id="act-activity" className="ds-field__input" value={activityId} onChange={(event) => setActivityId(event.target.value)} required><option value="">Seleccioná una actividad…</option>{activitiesQuery.data?.map((activity) => <option key={activity.id} value={activity.id}>{activity.code} — {activity.name}</option>)}</select></div>
          <MutationError error={addActivity.error} />
          <div className="study-form__actions"><Button type="submit" loading={addActivity.isPending} disabled={!activityId || !effectiveProfileId}>Vincular actividad</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={openFormStep === "periodos"}
        onClose={() => setOpenFormStep(null)}
        eyebrow="Onboarding fiscal"
        title="Crear período fiscal"
        description="Definí las fechas reales antes de materializar obligaciones."
        size="wide"
      >
        <form className="study-form" onSubmit={(event) => { event.preventDefault(); createPeriod.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="per-tax-type">Impuesto</label><select id="per-tax-type" className="ds-field__input" value={periodForm.taxTypeId} onChange={(event) => setPeriodForm({ ...periodForm, taxTypeId: event.target.value })} required><option value="">Seleccioná un impuesto…</option>{typesQuery.data?.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}</select></div>
          <Field label="Desde" id="per-start" type="date" value={periodForm.startDate} onChange={(event) => setPeriodForm({ ...periodForm, startDate: event.target.value })} required />
          <Field label="Hasta" id="per-end" type="date" value={periodForm.endDate} onChange={(event) => setPeriodForm({ ...periodForm, endDate: event.target.value })} required />
          <Field label="Etiqueta (opcional)" id="per-label" value={periodForm.label} onChange={(event) => setPeriodForm({ ...periodForm, label: event.target.value })} placeholder="Ej. IVA · Agosto 2026" />
          <MutationError error={createPeriod.error} />
          <div className="study-form__actions"><Button type="submit" loading={createPeriod.isPending} disabled={!periodForm.taxTypeId || periodForm.endDate < periodForm.startDate}>Crear período</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={openFormStep === "obligaciones"}
        onClose={() => setOpenFormStep(null)}
        eyebrow="Onboarding fiscal"
        title="Crear obligación"
        description="Vinculá un régimen activo con su período fiscal y vencimiento."
        size="wide"
      >
        <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); createObligation.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="obl-period">Período fiscal</label><select id="obl-period" className="ds-field__input" value={obligationForm.periodId} onChange={(event) => setObligationForm({ ...obligationForm, periodId: event.target.value, regimeId: "" })} required><option value="">Seleccioná un período…</option>{periodsQuery.data?.map((period) => <option key={period.id} value={period.id}>{period.taxType.name} · {periodDisplayLabel(period)}</option>)}</select></div>
          <div className="ds-field"><label className="ds-field__label" htmlFor="obl-regime">Régimen adherido</label><select id="obl-regime" className="ds-field__input" value={obligationForm.regimeId} onChange={(event) => setObligationForm({ ...obligationForm, regimeId: event.target.value })} required disabled={!obligationForm.periodId}><option value="">Seleccioná un régimen…</option>{eligibleRegistrations.map((registration) => <option key={registration.id} value={registration.regime.id}>{registration.regime.name} · {registration.regime.jurisdiction.name}</option>)}</select></div>
          <Field label="Vencimiento (opcional)" id="obl-due-date" type="date" value={obligationForm.dueDate} onChange={(event) => setObligationForm({ ...obligationForm, dueDate: event.target.value })} />
          <MutationError error={createObligation.error} />
          <div className="study-form__actions"><Button type="submit" loading={createObligation.isPending} disabled={!effectiveProfileId || !obligationForm.regimeId || !obligationForm.periodId}>Crear obligación</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ConfirmDialog confirm={confirm} />
    
    </DensePage>
  );
}
