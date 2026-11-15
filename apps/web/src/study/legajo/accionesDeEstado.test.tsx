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
const sesionMock = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: sesionMock.userId ? { userId: sesionMock.userId } : null,
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
  "tax.vouchers.prepare",
  "tax.vouchers.review",
  "tax.payments.record",
  "tax.filings.record",
];

const AUTORREVISION =
  "Para revisar o finalizar este legajo, el Titular puede habilitar la autorrevisión en Configuración del estudio.";

function contexto(capacidades: string[]) {
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
}

function renderLegajos(legajos: unknown[], calculo?: unknown[]) {
  vi.mocked(api.get).mockImplementation(rutasDemo({ legajos, calculo }) as never);
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

async function accionesDeLaTarjeta(container: HTMLElement) {
  await screen.findByRole("heading", { level: 2, name: /Revisión 1/ });
  return container.querySelector(".workpaper-card__actions") as HTMLElement;
}

/** Botones de acción de la tarjeta: la primaria va en el encabezado de la etapa y las secundarias, en la barra (Foco 2.8). */
function botonesDeAcciones(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      ".workpaper-process__accion button, .workpaper-card__actions button",
    ),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  sesionMock.userId = null;
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · acciones de estado de la tarjeta (K14)", () => {
  const estados: Array<[string, string[]]> = [
    ["DRAFT", ["Calcular"]],
    ["COLLECTING_INPUTS", ["Calcular"]],
    ["READY_TO_CALCULATE", ["Calcular"]],
    ["CHANGES_REQUESTED", ["Recalcular"]],
    ["CALCULATED", ["Enviar a revisión"]],
    ["IN_REVIEW", ["Solicitar cambios", "Aprobar revisión"]],
    ["REVIEWED", ["Finalizar"]],
    ["FINALIZED", ["Crear rectificativa"]],
  ];

  it.each(estados)("en %s muestra solo las acciones de su etapa", async (estado, esperadas) => {
    contexto(TODAS);
    const { container } = renderLegajos([legajoDemo(estado)]);
    await accionesDeLaTarjeta(container);

    await waitFor(() =>
      expect(botonesDeAcciones(container).map((b) => b.textContent)).toEqual(esperadas),
    );
  });

  it("sin tax.settlements.review no dibuja las acciones de revisión", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.review"));
    const { container } = renderLegajos([legajoDemo("IN_REVIEW")]);
    const acciones = await accionesDeLaTarjeta(container);

    // Foco 2.9: sin acción de revisión ni error, la barra no se dibuja.
    expect(acciones).toBeNull();
    expect(screen.queryByRole("button", { name: "Solicitar cambios" })).toBeNull();
  });

  it("sin tax.settlements.finalize deja Finalizar deshabilitado", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.finalize"));
    renderLegajos([legajoDemo("REVIEWED")]);

    const boton = (await screen.findByRole("button", { name: "Finalizar" })) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });

  it("sin tax.settlements.calculate explica junto a Calcular por qué no se puede", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.calculate"));
    const { container } = renderLegajos([legajoDemo("DRAFT")]);
    await accionesDeLaTarjeta(container);

    const boton = screen.getByRole("button", { name: "Calcular" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(screen.getByText("Tu perfil no tiene permiso para calcular este legajo.")).toBeTruthy();
  });

  it("sin tax.settlements.rectify no ofrece Crear rectificativa", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.rectify"));
    const { container } = renderLegajos([legajoDemo("FINALIZED")]);
    const acciones = await accionesDeLaTarjeta(container);

    // Foco 2.9: sin rectificativa ni error, la barra no se dibuja.
    expect(acciones).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear rectificativa" })).toBeNull();
  });

  it("la autorrevisión bloquea Aprobar revisión y muestra su texto", async () => {
    contexto(TODAS);
    sesionMock.userId = "user-a";
    renderLegajos([{ ...legajoDemo("IN_REVIEW"), preparedByUserId: "user-a" }]);

    const boton = (await screen.findByRole("button", {
      name: "Aprobar revisión",
    })) as HTMLButtonElement;
    await waitFor(() => expect(boton.disabled).toBe(true));
    expect(await screen.findByText(AUTORREVISION)).toBeTruthy();
  });

  it("la autorrevisión bloquea Finalizar y nombra quién revisó", async () => {
    contexto(TODAS);
    sesionMock.userId = "user-a";
    renderLegajos([
      { ...legajoDemo("REVIEWED"), preparedByUserId: "user-a", reviewedByUserId: "user-a" },
    ]);

    expect(
      await screen.findByText("Legajo revisado por la misma persona que lo preparó."),
    ).toBeTruthy();
    const boton = screen.getByRole("button", { name: "Finalizar" }) as HTMLButtonElement;
    await waitFor(() => expect(boton.disabled).toBe(true));
    expect(await screen.findByText(AUTORREVISION)).toBeTruthy();
  });

  it("Enviar a revisión llama a submit-review", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("CALCULATED")]);

    fireEvent.click(await screen.findByRole("button", { name: "Enviar a revisión" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/submit-review"),
      ),
    );
  });

  it("Aprobar revisión envía approved true", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("IN_REVIEW")]);

    fireEvent.click(await screen.findByRole("button", { name: "Aprobar revisión" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/review"),
        { approved: true },
      ),
    );
  });

  it("Solicitar cambios envía approved false", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("IN_REVIEW")]);

    fireEvent.click(await screen.findByRole("button", { name: "Solicitar cambios" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/review"),
        { approved: false },
      ),
    );
  });

  it("Finalizar llama a finalize", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("REVIEWED")]);

    fireEvent.click(await screen.findByRole("button", { name: "Finalizar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí, finalizar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/finalize"),
      ),
    );
  });

  it("Crear rectificativa llama a rectify", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("FINALIZED")]);

    fireEvent.click(await screen.findByRole("button", { name: "Crear rectificativa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí, crear rectificativa" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/rectify"),
      ),
    );
  });
});

