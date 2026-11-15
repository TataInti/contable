// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyTrabajo } from "../StudyTrabajo";

// Caracterización de StudyTrabajo (Foco 7c.1). Afirma el comportamiento vigente en origin/main
// 18a798a. Datos sintéticos rotulados «Demo». Donde el informe marca un defecto, la aserción
// fija lo que hoy se ve y lleva `// vigente: cambia con D7C-N`; el corte que lo corrige la
// reemplaza y lo declara.

const contexto = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
const navegar = vi.hoisted(() => vi.fn());

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contexto.current,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navegar,
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

const BASE = "/firms/firm-a/clients/client-a";
const CAPACIDADES_TODAS = [
  "client.read",
  "period.soft_close",
  "request.manage",
  "message.shared",
  "tax.profile.write",
];
const ANIOS_DEMO = [
  {
    id: "fy-a",
    label: "Demo: ejercicio 2026",
    periods: [
      { id: "period-a", startDate: "2026-10-01", endDate: "2026-10-31", status: "OPEN" },
      { id: "period-b", startDate: "2026-11-01", endDate: "2026-11-30", status: "OPEN" },
    ],
  },
];
const OBLIGACION_OCTUBRE_PENDIENTE = {
  id: "obl-1",
  status: "PENDING",
  dueDate: "2026-10-20",
  regime: {
    name: "Demo: régimen general",
    taxType: { name: "IVA" },
    jurisdiction: { name: "Demo: Nacional" },
  },
  period: {
    id: "period-a",
    label: "Demo: octubre 2026",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  },
};
const OBLIGACION_OCTUBRE_PRESENTADA = {
  id: "obl-2",
  status: "FILED",
  dueDate: null,
  regime: {
    name: "Demo: convenio multilateral",
    taxType: { name: "Ingresos Brutos" },
    jurisdiction: { name: "Demo: Tucumán" },
  },
  period: { id: "period-a", label: null, startDate: "2026-10-01", endDate: "2026-10-31" },
};
const OBLIGACION_NOVIEMBRE = {
  id: "obl-3",
  status: "PENDING",
  dueDate: "2026-11-20",
  regime: {
    name: "Demo: régimen general",
    taxType: { name: "IVA" },
    jurisdiction: { name: "Demo: Nacional" },
  },
  period: {
    id: "period-b",
    label: "Demo: noviembre 2026",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  },
};

