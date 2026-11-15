// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyCatalogosFiscales } from "../StudyCatalogosFiscales";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

// Datos sintéticos «Demo»: sin registros reales ni CUIT.
const nacion = {
  id: "jur-nacion",
  code: "DEMO-NAC",
  name: "Nación Demo",
  kind: "NATIONAL",
  parentId: null,
  parent: null,
  isActive: true,
  origin: "REFERENCE",
  createdByFirmId: null,
};
const provincia = {
  id: "jur-prov",
  code: "DEMO-PBA",
  name: "Provincia Demo",
  kind: "PROVINCIAL",
  parentId: "jur-nacion",
  parent: { id: "jur-nacion", code: "DEMO-NAC", name: "Nación Demo", kind: "NATIONAL" },
  isActive: true,
  origin: "UI",
  createdByFirmId: "firm-demo",
};
const ciudad = {
  id: "jur-ciudad",
  code: "DEMO-CIU",
  name: "Ciudad Demo",
  kind: "MUNICIPAL",
  parentId: "jur-nacion",
  parent: { id: "jur-nacion", code: "DEMO-NAC", name: "Nación Demo", kind: "NATIONAL" },
  isActive: false,
  origin: "UI",
  createdByFirmId: "firm-demo",
};
const iva = {
  id: "tt-iva",
  code: "DEMO-IVA",
  name: "IVA Demo",
  defaultFamilyId: null,
  isActive: true,
  origin: "REFERENCE",
  createdByFirmId: null,
};
const ingresosBrutos = {
  id: "tt-ib",
  code: "DEMO-IB",
  name: "Ingresos brutos Demo",
  defaultFamilyId: null,
  isActive: true,
  origin: "UI",
  createdByFirmId: "firm-demo",
};
const selectivo = {
  id: "tt-sel",
  code: "DEMO-SEL",
  name: "Selectivo Demo",
  defaultFamilyId: null,
  isActive: false,
  origin: "UI",
  createdByFirmId: "firm-demo",
};
const arca = {
  id: "auth-arca",
  code: "DEMO-ARCA",
  name: "Organismo Demo Nación",
  jurisdictionId: "jur-nacion",
  isActive: true,
  origin: "REFERENCE",
  createdByFirmId: null,
  jurisdiction: nacion,
};
const dgr = {
  id: "auth-dgr",
  code: "DEMO-DGR",
  name: "DGR Demo",
  jurisdictionId: "jur-prov",
  isActive: true,
  origin: "UI",
  createdByFirmId: "firm-demo",
  jurisdiction: provincia,
};
const organismoOculto = {
  id: "auth-oculto",
  code: "DEMO-OCU",
  name: "Organismo oculto Demo",
  jurisdictionId: "jur-prov",
  isActive: false,
  origin: "UI",
  createdByFirmId: "firm-demo",
  jurisdiction: provincia,
};
const regimenGeneral = {
  id: "reg-general",
  code: "DEMO-REG-1",
  name: "Régimen general Demo",
  calcFamilyId: null,
  moduleId: null,
  isActive: true,
  origin: "REFERENCE",
  createdByFirmId: null,
  authority: arca,
  jurisdiction: nacion,
  taxType: iva,
};
const regimenIncoherente = {
  id: "reg-incoherente",
  code: "DEMO-REG-2",
  name: "Régimen incoherente Demo",
  calcFamilyId: null,
  moduleId: null,
  isActive: true,
  origin: "UI",
  createdByFirmId: "firm-demo",
  authority: dgr,
  jurisdiction: nacion,
  taxType: selectivo,
};
const regimenOculto = {
  id: "reg-oculto",
  code: "DEMO-REG-3",
  name: "Régimen oculto Demo",
  calcFamilyId: null,
  moduleId: null,
  isActive: false,
  origin: "UI",
  createdByFirmId: "firm-demo",
  authority: arca,
  jurisdiction: nacion,
  taxType: ingresosBrutos,
};
const actividadUno = {
  id: "act-1",
  code: "DEMO-ACT-1",
  name: "Actividad Demo uno",
  jurisdictionId: "jur-nacion",
  source: "Fuente Demo",
  validFrom: "2026-01-01",
  validTo: null,
  isActive: true,
  origin: "REFERENCE",
  createdByFirmId: null,
};
const actividadDos = {
  id: "act-2",
  code: "DEMO-ACT-2",
  name: "Actividad Demo dos",
  jurisdictionId: "jur-prov",
  source: null,
  validFrom: "2026-02-01",
  validTo: "2026-12-31",
  isActive: true,
  origin: "UI",
  createdByFirmId: "firm-demo",
};
const actividadOculta = {
  id: "act-3",
  code: "DEMO-ACT-3",
  name: "Actividad oculta Demo",
  jurisdictionId: "jur-prov",
  source: "Fuente",
  validFrom: "2026-03-01",
  validTo: null,
  isActive: false,
  origin: "UI",
  createdByFirmId: "firm-demo",
};

