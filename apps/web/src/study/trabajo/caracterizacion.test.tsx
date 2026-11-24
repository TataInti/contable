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

function cierresDemo() {
  return [
    {
      id: "close-1",
      status: "IN_PROGRESS",
      workItems: [
        { id: "wi-1", title: "Demo: Revisar documentación", status: "DONE" },
        { id: "wi-2", title: "Demo: Conciliar saldos", status: "DONE" },
        { id: "wi-3", title: "Demo: Validar obligaciones", status: "PENDING" },
      ],
    },
    { id: "close-2", status: "IN_PROGRESS", workItems: [] },
    {
      id: "close-3",
      status: "FINALIZED",
      workItems: [{ id: "wi-4", title: "Demo: Preparar cierre", status: "DONE" }],
    },
  ];
}

describe("K8 · cierres", () => {
  it("muestra estado, avance N de M y «Completar» con la primera tarea no hecha, sin confirmación", async () => {
    responderApi({ cierres: cierresDemo() });
    renderTrabajo();
    const cierres = seccion("work-closes-section");
    const completar = await cierres.findByRole("button", {
      name: "Completar: Demo: Validar obligaciones",
    });
    expect(cierres.getByLabelText("2 de 3 tareas completas")).toBeTruthy();
    expect(cierres.getAllByText("En proceso")).toHaveLength(2);
    expect(document.querySelector("#work-closes-section .section-count")?.textContent).toBe("2");
    fireEvent.click(completar);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/close-cycles/close-1/work-items/wi-3/complete`,
      ),
    );
    // vigente: cambia con D7C-1 (pregunta anexa: «Completar» no pide confirmación)
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("un ciclo sin tareas no tiene acción ni mensaje", async () => {
    responderApi({ cierres: cierresDemo() });
    renderTrabajo();
    const progreso = await seccion("work-closes-section").findByLabelText("0 de 0 tareas completas");
    const acciones = progreso.closest("tr")?.querySelector(".table-actions");
    // vigente: cambia con D7C-12 (un ciclo sin tareas queda sin acción ni explicación)
    expect(acciones?.querySelector("button")).toBeNull();
  });

  it("«Finalizar cierre» aparece con todas las tareas hechas y pide confirmación con su texto", async () => {
    responderApi({
      cierres: [
        {
          id: "close-4",
          status: "IN_PROGRESS",
          workItems: [{ id: "wi-5", title: "Demo: Preparar cierre", status: "DONE" }],
        },
      ],
    });
    renderTrabajo();
    fireEvent.click(
      await seccion("work-closes-section").findByRole("button", { name: "Finalizar cierre" }),
    );
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("¿Finalizar este cierre?")).toBeTruthy();
    expect(
      within(dialogo).getByText(
        "El ciclo quedará bloqueado para auditoría y no podrá volver a un estado anterior.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Finalizar cierre" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/close-cycles/close-4/finalize`),
    );
  });

  it("sin period.soft_close, la columna de acciones muestra «—»", async () => {
    usarContexto(["client.read"]);
    responderApi({ cierres: cierresDemo() });
    renderTrabajo();
    const progreso = await seccion("work-closes-section").findByLabelText("2 de 3 tareas completas");
    const fila = progreso.closest("tr") as HTMLElement;
    expect(within(fila).getByText("—")).toBeTruthy();
    expect(within(fila).queryByRole("button")).toBeNull();
  });

  it("sin ciclos abiertos muestra «Cierres» con 0 y «Iniciar cierre» que abre el cajón", async () => {
    responderApi({ cierres: [{ id: "close-3", status: "FINALIZED", workItems: [] }] });
    renderTrabajo();
    expect(await seccion("work-closes-section").findByText("Cierres")).toBeTruthy();
    await waitFor(() =>
      expect(
        seccion("work-closes-section").getByRole("button", { name: "Iniciar cierre" }),
      ).toBeTruthy(),
    );
    fireEvent.click(seccion("work-closes-section").getByRole("button", { name: "Iniciar cierre" }));
    expect(screen.getByRole("dialog", { name: "Iniciar cierre del período" })).toBeTruthy();
  });
});

