// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { StudyClientes } from "../StudyClientes";
import {
  CATALOGO_ACTIVIDADES,
  CATALOGO_JURISDICCIONES,
  CATALOGO_NORMAS,
  CLIENTES_SINTETICOS,
  contextoDePrueba,
} from "./clientes.testutil";

/**
 * Consultas sin respuesta en Clientes (Foco 5.2, cierre del PR #144).
 * Una consulta pausada (pestaña oculta o sin conexión) no tiene dato ni error: la pantalla no puede decir
 * «0», «vacío» ni «no hay» mientras espera. Estas pruebas no mockean `api`: el cliente HTTP real recibe
 * respuestas de un `fetch` simulado, con un QueryClient igual al de App.tsx (retry: 1). Datos sintéticos.
 */

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

const sesionMock = vi.hoisted(() => ({
  status: "authenticated" as const,
  me: null,
  portalContexts: [],
  error: null,
  refresh: async () => {},
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => sesionMock,
}));

const CUIT_ALFA = "20-00000006-0";
const ALFA = "Sintético Alfa S.A.";
const RUTA_CLIENTES = "/api/v1/firms/firm-a/clients";
const RUTA_CONTACTOS = "/api/v1/firms/firm-a/clients/c1/contacts";
const RUTA_CONTACTOS_NUEVO = "/api/v1/firms/firm-a/clients/client-new/contacts";
const RUTA_ACTIVIDADES = "/api/v1/firms/firm-a/client-profile-catalogs/activities";
const RUTA_JURISDICCIONES = "/api/v1/tax/jurisdictions?includeInactive=true";
const RUTA_NORMAS = "/api/v1/firms/firm-a/accounting-standards";

const CLAVE_CLIENTES = ["clients", "firm-a"];
const CLAVE_CONTACTOS = ["client-contacts", "firm-a", "c1"];
const CLAVE_ACTIVIDADES = ["client-profile-activity-catalog", "firm-a"];
const CLAVE_JURISDICCIONES = ["jurisdiction-catalog", "firm-a"];
const CLAVE_NORMAS = ["accounting-standards", "firm-a"];

const CONTACTO = {
  id: "k1",
  name: "Contacto Sintético",
  email: "contacto@ejemplo.test",
  phone: null,
  function: null,
  isActive: true,
  isPrimary: true,
};

const CLIENTE_NUEVO = {
  id: "client-new",
  legalName: "Alta libre S.A.",
  cuit: "20111111112",
  cuitEnding: "2",
  tradeName: null,
  status: "ONBOARDING",
  profile: null,
};

interface Respuesta {
  status: number;
  cuerpo: unknown;
}

type Ruta = (metodo: string) => Respuesta;

const ok = (cuerpo: unknown): Respuesta => ({ status: 200, cuerpo });

const ERROR_SERVIDOR: Respuesta = {
  status: 500,
  cuerpo: { error: { code: "INTERNAL_ERROR", message: "Error interno" } },
};

/** Responde los primeros `n` pedidos con 500 y, después, con `respuesta`. */
function fallaLasPrimeras(n: number, respuesta: Respuesta): Ruta {
  let pedidos = 0;
  return () => {
    pedidos += 1;
    return pedidos <= n ? ERROR_SERVIDOR : respuesta;
  };
}

const RUTAS_SANAS: Record<string, Ruta> = {
  [RUTA_CLIENTES]: (metodo) => ok(metodo === "POST" ? CLIENTE_NUEVO : CLIENTES_SINTETICOS),
  [RUTA_CONTACTOS]: () => ok([]),
  [RUTA_CONTACTOS_NUEVO]: (metodo) => ok(metodo === "POST" ? CONTACTO : []),
  [RUTA_ACTIVIDADES]: () => ok(CATALOGO_ACTIVIDADES),
  [RUTA_JURISDICCIONES]: () => ok(CATALOGO_JURISDICCIONES),
  [RUTA_NORMAS]: () => ok(CATALOGO_NORMAS),
};