type Clave = "jurisdicciones" | "tipos" | "organismos" | "regimenes" | "actividades";
type Datos = Record<Clave, Array<Record<string, unknown>>>;

function datosDemo(): Datos {
  return {
    jurisdicciones: [nacion, provincia, ciudad],
    tipos: [iva, ingresosBrutos, selectivo],
    organismos: [arca, dgr, organismoOculto],
    regimenes: [regimenGeneral, regimenIncoherente, regimenOculto],
    actividades: [actividadUno, actividadDos, actividadOculta],
  };
}

let datos: Datos = datosDemo();
let pendientes = new Set<Clave>();
let fallan = new Set<Clave>();

const rutas: Record<string, Clave> = {
  "/tax/jurisdictions?includeInactive=true": "jurisdicciones",
  "/tax/types?includeInactive=true": "tipos",
  "/tax/authorities?includeInactive=true": "organismos",
  "/tax/regimes?includeInactive=true": "regimenes",
  "/tax/activities?includeInactive=true": "actividades",
};

function mockApi() {
  vi.mocked(api.get).mockImplementation(((ruta: string) => {
    if (ruta.startsWith("/tax/catalog-usage/")) {
      return Promise.resolve({ entityId: ruta.split("/").at(-1) ?? "", used: false, count: 0, places: [] });
    }
    const clave = rutas[ruta];
    if (!clave) return Promise.resolve([]);
    if (pendientes.has(clave)) return new Promise(() => undefined);
    if (fallan.has(clave)) return Promise.reject(new Error("Consulta sintética no disponible"));
    return Promise.resolve(structuredClone(datos[clave]));
  }) as never);
}

function sinOrigen(d: Datos): Datos {
  return Object.fromEntries(
    Object.entries(d).map(([clave, filas]) => [
      clave,
      filas.map((fila) => Object.fromEntries(Object.entries(fila).filter(([campo]) => campo !== "origin"))),
    ]),
  ) as Datos;
}

