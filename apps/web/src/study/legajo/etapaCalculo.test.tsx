// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de la etapa Cálculo del Legajo (K12) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fuentesDemo,
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

const LEGAJO = `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}/monthly-tax-workpapers/wp-a`;
const PERMISOS_CALCULO = [
  "client.read",
  "tax.settlements.calculate",
  "tax.payments.record",
  "tax.filings.record",
];
const fuentesPresentes = fuentesDemo.map((fuente) => ({ ...fuente, present: true, count: 4 }));
const clasificacionesPendientes = { total: 1, classified: 0, pending: 1, ready: false, items: [] };
const imputacionesPendientes = { total: 1, allocated: 0, pending: 1, ready: false, items: [] };

// Impuesto «Demo» de un mismo mes: liquidación finalizada y saldo pendiente salvo que se indique otra cosa.
function posicion(obligationId: string, impuesto: string, overrides: Record<string, unknown> = {}) {
  return {
    obligationId,
    status: "READY_TO_FILE",
    dueDate: "2999-01-01T00:00:00.000Z",
    filedAt: null,
    regime: {
      id: `regime-${obligationId}`,
      name: `Régimen ${impuesto}`,
      isActive: true,
      taxType: { id: `tax-${obligationId}`, name: impuesto, isActive: true },
      jurisdiction: { id: "jur-tuc", name: "Tucumán", isActive: true },
    },
    settlement: { id: `settlement-${obligationId}`, status: "FINALIZED", version: 1, totals: {} },
    accrued: "1000",
    paid: "0",
    pending: "1000",
    availableCredit: "0",
    interest: "0",
    totalPayable: "1000",
    ...overrides,
  };
}

function fijarContexto(permisos: string[]) {
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
  };
}

// Respuestas del legajo. Las posiciones se piden por período: cada impuesto del mes tiene el suyo.
function fijarRespuestas(
  opciones: {
    posiciones?: Record<string, unknown[]>;
    fuentes?: unknown[];
    clasificaciones?: unknown;
    imputaciones?: unknown;
    legajos?: unknown[];
  } = {},
) {
  const rutas = rutasDemo({
    fuentes: opciones.fuentes ?? fuentesPresentes,
    clasificaciones: opciones.clasificaciones,
    imputaciones: opciones.imputaciones,
    legajos: opciones.legajos,
  });
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.includes("/tax-position?")) {
      const periodo = path.split("periodId=")[1] ?? "";
      return Promise.resolve(opciones.posiciones?.[periodo] ?? []);
    }
    return rutas(path);
  }) as never);
}

