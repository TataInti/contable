import { useEffect, useRef, type FormEvent } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Field, Notice } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { ApiError, type Client } from "../../../lib/api";
import {
  ARGENTINA_PROVINCES,
  BACKED_CURRENCIES,
  CLIENT_LEGAL_FORMS,
  CLIENT_VAT_CONDITION_LABELS,
  CLIENT_VAT_CONDITIONS,
  clientEconomicActivityValue,
  type CatalogJurisdiction,
  type ClientEconomicActivityOption,
} from "@contable/contracts";
import { sinRespuesta } from "../consultas";
import type { CatalogosFicha } from "../useCatalogosFicha";
import type { ClientProfile, ClientProfileForm, ClientWithProfile } from "../tipos";

export interface FormularioIdentidad {
  legalName: string;
  tradeName: string;
  cuit: string;
}

interface PanelEdicionProps {
  editingClient: ClientWithProfile | null;
  setEditingClient: (cliente: ClientWithProfile | null) => void;
  identityForm: FormularioIdentidad;
  setIdentityForm: (valor: FormularioIdentidad) => void;
  profileForm: ClientProfileForm;
  setProfileForm: (valor: ClientProfileForm) => void;
  updateIdentity: UseMutationResult<Client, Error, void>;
  updateProfile: UseMutationResult<ClientProfile, Error, void>;
  submitClientEdit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  jurisdictionCatalog: UseQueryResult<(CatalogJurisdiction & { isActive: boolean })[], Error>;
  clientActivityCatalog: UseQueryResult<ClientEconomicActivityOption[], Error>;
  catalogos: CatalogosFicha;
  guardadoParcial: "identidad" | "ficha" | null;
}

