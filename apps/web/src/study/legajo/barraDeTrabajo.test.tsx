// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Barra de trabajo del Legajo (corte Barra 2a): renglones por estado, un solo h1, primarias,
// estados de la página y errores con «Reintentar». Datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  legajoDemo,
  periodoIibbDemo,
  rutasDemo,
} from "./datosDemoLegajo";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
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

const TODAS = [
  "client.read",
  "tax.settlements.calculate",
  "tax.settlements.submit_review",
  "tax.settlements.review",
  "tax.settlements.finalize",
  "tax.settlements.rectify",
  "tax.vouchers.read",
  "tax.vouchers.prepare",
  "tax.vouchers.review",
  "tax.payments.record",
  "tax.filings.record",
];

const NOMBRE_BARRA = "Legajo: período, revisión, etapas y acciones";
const ETAPAS = ["Saldos", "Fuentes", "Clasificación", "Cálculo", "Controles", "Cierre"];

function fijarContexto(permisos: string[] = TODAS) {
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(permisos),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
}

function renderLegajo(
  opciones: Parameters<typeof rutasDemo>[0] = {},
  lecturas: (path: string) => Promise<unknown> = rutasDemo(opciones),
) {
  vi.mocked(api.get).mockImplementation(lecturas as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StudyExpedienteMensual />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** La barra de trabajo: región con nombre, fuera del área que se desplaza. */
function barra(): HTMLElement {
  return screen.getByRole("region", { name: NOMBRE_BARRA });
}

function controlBloqueante() {
  return {
    id: "control-a",
    code: "CONTROL_DEMO",
    severity: "BLOCKING",
    status: "OPEN",
    message: "Control sintético de prueba.",
    expected: null,
    actual: null,
    tolerance: null,
    evidenceDocumentId: null,
    resolution: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
  fijarContexto();
});

afterEach(() => {
  cleanup();
});

describe("Legajo · barra de trabajo (Barra 2a)", () => {
  it("una sola barra: período, estado y acción arriba; las seis etapas como pestañas", async () => {
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    expect(await within(barra()).findByRole("combobox", { name: "Período fiscal" })).toBeTruthy();
    await waitFor(() => expect(barra().querySelector(".status-badge__dot")).not.toBeNull());
    const bar = barra();
    expect(bar.querySelector(".status-badge__label")?.textContent?.trim()).toBeTruthy();
    const pestanas = within(bar).getAllByRole("tab");
    expect(pestanas.map((tab) => tab.textContent)).toEqual(ETAPAS);
    expect(pestanas[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("un solo h1, «Legajo», oculto a la vista para lectores de pantalla", async () => {
    const { container } = renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    await within(barra()).findByRole("tab", { name: "Saldos" });
    const encabezados = screen.getAllByRole("heading", { level: 1 });
    expect(encabezados).toHaveLength(1);
    expect(encabezados[0]!.textContent).toBe("Legajo");
    expect(encabezados[0]!.classList.contains("sr-only")).toBe(true);
    // La barra queda fuera del área que se desplaza; el cuerpo empieza debajo.
    expect(container.querySelector(".work-page__body")?.contains(barra())).toBe(false);
  });

  it.each([
    ["DRAFT", ["Calcular liquidación"]],
    ["CHANGES_REQUESTED", ["Recalcular"]],
    ["CALCULATED", ["Enviar a revisión"]],
    ["IN_REVIEW", ["Solicitar cambios", "Aprobar revisión"]],
    ["REVIEWED", ["Finalizar"]],
    ["FINALIZED", ["Crear rectificativa"]],
  ])(
    "estado %s: la barra muestra su acción del legajo y como máximo una primaria",
    async (estado, acciones) => {
      renderLegajo({ legajos: [legajoDemo(estado)] });
      const bar = barra();
      for (const nombre of acciones) {
        expect(await within(bar).findByRole("button", { name: nombre })).toBeTruthy();
      }
      expect(bar.querySelectorAll(".ds-button--primary").length).toBeLessThanOrEqual(1);
    },
  );

  it("en revisión, «Solicitar cambios» va antes de «Aprobar revisión» dentro de la barra", async () => {
    renderLegajo({ legajos: [legajoDemo("IN_REVIEW")] });
    const solicitar = await within(barra()).findByRole("button", { name: "Solicitar cambios" });
    const aprobar = within(barra()).getByRole("button", { name: "Aprobar revisión" });
    expect(
      solicitar.compareDocumentPosition(aprobar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(aprobar.classList.contains("ds-button--primary")).toBe(true);
    expect(solicitar.classList.contains("ds-button--primary")).toBe(false);
  });

  it("el motivo de una acción deshabilitada va en el renglón de avisos, debajo de la acción", async () => {
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    const calcular = await within(barra()).findByRole("button", { name: "Calcular liquidación" });
    expect((calcular as HTMLButtonElement).disabled).toBe(true);
    const avisos = barra().querySelector('[data-renglon="avisos"]');
    expect(avisos?.textContent).toContain("Completá y revisá las fuentes obligatorias para iniciar el cálculo.");
  });

  it("el contador de controles bloqueantes abiertos va junto a «Controles»", async () => {
    renderLegajo({ legajos: [{ ...legajoDemo("CALCULATED"), controls: [controlBloqueante()] }] });
    const controles = await within(barra()).findByRole("tab", { name: /^Controles/ });
    expect(controles.textContent).toContain("1");
    expect(controles.textContent).toContain("bloqueante abierto");
    expect(within(barra()).getByRole("tab", { name: "Saldos" }).textContent).toBe("Saldos");
  });

  it("no hay banda de cifras «Legajos · Componentes» en la pantalla", async () => {
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    await within(barra()).findByRole("tab", { name: "Saldos" });
    expect(screen.queryByRole("region", { name: "Estado del legajo" })).toBeNull();
    expect(screen.queryByText("Componentes")).toBeNull();
  });

  it("al entrar sin período guardado elige el primero y carga su legajo", async () => {
    sessionStorage.clear();
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    const selector = (await within(barra()).findByRole("combobox", {
      name: "Período fiscal",
    })) as HTMLSelectElement;
    await waitFor(() => expect(selector.value).toBe(periodoIibbDemo.id));
    expect(
      within(selector).getByRole("option", { name: "Seleccioná un período fiscal…" }),
    ).toBeTruthy();
    expect(
      await within(barra()).findByRole("button", { name: "Calcular liquidación" }),
    ).toBeTruthy();
  });

  it("período sin legajo: la barra lo dice, las etapas no aparecen y el contenido ofrece «Nuevo legajo»", async () => {
    renderLegajo({ legajos: [] });
    expect(await within(barra()).findByText("Sin legajo en este período")).toBeTruthy();
    expect(within(barra()).queryAllByRole("tab")).toHaveLength(0);
    // vigente: cambia con A29 (antes: «Sin legajos para este período»)
    expect(await screen.findByText("Creá el legajo para reunir las fuentes, clasificar y calcular la liquidación del período.")).toBeTruthy();
    expect(screen.queryByText("Sin legajos para este período")).toBeNull();
    expect(screen.getByRole("button", { name: "Nuevo legajo" })).toBeTruthy();
  });

  it("carga: mientras cargan los legajos, el contenido lo anuncia", async () => {
    renderLegajo({}, (path: string) =>
      path.includes("/monthly-tax-workpapers?")
        ? new Promise(() => undefined)
        : rutasDemo({})(path),
    );
    expect(await screen.findByText("Cargando legajos…")).toBeTruthy();
  });

  it("error de períodos: el contenido lo dice y ofrece «Reintentar», que vuelve a consultar", async () => {
    const base = rutasDemo({});
    let intentos = 0;
    renderLegajo({}, (path: string) => {
      if (path.endsWith("/tax-periods")) {
        intentos += 1;
        return intentos === 1 ? Promise.reject(new Error("Sin respuesta")) : base(path);
      }
      return base(path);
    });
    expect(await screen.findByText("No se pudieron cargar los períodos fiscales")).toBeTruthy();
    const reintentar = screen.getByRole("button", { name: "Reintentar" });
    reintentar.click();
    expect(
      await within(barra()).findByRole("button", { name: "Calcular liquidación" }),
    ).toBeTruthy();
    expect(intentos).toBe(2);
  });

  it("error de legajos: el contenido lo dice y ofrece «Reintentar»", async () => {
    const base = rutasDemo({});
    renderLegajo({}, (path: string) =>
      path.includes("/monthly-tax-workpapers?")
        ? Promise.reject(new Error("Sin respuesta"))
        : base(path),
    );
    expect(await screen.findByText("No se pudieron cargar los legajos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});

function revisionVigente() {
  return { ...legajoDemo("COLLECTING_INPUTS"), id: "wp-b", revision: 2 };
}

function revisionAnterior() {
  return { ...legajoDemo("FINALIZED"), id: "wp-a", revision: 1 };
}

describe("Legajo · acciones del período, revisión y solo lectura (Barra 2a)", () => {
  it("«Exportar libros» abre el cajón desde el menú y, al cerrarlo, el foco vuelve al botón del menú", async () => {
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    const boton = await within(barra()).findByRole("button", { name: "Acciones del período" });
    fireEvent.click(boton);
    const exportar = screen.getByRole("menuitem", { name: /Exportar libros/ });
    await waitFor(() => expect(exportar.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(exportar);
    const cajon = await screen.findByRole("dialog", { name: /Exportar libros/ });
    fireEvent.click(within(cajon).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(boton));
  });

  it("la revisión más reciente se abre por defecto y el menú lista cada revisión con su estado", async () => {
    renderLegajo({ legajos: [revisionVigente(), revisionAnterior()] });
    await within(barra()).findByRole("button", { name: "Calcular liquidación" });
    expect(within(barra()).getByRole("button", { name: "Revisión 2" })).toBeTruthy();
    fireEvent.click(within(barra()).getByRole("button", { name: "Revisión 2" }));
    expect(screen.getByRole("menuitemradio", { name: /Revisión 2.*la más reciente/ })).toBeTruthy();
    expect(
      screen.getByRole("menuitemradio", {
        name: /Revisión 1.*reemplazada por la revisión 2 · solo lectura/,
      }),
    ).toBeTruthy();
  });

  it("elegir una revisión anterior la muestra en solo lectura, sin acciones que escriban", async () => {
    renderLegajo({ legajos: [revisionVigente(), revisionAnterior()] });
    await within(barra()).findByRole("button", { name: "Calcular liquidación" });
    fireEvent.click(within(barra()).getByRole("button", { name: "Revisión 2" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Revisión 1/ }));
    expect(
      await within(barra()).findByText(
        "Revisión 1 en solo lectura: fue reemplazada por la revisión 2.",
      ),
    ).toBeTruthy();
    expect(within(barra()).getByRole("button", { name: "Revisión 1" })).toBeTruthy();
    expect(within(barra()).queryByRole("button", { name: "Calcular liquidación" })).toBeNull();
    expect(within(barra()).queryByRole("button", { name: "Crear rectificativa" })).toBeNull();
    fireEvent.click(within(barra()).getByRole("button", { name: "Acciones del período" }));
    expect(
      screen.getByRole("menuitem", { name: /Nuevo legajo/ }).getAttribute("aria-disabled"),
    ).toBe("true");
  });
});

describe("Legajo · sustitutas de la banda de cifras (BandaEstado.test.tsx, retirada en Barra 2a)", () => {
  it("con 1 legajo, el menú «Revisión» lista una sola revisión y no hay banda de cifras // vigente: cambia con A29", async () => {
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    await within(barra()).findByRole("button", { name: "Revisión 1" });
    fireEvent.click(within(barra()).getByRole("button", { name: "Revisión 1" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    expect(screen.queryByText(/\d+ Componentes?/)).toBeNull();
  });

  it("con 2 legajos, el menú «Revisión» lista las dos revisiones y no hay banda de cifras // vigente: cambia con A29", async () => {
    renderLegajo({ legajos: [revisionVigente(), revisionAnterior()] });
    await within(barra()).findByRole("button", { name: "Revisión 2" });
    fireEvent.click(within(barra()).getByRole("button", { name: "Revisión 2" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    expect(screen.queryByText(/\d+ Componentes?/)).toBeNull();
  });
});

describe("Legajo · correcciones de la barra (Barra 2c)", () => {
  it("el período fiscal muestra el mes y el año primero, en cada opción y en el valor elegido", async () => {
    renderLegajo({ legajos: [legajoDemo("DRAFT")] });
    const selector = (await within(barra()).findByRole("combobox", {
      name: "Período fiscal",
    })) as HTMLSelectElement;
    expect(
      within(selector)
        .getAllByRole("option")
        .map((opcion) => opcion.textContent),
    ).toEqual([
      "Seleccioná un período fiscal…",
      "Octubre de 2026 · Ingresos Brutos · 2026-10",
      "Octubre de 2026 · IVA · 2026-10",
    ]);
    expect(selector.selectedOptions[0]?.textContent).toBe(
      "Octubre de 2026 · Ingresos Brutos · 2026-10",
    );
  });

  it("«Crear rectificativa» tiene el tamaño de los demás controles de la barra (32 px)", async () => {
    renderLegajo({ legajos: [legajoDemo("FINALIZED")] });
    const boton = await within(barra()).findByRole("button", { name: "Crear rectificativa" });
    expect(boton.classList.contains("ds-button--sm")).toBe(true);
  });

  it("las dos frases de guía de Clasificación van en un mismo párrafo", async () => {
    renderLegajo({ legajos: [legajoDemo("FINALIZED")] });
    fireEvent.click(await within(barra()).findByRole("tab", { name: "Clasificación" }));
    const guia = await screen.findByText(/^Las actividades adheridas determinan/);
    expect(guia.closest("p")?.textContent).toBe(
      "Las actividades adheridas determinan la alícuota aplicable. Completá las que falten antes de calcular. El legajo no admite cambios de fuentes en su estado actual.",
    );
  });
  it.each([
    ["DRAFT", "Calcular liquidación"],
    ["CHANGES_REQUESTED", "Recalcular"],
    ["CALCULATED", "Enviar a revisión"],
    ["IN_REVIEW", "Solicitar cambios"],
    ["IN_REVIEW", "Aprobar revisión"],
    ["REVIEWED", "Finalizar"],
    ["FINALIZED", "Crear rectificativa"],
  ])("en %s, «%s» mide 32 px: tamaño sm como el resto de los controles de la barra", async (estado, nombre) => {
    renderLegajo({ legajos: [legajoDemo(estado)] });
    const boton = await within(barra()).findByRole("button", { name: nombre });
    expect(boton.classList.contains("ds-button--sm")).toBe(true);
  });
});

describe("Legajo · aviso de solo lectura con salida (Barra 2e)", () => {
  it("«Ir a la revisión 2» en el aviso de la revisión anterior elige la vigente y lleva el foco al contenido", async () => {
    renderLegajo({ legajos: [revisionVigente(), revisionAnterior()] });
    await within(barra()).findByRole("button", { name: "Calcular liquidación" });
    fireEvent.click(within(barra()).getByRole("button", { name: "Revisión 2" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Revisión 1/ }));
    const aviso = await within(barra()).findByText(
      "Revisión 1 en solo lectura: fue reemplazada por la revisión 2.",
    );
    const ir = within(barra()).getByRole("button", { name: "Ir a la revisión 2" });
    expect(aviso.closest(".work-bar__nota")?.contains(ir)).toBe(true);
    fireEvent.click(ir);
    expect(within(barra()).getByRole("button", { name: "Revisión 2" })).toBeTruthy();
    expect(within(barra()).queryByText(/en solo lectura/)).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("workpaper-panel"));
  });
});
