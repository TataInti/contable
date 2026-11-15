// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function pedido(datos: Record<string, unknown>) {
  return { id: "request-1", title: "Demo: Extractos bancarios", status: "DRAFT", items: [], ...datos };
}

function pedidosDemo() {
  return [
    pedido({
      id: "request-1",
      title: "Demo: Extractos bancarios",
      status: "DRAFT",
      items: [
        { id: "item-1", description: "Demo: extracto de octubre", required: true, status: "ATTACHED" },
        { id: "item-2", description: "Demo: comprobante de pago", required: true, status: "PENDING" },
        { id: "item-4", description: "Demo: resumen aceptado", required: true, status: "ACCEPTED" },
      ],
    }),
    pedido({
      id: "request-2",
      title: "Demo: Certificados de retención",
      status: "SENT",
      items: [{ id: "item-3", description: "Demo: certificado", required: false, status: "PENDING" }],
    }),
  ];
}

function seccion(id: string) {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error(`Falta la sección #${id}`);
  return within(elemento);
}

async function filaDePedido(titulo: string) {
  const celda = await seccion("work-requests-section").findByText(titulo);
  const fila = celda.closest("tr");
  if (!fila) throw new Error(`No hay fila para «${titulo}»`);
  return within(fila);
}

async function abrirIniciarCierre() {
  const boton = await screen.findByRole("button", { name: "Iniciar cierre" });
  await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(boton);
  return screen.getByRole("dialog", { name: "Iniciar cierre del período" });
}

