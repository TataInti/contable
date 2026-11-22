// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  legajoDemo,
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

// Dos revisiones del mismo período. La API devuelve primero la más alta (workpaper-service.ts:656).
const revisionVigente = { ...legajoDemo("DRAFT"), id: "wp-b", revision: 2 };
const revisionAnterior = { ...legajoDemo("FINALIZED"), id: "wp-a", revision: 1 };

/** Abre el menú «Revisión» de la barra y elige la revisión pedida. */
function elegirRevision(numero: number) {
  fireEvent.click(screen.getByRole("button", { name: /^Revisión \d+$/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: new RegExp(`^Revisión ${numero}`) }));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyExpedienteMensual />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set([
      "client.read",
      "tax.settlements.calculate",
      "tax.settlements.submit_review",
      "tax.settlements.review",
      "tax.settlements.finalize",
      "tax.settlements.rectify",
    ]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  vi.mocked(api.get).mockImplementation(
    rutasDemo({ legajos: [revisionVigente, revisionAnterior] }) as never,
  );
  vi.mocked(api.post).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · dos revisiones del mismo período (K16)", () => {
  // Defecto de D6a: hoy cada tarjeta dibuja etapas y comparte una sola etapa activa.
  // Estas pruebas fijan el estado actual con it.fails; el corte las pasa a aserción.
  it("la revisión anterior se abre en solo lectura: sus seis etapas y ninguna acción que escriba", async () => {
    // vigente: cambia con A29
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    const barra = screen.getByRole("region", {
      name: "Legajo: período, revisión, etapas y acciones",
    });
    elegirRevision(1);
    expect(
      await screen.findByText("Revisión 1 en solo lectura: fue reemplazada por la revisión 2."),
    ).toBeTruthy();
    expect(within(barra).getAllByRole("tab")).toHaveLength(6);
    expect(within(barra).queryByRole("button", { name: "Crear rectificativa" })).toBeNull();
  });

  it("la etapa elegida se conserva al pasar a la revisión anterior, en solo lectura", async () => {
    // vigente: cambia con A29
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    const barra = screen.getByRole("region", {
      name: "Legajo: período, revisión, etapas y acciones",
    });
    fireEvent.click(within(barra).getByRole("tab", { name: "Fuentes" }));
    elegirRevision(1);
    expect(within(barra).getByRole("tab", { name: "Fuentes" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("la revisión anterior muestra su estado y la que la reemplaza", async () => {
    // vigente: cambia con A29
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    elegirRevision(1);
    // vigente: cambia con A29 (antes: findByText("Revisión 1 · Finalizado · reemplazada por la revisión 2"))
    // vigente: cambia con A29 (antes: la frase de Saldos iba sola en su párrafo)
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === "P" && el.textContent === PARRAFO_SALDOS_RO,
      ),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", { name: "Legajo: período, revisión, etapas y acciones" }),
      ).getByText("Finalizado"),
    ).toBeTruthy();
  });

  it("las etapas leen la revisión vigente y no la anterior", async () => {
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-b/coverage"),
      ),
    );
    expect(api.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/monthly-tax-workpapers/wp-a/coverage"),
    );
  });
});

