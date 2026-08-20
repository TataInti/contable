import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

/**
 * Onboarding fiscal (Puerta 1, G1-09).
 *
 * Flujo: perfil fiscal → inscripción → actividades → períodos → obligaciones.
 * Cada paso persiste en la API.
 */

interface TaxRegime {
  id: string;
  code: string;
  name: string;
}

interface EconomicActivity {
  id: string;
  code: string;
  name: string;
}

interface TaxType {
  id: string;
  code: string;
  name: string;
}

interface TaxpayerProfileVersion {
  id: string;
  version: number;
  legalName: string;
  cuit: string;
  status: "DRAFT" | "IN_REVIEW" | "ACTIVE" | "SUPERSEDED";
}

interface TaxObligation {
  id: string;
  regimeId: string;
  periodId: string;
  status: string;
  dueDate: string | null;
}

interface TaxRegistration {
  id: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  registrationNumber: string | null;
  regime: { id: string; code: string; name: string; taxType: { name: string }; jurisdiction: { name: string } };
}

interface ClientActivityLink {
  id: string;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
  activity: { code: string; name: string; jurisdiction: { name: string } };
}

const CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No Responsable",
};

export function StudyOnboardingFiscal() {
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"perfil" | "inscripcion" | "actividades" | "periodos" | "obligaciones">("perfil");
  const [form, setForm] = useState({
    legalName: "",
    cuit: "",
    personType: "JURIDICA",
    nationalCondition: "RESPONSABLE_INSCRIPTO",
    validFrom: "2026-01-01",
  });
  const [profileId, setProfileId] = useState<string | null>(null);
  const [regimeId, setRegimeId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [taxTypeId, setTaxTypeId] = useState("");

  const profileQuery = useQuery({
    queryKey: ["tax-profile", firmId, clientId],
    queryFn: () =>
      api.get<TaxpayerProfileVersion[]>(`/firms/${firmId}/clients/${clientId}/tax-profile-versions`),
    enabled: Boolean(firmId && clientId),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes"],
    queryFn: () => api.get<TaxRegime[]>(`/tax/regimes`),
    enabled: Boolean(firmId),
  });
  const activitiesQuery = useQuery({
    queryKey: ["tax-activities"],
    queryFn: () => api.get<EconomicActivity[]>(`/tax/activities`),
    enabled: Boolean(firmId),
  });
  const typesQuery = useQuery({
    queryKey: ["tax-types"],
    queryFn: () => api.get<TaxType[]>(`/tax/types`),
    enabled: Boolean(firmId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["tax-obligations", firmId, clientId],
    queryFn: () =>
      api.get<TaxObligation[]>(`/firms/${firmId}/clients/${clientId}/tax-obligations`),
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
    () =>
      profileQuery.data?.find((p) => p.status === "ACTIVE") ??
      profileQuery.data?.find((p) => p.status === "DRAFT") ??
      profileQuery.data?.[0],
    [profileQuery.data],
  );
  const effectiveProfileId = profileId ?? activeProfile?.id;

  const createProfile = useMutation({
    mutationFn: () =>
      api.post<TaxpayerProfileVersion>(`/firms/${firmId}/clients/${clientId}/tax-profile-versions`, {
        legalName: form.legalName.trim(),
        cuit: form.cuit,
        personType: form.personType,
        nationalCondition: form.nationalCondition,
        validFrom: form.validFrom,
      }),
    onSuccess: (profile) => {
      setProfileId(profile.id);
      void queryClient.invalidateQueries({ queryKey: ["tax", firmId, clientId] });
      setStep("inscripcion");
    },
  });

  const submitReview = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-profile-versions/${effectiveProfileId}/submit-review`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax", firmId, clientId] });
    },
  });

  const activate = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-profile-versions/${effectiveProfileId}/activate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax", firmId, clientId] });
    },
  });

  const addRegistration = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-registrations`, {
        profileVersionId: effectiveProfileId,
        regimeId,
        validFrom: form.validFrom,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-registrations", firmId, clientId] });
      setStep("actividades");
    },
  });

  const addActivity = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/activities`, {
        profileVersionId: effectiveProfileId,
        activityId,
        isPrimary: true,
        validFrom: form.validFrom,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["client-tax-activities", firmId, clientId] });
      setStep("periodos");
    },
  });

  const cancelRegistration = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-registrations/${id}/cancel`, {
        validTo: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tax-registrations", firmId, clientId] }),
  });
  const endActivity = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/activities/${id}/end`, {
        validTo: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["client-tax-activities", firmId, clientId] }),
  });

  const createPeriod = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-periods`, {
        taxTypeId,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      }),
    onSuccess: () => {
      setStep("obligaciones");
    },
  });

  if (!firmId || !clientId) {
    return (
      <EmptyState title="Seleccioná un cliente" description="Elegí un cliente para configurar su perfil fiscal." />
    );
  }

  const steps = [
    { key: "perfil", label: "Perfil fiscal" },
    { key: "inscripcion", label: "Inscripción" },
    { key: "actividades", label: "Actividades" },
    { key: "periodos", label: "Períodos" },
    { key: "obligaciones", label: "Obligaciones" },
  ] as const;

  return (
    <div className="study-page">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Configuración fiscal</p>
          <h1>Onboarding fiscal del cliente</h1>
          <p className="study-page__subtitle">
            Perfil, inscripciones, actividades, períodos y obligaciones. Cada paso persiste y queda auditado.
          </p>
        </div>
      </header>

      <nav className="onboarding-steps" aria-label="Pasos del onboarding fiscal">
        {steps.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`onboarding-steps__item${step === s.key ? " onboarding-steps__item--active" : ""}`}
            onClick={() => setStep(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {activeProfile && (
        <section className="study-panel" aria-labelledby="profile-status">
          <div className="study-panel__heading">
            <div>
              <h2 id="profile-status">Perfil vigente</h2>
              <p>
                {activeProfile.legalName} · CUIT {activeProfile.cuit} · v{activeProfile.version}
              </p>
            </div>
            <StatusBadge status={activeProfile.status} />
          </div>
          <div className="study-panel__actions">
            {activeProfile.status === "DRAFT" && (
              <Button variant="secondary" onClick={() => submitReview.mutate()} disabled={submitReview.isPending}>
                Enviar a revisión
              </Button>
            )}
            {activeProfile.status === "IN_REVIEW" && (
              <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
                Activar perfil
              </Button>
            )}
          </div>
        </section>
      )}

      <section className="study-panel fiscal-client-overview" aria-labelledby="fiscal-setup-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="fiscal-setup-title">Configuración vigente</h2>
            <p>Las adhesiones y actividades aplicables quedan siempre visibles antes de abrir una liquidación.</p>
          </div>
        </div>
        <div className="fiscal-client-overview__columns">
          <div>
            <div className="fiscal-client-overview__heading"><h3>Regímenes adheridos</h3><Button size="sm" variant="secondary" onClick={() => setStep("inscripcion")}>Agregar</Button></div>
            {registrationsQuery.isLoading ? <p className="muted-copy">Cargando adhesiones…</p> : (registrationsQuery.data?.length ?? 0) === 0 ? <p className="muted-copy">Todavía no hay regímenes adheridos.</p> : <Table<TaxRegistration>
              rows={registrationsQuery.data ?? []}
              rowKey={(row) => row.id}
              columns={[
                { key: "regime", header: "Régimen", render: (row) => <><strong>{row.regime.name}</strong><br /><small>{row.regime.taxType.name} · {row.regime.jurisdiction.name}</small></> },
                { key: "from", header: "Desde", render: (row) => row.validFrom.slice(0, 10) },
                { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
                { key: "actions", header: "", render: (row) => row.status === "ACTIVE" ? <Button size="sm" variant="ghost" disabled={cancelRegistration.isPending} onClick={() => { if (window.confirm(`Dar de baja ${row.regime.name}?`)) cancelRegistration.mutate(row.id); }}>Dar de baja</Button> : null },
              ]}
            />}
          </div>
          <div>
            <div className="fiscal-client-overview__heading"><h3>Actividades</h3><Button size="sm" variant="secondary" onClick={() => setStep("actividades")}>Agregar</Button></div>
            {clientActivitiesQuery.isLoading ? <p className="muted-copy">Cargando actividades…</p> : (clientActivitiesQuery.data?.length ?? 0) === 0 ? <p className="muted-copy">Todavía no hay actividades vinculadas.</p> : <Table<ClientActivityLink>
              rows={clientActivitiesQuery.data ?? []}
              rowKey={(row) => row.id}
              columns={[
                { key: "activity", header: "Actividad", render: (row) => <><strong>{row.activity.code}</strong><br /><small>{row.activity.name}</small></> },
                { key: "scope", header: "Jurisdicción", render: (row) => row.activity.jurisdiction.name },
                { key: "status", header: "Estado", render: (row) => row.validTo ? "Finalizada" : row.isPrimary ? "Principal" : "Vigente" },
                { key: "actions", header: "", render: (row) => !row.validTo ? <Button size="sm" variant="ghost" disabled={endActivity.isPending} onClick={() => { if (window.confirm(`Finalizar ${row.activity.name}?`)) endActivity.mutate(row.id); }}>Finalizar</Button> : null },
              ]}
            />}
          </div>
        </div>
      </section>

      {step === "perfil" && (
        <section className="study-panel" aria-labelledby="perfil-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="perfil-title">Datos del perfil fiscal</h2>
              <p>Identidad y condición fiscal del contribuyente.</p>
            </div>
          </div>
          <form
            className="study-form"
            onSubmit={(e) => {
              e.preventDefault();
              createProfile.mutate();
            }}
          >
            <Field label="Razón social" id="pf-legal-name" name="legalName" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />
            <Field label="CUIT" id="pf-cuit" name="cuit" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" pattern="\d{11}" required />
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="pf-person-type">
                Tipo de persona
              </label>
              <select
                id="pf-person-type"
                className="ds-field__input"
                value={form.personType}
                onChange={(e) => setForm({ ...form, personType: e.target.value })}
              >
                <option value="JURIDICA">Jurídica</option>
                <option value="FISICA">Física</option>
              </select>
            </div>
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="pf-condition">
                Condición nacional
              </label>
              <select
                id="pf-condition"
                className="ds-field__input"
                value={form.nationalCondition}
                onChange={(e) => setForm({ ...form, nationalCondition: e.target.value })}
              >
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Vigencia desde" id="pf-valid-from" name="validFrom" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required />
            <div className="study-form__actions">
              <Button type="submit" disabled={createProfile.isPending}>
                {createProfile.isPending ? "Guardando…" : "Crear perfil"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === "inscripcion" && (
        <section className="study-panel" aria-labelledby="inscripcion-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="inscripcion-title">Inscripción en régimen</h2>
              <p>Registra el régimen fiscal del contribuyente (IVA RI, monotributo, IIBB…).</p>
            </div>
          </div>
          <form
            className="study-form"
            onSubmit={(e) => {
              e.preventDefault();
              addRegistration.mutate();
            }}
          >
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="reg-regime">
                Régimen
              </label>
              <select id="reg-regime" className="ds-field__input" value={regimeId} onChange={(e) => setRegimeId(e.target.value)} required>
                <option value="">Seleccioná un régimen…</option>
                {regimesQuery.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="study-form__actions">
              <Button type="submit" disabled={addRegistration.isPending || !regimeId || !effectiveProfileId}>
                {addRegistration.isPending ? "Guardando…" : "Registrar inscripción"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === "actividades" && (
        <section className="study-panel" aria-labelledby="actividades-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="actividades-title">Actividad económica</h2>
              <p>Vincula la actividad principal del contribuyente.</p>
            </div>
          </div>
          <form
            className="study-form"
            onSubmit={(e) => {
              e.preventDefault();
              addActivity.mutate();
            }}
          >
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="act-activity">
                Actividad
              </label>
              <select id="act-activity" className="ds-field__input" value={activityId} onChange={(e) => setActivityId(e.target.value)} required>
                <option value="">Seleccioná una actividad…</option>
                {activitiesQuery.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="study-form__actions">
              <Button type="submit" disabled={addActivity.isPending || !activityId || !effectiveProfileId}>
                {addActivity.isPending ? "Guardando…" : "Vincular actividad"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === "periodos" && (
        <section className="study-panel" aria-labelledby="periodos-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="periodos-title">Período fiscal</h2>
              <p>Define el período sobre el que se materializarán las obligaciones.</p>
            </div>
          </div>
          <form
            className="study-form"
            onSubmit={(e) => {
              e.preventDefault();
              createPeriod.mutate();
            }}
          >
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="per-tax-type">
                Impuesto
              </label>
              <select id="per-tax-type" className="ds-field__input" value={taxTypeId} onChange={(e) => setTaxTypeId(e.target.value)} required>
                <option value="">Seleccioná un impuesto…</option>
                {typesQuery.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="study-form__actions">
              <Button type="submit" disabled={createPeriod.isPending || !taxTypeId}>
                {createPeriod.isPending ? "Guardando…" : "Crear período"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === "obligaciones" && (
        <section className="study-panel" aria-labelledby="obligaciones-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="obligaciones-title">Obligaciones materializadas</h2>
              <p>Obligaciones derivadas del perfil, régimen y período.</p>
            </div>
          </div>
          {obligationsQuery.data && obligationsQuery.data.length > 0 ? (
            <Table
              rowKey={(row) => row.id}
              columns={[
                { key: "regimeId", header: "Régimen" },
                { key: "periodId", header: "Período" },
                { key: "status", header: "Estado" },
                { key: "dueDate", header: "Vencimiento" },
              ]}
              rows={obligationsQuery.data.map((o) => ({
                id: o.id,
                regimeId: regimesQuery.data?.find((r) => r.id === o.regimeId)?.name ?? o.regimeId,
                periodId: o.periodId,
                status: o.status,
                dueDate: o.dueDate ?? "—",
              }))}
            />
          ) : (
            <EmptyState title="Sin obligaciones todavía" description="Completá los pasos anteriores para materializar la primera obligación." />
          )}
        </section>
      )}
    </div>
  );
}