describe("K3 · pedidos documentales", () => {
  it("lista cada pedido con sus ítems pendientes, su estado y las acciones de la capacidad", async () => {
    responderApi({ pedidos: pedidosDemo() });
    renderTrabajo();
    const borrador = await filaDePedido("Demo: Extractos bancarios");
    expect(borrador.getByText("2 ítems pendientes")).toBeTruthy();
    expect(borrador.getByText("Borrador")).toBeTruthy();
    expect(borrador.getByRole("button", { name: "Ver" })).toBeTruthy();
    expect(borrador.getByRole("button", { name: "Mensaje" })).toBeTruthy();
    expect(borrador.getByRole("button", { name: "Enviar pedido" })).toBeTruthy();
    expect(borrador.getByRole("button", { name: "Revisar" })).toBeTruthy();
    const enviado = await filaDePedido("Demo: Certificados de retención");
    expect(enviado.getByText("Enviado")).toBeTruthy();
    expect(enviado.queryByRole("button", { name: "Ver" })).toBeNull();
    expect(enviado.queryByRole("button", { name: "Enviar pedido" })).toBeNull();
    expect(enviado.getByRole("button", { name: "Revisar" })).toBeTruthy();
    expect(document.querySelector("#work-requests-section .section-count")?.textContent).toBe("2");
  });

  it("sin request.manage ni message.shared, la fila no ofrece Enviar, Revisar ni Mensaje", async () => {
    usarContexto(["client.read"]);
    responderApi({ pedidos: pedidosDemo() });
    renderTrabajo();
    const fila = await filaDePedido("Demo: Extractos bancarios");
    expect(fila.queryByRole("button", { name: "Mensaje" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Enviar pedido" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Revisar" })).toBeNull();
    expect(fila.getByRole("button", { name: "Ver" })).toBeTruthy();
  });

  it("«Enviar pedido» envía el pedido al portal sin pedir confirmación", async () => {
    responderApi({ pedidos: pedidosDemo() });
    renderTrabajo();
    const fila = await filaDePedido("Demo: Extractos bancarios");
    fireEvent.click(fila.getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText("Pedido enviado al portal del cliente.")).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith(`${BASE}/document-requests/request-1/send`);
    // vigente: cambia con D7C-1 (hoy el envío no pide confirmación)
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("K4 · pedidos cancelados", () => {
  it("un pedido CANCELLED cuenta como abierto y aparece en la lista", async () => {
    responderApi({
      pedidos: [pedido({ id: "request-3", title: "Demo: Pedido cancelado", status: "CANCELLED" })],
    });
    renderTrabajo();
    const fila = await filaDePedido("Demo: Pedido cancelado");
    // vigente: cambia con D7C-4 (hoy el pedido cancelado cuenta como abierto y se lista)
    await waitFor(() => expect(estadistica("Pedidos abiertos").valor).toBe("1"));
    expect(fila.getByText("Cancelado")).toBeTruthy();
  });
});

describe("K5 · error de una consulta", () => {
  it("si falla la de pedidos, la sección muestra «Sin pedidos abiertos» y el aviso sin Reintentar", async () => {
    vi.mocked(api.get).mockImplementation(((ruta: string) => {
      if (ruta === `${BASE}/document-requests`) {
        return Promise.reject(new Error("Demo: falla de pedidos"));
      }
      return Promise.resolve(ruta === `${BASE}/fiscal-years` ? ANIOS_DEMO : []);
    }) as never);
    renderTrabajo();
    // vigente: cambia con D7C-16 (un aviso genérico en lugar de un error por sección)
    expect(await screen.findByText("Parte de la información no pudo cargarse.")).toBeTruthy();
    // vigente: cambia con D7C-16 (el error de pedidos se ve como vacío)
    expect(seccion("work-requests-section").getByText("Sin pedidos abiertos")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("si falla la de obligaciones, su sección también se ve como vacía", async () => {
    vi.mocked(api.get).mockImplementation(((ruta: string) => {
      if (ruta === `${BASE}/tax-obligations`) {
        return Promise.reject(new Error("Demo: falla de obligaciones"));
      }
      return Promise.resolve(ruta === `${BASE}/fiscal-years` ? ANIOS_DEMO : []);
    }) as never);
    renderTrabajo();
    // vigente: cambia con D7C-16 (el error de obligaciones se ve como vacío)
    expect(
      await seccion("work-obligations-section").findByText("Sin obligaciones materializadas"),
    ).toBeTruthy();
  });
});

describe("K6 · alta de pedido", () => {
  async function abrirNuevoPedido() {
    fireEvent.click(await screen.findByRole("button", { name: "Pedir documentación" }));
    return screen.getByRole("dialog", { name: "Nuevo pedido" });
  }

  it("crea el pedido con sus campos, notifica, cierra el cajón y lo deja vacío", async () => {
    renderTrabajo();
    await abrirNuevoPedido();
    const dialogo = screen.getByRole("dialog", { name: "Nuevo pedido" });
    const crear = within(dialogo).getByRole("button", { name: "Crear pedido" }) as HTMLButtonElement;
    expect(crear.disabled).toBe(true);
    fireEvent.change(document.getElementById("request-title") as HTMLInputElement, {
      target: { value: "Demo: Extractos bancarios" },
    });
    fireEvent.change(document.getElementById("request-item") as HTMLInputElement, {
      target: { value: "Demo: extracto de octubre" },
    });
    fireEvent.change(document.getElementById("request-description") as HTMLTextAreaElement, {
      target: { value: "Demo: período de octubre" },
    });
    fireEvent.change(document.getElementById("request-due") as HTMLInputElement, {
      target: { value: "2026-11-30" },
    });
    expect(crear.disabled).toBe(false);
    fireEvent.click(crear);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/document-requests`, {
        title: "Demo: Extractos bancarios",
        description: "Demo: período de octubre",
        dueDate: "2026-11-30",
        items: [{ description: "Demo: extracto de octubre", required: true }],
      }),
    );
    expect(
      await screen.findByText("Pedido creado. Quedó disponible para el seguimiento con el cliente."),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nuevo pedido" })).toBeNull());
    await abrirNuevoPedido();
    expect((document.getElementById("request-title") as HTMLInputElement).value).toBe("");
  });

  it("si la API rechaza el alta, muestra el texto fijo de error y deja el cajón abierto", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Demo: rechazo de la API"));
    renderTrabajo();
    await abrirNuevoPedido();
    fireEvent.change(document.getElementById("request-title") as HTMLInputElement, {
      target: { value: "Demo: Extractos" },
    });
    fireEvent.change(document.getElementById("request-item") as HTMLInputElement, {
      target: { value: "Demo: extracto" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Nuevo pedido" })).getByRole("button", {
        name: "Crear pedido",
      }),
    );
    // vigente: cambia en 7c.3 (T-7, sin decisión: el error se muestra junto al campo)
    expect(
      await screen.findByText("No se pudo crear el pedido. Revisá los datos e intentá nuevamente."),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Nuevo pedido" })).toBeTruthy();
  });
});

describe("K7 · inicio de cierre", () => {
  it("abre el cajón con cuatro tareas, cuenta las no vacías y crea el ciclo con códigos CIERRE_n", async () => {
    renderTrabajo();
    const dialogo = await abrirIniciarCierre();
    const tareas = dialogo.querySelector("#close-items") as HTMLTextAreaElement;
    expect(tareas.value).toBe(
      "Revisar documentación\nConciliar saldos\nValidar obligaciones\nPreparar cierre",
    );
    expect(within(dialogo).getByText("Se crearán 4 tareas.")).toBeTruthy();
    fireEvent.change(tareas, { target: { value: "Demo: tarea uno\n\nDemo: tarea dos" } });
    expect(within(dialogo).getByText("Se crearán 2 tareas.")).toBeTruthy();
    fireEvent.change(tareas, {
      target: {
        value: "Revisar documentación\nConciliar saldos\nValidar obligaciones\nPreparar cierre",
      },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Crear ciclo de cierre" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/close-cycles`, {
        fiscalYearId: "fy-a",
        periodId: "period-a",
        items: [
          { code: "CIERRE_1_Revisar_documentacion", title: "Revisar documentación" },
          { code: "CIERRE_2_Conciliar_saldos", title: "Conciliar saldos" },
          { code: "CIERRE_3_Validar_obligaciones", title: "Validar obligaciones" },
          { code: "CIERRE_4_Preparar_cierre", title: "Preparar cierre" },
        ],
      }),
    );
    expect(
      await screen.findByText(
        "Cierre iniciado. Las tareas quedan disponibles para control y finalización.",
      ),
    ).toBeTruthy();
  });

  it("sin período contable abierto, «Iniciar cierre» queda deshabilitado con el motivo en title", async () => {
    responderApi({ anios: [] });
    renderTrabajo();
    const boton = await screen.findByRole("button", { name: "Iniciar cierre" });
    // vigente: cambia en 7c.3 (el motivo no se ve en pantalla; sin decisión)
    expect(boton.getAttribute("title")).toBe("Seleccioná un período contable para abrir el cierre");
    expect((boton as HTMLButtonElement).disabled).toBe(true);
  });

  it("si la API rechaza el ciclo, muestra su mensaje crudo dentro del cajón", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Demo: falla al crear el ciclo"));
    renderTrabajo();
    const dialogo = await abrirIniciarCierre();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Crear ciclo de cierre" }));
    // vigente: cambia en 7c.3 (T-7, sin decisión: el texto crudo de la API)
    expect(await within(dialogo).findByText("Demo: falla al crear el ciclo")).toBeTruthy();
  });
});
