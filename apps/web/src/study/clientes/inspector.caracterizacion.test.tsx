// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CLIENT_VAT_CONDITION_LABELS } from "@contable/contracts";
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

const CONTACTOS_SINTETICOS = [
  {
    id: "k1",
    name: "Sintético Contacto Uno",
    function: "Administración",
    email: "uno@example.com",
    phone: null,
    isPrimary: true,
    isActive: true,
  },
  {
    id: "k2",
    name: "Sintético Contacto Dos",
    function: null,
    email: null,
    phone: "+54 11 0000-0000",
    isPrimary: false,
    isActive: false,
  },
];

const CUIT_ALFA = "20-00000006-0";
const ALFA = "Sintético Alfa S.A.";
const CUIT_BETA = "20-00000000-1";
const BETA = "Sintético Beta S.R.L.";

describe("StudyClientes — detalle del cliente (K3)", () => {
  let respuestaContactos: () => Promise<unknown> = () => Promise.resolve([]);

  beforeEach(() => {
    vi.resetAllMocks();
    respuestaContactos = () => Promise.resolve([]);
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    sessionMock.current = SESION_AUTENTICADA;
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/contacts")
        ? respuestaContactos()
        : respuestaApi(path, CLIENTES_SINTETICOS)) as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("muestra título, CUIT y avatar, y se identifica como «Detalle de …»", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(within(detalle).getByText(ALFA)).toBeTruthy();
    expect(within(detalle).getByText(`CUIT ${CUIT_ALFA}`)).toBeTruthy();
    expect(detalle.querySelector(".dense-avatar--lg")?.textContent).toBe("S");
  });

  it("con faltantes muestra los pasos y la ficha abre la edición", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_BETA, BETA);
    const aviso = detalle.querySelector(".dense-inspector__banner .ds-notice") as HTMLElement;

    expect(aviso.textContent).toContain(
      "Falta: ficha contable, perfil fiscal activo, inscripción fiscal, actividad fiscal, período fiscal, obligación.",
    );
    fireEvent.click(within(aviso).getByRole("button", { name: "ficha contable" }));
    expect(await screen.findByRole("dialog", { name: "Editar cliente" })).toBeTruthy();
  });

  it("sin client.manage muestra el aviso sin «Completar», sin «Editar» y sin la sección de contactos", async () => {
    contextMock.current = contextoDePrueba(["client.read"]);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_BETA, BETA);

    expect(detalle.querySelector(".dense-inspector__banner .ds-notice")).not.toBeNull();
    expect(within(detalle).queryByRole("button", { name: "Completar" })).toBeNull();
    expect(within(detalle).queryByRole("button", { name: "Editar" })).toBeNull();
    expect(detalle.querySelector("#client-contacts-c2")).toBeNull();
  });

  it("muestra los datos de identificación y de perfil fiscal con su formato", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    const dato = (termino: string) =>
      Array.from(detalle.querySelectorAll("dt"))
        .find((etiqueta) => etiqueta.textContent === termino)
        ?.nextElementSibling?.textContent;

    expect(dato("Nombre de fantasía")).toBe("—");
    expect(dato("Forma jurídica")).toBe("S.A.");
    expect(dato("Provincia")).toBe("Tucumán");
    expect(dato("Actividad")).toBe("Comercio");
    expect(dato("Condición IVA")).toBe(CLIENT_VAT_CONDITION_LABELS.RESPONSABLE_INSCRIPTO);
    expect(dato("Norma contable")).toBe("RTIC");
    expect(dato("Cierre del ejercicio")).toBe("Junio");
    expect(dato("Moneda funcional")).toBe("ARS");
    expect(dato("Jurisdicciones IIBB")).toBe("—");
  });

  it("lista los contactos con «Principal» y «Oculto», su contador y las acciones de editar y ocultar o mostrar", async () => {
    respuestaContactos = () => Promise.resolve(CONTACTOS_SINTETICOS);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    await within(detalle).findByText("Sintético Contacto Uno");
    expect(detalle.querySelector(".client-contacts__toolbar")?.textContent).toContain("2 contactos");
    const tarjetas = detalle.querySelectorAll("article.client-contact");
    expect(tarjetas).toHaveLength(2);
    expect(tarjetas[0]?.querySelector(".dense-tag")?.textContent).toBe("Principal");
    expect(tarjetas[1]?.querySelector(".dense-tag")?.textContent).toBe("Oculto");
    expect(tarjetas[1]?.classList.contains("client-contact--inactive")).toBe(true);
    expect(
      within(detalle).getByRole("button", { name: "Ocultar contacto de Sintético Contacto Uno" }),
    ).toBeTruthy();
    expect(
      within(detalle).getByRole("button", { name: "Mostrar contacto de Sintético Contacto Dos" }),
    ).toBeTruthy();
    expect(within(detalle).getByRole("button", { name: "Editar contacto de Sintético Contacto Dos" })).toBeTruthy();
  });

  it("mientras cargan los contactos muestra «Cargando contactos…»", async () => {
    respuestaContactos = () => new Promise(() => {});
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(await within(detalle).findByText("Cargando contactos…")).toBeTruthy();
  });

  it("si falla la consulta de contactos muestra el aviso de error", async () => {
    respuestaContactos = () => Promise.reject(new Error("Sin conexión"));
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(
      await within(detalle).findByText("No se pudieron cargar los contactos. Reintentá."),
    ).toBeTruthy();
  });

  it("sin contactos muestra el estado vacío con su descripción", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    expect(await within(detalle).findByText("Todavía no hay contactos")).toBeTruthy();
    expect(within(detalle).getByText("Agregá personas de referencia para este cliente.")).toBeTruthy();
    expect(detalle.querySelector(".client-contacts__toolbar")?.textContent).toContain("0 contactos");
  });

  it("se cierra con la X y con Esc", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    fireEvent.click(within(detalle).getByRole("button", { name: "Cerrar detalle" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

    await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });

  it("«Más acciones» reúne las secundarias; «Eliminar» aparece solo con data.delete", async () => {
    contextMock.current = contextoDePrueba(["client.read", "client.manage", "data.delete"]);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    fireEvent.click(within(detalle).getByText("Más acciones"));
    const grupo = within(detalle).getByRole("group", { name: "Acciones secundarias" });
    expect(within(grupo).getAllByRole("button").map((boton) => boton.textContent?.trim())).toEqual([
      "Abrir trabajo",
      "Cambiar estado",
      "Contactos",
      "Eliminar",
    ]);
  });

  it("sin data.delete el menú no ofrece «Eliminar»", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    fireEvent.click(within(detalle).getByText("Más acciones"));
    const grupo = within(detalle).getByRole("group", { name: "Acciones secundarias" });
    expect(within(grupo).queryByRole("button", { name: "Eliminar" })).toBeNull();
    expect(within(grupo).getAllByRole("button")).toHaveLength(3);
  });
});
