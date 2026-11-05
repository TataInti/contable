// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const activities: Array<{
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  source: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  activeClientLinks?: number;
}> = [];

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
    if (path === "/tax/activities?includeInactive=true") return Promise.resolve([...activities]);
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
    if (path === "/tax/activities") {
      const created = {
        id: "activity-e2e",
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        jurisdictionId: String(body.jurisdictionId ?? ""),
        source: body.source ? String(body.source) : null,
        validFrom: String(body.validFrom ?? ""),
        validTo: body.validTo ? String(body.validTo) : null,
        isActive: true,
      };
      activities.push(created);
      return Promise.resolve(created);
    }
    const deactivate = path.match(/^\/tax\/activities\/([^/]+)\/deactivate$/);
    if (deactivate) {
      const index = activities.findIndex((item) => item.id === deactivate[1]);
      const current = activities[index];
      if (!current) return Promise.resolve({});
      const updated = {
        ...current,
        isActive: false,
        activeClientLinks: current.activeClientLinks ?? 0,
      };
      activities[index] = updated;
      return Promise.resolve(updated);
    }
    const activate = path.match(/^\/tax\/activities\/([^/]+)\/activate$/);
    if (activate) {
      const index = activities.findIndex((item) => item.id === activate[1]);
      const current = activities[index];
      if (!current) return Promise.resolve({});
      const updated = { ...current, isActive: true };
      activities[index] = updated;
      return Promise.resolve(updated);
    }
    return Promise.resolve({});
  }) as never);
  vi.mocked(api.patch).mockImplementation(((path: string, body: Record<string, unknown>) => {
    const match = path.match(/^\/tax\/activities\/([^/]+)$/);
    if (match) {
      const index = activities.findIndex((item) => item.id === match[1]);
      const current = activities[index];
      if (!current) return Promise.resolve({});
      const updated = { ...current, ...body };
      activities[index] = updated;
      return Promise.resolve(updated);
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
    activities.length = 0;
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

  it("jerarquiza Desactivar como destructiva y expone el valor completo en tooltip", async () => {
    activities.push({
      id: "activity-a",
      code: "E2E_SYN_ACTIVIDAD_LA_RGA_20261105",
      name: "Comercio mayorista sintético con nombre extenso",
      jurisdictionId: jurisdiction.id,
      source: "CM03",
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
    });
    renderCatalogs();

    // La baja lógica se ve como acción destructiva, no como una acción más.
    const deactivate = (await screen.findByRole("button", {
      name: "Desactivar",
    })) as HTMLButtonElement;
    expect(deactivate.className).toContain("ds-button--danger");

    // El código completo queda accesible (tooltip) aunque la celda se trunque.
    const code = screen.getByText("E2E_SYN_ACTIVIDAD_LA_RGA_20261105");
    expect(code.getAttribute("title")).toBe("E2E_SYN_ACTIVIDAD_LA_RGA_20261105");
    const name = screen.getByText("Comercio mayorista sintético con nombre extenso");
    expect(name.getAttribute("title")).toBe("Comercio mayorista sintético con nombre extenso");
  });

  it("consulta el catálogo con includeInactive y crea una actividad con código normalizado", async () => {
    renderCatalogs();

    // El alta se habilita recién cuando las jurisdicciones están cargadas.
    const newActivityButton = await screen.findByRole("button", { name: "Nueva actividad" });
    await waitFor(() =>
      expect((newActivityButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(newActivityButton);
    fireEvent.change(await screen.findByLabelText("Código"), {
      target: { value: " cm03-02 " },
    });
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Comercio mayorista sintético" },
    });
    fireEvent.change(screen.getByLabelText("Jurisdicción"), {
      target: { value: jurisdiction.id },
    });
    fireEvent.change(screen.getByLabelText("Vigencia desde"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Fuente"), {
      target: { value: "CM03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear actividad" }));

    expect(api.get).toHaveBeenCalledWith("/tax/activities?includeInactive=true");
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/activities", {
        code: "CM03-02",
        name: "Comercio mayorista sintético",
        jurisdictionId: jurisdiction.id,
        source: "CM03",
        validFrom: "2026-01-01",
      }),
    );
    expect(await screen.findByText("La actividad quedó registrada en el catálogo.")).toBeTruthy();
    expect(await screen.findByText("CM03-02")).toBeTruthy();
  });

  it("edita nombre, fuente y vigencia sin tocar el código ni la jurisdicción", async () => {
    activities.push({
      id: "activity-a",
      code: "CM03-02",
      name: "Comercio mayorista",
      jurisdictionId: jurisdiction.id,
      source: "CM03",
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
    });
    renderCatalogs();

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    expect(screen.getAllByText("CM03-02").length).toBeGreaterThanOrEqual(1);
    expect((screen.getByLabelText("Jurisdicción (no editable)") as HTMLInputElement).value).toBe(
      `${jurisdiction.name} (${jurisdiction.code})`,
    );
    fireEvent.change(await screen.findByLabelText("Nombre"), {
      target: { value: "Comercio mayorista ampliado" },
    });
    fireEvent.change(screen.getByLabelText("Fuente"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Vigencia hasta"), {
      target: { value: "2027-06-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/tax/activities/activity-a", {
        name: "Comercio mayorista ampliado",
        source: null,
        validFrom: "2026-01-01",
        validTo: "2027-06-30",
      }),
    );
    expect(await screen.findByText(/El código se conserva/)).toBeTruthy();
  });

  it("desactiva una actividad avisando los vínculos vigentes y la reactiva", async () => {
    activities.push({
      id: "activity-a",
      code: "CM03-02",
      name: "Comercio mayorista",
      jurisdictionId: jurisdiction.id,
      source: "CM03",
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
      activeClientLinks: 1,
    });
    renderCatalogs();

    fireEvent.click(await screen.findByRole("button", { name: "Desactivar" }));
    const drawer = document.querySelector(".action-drawer") as HTMLElement;
    fireEvent.click(within(drawer).getByRole("button", { name: "Desactivar" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/activities/activity-a/deactivate"),
    );
    expect(await screen.findByText(/Conserva 1 vínculo/)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Reactivar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/activities/activity-a/activate"),
    );
    expect(await screen.findByText(/vuelve a estar activa/)).toBeTruthy();
  });

  it("muestra el catálogo en solo lectura y oculta la gestión a quien no propone", async () => {
    activities.push({
      id: "activity-b",
      code: "SERV4",
      name: "Servicios profesionales",
      jurisdictionId: jurisdiction.id,
      source: null,
      validFrom: "2026-01-01",
      validTo: null,
      isActive: false,
    });
    contextMock.current = context(false);
    renderCatalogs();

    expect(await screen.findByText("Servicios profesionales")).toBeTruthy();
    expect(screen.getByText("Desactivada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nueva actividad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactivar" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
