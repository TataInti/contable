// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import {
  demoContext,
  demoCredentials,
  makeDemoDetail,
  makeDemoVersion,
  mockDemoApi,
  renderDemoReglas,
} from "./datosDemoReglas";
import type { RuleVersion } from "./tipos";

// Foco 3.2b: composición de Reglas fiscales (R03; D-R3-1, D-R3-2, D-R3-5, D-R3-6, D-R3-7 y D-R3-8).
// Datos sintéticos «Demo». Lo que el corte cambia va con it.fails y pasa a aserción normal cuando
// el bloque que lo implementa lo corrige. Lo que ya se cumple queda como aserción de regresión.

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

const LISTA = "/tax/rule-packs";
const CREDENCIALES = "/tax/credentials";
const NOMBRE_PAQUETE = "Demo · IVA Responsable Inscripto";
const CAPACIDADES_EDITOR = ["tax.rules.read", "tax.rules.propose", "data.delete"];

// Botones con variante primaria visibles en la pantalla, en orden de aparición.
function primarios(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ds-button--primary")).map(
    (boton) => boton.textContent?.trim() ?? "",
  );
}

function esPrimario(nombre: string): boolean {
  return screen.getByRole("button", { name: nombre }).classList.contains("ds-button--primary");
}

// Sección del resumen: la que contiene el título del paquete.
async function resumen(): Promise<HTMLElement> {
  const encabezado = await screen.findByRole("heading", { level: 2, name: NOMBRE_PAQUETE });
  return encabezado.closest("section") as HTMLElement;
}

async function pestana(nombre: RegExp) {
  return screen.findByRole("tab", { name: nombre });
}

// Cambia la primera alícuota del borrador: deja la versión con cambios sin guardar.
async function cambiarAlicuota() {
  await screen.findByRole("heading", { name: "Alícuotas y porcentajes" });
  const alicuota = document.querySelector<HTMLInputElement>('input[aria-label^="Alícuota"]');
  if (!alicuota) throw new Error("No hay campo de alícuota en el editor");
  fireEvent.change(alicuota, { target: { value: "10" } });
}

function paqueteConVersiones(...versiones: Partial<RuleVersion>[]) {
  const detalle = makeDemoDetail();
  detalle.versions = versiones.map((overrides) => makeDemoVersion(overrides));
  return detalle;
}

describe("una sola acción primaria visible por estado (D-R3-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext(CAPACIDADES_EDITOR);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sin paquetes, la primaria es «Crear paquete»", async () => {
    mockDemoApi(makeDemoDetail(), { [LISTA]: () => Promise.resolve([]) });
    renderDemoReglas();
    await screen.findByText("Todavía no hay paquetes de reglas");
    expect(primarios()).toEqual(["Crear paquete"]);
  });

  it("paquete sin versión: la primaria es «Crear primera versión»", async () => {
    mockDemoApi(paqueteConVersiones());
    renderDemoReglas();
    await screen.findByText("Este paquete todavía no tiene versión");
    expect(primarios()).toEqual(["Crear primera versión"]);
  });

  it.fails("borrador sin cambios: la primaria es «Activar»", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(primarios()).toEqual(["Activar"]);
  });

  it.fails("borrador con cambios: la primaria es «Guardar borrador»", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    await cambiarAlicuota();
    expect(primarios()).toEqual(["Guardar borrador"]);
  });

  it.fails(
    "versión vigente: a lo sumo una primaria, y «Modificar alícuotas» no es primaria",
    async () => {
      mockDemoApi(paqueteConVersiones({ id: "version-vigente", version: 4, status: "ACTIVE" }));
      renderDemoReglas();
      await resumen();
      expect(primarios().length).toBeLessThanOrEqual(1);
      expect(esPrimario("Modificar alícuotas")).toBe(false);
    },
  );

  it.fails("versión en revisión: la primaria es «Activar»", async () => {
    mockDemoApi(paqueteConVersiones({ id: "version-revision", version: 2, status: "IN_REVIEW" }));
    renderDemoReglas();
    await resumen();
    expect(primarios()).toEqual(["Activar"]);
  });

  it.fails("«Guardar borrador» es secundaria si no hay cambios sin guardar", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(esPrimario("Guardar borrador")).toBe(false);
  });

  it.fails("«Nuevo paquete» y «Agregar regla» son secundarias", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(esPrimario("Nuevo paquete")).toBe(false);
    expect(esPrimario("Agregar regla")).toBe(false);
  });

  it.fails("«Probar» no es primaria en la pestaña Probar", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    fireEvent.click(await pestana(/^Probar/));
    expect(esPrimario("Probar")).toBe(false);
  });

  it.fails("«Aprobar» no es primaria en Control profesional", async () => {
    mockDemoApi(paqueteConVersiones({ id: "version-revision", version: 2, status: "IN_REVIEW" }), {
      [CREDENCIALES]: () => Promise.resolve(demoCredentials),
    });
    contextMock.current = demoContext([...CAPACIDADES_EDITOR, "tax.rules.approve"]);
    renderDemoReglas();
    await resumen();
    fireEvent.click(await pestana(/^Control profesional/));
    expect(esPrimario("Aprobar")).toBe(false);
  });
});