describe("K9 · próximas obligaciones", () => {
  it("muestra impuesto · jurisdicción, período, vencimiento y estado solo del período contable", async () => {
    responderApi({
      obligaciones: [OBLIGACION_OCTUBRE_PENDIENTE, OBLIGACION_OCTUBRE_PRESENTADA, OBLIGACION_NOVIEMBRE],
    });
    renderTrabajo();
    const obligaciones = seccion("work-obligations-section");
    const filaConVencimiento = (
      await obligaciones.findByText("IVA · Demo: Nacional")
    ).closest("tr") as HTMLElement;
    expect(within(filaConVencimiento).getByText("Demo: octubre 2026")).toBeTruthy();
    expect(within(filaConVencimiento).getByText("20/10/2026")).toBeTruthy();
    expect(within(filaConVencimiento).getByText("Pendiente")).toBeTruthy();
    const filaSinVencimiento = obligaciones
      .getByText("Ingresos Brutos · Demo: Tucumán")
      .closest("tr") as HTMLElement;
    expect(within(filaSinVencimiento).getByText("01/10/2026 al 31/10/2026")).toBeTruthy();
    // vigente: cambia con D7C-3 (sin vencimiento, la celda muestra el fin del período)
    expect(within(filaSinVencimiento).getByText("31/10/2026")).toBeTruthy();
    expect(within(filaSinVencimiento).getByText("Presentado")).toBeTruthy();
    // vigente: cambia con D7C-5 (el título dice «Próximas» y la lista trae todos los estados)
    expect(screen.getByRole("heading", { level: 2, name: "Próximas obligaciones" })).toBeTruthy();
    expect(document.querySelector("#work-obligations-section .section-count")?.textContent).toBe(
      "2",
    );
  });

  it("sin período contable seleccionado, lista todas las obligaciones del cliente", async () => {
    usarContexto(CAPACIDADES_TODAS, "period-z");
    responderApi({
      obligaciones: [OBLIGACION_OCTUBRE_PENDIENTE, OBLIGACION_OCTUBRE_PRESENTADA, OBLIGACION_NOVIEMBRE],
    });
    renderTrabajo();
    await waitFor(() =>
      expect(
        document.querySelector("#work-obligations-section .section-count")?.textContent,
      ).toBe("3"),
    );
  });

  it("sin obligaciones, «Configurar obligaciones» navega a la configuración fiscal", async () => {
    responderApi({ obligaciones: [] });
    renderTrabajo();
    expect(
      await seccion("work-obligations-section").findByText("Sin vencimientos configurados para este cliente."),
    ).toBeTruthy();
    fireEvent.click(
      seccion("work-obligations-section").getByRole("button", { name: "Configurar obligaciones" }),
    );
    expect(navegar).toHaveBeenCalledWith("/configuracion-fiscal");
  });
});

