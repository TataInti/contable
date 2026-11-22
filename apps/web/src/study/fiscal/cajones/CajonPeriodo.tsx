import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, Field, SearchSelect } from "@contable/design-system";
import { CampoFecha } from "../CampoFecha";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import type { FiscalStep, Mutacion, PeriodoForm, TaxType } from "../utilidades";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  periodForm: PeriodoForm;
  setPeriodForm: Dispatch<SetStateAction<PeriodoForm>>;
  createPeriod: Mutacion;
  typesQuery: UseQueryResult<TaxType[]>;
};

export function CajonPeriodo({ openFormStep, setOpenFormStep, periodForm, setPeriodForm, createPeriod, typesQuery }: Props) {
  return (
    <ActionDrawer
      isOpen={openFormStep === "periodos"}
      onClose={() => setOpenFormStep(null)}
      title="Crear período fiscal"
      description="Definí las fechas reales antes de materializar obligaciones."
      size="wide"
    >
      <form className="study-form" onSubmit={(event) => { event.preventDefault(); createPeriod.mutate(); }}>
        <SearchSelect id="per-tax-type" name="taxTypeId" label="Impuesto" value={periodForm.taxTypeId} onChange={(taxTypeId) => setPeriodForm({ ...periodForm, taxTypeId })} required placeholder="Elegí…" options={typesQuery.data?.map((type) => ({ value: type.id, label: `${type.name} (${type.code})` })) ?? []} />
        <CampoFecha label="Desde" id="per-start" value={periodForm.startDate} onChange={(event) => setPeriodForm({ ...periodForm, startDate: event.target.value })} required />
        <CampoFecha label="Hasta" id="per-end" value={periodForm.endDate} onChange={(event) => setPeriodForm({ ...periodForm, endDate: event.target.value })} required />
        <Field label="Etiqueta (opcional)" id="per-label" value={periodForm.label} onChange={(event) => setPeriodForm({ ...periodForm, label: event.target.value })} placeholder="Ej. Agosto 2026" />
        <MutationError error={createPeriod.error} />
        <div className="study-form__actions"><Button type="submit" loading={createPeriod.isPending} disabled={!periodForm.taxTypeId || periodForm.endDate < periodForm.startDate}>Crear período</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
