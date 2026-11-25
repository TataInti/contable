import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Field, Notice, SearchSelect } from "@contable/design-system";
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
      title="Nuevo cliente"
      description="Completá la ficha. Al guardar, el perfil fiscal queda activo si elegís la condición frente al IVA; podés editarlo después en Configuración fiscal."
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="client-create-form"
              loading={create.isPending}
              loadingLabel="Guardando cliente"
              disabled={missingCreateFields.length > 0}
            >
              Guardar cliente
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
        <SearchSelect
          id="client-vat-condition"
          label="Condición frente al IVA"
          className="ctxbar__input"
          value={form.vatCondition}
          onChange={(value) => setForm({ ...form, vatCondition: value })}
          placeholder="Sin especificar"
          options={CLIENT_VAT_CONDITIONS.map((condition) => ({ value: condition, label: CLIENT_VAT_CONDITION_LABELS[condition] }))}
        />
        <SearchSelect id="client-province" name="province" className="ctxbar__input" label="Provincia" value={form.province} onChange={(province) => setForm({ ...form, province })} options={ARGENTINA_PROVINCES.map((province) => ({ value: province, label: province }))} />
        <div>
          <SearchSelect id="client-activity" name="activity" className="ctxbar__input" label="Actividad principal" value={form.activity} onChange={(activity) => setForm({ ...form, activity })} options={activeActivityEntries.map((activity) => { const value = clientEconomicActivityValue(activity); return { value, label: value }; })} />
          {sinRespuesta(clientActivityCatalog) ? <small role="status">Cargando catálogo de actividades…</small> : null}
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
        <SearchSelect id="client-legal-form" name="legalForm" className="ctxbar__input" label="Forma jurídica" value={form.legalForm} onChange={(legalForm) => setForm({ ...form, legalForm })} options={CLIENT_LEGAL_FORMS.map((legalForm) => ({ value: legalForm, label: legalForm }))} />
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