describe("«Eliminar paquete» y estado de la versión, una sola vez (D-R3-5, D-R3-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext(CAPACIDADES_EDITOR);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("con versión, «Eliminar paquete» aparece una sola vez", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(screen.getAllByRole("button", { name: "Eliminar paquete" })).toHaveLength(1);
  });

  it("sin versión, «Eliminar paquete» aparece una sola vez", async () => {
    mockDemoApi(paqueteConVersiones());
    renderDemoReglas();
    await screen.findByText("Este paquete todavía no tiene versión");
    expect(screen.getAllByRole("button", { name: "Eliminar paquete" })).toHaveLength(1);
  });

  it("el estado de la versión aparece una sola vez en el resumen", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    const seccion = await resumen();
    expect(seccion.querySelectorAll('[data-status="DRAFT"]')).toHaveLength(1);
  });

  it.fails("el resumen no repite el estado en texto («Editando borrador»)", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    const seccion = await resumen();
    expect(within(seccion).queryByText(/Editando borrador/)).toBeNull();
  });

  it.fails("el selector de versiones muestra solo número y vigencia", async () => {
    mockDemoApi(
      paqueteConVersiones(
        { id: "version-2", version: 2, status: "DRAFT" },
        { id: "version-1", version: 1, status: "ACTIVE", validFrom: "2025-01-01" },
      ),
    );
    renderDemoReglas();
    await resumen();
    const selector = screen.getByRole("combobox", { name: "Versión del paquete" });
    for (const opcion of Array.from(selector.querySelectorAll("option"))) {
      expect(opcion.textContent ?? "").not.toMatch(/Borrador|Vigente|Activa|En revisión/);
    }
  });

  it.fails("el régimen aparece una sola vez en el resumen", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    const seccion = await resumen();
    expect(within(seccion).getAllByText(/Demo Responsable Inscripto/)).toHaveLength(1);
  });
});

describe("filtros de la banda, región del detalle y un solo h1 (G02, D-R3-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext(CAPACIDADES_EDITOR);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("los filtros de la banda exponen aria-pressed y lo alternan", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(screen.getByRole("button", { name: /Con borrador/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: /Con borrador/ }));
    expect(screen.getByRole("button", { name: /Con borrador/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it.fails("el detalle es una región con nombre", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(screen.getByRole("region", { name: "Detalle del paquete de reglas" })).toBeTruthy();
  });

  it("la pantalla tiene un solo h1", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });
});

describe("composición sin cajas en lectura, y caja en el editor (D-R3-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext(CAPACIDADES_EDITOR);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.fails("el resumen no va en caja", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    const seccion = await resumen();
    expect(seccion.classList.contains("study-panel")).toBe(false);
  });

  it.fails("la sección Vencimientos no va en caja", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    fireEvent.click(await pestana(/^Vencimientos/));
    const titulo = await screen.findByRole("heading", { name: "Vencimientos" });
    expect(titulo.closest("section")?.classList.contains("study-panel")).toBe(false);
  });

  it.fails("la sección Fuentes no va en caja", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    fireEvent.click(await pestana(/^Fuentes/));
    const titulo = await screen.findByRole("heading", { name: "Fuentes normativas" });
    expect(titulo.closest("section")?.classList.contains("study-panel")).toBe(false);
  });

  it("el editor de alícuotas conserva su caja", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    const titulo = await screen.findByRole("heading", { name: "Alícuotas y porcentajes" });
    expect(titulo.closest("section")?.classList.contains("study-panel")).toBe(true);
  });
});

describe("aviso de cambios sin guardar y nombres de las acciones (P1, P4, conteo antes y después)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext(CAPACIDADES_EDITOR);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.fails(
    "el aviso «Guardá los cambios…» se ve con cambios sin guardar, sin pulsar Activar",
    async () => {
      mockDemoApi(makeDemoDetail());
      renderDemoReglas();
      await resumen();
      await cambiarAlicuota();
      expect(screen.getByText(/Guardá los cambios del borrador/)).toBeTruthy();
    },
  );

  it("un borrador conserva sus acciones con el mismo nombre", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await resumen();
    const nombres = [
      "Nuevo paquete",
      "Editar borrador v1",
      "Activar",
      "Guardar borrador",
      "Eliminar borrador v1",
      "Eliminar paquete",
      "Agregar regla",
      "Quitar",
    ];
    for (const nombre of nombres) {
      expect(screen.getByRole("button", { name: nombre })).toBeTruthy();
    }
  });
});
