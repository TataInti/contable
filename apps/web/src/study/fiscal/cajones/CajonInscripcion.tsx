import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import type { FiscalStep, Mutacion, TaxRegime } from "../utilidades";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  regimeId: string;
  setRegimeId: Dispatch<SetStateAction<string>>;
  addRegistration: Mutacion;
  regimesQuery: UseQueryResult<TaxRegime[]>;
  effectiveProfileId: string | undefined;
};

export function CajonInscripcion({ openFormStep, setOpenFormStep, regimeId, setRegimeId, addRegistration, regimesQuery, effectiveProfileId }: Props) {
  return (
    <ActionDrawer
      isOpen={openFormStep === "inscripcion"}
      onClose={() => setOpenFormStep(null)}
      title="Registrar inscripción"
      description="Elegí el régimen fiscal aplicable al contribuyente."
    >
      <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); addRegistration.mutate(); }}>
        <div className="ds-field"><label className="ds-field__label" htmlFor="reg-regime">Régimen</label><select id="reg-regime" className="ds-field__input" value={regimeId} onChange={(event) => setRegimeId(event.target.value)} required><option value="">Seleccioná un régimen…</option>{regimesQuery.data?.map((regime) => <option key={regime.id} value={regime.id}>{regime.name} ({regime.code})</option>)}</select></div>
        <MutationError error={addRegistration.error} />
        <div className="study-form__actions"><Button type="submit" loading={addRegistration.isPending} disabled={!regimeId || !effectiveProfileId}>Registrar inscripción</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