function usarContexto(
  capacidades: string[] = CAPACIDADES_TODAS,
  periodId: string | null = "period-a",
) {
  contexto.current = {
    firmId: "firm-a",
    clientId: "client-a",
    periodId,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
}

interface RespuestasDemo {
  anios?: unknown;
  pedidos?: unknown;
  cierres?: unknown;
  obligaciones?: unknown;
}

function responderApi({
  anios = ANIOS_DEMO,
  pedidos = [],
  cierres = [],
  obligaciones = [],
}: RespuestasDemo = {}) {
  vi.mocked(api.get).mockImplementation(((ruta: string) => {
    if (ruta === `${BASE}/fiscal-years`) return Promise.resolve(anios);
    if (ruta === `${BASE}/document-requests`) return Promise.resolve(pedidos);
    if (ruta === `${BASE}/close-cycles`) return Promise.resolve(cierres);
    if (ruta === `${BASE}/tax-obligations`) return Promise.resolve(obligaciones);
    return Promise.reject(new Error(`Demo: ruta no prevista ${ruta}`));
  }) as never);
}

function renderTrabajo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StudyTrabajo />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function estadistica(nombre: string) {
  const grupo = screen.getByRole("group", { name: "Resumen del trabajo" });
  const item = Array.from(grupo.querySelectorAll(".dense-stat")).find(
    (elemento) => elemento.querySelector(".dense-stat__label")?.textContent === nombre,
  );
  if (!item) throw new Error(`Falta la estadística «${nombre}»`);
  return {
    valor: item.querySelector(".dense-stat__value")?.textContent,
    alerta: item.classList.contains("dense-stat--warn"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({});
  usarContexto();
  responderApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("K1 · encabezado de Trabajo", () => {
  it("muestra título, descripción y «Actualizar» ghost; sin capacidades no hay acciones de cierre ni de pedido", async () => {
    usarContexto(["client.read"]);
    renderTrabajo();
    expect(await screen.findByRole("heading", { level: 1, name: "Trabajo" })).toBeTruthy();
    expect(document.querySelector(".dense-head__desc")?.textContent).toBe(
      "Revisiones, pedidos, cierres y vencimientos que requieren una decisión.",
    );
    expect(screen.getByRole("button", { name: "Actualizar" }).className).toContain(
      "ds-button--ghost",
    );
    expect(screen.queryByRole("button", { name: "Iniciar cierre" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pedir documentación" })).toBeNull();
  });

  it("con period.soft_close muestra «Iniciar cierre» ghost; con request.manage, «Pedir documentación» primario", async () => {
    usarContexto(["client.read", "period.soft_close"]);
    renderTrabajo();
    const iniciar = await screen.findByRole("button", { name: "Iniciar cierre" });
    await waitFor(() => expect((iniciar as HTMLButtonElement).disabled).toBe(false));
    expect(iniciar.className).toContain("ds-button--ghost");
    expect(screen.queryByRole("button", { name: "Pedir documentación" })).toBeNull();

    cleanup();
    usarContexto(["client.read", "request.manage"]);
    renderTrabajo();
    const pedir = await screen.findByRole("button", { name: "Pedir documentación" });
    expect(pedir.className).toContain("ds-button--primary");
    expect(screen.queryByRole("button", { name: "Iniciar cierre" })).toBeNull();
  });

  it("con todas las capacidades hay una sola acción primaria en el encabezado", async () => {
    renderTrabajo();
    await screen.findByRole("heading", { level: 1, name: "Trabajo" });
    const acciones = document.querySelector(".dense-head__actions");
    const primarias = acciones?.querySelectorAll(".ds-button--primary") ?? [];
    expect(primarias.length).toBe(1);
    expect(primarias[0]?.textContent).toBe("Pedir documentación");
  });
});

describe("K2 · banda de cifras", () => {
  it("con datos cuenta pedidos abiertos, cierres en curso y obligaciones del período contable", async () => {
    responderApi({
      pedidos: [
        { id: "request-1", title: "Demo: Extractos bancarios", status: "DRAFT", items: [] },
        {
          id: "request-2",
          title: "Demo: Certificados de retención",
          status: "SENT",
          items: [],
        },
      ],
      cierres: [
        { id: "close-1", status: "IN_PROGRESS", workItems: [] },
        { id: "close-3", status: "FINALIZED", workItems: [] },
      ],
      obligaciones: [
        OBLIGACION_OCTUBRE_PENDIENTE,
        OBLIGACION_OCTUBRE_PRESENTADA,
        OBLIGACION_NOVIEMBRE,
      ],
    });
    renderTrabajo();
    await waitFor(() => {
      expect(estadistica("Pedidos abiertos").valor).toBe("2");
      expect(estadistica("Cierres en curso").valor).toBe("1");
      expect(estadistica("Obligaciones").valor).toBe("2");
    });
    expect(estadistica("Pedidos abiertos").alerta).toBe(true);
    expect(estadistica("Cierres en curso").alerta).toBe(false);
  });

  it("mientras las consultas están pendientes, la banda muestra 0 en las tres cifras", () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => undefined)) as never);
    renderTrabajo();
    // vigente: cambia con D7C-17 (hoy 0 mientras carga; el corte 7c.2 muestra «pendiente»)
    expect(estadistica("Pedidos abiertos").valor).toBe("0");
    expect(estadistica("Cierres en curso").valor).toBe("0");
    expect(estadistica("Obligaciones").valor).toBe("0");
  });
});
