import { useEffect, useState } from "react";
import { Button } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { formatearFecha } from "../../../lib/formatoFechas";
import { CampoFecha } from "../CampoFecha";
import { campoDelError } from "../campoDelError";
import { MutationError } from "../MutationError";
import { nombreRegimen } from "../etiquetaRegimen";
import type { TaxRegistration } from "../utilidades";

type Props = {
  /** Inscripción a corregir; null = cajón cerrado. */
  registration: TaxRegistration | null;
  onClose: () => void;
  updateRegistration: { isPending: boolean; error: Error | null; mutate: (valores: { id: string; validFrom: string }) => void };
};

export function CajonCorregirInscripcion({ registration, onClose, updateRegistration }: Props) {
  const [validFrom, setValidFrom] = useState("");
  const [intento, setIntento] = useState(false);
  const registrationId = registration?.id;
  const validFromActual = registration?.validFrom.slice(0, 10) ?? "";
  useEffect(() => {
    setValidFrom(validFromActual);
    setIntento(false);
  }, [registrationId, validFromActual]);
  const errorDeApi = campoDelError(updateRegistration.error) === "validFrom" ? updateRegistration.error?.message : undefined;
  const faltaFecha = intento && !validFrom ? "Indicá desde qué fecha está inscripto el cliente." : undefined;
  return (
    <ActionDrawer
      isOpen={registration !== null}
      onClose={onClose}
      title="Corregir fecha de inscripción"
      description={registration ? `${nombreRegimen(registration.regime)}. Hoy figura desde el ${formatearFecha(registration.validFrom)}.` : ""}
    >
      <form
        className="study-form study-form--compact"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!registration) return;
          if (!validFrom) { setIntento(true); return; }
          updateRegistration.mutate({ id: registration.id, validFrom });
        }}
      >
        <CampoFecha
          label="Desde"
          id="reg-edit-from"
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
          hint="Desde cuándo está inscripto el cliente. Es informativo: no impide abrir ni liquidar ningún mes."
          error={errorDeApi ?? faltaFecha}
          required
        />
        {errorDeApi ? null : <MutationError error={updateRegistration.error} />}
        <div className="study-form__actions"><Button type="submit" loading={updateRegistration.isPending}>Guardar fecha</Button><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
