import type { Dispatch, SetStateAction } from "react";
import { Button, Field, SearchSelect } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import { CONDITION_LABELS, type FiscalStep, type Mutacion, type ProfileForm, type TaxpayerProfileVersion } from "../utilidades";
import { contradiccionTipoCuit, motivoGuardarBloqueado, type PerfilInicial } from "./perfilInicial";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  latestProfile: TaxpayerProfileVersion | undefined;
  createProfile: Mutacion;
  form: ProfileForm;
  setForm: Dispatch<SetStateAction<ProfileForm>>;
  /** Valores propuestos del alta; null cuando es una nueva versión (se muestran los guardados). */
  propuesta?: PerfilInicial | null;
};

const AYUDA_ORIGEN = { forma: "Propuesto según la forma jurídica del alta", cuit: "Propuesto según el CUIT" } as const;

export function CajonPerfil({ openFormStep, setOpenFormStep, latestProfile, createProfile, form, setForm, propuesta }: Props) {
  const motivo = motivoGuardarBloqueado(form);
  const aviso = contradiccionTipoCuit(form.cuit, form.personType);
  const ayudaTipo = propuesta?.origenTipo && form.personType !== "" && form.personType === propuesta.personType ? AYUDA_ORIGEN[propuesta.origenTipo] : null;
  return (
    <ActionDrawer
      isOpen={openFormStep === "perfil"}
      onClose={() => setOpenFormStep(null)}
      title={latestProfile ? "Crear nueva versión del perfil" : "Crear perfil fiscal"}
      description="Completá la identidad y condición fiscal del contribuyente."
      size="wide"
      footer={
        <>
          {motivo ? <span className="muted-copy">{motivo}</span> : null}
          <Button type="submit" form="fiscal-profile-form" loading={createProfile.isPending} disabled={motivo !== null}>
            Crear perfil
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>
            Cancelar
          </Button>
        </>
      }
    >
      <form id="fiscal-profile-form" className="study-form" onSubmit={(event) => { event.preventDefault(); if (motivo === null) createProfile.mutate(); }}>
        <Field label="Razón social" id="pf-legal-name" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required />
        <Field label="CUIT" id="pf-cuit" value={form.cuit} onChange={(event) => setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" pattern="\d{11}" required />
        <Field label="Domicilio fiscal" id="pf-fiscal-address" value={form.fiscalAddress} onChange={(event) => setForm({ ...form, fiscalAddress: event.target.value })} pattern=".*\S.*" title="Ingresá un domicilio fiscal o dejá el campo vacío." />
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="pf-person-type">Tipo de persona</label>
          <SearchSelect
            id="pf-person-type"
            label="Tipo de persona"
            hideLabel
            value={form.personType}
            onChange={(value) => setForm({ ...form, personType: value as ProfileForm["personType"] })}
            placeholder="Elegí…"
            options={[
              { value: "JURIDICA", label: "Jurídica" },
              { value: "FISICA", label: "Física" },
            ]}
          />
          {ayudaTipo ? <p className="ds-field__hint">{ayudaTipo}</p> : null}
          {aviso ? <p className="ds-field__hint">{aviso}</p> : null}
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="pf-condition">Condición nacional</label>
          <SearchSelect
            id="pf-condition"
            label="Condición nacional"
            hideLabel
            value={form.nationalCondition}
            onChange={(value) => setForm({ ...form, nationalCondition: value as ProfileForm["nationalCondition"] })}
            placeholder="Elegí…"
            options={Object.entries(CONDITION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <Field label="Vigencia desde" id="pf-valid-from" type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
        <MutationError error={createProfile.error} />
      </form>
    </ActionDrawer>
  );
}
