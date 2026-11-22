import { useEffect, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, SearchSelect } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { CampoFecha } from "../CampoFecha";
import { campoDelError } from "../campoDelError";
import { MutationError } from "../MutationError";
import type { ClientActivityLink, EconomicActivity } from "../utilidades";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Vínculos vigentes del cliente: definen los niveles (jurisdicciones) donde puede haber un cambio. */
  vigentes: ClientActivityLink[];
  activitiesQuery: UseQueryResult<EconomicActivity[]>;
  registrar: {
    isPending: boolean;
    error: Error | null;
    mutate: (valores: { activityId: string; validFrom: string; changeReason: string }) => void;
    reset: () => void;
  };
};

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * «Registrar cambio de actividad» (brief 4L): elegir la actividad nueva, el mes desde el que rige y, opcional, el motivo.
 * La actividad anterior del mismo nivel se cierra el mes previo al cambio. Solo ofrece actividades del nivel de un vínculo vigente.
 */
export function CajonCambioActividad({ isOpen, onClose, vigentes, activitiesQuery, registrar }: Props) {
  const [activityId, setActivityId] = useState("");
  const [validFrom, setValidFrom] = useState(hoy);
  const [changeReason, setChangeReason] = useState("");
  const [intento, setIntento] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActivityId("");
      setValidFrom(hoy());
      setChangeReason("");
      setIntento(false);
      registrar.reset();
    }
  }, [isOpen]);

  const niveles = new Set(vigentes.map((link) => link.activity.jurisdictionId).filter(Boolean));
  const yaVigentes = new Set(vigentes.map((link) => link.activity.id).filter(Boolean));
  const opciones = (activitiesQuery.data ?? [])
    .filter((actividad) => actividad.isActive && niveles.has(actividad.jurisdictionId) && !yaVigentes.has(actividad.id))
    .map((actividad) => ({ value: actividad.id, label: `${actividad.code} — ${actividad.name}` }));
  const faltaActividad = intento && !activityId ? "Elegí la actividad nueva." : undefined;
  const faltaFecha = intento && !validFrom ? "Indicá desde qué mes rige el cambio." : undefined;
  const errorDeApi = (campo: string) => (campoDelError(registrar.error) === campo ? registrar.error?.message : undefined);

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar cambio de actividad"
      description="La actividad anterior de este nivel rige hasta el mes previo. Las fechas anteriores no cambian."
    >
      <form
        className="study-form study-form--compact"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setIntento(true);
          if (!activityId || !validFrom) return;
          registrar.mutate({ activityId, validFrom, changeReason: changeReason.trim() });
        }}
      >
        <SearchSelect
          id="cambio-actividad-nueva"
          name="activityId"
          label="Actividad nueva"
          value={activityId}
          onChange={setActivityId}
          required
          placeholder="Elegí…"
          options={opciones}
        />
        {errorDeApi("activityId") ?? faltaActividad ? (
          <small className="ds-field__error" role="alert">{errorDeApi("activityId") ?? faltaActividad}</small>
        ) : null}
        <CampoFecha
          label="Rige desde (mes)"
          id="cambio-actividad-desde"
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
          hint="Cuenta el mes de esta fecha. Desde ese mes cambia la alícuota."
          error={errorDeApi("validFrom") ?? faltaFecha}
          required
        />
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="cambio-actividad-motivo">Motivo (opcional)</label>
          <input
            id="cambio-actividad-motivo"
            className="ds-field__input"
            type="text"
            maxLength={200}
            value={changeReason}
            onChange={(event) => setChangeReason(event.target.value)}
          />
        </div>
        <MutationError error={registrar.error} />
        <div className="study-form__actions">
          <Button type="submit" loading={registrar.isPending}>Registrar cambio</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