function renderLegajo() {
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

// Abre la etapa Cálculo del legajo vigente.
async function abrirCalculo() {
  fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", PERIODO_ELEGIDO_DEMO);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fijarRespuestas();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · etapa Cálculo (K12)", () => {
  it("Calcular explica qué fuentes, clasificaciones e imputaciones faltan, en ese orden", async () => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({
      fuentes: fuentesDemo,
      clasificaciones: clasificacionesPendientes,
      imputaciones: imputacionesPendientes,
    });
    renderLegajo();
    const boton = (await screen.findByRole("button", {
      name: "Calcular liquidación",
    })) as HTMLButtonElement; // vigente: cambia con decisión de Ciro (16-nov, 49a)
    expect(boton.disabled).toBe(true);
    expect(
      await screen.findByText(
        "Faltan fuentes obligatorias revisadas. Faltan clasificaciones por completar. Faltan retenciones o percepciones por imputar.",
      ),
    ).toBeInTheDocument();
  });

  it("Calcular explica que falta el permiso para calcular", async () => {
    fijarContexto(["client.read"]);
    fijarRespuestas({ fuentes: fuentesPresentes });
    renderLegajo();
    expect(
      await screen.findByText("Tu perfil no tiene permiso para calcular este legajo."),
    ).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: "Calcular liquidación" }) as HTMLButtonElement).disabled,
    ).toBe(
      // vigente: cambia con decisión de Ciro (16-nov, 49a)
      true,
    );
  });

  it("Calcular queda bloqueado con «El cálculo está en curso.» mientras responde el cálculo", async () => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({ fuentes: fuentesPresentes, legajos: [legajoDemo("READY_TO_CALCULATE")] });
    vi.mocked(api.post).mockImplementation((() => new Promise(() => {})) as never);
    renderLegajo();
    fireEvent.click(await screen.findByRole("button", { name: "Calcular liquidación" })); // vigente: cambia con decisión de Ciro (16-nov, 49a)
    expect(await screen.findByText("El cálculo está en curso.")).toBeInTheDocument();
  });

  it("Calcular envía el cálculo del legajo cuando el legajo está listo para calcular", async () => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({ fuentes: fuentesPresentes, legajos: [legajoDemo("READY_TO_CALCULATE")] });
    renderLegajo();
    fireEvent.click(await screen.findByRole("button", { name: "Calcular liquidación" })); // vigente: cambia con decisión de Ciro (16-nov, 49a)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${LEGAJO}/calculate`));
  });

  it("Calcular mora aparece con liquidación finalizada, impuesto vencido y saldo pendiente", async () => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({
      posiciones: {
        "period-a": [
          posicion("obligacion-iibb", "Ingresos Brutos", { dueDate: "2000-01-01T00:00:00.000Z" }),
        ],
        "period-iva": [posicion("obligacion-iva", "IVA")],
      },
    });
    renderLegajo();
    await abrirCalculo();
    expect(await screen.findByRole("button", { name: "Calcular mora" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Calcular mora" })).toHaveLength(1);
  });

  it.each<[string, Record<string, unknown>]>([
    ["el vencimiento es futuro", { dueDate: "2999-01-01T00:00:00.000Z" }],
    [
      "la liquidación no está finalizada",
      { settlement: { id: "settlement-iibb", status: "CALCULATED", version: 1, totals: {} } },
    ],
    ["no queda saldo pendiente", { pending: "0" }],
  ])("Calcular mora no aparece si %s", async (_motivo, overrides) => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({
      posiciones: {
        "period-a": [
          posicion("obligacion-iibb", "Ingresos Brutos", {
            dueDate: "2000-01-01T00:00:00.000Z",
            ...overrides,
          }),
        ],
      },
    });
    renderLegajo();
    await abrirCalculo();
    expect(await screen.findByText(/Régimen Ingresos Brutos/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calcular mora" })).toBeNull();
  });

  it("Registrar pago abre el panel de pago del impuesto", async () => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({
      posiciones: { "period-a": [posicion("obligacion-iibb", "Ingresos Brutos")] },
    });
    renderLegajo();
    await abrirCalculo();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    expect(await screen.findByRole("dialog", { name: "Registrar pago" })).toBeInTheDocument();
  });

  it("Actualizar vuelve a consultar la posición fiscal del período", async () => {
    fijarContexto(PERMISOS_CALCULO);
    fijarRespuestas({
      posiciones: { "period-a": [posicion("obligacion-iibb", "Ingresos Brutos")] },
    });
    renderLegajo();
    await abrirCalculo();
    await screen.findByRole("button", { name: "Registrar pago" });
    const consultasDePosicion = () =>
      vi.mocked(api.get).mock.calls.filter(([ruta]) => String(ruta).includes("/tax-position?"))
        .length;
    const antes = consultasDePosicion();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(consultasDePosicion()).toBeGreaterThan(antes));
  });

  // Un fallo al leer la determinación muestra Reintentar (antes no dibujaba nada).
  it("un fallo al leer la determinación se muestra con Reintentar, no sin contenido", async () => {
    fijarContexto(PERMISOS_CALCULO);
    const rutas = rutasDemo({ fuentes: fuentesPresentes });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/calculation")
        ? Promise.reject(new Error("Fallo Demo"))
        : rutas(path)) as never);
    renderLegajo();
    await abrirCalculo();
    expect(await screen.findByText("Determinación y trazabilidad del cálculo")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  // Un fallo al leer la posición muestra Reintentar (antes se veía como «No hay obligaciones fiscales»).
  it("un fallo al leer la posición se muestra con Reintentar, no como vacío", async () => {
    fijarContexto(PERMISOS_CALCULO);
    const rutas = rutasDemo({ fuentes: fuentesPresentes });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.includes("/tax-position?")
        ? Promise.reject(new Error("Fallo Demo"))
        : rutas(path)) as never);
    renderLegajo();
    await abrirCalculo();
    expect(await screen.findByText("Posición fiscal del período")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
  it("la carga de la determinación y de la posición se anuncia con role=status y la etapa tiene una sola acción primaria", async () => {
    fijarContexto(PERMISOS_CALCULO);
    const rutas = rutasDemo({ fuentes: fuentesPresentes });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/calculation") || path.includes("/tax-position?")
        ? new Promise(() => {})
        : rutas(path)) as never);
    renderLegajo();
    await abrirCalculo();
    const determinacion = await screen.findByText("Cargando determinación…");
    expect(determinacion.closest("[role='status']")).not.toBeNull();
    expect(screen.getByText("Calculando posición…").closest("[role='status']")).not.toBeNull();
    expect(document.querySelectorAll(".workpaper-card .ds-button--primary")).toHaveLength(1);
  });
});
