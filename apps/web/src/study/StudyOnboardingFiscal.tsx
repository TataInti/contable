import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Notice, Table, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { formatCuit } from "../lib/cuit";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { ActionDrawer } from "../ui/ActionDrawer";
import {
  DenseHeader,
  DensePage,
  DenseTabs,
  useDensity,
} from "../ui/Dense";
import "./study.css";

type FiscalStep = "perfil" | "inscripcion" | "actividades" | "periodos" | "obligaciones";
type FiscalTab = "resumen" | "regimenes" | "actividades" | "periodos";

/** Pestaña donde vive cada paso de la configuración. */
const STEP_TAB: Record<FiscalStep, FiscalTab> = {
  perfil: "resumen",
  inscripcion: "regimenes",
  actividades: "actividades",
  periodos: "periodos",
  obligaciones: "periodos",
};
type ProfileForm = {
  legalName: string;
  cuit: string;
  fiscalAddress: string;
  personType: "FISICA" | "JURIDICA";
  nationalCondition: keyof typeof CONDITION_LABELS;
  validFrom: string;
};

interface TaxRegime { id: string; code: string; name: string; isActive: boolean }
interface EconomicActivity { id: string; code: string; name: string; isActive: boolean }
interface TaxType { id: string; code: string; name: string; isActive: boolean }
interface TaxpayerProfileVersion {
  id: string;
  version: number;
  legalName: string;
  cuit: string;
  personType: "FISICA" | "JURIDICA";
  nationalCondition: keyof typeof CONDITION_LABELS;
  fiscalAddress: string | null;
  status: "DRAFT" | "IN_REVIEW" | "ACTIVE" | "SUPERSEDED";
}
interface TaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { id: string; code: string; name: string; isActive: boolean };
}
interface TaxObligation {
  id: string;
  status: string;
  dueDate: string | null;
  regime: { id: string; code: string; name: string; isActive: boolean; taxType: { name: string; isActive: boolean }; jurisdiction: { name: string; isActive: boolean } };
  period: { id: string; label: string | null; startDate: string; endDate: string };
}
interface TaxRegistration {
  id: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  registrationNumber: string | null;
  regime: { id: string; code: string; name: string; isActive: boolean; taxType: { id: string; name: string; isActive: boolean }; jurisdiction: { name: string; isActive: boolean } };
}
interface ClientActivityLink {
  id: string;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
  activity: { code: string; name: string; isActive: boolean; jurisdiction: { name: string; isActive: boolean } };
}

const today = new Date().toISOString().slice(0, 10);
/** Mes anterior al actual (AAAA-MM): es el que se liquida normalmente. */
function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}
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

