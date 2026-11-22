// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api, ApiError, uploadToSignedUrl } from "../../lib/api";
import { StudyBandeja } from "../StudyBandeja";
import { cambiarValor } from "../../test/elegirOpcion";

// Caracterización del cajón «Nuevo documento» (Foco 7b.1, pruebas K3, K4 y K5).
// Fija lo que hace hoy la pantalla antes y después de mover la carga a su archivo.
// Datos sintéticos: cliente de prueba, pedido «Marzo 2026», archivos ticket-compra.pdf y nota.txt.

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
let testQueryClient: QueryClient | null = null;

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: { firms: [{ firmId: "firm-a", firmName: "Estudio Demo" }] },
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
    uploadToSignedUrl: vi.fn(),
  };
});

const BASE = "/firms/firm-a/clients/client-a";

const documentFixture = {
  id: "document-a",
  status: "UPLOADED",
  createdAt: "2026-10-31T12:00:00.000Z",
  category: null,
  direction: null,
  fileVersions: [
    { originalName: "comprobante-previo.pdf", mimeType: "application/pdf", bucket: "originals" },
  ],
  processingJobs: [] as { id: string; type: string; status: string; progress: number }[],
};

const pedidosFixture = [
  {
    id: "request-a",
    title: "Marzo 2026",
    items: [
      { id: "item-a", description: "Factura de compra", status: "PENDING" },
      { id: "item-b", description: "Recibo de pago", status: "COMPLETED" },
    ],
  },
];

function fijarContexto(
  capacidades: string[] = ["client.read", "document.upload"],
  clientId: string | null = "client-a",
) {
  contextMock.current = {
    firmId: "firm-a",
    clientId,
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function mockApi(pedidos: () => Promise<unknown>) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/document-requests")) return pedidos();
    if (path.endsWith("/documents")) return Promise.resolve([structuredClone(documentFixture)]);
    if (path.endsWith("/documents/document-a"))
      return Promise.resolve(structuredClone(documentFixture));
    return Promise.resolve([]);
  }) as never);
}

function renderBandeja() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  testQueryClient = client;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UbicacionActual />
        <StudyBandeja />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function UbicacionActual() {
  const location = useLocation();
  return <output data-testid="ubicacion-actual">{location.pathname}{location.search}</output>;
}

const selectorItem = () => document.querySelector<HTMLSelectElement>("#upload-request-item");
const inputArchivo = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const botonSubir = () =>
  screen.getByRole("button", { name: "Subir y procesar" }) as HTMLButtonElement;

function archivo(nombre: string, tipo: string, bytes = [37, 80, 68, 70], tamanio?: number) {
  const file = new File([new Uint8Array(bytes)], nombre, { type: tipo });
  if (tamanio !== undefined) Object.defineProperty(file, "size", { value: tamanio });
  return file;
}

function seleccionarItem(id: string) {
  cambiarValor(selectorItem()!, id);
}

async function abrirCajonDeCarga() {
  renderBandeja();
  fireEvent.click(await screen.findByRole("button", { name: "Subir documento" }));
  return screen.findByRole("dialog", { name: "Nuevo documento" });
}

async function abrirCajonConPedidos() {
  const dialog = await abrirCajonDeCarga();
  await waitFor(() => expect(selectorItem()).not.toBeNull());
  return dialog;
}

function llamadasA(sufijo: string) {
  return vi.mocked(api.get).mock.calls.filter(([path]) => String(path).endsWith(sufijo));
}

beforeEach(() => {
  vi.resetAllMocks();
  documentFixture.status = "UPLOADED";
  documentFixture.processingJobs = [];
  fijarContexto();
  mockApi(() => Promise.resolve(structuredClone(pedidosFixture)));
  vi.mocked(api.post).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
  testQueryClient = null;
});

