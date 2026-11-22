import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, SearchSelect } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { CampoFecha } from "../CampoFecha";
import { campoDelError } from "../campoDelError";
import { MutationError } from "../MutationError";
import type { FiscalStep, TaxRegime } from "../utilidades";
import { ayudaRegimen, etiquetaRegimen, ordenarRegimenes, type RegimenEtiqueta } from "../etiquetaRegimen";

type Props = {
  openFormStep: FiscalStep | null;
  setOpenFormStep: Dispatch<SetStateAction<FiscalStep | null>>;
  regimeId: string;
  setRegimeId: Dispatch<SetStateAction<string>>;
  /** Primer día del mes anterior: el mes que se liquida normalmente. */
  suggestedFrom: string;
  addRegistration: { isPending: boolean; error: Error | null; mutate: (valores: { validFrom: string }) => void };
  regimesQuery: UseQueryResult<TaxRegime[]>;
  effectiveProfileId: string | undefined;
};

export function CajonInscripcion({ openFormStep, setOpenFormStep, regimeId, setRegimeId, suggestedFrom, addRegistration, regimesQuery, effectiveProfileId }: Props) {
  const abierto = openFormStep === "inscripcion";
  const [validFrom, setValidFrom] = useState(suggestedFrom);
  const [intento, setIntento] = useState(false);
  // Cada vez que se abre el cajón vuelve a proponerse el primer día del mes anterior.
  useEffect(() => {
    if (!abierto) return;
    setValidFrom(suggestedFrom);
    setIntento(false);
  }, [abierto, suggestedFrom]);
  const errorDeApi = campoDelError(addRegistration.error) === "validFrom" ? addRegistration.error?.message : undefined;
  const faltaFecha = intento && !validFrom ? "Indicá desde qué fecha está inscripto el cliente." : undefined;
  const opciones = ordenarRegimenes(regimesQuery.data ?? []);
  const regimenSeleccionado = regimesQuery.data?.find((regime) => regime.id === regimeId);
  const datosRegimenSeleccionado = regimenSeleccionado as (TaxRegime & RegimenEtiqueta) | undefined;
  return (
    <ActionDrawer
      isOpen={abierto}
      onClose={() => setOpenFormStep(null)}
      title="Registrar inscripción"
      description="Elegí el régimen fiscal aplicable al contribuyente."
    >
      <form className="study-form study-form--compact" noValidate onSubmit={(event) => { event.preventDefault(); if (!validFrom) { setIntento(true); return; } addRegistration.mutate({ validFrom }); }}>
        <SearchSelect id="reg-regime" name="regimeId" label="Régimen" value={regimeId} onChange={setRegimeId} required placeholder="Elegí…" options={opciones.agrupados ? [] : opciones.regimenes.map((regime) => ({ value: regime.id, label: etiquetaRegimen(regime) }))} groups={opciones.agrupados ? opciones.grupos.map((grupo) => ({ label: grupo.nombre, options: grupo.regimenes.map((regime) => ({ value: regime.id, label: etiquetaRegimen(regime) })) })) : []} />
        {datosRegimenSeleccionado && ayudaRegimen(datosRegimenSeleccionado) ? <p className="ds-field__hint">{ayudaRegimen(datosRegimenSeleccionado)}</p> : null}
        <CampoFecha label="Desde" id="reg-from" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} hint="Desde cuándo está inscripto el cliente. Para liquidar un mes, la inscripción tiene que cubrirlo." error={errorDeApi ?? faltaFecha} required />
        {errorDeApi ? null : <MutationError error={addRegistration.error} />}
        <div className="study-form__actions"><Button type="submit" loading={addRegistration.isPending} disabled={!regimeId || !effectiveProfileId}>Registrar inscripción</Button><Button type="button" variant="ghost" onClick={() => setOpenFormStep(null)}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
