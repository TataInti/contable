import type { Dispatch, SetStateAction } from "react";
import { Button, SearchSelect } from "@contable/design-system";
import { CampoFecha } from "../CampoFecha";
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
        <SearchSelect id="obl-period" name="periodId" label="Período fiscal" value={obligationForm.periodId} onChange={(periodId) => setObligationForm({ ...obligationForm, periodId, regimeId: "" })} required placeholder="Elegí…" options={selectablePeriods.map((period) => ({ value: period.id, label: `${period.taxType.name} · ${periodDisplayLabel(period)}` }))} />
        <SearchSelect id="obl-regime" name="regimeId" label="Régimen adherido" value={obligationForm.regimeId} onChange={(regimeId) => setObligationForm({ ...obligationForm, regimeId })} required disabled={!obligationForm.periodId} placeholder="Elegí…" options={eligibleRegistrations.map((registration) => ({ value: registration.regime.id, label: `${registration.regime.name}${!registration.regime.isActive ? " (oculto)" : ""} · ${registration.regime.jurisdiction.name}${!registration.regime.jurisdiction.isActive ? " (oculto)" : ""}` }))} />
        <CampoFecha label="Vencimiento (opcional)" id="obl-due-date" value={obligationForm.dueDate} onChange={(event) => setObligationForm({ ...obligationForm, dueDate: event.target.value })} />
        <MutationError error={createObligation.error} />
        <div className="study-form__actions"><Button type="submit" loading={createObligation.isPending} disabled={!effectiveProfileId || !obligationForm.regimeId || !obligationForm.periodId}>Crear obligación</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
