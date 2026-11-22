import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { formatCuit } from "../lib/cuit";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import type { ClientWithProfile } from "./clientes/tipos";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { DenseHeader, DensePage, DenseTabs, useDensity } from "../ui/Dense";
import "./study.css";
import { PasosFiscales } from "./fiscal/Pasos";
import { MutationError } from "./fiscal/MutationError";
import { AvisoConsultas } from "./fiscal/AvisoConsultas";
import { nextRequiredStepFor, stepCompletionFor, stepStatusLabelFor } from "./fiscal/pasos";
import { PestanaResumen } from "./fiscal/pestanas/PestanaResumen";
import { PestanaRegimenes } from "./fiscal/pestanas/PestanaRegimenes";
import { PestanaActividades } from "./fiscal/pestanas/PestanaActividades";
import { PestanaPeriodos } from "./fiscal/pestanas/PestanaPeriodos";
import { CajonPerfil } from "./fiscal/cajones/CajonPerfil";
import { perfilInicial } from "./fiscal/cajones/perfilInicial";
import { CajonInscripcion } from "./fiscal/cajones/CajonInscripcion";
import { CajonCorregirInscripcion } from "./fiscal/cajones/CajonCorregirInscripcion";
import { CajonCorregirActividad } from "./fiscal/cajones/CajonCorregirActividad";
import { CajonCambioActividad } from "./fiscal/cajones/CajonCambioActividad";
import { CajonCorregirPeriodo, type CorreccionPeriodo } from "./fiscal/cajones/CajonCorregirPeriodo";
import { primerDiaMesAnterior } from "./fiscal/fechas";
import { CajonActividad } from "./fiscal/cajones/CajonActividad";
import { CajonPeriodo } from "./fiscal/cajones/CajonPeriodo";
import { CajonObligacion } from "./fiscal/cajones/CajonObligacion";
import { CajonCategoriaTem } from "./fiscal/cajones/CajonCategoriaTem";
import { CajonCategoriaMonotributo } from "./fiscal/cajones/CajonCategoriaMonotributo";
import { mesActualMonotributo, useMonotributoMes, type FilaCategoriaMonotributo } from "./fiscal/monotributo";
import { useCategoriaTem } from "./fiscal/categoriaTem";
import { periodName, previousMonth, today, type ClientActivityLink, type EconomicActivity, type FiscalStep, type FiscalTab, type ProfileForm, type TaxObligation, type TaxPeriod, type TaxRegime, type TaxRegistration, type TaxType, type TaxpayerProfileVersion } from "./fiscal/utilidades";

// Columna «Estado» de Actividades: el texto «Principal» se queda en este archivo (DesignCorrections lo lee aquí).
function renderEstadoActividad(row: ClientActivityLink) {
  return !row.validTo && row.isPrimary ? (
    <span className="muted-copy">Principal</span>
  ) : (
    <StatusBadge status={row.validTo ? "FINALIZED" : "ACTIVE"} label={row.validTo ? "Finalizada" : "Vigente"} className="status-badge--regular" />
  );
}