export function PanelEdicion({
  editingClient,
  setEditingClient,
  identityForm,
  setIdentityForm,
  profileForm,
  setProfileForm,
  updateIdentity,
  updateProfile,
  submitClientEdit,
  jurisdictionCatalog,
  clientActivityCatalog,
  catalogos,
  guardadoParcial,
}: PanelEdicionProps) {
  const avisoParcialRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (guardadoParcial) avisoParcialRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [guardadoParcial]);
  // El motivo de la API acompaña al aviso; el CUIT en conflicto ya se muestra junto a su campo (P4).
  const motivoDe = (error: unknown) =>
    error instanceof ApiError && error.code !== "CLIENT_CUIT_CONFLICT" ? error.message : "";
  const motivoGuardado =
    guardadoParcial === "identidad"
      ? motivoDe(updateProfile.error)
      : guardadoParcial === "ficha"
        ? motivoDe(updateIdentity.error)
        : "";
  const {
    currencyNotBacked,
    standardUnknown,
    vatConditionIsLegacy,
    provinceIsLegacy,
    legalFormIsLegacy,
    activityIsLegacy,
    activityIsInactive,
    standardValue,
    standardCatalogUnavailable,
    standardCatalogLoading,
    standardCatalogEmpty,
    reintentarNormas,
    standardCatalog,
    outOfCatalogJurisdictions,
    selectedJurisdictions,
    toggleJurisdiction,
    catalogData,
    activeActivityEntries,
  } = catalogos;
  return (
    <ActionDrawer
      isOpen={Boolean(editingClient)}
      onClose={() => {
        setEditingClient(null);
        updateIdentity.reset();
        updateProfile.reset();
      }}
      title="Editar cliente"
      description="Actualizá la identidad y los datos fiscales del cliente."
      size="wide"
      footer={
        editingClient ? (
          <Button
            type="submit"
            form="client-edit-form"
            loading={updateIdentity.isPending || updateProfile.isPending}
            loadingLabel="Guardando cambios"
            disabled={
              identityForm.legalName.trim().length === 0 ||
              identityForm.cuit.length !== 11 ||
              currencyNotBacked ||
              standardUnknown
            }
          >
            Guardar cambios
          </Button>
        ) : null
      }
    >
      {editingClient ? (
        <form
          id="client-edit-form"
          className="study-inline-form study-inline-form--client client-edit-form"
          onSubmit={submitClientEdit}
        >
          <section className="client-edit__section" aria-labelledby="client-edit-identity-title">
            <h3 id="client-edit-identity-title">Identidad</h3>
            <Field
              id="client-identity-legal-name"
              label="Razón social"
              value={identityForm.legalName}
              onChange={(event) => setIdentityForm({ ...identityForm, legalName: event.target.value })}
              maxLength={200}
              required
            />
            <Field
              id="client-identity-trade-name"
              label="Nombre comercial"
              value={identityForm.tradeName}
              onChange={(event) => setIdentityForm({ ...identityForm, tradeName: event.target.value })}
              maxLength={100}
            />
            <Field
              id="client-identity-cuit"
              label="CUIT"
              value={identityForm.cuit}
              onChange={(event) =>
                setIdentityForm({
                  ...identityForm,
                  cuit: event.target.value.replace(/\D/g, "").slice(0, 11),
                })
              }
              inputMode="numeric"
              pattern="[0-9]{11}"
              hint="11 dígitos, sin guiones"
              error={
                updateIdentity.error instanceof ApiError &&
                updateIdentity.error.code === "CLIENT_CUIT_CONFLICT"
                  ? updateIdentity.error.message
                  : undefined
              }
              required
            />
            {updateIdentity.isError &&
            guardadoParcial !== "ficha" &&
            !(updateIdentity.error instanceof ApiError &&
              updateIdentity.error.code === "CLIENT_CUIT_CONFLICT") ? (
              <Notice tone="error" className="study-inline-form__feedback">
                {updateIdentity.error instanceof ApiError
                  ? updateIdentity.error.message
                  : "No se pudo guardar la identidad. Revisá los datos y los permisos."}
              </Notice>
            ) : null}
          </section>
          <section className="client-edit__section" aria-labelledby="client-edit-fiscal-title">
            <h3 id="client-edit-fiscal-title">Datos fiscales</h3>
          <label className="ds-field">
            <span className="ds-field__label">Moneda funcional</span>
            <select
              id="client-profile-currency"
              className="ctxbar__input"
              value={profileForm.functionalCurrency}
              onChange={(event) =>
                setProfileForm({ ...profileForm, functionalCurrency: event.target.value })
              }
              required
            >
              {BACKED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
              {currencyNotBacked ? (
                <option value={profileForm.functionalCurrency}>
                  {profileForm.functionalCurrency} — fuera de catálogo
                </option>
              ) : null}
            </select>
          </label>
          {currencyNotBacked ? (
            <Notice tone="warning">
              La moneda guardada no está respaldada por el sistema. Elegí {BACKED_CURRENCIES.join(" o ")} para guardar la ficha.
            </Notice>
          ) : null}
          <label className="ds-field">
            <span className="ds-field__label">Cierre de ejercicio</span>
            <select
              className="ctxbar__input"
              value={profileForm.fiscalYearEndMonth}
              onChange={(event) =>
                setProfileForm({ ...profileForm, fiscalYearEndMonth: event.target.value })
              }
            >
              {[
                "Enero",
                "Febrero",
                "Marzo",
                "Abril",
                "Mayo",
                "Junio",
                "Julio",
                "Agosto",
                "Septiembre",
                "Octubre",
                "Noviembre",
                "Diciembre",
              ].map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Condición frente al IVA</span>
            <select
              id="client-profile-vat"
              className="ctxbar__input"
              value={profileForm.vatCondition}
              onChange={(event) =>
                setProfileForm({ ...profileForm, vatCondition: event.target.value })
              }
            >
              <option value="">Sin especificar</option>
              {CLIENT_VAT_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {CLIENT_VAT_CONDITION_LABELS[condition]}
                </option>
              ))}
              {vatConditionIsLegacy ? (
                <option value={profileForm.vatCondition}>
                  {profileForm.vatCondition} — valor histórico (conservado)
                </option>
              ) : null}
            </select>
            {vatConditionIsLegacy ? (
              <small className="study-legacy-note">
                El valor histórico sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Provincia</span>
            <select
              id="client-profile-province"
              className="ctxbar__input"
              value={profileForm.province}
              onChange={(event) => setProfileForm({ ...profileForm, province: event.target.value })}
            >
              <option value="">Sin especificar</option>
              {ARGENTINA_PROVINCES.map((province) => (
                <option key={province} value={province}>{province}</option>
              ))}
              {provinceIsLegacy ? (
                <option value={profileForm.province}>
                  {profileForm.province} — valor histórico (conservado)
                </option>
              ) : null}
            </select>
            {provinceIsLegacy ? (
              <small className="study-legacy-note">
                El valor histórico sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Actividad principal</span>
            <select
              id="client-profile-activity"
              className="ctxbar__input"
              value={profileForm.activity}
              onChange={(event) => setProfileForm({ ...profileForm, activity: event.target.value })}
            >
              <option value="">Sin especificar</option>
              {activeActivityEntries.map((activity) => {
                const value = clientEconomicActivityValue(activity);
                return <option key={`${activity.code}:${activity.name}`} value={value}>{value}</option>;
              })}
              {activityIsInactive ? (
                <option value={profileForm.activity} disabled>
                  {profileForm.activity} — (oculto) en el catálogo (conservado)
                </option>
              ) : null}
              {activityIsLegacy ? (
                <option value={profileForm.activity}>
                  {profileForm.activity} — valor histórico (conservado)
                </option>
              ) : null}
            </select>
            {sinRespuesta(clientActivityCatalog) ? <small role="status">Cargando catálogo de actividades…</small> : null}
            {activityIsLegacy || activityIsInactive ? (
              <small className="study-legacy-note">
                El valor guardado sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </label>
          {clientActivityCatalog.isError ? (
            <Notice
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => void clientActivityCatalog.refetch()}>
                  Reintentar
                </Button>
              }
            >
              No se pudo cargar el catálogo de actividades. Reintentá.
            </Notice>
          ) : null}
          {clientActivityCatalog.isSuccess && clientActivityCatalog.data.length === 0 ? (
            <EmptyState
              size="inline"
              title="No hay actividades cargadas."
              description="Pedí a quien administra el estudio que las cargue en Catálogos fiscales."
            />
          ) : null}
          <label className="ds-field">
            <span className="ds-field__label">Forma jurídica</span>
            <select
              id="client-profile-legal-form"
              className="ctxbar__input"
              value={profileForm.legalForm}
              onChange={(event) =>
                setProfileForm({ ...profileForm, legalForm: event.target.value })
              }
            >
              <option value="">Sin especificar</option>
              {CLIENT_LEGAL_FORMS.map((legalForm) => (
                <option key={legalForm} value={legalForm}>{legalForm}</option>
              ))}
              {legalFormIsLegacy ? (
                <option value={profileForm.legalForm}>
                  {profileForm.legalForm} — valor histórico (conservado)
                </option>
              ) : null}
            </select>
            {legalFormIsLegacy ? (
              <small className="study-legacy-note">
                El valor histórico sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </label>
          <fieldset className="ds-field" id="client-profile-iibb">
            <legend className="ds-field__label">Jurisdicciones IIBB</legend>
            {sinRespuesta(jurisdictionCatalog) ? (
              <p role="status">Cargando catálogo de jurisdicciones…</p>
            ) : jurisdictionCatalog.isError ? (
              <Notice
                tone="error"
                action={
                  <Button size="sm" variant="secondary" onClick={() => void jurisdictionCatalog.refetch()}>
                    Reintentar
                  </Button>
                }
              >
                No se pudo cargar el catálogo de jurisdicciones. Reintentá.
              </Notice>
            ) : jurisdictionCatalog.isSuccess && (catalogData?.length ?? 0) === 0 ? (
              <EmptyState
                size="inline"
                title="No hay jurisdicciones cargadas."
                description="Pedí a quien administra el estudio que las cargue en Catálogos fiscales."
              />
            ) : (
              <div className="study-check-list">
                {catalogData?.filter((entry) => entry.isActive).map((entry) => (
                  <label key={entry.code} className="study-check-option">
                    <input
                      type="checkbox"
                      checked={selectedJurisdictions.includes(entry.code)}
                      onChange={(event) => toggleJurisdiction(entry.code, event.target.checked)}
                    />
                    <span>
                      {entry.code} — {entry.name}
                    </span>
                  </label>
                ))}
                {catalogData?.filter((entry) => !entry.isActive && selectedJurisdictions.includes(entry.code)).map((entry) => (
                  <label key={entry.code} className="study-check-option">
                    <input type="checkbox" checked disabled />
                    <span>{entry.code} — {entry.name} (oculto)</span>
                  </label>
                ))}
              </div>
            )}
            {outOfCatalogJurisdictions.length > 0 ? (
              <p className="study-legacy-note">
                Estas jurisdicciones guardadas no están en el catálogo fiscal y se quitarán al
                guardar: <strong>{outOfCatalogJurisdictions.join(", ")}</strong>
              </p>
            ) : null}
          </fieldset>
          <label className="ds-field">
            <span className="ds-field__label">Norma contable</span>
            <select
              id="client-profile-standard"
              className="ctxbar__input"
              value={standardValue}
              onChange={(event) =>
                setProfileForm({ ...profileForm, accountingStandard: event.target.value })
              }
            >
              <option value="">Sin definir</option>
              {standardCatalogUnavailable && standardValue ? (
                <option value={standardValue}>{standardValue}</option>
              ) : null}
              {standardCatalog
                .filter((entry) => entry.isActive)
                .map((entry) => (
                  <option key={entry.id} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              {standardCatalog
                .filter((entry) => !entry.isActive && entry.name === standardValue)
                .map((entry) => (
                  <option key={entry.id} value={entry.name}>
                    {entry.name} — desactivada en el catálogo
                  </option>
                ))}
              {standardUnknown ? (
                <option value={standardValue}>{standardValue} — fuera de catálogo</option>
              ) : null}
            </select>
          </label>
          {standardCatalogLoading ? <small role="status">Cargando normas contables…</small> : null}
          {standardCatalogUnavailable ? (
            <Notice
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={reintentarNormas}>
                  Reintentar
                </Button>
              }
            >
              No se pudo cargar el catálogo de normas. Reintentá.
            </Notice>
          ) : null}
          {standardCatalogEmpty ? (
            <EmptyState
              size="inline"
              title="No hay normas contables cargadas."
              description="Pedí a quien administra el estudio que las cargue en Administración."
            />
          ) : null}
          {standardUnknown ? (
            <Notice tone="warning">
              La norma contable guardada no está en el catálogo del estudio. Definila en Administración o elegí una del catálogo para guardar la ficha.
            </Notice>
          ) : null}
          <Field
            id="client-profile-service-start"
            label="Inicio del servicio"
            type="date"
            value={profileForm.serviceStartDate}
            onChange={(event) =>
              setProfileForm({ ...profileForm, serviceStartDate: event.target.value })
            }
          />
          {guardadoParcial ? (
            <div ref={avisoParcialRef} className="client-edit__aviso-parcial">
              <Notice tone="error" className="study-inline-form__feedback">
                {guardadoParcial === "identidad"
                  ? "Se guardó la identidad; no se pudo guardar la ficha fiscal. Reintentá."
                  : "Se guardó la ficha fiscal; no se pudo guardar la identidad. Reintentá."}
                {motivoGuardado ? (
                  <>
                    {" "}
                    <span>{motivoGuardado}</span>
                  </>
                ) : null}
              </Notice>
            </div>
          ) : updateProfile.isError &&
          !(updateIdentity.isError && updateProfile.error.message === updateIdentity.error.message) ? (
            <Notice tone="error" className="study-inline-form__feedback">
              {updateProfile.error instanceof ApiError
                ? updateProfile.error.message
                : "No se pudo guardar la ficha. Revisá los datos e intentá nuevamente."}
            </Notice>
          ) : null}
          </section>
        </form>
      ) : null}
    </ActionDrawer>
  );
}
