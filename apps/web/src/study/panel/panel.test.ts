import { describe, expect, it, vi } from "vitest";
import type { TaxPanelResponsable, TaxPanelRow } from "@contable/contracts";
import type { FiscalYear } from "../../lib/api";
import {
  RUTA_EXPEDIENTE,
  RUTA_RESUMEN,
  abrirClienteDelPanel,
  periodoContableEquivalente,
} from "./abrirCliente";
import {
  RESPONSABLE_MIS,
  RESPONSABLE_TODOS,
  escribirFiltros,
  hayFiltrosActivos,
  leerFiltros,
  rutaObligaciones,
  type FiltrosPanel,
} from "./filtros";
import {
  badgeDj,
  calificadorDelConteo,
  conOpcionElegida,
  errorDelPanel,
  indicadoresDelPanel,
  opcionesResponsable,
  periodosDeFilas,
  sumarDias,
  textoResponsables,
  textoVencimiento,
} from "./presentacion";

// Datos sintéticos rotulados: no son clientes ni obligaciones reales.
const USUARIO = "00000000-0000-4000-8000-000000000001";
const OTRO = "00000000-0000-4000-8000-000000000002";
const IMPUESTO = "00000000-0000-4000-8000-0000000000aa";
const PERIODO = "00000000-0000-4000-8000-0000000000bb";

const FILTROS_INICIALES: FiltrosPanel = {
  responsable: RESPONSABLE_MIS,
  terminacion: [],
  impuesto: "",
  estado: "",
  periodo: "",
  desde: "",
  hasta: "",
};

function fila(parcial: Partial<TaxPanelRow>): TaxPanelRow {
  return {
    obligationId: "ob-demo",
    clientId: "cliente-demo",
    clientName: "Cliente Demo 1",
    cuit: "20111111112",
    cuitEnding: "2",
    taxTypeId: IMPUESTO,
    taxTypeName: "IVA",
    regimeId: "regimen-demo",
    regimeName: "IVA general",
    jurisdictionId: "jurisdiccion-demo",
    jurisdictionName: "Nacional",
    periodId: PERIODO,
    periodLabel: "10/2026",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    dueDate: "2026-11-20",
    dueDateSource: "CALENDAR",
    calculatedDueDate: null,
    daysUntilDue: 5,
    legajo: null,
    filing: null,
    djState: "SIN_LEGAJO",
    assigneeCount: 1,
    responsables: [],
    ...parcial,
  };
}

describe("filtros del panel en la URL", () => {
  it("la vista inicial es «Mis obligaciones» sin otros criterios", () => {
    const filtros = leerFiltros(new URLSearchParams(""));
    expect(filtros).toEqual(FILTROS_INICIALES);
    expect(hayFiltrosActivos(filtros)).toBe(false);
    expect(escribirFiltros(filtros).toString()).toBe("");
  });

  it("descarta valores inválidos de la URL en vez de mandarlos a la API", () => {
    const filtros = leerFiltros(
      new URLSearchParams(
        "responsable=alguien&terminacion=5,1,5,x&estado=FOO&desde=2026-02-31&hasta=2026-12-01",
      ),
    );
    expect(filtros.responsable).toBe(RESPONSABLE_MIS);
    expect(filtros.terminacion).toEqual(["1", "5"]);
    expect(filtros.estado).toBe("");
    expect(filtros.desde).toBe("");
    expect(filtros.hasta).toBe("2026-12-01");
  });

  it("escribe y lee el mismo estado; «todos» es un criterio y «Mis obligaciones» no", () => {
    const todos = { ...FILTROS_INICIALES, responsable: RESPONSABLE_TODOS, estado: "DJ_PENDIENTE" };
    const url = escribirFiltros(todos);
    expect(url.get("responsable")).toBe("todos");
    expect(url.get("estado")).toBe("DJ_PENDIENTE");
    expect(leerFiltros(url)).toEqual(todos);
    expect(hayFiltrosActivos(todos)).toBe(true);
  });

  it("traduce los criterios a los parámetros del contrato y omite «todos»", () => {
    const conMis = rutaObligaciones("firm-a", FILTROS_INICIALES, { offset: 0, limit: 100 });
    expect(conMis).toBe(
      "/firms/firm-a/portfolio/tax-worklist/obligations?responsable=me&limit=100&offset=0",
    );
    const conTodos = rutaObligaciones(
      "firm-a",
      {
        ...FILTROS_INICIALES,
        responsable: RESPONSABLE_TODOS,
        terminacion: ["1", "5"],
        desde: "2026-10-01",
      },
      { offset: 100, limit: 100 },
    );
    expect(conTodos).toBe(
      "/firms/firm-a/portfolio/tax-worklist/obligations?terminacion=1%2C5&dueFrom=2026-10-01&limit=100&offset=100",
    );
  });
});

