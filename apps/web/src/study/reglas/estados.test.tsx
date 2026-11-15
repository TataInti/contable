// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import {
  demoActivities,
  demoContext,
  demoCredentials,
  demoEngines,
  demoJurisdictions,
  demoKinds,
  demoPackList,
  demoRegimes,
  makeDemoDetail,
  makeDemoVersion,
  mockDemoApi,
  renderDemoReglas,
} from "./datosDemoReglas";

// Foco 3.2a: estados y errores de Reglas fiscales (R03; D-R3-3 y D-R3-9).
// Cada prueba cubre un punto de la sección 7d del informe: el estado antes de responder,
// con error y con vacío. Las que fijan un comportamiento que todavía no existe van con
// it.fails; el bloque que lo corrige las pasa a aserción normal. Datos sintéticos «Demo».

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
const DETALLE = "/tax/rule-packs/pack-1";
const TIPOS = "/tax/regimes/regime-1/rule-kinds";
const MOTORES = "/tax/regimes/regime-1/engines";
const ACTIVIDADES = "/tax/activities?includeInactive=true";
const JURISDICCIONES = "/tax/jurisdictions?includeInactive=true";
const MATRICULAS = "/tax/credentials";
const REGIMENES = "/tax/regimes";

function errorDemo() {
  return new ApiError("DEMO_FALLA", "Falla simulada de consulta Demo", 503);
}

// Falla la primera consulta y responde en las siguientes (para probar Reintentar).
function fallaUnaVez<T>(respuesta: () => T) {
  let llamadas = 0;
  return () => {
    llamadas += 1;
    return llamadas === 1 ? Promise.reject(errorDemo()) : Promise.resolve(respuesta());
  };
}

// La consulta queda cargando: nunca responde.
function sinRespuesta() {
  return new Promise<never>(() => undefined);
}

function llamadasA(ruta: string) {
  return vi.mocked(api.get).mock.calls.filter(([path]) => path === ruta).length;
}

function tablaPaquetes() {
  return screen.findByRole("table", { name: "Paquetes de reglas disponibles" });
}

async function seccion(titulo: string): Promise<HTMLElement> {
  const encabezado = await screen.findByRole("heading", { name: titulo });
  return encabezado.closest("section") as HTMLElement;
}

function pestana(nombre: RegExp) {
  return screen.findByRole("tab", { name: nombre });
}

function conCapacidades(...capacidades: string[]) {
  contextMock.current = demoContext(capacidades);
}

function conVersionEnRevision() {
  const detail = makeDemoDetail();
  detail.versions = [makeDemoVersion({ id: "version-review", version: 2, status: "IN_REVIEW" })];
  return detail;
}

