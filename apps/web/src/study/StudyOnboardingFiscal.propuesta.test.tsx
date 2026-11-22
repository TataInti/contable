// @vitest-environment jsdom
// Datos sintéticos: cliente «SINTÉTICO» con CUIT inventado.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyOnboardingFiscal } from "./StudyOnboardingFiscal";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
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

const clienteAlta = {
  id: "client-synthetic",
  legalName: "Cliente SINTÉTICO persona humana",
  cuit: "20111111112",
  cuitEnding: "2",
  status: "ACTIVE",
  profile: { legalForm: "Persona humana", vatCondition: "RESPONSABLE_INSCRIPTO", province: "Tucumán", activity: null, accountingStandard: null, functionalCurrency: "ARS", fiscalYearEndMonth: 12, iibbJurisdictions: [], serviceStartDate: null },
};

function context(): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: "client-synthetic",
    periodId: null,
    isReady: true,
    capabilities: new Set(["tax.profile.read", "tax.profile.write"]),
    hasClientAccess: (id) => id === "client-synthetic",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderOnboarding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyOnboardingFiscal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.current = context();
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/firms/firm-a/clients/client-synthetic") return Promise.resolve(clienteAlta);
    return Promise.resolve([]);
  }) as never);
  vi.mocked(api.post).mockImplementation(((path: string, payload?: unknown) => Promise.resolve({ id: "profile-created", ...(payload as object), path })) as never);
});

afterEach(() => cleanup());

describe("StudyOnboardingFiscal · perfil nuevo precargado desde el alta", () => {
  it("«Crear perfil fiscal» muestra razón social, CUIT, tipo y condición del alta, y guarda con esos valores", async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByRole("button", { name: "Crear perfil fiscal" }));
    const dialogo = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    // El alta llega en una consulta aparte: esperamos a que se resuelva antes de leer la propuesta.
    await act(async () => { await new Promise((resolver) => setTimeout(resolver, 0)); });

    await waitFor(() => expect((within(dialogo).getByLabelText("Razón social") as HTMLInputElement).value).toBe("Cliente SINTÉTICO persona humana"));
    expect((within(dialogo).getByLabelText("CUIT") as HTMLInputElement).value).toBe("20111111112");
    expect((within(dialogo).getByLabelText("Tipo de persona") as HTMLSelectElement).value).toBe("FISICA");
    expect((within(dialogo).getByLabelText("Condición nacional") as HTMLSelectElement).value).toBe("RESPONSABLE_INSCRIPTO");
    expect(within(dialogo).getByText("Propuesto según la forma jurídica del alta")).toBeTruthy();

    const guardar = within(dialogo.querySelector(".action-drawer__footer") as HTMLElement).getByRole("button", { name: "Crear perfil" }) as HTMLButtonElement;
    expect(guardar.disabled).toBe(false);
    fireEvent.click(guardar);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-synthetic/tax-profile-versions",
      expect.objectContaining({ personType: "FISICA", nationalCondition: "RESPONSABLE_INSCRIPTO", cuit: "20111111112" }),
    ));
  });
});
