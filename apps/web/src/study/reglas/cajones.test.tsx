// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import {
  demoContext,
  demoEngines,
  demoRegimes,
  makeDemoDetail,
  makeDemoVersion,
  mockDemoApi,
  renderDemoReglas,
} from "./datosDemoReglas";
import { abrirListado, cambiarValor, valorElegido } from "../../test/elegirOpcion";

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

describe("Reglas fiscales — cajón Nuevo paquete (K4)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("espera código, nombre y régimen; envía el código en mayúsculas y nombre y régimen recortados", async () => {
    const nuevo = { ...makeDemoDetail(), id: "pack-nuevo", versions: [] };
    mockDemoApi(makeDemoDetail(), {
      "/tax/regimes": () => Promise.resolve(demoRegimes),
      "/tax/rule-packs/pack-nuevo": () => Promise.resolve(nuevo),
    });
    vi.mocked(api.post).mockResolvedValue({ id: "pack-nuevo" } as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Crear paquete" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(within(dialog).getByText(/Completá código, nombre y régimen/)).toBeTruthy();

    cambiarValor(within(dialog).getByLabelText("Código"), "  demo-ri ");
    cambiarValor(within(dialog).getByLabelText("Nombre"), "  Demo · Paquete de prueba  ");
    expect(submit.disabled).toBe(true);
    cambiarValor(within(dialog).getByLabelText("Régimen"), "regime-1");
    expect(submit.disabled).toBe(false);
    expect(within(dialog).queryByText(/Completá código, nombre y régimen/)).toBeNull();

    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-packs", {
        code: "DEMO-RI",
        name: "Demo · Paquete de prueba",
        regimeId: "regime-1",
      }),
    );
    expect(await screen.findByText("El paquete quedó creado. Ahora podés iniciar su primera versión.")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/tax/rule-packs/pack-nuevo");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("error al consultar regímenes muestra Reintentar y lo separa del estado vacío", async () => {
    mockDemoApi(makeDemoDetail());
    const originalGet = vi.mocked(api.get).getMockImplementation();
    let lecturas = 0;
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path === "/tax/regimes") {
        lecturas += 1;
        return lecturas === 1
          ? Promise.reject(new Error("Error sintético de consulta"))
          : Promise.resolve(demoRegimes);
      }
      return originalGet?.(path) ?? Promise.resolve([]);
    }) as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/No pudimos consultar los regímenes/)).toBeTruthy();
    expect(within(dialog).queryByText(/Todavía no hay regímenes/)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(within(abrirListado("Régimen", dialog)).getByRole("option", { name: "Demo Responsable Inscripto · IVA · Demo Nación" })).toBeTruthy());
    expect(lecturas).toBe(2);
  });

  it("sin regímenes enlaza a Catálogos fiscales", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Todavía no hay regímenes/)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Catálogos fiscales" }).getAttribute("href")).toBe(
      "/catalogos-fiscales",
    );
  });
});

