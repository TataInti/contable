import type { Dispatch, SetStateAction } from "react";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import { CONDITION_LABELS, type FiscalStep, type Mutacion, type ProfileForm, type TaxpayerProfileVersion } from "../utilidades";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  latestProfile: TaxpayerProfileVersion | undefined;
  createProfile: Mutacion;
  form: ProfileForm;
  setForm: Dispatch<SetStateAction<ProfileForm>>;
};

export function CajonPerfil({ openFormStep, setOpenFormStep, latestProfile, createProfile, form, setForm }: Props) {
  return (
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
  );
}