function contexto(puedePropone = true): ClientContextValue {
  return {
    firmId: "firm-demo",
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(puedePropone ? ["tax.rules.read", "tax.rules.propose"] : ["tax.rules.read"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderCatalogos() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StudyCatalogosFiscales />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const openTab = async (name: RegExp) => fireEvent.click(await screen.findByRole("tab", { name }));
const buscar = (texto: string) =>
  fireEvent.change(screen.getByPlaceholderText("Buscar código o nombre…"), { target: { value: texto } });
const muestra = (texto: string) => screen.queryAllByText(texto).length > 0;

beforeEach(() => {
  vi.clearAllMocks();
  datos = datosDemo();
  pendientes = new Set();
  fallan = new Set();
  contextMock.current = contexto();
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Tabla de Catálogos fiscales (K2)", () => {
  it("dibuja las columnas de cada pestaña en el orden vigente", async () => {
    renderCatalogos();
    const casos: Array<[RegExp, string, string[]]> = [
      [/^Jurisdicciones/, "Jurisdicciones", ["Código", "Jurisdicción", "Nivel", "Padre", "Origen", "Estado"]],
      [/^Tipos de impuesto/, "Tipos de impuesto", ["Código", "Tipo de impuesto", "Origen", "Estado"]],
      [
        /^Organismos recaudadores/,
        "Organismos recaudadores",
        ["Código", "Organismo", "Jurisdicción", "Regímenes", "Origen", "Estado"],
      ],
      [
        /^Regímenes/,
        "Regímenes",
        ["Código", "Régimen", "Impuesto", "Jurisdicción", "Organismo", "Coherencia", "Origen", "Estado"],
      ],
      [
        /^Actividades económicas/,
        "Actividades económicas",
        ["Código", "Actividad", "Jurisdicción", "Fuente", "Vigencia", "Origen", "Estado"],
      ],
    ];
    for (const [pestaña, tabla, encabezados] of casos) {
      await openTab(pestaña);
      const grilla = await screen.findByRole("table", { name: tabla });
      expect(within(grilla).getAllByRole("columnheader").map((celda) => celda.textContent)).toEqual(encabezados);
    }
  });

  it("el pie dice N de M y la fila oculta va atenuada", async () => {
    renderCatalogos();
    await openTab(/^Jurisdicciones/);
    await screen.findByText("3 de 3");
    expect(screen.getByText("DEMO-CIU").closest("tr")?.className).toContain("dense-row--muted");
    expect(screen.getByText("DEMO-NAC").closest("tr")?.className).not.toContain("dense-row--muted");
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "inactive" } });
    expect(await screen.findByText("1 de 3")).toBeTruthy();
    expect(muestra("DEMO-CIU")).toBe(true);
    expect(muestra("DEMO-PBA")).toBe(false);
  });

  it("separa el vacío sin datos de las coincidencias vacías y solo Actividades ofrece Quitar filtro", async () => {
    datos.jurisdicciones = [];
    renderCatalogos();
    await openTab(/^Jurisdicciones/);
    expect(await screen.findByText("Todavía no hay jurisdicciones")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    cleanup();

    datos = datosDemo();
    renderCatalogos();
    await openTab(/^Jurisdicciones/);
    await screen.findByText("3 de 3");
    buscar("zzz");
    expect(await screen.findByText("Ninguna jurisdicción coincide con los filtros")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    cleanup();

    renderCatalogos();
    await openTab(/^Actividades económicas/);
    await screen.findByText("3 de 3");
    buscar("zzz");
    expect(await screen.findByText("Ninguna actividad coincide con el filtro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro" }));
    expect(await screen.findByText("3 de 3")).toBeTruthy();
    expect((screen.getByPlaceholderText("Buscar código o nombre…") as HTMLInputElement).value).toBe("");
    cleanup();

    datos.actividades = [];
    renderCatalogos();
    await openTab(/^Actividades económicas/);
    expect(await screen.findByText("Todavía no hay actividades económicas")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    cleanup();

    // Criterio vigente: sin organismos activos, el vacío dice «Todavía no hay» aunque haya ocultos.
    datos.organismos = [organismoOculto];
    renderCatalogos();
    expect(await screen.findByText("1 de 1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "active" } });
    expect(await screen.findByText("Todavía no hay organismos recaudadores")).toBeTruthy();
  });

  it("oculta Origen y su filtro en organismos, regímenes y actividades si ninguna fila trae origen", async () => {
    datos = sinOrigen(datosDemo());
    renderCatalogos();
    const organismos = await screen.findByRole("table", { name: "Organismos recaudadores" });
    expect(within(organismos).getAllByRole("columnheader").map((celda) => celda.textContent)).toEqual([
      "Código",
      "Organismo",
      "Jurisdicción",
      "Regímenes",
      "Estado",
    ]);
    expect(screen.queryByLabelText("Filtrar por origen")).toBeNull();
    expect(screen.getByText("— propios, — de referencia")).toBeTruthy();
    await openTab(/^Regímenes/);
    const regimenes = await screen.findByRole("table", { name: "Regímenes" });
    expect(within(regimenes).getAllByRole("columnheader").map((celda) => celda.textContent)).not.toContain("Origen");
    await openTab(/^Actividades económicas/);
    const actividades = await screen.findByRole("table", { name: "Actividades económicas" });
    expect(within(actividades).getAllByRole("columnheader").map((celda) => celda.textContent)).not.toContain("Origen");
    // Jurisdicciones no filtra la columna Origen: se conserva aunque ninguna fila lo traiga.
    await openTab(/^Jurisdicciones/);
    const jurisdicciones = await screen.findByRole("table", { name: "Jurisdicciones" });
    expect(within(jurisdicciones).getAllByRole("columnheader").map((celda) => celda.textContent)).toContain("Origen");
  });

  it("muestra la carga de cada pestaña con su rótulo", async () => {
    pendientes = new Set<Clave>(["jurisdicciones", "tipos", "organismos", "regimenes", "actividades"]);
    renderCatalogos();
    expect(await screen.findByText("Cargando organismos recaudadores…")).toBeTruthy();
    await openTab(/^Jurisdicciones/);
    expect(await screen.findByText("Cargando jurisdicciones…")).toBeTruthy();
    await openTab(/^Tipos de impuesto/);
    expect(await screen.findByText("Cargando tipos de impuesto…")).toBeTruthy();
    await openTab(/^Regímenes/);
    expect(await screen.findByText("Cargando regímenes…")).toBeTruthy();
    await openTab(/^Actividades económicas/);
    expect(await screen.findByText("Cargando actividades económicas…")).toBeTruthy();
  });

  it("marca Revisar el régimen cuyo organismo recauda en otra jurisdicción", async () => {
    renderCatalogos();
    await openTab(/^Regímenes/);
    const grilla = await screen.findByRole("table", { name: "Regímenes" });
    expect(within(grilla).getByText("Revisar")).toBeTruthy();
    expect(within(grilla).getAllByText("OK")).toHaveLength(2);
  });
});

describe("Filtros y resumen de Catálogos fiscales (K3)", () => {
  it("resume propios, de referencia y alertas con la consulta sana", async () => {
    renderCatalogos();
    expect(await screen.findByText("10 propios, 5 de referencia")).toBeTruthy();
    expect(screen.getByText("1 alerta")).toBeTruthy();
  });

  it("busca sin tildes en código, nombre, impuesto, jurisdicción y fuente", async () => {
    renderCatalogos();
    await openTab(/^Jurisdicciones/);
    await screen.findByText("3 de 3");
    buscar("provincia");
    expect(await screen.findByText("1 de 3")).toBeTruthy();
    expect(muestra("DEMO-PBA")).toBe(true);
    expect(muestra("DEMO-NAC")).toBe(false);
    // «nacion» sin tilde encuentra «Nación»; los hijos coinciden por el nombre del padre.
    buscar("nacion");
    expect(await screen.findByText("3 de 3")).toBeTruthy();

    buscar("");
    await openTab(/^Regímenes/);
    buscar("regimen general");
    expect(await screen.findByText("1 de 3")).toBeTruthy();
    expect(muestra("DEMO-REG-1")).toBe(true);
    buscar("selectivo");
    expect(muestra("DEMO-REG-2")).toBe(true);
    expect(muestra("DEMO-REG-1")).toBe(false);
    buscar("dgr");
    expect(muestra("DEMO-REG-2")).toBe(true);
    expect(muestra("DEMO-REG-3")).toBe(false);
    buscar("nacion");
    expect(muestra("DEMO-REG-1") && muestra("DEMO-REG-2") && muestra("DEMO-REG-3")).toBe(true);

    buscar("");
    await openTab(/^Actividades económicas/);
    buscar("fuente");
    expect(muestra("DEMO-ACT-1")).toBe(true);
    expect(muestra("DEMO-ACT-3")).toBe(true);
    expect(muestra("DEMO-ACT-2")).toBe(false);
  });

  it("el filtro de jurisdicción incluye a sus hijos directos", async () => {
    renderCatalogos();
    await openTab(/^Jurisdicciones/);
    await screen.findByText("3 de 3");
    fireEvent.change(screen.getByLabelText("Filtrar por jurisdicción"), { target: { value: "jur-prov" } });
    expect(await screen.findByText("1 de 3")).toBeTruthy();
    expect(muestra("DEMO-PBA")).toBe(true);
    fireEvent.change(screen.getByLabelText("Filtrar por jurisdicción"), { target: { value: "jur-nacion" } });
    expect(await screen.findByText("3 de 3")).toBeTruthy();
  });

  it("Sólo con alertas refleja aria-pressed y filtra los regímenes incoherentes", async () => {
    renderCatalogos();
    await openTab(/^Regímenes/);
    await screen.findByText("3 de 3");
    const boton = screen.getByRole("button", { name: "Sólo con alertas" });
    expect(boton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(boton);
    expect(boton.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("1 de 3")).toBeTruthy();
    expect(muestra("DEMO-REG-1")).toBe(false);
    expect(muestra("DEMO-REG-2")).toBe(true);
  });

  it("muestra 0 alertas mientras la consulta de regímenes falla", async () => {
    fallan = new Set<Clave>(["regimenes"]);
    renderCatalogos();
    expect(await screen.findByText("No pudimos cargar regímenes.")).toBeTruthy();
    expect(screen.getByText("0 alertas")).toBeTruthy(); // vigente: cambia con D-4-6
  });

  it("muestra 0 en las pestañas mientras cargan las consultas", async () => {
    pendientes = new Set<Clave>(["jurisdicciones", "tipos", "organismos", "regimenes", "actividades"]);
    renderCatalogos();
    const lista = await screen.findByRole("tablist", { name: "Catálogos fiscales" });
    const conteo = within(lista).getByRole("tab", { name: /^Jurisdicciones/ }).querySelector(".dense-count");
    expect(conteo?.textContent).toBe("0"); // vigente: cambia con D-4-6
  });
});
