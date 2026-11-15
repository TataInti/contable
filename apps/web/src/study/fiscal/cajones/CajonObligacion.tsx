import type { Dispatch, SetStateAction } from "react";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import { periodDisplayLabel, type FiscalStep, type Mutacion, type ObligacionForm, type TaxPeriod, type TaxRegistration } from "../utilidades";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  obligationForm: ObligacionForm;
  setObligationForm: Dispatch<SetStateAction<ObligacionForm>>;
  createObligation: Mutacion;
  selectablePeriods: TaxPeriod[];
  eligibleRegistrations: TaxRegistration[];
  effectiveProfileId: string | undefined;
};

export function CajonObligacion({ openFormStep, setOpenFormStep, obligationForm, setObligationForm, createObligation, selectablePeriods, eligibleRegistrations, effectiveProfileId }: Props) {
  return (
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
  );
}