describe("Reglas fiscales — cajones de versión (K5)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("valida la vigencia de la primera versión antes de enviarla", async () => {
    mockDemoApi({ ...makeDemoDetail(), versions: [] });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    const date = within(dialog).getByLabelText("Vigencia desde") as HTMLInputElement;
    cambiarValor(date, "1800-01-01");
    fireEvent.submit(date.closest("form")!);

    expect(await within(dialog).findByText("El año debe estar entre 1900 y 2100.")).toBeTruthy();
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sin familia de cálculo guía a Editar régimen y no ofrece selector", async () => {
    const base = makeDemoDetail();
    mockDemoApi({ ...base, versions: [], regime: { ...base.regime, calcFamilyId: null } });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Elegí una familia de cálculo")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Editar régimen" }).getAttribute("href")).toBe(
      "/catalogos-fiscales?editRegime=regime-1",
    );
    expect(within(dialog).queryByLabelText("Opción de cálculo")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Crear primera versión" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("mientras carga los motores muestra el estado y no permite enviar", async () => {
    mockDemoApi({ ...makeDemoDetail(), versions: [] }, {
      "/tax/regimes/regime-1/engines": () => new Promise(() => undefined),
    });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    const estado = await within(dialog).findByText("Buscando opciones de cálculo…");
    expect(estado.getAttribute("role")).toBe("status");
    expect((within(dialog).getByRole("button", { name: "Crear primera versión" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("error al consultar motores muestra Reintentar y vuelve a consultar", async () => {
    let lecturas = 0;
    mockDemoApi({ ...makeDemoDetail(), versions: [] }, {
      "/tax/regimes/regime-1/engines": () => {
        lecturas += 1;
        return lecturas === 1
          ? Promise.reject(new Error("Error sintético de motores"))
          : Promise.resolve(demoEngines);
      },
    });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/No pudimos cargar las opciones de cálculo/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    expect(await within(dialog).findByLabelText("Opción de cálculo")).toBeTruthy();
    expect(lecturas).toBe(2);
  });

  it("familia sin opciones muestra el vacío y no permite enviar", async () => {
    mockDemoApi({ ...makeDemoDetail(), versions: [] }, {
      "/tax/regimes/regime-1/engines": () => Promise.resolve([]),
    });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Esta familia aún no tiene opciones de cálculo")).toBeTruthy();
    expect(within(dialog).getByText(/Elegí otra familia para este régimen/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Crear primera versión" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("crear la primera versión envía vigencia, motor elegido y hash pendiente", async () => {
    mockDemoApi({ ...makeDemoDetail(), versions: [] });
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByLabelText("Opción de cálculo");
    expect(valorElegido("Opción de cálculo", dialog)).toBe("engine-demo-current");
    cambiarValor(select, "engine-demo-legacy");
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear primera versión" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-packs/pack-1/versions", {
        validFrom: expect.any(String),
        engineId: "engine-demo-legacy",
        rulesHash: "PENDING_DRAFT",
      }),
    );
    expect(await screen.findByText("La primera versión quedó abierta como borrador.")).toBeTruthy();
  });

  it("Crear a partir de este envía la nueva vigencia y muestra el rechazo dentro del cajón", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ id: "version-1", status: "ACTIVE" })];
    mockDemoApi(detail);
    vi.mocked(api.post).mockRejectedValue(
      new ApiError("RULE_VERSION_INVALID", "No se pudo crear el borrador demo.", 409),
    );
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear a partir de este" }));
    const dialog = await screen.findByRole("dialog");
    const date = within(dialog).getByLabelText("Nueva vigencia desde") as HTMLInputElement;
    cambiarValor(date, "2027-03-01");
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear borrador y editar" }));

    expect(await within(dialog).findByText("No se pudo crear el borrador demo.")).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith("/tax/rule-packs/pack-1/versions/clone", { validFrom: "2027-03-01" });
  });
});