describe("Reglas fiscales — estados de la lista y de la banda (7d-1, 7d-4, 7d-10, D-R3-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("antes de responder, la banda dice «pendiente» y no cero (7d-4, C03)", async () => {
    mockDemoApi(makeDemoDetail(), { [LISTA]: sinRespuesta });
    renderDemoReglas();
    const banda = await screen.findByRole("group", { name: "Resumen de paquetes de reglas" });
    expect(within(banda).getAllByText("pendiente")).toHaveLength(4);
    expect(within(banda).queryByText("0")).toBeNull();
  });

  it("con la lista en error, la banda dice «no disponible» y no cero (7d-4, C03)", async () => {
    mockDemoApi(makeDemoDetail(), { [LISTA]: () => Promise.reject(errorDemo()) });
    renderDemoReglas();
    const banda = await screen.findByRole("group", { name: "Resumen de paquetes de reglas" });
    await waitFor(() => expect(within(banda).getAllByText("no disponible")).toHaveLength(4));
    expect(within(banda).queryByText("0")).toBeNull();
  });

  it("mientras carga, la lista se anuncia con role=status y todavía no muestra la tabla (C07)", async () => {
    mockDemoApi(makeDemoDetail(), { [LISTA]: sinRespuesta });
    renderDemoReglas();
    const texto = await screen.findByText("Cargando reglas…");
    expect(texto.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("table", { name: "Paquetes de reglas disponibles" })).toBeNull();
  });

  it("si falla la lista, muestra «No se pudo cargar la lista de paquetes» con Reintentar y no «Ningún paquete coincide» (7d-1)", async () => {
    mockDemoApi(makeDemoDetail(), { [LISTA]: () => Promise.reject(errorDemo()) });
    renderDemoReglas();
    expect(await screen.findByText("No se pudo cargar la lista de paquetes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByText(/Ningún paquete coincide/)).toBeNull();
    expect(document.querySelectorAll("tr[data-row-key]")).toHaveLength(0);
  });

  it("el error de la lista se anuncia con role=alert (C08)", async () => {
    mockDemoApi(makeDemoDetail(), { [LISTA]: () => Promise.reject(errorDemo()) });
    renderDemoReglas();
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("No se pudo cargar la lista de paquetes");
  });

  it("Reintentar de la lista vuelve a consultar /tax/rule-packs y muestra la tabla (7d-1)", async () => {
    const detail = makeDemoDetail();
    mockDemoApi(detail, { [LISTA]: fallaUnaVez(() => demoPackList(detail)) });
    renderDemoReglas();
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await tablaPaquetes()).toBeTruthy();
    expect(llamadasA(LISTA)).toBe(2);
  });

  it("sin coincidencias, «Ningún paquete coincide» ofrece Quitar filtros y lo limpia (D-R3-9)", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await tablaPaquetes();
    fireEvent.change(screen.getByRole("searchbox", { name: /Buscar paquetes/ }), {
      target: { value: "zzz-sin-coincidencias" },
    });
    expect(await screen.findByText("Ningún paquete coincide")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(await tablaPaquetes()).toBeTruthy();
    expect(
      (screen.getByRole("searchbox", { name: /Buscar paquetes/ }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("con paquetes cargados, «Todavía no hay paquetes de reglas» no aparece (7d-10)", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await tablaPaquetes();
    expect(screen.queryByText("Todavía no hay paquetes de reglas")).toBeNull();
  });
});

describe("Reglas fiscales — estados del detalle del paquete (7d-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mientras carga el detalle, se anuncia con role=status (C07)", async () => {
    mockDemoApi(makeDemoDetail(), { [DETALLE]: sinRespuesta });
    renderDemoReglas();
    const texto = await screen.findByText("Cargando detalle de reglas…");
    expect(texto.closest('[role="status"]')).not.toBeNull();
  });

  it("si el detalle falla, muestra el error con descripción y Reintentar, que vuelve a consultar el paquete (7d-2)", async () => {
    const detail = makeDemoDetail();
    mockDemoApi(detail, { [DETALLE]: fallaUnaVez(() => detail) });
    renderDemoReglas();
    expect(await screen.findByText("No se pudo cargar el paquete de reglas")).toBeTruthy();
    expect(screen.getByText(/Reintentá la consulta/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", { name: "Demo · IVA Responsable Inscripto" }),
    ).toBeTruthy();
    expect(llamadasA(DETALLE)).toBe(2);
  });
});

describe("Reglas fiscales — catálogos con error (7d-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("si falla la consulta de tipos de regla, la columna dice que no se pudo cargar y ofrece Reintentar", async () => {
    mockDemoApi(makeDemoDetail(), { [TIPOS]: fallaUnaVez(() => demoKinds) });
    renderDemoReglas();
    expect(await screen.findByText("No se pudieron cargar los tipos de regla")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Tipo de regla de la fila 1")).toBeTruthy();
    expect(llamadasA(TIPOS)).toBe(2);
  });

  it("si falla la consulta de actividades, la columna sigue visible y dice que no se pudo cargar", async () => {
    mockDemoApi(makeDemoDetail(), { [ACTIVIDADES]: fallaUnaVez(() => demoActivities) });
    renderDemoReglas();
    expect(await screen.findByText("No se pudieron cargar las actividades")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Actividad" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Actividad de la fila 1")).toBeTruthy();
    expect(llamadasA(ACTIVIDADES)).toBe(2);
  });

  it("si falla la consulta de jurisdicciones, la columna dice que no se pudo cargar y ofrece Reintentar", async () => {
    const porJurisdiccion = [
      {
        id: "kind-activity",
        key: "RATE",
        label: "Alícuota por jurisdicción",
        subject: "JURISDICTION",
      },
    ];
    mockDemoApi(makeDemoDetail(), {
      [TIPOS]: () => Promise.resolve(porJurisdiccion),
      [JURISDICCIONES]: fallaUnaVez(() => demoJurisdictions),
    });
    renderDemoReglas();
    expect(await screen.findByText("No se pudieron cargar las jurisdicciones")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Jurisdicción de la fila 1")).toBeTruthy();
    expect(llamadasA(JURISDICCIONES)).toBe(2);
  });

  it("si falla la consulta de matrículas, el control profesional dice que no se pudo cargar y ofrece Reintentar", async () => {
    conCapacidades("tax.rules.read", "tax.rules.propose", "tax.rules.approve");
    mockDemoApi(conVersionEnRevision(), { [MATRICULAS]: fallaUnaVez(() => demoCredentials) });
    renderDemoReglas();
    fireEvent.click(await pestana(/Control profesional/));
    expect(await screen.findByText("No se pudieron cargar las matrículas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Matrícula para aprobar")).toBeTruthy();
    expect(llamadasA(MATRICULAS)).toBe(2);
  });
});

