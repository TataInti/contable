import type { CoberturaLegajo, Workpaper, ClassificationCoverage, WorkpaperCalculationComponent } from "./tipos";

export type EstadoEtapa = {
  estado: "Lista" | "Con pendientes" | "No disponible todavía";
  mensaje: string | null;
  destino: number;
  accion: string | null;
};

type Fuente = Pick<CoberturaLegajo["sources"][number], "required" | "present" | "status"> & { label?: string };
type EntradaEstadoEtapas = {
  sources?: Fuente[];
  noMovements?: boolean;
  classification?: Pick<ClassificationCoverage, "total" | "classified" | "pending" | "ready">;
  calculationCount?: number;
  blockingControls?: number;
  status?: Workpaper["status"];
};

export function calcularEstadosEtapas(input: EntradaEstadoEtapas): EstadoEtapa[] {
  const faltantes = (input.sources ?? []).filter((source) => source.required && !source.present && source.status !== "NO_MOVEMENTS");
  const fuentesListas = faltantes.length === 0 || input.noMovements === true;
  const sinClasificar = input.classification?.pending ?? 0;
  const calculado = (input.calculationCount ?? 0) > 0 || ["CALCULATED", "IN_REVIEW", "CHANGES_REQUESTED", "REVIEWED", "FINALIZED"].includes(input.status ?? "");
  const bloqueos = input.blockingControls ?? 0;
  const finalizado = input.status === "FINALIZED";
  return [
    { estado: "Lista", mensaje: null, destino: 0, accion: null },
    fuentesListas
      ? { estado: "Lista", mensaje: null, destino: 1, accion: null }
      : { estado: "Con pendientes", mensaje: `Faltan ${faltantes.length} fuentes obligatorias`, destino: 1, accion: "Ir a Fuentes" },
    !fuentesListas
      ? { estado: "No disponible todavía", mensaje: "Faltan fuentes obligatorias", destino: 1, accion: "Ir a Fuentes" }
      : sinClasificar > 0
        ? { estado: "Con pendientes", mensaje: `Hay ${sinClasificar} comprobantes sin clasificar`, destino: 2, accion: "Ir a Clasificación" }
        : { estado: "Lista", mensaje: null, destino: 2, accion: null },
    !fuentesListas
      ? { estado: "No disponible todavía", mensaje: "Faltan fuentes obligatorias", destino: 1, accion: "Ir a Fuentes" }
      : sinClasificar > 0
        ? { estado: "No disponible todavía", mensaje: `Hay ${sinClasificar} comprobantes sin clasificar`, destino: 2, accion: "Ir a Clasificación" }
        : !calculado
          ? { estado: "Con pendientes", mensaje: "Falta calcular", destino: 3, accion: "Ir a Cálculo" }
          : { estado: "Lista", mensaje: null, destino: 3, accion: null },
    !calculado
      ? { estado: "No disponible todavía", mensaje: "Falta calcular", destino: 3, accion: "Ir a Cálculo" }
      : bloqueos > 0
        ? { estado: "Con pendientes", mensaje: "Falta resolver controles bloqueantes", destino: 4, accion: "Ir a Controles" }
        : { estado: "Lista", mensaje: null, destino: 4, accion: null },
    finalizado
      ? { estado: "Lista", mensaje: null, destino: 5, accion: null }
      : bloqueos > 0
        ? { estado: "No disponible todavía", mensaje: "Falta resolver controles bloqueantes", destino: 4, accion: "Ir a Controles" }
        : !calculado
          ? { estado: "No disponible todavía", mensaje: "Falta calcular", destino: 3, accion: "Ir a Cálculo" }
          : { estado: "Con pendientes", mensaje: "Falta revisar y finalizar la liquidación", destino: 5, accion: "Ir a Cierre" },
  ];
}

export function contarCalculos(calculos: WorkpaperCalculationComponent[] | undefined): number {
  return calculos?.filter((calculo) => Boolean(calculo.settlement)).length ?? 0;
}
