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
  rutaActual,
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

describe("StudyClientes — cajones de alta, estado y contacto (K4)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    sessionMock.current = SESION_AUTENTICADA;
    vi.mocked(api.get).mockImplementation(((path: string) =>
      respuestaApi(path, CLIENTES_SINTETICOS)) as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("alta: expone los campos con sus id, el motivo de faltantes y deshabilita «Crear cliente»", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Alta de cliente" });

    for (const id of [
      "client-legal-name",
      "client-create-contact-email",
      "client-trade-name",
      "client-cuit",
      "client-vat-condition",
      "client-province",
      "client-activity",
      "client-legal-form",
    ]) {
      expect(cajon.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(cajon.querySelectorAll(".ds-field")).toHaveLength(8);
    expect(cajon.querySelector("#client-create-hint")?.textContent).toBe(
      "Falta completar 2 campos: razón social y CUIT.",
    );
    expect((within(cajon).getByRole("button", { name: "Crear cliente" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("alta: envía el payload con los campos requeridos y navega a Configuración fiscal", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "c-nuevo", legalName: "Sintético Nuevo S.A." } as never);
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Alta de cliente" });

    fireEvent.change(cajon.querySelector("#client-legal-name") as HTMLInputElement, {
      target: { value: "Sintético Nuevo S.A." },
    });
    fireEvent.change(cajon.querySelector("#client-cuit") as HTMLInputElement, {
      target: { value: "20000000112" },
    });
    expect(cajon.querySelector("#client-create-hint")?.textContent).toBe("Los datos requeridos están completos.");

    fireEvent.click(within(cajon).getByRole("button", { name: "Crear cliente" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients", {
        legalName: "Sintético Nuevo S.A.",
        cuit: "20000000112",
      }),
    );
    await waitFor(() => expect(rutaActual()).toBe("/configuracion-fiscal"));
    expect(contextMock.current.setClientId).toHaveBeenCalledWith("c-nuevo");
  });

  it("alta con correo: lo registra como contacto principal con el nombre del cliente", async () => {
    vi.mocked(api.post).mockImplementation(((path: string) =>
      Promise.resolve(
        path.endsWith("/contacts")
          ? { id: "k-nuevo" }
          : { id: "c-nuevo", legalName: "Sintético Nuevo S.A.", cuit: "20000000112" },
      )) as never);
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Alta de cliente" });

    fireEvent.change(cajon.querySelector("#client-legal-name") as HTMLInputElement, {
      target: { value: "Sintético Nuevo S.A." },
    });
    fireEvent.change(cajon.querySelector("#client-cuit") as HTMLInputElement, {
      target: { value: "20000000112" },
    });
    fireEvent.change(cajon.querySelector("#client-create-contact-email") as HTMLInputElement, {
      target: { value: "contacto@example.com" },
    });
    fireEvent.click(within(cajon).getByRole("button", { name: "Crear cliente" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/c-nuevo/contacts", {
        name: "Sintético Nuevo S.A.",
        email: "contacto@example.com",
        isPrimary: true,
      }),
    );
    await waitFor(() => expect(rutaActual()).toBe("/configuracion-fiscal"));
  });

  it("cambiar estado: ofrece los cuatro estados con el actual marcado, guarda el PATCH y avisa", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "c1", legalName: ALFA } as never);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    fireEvent.click(within(detalle).getByText("Más acciones"));
    fireEvent.click(within(detalle).getByRole("button", { name: "Cambiar estado" }));
    const cajon = await screen.findByRole("dialog", { name: "Cambiar estado" });
    const estado = within(cajon).getByLabelText("Estado") as HTMLSelectElement;

    expect(Array.from(estado.options).map((opcion) => [opcion.value, opcion.textContent])).toEqual([
      ["ONBOARDING", "En configuración"],
      ["ACTIVE", "Activo"],
      ["INACTIVE", "Inactivo"],
      ["ARCHIVED", "Archivado"],
    ]);
    expect(estado.value).toBe("ACTIVE");

    fireEvent.change(estado, { target: { value: "ARCHIVED" } });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar estado" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/clients/c1", { status: "ARCHIVED" }),
    );
    expect(await screen.findByText(`El estado de ${ALFA} se actualizó.`)).toBeTruthy();
  });

  it("contacto: campos, casilla de principal, payload normalizado y «Guardar contacto» deshabilitado sin nombre", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "k-nuevo" } as never);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);

    fireEvent.click(within(detalle).getByRole("button", { name: "Nuevo contacto" }));
    const cajon = await screen.findByRole("dialog", { name: "Nuevo contacto" });
    for (const id of ["client-contact-name", "client-contact-function", "client-contact-email", "client-contact-phone"]) {
      expect(cajon.querySelector(`#${id}`)).not.toBeNull();
    }
    const guardar = within(cajon).getByRole("button", { name: "Guardar contacto" }) as HTMLButtonElement;
    expect(guardar.disabled).toBe(true);

    fireEvent.change(cajon.querySelector("#client-contact-name") as HTMLInputElement, {
      target: { value: "Sintético Persona" },
    });
    expect(guardar.disabled).toBe(false);
    fireEvent.change(cajon.querySelector("#client-contact-function") as HTMLInputElement, {
      target: { value: "   " },
    });
    fireEvent.change(cajon.querySelector("#client-contact-phone") as HTMLInputElement, {
      target: { value: "+54 11 0000-0000" },
    });
    fireEvent.click(within(cajon).getByLabelText("Contacto principal"));
    fireEvent.click(guardar);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/c1/contacts", {
        name: "Sintético Persona",
        function: null,
        email: null,
        phone: "+54 11 0000-0000",
        isPrimary: true,
      }),
    );
  });
});
