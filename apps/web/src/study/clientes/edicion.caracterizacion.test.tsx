// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import { StudyClientes } from "../StudyClientes";
import {
  CLIENTES_SINTETICOS,
  PERFIL_SINTETICO_COMPLETO,
  SESION_AUTENTICADA,
  contextoDePrueba,
  renderConRutas,
  respuestaApi,
  seleccionarCliente,
} from "./clientes.testutil";
import { abrirListado, cambiarValor } from "../../test/elegirOpcion";

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

/** Lista con un único cliente sintético cuyo perfil se ajusta en cada prueba. */
function clientePerfil(perfil: Record<string, unknown>): unknown[] {
  return [{ ...CLIENTES_SINTETICOS[0], profile: { ...PERFIL_SINTETICO_COMPLETO, ...perfil } }];
}

function mockClientes(lista: unknown[]) {
  vi.mocked(api.get).mockImplementation(((path: string) => respuestaApi(path, lista)) as never);
}

function mockPatchExitoso() {
  vi.mocked(api.patch).mockImplementation(((path: string) =>
    Promise.resolve(path.endsWith("/profile") ? {} : { id: "c1" })) as never);
}

/** Abre el cajón «Editar cliente» desde el detalle de Alfa. */
async function abrirEdicion(): Promise<HTMLElement> {
  const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
  fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
  return screen.findByRole("dialog", { name: "Editar cliente" });
}

describe("StudyClientes — cajón de edición (K5)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    sessionMock.current = SESION_AUTENTICADA;
    mockClientes(clientePerfil({}));
    mockPatchExitoso();
  });

  afterEach(() => {
    cleanup();
  });

  it("guarda identidad y perfil con el payload exacto de cada operación", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    cambiarValor(cajon.querySelector("#client-identity-legal-name") as HTMLInputElement, "Sintético Alfa Editada S.A.");
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/clients/c1", {
      legalName: "Sintético Alfa Editada S.A.",
      tradeName: null,
      cuit: "20000000060",
    });
    expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/clients/c1/profile", {
      functionalCurrency: "ARS",
      fiscalYearEndMonth: 6,
      iibbJurisdictions: [],
      accountingStandard: "RTIC",
      vatCondition: "RESPONSABLE_INSCRIPTO",
      province: "Tucumán",
      activity: "Comercio",
      legalForm: "S.A.",
    });
  });

  it("los cuatro valores históricos se ven con su nota y se envían sin cambios", async () => {
    mockClientes(
      clientePerfil({
        vatCondition: "IVA_HISTORICO",
        province: "Provincia Histórica",
        activity: "Actividad Histórica",
        legalForm: "Forma Histórica",
      }),
    );
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    expect(within(abrirListado("Condición frente al IVA", cajon)).getByRole("option", { name: "IVA_HISTORICO — valor histórico (conservado)" })).toBeTruthy();
    fireEvent.focus(cajon.querySelector("#client-profile-province") as HTMLInputElement);
    expect(screen.getByRole("option", { name: "Provincia Histórica — valor histórico (conservado)" })).toBeTruthy();
    expect(within(abrirListado("Actividad principal", cajon)).getByRole("option", { name: "Actividad Histórica — valor histórico (conservado)" })).toBeTruthy();
    fireEvent.focus(cajon.querySelector("#client-profile-legal-form") as HTMLInputElement);
    expect(screen.getByRole("option", { name: "Forma Histórica — valor histórico (conservado)" })).toBeTruthy();
    expect(cajon.querySelectorAll(".study-legacy-note")).toHaveLength(4);

    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/c1/profile",
        expect.objectContaining({
          vatCondition: "IVA_HISTORICO",
          province: "Provincia Histórica",
          activity: "Actividad Histórica",
          legalForm: "Forma Histórica",
        }),
      ),
    );
  });

  it("una moneda fuera de catálogo bloquea «Guardar cambios» hasta elegir ARS o USD", async () => {
    mockClientes(clientePerfil({ functionalCurrency: "EUR" }));
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    expect(within(cajon).getByText(/La moneda guardada no está respaldada por el sistema/)).toBeTruthy();
    const guardar = within(cajon).getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement;
    expect(guardar.disabled).toBe(true);

    cambiarValor(cajon.querySelector("#client-profile-currency") as HTMLSelectElement, "USD");
    expect(guardar.disabled).toBe(false);
  });

  it("una norma fuera de catálogo bloquea el guardado hasta reelegirla del catálogo", async () => {
    mockClientes(clientePerfil({ accountingStandard: "NORMA_INEXISTENTE" }));
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    expect(within(cajon).getByText(/no está en el catálogo del estudio/)).toBeTruthy();
    const guardar = within(cajon).getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement;
    expect(guardar.disabled).toBe(true);

    cambiarValor(cajon.querySelector("#client-profile-standard") as HTMLSelectElement, "RTIC");
    expect(guardar.disabled).toBe(false);
  });

  it("las jurisdicciones guardadas se canonizan a códigos del catálogo y se envían así", async () => {
    mockClientes(
      clientePerfil({
        functionalCurrency: "USD",
        accountingStandard: null,
        iibbJurisdictions: ["AR-T", "Provincia de Tucumán", "Sin match"],
      }),
    );
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    expect(
      (await within(cajon).findByRole("checkbox", { name: /AR-T — Provincia de Tucumán/ }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(within(cajon).getByRole("checkbox", { name: /TUC — Tucumán — Convenio Multilateral/ }));
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/c1/profile",
        expect.objectContaining({ iibbJurisdictions: ["AR-T", "TUC"] }),
      ),
    );
  });

  it("un CUIT repetido muestra el error junto al campo CUIT y deja el cajón abierto", async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError("CLIENT_CUIT_CONFLICT", "Ya existe un cliente con ese CUIT en este estudio.", 409),
    );
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    expect(await within(cajon).findByText("Ya existe un cliente con ese CUIT en este estudio.")).toBeTruthy();
    expect(screen.getByLabelText("CUIT").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Editar cliente" })).toBeTruthy();
  });

  it("si falla el PATCH de la ficha, su mensaje aparece en Datos fiscales y el cajón sigue abierto", async () => {
    vi.mocked(api.patch).mockImplementation(((path: string) =>
      path.endsWith("/profile")
        ? Promise.reject(new ApiError("VALIDATION_ERROR", "La actividad no es válida para este estudio.", 422))
        : Promise.resolve({ id: "c1" })) as never);
    renderConRutas("/clientes", <StudyClientes />);
    const cajon = await abrirEdicion();

    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    expect(await within(cajon).findByText("La actividad no es válida para este estudio.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Editar cliente" })).toBeTruthy();
  });
});
