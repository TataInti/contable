import type { UseQueryResult } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { Button, EmptyState } from "@contable/design-system";
import type { ClientConfigurationMissing } from "@contable/contracts";
import { formatCuit } from "../../../lib/cuit";
import { StatusBadge } from "../../../ui/StatusBadge";
import { CONDITION_LABELS, today, type ClientActivityLink, type FiscalStep, type FiscalTab, type Mutacion, type ProfileForm, type TaxPeriod, type TaxRegistration, type TaxpayerProfileVersion } from "../utilidades";

type Props = {
  configuracionCompleta: boolean;
  faltantes: ClientConfigurationMissing[];
  abrirFaltante: (step: ClientConfigurationMissing["step"]) => void;
  canWrite: boolean;
  latestProfile: TaxpayerProfileVersion | undefined;
  profileQuery: UseQueryResult<TaxpayerProfileVersion[]>;
  showProfileHistory: boolean;
  setShowProfileHistory: Dispatch<SetStateAction<boolean>>;
  submitReview: Mutacion;
  activate: Mutacion;
  setProfileId: Dispatch<SetStateAction<string | null>>;
  setForm: Dispatch<SetStateAction<ProfileForm>>;
  openStepForm: (paso: FiscalStep) => void;
  periodsQuery: UseQueryResult<TaxPeriod[]>;
  activeRegistrations: TaxRegistration[];
  currentActivities: ClientActivityLink[];
  periodsWithObligation: number;
  periodsWithoutObligation: number;
  setTab: Dispatch<SetStateAction<FiscalTab>>;
};

export function PestanaResumen({ configuracionCompleta, faltantes, abrirFaltante, canWrite, latestProfile, profileQuery, showProfileHistory, setShowProfileHistory, submitReview, activate, setProfileId, setForm, openStepForm, periodsQuery, activeRegistrations, currentActivities, periodsWithObligation, periodsWithoutObligation, setTab }: Props) {
  return (
    <>
      {configuracionCompleta ? (
        <p className="fiscal-config__complete">
          <StatusBadge status="COMPLETED" label="Configuración completa" />
          <span>El cliente ya tiene todo lo necesario para abrir una liquidación.</span>
        </p>
      ) : faltantes.length ? <p>Falta: {faltantes.map((gap, index) => <span key={gap.key}>{index ? ", " : ""}<Button type="button" variant="text" size="row" onClick={() => abrirFaltante(gap.step)}>{gap.label}</Button></span>)}.</p> : null}

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
  );
}
