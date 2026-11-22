// Selección de impuestos a liquidar en el mes, mínimo libre de IIBB Tucumán y fórmula legible (Brief 3C).
import { formatMoney } from "../formato";
import type { WorkpaperCalculationComponent } from "../tipos";

export interface SeleccionCalculo {
  /** Ids de obligación marcados para liquidar este mes. */
  obligationIds: string[];
  /** Mínimo del mes por obligación (texto tipeado; vacío = sin mínimo). */
  minimums: Record<string, string>;
}

const IMPORTE = /^\d+(\.\d{1,2})?$/;
const MENSAJE_IMPORTE = "Escribí solo el importe, con hasta dos decimales (por ejemplo 1500 o 1500.50).";

export function seleccionHabitual(components: WorkpaperCalculationComponent[]): SeleccionCalculo {
  return {
    obligationIds: components.filter((component) => component.habitual).map((component) => component.obligationId),
    minimums: {},
  };
}

export function seleccionEfectiva(
  components: WorkpaperCalculationComponent[],
  seleccion: SeleccionCalculo | null,
): SeleccionCalculo {
  return seleccion ?? seleccionHabitual(components);
}

/** Error del campo de mínimo; null si está vacío o es un importe válido. */
export function errorMinimo(valor: string | undefined): string | null {
  if (!valor) return null;
  return IMPORTE.test(valor) ? null : MENSAJE_IMPORTE;
}

/** Motivo por el que no se puede calcular con esta selección; null si se puede. */
export function motivoSeleccionCalculo(
  components: WorkpaperCalculationComponent[],
  seleccion: SeleccionCalculo,
): string | null {
  // Sin obligaciones en el expediente, el API responde con el motivo (no hay nada que liquidar).
  if (components.length === 0) return null;
  if (seleccion.obligationIds.length === 0) {
    return "Elegí al menos un impuesto para liquidar este mes.";
  }
  const minimoInvalido = components.some(
    (component) =>
      seleccion.obligationIds.includes(component.obligationId) &&
      component.usaMinimoDeclarado &&
      errorMinimo(seleccion.minimums[component.obligationId]) !== null,
  );
  return minimoInvalido ? "Corregí el mínimo marcado en rojo antes de calcular." : null;
}

/** Cuerpo del pedido de cálculo: solo los impuestos marcados y los mínimos que se cargaron. */
export function cuerpoCalculo(
  components: WorkpaperCalculationComponent[],
  seleccion: SeleccionCalculo,
): { obligationIds: string[]; minimums?: Record<string, string> } {
  const minimums: Record<string, string> = {};
  for (const component of components) {
    const valor = seleccion.minimums[component.obligationId];
    if (
      seleccion.obligationIds.includes(component.obligationId) &&
      component.usaMinimoDeclarado &&
      valor
    ) {
      minimums[component.obligationId] = valor;
    }
  }
  return {
    obligationIds: seleccion.obligationIds,
    ...(Object.keys(minimums).length > 0 ? { minimums } : {}),
  };
}

function alicuotaUnica(component: WorkpaperCalculationComponent): string | null {
  const tasas = new Set(
    (component.settlement?.lines ?? [])
      // Renglones de actividad: los que traen su alícuota (dato del motor, no texto del concepto).
      .filter((linea) => linea.inputs?.["rate"] !== undefined)
      .map((linea) => String(linea.inputs?.["rate"])),
  );
  if (tasas.size !== 1) return null;
  const [tasa] = [...tasas];
  if (!tasa) return null;
  const porcentaje = Number(tasa) * 100;
  return `${porcentaje.toLocaleString("es-AR", { maximumFractionDigits: 4 })} %`;
}

/** Marca o desmarca un impuesto; conserva el mínimo cargado de los demás. */
export function alternarImpuesto(
  seleccion: SeleccionCalculo,
  obligationId: string,
  marcado: boolean,
): SeleccionCalculo {
  const sin = seleccion.obligationIds.filter((id) => id !== obligationId);
  return {
    ...seleccion,
    obligationIds: marcado ? [...sin, obligationId] : sin,
  };
}

export function seleccionDeImpuesto(seleccion: SeleccionCalculo, obligationId: string): boolean {
  return seleccion.obligationIds.includes(obligationId);
}

