// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import { StudyReglasFiscales } from "../StudyReglasFiscales";

// K2 (Foco 3.1a): caracterización de la lista de paquetes por la pantalla y su export público.
// Las mismas aserciones valen antes y después de mover la lista a ListaPaquetes.tsx.
// Datos sintéticos rotulados «Demo»; sin datos de clientes ni CUIT reales.

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

function version(id: string, numero: number, status: string) {
  return {
    id,
    version: numero,
    status,
    origin: "UI",
    createdByFirmId: "firma-demo",
    validFrom: "2026-01-01",
    validTo: null,
    engineVersion: "motor-demo-v1",
    rulesHash: "hash-demo",
    rateRules: [],
    dueDateRules: [],
    sources: [],
  };
}

// Tres paquetes Demo: uno con versión vigente y borrador, uno en revisión y uno oculto sin versiones.
const paquetesDemo = [
  {
    id: "paquete-demo-iva",
    code: "DEMO-IVA-RI",
    name: "Demo IVA Responsable Inscripto",
    status: "ACTIVE",
    origin: "UI",
    createdByFirmId: "firma-demo",
    regime: {
      id: "regimen-demo-iva",
      name: "Régimen general Demo",
      code: "RG-DEMO",
      calcFamilyId: "familia-demo-iva",
      isActive: true,
      taxType: { name: "IVA", code: "IVA", isActive: true },
      jurisdiction: { name: "Nación", isActive: true },
    },
    versions: [version("version-demo-iva-4", 4, "ACTIVE"), version("version-demo-iva-2", 2, "DRAFT")],
  },
  {
    id: "paquete-demo-iibb",
    code: "DEMO-RET-CBA",
    name: "Demo Régimen de retención",
    status: "IN_REVIEW",
    origin: "UI",
    createdByFirmId: "firma-demo",
    regime: {
      id: "regimen-demo-iibb",
      name: "Retenciones Demo",
      code: "RET-DEMO",
      calcFamilyId: "familia-demo-iibb",
      isActive: true,
      taxType: { name: "Ingresos Brutos", code: "IIBB", isActive: true },
      jurisdiction: { name: "Córdoba", isActive: true },
    },
    versions: [version("version-demo-iibb-1", 1, "IN_REVIEW")],
  },
  {
    id: "paquete-demo-cuotas",
    code: "DEMO-CUOTAS",
    name: "Demo Cuotas simplificadas",
    status: "DRAFT",
    origin: "UI",
    createdByFirmId: "firma-demo",
    regime: {
      id: "regimen-demo-cuotas",
      name: "Cuota fija Demo",
      code: "CF-DEMO",
      calcFamilyId: null,
      isActive: false,
      taxType: { name: "Monotributo", code: "MONO", isActive: true },
      jurisdiction: { name: "Nación", isActive: true },
    },
    versions: [],
  },
];

function detalle(paquete: (typeof paquetesDemo)[number]) {
  return {
    ...paquete,
    regime: {
      ...paquete.regime,
      jurisdiction: { id: `jurisdiccion-${paquete.id}`, name: paquete.regime.jurisdiction.name, code: "DEMO" },
      authority: { id: "organismo-demo", name: "Organismo Demo", isActive: true },
    },
  };
}

function mockApi(lista: () => Promise<unknown>) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/tax/rule-packs") return lista();
    if (path.startsWith("/tax/rule-packs/")) {
      const paquete = paquetesDemo.find((item) => `/tax/rule-packs/${item.id}` === path);
      return Promise.resolve(paquete ? detalle(paquete) : null);
    }
    return Promise.resolve([]);
  }) as never);
}