/** fetch simulado: cada ruta responde según `rutas`; las no declaradas responden sanas o una lista vacía. */
function fetchSimulado(rutas: Record<string, Ruta> = {}) {
  const todas = { ...RUTAS_SANAS, ...rutas };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const { status, cuerpo } = todas[url]?.(metodo) ?? ok([]);
    return new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Pedidos que salieron hacia una ruta (una consulta pausada no pide nada hasta volver). */
function pedidos(fetchMock: ReturnType<typeof fetchSimulado>, ruta: string) {
  return fetchMock.mock.calls.filter(([url]) => url === ruta).length;
}

/** Cliente igual al de App.tsx (retry: 1); sin espera entre intentos para que la prueba no demore. */
function clienteComoApp() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 0, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

function renderClientes(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/clientes"]}>
          <StudyClientes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Fija document.visibilityState: la pestaña del arnés puede estar oculta. */
function fijarVisibilidad(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
}

/** Vuelve la pestaña: las consultas pausadas siguen con su reintento. */
function volverLaPestana() {
  fijarVisibilidad("visible");
  window.dispatchEvent(new Event("visibilitychange"));
}

/** Espera a que las consultas queden pausadas: sin dato, sin error y sin pedir nada. */
async function esperarPausadas(client: QueryClient, claves: string[][]) {
  await waitFor(() => {
    for (const clave of claves) {
      expect(client.getQueryState(clave)?.fetchStatus).toBe("paused");
    }
  });
}

async function abrirDetalle(): Promise<HTMLElement> {
  const tabla = await screen.findByRole("table", { name: "Cartera de clientes" });
  fireEvent.click(within(tabla).getByText(CUIT_ALFA));
  return screen.findByRole("complementary", { name: `Detalle de ${ALFA}` });
}

async function abrirEdicion(): Promise<HTMLElement> {
  const detalle = await abrirDetalle();
  fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
  return screen.findByRole("dialog", { name: "Editar cliente" });
}

function barraDeContactos(detalle: HTMLElement): string {
  return detalle.querySelector(".client-contacts__toolbar")?.textContent ?? "";
}

describe("Clientes · consultas sin respuesta (Foco 5.2, cierre)", () => {
  beforeEach(() => {
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    fijarVisibilidad("visible");
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.unstubAllGlobals();
  });

  // Sin conexión, el contador de contactos no puede decir «0 contactos»: la consulta no recibió respuesta.
  it("sin conexión: contactos dice «pendiente» y «Cargando contactos…», no «0 contactos»", async () => {
    const fetchMock = fetchSimulado();
    const client = clienteComoApp();
    renderClientes(client);
    await screen.findByRole("table", { name: "Cartera de clientes" });
    onlineManager.setOnline(false);
    const detalle = await abrirDetalle();
    await esperarPausadas(client, [CLAVE_CONTACTOS]);
    expect(barraDeContactos(detalle)).toContain("pendiente");
    expect(barraDeContactos(detalle)).not.toContain("0 contactos");
    expect(within(detalle).getByText("Cargando contactos…")).toBeTruthy();
    expect(within(detalle).queryByText("Todavía no hay contactos")).toBeNull();
    expect(pedidos(fetchMock, RUTA_CONTACTOS)).toBe(0);
  });

  // Sin conexión desde el arranque, la lista principal espera su respuesta y no dice «Todavía no hay clientes».
  it("sin conexión: la lista dice «Cargando la cartera…», no «Todavía no hay clientes»", async () => {
    fetchSimulado();
    onlineManager.setOnline(false);
    const client = clienteComoApp();
    renderClientes(client);
    await esperarPausadas(client, [CLAVE_CLIENTES]);
    expect(await screen.findByText("Cargando la cartera…")).toBeTruthy();
    expect(screen.queryByText("Todavía no hay clientes")).toBeNull();
  });

  // Pestaña oculta tras el primer 500: el reintento se pausa. Mientras espera, contactos no dice «0»;
  // al volver la pestaña, el segundo 500 deja el error con «Reintentar».
  it("pestaña oculta tras el primer 500: «pendiente»; al volver la pestaña, el error con «Reintentar»", async () => {
    fijarVisibilidad("hidden");
    const fetchMock = fetchSimulado({ [RUTA_CONTACTOS]: fallaLasPrimeras(2, ok([])) });
    const client = clienteComoApp();
    renderClientes(client);
    const detalle = await abrirDetalle();
    await esperarPausadas(client, [CLAVE_CONTACTOS]);
    expect(barraDeContactos(detalle)).toContain("pendiente");
    expect(barraDeContactos(detalle)).not.toContain("0 contactos");
    expect(within(detalle).getByText("Cargando contactos…")).toBeTruthy();
    expect(
      within(detalle).queryByText("No se pudieron cargar los contactos. Reintentá."),
    ).toBeNull();
    expect(pedidos(fetchMock, RUTA_CONTACTOS)).toBe(1);
    volverLaPestana();
    expect(
      await within(detalle).findByText("No se pudieron cargar los contactos. Reintentá."),
    ).toBeTruthy();
    expect(within(detalle).getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(pedidos(fetchMock, RUTA_CONTACTOS)).toBe(2);
  });

  // 500 en los dos intentos de App.tsx: el error se dice y «Reintentar» vuelve a pedir la consulta.
  it("500 en los dos intentos: «No se pudieron cargar los contactos. Reintentá.» y «Reintentar» repite la consulta", async () => {
    const fetchMock = fetchSimulado({ [RUTA_CONTACTOS]: fallaLasPrimeras(2, ok([CONTACTO])) });
    renderClientes(clienteComoApp());
    const detalle = await abrirDetalle();
    expect(
      await within(detalle).findByText("No se pudieron cargar los contactos. Reintentá."),
    ).toBeTruthy();
    expect(pedidos(fetchMock, RUTA_CONTACTOS)).toBe(2);
    fireEvent.click(within(detalle).getByRole("button", { name: "Reintentar" }));
    expect(await within(detalle).findByText(CONTACTO.name)).toBeTruthy();
    expect(pedidos(fetchMock, RUTA_CONTACTOS)).toBe(3);
  });

  // Edición con la pestaña oculta: los catálogos de la ficha esperan y dicen «Cargando…»; no afirman
  // «fuera de catálogo» ni «No hay … cargadas» mientras no hay respuesta.
  it("edición con pestaña oculta: normas, jurisdicciones y actividades dicen «Cargando…»", async () => {
    fijarVisibilidad("hidden");
    fetchSimulado({
      [RUTA_NORMAS]: fallaLasPrimeras(1, ok(CATALOGO_NORMAS)),
      [RUTA_JURISDICCIONES]: fallaLasPrimeras(1, ok(CATALOGO_JURISDICCIONES)),
      [RUTA_ACTIVIDADES]: fallaLasPrimeras(1, ok(CATALOGO_ACTIVIDADES)),
    });
    const client = clienteComoApp();
    renderClientes(client);
    const cajon = await abrirEdicion();
    await esperarPausadas(client, [CLAVE_NORMAS, CLAVE_JURISDICCIONES, CLAVE_ACTIVIDADES]);
    expect(within(cajon).getByText("Cargando normas contables…")).toBeTruthy();
    expect(within(cajon).getByText("Cargando catálogo de jurisdicciones…")).toBeTruthy();
    expect(within(cajon).getByText("Cargando catálogo de actividades…")).toBeTruthy();
    expect(within(cajon).queryByText(/fuera de catálogo/)).toBeNull();
    expect(within(cajon).queryByText(/no está en el catálogo del estudio/)).toBeNull();
    expect(within(cajon).queryByText(/No hay (normas|actividades|jurisdicciones)/)).toBeNull();
    volverLaPestana();
    await waitFor(() => expect(within(cajon).queryByText("Cargando normas contables…")).toBeNull());
    expect(
      within(cajon).queryByText("No se pudo cargar el catálogo de normas. Reintentá."),
    ).toBeNull();
  });

  // 500 en los dos intentos del catálogo de normas: el aviso lo dice y «Reintentar» vuelve a pedirlo.
  it("normas con 500 en los dos intentos: «No se pudo cargar el catálogo de normas. Reintentá.» y «Reintentar» repite", async () => {
    const fetchMock = fetchSimulado({ [RUTA_NORMAS]: fallaLasPrimeras(2, ok(CATALOGO_NORMAS)) });
    renderClientes(clienteComoApp());
    const cajon = await abrirEdicion();
    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de normas. Reintentá."),
    ).toBeTruthy();
    expect(within(cajon).queryByText(/fuera de catálogo/)).toBeNull();
    expect(pedidos(fetchMock, RUTA_NORMAS)).toBe(2);
    fireEvent.click(within(cajon).getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(
        within(cajon).queryByText("No se pudo cargar el catálogo de normas. Reintentá."),
      ).toBeNull(),
    );
    expect(pedidos(fetchMock, RUTA_NORMAS)).toBe(3);
  });

  // Alta con correo: si registrar el correo falla, el aviso ofrece «Reintentar»; al repetirlo con éxito, desaparece.
  it("alta con correo fallido: el aviso ofrece «Reintentar» y, al repetirlo, desaparece", async () => {
    let intentosDeCorreo = 0;
    const fetchMock = fetchSimulado({
      [RUTA_CONTACTOS_NUEVO]: (metodo) => {
        if (metodo !== "POST") return ok([]);
        intentosDeCorreo += 1;
        return intentosDeCorreo === 1 ? ERROR_SERVIDOR : ok(CONTACTO);
      },
    });
    renderClientes(clienteComoApp());
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    fireEvent.change(screen.getByLabelText("Razón social"), {
      target: { value: "Alta libre S.A." },
    });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111112" } });
    fireEvent.change(screen.getByLabelText("Correo de contacto"), {
      target: { value: "contacto@ejemplo.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" })); // vigente: cambia con decisión de Inti (16-nov)
    const aviso = await screen.findByRole("alert");
    expect(
      within(aviso).getByText(
        "Cliente creado. El correo no se pudo registrar; podés agregarlo desde Contactos.",
      ),
    ).toBeTruthy();
    expect(pedidos(fetchMock, RUTA_CONTACTOS_NUEVO)).toBe(1);
    fireEvent.click(within(aviso).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    // Reintentar consulta los contactos del cliente nuevo y después vuelve a registrar el correo.
    expect(pedidos(fetchMock, RUTA_CONTACTOS_NUEVO)).toBe(3);
  });

  // Alta sin conexión: el catálogo de actividades espera su respuesta; no queda como lista vacía sin decirlo.
  it("alta sin conexión: el catálogo de actividades dice «Cargando catálogo de actividades…»", async () => {
    fetchSimulado();
    onlineManager.setOnline(false);
    const client = clienteComoApp();
    renderClientes(client);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Nuevo cliente" }); // vigente: cambia con decisión de Inti (16-nov)
    await esperarPausadas(client, [CLAVE_ACTIVIDADES]);
    expect(within(cajon).getByText("Cargando catálogo de actividades…")).toBeTruthy();
    expect(within(cajon).queryByText("No hay actividades cargadas.")).toBeNull();
  });
});
