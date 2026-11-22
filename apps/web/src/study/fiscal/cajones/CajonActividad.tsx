import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, SearchSelect } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import type { EconomicActivity, FiscalStep, Mutacion } from "../utilidades";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  activityId: string;
  setActivityId: Dispatch<SetStateAction<string>>;
  addActivity: Mutacion;
  activitiesQuery: UseQueryResult<EconomicActivity[]>;
  effectiveProfileId: string | undefined;
};

export function CajonActividad({ openFormStep, setOpenFormStep, activityId, setActivityId, addActivity, activitiesQuery, effectiveProfileId }: Props) {
  return (
    <ActionDrawer
      isOpen={openFormStep === "actividades"}
      onClose={() => setOpenFormStep(null)}
      title="Vincular actividad económica"
      description="Seleccioná la actividad principal del contribuyente."
    >
      <form className="study-form study-form--compact" onSubmit={(event) => { event.preventDefault(); addActivity.mutate(); }}>
        <SearchSelect id="act-activity" name="activityId" label="Actividad" value={activityId} onChange={setActivityId} required placeholder="Elegí…" options={activitiesQuery.data?.map((activity) => ({ value: activity.id, label: `${activity.code} — ${activity.name}` })) ?? []} />
        <MutationError error={addActivity.error} />
        <div className="study-form__actions"><Button type="submit" loading={addActivity.isPending} disabled={!activityId || !effectiveProfileId}>Vincular actividad</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