describe("fechas y días", () => {
  it("suma días corridos cruzando meses y años", () => {
    expect(sumarDias("2026-03-01", -30)).toBe("2026-01-30");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("nombra la distancia al vencimiento en días corridos", () => {
    expect(textoVencimiento(0)).toBe("vence hoy");
    expect(textoVencimiento(1)).toBe("en 1 día");
    expect(textoVencimiento(12)).toBe("en 12 días");
    expect(textoVencimiento(-1)).toBe("vencida hace 1 día");
    expect(textoVencimiento(-3)).toBe("vencida hace 3 días");
    expect(textoVencimiento(null)).toBeNull();
  });
});

describe("indicadores y estados", () => {
  it("cuenta vencidas, vencen en 7 días, sin legajo y DJ pendientes; sin vencimiento no cuenta por fecha", () => {
    const indicadores = indicadoresDelPanel([
      fila({ obligationId: "a", daysUntilDue: -2, djState: "DJ_PENDIENTE" }),
      fila({ obligationId: "b", daysUntilDue: 7, djState: "SIN_LEGAJO" }),
      fila({ obligationId: "c", daysUntilDue: 8, djState: "PRESENTADO" }),
      fila({ obligationId: "d", dueDate: null, daysUntilDue: null, djState: "SIN_LEGAJO" }),
    ]);
    expect(indicadores).toEqual({ vencidas: 1, semana: 1, sinLegajo: 2, djPendientes: 1 });
  });

  it("asocia cada estado de DJ a su rótulo y a un tono de StatusBadge", () => {
    expect(badgeDj("PRESENTADO")).toEqual({ status: "FILED", label: "Presentado" });
    expect(badgeDj("PRESENTACION_SIN_ACUSE")).toEqual({
      status: "PENDING_VERIFICATION",
      label: "Presentación sin acuse",
    });
  });

  it("muestra el error con el mensaje de la API y la acción de acotar solo en el 422 de tope", () => {
    const tope = errorDelPanel({
      code: "TAX_PANEL_TOO_MANY_OBLIGATIONS",
      message: "Hay más de 5.000 obligaciones con estos filtros",
    });
    expect(tope).toEqual({
      demasiadas: true,
      titulo: "Hay demasiadas obligaciones para este filtro",
      descripcion: "Hay más de 5.000 obligaciones con estos filtros",
    });
    expect(errorDelPanel(new Error("Sin conexión")).demasiadas).toBe(false);
    expect(errorDelPanel(undefined).descripcion).toBe(
      "Reintentá en unos minutos o comprobá tu conexión.",
    );
  });
});

describe("responsables", () => {
  const sinNombre = (userId: string): TaxPanelResponsable => ({
    userId,
    name: null,
    isSelf: false,
  });

  it("muestra nombres cuando llegan y la cantidad cuando no hay ninguno visible", () => {
    expect(textoResponsables([])).toEqual({ texto: "Sin responsable", detalle: null });
    expect(textoResponsables([sinNombre(OTRO)])).toEqual({ texto: "1 responsable", detalle: null });
    expect(textoResponsables([sinNombre(OTRO), sinNombre(USUARIO)])).toEqual({
      texto: "2 responsables",
      detalle: null,
    });
    expect(
      textoResponsables([{ userId: USUARIO, name: "Ana Demo", isSelf: true }, sinNombre(OTRO)]),
    ).toEqual({ texto: "Ana Demo +1", detalle: "1 más sin nombre visible" });
  });

  it("ofrece solo responsables con nombre visible y sin el usuario actual", () => {
    const opciones = opcionesResponsable(
      [
        { userId: USUARIO, name: "Yo Demo" },
        { userId: OTRO, name: "Beta Demo" },
        { userId: "00000000-0000-4000-8000-000000000003", name: null },
        { userId: "00000000-0000-4000-8000-000000000004", name: "Alfa Demo" },
      ],
      USUARIO,
    );
    expect(opciones).toEqual([
      { value: "00000000-0000-4000-8000-000000000004", label: "Alfa Demo" },
      { value: OTRO, label: "Beta Demo" },
    ]);
    expect(conOpcionElegida(opciones, OTRO, "Responsable elegido")).toEqual(opciones);
    expect(
      conOpcionElegida(opciones, "00000000-0000-4000-8000-000000000009", "Responsable elegido")[0],
    ).toEqual({ value: "00000000-0000-4000-8000-000000000009", label: "Responsable elegido" });
  });

  it("arma los períodos del filtro desde las fechas de las filas, del más reciente", () => {
    const opciones = periodosDeFilas([
      fila({ periodId: "p-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30" }),
      fila({ periodId: "p-oct", periodStart: "2026-10-01", periodEnd: "2026-10-31" }),
      fila({ periodId: "p-oct", periodStart: "2026-10-01", periodEnd: "2026-10-31" }),
    ]);
    expect(opciones).toEqual([
      { value: "p-oct", label: "octubre de 2026" },
      { value: "p-sep", label: "septiembre de 2026" },
    ]);
  });
});

function anio(periodos: { id: string; startDate: string; endDate: string }[]): FiscalYear {
  return {
    id: "ejercicio-demo",
    label: "2026",
    periods: periodos.map((p) => ({ ...p, status: "OPEN" })),
  };
}

describe("abrir cliente desde el panel", () => {
  const rango = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };

  it("elige el período contable que se superpone con el período fiscal", () => {
    const anios = [
      anio([
        { id: "contable-sep", startDate: "2026-09-01", endDate: "2026-09-30" },
        { id: "contable-oct", startDate: "2026-10-01", endDate: "2026-10-31" },
      ]),
    ];
    expect(periodoContableEquivalente(anios, rango)).toBe("contable-oct");
    expect(
      periodoContableEquivalente(
        [anio([{ id: "x", startDate: "2025-10-01", endDate: "2025-10-31" }])],
        rango,
      ),
    ).toBeNull();
  });

  it("con período contable va al Legajo y deja el período en el contexto", async () => {
    const setClientId = vi.fn();
    const setPeriodId = vi.fn();
    const navigate = vi.fn();
    const destino = await abrirClienteDelPanel({
      firmId: "firm-a",
      clientId: "cliente-demo",
      rango,
      cargarAnios: async () => [
        anio([{ id: "contable-oct", startDate: "2026-10-01", endDate: "2026-10-31" }]),
      ],
      setClientId,
      setPeriodId,
      navigate,
    });
    expect(destino).toBe(RUTA_EXPEDIENTE);
    expect(setClientId).toHaveBeenCalledWith("cliente-demo");
    expect(setPeriodId).toHaveBeenCalledWith("contable-oct");
    expect(navigate).toHaveBeenCalledWith(RUTA_EXPEDIENTE);
  });

  it("sin período contable va al Resumen del cliente y no toca el período", async () => {
    const setPeriodId = vi.fn();
    const navigate = vi.fn();
    const destino = await abrirClienteDelPanel({
      firmId: "firm-a",
      clientId: "cliente-demo",
      rango,
      cargarAnios: async () => [],
      setClientId: vi.fn(),
      setPeriodId,
      navigate,
    });
    expect(destino).toBe(RUTA_RESUMEN);
    expect(setPeriodId).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(RUTA_RESUMEN);
  });

  it("si falla la lectura de ejercicios, también va al Resumen del cliente", async () => {
    const navigate = vi.fn();
    const destino = await abrirClienteDelPanel({
      firmId: "firm-a",
      clientId: "cliente-demo",
      rango,
      cargarAnios: async () => {
        throw new Error("sin respuesta");
      },
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
      navigate,
    });
    expect(destino).toBe(RUTA_RESUMEN);
    expect(navigate).toHaveBeenCalledWith(RUTA_RESUMEN);
  });
});

describe("calificador del conteo (hallazgo 62)", () => {
  it("nombra el alcance una sola vez y concuerda el número con el sustantivo", () => {
    expect(calificadorDelConteo(1, "filtradas")).toBe("Sobre 1 obligación filtrada:");
    expect(calificadorDelConteo(2, "filtradas")).toBe("Sobre las 2 obligaciones filtradas:");
    expect(calificadorDelConteo(1, "cargadas")).toBe("Sobre 1 obligación cargada:");
    expect(calificadorDelConteo(3, "cargadas")).toBe("Sobre las 3 obligaciones cargadas:");
  });
});