describe("Reglas fiscales — pie de los cajones (Foco 2.7a)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Pie fijo del cajón: «Cancelar» a la izquierda, la acción principal a la derecha y el motivo junto a ella.
  function expectPieDelCajon(dialog: HTMLElement, principal: string, motivo: RegExp | null) {
    const footer = dialog.querySelector<HTMLElement>(".action-drawer__footer");
    expect(footer).not.toBeNull();
    const cancelar = within(footer!).getByRole("button", { name: "Cancelar" });
    const accion = within(footer!).getByRole("button", { name: principal });
    expect(cancelar.compareDocumentPosition(accion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog.querySelector(".action-drawer__content")?.contains(accion)).toBe(false);
    if (motivo) {
      expect(within(footer!).getByText(motivo).parentElement).toBe(accion.parentElement);
    }
  }

  it("Nuevo paquete: pie fijo con Cancelar a la izquierda y el motivo junto a «Crear paquete»", async () => {
    mockDemoApi(makeDemoDetail(), { "/tax/regimes": () => Promise.resolve(demoRegimes) });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    const dialog = await screen.findByRole("dialog");
    expectPieDelCajon(dialog, "Crear paquete", /Completá código, nombre y régimen/);

    cambiarValor(within(dialog).getByLabelText("Código"), "DEMO");
    cambiarValor(within(dialog).getByLabelText("Nombre"), "Demo");
    cambiarValor(within(dialog).getByLabelText("Régimen"), "regime-1");
    expectPieDelCajon(dialog, "Crear paquete", null);
    expect(within(dialog).queryByText(/Completá código, nombre y régimen/)).toBeNull();
  });

  it("Agregar vencimiento y Agregar fuente llevan «Cancelar» y su motivo junto al botón", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /Vencimientos/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar vencimiento" }));
    let dialog = await screen.findByRole("dialog");
    expectPieDelCajon(dialog, "Guardar vencimiento", /Ingresá un día del mes entre 1 y 31/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar fuente" }));
    dialog = await screen.findByRole("dialog");
    expectPieDelCajon(dialog, "Guardar fuente", /Ingresá el título de la fuente/);
  });

  it("Crear primera versión sin familia: el aviso va arriba a todo el ancho y «Vigencia desde» debajo", async () => {
    const base = makeDemoDetail();
    mockDemoApi({ ...base, versions: [], regime: { ...base.regime, calcFamilyId: null } });
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const dialog = await screen.findByRole("dialog");
    const aviso = await within(dialog).findByText("Elegí una familia de cálculo");
    const vigencia = within(dialog).getByLabelText("Vigencia desde");
    expect(aviso.compareDocumentPosition(vigencia) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aviso.closest(".selector-motor-aviso")).not.toBeNull();
    expectPieDelCajon(dialog, "Crear primera versión", /Asigná una familia de cálculo/);
  });

  it("Crear a partir de este: la ayuda de la vigencia va en la columna de su campo", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ id: "version-1", status: "ACTIVE" })];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear a partir de este" }));
    const dialog = await screen.findByRole("dialog");
    const fecha = within(dialog).getByLabelText("Nueva vigencia desde");
    const columna = fecha.closest<HTMLElement>(".study-form__campo");
    expect(columna).not.toBeNull();
    expect(within(columna!).getByText(/La versión vigente no se modifica/)).toBeTruthy();
  });

  it("Crear a partir de este: «Cancelar» a la izquierda y la acción principal a la derecha", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ id: "version-1", status: "ACTIVE" })];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear a partir de este" }));
    const dialog = await screen.findByRole("dialog");
    expectPieDelCajon(dialog, "Crear borrador y editar", null);
  });
});

describe("Reglas fiscales — opción de cálculo al copiar (Foco 2.7a)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("preselecciona la opción de origen sin rótulo y, al elegir otra, dice con qué calcula la nueva versión", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ id: "version-1", status: "ACTIVE" })];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear a partir de este" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText("Opción de cálculo");
    expect(valorElegido("Opción de cálculo", dialog)).toBe("engine-demo-current");
    expect(within(abrirListado("Opción de cálculo", dialog)).getByRole("option", { name: "Demo · IVA RI vigente" })).toBeTruthy();
    for (const option of within(abrirListado("Opción de cálculo", dialog)).getAllByRole("option")) {
      expect(option.textContent).not.toContain("(actual)");
    }
    expect(within(dialog).queryByText(/La nueva versión va a calcular con/)).toBeNull();

    cambiarValor(within(dialog).getByLabelText("Opción de cálculo"), "engine-demo-legacy");
    const consecuencia = within(dialog).getByText(
      "La nueva versión va a calcular con Demo · IVA RI anterior en lugar de Demo · IVA RI vigente.",
    );
    expect(consecuencia).toBeTruthy();
    expect(consecuencia.classList.contains("selector-motor-consecuencia")).toBe(true);
  });
});