describe("Caracterización K3 · validación del archivo", () => {
  it("acepta en el selector los formatos para la Bandeja y explica a dónde va cada uno", async () => {
    await abrirCajonConPedidos();
    expect(inputArchivo().accept).toContain(".xlsx");
    expect(inputArchivo().accept).toContain(".xls");
    expect(inputArchivo().accept).toContain(".csv");
    expect(inputArchivo().accept).toContain(".txt");
    expect(
      screen.getByText(
        "PDF o foto: los lee la IA · Excel, CSV o TXT de ARCA y la DGR: van al Legajo",
      ),
    ).toBeTruthy();
  });

  it.each([
    {
      extension: "xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { extension: "xls", mime: "application/vnd.ms-excel" },
    { extension: "csv", mime: "text/csv" },
    { extension: "txt", mime: "text/plain" },
  ])("dirige un .$extension al Legajo sin iniciar la subida", async ({ extension, mime }) => {
    await abrirCajonConPedidos();
    fireEvent.change(inputArchivo(), {
      target: { files: [archivo(`libro.${extension}`, mime)] },
    });
    expect(await screen.findByText("Elegí el archivo de nuevo en Importar libro.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ir a Importar en el Legajo" }));
    expect(screen.getByTestId("ubicacion-actual").textContent).toBe("/expediente-mensual?etapa=fuentes");
    expect(api.post).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("rechaza un PDF mayor a 25 MB antes de subirlo con el camino alternativo visible", async () => {
    await abrirCajonConPedidos();
    const pdf = archivo("libro.pdf", "application/pdf", undefined, 26 * 1024 * 1024);
    fireEvent.change(inputArchivo(), { target: { files: [pdf] } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Este PDF pesa 26 MB y el máximo es 25 MB. Si es un libro de ARCA, bajalo en Excel e importalo en el Legajo.",
    );
    expect(botonSubir().disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("sin archivo comunica «Elegí un archivo para continuar.» y no habilita la subida", async () => {
    await abrirCajonConPedidos();
    fireEvent.change(inputArchivo(), { target: { files: [] } });
    expect((await screen.findByRole("alert")).textContent).toBe("Elegí un archivo para continuar.");
    expect(botonSubir().disabled).toBe(true);
  });

  it.each([
    { caso: "un tipo no admitido", crear: () => archivo("nota.docx", "application/octet-stream") },
    {
      caso: "una imagen de más de 25 MB",
      crear: () => archivo("escaneo.jpg", "image/jpeg", undefined, 25 * 1024 * 1024 + 1),
    },
  ])("rechaza $caso con el formato permitido y no lo elige", async ({ crear }) => {
    await abrirCajonConPedidos();
    fireEvent.change(inputArchivo(), { target: { files: [crear()] } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Elegí un PDF, JPG, PNG o WebP de hasta 25 MB.",
    );
    expect(botonSubir().disabled).toBe(true);
    expect(screen.getByText("Arrastrá un archivo o elegilo desde tu equipo")).toBeTruthy();
  });

  it("25 MB exactos se aceptan y el archivo elegido muestra nombre y tamaño", async () => {
    await abrirCajonConPedidos();
    fireEvent.change(inputArchivo(), {
      target: { files: [archivo("escaneo.pdf", "application/pdf", undefined, 25 * 1024 * 1024)] },
    });
    expect(screen.getByText("escaneo.pdf")).toBeTruthy();
    expect(screen.getByText("25 MB")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("una foto pequeña sigue seleccionada para el flujo de documentos", async () => {
    await abrirCajonConPedidos();
    seleccionarItem("item-a");
    fireEvent.change(inputArchivo(), {
      target: { files: [archivo("ticket.jpg", "image/jpeg", [255, 216, 255])] },
    });
    expect(screen.getByText("ticket.jpg")).toBeTruthy();
    expect(botonSubir().disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Ir a Importar en el Legajo" })).toBeNull();
  });

  it("un archivo válido queda elegido con nombre y tamaño; uno inválido descarta el elegido", async () => {
    await abrirCajonConPedidos();
    fireEvent.change(inputArchivo(), {
      target: { files: [archivo("ticket-compra.pdf", "application/pdf")] },
    });
    expect(screen.getByText("ticket-compra.pdf")).toBeTruthy();
    expect(screen.getByText("1 KB")).toBeTruthy();
    fireEvent.change(inputArchivo(), {
      target: { files: [archivo("nota.docx", "application/octet-stream")] },
    });
    expect(screen.queryByText("ticket-compra.pdf")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "Elegí un PDF, JPG, PNG o WebP de hasta 25 MB.",
    );
  });
});

describe("Caracterización K4 · subida: sesión, subida firmada y complete", () => {
  function prepararSubida(factura: File) {
    seleccionarItem("item-a");
    fireEvent.change(inputArchivo(), { target: { files: [factura] } });
  }

  it("crea la sesión, sube al destino firmado y completa con nombre, tipo, tamaño, SHA-256 y clave del objeto", async () => {
    const bytes = [37, 80, 68, 70];
    const factura = archivo("ticket-compra.pdf", "application/pdf", bytes);
    if (typeof factura.arrayBuffer !== "function") {
      Object.defineProperty(factura, "arrayBuffer", {
        value: async () => new Uint8Array(bytes).buffer,
      });
    }
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path.endsWith("/document-upload-sessions")) {
        return {
          sessionId: "session-a",
          presignedUrl: "https://minio.local/upload",
          objectKey: "q/ticket-compra.pdf",
        };
      }
      if (path.endsWith("/complete")) return { documentId: "document-a", status: "UPLOADED" };
      return {};
    }) as never);

    await abrirCajonConPedidos();
    prepararSubida(factura);
    const pedidosAntes = llamadasA("/document-requests").length;
    fireEvent.click(botonSubir());

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/document-upload-sessions/session-a/complete`, {
        originalName: "ticket-compra.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
        objectKey: "q/ticket-compra.pdf",
      }),
    );
    expect(api.post).toHaveBeenCalledWith(`${BASE}/document-upload-sessions`, {
      expectedMime: "application/pdf",
      requestItemId: "item-a",
    });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("https://minio.local/upload", factura);
    // Al terminar: selecciona el documento nuevo, vuelve a pedir la lista y los pedidos,
    // y el cajón sigue abierto con el archivo ya descartado.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${BASE}/documents/document-a`));
    await waitFor(() =>
      expect(llamadasA("/document-requests").length).toBeGreaterThan(pedidosAntes),
    );
    expect(screen.getByRole("dialog", { name: "Nuevo documento" })).toBeTruthy();
    expect(screen.getByText("Arrastrá un archivo o elegilo desde tu equipo")).toBeTruthy();
  });

  it("si la API rechaza la sesión, muestra su motivo y conserva el archivo elegido", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError("ITEM_NOT_PENDING", "El ítem ya tiene un documento cargado.", 409),
    );
    await abrirCajonConPedidos();
    prepararSubida(archivo("ticket-compra.pdf", "application/pdf"));
    fireEvent.click(botonSubir());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "El ítem ya tiene un documento cargado.",
    );
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(screen.getByText("ticket-compra.pdf")).toBeTruthy();
    expect(botonSubir().disabled).toBe(false);
  });

  it("un error sin mensaje de la API se comunica como «No se pudo subir el documento.»", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Falla de red"));
    await abrirCajonConPedidos();
    prepararSubida(archivo("ticket-compra.pdf", "application/pdf"));
    fireEvent.click(botonSubir());
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo subir el documento.");
    expect(screen.getByText("ticket-compra.pdf")).toBeTruthy();
  });
});

describe("Caracterización K5 · cajón de carga: pedidos, error, vacío y botón", () => {
  it("pide los pedidos al abrir y muestra «Buscando pedidos abiertos…» mientras cargan", async () => {
    mockApi(() => new Promise(() => {}));
    renderBandeja();
    fireEvent.click(await screen.findByRole("button", { name: "Subir documento" }));
    expect(await screen.findByText("Buscando pedidos abiertos…")).toBeTruthy();
    expect(selectorItem()).toBeNull();
    // vigente: cambia con C7B-5
    expect(llamadasA("/document-requests").length).toBe(1);
  });

  it("ofrece en «Corresponde a» solo los ítems pendientes, como «pedido · ítem»", async () => {
    await abrirCajonConPedidos();
    const select = selectorItem()!;
    const opciones = Array.from(select.options).map((option) => option.textContent);
    // vigente: cambia con I7B-5
    expect(opciones).toEqual(["Elegí el ítem solicitado", "Marzo 2026 · Factura de compra"]);
    expect(select.required).toBe(true);
  });

  it("con error de pedidos muestra «No se pudieron cargar los pedidos» y Reintentar vuelve a pedirlos", async () => {
    let intento = 0;
    mockApi(() => {
      intento += 1;
      return intento === 1
        ? Promise.reject(new Error("Falla de red"))
        : Promise.resolve(structuredClone(pedidosFixture));
    });
    renderBandeja();
    fireEvent.click(await screen.findByRole("button", { name: "Subir documento" }));
    expect(await screen.findByText("No se pudieron cargar los pedidos")).toBeTruthy();
    expect(selectorItem()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(selectorItem()).not.toBeNull());
    // vigente: cambia con C7B-5
    expect(llamadasA("/document-requests").length).toBe(2);
  });

  it("sin pedidos pendientes muestra el vacío y «Ir a pedidos» no aparece sin request.manage", async () => {
    mockApi(() => Promise.resolve([]));
    renderBandeja();
    fireEvent.click(await screen.findByRole("button", { name: "Subir documento" }));
    expect(await screen.findByText("Primero creá un pedido documental")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ir a pedidos" })).toBeNull();
  });

  it("con request.manage, el vacío ofrece «Ir a pedidos»", async () => {
    fijarContexto(["client.read", "document.upload", "request.manage"]);
    mockApi(() => Promise.resolve([]));
    renderBandeja();
    fireEvent.click(await screen.findByRole("button", { name: "Subir documento" }));
    expect(await screen.findByRole("button", { name: "Ir a pedidos" })).toBeTruthy();
  });

  it("«Subir y procesar» se habilita solo con ítem y archivo elegidos", async () => {
    await abrirCajonConPedidos();
    expect(botonSubir().disabled).toBe(true);
    fireEvent.change(inputArchivo(), {
      target: { files: [archivo("ticket-compra.pdf", "application/pdf")] },
    });
    expect(botonSubir().disabled).toBe(true);
    seleccionarItem("item-a");
    expect(botonSubir().disabled).toBe(false);
    expect(
      within(botonSubir().closest("form") as HTMLElement).getByText("Corresponde a"),
    ).toBeTruthy();
  });
});
