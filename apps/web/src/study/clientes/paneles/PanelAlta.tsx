import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Field, Notice } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { sinRespuesta } from "../consultas";
import { ApiError, type Client } from "../../../lib/api";
import {
  ARGENTINA_PROVINCES,
  CLIENT_LEGAL_FORMS,
  CLIENT_VAT_CONDITION_LABELS,
  CLIENT_VAT_CONDITIONS,
  clientEconomicActivityValue,
  type ClientEconomicActivityOption,
} from "@contable/contracts";

export interface FormularioAlta {
  legalName: string;
  tradeName: string;
  cuit: string;
  contactEmail: string;
  vatCondition: string;
  province: string;
  activity: string;
  legalForm: string;
}

interface PanelAltaProps {
  creating: boolean;
  setCreating: (abierto: boolean) => void;
  form: FormularioAlta;
  setForm: (valor: FormularioAlta) => void;
  create: UseMutationResult<Client, Error, FormularioAlta>;
  createFieldsHint: string;
  missingCreateFields: string[];
  clientActivityCatalog: UseQueryResult<ClientEconomicActivityOption[], Error>;
  activeActivityEntries: ClientEconomicActivityOption[];
}

export function PanelAlta({
  creating,
  setCreating,
  form,
  setForm,
  create,
  createFieldsHint,
  missingCreateFields,
  clientActivityCatalog,
  activeActivityEntries,
}: PanelAltaProps) {
  return (
    <ActionDrawer
      isOpen={creating}
      onClose={() => setCreating(false)}
      title="Alta de cliente"
      description="Completá los datos fiscales básicos. La configuración fiscal completa queda como paso siguiente."
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="client-create-form"
              loading={create.isPending}
              loadingLabel="Creando cliente"
              disabled={missingCreateFields.length > 0}
            >
              Crear cliente
            </Button>
          }
          hint={missingCreateFields.length > 0 ? createFieldsHint : null}
          onCancel={() => setCreating(false)}
        />
      }
    >
      <form
        id="client-create-form"
        className="study-inline-form study-inline-form--client client-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ ...form });
        }}
      >
        <Field
          id="client-legal-name"
          label="Razón social"
          value={form.legalName}
          onChange={(event) => setForm({ ...form, legalName: event.target.value })}
          maxLength={200}
          required
        />
        <Field
          id="client-create-contact-email"
          label="Correo de contacto"
          type="email"
          value={form.contactEmail}
          onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
          autoComplete="email"
          maxLength={254}
        />
        <Field
          id="client-trade-name"
          label="Nombre comercial"
          value={form.tradeName}
          onChange={(event) => setForm({ ...form, tradeName: event.target.value })}
          maxLength={100}
        />
        <Field
          id="client-cuit"
          label="CUIT"
          value={form.cuit}
          onChange={(event) =>
            setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })
          }
          inputMode="numeric"
          pattern="[0-9]{11}"
          hint="11 dígitos, sin guiones"
          required
        />
        <label className="ds-field">
          <span className="ds-field__label">Condición frente al IVA</span>
          <select
            id="client-vat-condition"
            className="ctxbar__input"
            value={form.vatCondition}
            onChange={(event) => setForm({ ...form, vatCondition: event.target.value })}
          >
            <option value="">Sin especificar</option>
            {CLIENT_VAT_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {CLIENT_VAT_CONDITION_LABELS[condition]}
              </option>
            ))}
          </select>
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Provincia</span>
          <select
            id="client-province"
            className="ctxbar__input"
            value={form.province}
            onChange={(event) => setForm({ ...form, province: event.target.value })}
          >
            <option value="">Sin especificar</option>
            {ARGENTINA_PROVINCES.map((province) => (
              <option key={province} value={province}>{province}</option>
            ))}
          </select>
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Actividad principal</span>
          <select
            id="client-activity"
            className="ctxbar__input"
            value={form.activity}
            onChange={(event) => setForm({ ...form, activity: event.target.value })}
          >
            <option value="">Sin especificar</option>
            {activeActivityEntries.map((activity) => {
              const value = clientEconomicActivityValue(activity);
              return <option key={`${activity.code}:${activity.name}`} value={value}>{value}</option>;
            })}
          </select>
          {sinRespuesta(clientActivityCatalog) ? <small role="status">Cargando catálogo de actividades…</small> : null}
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
            id="client-legal-form"
            className="ctxbar__input"
            value={form.legalForm}
            onChange={(event) => setForm({ ...form, legalForm: event.target.value })}
          >
            <option value="">Sin especificar</option>
            {CLIENT_LEGAL_FORMS.map((legalForm) => (
              <option key={legalForm} value={legalForm}>{legalForm}</option>
            ))}
          </select>
        </label>
        {create.isError ? (
          <Notice tone="error" className="study-inline-form__feedback">
            {create.error instanceof ApiError
              ? create.error.message
              : "No se pudo crear el cliente. Revisá los datos y los permisos."}
          </Notice>
        ) : null}
      </form>
    </ActionDrawer>
  );
}