// Barra 2c (A29): en una revisión anterior no queda ninguna acción que escriba, en ninguna etapa.
// Cada etapa se prueba en dos pasos: la revisión vigente muestra la acción (sanidad) y la anterior no.
const PERMISOS_COMPLETOS = [
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
const FRASE_SALDOS = "Saldos vigentes del cliente y del período; no se guardan por revisión.";
// Barra 2e (A29): las dos frases de Saldos en una revisión anterior van en un mismo párrafo.
const PARRAFO_SALDOS_RO = `${FRASE_SALDOS} Disponibles por impuesto, régimen y jurisdicción. Cada saldo conserva su respaldo.`;
const controlAbierto = {
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
// Posición «Demo»: liquidación finalizada, vencida, sin presentación y con saldo a pagar.
const posicionDemo = {
  obligationId: "obl-a",
  status: "READY_TO_FILE",
  dueDate: "2000-01-01T00:00:00.000Z",
  filedAt: null,
  regime: {
    id: "regime-a",
    name: "Régimen Ingresos Brutos",
    isActive: true,
    taxType: { id: "tax-type-a", name: "Ingresos Brutos", isActive: true },
    jurisdiction: { id: "jur-tuc", name: "Tucumán", isActive: true },
  },
  settlement: { id: "settlement-a", status: "FINALIZED", version: 1, totals: {} },
  accrued: "1000",
  paid: "0",
  pending: "1000",
  availableCredit: "0",
  interest: "0",
  totalPayable: "1000",
};
// Comprobante «Demo» pendiente de clasificar: la fila muestra los selectores de la etapa.
const clasificacionDemo = {
  total: 1,
  classified: 0,
  pending: 1,
  ready: false,
  items: [
    {
      id: "compra-a",
      voucherId: "voucher-compra-a",
      direction: "PURCHASE",
      counterpartyCuit: "20999999999",
      documentKind: "INVOICE",
      categoryCode: null,
      activityCode: null,
      rateBuckets: [],
      status: "PENDING",
      origin: null,
      voucher: {
        type: "FACTURA",
        letter: "A",
        pointOfSale: 1,
        number: 1,
        issuedOn: "2026-10-10",
        total: "1000",
      },
    },
  ],
};

describe("Legajo · revisión anterior en solo lectura, por etapa (Barra 2c)", () => {
  beforeEach(() => {
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set(PERMISOS_COMPLETOS),
    } as unknown as ClientContextValue;
  });

  it("Saldos: tabla en solo lectura, con la frase como primer texto y sin Editar", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Editar" })).toBeTruthy();
    elegirRevision(1);
    expect(await screen.findByText("SALDO A FAVOR")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    // vigente: cambia con A29 (antes: el primer párrafo era la frase sola)
    expect(document.querySelector(".work-page__content p")?.textContent).toBe(PARRAFO_SALDOS_RO);
  });

  it("Fuentes: la revisión anterior conserva Gestión de lectura sin acciones de carga", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Fuentes" }));
    expect(await screen.findByRole("button", { name: "Gestionar Ventas del período" })).toBeTruthy();
    elegirRevision(1);
    expect(await screen.findByText("Ventas del período")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gestionar Ventas del período" }));
    expect(await screen.findByText("Esta revisión se consulta en solo lectura.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cargar archivo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Importar libro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Importar lote" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revisar" })).toBeNull();
  });

  it("Clasificación: sin selectores de fila, ni Guardar ni Reimputar", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({
        legajos: [revisionVigente, revisionAnterior],
        clasificaciones: clasificacionDemo,
      }) as never,
    );
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Clasificación" }));
    expect(await screen.findByRole("combobox", { name: "Rubro del proveedor" })).toBeTruthy();
    elegirRevision(1);
    expect(await screen.findByText(/^Las actividades adheridas determinan/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Rubro del proveedor" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Guardar|^Reimputar/ })).toBeNull();
  });

  it("Cálculo: sin Registrar presentación, Cargar declaración jurada, Calcular mora ni Registrar pago", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({
        legajos: [revisionVigente, revisionAnterior],
        posiciones: [posicionDemo],
      }) as never,
    );
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Cálculo" }));
    expect(
      (await screen.findAllByRole("button", { name: "Registrar pago" })).length,
    ).toBeGreaterThan(0);
    elegirRevision(1);
    expect((await screen.findAllByText(/Régimen Ingresos Brutos/)).length).toBeGreaterThan(0);
    for (const nombre of [
      "Registrar presentación",
      "Cargar declaración jurada",
      "Calcular mora",
      "Registrar pago",
    ]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull();
    }
  });

  it("Controles: sin Resolver, Eximir ni campos de resolución", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({
        legajos: [
          { ...revisionVigente, controls: [controlAbierto] },
          { ...revisionAnterior, controls: [controlAbierto] },
        ],
      }) as never,
    );
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /^Controles/ }));
    expect(await screen.findByRole("button", { name: "Resolver" })).toBeTruthy();
    elegirRevision(1);
    expect((await screen.findAllByText(/Control sintético|CONTROL_DEMO/)).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("button", { name: "Resolver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eximir" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /^Resolución / })).toBeNull();
  });

  it("Cierre: solo texto y hashes, sin botones", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Cierre" }));
    elegirRevision(1);
    expect(await screen.findByText(/Finalizar congela los hashes/)).toBeTruthy();
    const contenido = document.querySelector(".work-page__content") as HTMLElement;
    expect(within(contenido).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("Legajo · «Actualizar» en una revisión anterior (Barra 2e)", () => {
  it("Saldos y Cálculo: «Actualizar» vuelve en solo lectura y no hay «Cargar saldo inicial» ni acción que escriba", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({
        legajos: [revisionVigente, revisionAnterior],
        posiciones: [posicionDemo],
      }) as never,
    );
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    elegirRevision(1);
    expect(await screen.findByText("SALDO A FAVOR")).toBeTruthy();
    const barraLegajo = screen.getByRole("region", {
      name: "Legajo: período, revisión, etapas y acciones",
    });
    expect(await within(barraLegajo).findByRole("button", { name: "Actualizar" })).toBeTruthy();
    expect(within(barraLegajo).queryByRole("button", { name: "Cargar saldo inicial" })).toBeNull();
    fireEvent.click(within(barraLegajo).getByRole("tab", { name: "Cálculo" }));
    expect(await within(barraLegajo).findByRole("button", { name: "Actualizar" })).toBeTruthy();
    expect(within(barraLegajo).queryByRole("button", { name: "Cargar saldo inicial" })).toBeNull();
  });
});
