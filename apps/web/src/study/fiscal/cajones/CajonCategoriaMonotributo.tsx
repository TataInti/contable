import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { ApiError } from "../../../lib/api";
import { CalendarioFiscalSelect } from "../../CalendarioFiscalSelect";
import { CampoFecha } from "../CampoFecha";
import { MutationError } from "../MutationError";
import { importeEnPesos } from "../categoriaTem";
import {
  ACTIVIDADES_MONOTRIBUTO,
  CATEGORIAS_MONOTRIBUTO,
  mesActualMonotributo,
  type EstadoMonotributo,
} from "../monotributo";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  estado: EstadoMonotributo | undefined;
  cargando: boolean;
  guardar: {
    mutate: (entrada: { month: string; category: string; activity: string }, opciones?: { onSuccess?: () => void }) => void;
    reset: () => void;
    isPending: boolean;
    error: unknown;
  };
};

/** Mensaje del servidor que apunta a un campo (P4: el error se muestra junto al campo). */
function errorDelCampo(error: unknown, campo: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const detalle = error.details?.details;
  const ruta = detalle && !Array.isArray(detalle) && typeof detalle === "object" ? (detalle as { path?: unknown }).path : null;
  return Array.isArray(ruta) && ruta[0] === campo ? error.message : null;
}

/**
 * Categoría y tipo de actividad del Monotributo desde un mes (corte 3F). Se edita solo aquí, en
 * Configuración fiscal, Regímenes; la tarjeta del Legajo enlaza a este lugar.
 */
export function CajonCategoriaMonotributo({ isOpen, onClose, estado, cargando, guardar }: Props) {
  const [desde, setDesde] = useState("");
  const [actividad, setActividad] = useState("");
  const [categoria, setCategoria] = useState("");
  const [intento, setIntento] = useState(false);
  const categoriaGuardada = estado?.category?.category ?? "";
  const actividadGuardada = estado?.category?.activity ?? "";

  useEffect(() => {
    if (!isOpen) return;
    setDesde(`${mesActualMonotributo()}-01`);
    setCategoria(categoriaGuardada);
    setActividad(actividadGuardada);
    setIntento(false);
  }, [isOpen, categoriaGuardada, actividadGuardada]);

  const catalogo = estado?.catalog ?? [];
  const importeDe = (letra: string) => catalogo.find((fila) => fila.category === letra && fila.activity === actividad)?.amount;
  const opciones = CATEGORIAS_MONOTRIBUTO.map((letra) => {
    const importe = importeDe(letra);
    return { value: letra, label: importe ? `${letra} — cuota ${importeEnPesos(importe)}` : `Categoría ${letra}` };
  });
  const errorDesde = intento && !desde ? "Elegí desde qué mes rige la categoría." : errorDelCampo(guardar.error, "month") ?? undefined;
  const errorActividad = intento && !actividad ? "Elegí si la actividad es de servicios o de venta de bienes." : errorDelCampo(guardar.error, "activity") ?? undefined;
  const errorCategoria = intento && !categoria ? "Elegí la categoría." : errorDelCampo(guardar.error, "category") ?? undefined;
  const sinCuotas = !cargando && catalogo.length === 0;

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    setIntento(true);
    if (!desde || !actividad || !categoria) return;
    guardar.mutate({ month: desde.slice(0, 7), category: categoria, activity: actividad }, { onSuccess: onClose });
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Categoría de monotributo"
      description="La categoría rige desde el mes que elijas (recategorización de enero o julio). La cuota es la oficial de ARCA para cada tipo de actividad."
      footer={
        <ActionDrawerFooter
          primary={<Button type="submit" form="categoria-monotributo-form" loading={guardar.isPending}>Guardar categoría</Button>}
          hint={sinCuotas ? "Todavía no hay cuotas cargadas para el mes actual." : null}
          onCancel={onClose}
        />
      }
    >
      <form id="categoria-monotributo-form" className="study-form study-form--compact" noValidate onSubmit={enviar}>
        <CampoFecha
          id="categoria-monotributo-desde"
          label="Vigente desde"
          value={desde}
          onChange={(event) => { setDesde(event.target.value); guardar.reset(); }}
          {...(errorDesde ? { error: errorDesde } : {})}
        />
        <CalendarioFiscalSelect
          id="categoria-monotributo-actividad"
          label="Tipo de actividad"
          value={actividad}
          placeholder="Elegí el tipo…"
          options={ACTIVIDADES_MONOTRIBUTO.map((opcion) => ({ value: opcion.value, label: opcion.label }))}
          onChange={(valor) => { setActividad(valor); guardar.reset(); }}
          {...(errorActividad ? { error: errorActividad } : {})}
        />
        <CalendarioFiscalSelect
          id="categoria-monotributo-categoria"
          label="Categoría"
          value={categoria}
          placeholder="Elegí una categoría…"
          options={opciones}
          onChange={(valor) => { setCategoria(valor); guardar.reset(); }}
          {...(errorCategoria ? { error: errorCategoria } : {})}
        />
        {errorDelCampo(guardar.error, "month") || errorDelCampo(guardar.error, "activity") || errorDelCampo(guardar.error, "category") ? null : <MutationError error={guardar.error} />}
      </form>
    </ActionDrawer>
  );
}
