import { useEffect, useState } from "react";
import { Button } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { formatearFecha } from "../../../lib/formatoFechas";
import { CampoFecha } from "../CampoFecha";
import { campoDelError } from "../campoDelError";
import { MutationError } from "../MutationError";
import type { ClientActivityLink } from "../utilidades";

type Props = {
  /** Vínculo de actividad a corregir; null = cajón cerrado. */
  activity: ClientActivityLink | null;
  onClose: () => void;
  updateActivity: { isPending: boolean; error: Error | null; mutate: (valores: { id: string; validFrom: string }) => void };
};

/** Corrige el mes en que rige un cambio de actividad (brief 4L): solo para los cambios registrados. */
export function CajonCorregirActividad({ activity, onClose, updateActivity }: Props) {
  const [validFrom, setValidFrom] = useState("");
  const [intento, setIntento] = useState(false);
  const activityId = activity?.id;
  const validFromActual = activity?.validFrom.slice(0, 10) ?? "";
  useEffect(() => {
    setValidFrom(validFromActual);
    setIntento(false);
  }, [activityId, validFromActual]);
  const errorDeApi = campoDelError(updateActivity.error) === "validFrom" ? updateActivity.error?.message : undefined;
  const faltaFecha = intento && !validFrom ? "Indicá desde qué mes rige el cambio." : undefined;
  return (
    <ActionDrawer
      isOpen={activity !== null}
      onClose={onClose}
      title="Corregir mes del cambio de actividad"
      description={activity ? `${activity.activity.name}. Hoy rige desde el ${formatearFecha(activity.validFrom)}.` : ""}
    >
      <form
        className="study-form study-form--compact"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!activity) return;
          if (!validFrom) { setIntento(true); return; }
          updateActivity.mutate({ id: activity.id, validFrom });
        }}
      >
        <CampoFecha
          label="Rige desde (mes)"
          id="act-edit-from"
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
          hint="Cuenta el mes de esta fecha. Los meses ya finalizados no cambian."
          error={errorDeApi ?? faltaFecha}
          required
        />
        {errorDeApi ? null : <MutationError error={updateActivity.error} />}
        <div className="study-form__actions"><Button type="submit" loading={updateActivity.isPending}>Guardar fecha</Button><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
