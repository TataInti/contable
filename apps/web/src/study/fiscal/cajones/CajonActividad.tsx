import { useState, type Dispatch, type SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";
import type { EconomicActivity, FiscalStep, MutacionConLista } from "../utilidades";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  activityIds: string[];
  setActivityIds: Dispatch<SetStateAction<string[]>>;
  addActivity: MutacionConLista;
  activitiesQuery: UseQueryResult<EconomicActivity[]>;
  jurisdictionsQuery: UseQueryResult<{ id: string; name: string }[]>;
  effectiveProfileId: string | undefined;
};

/**
 * Vincula una o varias actividades del catálogo. El contador las elige con casillas; la app no asocia nada sola.
 * Cada una se muestra con su jurisdicción tal como figura en el catálogo. Vale desde el alta del cliente (sin fecha).
 */
export function CajonActividad({ openFormStep, setOpenFormStep, activityIds, setActivityIds, addActivity, activitiesQuery, jurisdictionsQuery, effectiveProfileId }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const nombreDeJurisdiccion = new Map((jurisdictionsQuery.data ?? []).map((jurisdiccion) => [jurisdiccion.id, jurisdiccion.name]));
  const termino = busqueda.trim().toLowerCase();
  const opciones = (activitiesQuery.data ?? [])
    .filter((actividad) => actividad.isActive)
    .map((actividad) => {
      const jurisdiccion = nombreDeJurisdiccion.get(actividad.jurisdictionId ?? "") ?? "";
      return { ...actividad, jurisdiccion, etiqueta: `${actividad.code} — ${actividad.name}${jurisdiccion ? ` · ${jurisdiccion}` : ""}` };
    })
    .filter((actividad) => !termino || `${actividad.code} ${actividad.name} ${actividad.jurisdiccion}`.toLowerCase().includes(termino));

  const alternar = (id: string, marcada: boolean) =>
    setActivityIds((actuales) => (marcada ? [...actuales.filter((item) => item !== id), id] : actuales.filter((item) => item !== id)));
  const cerrar = () => {
    setActivityIds([]);
    setBusqueda("");
    setOpenFormStep(null);
  };

  return (
    <ActionDrawer
      isOpen={openFormStep === "actividades"}
      onClose={cerrar}
      title="Vincular actividad económica"
      description="Elegí las actividades del catálogo que tiene el contribuyente. Valen para cualquier período; si cambian, registrá el cambio aparte."
    >
      <form
        className="study-form study-form--compact"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (activityIds.length > 0) addActivity.mutate(activityIds);
        }}
      >
        <label htmlFor="act-busqueda">Buscar actividad</label>
        <input id="act-busqueda" type="search" value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Código, nombre o jurisdicción" />
        <fieldset aria-label="Actividades del catálogo">
          {opciones.map((actividad) => (
            <label key={actividad.id}>
              <input type="checkbox" checked={activityIds.includes(actividad.id)} onChange={(event) => alternar(actividad.id, event.target.checked)} /> {actividad.etiqueta}
            </label>
          ))}
          {opciones.length === 0 ? <p className="muted-copy">Ninguna actividad coincide con la búsqueda.</p> : null}
        </fieldset>
        <p className="muted-copy">Elegidas: {activityIds.length}</p>
        <MutationError error={addActivity.error} />
        <div className="study-form__actions">
          <Button type="submit" loading={addActivity.isPending} disabled={activityIds.length === 0 || !effectiveProfileId}>Vincular actividad</Button>
          <Button type="button" variant="ghost" onClick={cerrar}>Cancelar</Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