describe("Reglas fiscales — errores de acción junto a su botón, sin error al pie (7d-5, 7d-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.fails(
    "un error de guardar el borrador aparece junto a «Guardar borrador», no al pie (7d-7)",
    async () => {
      mockDemoApi(makeDemoDetail());
      vi.mocked(api.put).mockRejectedValue(new Error("Error de guardado Demo"));
      renderDemoReglas();
      fireEvent.change(await screen.findByLabelText("Concepto de la fila 1"), {
        target: { value: "Cambio Demo" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
      const alicuotas = await seccion("Alícuotas y porcentajes");
      expect(await within(alicuotas).findByText("Error de guardado Demo")).toBeTruthy();
      expect(
        document.querySelector(".fiscal-rules > .form-error, .fiscal-rules > [role='alert']"),
      ).toBeNull();
    },
  );

  it.fails("un error de activar aparece una sola vez, junto al resumen (7d-5)", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockRejectedValue(new Error("Error de activación Demo"));
    renderDemoReglas();
    fireEvent.click(await screen.findByRole("button", { name: /^Activar$/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Activar versión" }),
    );
    await waitFor(() => expect(screen.getByText("Error de activación Demo")).toBeTruthy());
    expect(screen.getAllByText("Error de activación Demo")).toHaveLength(1);
  });

  it.fails(
    "un error de crear la primera versión aparece dentro del cajón, una sola vez (7d-5)",
    async () => {
      mockDemoApi({ ...makeDemoDetail(), versions: [] });
      vi.mocked(api.post).mockRejectedValue(new Error("Error de versión Demo"));
      renderDemoReglas();
      fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
      const dialog = await screen.findByRole("dialog");
      const enviar = (await within(dialog).findByRole("button", {
        name: "Crear primera versión",
      })) as HTMLButtonElement;
      await waitFor(() => expect(enviar.disabled).toBe(false));
      fireEvent.click(enviar);
      expect(await within(dialog).findByText("Error de versión Demo")).toBeTruthy();
      expect(screen.getAllByText("Error de versión Demo")).toHaveLength(1);
    },
  );

  it.fails(
    "un error de crear el paquete aparece dentro del cajón «Nuevo paquete de reglas» (7d-5)",
    async () => {
      mockDemoApi(makeDemoDetail(), { [REGIMENES]: () => Promise.resolve(demoRegimes) });
      vi.mocked(api.post).mockRejectedValue(new Error("Error de paquete Demo"));
      renderDemoReglas();
      fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Código"), {
        target: { value: "DEMO-NUEVO" },
      });
      fireEvent.change(within(dialog).getByLabelText("Nombre"), {
        target: { value: "Demo nuevo" },
      });
      fireEvent.change(within(dialog).getByLabelText("Régimen"), { target: { value: "regime-1" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Crear paquete" }));
      expect(await within(dialog).findByText("Error de paquete Demo")).toBeTruthy();
    },
  );

  it.fails(
    "un error de agregar el vencimiento aparece dentro del cajón, junto a «Guardar vencimiento» (7d-5)",
    async () => {
      mockDemoApi(makeDemoDetail());
      vi.mocked(api.post).mockRejectedValue(new Error("Error de vencimiento Demo"));
      renderDemoReglas();
      fireEvent.click(await pestana(/Vencimientos/));
      fireEvent.click(await screen.findByRole("button", { name: "Agregar vencimiento" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Día del mes"), { target: { value: "20" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar vencimiento" }));
      expect(await within(dialog).findByText("Error de vencimiento Demo")).toBeTruthy();
    },
  );

  it.fails(
    "un error de agregar la fuente aparece dentro del cajón, junto a «Guardar fuente» (7d-5)",
    async () => {
      mockDemoApi(makeDemoDetail());
      vi.mocked(api.post).mockRejectedValue(new Error("Error de fuente Demo"));
      renderDemoReglas();
      fireEvent.click(await pestana(/Fuentes/));
      fireEvent.click(await screen.findByRole("button", { name: "Agregar fuente" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Título"), {
        target: { value: "Fuente Demo" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar fuente" }));
      expect(await within(dialog).findByText("Error de fuente Demo")).toBeTruthy();
    },
  );

  it.fails(
    "un error de enviar a revisión aparece en Control profesional, junto a su botón (7d-5)",
    async () => {
      mockDemoApi(makeDemoDetail());
      vi.mocked(api.post).mockRejectedValue(new Error("Error de revisión Demo"));
      renderDemoReglas();
      fireEvent.click(await pestana(/Control profesional/));
      fireEvent.click(
        await screen.findByRole("button", { name: "Enviar a revisión (flujo anterior)" }),
      );
      const panel = await seccion("Flujo de revisión anterior");
      expect(await within(panel).findByText("Error de revisión Demo")).toBeTruthy();
    },
  );

  it.fails("un error de aprobar aparece junto a «Aprobar» (7d-5)", async () => {
    conCapacidades("tax.rules.read", "tax.rules.propose", "tax.rules.approve");
    mockDemoApi(conVersionEnRevision(), { [MATRICULAS]: () => Promise.resolve(demoCredentials) });
    vi.mocked(api.post).mockRejectedValue(new Error("Error de aprobación Demo"));
    renderDemoReglas();
    fireEvent.click(await pestana(/Control profesional/));
    fireEvent.change(await screen.findByLabelText("Matrícula para aprobar"), {
      target: { value: "cred-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    const panel = await seccion("Flujo de revisión anterior");
    expect(await within(panel).findByText("Error de aprobación Demo")).toBeTruthy();
  });

  it.fails(
    "un error de «Modificar alícuotas» aparece una sola vez, dentro del cajón (7d-5)",
    async () => {
      const detail = makeDemoDetail();
      detail.versions = [makeDemoVersion({ id: "version-active", version: 4, status: "ACTIVE" })];
      mockDemoApi(detail);
      vi.mocked(api.post).mockRejectedValue(new Error("Error de clon Demo"));
      renderDemoReglas();
      const alicuotas = await seccion("Alícuotas y porcentajes");
      fireEvent.click(within(alicuotas).getByRole("button", { name: "Modificar alícuotas" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Crear borrador y editar" }));
      expect(await within(dialog).findByText("Error de clon Demo")).toBeTruthy();
      expect(screen.getAllByText("Error de clon Demo")).toHaveLength(1);
    },
  );
});

describe("Reglas fiscales — bloqueos que dicen el motivo (P1, 7d-9, 7d-11, 7d-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.fails("«Guardar vencimiento» deshabilitado dice el motivo al lado (7d-11)", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    fireEvent.click(await pestana(/Vencimientos/));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar vencimiento" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      (within(dialog).getByRole("button", { name: "Guardar vencimiento" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(dialog).getByText(/Ingresá un día del mes entre 1 y 31/)).toBeTruthy();
  });

  it.fails("«Guardar fuente» deshabilitado dice el motivo al lado (7d-11)", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    fireEvent.click(await pestana(/Fuentes/));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar fuente" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      (within(dialog).getByRole("button", { name: "Guardar fuente" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(dialog).getByText(/Ingresá el título de la fuente/)).toBeTruthy();
  });

  it.fails(
    "«Crear primera versión» sin opciones de cálculo enlaza a Editar régimen y dice por qué (7d-9, 7d-11)",
    async () => {
      mockDemoApi({ ...makeDemoDetail(), versions: [] }, { [MOTORES]: () => Promise.resolve([]) });
      renderDemoReglas();
      fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByRole("link", { name: "Editar régimen" }).getAttribute("href"),
      ).toBe("/catalogos-fiscales?editRegime=regime-1");
      expect(
        within(dialog).getByText(/Sin opciones de cálculo no se puede crear la versión/),
      ).toBeTruthy();
    },
  );

  it.fails(
    "la versión en revisión sin permiso de aprobar dice por qué no hay acción (7d-9)",
    async () => {
      mockDemoApi(conVersionEnRevision());
      renderDemoReglas();
      fireEvent.click(await pestana(/Control profesional/));
      expect(await screen.findByText(/Solo quien tiene permiso para aprobar/)).toBeTruthy();
    },
  );

  it.fails(
    "sin matrículas cargadas, Control profesional dice qué falta y quién lo administra (7d-9)",
    async () => {
      conCapacidades("tax.rules.read", "tax.rules.propose", "tax.rules.approve");
      mockDemoApi(conVersionEnRevision());
      renderDemoReglas();
      fireEvent.click(await pestana(/Control profesional/));
      expect(await screen.findByText(/No hay matrículas profesionales cargadas/)).toBeTruthy();
    },
  );

  it.fails("un borrador de solo lectura sin permiso de proponer lo dice (7d-12)", async () => {
    conCapacidades("tax.rules.read");
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    expect(await screen.findByText(/Este borrador es de solo lectura/)).toBeTruthy();
  });
});

describe("Reglas fiscales — accesibilidad mínima de los estados (C07, C08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("la pantalla tiene un solo h1", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await tablaPaquetes();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("un error de opciones de cálculo ofrece Reintentar, que vuelve a consultar el régimen (7d-3)", async () => {
    mockDemoApi(
      { ...makeDemoDetail(), versions: [] },
      { [MOTORES]: fallaUnaVez(() => demoEngines) },
    );
    renderDemoReglas();
    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/No pudimos cargar las opciones de cálculo/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    expect(await within(dialog).findByLabelText("Opción de cálculo")).toBeTruthy();
    expect(llamadasA(MOTORES)).toBe(2);
  });
});
