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
const CUIT_BETA = "20-00000000-1";
const BETA = "Sintético Beta S.R.L.";

// Caracterización K6 (Foco 5.2): afirma el comportamiento VIGENTE de origin/main (5cdd0cf).
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
      if (ruta) return respuestaCatalogo[ruta]();
      return respuestaApi(path, CLIENTES_SINTETICOS);
    }) as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("si falla la consulta de contactos, el aviso ofrece «Reintentar» y repite la consulta", async () => {
    respuestaContactos = () => Promise.reject(new Error("Sin conexión"));
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(await within(detalle).findByText("No se pudieron cargar los contactos. Reintentá.")).toBeTruthy();
    fireEvent.click(within(detalle).getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.filter(([path]) => String(path).endsWith("/contacts"))).toHaveLength(2),
    );
  });

  it("mientras cargan los contactos el contador dice «pendiente», no «0 contactos»", async () => {
    respuestaContactos = () => new Promise(() => {});
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(await within(detalle).findByText("Cargando contactos…")).toBeTruthy();
    expect(detalle.querySelector(".client-contacts__toolbar")?.textContent).toContain("pendiente");
    expect(detalle.querySelector(".client-contacts__toolbar")?.textContent).not.toContain("0 contactos");
  });

  it("si falla el catálogo de jurisdicciones, la sección no ofrece «Reintentar» (vigente: defecto 7d-2)", async () => {
    // vigente: defecto 7d-2 (cambia en este corte)
    respuestaCatalogo["/tax/jurisdictions"] = () => Promise.reject(new Error("Catálogo caído"));
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de jurisdicciones. Reintentá."),
    ).toBeTruthy();
    const seccion = cajon.querySelector("#client-profile-iibb") as HTMLElement;
    expect(within(seccion).queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("si falla el catálogo de actividades en el alta, no ofrece «Reintentar» (vigente: defecto 7d-2)", async () => {
    // vigente: defecto 7d-2 (cambia en este corte)
    respuestaCatalogo["/client-profile-catalogs/activities"] = () => Promise.reject(new Error("Catálogo caído"));
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Alta de cliente" });

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de actividades. Reintentá."),
    ).toBeTruthy();
    expect(within(cajon).queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("si falla el catálogo de actividades en la edición, no ofrece «Reintentar» (vigente: defecto 7d-2)", async () => {
    // vigente: defecto 7d-2 (cambia en este corte)
    respuestaCatalogo["/client-profile-catalogs/activities"] = () => Promise.reject(new Error("Catálogo caído"));
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });

    expect(
      await within(cajon).findByText("No se pudo cargar el catálogo de actividades. Reintentá."),
    ).toBeTruthy();
    expect(within(cajon).queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("si cae el catálogo de normas, una opción deshabilitada hace de aviso (vigente: defecto 7d-2)", async () => {
    // vigente: defecto 7d-2 (cambia en este corte)
    respuestaCatalogo["/accounting-standards"] = () => Promise.reject(new Error("Catálogo caído"));
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });

    const opcion = await within(cajon).findByRole("option", { name: "No se pudo cargar el catálogo de normas" });
    expect((opcion as HTMLOptionElement).disabled).toBe(true);
    expect(within(cajon).queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("si falla el reintento del correo, el aviso lo dice y ofrece volver a intentarlo", async () => {
    vi.mocked(api.post).mockImplementation(((path: string) =>
      path.endsWith("/contacts")
        ? Promise.reject(new Error("La respuesta se perdió"))
        : Promise.resolve({ id: "client-new", legalName: "Sintético Nuevo S.A." })) as never);
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Sintético Nuevo S.A." } });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20000000112" } });
    fireEvent.change(screen.getByLabelText("Correo de contacto"), { target: { value: "contacto@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));

    const aviso = await screen.findByRole("alert");
    expect(within(aviso).getByText("Cliente creado. El correo no se pudo registrar; podés agregarlo desde Contactos.")).toBeTruthy();

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
});
