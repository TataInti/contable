// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

interface ProfileFixture {
  id: string;
  version: number;
  legalName: string;
  cuit: string;
  personType: "FISICA" | "JURIDICA";
  nationalCondition: "RESPONSABLE_INSCRIPTO";
  fiscalAddress?: string | null;
  status: "DRAFT" | "IN_REVIEW" | "ACTIVE" | "SUPERSEDED";
}

const profiles: ProfileFixture[] = [];

function renderOnboarding() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyOnboardingFiscal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

function mockApi() {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.includes("tax-profile-versions")) return Promise.resolve([...profiles]);
    return Promise.resolve([]);
  }) as never);
  vi.mocked(api.post).mockImplementation(((path: string, payload?: unknown) => {
    if (path.endsWith("/tax-profile-versions")) {
      const data = (payload ?? {}) as Record<string, unknown>;
      const created: ProfileFixture = {
        id: "profile-created",
        version: 1,
        legalName: String(data.legalName ?? ""),
        cuit: String(data.cuit ?? ""),
        personType: data.personType as "FISICA" | "JURIDICA",
        nationalCondition: data.nationalCondition as "RESPONSABLE_INSCRIPTO",
        fiscalAddress: typeof data.fiscalAddress === "string" ? data.fiscalAddress : null,
        status: "DRAFT",
      };
      profiles.push(created);
      return Promise.resolve(created);
    }
    if (path.endsWith("/submit-review")) {
      const successor = profiles.find((profile) => profile.id === "profile-v2");
      if (successor) successor.status = "IN_REVIEW";
      return Promise.resolve(successor);
    }
    if (path.endsWith("/activate")) {
      const predecessor = profiles.find((profile) => profile.id === "profile-v1");
      const successor = profiles.find((profile) => profile.id === "profile-v2");
      if (predecessor) predecessor.status = "SUPERSEDED";
      if (successor) successor.status = "ACTIVE";
      return Promise.resolve(successor);
    }
    return Promise.resolve({});
  }) as never);
}

describe("StudyOnboardingFiscal — acciones de la versión sucesora", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
    profiles.splice(
      0,
      profiles.length,
      {
        id: "profile-v1",
        version: 1,
        legalName: "Cliente sintético SA",
        cuit: "20111111111",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        status: "ACTIVE",
      },
      {
        id: "profile-v2",
        version: 2,
        legalName: "Cliente sintético actualizado SA",
        cuit: "20111111111",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        status: "DRAFT",
      },
    );
    mockApi();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("revisa y activa la última DRAFT mientras la versión anterior sigue activa", async () => {
    renderOnboarding();

    fireEvent.click(await screen.findByRole("button", { name: "Enviar a revisión" }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-synthetic/tax-profile-versions/profile-v2/submit-review",
      );
    });
    expect(profiles.find((profile) => profile.id === "profile-v1")?.status).toBe("ACTIVE");

    fireEvent.click(await screen.findByRole("button", { name: "Activar perfil" }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-synthetic/tax-profile-versions/profile-v2/activate",
      );
    });
    expect(profiles.find((profile) => profile.id === "profile-v2")?.status).toBe("ACTIVE");
    expect(profiles.find((profile) => profile.id === "profile-v1")?.status).toBe("SUPERSEDED");
  });

  it("presenta una acción principal, un stepper y un estado por paso", async () => {
    profiles.splice(0, profiles.length);
    renderOnboarding();

    expect(screen.getByRole("heading", { name: "Configuración fiscal" })).toBeTruthy();
    const page = document.querySelector(".dense-page") as HTMLElement;
    expect(page.querySelectorAll("button.ds-button--primary")).toHaveLength(1);
    expect(within(page).getByRole("button", { name: "Crear perfil fiscal" })).toBeTruthy();

    const stepper = screen.getByRole("navigation", { name: "Pasos del onboarding fiscal" });
    expect(screen.getAllByRole("navigation", { name: "Pasos del onboarding fiscal" })).toHaveLength(1);
    expect(within(stepper).getAllByText("Pendiente", { exact: true })).toHaveLength(5);
    expect(screen.queryByRole("group", { name: "Avance del onboarding fiscal" })).toBeNull();

    fireEvent.click(within(page).getByRole("button", { name: "Crear perfil fiscal" }));
    const drawer = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    const footer = drawer.querySelector(".action-drawer__footer") as HTMLElement;
    expect(within(footer).getByRole("button", { name: "Crear perfil" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("valida y guarda el domicilio fiscal, y lo muestra en el resumen del onboarding", async () => {
    profiles.splice(0, profiles.length);
    renderOnboarding();

    fireEvent.click(await screen.findByRole("button", { name: "Crear perfil fiscal" }));
    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Cliente sintético SA" } });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111111" } });
    const addressInput = screen.getByLabelText("Domicilio fiscal") as HTMLInputElement;
    fireEvent.change(addressInput, { target: { value: "   " } });
    expect(addressInput.checkValidity()).toBe(false);
    fireEvent.change(addressInput, { target: { value: "Av. Rivadavia 123" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear perfil" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-synthetic/tax-profile-versions",
      expect.objectContaining({ fiscalAddress: "Av. Rivadavia 123" }),
    ));
    expect(await screen.findByText("Av. Rivadavia 123")).toBeTruthy();
  });
});
