import { useEffect, useRef, type FormEvent } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { BarSelect, Button, EmptyState, Field, Notice, SearchSelect } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
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
    reintentarNormas,
    standardCatalog,
    outOfCatalogJurisdictions,
    selectedJurisdictions,
    toggleJurisdiction,
    catalogData,
    activeActivityEntries,
  } = catalogos;
  // Motivo visible junto a «Guardar cambios» mientras está deshabilitado (P4): mismas condiciones que el disabled.
  const motivoGuardar =
    identityForm.legalName.trim().length === 0
      ? "Falta completar la razón social."
      : identityForm.cuit.length !== 11
        ? "Falta completar el CUIT (11 dígitos)."
        : currencyNotBacked
          ? `Elegí ${BACKED_CURRENCIES.join(" o ")} para guardar la ficha.`
          : standardUnknown
            ? "Definila en Administración o elegí una del catálogo para guardar la ficha."
            : null;
  const cerrar = () => {
    setEditingClient(null);
    updateIdentity.reset();
    updateProfile.reset();
  };
  return (
    <ActionDrawer
      isOpen={Boolean(editingClient)}
      onClose={cerrar}
      title="Editar cliente"
      description="Actualizá la identidad y los datos fiscales del cliente."
      footer={
        editingClient ? (
          <ActionDrawerFooter
            primary={
              <Button
                type="submit"
                form="client-edit-form"
                loading={updateIdentity.isPending || updateProfile.isPending}
                loadingLabel="Guardando cambios"
                disabled={motivoGuardar !== null}
              >
                Guardar cambios
              </Button>
            }
            hint={motivoGuardar}
            onCancel={cerrar}
          />
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
          <Field
            id="client-profile-service-start"
            label="Inicio del servicio"
            type="date"
            value={profileForm.serviceStartDate}
            onChange={(event) =>
              setProfileForm({ ...profileForm, serviceStartDate: event.target.value })
            }
          />
          <div className="ds-field">
            <span className="ds-field__label">Moneda funcional</span>
            <BarSelect
              id="client-profile-currency"
              label="Moneda funcional"
              value={profileForm.functionalCurrency}
              onChange={(event) => setProfileForm({ ...profileForm, functionalCurrency: event.target.value })}
              required
              options={[
                ...BACKED_CURRENCIES.map((code) => ({ value: code, label: code })),
                ...(currencyNotBacked ? [{ value: profileForm.functionalCurrency, label: `${profileForm.functionalCurrency} — fuera de catálogo` }] : []),
              ]}
            />
          </div>
          {currencyNotBacked ? (
            <Notice tone="warning">
              La moneda guardada no está respaldada por el sistema. Elegí {BACKED_CURRENCIES.join(" o ")} para guardar la ficha.
            </Notice>
          ) : null}
          <div className="ds-field">
            <span className="ds-field__label">Cierre de ejercicio</span>
            <BarSelect
              label="Cierre de ejercicio"
              value={String(profileForm.fiscalYearEndMonth)}
              onChange={(event) => setProfileForm({ ...profileForm, fiscalYearEndMonth: event.target.value })}
              options={[
                "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
              ].map((month, index) => ({ value: String(index + 1), label: month }))}
            />
          </div>
          <div className="ds-field">
            <span className="ds-field__label">Condición frente al IVA</span>
            <SearchSelect
              id="client-profile-vat"
              label="Condición frente al IVA"
              hideLabel
              className="ctxbar__input"
              value={profileForm.vatCondition}
              onChange={(value) => setProfileForm({ ...profileForm, vatCondition: value })}
              placeholder="Sin especificar"
              options={CLIENT_VAT_CONDITIONS.map((condition) => ({ value: condition, label: CLIENT_VAT_CONDITION_LABELS[condition] }))}
            />
            {vatConditionIsLegacy ? (
              <small className="study-legacy-note">
                El valor histórico sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </div>
          <div>
            <SearchSelect id="client-profile-province" name="province" className="ctxbar__input" label="Provincia" value={profileForm.province} onChange={(province) => setProfileForm({ ...profileForm, province })} options={[...ARGENTINA_PROVINCES.map((province) => ({ value: province, label: province })), ...(provinceIsLegacy ? [{ value: profileForm.province, label: `${profileForm.province} — valor histórico (conservado)` }] : [])]} />
            {provinceIsLegacy ? (
              <small className="study-legacy-note">
                El valor histórico sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </div>
          <div>
            <SearchSelect id="client-profile-activity" name="activity" className="ctxbar__input" label="Actividad principal" value={profileForm.activity} onChange={(activity) => setProfileForm({ ...profileForm, activity })} options={[...activeActivityEntries.map((activity) => { const value = clientEconomicActivityValue(activity); return { value, label: value }; }), ...(activityIsInactive ? [{ value: profileForm.activity, label: `${profileForm.activity} — (oculto) en el catálogo (conservado)` }] : []), ...(activityIsLegacy ? [{ value: profileForm.activity, label: `${profileForm.activity} — valor histórico (conservado)` }] : [])]} />
            {sinRespuesta(clientActivityCatalog) ? <small role="status">Cargando catálogo de actividades…</small> : null}
            {activityIsLegacy || activityIsInactive ? (
              <small className="study-legacy-note">
                El valor guardado sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </div>
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
          <div>
            <SearchSelect id="client-profile-legal-form" name="legalForm" className="ctxbar__input" label="Forma jurídica" value={profileForm.legalForm} onChange={(legalForm) => setProfileForm({ ...profileForm, legalForm })} options={[...CLIENT_LEGAL_FORMS.map((legalForm) => ({ value: legalForm, label: legalForm })), ...(legalFormIsLegacy ? [{ value: profileForm.legalForm, label: `${profileForm.legalForm} — valor histórico (conservado)` }] : [])]} />
            {legalFormIsLegacy ? (
              <small className="study-legacy-note">
                El valor guardado sigue visible y se conserva si no lo reemplazás.
              </small>
            ) : null}
          </div>
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
                      {entry.name}
                    </span>
                  </label>
                ))}
                {catalogData?.filter((entry) => !entry.isActive && selectedJurisdictions.includes(entry.code)).map((entry) => (
                  <label key={entry.code} className="study-check-option">
                    <input type="checkbox" checked disabled />
                    <span>{entry.name} (oculto)</span>
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
          <div className="ds-field">
            <span className="ds-field__label">Norma contable</span>
            <SearchSelect
              id="client-profile-standard"
              label="Norma contable"
              hideLabel
              className="ctxbar__input"
              value={standardValue}
              onChange={(value) => setProfileForm({ ...profileForm, accountingStandard: value })}
              placeholder="Sin norma contable"
              options={[
                ...(standardCatalogUnavailable && standardValue ? [{ value: standardValue, label: standardValue }] : []),
                ...standardCatalog.filter((entry) => entry.isActive).map((entry) => ({ value: entry.name, label: entry.name })),
                ...standardCatalog
                  .filter((entry) => !entry.isActive && entry.name === standardValue)
                  .map((entry) => ({ value: entry.name, label: `${entry.name} — desactivada en el catálogo` })),
                ...(standardUnknown ? [{ value: standardValue, label: `${standardValue} — fuera de catálogo` }] : []),
              ]}
            />
          </div>
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
          {standardUnknown ? (
            <Notice tone="warning">
              La norma contable guardada no está en el catálogo del estudio. Definila en Administración o elegí una del catálogo para guardar la ficha.
            </Notice>
          ) : null}
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