describe("Legajo · barra de acciones sin contenido (Foco 2.9)", () => {
  it.each(["DRAFT", "CALCULATED", "REVIEWED"])(
    "en %s, sin acciones secundarias, no dibuja la barra de acciones",
    async (estado) => {
      contexto(TODAS);
      const { container } = renderLegajos([legajoDemo(estado)]);
      await accionesDeLaTarjeta(container);

      expect(container.querySelector(".workpaper-card__actions")).toBeNull();
      expect(container.querySelector(".workpaper-step-footer")).not.toBeNull();
    },
  );
});

describe("Legajo · acciones de estado antes de la barra de etapas (Foco 2.7b)", () => {
  it("las acciones de estado van antes de la barra de etapas, para verse sin desplazar", async () => {
    contexto(TODAS);
    const { container } = renderLegajos([legajoDemo("IN_REVIEW")]);
    await accionesDeLaTarjeta(container);
    const acciones = container.querySelector<HTMLElement>(".workpaper-process__accion")!;
    const barra = container.querySelector<HTMLElement>(".workpaper-step-footer");
    expect(barra).not.toBeNull();
    expect(
      acciones.compareDocumentPosition(barra!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Solicitar cambios" })).toBeTruthy();
  });
});

describe("Legajo · ciclo de revisión (Foco 2.10)", () => {
  it("en revisión, Solicitar cambios va en la línea de la etapa, antes que Aprobar revisión, sin barra", async () => {
    contexto(TODAS);
    const { container } = renderLegajos([legajoDemo("IN_REVIEW")]);
    await accionesDeLaTarjeta(container);

    const linea = container.querySelector<HTMLElement>(".workpaper-process__accion")!;
    const solicitar = within(linea).getByRole("button", { name: "Solicitar cambios" });
    const aprobar = within(linea).getByRole("button", { name: "Aprobar revisión" });
    expect(
      solicitar.compareDocumentPosition(aprobar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(solicitar.className).toContain("ds-button--secondary");
    expect(aprobar.className).toContain("ds-button--primary");
    expect(container.querySelector(".workpaper-card__actions")).toBeNull();
  });

  it("el pedido de cambios va bajo el estado, en un aviso warning y sin el código interno", async () => {
    contexto(TODAS);
    const { container } = renderLegajos(
      [legajoDemo("CHANGES_REQUESTED")],
      [componenteConPedido("Captura de la etapa 5 pendiente.")],
    );
    const titulo = await screen.findByText("Cambios solicitados", {
      selector: ".ds-notice__title",
    });
    const aviso = titulo.closest<HTMLElement>(".ds-notice")!;
    expect(aviso.classList.contains("ds-notice--warning")).toBe(true);
    expect(within(aviso).getByText("Captura de la etapa 5 pendiente.")).toBeTruthy();
    expect(container.textContent).not.toContain("CHANGES_REQUESTED");

    const encabezado = container.querySelector<HTMLElement>(".workpaper-card__header")!;
    const barra = container.querySelector<HTMLElement>(".workpaper-process")!;
    expect(
      encabezado.compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(aviso.compareDocumentPosition(barra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin pedido de cambios no se dibuja el aviso bajo el estado", async () => {
    contexto(TODAS);
    const { container } = renderLegajos([legajoDemo("IN_REVIEW")]);
    await accionesDeLaTarjeta(container);
    expect(container.querySelector(".workpaper-card__pedido")).toBeNull();
  });
});

function componenteConPedido(mensaje: string) {
  return {
    role: "OBLIGATION",
    required: true,
    obligationId: "obligation-a",
    obligation: {
      regimeCode: "IIBB",
      regimeName: "IIBB Tucumán",
      taxTypeCode: "IIBB",
      taxTypeName: "Ingresos Brutos",
      jurisdictionName: "Tucumán",
    },
    settlement: {
      id: "settlement-a",
      status: "CHANGES_REQUESTED",
      engineVersion: "v1",
      ruleVersionId: null,
      rulesHash: "hash-a",
      totals: null,
      lines: [],
      f931Inputs: [],
      differences: [
        {
          id: "difference-a",
          severity: "WARNING",
          status: "OPEN",
          code: "CHANGES_REQUESTED",
          message: mensaje,
        },
      ],
    },
  };
}