describe("K10 · revisión de ítems", () => {
  const pedidoConAdjuntos = () => [
    pedido({
      id: "request-1",
      title: "Demo: Extractos bancarios",
      status: "DRAFT",
      items: [
        { id: "item-1", description: "Demo: extracto de octubre", required: true, status: "ATTACHED" },
        { id: "item-2", description: "Demo: comprobante de pago", required: false, status: "ATTACHED" },
        { id: "item-4", description: "Demo: resumen aceptado", required: true, status: "ACCEPTED" },
      ],
    }),
  ];

  async function abrirRevision() {
    const fila = await filaDePedido("Demo: Extractos bancarios");
    fireEvent.click(fila.getByRole("button", { name: "Revisar" }));
    return screen.getByRole("dialog", { name: "Revisión de ítems" });
  }

  it("muestra el estado crudo del pedido y de cada ítem; los botones solo en ítems adjuntados", async () => {
    responderApi({ pedidos: pedidoConAdjuntos() });
    renderTrabajo();
    const dialogo = await abrirRevision();
    // vigente: cambia con D7C-13 (el estado del pedido se muestra crudo)
    expect(dialogo.querySelector(".study-page__hint strong")?.textContent).toBe("DRAFT");
    const items = dialogo.querySelectorAll<HTMLElement>(".request-review-list__item");
    expect(items.length).toBe(3);
    // vigente: cambia con D7C-13 (el estado de cada ítem se muestra crudo)
    expect(items[0]?.querySelector("small")?.textContent).toBe("Requerido · ATTACHED");
    expect(items[2]?.querySelector("small")?.textContent).toBe("Requerido · ACCEPTED");
    expect(within(items[0] as HTMLElement).getByRole("button", { name: "Aceptar" })).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByRole("button", { name: "Eximir" })).toBeTruthy();
    const rechazar = within(items[0] as HTMLElement).getByRole("button", { name: "Rechazar" });
    expect((rechazar as HTMLButtonElement).disabled).toBe(true);
    expect(within(items[2] as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("el motivo de rechazo es uno solo para todos los ítems y «Rechazar» lo envía con el ítem", async () => {
    responderApi({ pedidos: pedidoConAdjuntos() });
    renderTrabajo();
    const dialogo = await abrirRevision();
    fireEvent.change(dialogo.querySelector("#request-reject-reason") as HTMLTextAreaElement, {
      target: { value: "Demo: falta el anverso" },
    });
    const items = dialogo.querySelectorAll<HTMLElement>(".request-review-list__item");
    fireEvent.click(within(items[1] as HTMLElement).getByRole("button", { name: "Rechazar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/document-requests/request-1/items/item-2/reject`,
        { reason: "Demo: falta el anverso" },
      ),
    );
    expect(
      await screen.findByText("Ítem rechazado y devuelto al cliente con el motivo indicado."),
    ).toBeTruthy();
  });

  it("«Aceptar» y «Eximir» actúan sobre su ítem y no piden confirmación", async () => {
    responderApi({ pedidos: pedidoConAdjuntos() });
    renderTrabajo();
    const dialogo = await abrirRevision();
    const primero = dialogo.querySelectorAll<HTMLElement>(".request-review-list__item")[0];
    fireEvent.click(within(primero as HTMLElement).getByRole("button", { name: "Aceptar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/document-requests/request-1/items/item-1/accept`,
      ),
    );
    const segundo = dialogo.querySelectorAll<HTMLElement>(".request-review-list__item")[1];
    fireEvent.click(within(segundo as HTMLElement).getByRole("button", { name: "Eximir" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/document-requests/request-1/items/item-2/waive`,
      ),
    );
    // vigente: cambia con D7C-1 (Eximir no pide confirmación)
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("K11 · documento adjunto", () => {
  const VISTA_PDF = {
    url: "https://example.test/demo/extracto.pdf",
    mimeType: "application/pdf",
    originalName: "Demo-extracto.pdf",
  };
  const VISTA_PNG = {
    url: "https://example.test/demo/comprobante.png",
    mimeType: "image/png",
    originalName: "Demo-comprobante.png",
  };

  function responderVistaPrevia(vista: unknown) {
    vi.mocked(api.get).mockImplementation(((ruta: string) => {
      if (ruta === `${BASE}/document-request-items/item-1/preview`) return Promise.resolve(vista);
      if (ruta === `${BASE}/document-requests`) return Promise.resolve(pedidosDemo());
      return Promise.resolve(ruta === `${BASE}/fiscal-years` ? ANIOS_DEMO : []);
    }) as never);
  }

  async function verAdjunto() {
    const fila = await filaDePedido("Demo: Extractos bancarios");
    fireEvent.click(fila.getByRole("button", { name: "Ver" }));
  }

  it("un PDF se muestra en un iframe con enlace de pestaña nueva", async () => {
    responderVistaPrevia(VISTA_PDF);
    renderTrabajo();
    await verAdjunto();
    const dialogo = await screen.findByRole("dialog", { name: "Documento adjunto" });
    expect(within(dialogo).getByText("Demo-extracto.pdf")).toBeTruthy();
    expect(dialogo.querySelector("iframe.evidence-preview__frame")?.getAttribute("src")).toBe(
      VISTA_PDF.url,
    );
    expect(dialogo.querySelector("img")).toBeNull();
    const enlace = dialogo.querySelector("a.evidence-preview__link");
    expect(enlace?.getAttribute("href")).toBe(VISTA_PDF.url);
    expect(enlace?.getAttribute("target")).toBe("_blank");
    expect(enlace?.getAttribute("rel")).toBe("noreferrer");
  });

  it("una imagen se muestra en un img, sin iframe", async () => {
    responderVistaPrevia(VISTA_PNG);
    renderTrabajo();
    await verAdjunto();
    const dialogo = await screen.findByRole("dialog", { name: "Documento adjunto" });
    expect(dialogo.querySelector("img.evidence-preview__image")?.getAttribute("src")).toBe(
      VISTA_PNG.url,
    );
    expect(dialogo.querySelector("iframe")).toBeNull();
  });

  it("si la vista previa falla, no abre el cajón ni muestra el error", async () => {
    vi.mocked(api.get).mockImplementation(((ruta: string) => {
      if (ruta === `${BASE}/document-request-items/item-1/preview`) {
        return Promise.reject(new Error("Demo: falla de vista previa"));
      }
      if (ruta === `${BASE}/document-requests`) return Promise.resolve(pedidosDemo());
      return Promise.resolve(ruta === `${BASE}/fiscal-years` ? ANIOS_DEMO : []);
    }) as never);
    renderTrabajo();
    await verAdjunto();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(`${BASE}/document-request-items/item-1/preview`),
    );
    // vigente: cambia en 7c.3 (T-10, sin decisión: la vista previa no muestra su error)
    expect(screen.queryByRole("dialog", { name: "Documento adjunto" })).toBeNull();
    expect(screen.queryByText("Demo: falla de vista previa")).toBeNull();
  });
});

describe("K12 · conversación", () => {
  const pedidosConHilos = () => [
    pedido({
      id: "request-1",
      title: "Demo: Extractos bancarios",
      status: "DRAFT",
      items: [],
      threads: [{ id: "thread-1", visibility: "SHARED", messages: [] }],
    }),
    pedido({
      id: "request-2",
      title: "Demo: Certificados de retención",
      status: "SENT",
      items: [],
      threads: [
        {
          id: "thread-2",
          visibility: "SHARED",
          messages: [
            {
              id: "msg-1",
              authorUserId: "user-a",
              body: "Demo: por favor subir el extracto",
              visibility: "SHARED",
              createdAt: "2026-10-15T14:30:00Z",
            },
            {
              id: "msg-2",
              authorUserId: "user-b",
              body: "Demo: nota interna",
              visibility: "INTERNAL",
              createdAt: "2026-10-15T15:00:00Z",
            },
          ],
        },
      ],
    }),
    pedido({ id: "request-3", title: "Demo: Pedido sin hilo", status: "SENT", items: [] }),
  ];

  async function abrirMensaje(titulo: string) {
    const fila = await filaDePedido(titulo);
    fireEvent.click(fila.getByRole("button", { name: "Mensaje" }));
    return screen.findByRole("dialog", { name: "Conversación" });
  }

  it("con hilo compartido sin mensajes muestra el vacío y el formulario, sin crear hilo", async () => {
    responderApi({ pedidos: pedidosConHilos() });
    renderTrabajo();
    const dialogo = await abrirMensaje("Demo: Extractos bancarios");
    expect(within(dialogo).getByText("Todavía no hay mensajes")).toBeTruthy();
    expect(dialogo.querySelector("#request-message")).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sin hilo compartido, «Mensaje» crea el hilo y abre la conversación", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "thread-3", visibility: "SHARED", messages: [] });
    responderApi({ pedidos: pedidosConHilos() });
    renderTrabajo();
    await abrirMensaje("Demo: Pedido sin hilo");
    expect(api.post).toHaveBeenCalledWith(`${BASE}/document-requests/request-3/threads`, {
      visibility: "SHARED",
    });
  });

  it("muestra cada mensaje como Compartido o Interno, con su cuerpo y solo la fecha", async () => {
    responderApi({ pedidos: pedidosConHilos() });
    renderTrabajo();
    const dialogo = await abrirMensaje("Demo: Certificados de retención");
    expect(within(dialogo).getByText("Compartido")).toBeTruthy();
    expect(within(dialogo).getByText("Interno")).toBeTruthy();
    expect(within(dialogo).getByText("Demo: por favor subir el extracto")).toBeTruthy();
    // vigente: cambia en 7c.3 (T-9, sin decisión: hoy la fecha se muestra sin hora)
    expect(dialogo.querySelector(".request-message-list__item small")?.textContent).toBe(
      "15/10/2026",
    );
  });

  it("«Enviar mensaje» envía el texto compartido y lo limpia", async () => {
    responderApi({ pedidos: pedidosConHilos() });
    renderTrabajo();
    const dialogo = await abrirMensaje("Demo: Extractos bancarios");
    const enviar = within(dialogo).getByRole("button", { name: "Enviar mensaje" });
    expect((enviar as HTMLButtonElement).disabled).toBe(true);
    const texto = dialogo.querySelector("#request-message") as HTMLTextAreaElement;
    fireEvent.change(texto, { target: { value: "Demo: enviar el extracto" } });
    expect((enviar as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/threads/thread-1/messages`, {
        body: "Demo: enviar el extracto",
        visibility: "SHARED",
      }),
    );
    expect(await screen.findByText("Mensaje enviado al pedido documental.")).toBeTruthy();
  });

  it("si la API rechaza el mensaje, muestra su texto dentro de la conversación", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Demo: falla al enviar"));
    responderApi({ pedidos: pedidosConHilos() });
    renderTrabajo();
    const dialogo = await abrirMensaje("Demo: Extractos bancarios");
    fireEvent.change(dialogo.querySelector("#request-message") as HTMLTextAreaElement, {
      target: { value: "Demo: enviar el extracto" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Enviar mensaje" }));
    expect(await within(dialogo).findByText("Demo: falla al enviar")).toBeTruthy();
  });
});

describe("K13 · actualizar", () => {
  it("«Actualizar» vuelve a consultar tres fuentes, sin los años fiscales, y no muestra estado", async () => {
    responderApi({ pedidos: pedidosDemo() });
    renderTrabajo();
    await filaDePedido("Demo: Extractos bancarios");
    vi.mocked(api.get).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    // vigente: cambia con D7C-18 (hoy no se muestra «Actualizando…»)
    expect(screen.queryByText(/Actualizando/)).toBeNull();
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBe(3));
    // vigente: cambia con D7C-18 (tres consultas; los años fiscales no se vuelven a pedir)
    const rutas = vi.mocked(api.get).mock.calls.map((llamada) => llamada[0]).sort();
    expect(rutas).toEqual([
      `${BASE}/close-cycles`,
      `${BASE}/document-requests`,
      `${BASE}/tax-obligations`,
    ]);
  });
});