/** Etiqueta del período sin repetir el impuesto, que la tabla ya muestra en su columna. */
function periodName(period: TaxPeriod) {
  const label = periodDisplayLabel(period);
  for (const prefix of [period.taxType.code, period.taxType.name]) {
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[·:—–-]\\s*`, "i");
    if (pattern.test(label)) return label.replace(pattern, "");
  }
  return label;
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
  return <Notice tone="error">{message}</Notice>;
}

export function StudyOnboardingFiscal() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const canWrite = capabilities.has("tax.profile.write");
  const [tab, setTab] = useState<FiscalTab>("resumen");
  const [openFormStep, setOpenFormStep] = useState<FiscalStep | null>(null);
  const [showProfileHistory, setShowProfileHistory] = useState(false);
  const [form, setForm] = useState<ProfileForm>({
    legalName: "",
    cuit: "",
    fiscalAddress: "",
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
  const notify = useNotify();
  const [monthToOpen, setMonthToOpen] = useState(previousMonth);

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
  const selectablePeriods = (periodsQuery.data ?? []).filter((period) => period.taxType.isActive);
  const selectedPeriod = periodsQuery.data?.find((period) => period.id === obligationForm.periodId);
  const eligibleRegistrations = (registrationsQuery.data ?? []).filter(
    (registration) => registration.status === "ACTIVE" && registration.regime.isActive &&
      (!selectedPeriod || registration.regime.taxType.id === selectedPeriod.taxTypeId),
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
      ...(form.fiscalAddress.trim() ? { fiscalAddress: form.fiscalAddress.trim() } : {}),
    }),
    onSuccess: (profile) => { setProfileId(profile.id); invalidateClientFiscal(); setOpenFormStep(null); },
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
    onSuccess: () => { invalidateClientFiscal(); setRegimeId(""); setOpenFormStep(null); },
  });
  const addActivity = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/activities`, { profileVersionId: effectiveProfileId, activityId, isPrimary: true, validFrom: form.validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setActivityId(""); setOpenFormStep(null); },
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
    },
  });
  const createObligation = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/tax-obligations`, {
      profileVersionId: effectiveProfileId, regimeId: obligationForm.regimeId, periodId: obligationForm.periodId,
      ...(obligationForm.dueDate ? { dueDate: obligationForm.dueDate } : {}),
    }),
    onSuccess: () => { invalidateClientFiscal(); setObligationForm({ regimeId: "", periodId: "", dueDate: "" }); setOpenFormStep(null); },
  });

  // Abre el mes entero: un período y una obligación por cada régimen del cliente,
  // con el vencimiento que marca la regla. Lo que ya existe no se toca.
  const openMonth = useMutation({
    mutationFn: () =>
      api.post<{ label: string; regimes: number; periodsCreated: number; obligationsCreated: number }>(
        `/firms/${firmId}/clients/${clientId}/tax-periods/open-month`,
        { month: monthToOpen },
      ),
    onSuccess: (result) => {
      invalidateClientFiscal();
      notify.success(
        result.periodsCreated === 0 && result.obligationsCreated === 0
          ? `${result.label} ya estaba abierto: no faltaba ningún período ni obligación.`
          : `${result.label} quedó abierto: ${result.obligationsCreated} ${result.obligationsCreated === 1 ? "obligación creada" : "obligaciones creadas"}.`,
      );
    },
  });

  if (!firmId || !clientId) return <EmptyState title="Seleccioná un cliente" description="Elegí un cliente para configurar su perfil fiscal." />;

  const mutationError = createProfile.error ?? submitReview.error ?? activate.error ?? addRegistration.error ?? addActivity.error ?? cancelRegistration.error ?? endActivity.error ?? createPeriod.error ?? createObligation.error ?? openMonth.error;
  const openStepForm = (nextStep: FiscalStep) => {
    setOpenFormStep(nextStep);
  };
  const hasActiveProfile = (profileQuery.data ?? []).some((profile) => profile.status === "ACTIVE");
  // Un perfil cargado pero sin activar no está terminado: se dice, en lugar de darlo por completo.
  const stepStatusLabel = (key: FiscalStep) => {
    if (!stepCompletion[key]) return "Pendiente";
    return key === "perfil" && !hasActiveProfile ? "Falta activar" : "Completado";
  };
  const activeRegistrations = (registrationsQuery.data ?? []).filter((row) => row.status === "ACTIVE");
  const currentActivities = (clientActivitiesQuery.data ?? []).filter((row) => !row.validTo);
  const obligationByPeriod = new Map((obligationsQuery.data ?? []).map((obligation) => [obligation.period.id, obligation]));
  const periodsWithObligation = (periodsQuery.data ?? []).filter((period) => obligationByPeriod.has(period.id)).length;
  const periodsWithoutObligation = (periodsQuery.data?.length ?? 0) - periodsWithObligation;
  return (
    <DensePage density={density} flow>
      <DenseHeader
        title="Configuración fiscal"
        description="Datos del contribuyente, regímenes, actividades, períodos y obligaciones del cliente."
        actions={
          nextRequiredStep && canWrite ? (
            <Button onClick={() => openStepForm(nextRequiredStep.key)}>
              {nextRequiredStep.key === "perfil"
                ? "Crear perfil fiscal"
                : `Completar ${nextRequiredStep.label.toLowerCase()}`}
            </Button>
          ) : undefined
        }
      />

      {nextRequiredStep ? (
        <nav className="fiscal-progress" aria-label="Pasos del onboarding fiscal">
          <ol className="fiscal-progress__list">
            {FISCAL_STEPS.map((item, index) => (
              <li key={item.key}>
                <Button
                  type="button"
                  variant="text"
                  size="row"
                  className="fiscal-progress__step"
                  aria-current={nextRequiredStep.key === item.key ? "step" : undefined}
                  onClick={() => setTab(STEP_TAB[item.key])}
                >
                  <span className="fiscal-progress__marker" aria-hidden="true">{index + 1}</span>
                  <span>{item.label}</span>
                  <span className={`fiscal-progress__status${stepCompletion[item.key] ? " fiscal-progress__status--done" : ""}`}>
                    {stepStatusLabel(item.key)}
                  </span>
                </Button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <DenseTabs<FiscalTab>
        label="Secciones de la configuración fiscal"
        idPrefix="fiscal-config-tab"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "resumen", label: "Resumen" },
          { id: "regimenes", label: "Regímenes", count: registrationsQuery.data?.length ?? 0 },
          { id: "actividades", label: "Actividades", count: clientActivitiesQuery.data?.length ?? 0 },
          { id: "periodos", label: "Períodos y obligaciones", count: periodsQuery.data?.length ?? 0 },
        ]}
      />

      <div
        className="fiscal-config"
        id="fiscal-config-tab-panel"
        role="tabpanel"
        aria-labelledby={`fiscal-config-tab-${tab}`}
      >
        {failedQueries.length > 0 ? (
          <Notice tone="error">
            <p>
              <strong>
                No pudimos cargar {failedQueries.length === 1 ? failedQueries[0]?.label ?? "la información" : "parte de la información"}.
              </strong>{" "}
              Revisá tu conexión e intentá de nuevo.
            </p>
            {failedQueries.map((item) =>
              item.query.isError ? (
                <Button
                  key={item.key}
                  type="button"
                  variant="text"
                  size="row"
                  onClick={() => item.query.refetch()}
                >
                  Reintentar {item.label}
                </Button>
              ) : null,
            )}
          </Notice>
        ) : null}

        {tab === "resumen" ? (
          <>
            {!nextRequiredStep ? (
              <p className="fiscal-config__complete">
                <StatusBadge status="COMPLETED" label="Configuración completa" />
                <span>El cliente ya tiene todo lo necesario para abrir una liquidación.</span>
              </p>
            ) : null}

            <section className="fiscal-section" aria-labelledby="contributor-title">
              <div className="fiscal-section__heading">
                <h2 id="contributor-title">Datos del contribuyente</h2>
                {latestProfile ? <StatusBadge status={latestProfile.status} /> : null}
              </div>
              {latestProfile ? (
                <>
                  <dl className="fiscal-facts">
                    <div><dt>Razón social</dt><dd>{latestProfile.legalName}</dd></div>
                    <div><dt>CUIT</dt><dd>{formatCuit(latestProfile.cuit)}</dd></div>
                    <div><dt>Tipo</dt><dd>{latestProfile.personType === "JURIDICA" ? "Persona jurídica" : "Persona física"}</dd></div>
                    <div><dt>Condición</dt><dd>{CONDITION_LABELS[latestProfile.nationalCondition]}</dd></div>
                    <div><dt>Domicilio fiscal</dt><dd>{latestProfile.fiscalAddress?.trim() || "No cargado"}</dd></div>
                    <div><dt>Versión</dt><dd>v{latestProfile.version}</dd></div>
                  </dl>
                  {canWrite || (profileQuery.data?.length ?? 0) > 1 ? <div className="fiscal-section__actions">
                    {canWrite && latestProfile.status === "DRAFT" ? <Button size="sm" variant="secondary" onClick={() => submitReview.mutate()} loading={submitReview.isPending}>Enviar a revisión</Button> : null}
                    {canWrite && latestProfile.status === "IN_REVIEW" ? <Button size="sm" variant="secondary" onClick={() => activate.mutate()} loading={activate.isPending}>Activar perfil</Button> : null}
                    {canWrite && latestProfile.status === "ACTIVE" ? <Button size="sm" variant="secondary" onClick={() => { setProfileId(null); setForm({ legalName: latestProfile.legalName, cuit: latestProfile.cuit, fiscalAddress: latestProfile.fiscalAddress ?? "", personType: latestProfile.personType, nationalCondition: latestProfile.nationalCondition, validFrom: today }); openStepForm("perfil"); }}>Crear nueva versión</Button> : null}
                    {(profileQuery.data?.length ?? 0) > 1 ? <Button type="button" size="sm" variant="ghost" onClick={() => setShowProfileHistory((visible) => !visible)} aria-expanded={showProfileHistory}>{showProfileHistory ? "Ocultar historial" : "Ver historial"}</Button> : null}
                  </div> : null}
                  {showProfileHistory ? <ul className="fiscal-history" aria-label="Historial de versiones fiscales">
                    {profileQuery.data?.map((profile) => <li key={profile.id}><span>v{profile.version} · {profile.legalName}</span><StatusBadge status={profile.status} /></li>)}
                  </ul> : null}
                </>
              ) : (
                <EmptyState
                  size="compact"
                  kind="no-data"
                  title="Todavía no hay un perfil fiscal configurado"
                  description={
                    canWrite
                      ? "Completá los datos del contribuyente para continuar con la configuración fiscal."
                      : "Tenés acceso de consulta; solicitá permiso de edición para crear el perfil."
                  }
                />
              )}
            </section>

            <section className="fiscal-section" aria-labelledby="fiscal-setup-title">
              <div className="fiscal-section__heading">
                <h2 id="fiscal-setup-title">Configuración vigente</h2>
              </div>
              <dl className="fiscal-overview">
                <div>
                  <dt>Regímenes</dt>
                  <dd>
                    {activeRegistrations.length === 0
                      ? <span className="muted-copy">Sin regímenes adheridos</span>
                      : activeRegistrations.map((row) => <span key={row.id} className="fiscal-overview__item">{row.regime.name}</span>)}
                  </dd>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTab("regimenes")}>Ver regímenes</Button>
                </div>
                <div>
                  <dt>Actividades</dt>
                  <dd>
                    {currentActivities.length === 0
                      ? <span className="muted-copy">Sin actividades vinculadas</span>
                      : currentActivities.map((row) => <span key={row.id} className="fiscal-overview__item">{row.activity.code} · {row.activity.name}</span>)}
                  </dd>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTab("actividades")}>Ver actividades</Button>
                </div>
                <div>
                  <dt>Períodos</dt>
                  <dd>
                    {(periodsQuery.data?.length ?? 0) === 0
                      ? <span className="muted-copy">Sin períodos fiscales</span>
                      : <span className="fiscal-overview__item">
                          {periodsQuery.data?.length} {periodsQuery.data?.length === 1 ? "período" : "períodos"} · {periodsWithObligation} con obligación
                          {periodsWithoutObligation > 0 ? ` · ${periodsWithoutObligation} sin obligación` : ""}
                        </span>}
                  </dd>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTab("periodos")}>Ver períodos</Button>
                </div>
              </dl>
            </section>
          </>
        ) : null}

        {tab === "regimenes" ? (
          <section className="fiscal-section" aria-labelledby="fiscal-regimes-title">
            <div className="fiscal-client-overview__heading"><h3 id="fiscal-regimes-title">Regímenes adheridos</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Agregar</Button> : null}</div>
            {registrationsQuery.isLoading ? <p className="muted-copy">Cargando adhesiones…</p> : (registrationsQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin regímenes adheridos" description="Registrá el régimen fiscal que aplica al contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Registrar inscripción</Button> : undefined} /> : <Table<TaxRegistration> rows={registrationsQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "regime", header: "Régimen", render: (row) => <strong>{row.regime.name}{!row.regime.isActive ? " (oculto)" : ""}</strong> },
              { key: "tax", header: "Impuesto", render: (row) => <>{row.regime.taxType.name}{!row.regime.taxType.isActive ? " (oculto)" : ""}</> },
              { key: "jurisdiction", header: "Jurisdicción", render: (row) => <>{row.regime.jurisdiction.name}{!row.regime.jurisdiction.isActive ? " (oculto)" : ""}</> },
              { key: "from", header: "Desde", render: (row) => <span className="tabular-copy">{formatDate(row.validFrom)}</span> },
              { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
              { key: "actions", header: "", align: "right", render: (row) => canWrite && row.status === "ACTIVE" ? <Button size="sm" variant="ghost" loading={cancelRegistration.isPending} onClick={() => confirm.ask({ title: `¿Dar de baja ${row.regime.name}?`, description: "La adhesión al régimen quedará cancelada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Dar de baja", tone: "danger", onConfirm: () => cancelRegistration.mutate(row.id) })}>Dar de baja</Button> : null },
            ]} />}
          </section>
        ) : null}

        {tab === "actividades" ? (
          <section className="fiscal-section" aria-labelledby="fiscal-activities-title">
            <div className="fiscal-client-overview__heading"><h3 id="fiscal-activities-title">Actividades</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Agregar</Button> : null}</div>
            {clientActivitiesQuery.isLoading ? <p className="muted-copy">Cargando actividades…</p> : (clientActivitiesQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin actividades vinculadas" description="Vinculá la actividad económica principal del contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Vincular actividad</Button> : undefined} /> : <Table<ClientActivityLink> rows={clientActivitiesQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "code", header: "Código", render: (row) => <strong>{row.activity.code}{!row.activity.isActive ? " (oculto)" : ""}</strong> },
              { key: "activity", header: "Actividad", render: (row) => <>{row.activity.name}</> },
              { key: "jurisdiction", header: "Jurisdicción", render: (row) => <>{row.activity.jurisdiction.name}{!row.activity.jurisdiction.isActive ? " (oculto)" : ""}</> },
              {
                key: "status",
                header: "Estado",
                render: (row) =>
                  !row.validTo && row.isPrimary ? (
                    <span className="muted-copy">Principal</span>
                  ) : (
                    <StatusBadge
                      status={row.validTo ? "FINALIZED" : "ACTIVE"}
                      label={row.validTo ? "Finalizada" : "Vigente"}
                      className="status-badge--regular"
                    />
                  ),
              },
              { key: "actions", header: "", align: "right", render: (row) => canWrite && !row.validTo ? <Button size="sm" variant="ghost" loading={endActivity.isPending} onClick={() => confirm.ask({ title: `¿Finalizar ${row.activity.name}?`, description: "La actividad quedará finalizada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Finalizar", tone: "danger", onConfirm: () => endActivity.mutate(row.id) })}>Finalizar</Button> : null },
            ]} />}
          </section>
        ) : null}

        {tab === "periodos" ? (
          <section className="fiscal-section" aria-labelledby="fiscal-periods-title">
            <div className="fiscal-client-overview__heading"><h3 id="fiscal-periods-title">Períodos fiscales</h3>{canWrite ? <Button size="sm" variant="ghost" onClick={() => openStepForm("periodos")}>Agregar</Button> : null}</div>
            {canWrite ? (
              <form
                className="fiscal-open-month"
                onSubmit={(event) => { event.preventDefault(); openMonth.mutate(); }}
              >
                <label className="fiscal-open-month__field">
                  <span>Mes a liquidar</span>
                  <input
                    className="ds-field__input"
                    type="month"
                    value={monthToOpen}
                    onChange={(event) => setMonthToOpen(event.target.value)}
                    required
                  />
                </label>
                <Button type="submit" size="sm" variant="secondary" loading={openMonth.isPending} disabled={!monthToOpen}>
                  Abrir mes
                </Button>
                <small className="muted-copy">
                  Crea el período y la obligación de cada régimen del cliente, con su vencimiento.
                </small>
              </form>
            ) : null}
            {periodsQuery.isLoading ? <p className="muted-copy">Cargando períodos…</p> : (periodsQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Todavía no hay períodos fiscales" description="Creá el período de cada impuesto para poder abrir su obligación." /> : <Table<TaxPeriod> rows={periodsQuery.data ?? []} rowKey={(row) => row.id} columns={[
              { key: "tax", header: "Impuesto", render: (row) => <strong>{row.taxType.name}{!row.taxType.isActive ? " (oculto)" : ""}</strong> },
              { key: "period", header: "Período", render: (row) => <>{periodName(row)}</> },
              {
                key: "obligation",
                header: "Obligación",
                render: (row) => {
                  const obligation = obligationByPeriod.get(row.id);
                  return obligation
                    ? <>{obligation.regime.name} <StatusBadge status={obligation.status} /></>
                    : <span className="muted-copy">Sin obligación</span>;
                },
              },
              {
                key: "due",
                header: "Vencimiento",
                render: (row) => {
                  const dueDate = obligationByPeriod.get(row.id)?.dueDate;
                  return dueDate ? <span className="tabular-copy">{formatDate(dueDate)}</span> : <span className="muted-copy">—</span>;
                },
              },
              { key: "actions", header: "", align: "right", render: (row) => canWrite && !obligationByPeriod.has(row.id) ? <Button size="sm" variant="ghost" onClick={() => { setObligationForm({ regimeId: "", periodId: row.id, dueDate: "" }); openStepForm("obligaciones"); }}>Crear obligación</Button> : null },
            ]} />}
          </section>
        ) : null}

        <MutationError error={mutationError} />
      </div>

      <ActionDrawer
        isOpen={openFormStep === "perfil"}
        onClose={() => setOpenFormStep(null)}
        title={latestProfile ? "Crear nueva versión del perfil" : "Crear perfil fiscal"}
        description="Completá la identidad y condición fiscal del contribuyente."
        size="wide"
        footer={
          <>
            <Button type="submit" form="fiscal-profile-form" loading={createProfile.isPending}>
              Crear perfil
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>
              Cancelar
            </Button>
          </>
        }
      >
        <form id="fiscal-profile-form" className="study-form" onSubmit={(event) => { event.preventDefault(); createProfile.mutate(); }}>
          <Field label="Razón social" id="pf-legal-name" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required />
          <Field label="CUIT" id="pf-cuit" value={form.cuit} onChange={(event) => setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" pattern="\d{11}" required />
          <Field label="Domicilio fiscal" id="pf-fiscal-address" value={form.fiscalAddress} onChange={(event) => setForm({ ...form, fiscalAddress: event.target.value })} pattern=".*\S.*" title="Ingresá un domicilio fiscal o dejá el campo vacío." />
          <div className="ds-field"><label className="ds-field__label" htmlFor="pf-person-type">Tipo de persona</label><select id="pf-person-type" className="ds-field__input" value={form.personType} onChange={(event) => setForm({ ...form, personType: event.target.value as "FISICA" | "JURIDICA" })}><option value="JURIDICA">Jurídica</option><option value="FISICA">Física</option></select></div>
          <div className="ds-field"><label className="ds-field__label" htmlFor="pf-condition">Condición nacional</label><select id="pf-condition" className="ds-field__input" value={form.nationalCondition} onChange={(event) => setForm({ ...form, nationalCondition: event.target.value as keyof typeof CONDITION_LABELS })}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <Field label="Vigencia desde" id="pf-valid-from" type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
          <MutationError error={createProfile.error} />
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={openFormStep === "inscripcion"}
        onClose={() => setOpenFormStep(null)}
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
        title="Crear período fiscal"
        description="Definí las fechas reales antes de materializar obligaciones."
        size="wide"
      >
        <form className="study-form" onSubmit={(event) => { event.preventDefault(); createPeriod.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="per-tax-type">Impuesto</label><select id="per-tax-type" className="ds-field__input" value={periodForm.taxTypeId} onChange={(event) => setPeriodForm({ ...periodForm, taxTypeId: event.target.value })} required><option value="">Seleccioná un impuesto…</option>{typesQuery.data?.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}</select></div>
          <Field label="Desde" id="per-start" type="date" value={periodForm.startDate} onChange={(event) => setPeriodForm({ ...periodForm, startDate: event.target.value })} required />
          <Field label="Hasta" id="per-end" type="date" value={periodForm.endDate} onChange={(event) => setPeriodForm({ ...periodForm, endDate: event.target.value })} required />
          <Field label="Etiqueta (opcional)" id="per-label" value={periodForm.label} onChange={(event) => setPeriodForm({ ...periodForm, label: event.target.value })} placeholder="Ej. Agosto 2026" />
          <MutationError error={createPeriod.error} />
          <div className="study-form__actions"><Button type="submit" loading={createPeriod.isPending} disabled={!periodForm.taxTypeId || periodForm.endDate < periodForm.startDate}>Crear período</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={openFormStep === "obligaciones"}
        onClose={() => setOpenFormStep(null)}
        title="Crear obligación"
        description="Vinculá un régimen activo con su período fiscal y vencimiento."
        size="wide"
      >
        <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); createObligation.mutate(); }}>
          <div className="ds-field"><label className="ds-field__label" htmlFor="obl-period">Período fiscal</label><select id="obl-period" className="ds-field__input" value={obligationForm.periodId} onChange={(event) => setObligationForm({ ...obligationForm, periodId: event.target.value, regimeId: "" })} required><option value="">Seleccioná un período…</option>{selectablePeriods.map((period) => <option key={period.id} value={period.id}>{period.taxType.name} · {periodDisplayLabel(period)}</option>)}</select></div>
          <div className="ds-field"><label className="ds-field__label" htmlFor="obl-regime">Régimen adherido</label><select id="obl-regime" className="ds-field__input" value={obligationForm.regimeId} onChange={(event) => setObligationForm({ ...obligationForm, regimeId: event.target.value })} required disabled={!obligationForm.periodId}><option value="">Seleccioná un régimen…</option>{eligibleRegistrations.map((registration) => <option key={registration.id} value={registration.regime.id}>{registration.regime.name}{!registration.regime.isActive ? " (oculto)" : ""} · {registration.regime.jurisdiction.name}{!registration.regime.jurisdiction.isActive ? " (oculto)" : ""}</option>)}</select></div>
          <Field label="Vencimiento (opcional)" id="obl-due-date" type="date" value={obligationForm.dueDate} onChange={(event) => setObligationForm({ ...obligationForm, dueDate: event.target.value })} />
          <MutationError error={createObligation.error} />
          <div className="study-form__actions"><Button type="submit" loading={createObligation.isPending} disabled={!effectiveProfileId || !obligationForm.regimeId || !obligationForm.periodId}>Crear obligación</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
        </form>
      </ActionDrawer>

      <ConfirmDialog confirm={confirm} />
    
    </DensePage>
  );
}
