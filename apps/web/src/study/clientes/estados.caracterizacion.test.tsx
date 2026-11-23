// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyClientes } from "../StudyClientes";
import {
  CLIENTES_SINTETICOS,
  SESION_AUTENTICADA,
  contextoDePrueba,
  renderConRutas,
  respuestaApi,
  seleccionarCliente,
} from "./clientes.testutil";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

interface MockSession {
  status: "loading" | "authenticated" | "unauthenticated";
  me: null;
  portalContexts: never[];
  error: null;
  refresh: () => Promise<void>;
}

const sessionMock = vi.hoisted(() => ({ current: null as unknown as MockSession }));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => sessionMock.current,
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

const CUIT_ALFA = "20-00000006-0";
const ALFA = "Sintético Alfa S.A.";

// Pruebas K6 (Foco 5.2): estados y errores de Clientes, sobre las aserciones sustituidas en los bloques (a) y (b).
// Cada aserción vigente lleva el defecto 7d-N que el corte corrige; al corregir se reemplaza
// (no se borra) por la aserción nueva, listada en «Aserciones tocadas». Sin it.fails ni skip.

describe("StudyClientes — estados y errores (K6)", () => {
  let respuestaContactos: () => Promise<unknown> = () => Promise.resolve([]);
  let respuestaCatalogo: Record<string, () => Promise<unknown>> = {};

  beforeEach(() => {
    vi.resetAllMocks();
    respuestaContactos = () => Promise.resolve([]);
    respuestaCatalogo = {};
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    sessionMock.current = SESION_AUTENTICADA;
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path.endsWith("/contacts")) return respuestaContactos();
      const ruta = Object.keys(respuestaCatalogo).find((clave) => path.includes(clave));
      const respuesta = ruta ? respuestaCatalogo[ruta] : undefined;
      if (respuesta) return respuesta();
      return respuestaApi(path, CLIENTES_SINTETICOS);
    }) as never);
  });

  afterEach(() => {
    cleanup();
  });

  async function abrirEdicion() {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    return screen.findByRole("dialog", { name: "Editar cliente" });
  }

  const llamadasA = (fragmento: string) =>
    vi.mocked(api.get).mock.calls.filter(([path]) => String(path).includes(fragmento)).length;

  it("si falla la consulta de contactos, el aviso ofrece «Reintentar» y repite la consulta", async () => {
    respuestaContactos = () => Promise.reject(new Error("Sin conexión"));
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(
      await within(detalle).findByText("No se pudieron cargar los contactos. Reintentá."),
    ).toBeTruthy();
    fireEvent.click(within(detalle).getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.calls.filter(([path]) => String(path).endsWith("/contacts")),
      ).toHaveLength(2),
    );
  });

  it("mientras cargan los contactos el contador dice «pendiente», no «0 contactos»", async () => {
    respuestaContactos = () => new Promise(() => {});
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(await within(detalle).findByText("Cargando contactos…")).toBeTruthy();
    expect(detalle.querySelector(".client-contacts__toolbar")?.textContent).toContain("pendiente");
    expect(detalle.querySelector(".client-contacts__toolbar")?.textContent).not.toContain(
      "0 contactos",
    );
  });

  it("si falla el catálogo de jurisdicciones, la sección ofrece «Reintentar» y lo repite", async () => {
    respuestaCatalogo["/tax/jurisdictions"] = () => Promise.reject(new Error("Catálogo caído"));
    const cajon = await abrirEdicion();

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de jurisdicciones. Reintentá."),
    ).toBeTruthy();
    const seccion = cajon.querySelector("#client-profile-iibb") as HTMLElement;
    fireEvent.click(within(seccion).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadasA("/tax/jurisdictions")).toBe(2));
  });

  it("si falla el catálogo de actividades en el alta, ofrece «Reintentar» y lo repite", async () => {
    respuestaCatalogo["/client-profile-catalogs/activities"] = () =>
      Promise.reject(new Error("Catálogo caído"));
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Nuevo cliente" }); // vigente: cambia con decisión de Inti (16-nov)

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de actividades. Reintentá."),
    ).toBeTruthy();
    fireEvent.click(within(cajon).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadasA("/client-profile-catalogs/activities")).toBe(2));
  });

  it("si falla el catálogo de actividades en la edición, ofrece «Reintentar» y lo repite", async () => {
    respuestaCatalogo["/client-profile-catalogs/activities"] = () =>
      Promise.reject(new Error("Catálogo caído"));
    const cajon = await abrirEdicion();

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de actividades. Reintentá."),
    ).toBeTruthy();
    fireEvent.click(within(cajon).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadasA("/client-profile-catalogs/activities")).toBe(2));
  });

  it("si cae el catálogo de normas, lo dice con «Reintentar» y no lo muestra como opción", async () => {
    respuestaCatalogo["/accounting-standards"] = () => Promise.reject(new Error("Catálogo caído"));
    const cajon = await abrirEdicion();

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de normas. Reintentá."),
    ).toBeTruthy();
    expect(
      within(cajon).queryByRole("option", { name: "No se pudo cargar el catálogo de normas" }),
    ).toBeNull();
    fireEvent.click(within(cajon).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadasA("/accounting-standards")).toBe(2));
  });

  it("si falla el reintento del correo, el aviso lo dice y ofrece volver a intentarlo", async () => {
    vi.mocked(api.post).mockImplementation(((path: string) =>
      path.endsWith("/contacts")
        ? Promise.reject(new Error("La respuesta se perdió"))
        : Promise.resolve({ id: "client-new", legalName: "Sintético Nuevo S.A." })) as never);
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    fireEvent.change(screen.getByLabelText("Razón social"), {
      target: { value: "Sintético Nuevo S.A." },
    });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20000000112" } });
    fireEvent.change(screen.getByLabelText("Correo de contacto"), {
      target: { value: "contacto@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" })); // vigente: cambia con decisión de Inti (16-nov)

    const aviso = await screen.findByRole("alert");
    expect(
      within(aviso).getByText(
        "Cliente creado. El correo no se pudo registrar; podés agregarlo desde Contactos.",
      ),
    ).toBeTruthy();

    fireEvent.click(within(aviso).getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(
        vi.mocked(api.post).mock.calls.filter(([path]) => String(path).endsWith("/contacts")),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "No se pudo registrar el correo. Reintentá o agregalo desde Contactos.",
      ),
    );
  });

  it("mientras cargan los catálogos de la ficha, cada uno lo anuncia como estado", async () => {
    respuestaCatalogo["/tax/jurisdictions"] = () => new Promise(() => {});
    respuestaCatalogo["/client-profile-catalogs/activities"] = () => new Promise(() => {});
    respuestaCatalogo["/accounting-standards"] = () => new Promise(() => {});
    const cajon = await abrirEdicion();

    for (const texto of [
      "Cargando catálogo de jurisdicciones…",
      "Cargando catálogo de actividades…",
      "Cargando normas contables…",
    ]) {
      expect((await within(cajon).findByText(texto)).getAttribute("role")).toBe("status");
    }
  });

  it("un catálogo de jurisdicciones vacío explica qué falta y a quién pedirlo", async () => {
    respuestaCatalogo["/tax/jurisdictions"] = () => Promise.resolve([]);
    const cajon = await abrirEdicion();

    expect(await within(cajon).findByText("No hay jurisdicciones cargadas.")).toBeTruthy();
    expect(
      within(cajon).getByText(
        "Pedí a quien administra el estudio que las cargue en Catálogos fiscales.",
      ),
    ).toBeTruthy();
  });

  it("un catálogo de actividades vacío explica qué falta y a quién pedirlo", async () => {
    respuestaCatalogo["/client-profile-catalogs/activities"] = () => Promise.resolve([]);
    const cajon = await abrirEdicion();

    expect(await within(cajon).findByText("No hay actividades cargadas.")).toBeTruthy();
    expect(
      within(cajon).getByText(
        "Pedí a quien administra el estudio que las cargue en Catálogos fiscales.",
      ),
    ).toBeTruthy();
  });

  it("sin normas en el catálogo, la norma es opcional: el campo ofrece «Sin norma contable», sin aviso ni enlace (A57)", async () => {
    respuestaCatalogo["/accounting-standards"] = () => Promise.resolve([]);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente("20-00000007-9", "Sintético Delta S.A.");
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });

    expect((await within(cajon).findByLabelText("Norma contable")).getAttribute("placeholder")).toBe("Sin norma contable");
    expect(within(cajon).queryByText("No hay normas contables cargadas.")).toBeNull();
    expect(within(cajon).queryByRole("link", { name: /normas contables/i })).toBeNull();
    expect(within(cajon).queryByText(/falta.*norma/i)).toBeNull();
  });

  it("sin client.manage, la cartera vacía explica qué falta y a quién pedirlo, sin acción de crear", async () => {
    contextMock.current = contextoDePrueba(["client.read"]);
    vi.mocked(api.get).mockImplementation(((path: string) => respuestaApi(path, [])) as never);
    renderConRutas("/clientes", <StudyClientes />);

    expect(await screen.findByText("Todavía no tenés clientes asignados")).toBeTruthy();
    expect(
      screen.getByText("Pedile a quien administra el estudio que te asigne uno."),
    ).toBeTruthy();
    expect(screen.queryByText("Todavía no hay clientes")).toBeNull();
    // D27-3 no cambia la acción: sin client.manage no hay «Guardar cliente».
    expect(screen.queryByRole("button", { name: "Guardar cliente" })).toBeNull();
  });

  it("con client.manage, la cartera vacía sigue ofreciendo crear el primero (sin cambios por A27 D27-3)", async () => {
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    vi.mocked(api.get).mockImplementation(((path: string) => respuestaApi(path, [])) as never);
    renderConRutas("/clientes", <StudyClientes />);

    expect(await screen.findByText("Todavía no hay clientes")).toBeTruthy();
    expect(
      screen.getByText("Creá el primer cliente para comenzar a organizar la operación."),
    ).toBeTruthy();
    expect(screen.queryByText("Todavía no tenés clientes asignados")).toBeNull();
  });
});
