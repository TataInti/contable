import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { ApiError } from "../../../lib/api";
import { CalendarioFiscalSelect } from "../../CalendarioFiscalSelect";
import { MutationError } from "../MutationError";
import { importeEnPesos, type CategoriaTemEstado } from "../categoriaTem";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  estado: CategoriaTemEstado | undefined;
  cargando: boolean;
  guardar: { mutate: (category: string) => void; reset: () => void; isPending: boolean; error: unknown };
};

/** Mensaje del servidor que apunta al campo «category» (P4: el error se muestra junto al campo). */
function errorDelCampo(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const detalle = error.details?.details;
  const ruta = detalle && !Array.isArray(detalle) && typeof detalle === "object" ? (detalle as { path?: unknown }).path : null;
  return Array.isArray(ruta) && ruta[0] === "category" ? error.message : null;
}

export function CajonCategoriaTem({ isOpen, onClose, year, estado, cargando, guardar }: Props) {
  const [elegida, setElegida] = useState("");
  const [intentoSinElegir, setIntentoSinElegir] = useState(false);
  const categoriaGuardada = estado?.category ?? "";
  useEffect(() => {
    if (!isOpen) return;
    setElegida(categoriaGuardada);
    setIntentoSinElegir(false);
  }, [isOpen, categoriaGuardada]);

  const opciones = estado?.options ?? [];
  const opcionElegida = opciones.find((opcion) => opcion.category === elegida);
  const campoDelServidor = errorDelCampo(guardar.error);
  const error = intentoSinElegir && !elegida ? "Elegí la categoría TEM del año." : campoDelServidor ?? undefined;
  const ayuda = opcionElegida
    ? `Categoría anual según la DIM. Define el mínimo mensual: ${importeEnPesos(opcionElegida.minimum)} en ${opcionElegida.label}.`
    : "Categoría anual según la DIM. Define el mínimo mensual de cada mes del año.";
  const sinCatalogo = !cargando && opciones.length === 0;

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    if (!elegida) {
      setIntentoSinElegir(true);
      return;
    }
    guardar.mutate(elegida);
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Categoría TEM ${year}`}
      description={ayuda}
      footer={
        <ActionDrawerFooter
          primary={<Button type="submit" form="categoria-tem-form" loading={guardar.isPending} disabled={sinCatalogo}>Guardar categoría</Button>}
          hint={sinCatalogo ? `Todavía no hay mínimos del TEM cargados para ${year}.` : null}
          onCancel={onClose}
        />
      }
    >
      <form id="categoria-tem-form" className="study-form study-form--compact" noValidate onSubmit={enviar}>
        <CalendarioFiscalSelect
          id="categoria-tem"
          label={`Categoría ${year}`}
          value={elegida}
          placeholder="Elegí una categoría…"
          options={opciones.map((opcion) => ({ value: opcion.category, label: `${opcion.label} — mínimo mensual ${importeEnPesos(opcion.minimum)}` }))}
          onChange={(valor) => { setElegida(valor); guardar.reset(); }}
          {...(error ? { error } : {})}
        />
        {campoDelServidor ? null : <MutationError error={guardar.error} />}
      </form>
    </ActionDrawer>
  );
}