/** Forma del pedido de cálculo (impuestos marcados y mínimos cargados). */
export interface CuerpoDeCalculo {
  obligationIds?: string[];
  minimums?: Record<string, string>;
}

/** Forma comparable de un mínimo: el mismo importe escrito con o sin decimales es el mismo valor. */
function minimoNormalizado(valor: string | undefined): string | null {
  if (!valor || errorMinimo(valor) !== null) return null;
  return Number(valor).toFixed(2);
}

/**
 * Qué cambió entre el pedido del último cálculo aplicado y la selección actual (4K). Si no hay
 * cálculo aplicado (la pantalla no lo conoce), no hay nada que señalar.
 */
export function cambiosDesdeCalculo(
  actual: CuerpoDeCalculo,
  aplicado: CuerpoDeCalculo | null,
): { hayCambios: boolean; minimo: boolean; impuestos: boolean } {
  if (!aplicado) return { hayCambios: false, minimo: false, impuestos: false };
  const impuestosActual = [...(actual.obligationIds ?? [])].sort().join("|");
  const impuestosAplicado = [...(aplicado.obligationIds ?? [])].sort().join("|");
  const ids = new Set([...Object.keys(actual.minimums ?? {}), ...Object.keys(aplicado.minimums ?? {})]);
  const minimo = [...ids].some(
    (id) =>
      minimoNormalizado(actual.minimums?.[id]) !== minimoNormalizado(aplicado.minimums?.[id]),
  );
  const impuestos = impuestosActual !== impuestosAplicado;
  return { hayCambios: minimo || impuestos, minimo, impuestos };
}

/** Líneas de la fórmula de un impuesto liquidado, en lenguaje del contador. */
export function lineasDeFormula(component: WorkpaperCalculationComponent): string[] {
  const settlement = component.settlement;
  if (!settlement) return [];
  const totales = settlement.totals ?? {};
  const dinero = (valor: string | undefined) => formatMoney(valor ?? "0");
  const tieneValor = (clave: string) => Number(totales[clave] ?? 0) !== 0;
  const lineas: string[] = [];

  const alicuota = alicuotaUnica(component);
  lineas.push(
    `Base ${dinero(totales["BASE_TOTAL"])}${alicuota ? ` × alícuota ${alicuota}` : ""} = impuesto por actividad ${dinero(totales["IMPUESTO_POR_ACTIVIDAD"])}.`,
  );

  const minimo = settlement.minimo;
  if (component.usaMinimoDeclarado || minimo) {
    if (!minimo) {
      lineas.push("Sin mínimo: completalo si corresponde.");
    } else {
      const origen = minimo.origen === "CAMPO" ? "mínimo del mes" : "mínimo de la categoría";
      lineas.push(`Mínimo: ${origen} ${dinero(minimo.amount)}.`);
    }
  }
  if (totales["MINIMO_APLICADO"] !== undefined) {
    lineas.push("Se aplica el mínimo porque el impuesto por actividad es menor.");
  } else if (minimo) {
    lineas.push("No se aplica el mínimo: el impuesto por actividad es igual o mayor.");
  }

  const creditos = [
    ["retenciones", "RETENCIONES"],
    ["percepciones", "PERCEPCIONES"],
    ["recaudaciones", "RECAUDACIONES"],
  ] as const;
  const usados = creditos.filter(([, clave]) => tieneValor(clave));
  if (usados.length > 0) {
    lineas.push(`Menos créditos: ${usados.map(([nombre, clave]) => `${nombre} ${dinero(totales[clave])}`).join(", ")}.`);
  }
  if (tieneValor("SALDO_ANTERIOR")) {
    lineas.push(`Menos saldo a favor anterior: ${dinero(totales["SALDO_ANTERIOR"])}.`);
  }
  if (Number(totales["SALDO_A_FAVOR"] ?? 0) > 0) {
    lineas.push(`Saldo a favor: ${dinero(totales["SALDO_A_FAVOR"])}.`);
  } else {
    lineas.push(`Total a ingresar: ${dinero(totales["TOTAL_A_INGRESAR"])}.`);
  }
  return lineas;
}