export function StudyOnboardingFiscal() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const clientQuery = useQuery({
    queryKey: ["clients", firmId, clientId],
    queryFn: () => api.get<ClientWithProfile>(`/firms/${firmId}/clients/${clientId}`),
    enabled: Boolean(firmId && clientId),
  });
  const queryClient = useQueryClient();
  const canWrite = capabilities.has("tax.profile.write");
  const [tab, setTab] = useState<FiscalTab>("resumen");
  const [openFormStep, setOpenFormStep] = useState<FiscalStep | null>(null);
  const [showProfileHistory, setShowProfileHistory] = useState(false);
  const [form, setForm] = useState<ProfileForm>({
    legalName: "",
    cuit: "",
    fiscalAddress: "",
    personType: "",
    nationalCondition: "",
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
  const [registrationToEdit, setRegistrationToEdit] = useState<TaxRegistration | null>(null);
  const [activityToEdit, setActivityToEdit] = useState<ClientActivityLink | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [periodToEdit, setPeriodToEdit] = useState<TaxPeriod | null>(null);

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
  const categoriaTem = useCategoriaTem(firmId, clientId);
  const monotributo = useMonotributoMes(firmId, clientId, mesActualMonotributo());
  const [monotributoAbierto, setMonotributoAbierto] = useState(false);
  const filaMonotributo: FilaCategoriaMonotributo = {
    regimeIds: monotributo.query.data?.regimeIds ?? [],
    categoria: monotributo.query.data?.category ?? null,
    loading: monotributo.query.isLoading,
    abrir: () => {
      monotributo.guardarCategoria.reset();
      setMonotributoAbierto(true);
    },
  };
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
  const propuestaPerfil = useMemo(() => perfilInicial(clientQuery.data), [clientQuery.data]);
  // Primer perfil: el formulario arranca con lo que ya cargó el alta. Se reaplica si el alta llega después de abrir el cajón;
  // una nueva versión conserva los valores guardados (la pestaña Resumen los carga antes de abrirlo).
  const { legalName: propuestaRazon, cuit: propuestaCuit, personType: propuestaTipo, nationalCondition: propuestaCondicion } = propuestaPerfil;
  useEffect(() => {
    if (openFormStep !== "perfil" || latestProfile) return;
    setForm((actual) => ({ ...actual, legalName: propuestaRazon, cuit: propuestaCuit, personType: propuestaTipo, nationalCondition: propuestaCondicion }));
  }, [openFormStep, latestProfile, propuestaRazon, propuestaCuit, propuestaTipo, propuestaCondicion]);
  const selectablePeriods = (periodsQuery.data ?? []).filter((period) => period.taxType.isActive);
  const selectedPeriod = periodsQuery.data?.find((period) => period.id === obligationForm.periodId);
  const eligibleRegistrations = (registrationsQuery.data ?? []).filter(
    (registration) => registration.status === "ACTIVE" && registration.regime.isActive &&
      (!selectedPeriod || registration.regime.taxType.id === selectedPeriod.taxTypeId),
  );
  const stepCompletion = stepCompletionFor({ latestProfile, registrationsQuery, clientActivitiesQuery, periodsQuery, obligationsQuery });
  const nextRequiredStep = nextRequiredStepFor(stepCompletion);
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
    mutationFn: ({ validFrom }: { validFrom: string }) => api.post(`/firms/${firmId}/clients/${clientId}/tax-registrations`, { profileVersionId: effectiveProfileId, regimeId, validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setRegimeId(""); setOpenFormStep(null); },
  });
  const updateRegistration = useMutation({
    mutationFn: ({ id, validFrom }: { id: string; validFrom: string }) => api.patch(`/firms/${firmId}/clients/${clientId}/tax-registrations/${id}`, { validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setRegistrationToEdit(null); },
  });
  const updatePeriod = useMutation({
    mutationFn: ({ id, startDate, endDate, label }: CorreccionPeriodo) => api.patch(`/firms/${firmId}/clients/${clientId}/tax-periods/${id}`, { startDate, endDate, label: label.trim() || null }),
    onSuccess: () => { invalidateClientFiscal(); setPeriodToEdit(null); },
  });
  const deletePeriod = useMutation({
    mutationFn: (id: string) => api.del(`/firms/${firmId}/clients/${clientId}/tax-periods/${id}`),
    onSuccess: () => { invalidateClientFiscal(); notify.success("Período anulado."); },
  });
  const addActivity = useMutation({
    mutationFn: () => api.post(`/firms/${firmId}/clients/${clientId}/activities`, { profileVersionId: effectiveProfileId, activityId, isPrimary: true }),
    onSuccess: () => { invalidateClientFiscal(); setActivityId(""); setOpenFormStep(null); },
  });
  const updateActivity = useMutation({
    mutationFn: ({ id, validFrom }: { id: string; validFrom: string }) => api.patch(`/firms/${firmId}/clients/${clientId}/activities/${id}`, { validFrom }),
    onSuccess: () => { invalidateClientFiscal(); setActivityToEdit(null); },
  });
  const registerChange = useMutation({
    mutationFn: (valores: { activityId: string; validFrom: string; changeReason: string }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/activities/change`, {
        activityId: valores.activityId,
        validFrom: valores.validFrom,
        ...(valores.changeReason ? { changeReason: valores.changeReason } : {}),
      }),
    onSuccess: () => { invalidateClientFiscal(); setChangeOpen(false); },
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

  const mutationError = createProfile.error ?? submitReview.error ?? activate.error ?? addRegistration.error ?? addActivity.error ?? updateActivity.error ?? cancelRegistration.error ?? endActivity.error ?? createPeriod.error ?? createObligation.error ?? openMonth.error ?? deletePeriod.error;
  const openStepForm = (nextStep: FiscalStep) => {
    setOpenFormStep(nextStep);
  };
  const corregirInscripcion = (registration: TaxRegistration) => { updateRegistration.reset(); setRegistrationToEdit(registration); };
  const corregirPeriodo = (period: TaxPeriod) => { updatePeriod.reset(); setPeriodToEdit(period); };
  const anularPeriodo = (period: TaxPeriod) => confirm.ask({
    title: `¿Anular el período ${period.taxType.name} · ${periodName(period)}?`,
    description: "El período se elimina porque no tiene obligación ni documentos asociados. Esta acción queda registrada en la auditoría.",
    confirmLabel: "Anular período",
    tone: "danger",
    onConfirm: () => deletePeriod.mutate(period.id),
  });
  const hasActiveProfile = (profileQuery.data ?? []).some((profile) => profile.status === "ACTIVE");
  const stepStatusLabel = (key: FiscalStep) => stepStatusLabelFor(key, stepCompletion, hasActiveProfile);
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

      {clientQuery.data ? (
        <dl className="fiscal-overview" aria-label="Cliente">
          <div>
            <dt>CUIT</dt>
            <dd className="tabular-copy">{formatCuit(clientQuery.data.cuit)}</dd>
          </div>
          <div>
            <dt>Terminación de CUIT</dt>
            <dd className="tabular-copy">{clientQuery.data.cuitEnding ?? "Sin CUIT"}</dd>
          </div>
        </dl>
      ) : null}
      {nextRequiredStep ? <PasosFiscales nextRequiredStep={nextRequiredStep} stepCompletion={stepCompletion} stepStatusLabel={stepStatusLabel} setTab={setTab} /> : null}

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
        {failedQueries.length > 0 ? <AvisoConsultas failedQueries={failedQueries} /> : null}

        {tab === "resumen" ? <PestanaResumen nextRequiredStep={nextRequiredStep} canWrite={canWrite} latestProfile={latestProfile} profileQuery={profileQuery} showProfileHistory={showProfileHistory} setShowProfileHistory={setShowProfileHistory} submitReview={submitReview} activate={activate} setProfileId={setProfileId} setForm={setForm} openStepForm={openStepForm} periodsQuery={periodsQuery} activeRegistrations={activeRegistrations} currentActivities={currentActivities} periodsWithObligation={periodsWithObligation} periodsWithoutObligation={periodsWithoutObligation} setTab={setTab} /> : null}
        {tab === "regimenes" ? <PestanaRegimenes canWrite={canWrite} openStepForm={openStepForm} registrationsQuery={registrationsQuery} cancelRegistration={cancelRegistration} corregirFecha={corregirInscripcion} confirm={confirm} categoriaTem={categoriaTem.fila} categoriaMonotributo={filaMonotributo} /> : null}
        {tab === "actividades" ? <PestanaActividades canWrite={canWrite} openStepForm={openStepForm} clientActivitiesQuery={clientActivitiesQuery} endActivity={endActivity} corregirFecha={(row) => { updateActivity.reset(); setActivityToEdit(row); }} registrarCambio={() => { registerChange.reset(); setChangeOpen(true); }} confirm={confirm} renderEstado={renderEstadoActividad} /> : null}
        {tab === "periodos" ? <PestanaPeriodos canWrite={canWrite} monthToOpen={monthToOpen} setMonthToOpen={setMonthToOpen} openMonth={openMonth} periodsQuery={periodsQuery} openStepForm={openStepForm} obligationByPeriod={obligationByPeriod} setObligationForm={setObligationForm} registrations={registrationsQuery.data ?? []} corregirInscripcion={corregirInscripcion} corregirPeriodo={corregirPeriodo} anularPeriodo={anularPeriodo} /> : null}

        <MutationError error={mutationError} />
      </div>

      <CajonPerfil openFormStep={openFormStep} setOpenFormStep={setOpenFormStep} latestProfile={latestProfile} createProfile={createProfile} form={form} setForm={setForm} propuesta={latestProfile ? null : propuestaPerfil} />
      <CajonInscripcion openFormStep={openFormStep} setOpenFormStep={setOpenFormStep} regimeId={regimeId} setRegimeId={setRegimeId} suggestedFrom={primerDiaMesAnterior()} addRegistration={addRegistration} regimesQuery={regimesQuery} effectiveProfileId={effectiveProfileId} />
      <CajonCorregirInscripcion registration={registrationToEdit} onClose={() => setRegistrationToEdit(null)} updateRegistration={updateRegistration} />
      <CajonCorregirActividad activity={activityToEdit} onClose={() => setActivityToEdit(null)} updateActivity={updateActivity} />
      <CajonCambioActividad isOpen={changeOpen} onClose={() => setChangeOpen(false)} vigentes={(clientActivitiesQuery.data ?? []).filter((link) => !link.validTo)} activitiesQuery={activitiesQuery} registrar={registerChange} />
      <CajonCorregirPeriodo period={periodToEdit} onClose={() => setPeriodToEdit(null)} updatePeriod={updatePeriod} />
      <CajonActividad openFormStep={openFormStep} setOpenFormStep={setOpenFormStep} activityId={activityId} setActivityId={setActivityId} addActivity={addActivity} activitiesQuery={activitiesQuery} effectiveProfileId={effectiveProfileId} />
      <CajonPeriodo openFormStep={openFormStep} setOpenFormStep={setOpenFormStep} periodForm={periodForm} setPeriodForm={setPeriodForm} createPeriod={createPeriod} typesQuery={typesQuery} />
      <CajonObligacion openFormStep={openFormStep} setOpenFormStep={setOpenFormStep} obligationForm={obligationForm} setObligationForm={setObligationForm} createObligation={createObligation} selectablePeriods={selectablePeriods} eligibleRegistrations={eligibleRegistrations} effectiveProfileId={effectiveProfileId} />

      <CajonCategoriaTem isOpen={categoriaTem.abierto} onClose={categoriaTem.cerrar} year={categoriaTem.year} estado={categoriaTem.query.data} cargando={categoriaTem.query.isLoading} guardar={categoriaTem.guardar} />
      <CajonCategoriaMonotributo isOpen={monotributoAbierto} onClose={() => setMonotributoAbierto(false)} estado={monotributo.query.data} cargando={monotributo.query.isLoading} guardar={monotributo.guardarCategoria} />

      <ConfirmDialog confirm={confirm} />
    
    </DensePage>
  );
}