function contexto(): ClientContextValue {
  return {
    firmId: "firma-demo",
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(["tax.rules.read", "tax.rules.propose"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderPantalla() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StudyReglasFiscales />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function tablaPaquetes() {
  return screen.findByRole("table", { name: "Paquetes de reglas disponibles" });
}

function nombresVisibles(): string[] {
  return Array.from(document.querySelectorAll("tr[data-row-key] strong"), (nodo) => nodo.textContent ?? "");
}

function fila(id: string): HTMLElement {
  const nodo = document.querySelector<HTMLElement>(`tr[data-row-key="${id}"]`);
  if (!nodo) throw new Error(`No hay fila ${id}`);
  return nodo;
}

function buscar(texto: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: /Buscar paquetes/ }), { target: { value: texto } });
}

function botonBanda(nombre: RegExp) {
  return screen.getByRole("button", { name: nombre });
}

describe("Lista de paquetes de reglas (K2, Demo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = contexto();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra código y régimen, versiones, «(oculto)», el conteo y la indicación para elegir", async () => {
    mockApi(() => Promise.resolve(paquetesDemo));
    renderPantalla();
    const tabla = await tablaPaquetes();
    expect(within(tabla).getByText("DEMO-IVA-RI · Régimen general Demo")).toBeTruthy();
    expect(within(tabla).getByText("DEMO-CUOTAS · Cuota fija Demo (oculto)")).toBeTruthy();
    expect(within(tabla).getByText("Monotributo")).toBeTruthy();
    expect(within(tabla).getByText("Borrador v2 · Vigente v4")).toBeTruthy();
    expect(within(tabla).getByText("En revisión v1")).toBeTruthy();
    expect(within(tabla).getByText("Sin versión activa")).toBeTruthy();
    expect(screen.getByText("3 paquetes")).toBeTruthy();
    expect(screen.getByText("Elegí un paquete para ver sus versiones y reglas.")).toBeTruthy();
  });

  it("busca sin distinguir tildes ni mayúsculas en nombre, código, impuesto y jurisdicción", async () => {
    mockApi(() => Promise.resolve(paquetesDemo));
    renderPantalla();
    await tablaPaquetes();

    buscar("REGIMEN");
    expect(nombresVisibles()).toEqual(["Demo Régimen de retención"]);
    buscar("demo-ret");
    expect(nombresVisibles()).toEqual(["Demo Régimen de retención"]);
    buscar("ingresos");
    expect(nombresVisibles()).toEqual(["Demo Régimen de retención"]);
    buscar("cordoba");
    expect(nombresVisibles()).toEqual(["Demo Régimen de retención"]);
    buscar("nacion");
    expect(nombresVisibles()).toEqual(["Demo IVA Responsable Inscripto", "Demo Cuotas simplificadas"]);
    buscar("monotributo");
    expect(nombresVisibles()).toEqual(["Demo Cuotas simplificadas"]);
    expect(screen.getByText("1 paquete")).toBeTruthy();
    buscar("   ");
    expect(nombresVisibles()).toHaveLength(3);
  });

  it("sin coincidencias muestra «Ningún paquete coincide.» (hoy; D-R3-9 lo cambia en el corte 3.2)", async () => {
    mockApi(() => Promise.resolve(paquetesDemo));
    renderPantalla();
    await tablaPaquetes();
    buscar("zzz-sin-coincidencias");
    expect(nombresVisibles()).toEqual([]);
    expect(screen.getByText("Ningún paquete coincide.")).toBeTruthy();
  });

  it("la banda filtra por versión vigente, borrador o en revisión, y el mismo filtro se quita al volver a pulsarlo", async () => {
    mockApi(() => Promise.resolve(paquetesDemo));
    renderPantalla();
    await tablaPaquetes();

    fireEvent.click(botonBanda(/Con versión vigente/));
    expect(nombresVisibles()).toEqual(["Demo IVA Responsable Inscripto"]);
    expect(screen.getByRole("button", { name: "Filtro activo · quitar" })).toBeTruthy();

    fireEvent.click(botonBanda(/Con versión vigente/));
    expect(nombresVisibles()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Filtro activo · quitar" })).toBeNull();

    fireEvent.click(botonBanda(/Con borrador/));
    expect(nombresVisibles()).toEqual(["Demo IVA Responsable Inscripto"]);

    fireEvent.click(botonBanda(/En revisión/));
    expect(nombresVisibles()).toEqual(["Demo Régimen de retención"]);

    fireEvent.click(screen.getByRole("button", { name: "Filtro activo · quitar" }));
    expect(nombresVisibles()).toHaveLength(3);
  });

  it("elige el primer paquete al cargar; la fila elegida queda como actual y, al pulsarla de nuevo, sigue elegida", async () => {
    mockApi(() => Promise.resolve(paquetesDemo));
    renderPantalla();
    await tablaPaquetes();
    await waitFor(() => expect(fila("paquete-demo-iva").getAttribute("aria-current")).toBe("true"));

    fireEvent.click(within(fila("paquete-demo-iibb")).getByText("Demo Régimen de retención"));
    expect(fila("paquete-demo-iibb").getAttribute("aria-current")).toBe("true");
    expect(fila("paquete-demo-iva").getAttribute("aria-current")).toBeNull();

    fireEvent.click(within(fila("paquete-demo-iibb")).getByText("Demo Régimen de retención"));
    expect(fila("paquete-demo-iibb").getAttribute("aria-current")).toBe("true");
  });

  it("sin paquetes muestra el estado vacío y no ofrece la búsqueda", async () => {
    mockApi(() => Promise.resolve([]));
    renderPantalla();
    expect(await screen.findByText("Todavía no hay paquetes de reglas")).toBeTruthy();
    expect(screen.getByText("Creá un paquete para definir alícuotas, vencimientos y fuentes normativas.")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: /Buscar paquetes/ })).toBeNull();
    expect(screen.queryByRole("table", { name: "Paquetes de reglas disponibles" })).toBeNull();
  });

  it("mientras carga, muestra «Cargando reglas…» dentro de un role status y todavía no la tabla", async () => {
    mockApi(() => new Promise(() => undefined));
    renderPantalla();
    const texto = await screen.findByText("Cargando reglas…");
    expect(texto.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("table", { name: "Paquetes de reglas disponibles" })).toBeNull();
  });

  it("si la consulta de paquetes falla, hoy muestra «Ningún paquete coincide.» y ninguna fila (7d-1)", async () => {
    mockApi(() => Promise.reject(new ApiError("DEMO_FALLA", "Falla simulada de la lista Demo", 503)));
    renderPantalla();
    expect(await screen.findByText("Ningún paquete coincide.")).toBeTruthy();
    expect(document.querySelectorAll("tr[data-row-key]")).toHaveLength(0);
  });

  it.fails("si la consulta de paquetes falla, muestra un error con Reintentar y no «Ningún paquete coincide.» (7d-1; lo corrige el corte 3.2)", async () => {
    mockApi(() => Promise.reject(new ApiError("DEMO_FALLA", "Falla simulada de la lista Demo", 503)));
    renderPantalla();
    await waitFor(() => expect(screen.queryByText("Cargando reglas…")).toBeNull());
    expect(screen.queryByText("Ningún paquete coincide.")).toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});
