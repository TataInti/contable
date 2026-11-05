// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyCatalogosFiscales } from "./StudyCatalogosFiscales";

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

const jurisdiction = {
  id: "jurisdiction-ar",
  code: "AR-E2E-SYN",
  name: "Jurisdicción sintética E2E",
  kind: "NATIONAL",
};
const taxType = { id: "tax-type-e2e", code: "E2E_TEST_TAX", name: "Impuesto sintético E2E" };
const authorities: Array<{
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  isActive: boolean;
  jurisdiction: typeof jurisdiction;
}> = [];
const regimes: Array<Record<string, unknown>> = [];

function context(canPropose = true): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(canPropose ? ["tax.rules.read", "tax.rules.propose"] : ["tax.rules.read"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function mockApi() {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/tax/jurisdictions") return Promise.resolve([jurisdiction]);
    if (path === "/tax/types") return Promise.resolve([taxType]);
    if (path === "/tax/authorities") return Promise.resolve([...authorities]);
    if (path === "/tax/regimes") return Promise.resolve([...regimes]);
    return Promise.resolve([]);
  }) as never);
  vi.mocked(api.post).mockImplementation(((path: string, body: Record<string, string>) => {
    if (path === "/tax/authorities") {
      const created = {
        id: "authority-e2e",
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        jurisdictionId: String(body.jurisdictionId ?? ""),
        isActive: true,
        jurisdiction,
      };
      authorities.push(created);
      return Promise.resolve(created);
    }
    if (path === "/tax/regimes") {
      const created = {
        id: "regime-e2e",
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        isActive: true,
        authority: authorities.find((item) => item.id === body.authorityId),
        jurisdiction,
        taxType,
      };
      regimes.push(created);
      return Promise.resolve(created);
    }
    return Promise.resolve({});
  }) as never);
}

function renderCatalogs() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StudyCatalogosFiscales />
    </QueryClientProvider>,
  );
}

describe("StudyCatalogosFiscales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorities.length = 0;
    regimes.length = 0;
    contextMock.current = context();
    mockApi();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("crea autoridad y régimen enlazados a la misma jurisdicción", async () => {
    renderCatalogs();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo organismo" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "E2E_SYN_AUTH" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Autoridad sintética E2E" } });
    fireEvent.change(screen.getByLabelText("Jurisdicción"), { target: { value: jurisdiction.id } });
    fireEvent.click(screen.getByRole("button", { name: "Crear organismo" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/tax/authorities", {
      code: "E2E_SYN_AUTH",
      name: "Autoridad sintética E2E",
      jurisdictionId: jurisdiction.id,
    }));
    await screen.findByText("Autoridad sintética E2E");

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo régimen" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "E2E_SYN_REGIME" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Régimen sintético E2E" } });
    fireEvent.change(screen.getByLabelText("Impuesto"), { target: { value: taxType.id } });
    fireEvent.change(screen.getByLabelText("Jurisdicción"), { target: { value: jurisdiction.id } });
    fireEvent.change(screen.getByLabelText("Organismo recaudador"), { target: { value: "authority-e2e" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear régimen" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/tax/regimes", {
      code: "E2E_SYN_REGIME",
      name: "Régimen sintético E2E",
      taxTypeId: taxType.id,
      jurisdictionId: jurisdiction.id,
      authorityId: "authority-e2e",
    }));
  });

  it("mantiene la lectura disponible y oculta altas a quien no propone reglas", async () => {
    contextMock.current = context(false);
    renderCatalogs();

    expect(await screen.findByRole("heading", { name: "Catálogos fiscales" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Organismos recaudadores" })).toBeTruthy();
    expect(screen.getByText(/ARCA en Nación \(ex AFIP\)/)).toBeTruthy();
    expect(screen.queryByText(/compartidos entre estudios/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo organismo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo régimen" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
