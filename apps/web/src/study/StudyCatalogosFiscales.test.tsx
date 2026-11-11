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
  parentId: null,
  parent: null,
  isActive: true,
  origin: "REFERENCE" as const,
  createdByFirmId: null,
};
const taxType = {
  id: "tax-type-e2e",
  code: "E2E_TEST_TAX",
  name: "Impuesto sintético E2E",
  isActive: true,
  origin: "REFERENCE" as const,
  createdByFirmId: null,
};
const jurisdictions: Array<typeof jurisdiction | Record<string, unknown>> = [jurisdiction];
const taxTypes: Array<typeof taxType | Record<string, unknown>> = [taxType];
const authorities: Array<{
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
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
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  activeClientLinks?: number;
}> = [];
let catalogHasUsage = false;

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
    if (path.startsWith("/tax/catalog-usage/")) {
      return Promise.resolve({
        entityId: path.split("/").at(-1) ?? "",
        used: catalogHasUsage,
        count: catalogHasUsage ? 2 : 0,
        places: catalogHasUsage ? [{ label: "Períodos fiscales", count: 2 }] : [],
      });
    }
    if (path === "/tax/jurisdictions" || path === "/tax/jurisdictions?includeInactive=true") return Promise.resolve([...jurisdictions]);
    if (path === "/tax/types" || path === "/tax/types?includeInactive=true") return Promise.resolve([...taxTypes]);
    if (path === "/tax/authorities" || path === "/tax/authorities?includeInactive=true") return Promise.resolve([...authorities]);
    if (path === "/tax/regimes" || path === "/tax/regimes?includeInactive=true") return Promise.resolve([...regimes]);
    if (path === "/tax/activities?includeInactive=true") return Promise.resolve([...activities]);
    return Promise.resolve([]);
  }) as never);
  vi.mocked(api.post).mockImplementation(((path: string, body: Record<string, string>) => {
    if (path === "/tax/jurisdictions") {
      const parent = jurisdictions.find((item) => item.id === body.parentId);
      const created = {
        id: "jurisdiction-created",
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        kind: String(body.kind ?? "NATIONAL"),
        parentId: body.parentId ?? null,
        parent: parent ? { id: parent.id, code: parent.code, name: parent.name, kind: parent.kind } : null,
        isActive: true,
        origin: "UI" as const,
        createdByFirmId: "firm-a",
      };
      jurisdictions.push(created);
      return Promise.resolve(created);
    }
    if (path === "/tax/types") {
      const created = {
        id: "tax-type-created",
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        isActive: true,
        origin: "UI" as const,
        createdByFirmId: "firm-a",
      };
      taxTypes.push(created);
      return Promise.resolve(created);
    }
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
    const jurisdictionMatch = path.match(/^\/tax\/jurisdictions\/([^/]+)$/);
    if (jurisdictionMatch) {
      const index = jurisdictions.findIndex((item) => item.id === jurisdictionMatch[1]);
      const current = jurisdictions[index];
      if (!current) return Promise.resolve({});
      const updated = { ...current, ...body };
      jurisdictions[index] = updated;
      return Promise.resolve(updated);
    }
    const taxTypeMatch = path.match(/^\/tax\/types\/([^/]+)$/);
    if (taxTypeMatch) {
      const index = taxTypes.findIndex((item) => item.id === taxTypeMatch[1]);
      const current = taxTypes[index];
      if (!current) return Promise.resolve({});
      const updated = { ...current, ...body };
      taxTypes[index] = updated;
      return Promise.resolve(updated);
    }
    const match = path.match(/^\/tax\/activities\/([^/]+)$/);
    if (match) {
      const index = activities.findIndex((item) => item.id === match[1]);
      const current = activities[index];
      if (!current) return Promise.resolve({});
      const codeChange = typeof body.code === "string" && body.code !== current.code
        ? { previousCode: current.code, updatedReferences: 5, retainedReferences: 2 }
        : null;
      const updated = { ...current, ...body, codeChange };
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
    jurisdictions.splice(0, jurisdictions.length, jurisdiction);
    taxTypes.splice(0, taxTypes.length, taxType);
    regimes.length = 0;
    activities.length = 0;
    catalogHasUsage = false;
    contextMock.current = context();
    mockApi();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const openTab = async (name: RegExp) =>
    fireEvent.click(await screen.findByRole("tab", { name }));

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

    await openTab(/^Regímenes/);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo régimen" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "E2E_SYN_REGIME" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Régimen sintético E2E" } });
    fireEvent.change(screen.getByLabelText("Impuesto"), { target: { value: taxType.id } });
    fireEvent.change(screen.getByLabelText("Jurisdicción"), { target: { value: jurisdiction.id } });
    fireEvent.change(screen.getByLabelText("Organismo recaudador"), { target: { value: "authority-e2e" } });
    // La coherencia organismo ↔ jurisdicción se confirma en vivo, antes de enviar.
    expect(await screen.findByText(/Coherente:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crear régimen" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/tax/regimes", {
      code: "E2E_SYN_REGIME",
      name: "Régimen sintético E2E",
      taxTypeId: taxType.id,
      jurisdictionId: jurisdiction.id,
      authorityId: "authority-e2e",
    }));
  });

  it("expone jurisdicciones e impuestos y los crea desde sus pestañas", async () => {
    renderCatalogs();

    expect(await screen.findByRole("tab", { name: /Jurisdicciones/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Tipos de impuesto/ })).toBeTruthy();
    await openTab(/^Jurisdicciones/);
    fireEvent.click(await screen.findByRole("button", { name: "Nueva jurisdicción" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "AR-UI-P" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Provincia UI" } });
    fireEvent.change(screen.getByLabelText("Nivel"), { target: { value: "PROVINCIAL" } });
    fireEvent.change(screen.getByLabelText("Jurisdicción padre"), { target: { value: jurisdiction.id } });
    fireEvent.click(screen.getByRole("button", { name: "Crear jurisdicción" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/jurisdictions", {
        code: "AR-UI-P",
        name: "Provincia UI",
        kind: "PROVINCIAL",
        parentId: jurisdiction.id,
      }),
    );
    const province = await screen.findByText("Provincia UI");
    fireEvent.click(province);
    const jurisdictionDetail = await screen.findByRole("complementary", { name: "Detalle de la jurisdicción" });
    expect(within(jurisdictionDetail).getByText("Jurisdicción sintética E2E")).toBeTruthy();
    expect(within(jurisdictionDetail).queryByText("Nación Jurisdicción sintética E2E")).toBeNull();

    await openTab(/^Organismos recaudadores/);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo organismo" }));
    expect(
      await screen.findAllByRole("option", { name: /Provincia UI — Provincia, Jurisdicción sintética E2E/ }),
    ).toHaveLength(2);

    await openTab(/^Tipos de impuesto/);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo tipo de impuesto" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "UI-IIBB" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Impuesto provincial propio" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tipo de impuesto" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/types", {
        code: "UI-IIBB",
        name: "Impuesto provincial propio",
      }),
    );
    expect(await screen.findByText("Impuesto provincial propio")).toBeTruthy();
  });

  it("explica qué tipo de impuesto falta para crear un régimen y enlaza a su pestaña", async () => {
    taxTypes.length = 0;
    renderCatalogs();

    await openTab(/^Regímenes/);
    expect((await screen.findByRole("button", { name: "Nuevo régimen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Falta un tipo de impuesto: crealo en/)).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Tipos de impuesto" }));
    expect(screen.getByRole("tab", { name: /Tipos de impuesto/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("distingue el catálogo vacío de un error y permite reintentar la consulta", async () => {
    taxTypes.length = 0;
    renderCatalogs();
    await openTab(/^Tipos de impuesto/);
    expect(await screen.findByText("Todavía no hay tipos de impuesto")).toBeTruthy();
    expect(screen.queryByText("No pudimos cargar impuestos.")).toBeNull();

    cleanup();
    let typeReads = 0;
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path === "/tax/types" || path === "/tax/types?includeInactive=true") {
        typeReads += 1;
        return typeReads === 1 ? Promise.reject(new Error("Consulta sintética no disponible")) : Promise.resolve([]);
      }
      if (path === "/tax/jurisdictions" || path === "/tax/jurisdictions?includeInactive=true") return Promise.resolve([...jurisdictions]);
      if (path === "/tax/authorities" || path === "/tax/authorities?includeInactive=true") return Promise.resolve([...authorities]);
      if (path === "/tax/regimes" || path === "/tax/regimes?includeInactive=true") return Promise.resolve([...regimes]);
      if (path === "/tax/activities?includeInactive=true") return Promise.resolve([...activities]);
      return Promise.resolve([]);
    }) as never);
    renderCatalogs();
    await openTab(/^Tipos de impuesto/);
    expect(await screen.findByText("No pudimos cargar impuestos.")).toBeTruthy();
    expect(screen.queryByText("Todavía no hay tipos de impuesto")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Todavía no hay tipos de impuesto")).toBeTruthy();
  });

  it("mantiene la lectura disponible y oculta altas a quien no propone reglas", async () => {
    contextMock.current = context(false);
    renderCatalogs();

    expect(await screen.findByRole("heading", { name: "Catálogos fiscales" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: /Jurisdicciones/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Tipos de impuesto/ })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: /Organismos recaudadores/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Regímenes/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Actividades económicas/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nuevo organismo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nueva jurisdicción" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo tipo de impuesto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo régimen" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("concentra los conteos en una barra de pestañas y guarda los atajos en ayuda", async () => {
    authorities.push({
      id: "authority-a",
      code: "SYN-A",
      name: "Organismo A",
      jurisdictionId: jurisdiction.id,
      isActive: true,
      origin: "UI",
      createdByFirmId: "firm-a",
      jurisdiction,
    });
    renderCatalogs();

    const tablist = await screen.findByRole("tablist", { name: "Catálogos fiscales" });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    const authorityTab = within(tablist).getByRole("tab", { name: /Organismos recaudadores/ });
    await waitFor(() => expect(authorityTab.textContent).toContain("1"));
    expect(authorityTab).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Resumen de catálogos" })).toBeNull();
    expect(screen.getByText("1 propios, 2 de referencia")).toBeTruthy();
    expect(screen.getByText("0 alertas")).toBeTruthy();

    const shortcuts = document.querySelector(".dense-shortcuts") as HTMLDetailsElement;
    expect(shortcuts.open).toBe(false);
    const shortcutTrigger = shortcuts.querySelector("summary");
    if (!shortcutTrigger) throw new Error("Falta el control de atajos");
    fireEvent.click(shortcutTrigger);
    expect(shortcuts.open).toBe(true);
    expect(screen.getByText("navegar")).toBeTruthy();
  });

  it("ofrece editar, duplicar y ocultar con usos en las cinco entidades", async () => {
    catalogHasUsage = true;
    authorities.push({
      id: "authority-used",
      code: "AUTH-USED",
      name: "Organismo con uso",
      jurisdictionId: jurisdiction.id,
      isActive: true,
      origin: "REFERENCE",
      createdByFirmId: null,
      jurisdiction,
    });
    regimes.push({
      id: "regime-used",
      code: "REGIME-USED",
      name: "Régimen con uso",
      isActive: true,
      origin: "REFERENCE",
      createdByFirmId: null,
      authority: authorities[0],
      jurisdiction,
      taxType,
    });
    activities.push({
      id: "activity-used",
      code: "ACT-USED",
      name: "Actividad con uso",
      jurisdictionId: jurisdiction.id,
      source: null,
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
      origin: "REFERENCE",
      createdByFirmId: null,
    });
    renderCatalogs();

    const cases = [
      { tab: /^Jurisdicciones/, name: jurisdiction.name, detail: "Detalle de la jurisdicción" },
      { tab: /^Tipos de impuesto/, name: taxType.name, detail: "Detalle del tipo de impuesto" },
      { tab: /^Organismos recaudadores/, name: "Organismo con uso", detail: "Detalle del organismo" },
      { tab: /^Regímenes/, name: "Régimen con uso", detail: "Detalle del régimen" },
      { tab: /^Actividades económicas/, name: "Actividad con uso", detail: "Detalle de la actividad" },
    ];

    for (const item of cases) {
      await openTab(item.tab);
      fireEvent.click(await screen.findByText(item.name));
      const detail = await screen.findByRole("complementary", { name: item.detail });
      expect(await within(detail).findByText(/Se usa en 2 lugares/)).toBeTruthy();
      const edit = within(detail).getByRole("button", { name: "Editar" });
      expect(edit.className).toContain("ds-button--primary");
      const duplicate = within(detail).getByRole("button", { name: "Duplicar" });
      expect(duplicate.className).toContain("ds-button--secondary");
      const hide = within(detail).getByRole("button", { name: "Ocultar" });
      expect(hide.className).toContain("ds-button--ghost");
      expect(within(detail).queryByText("⋯")).toBeNull();
    }
  });

  it("identifica la copia de jurisdicción, diferencia el nombre y ancla acciones del drawer", async () => {
    renderCatalogs();
    await openTab(/^Jurisdicciones/);
    fireEvent.click(await screen.findByText(jurisdiction.name));
    const detail = await screen.findByRole("complementary", { name: "Detalle de la jurisdicción" });

    fireEvent.click(within(detail).getByRole("button", { name: "Duplicar" }));
    const createDialog = await screen.findByRole("dialog");
    expect(within(createDialog).getByRole("heading", {
      name: `Nueva jurisdicción a partir de ${jurisdiction.code}`,
    })).toBeTruthy();
    expect((within(createDialog).getByLabelText("Nombre") as HTMLInputElement).value)
      .toBe(`${jurisdiction.name} (copia)`);
    expect(within(createDialog).getByText(new RegExp(`Copia de ${jurisdiction.code}`))).toBeTruthy();
    const createButton = within(createDialog).getByRole("button", { name: "Crear jurisdicción" });
    expect(createDialog.querySelector(".action-drawer__footer")?.contains(createButton)).toBe(true);
    expect(createButton.getAttribute("form")).toBe("jurisdiction-create-form");
    fireEvent.click(within(createDialog).getByRole("button", { name: "Cancelar" }));

    fireEvent.click(within(detail).getByRole("button", { name: "Editar" }));
    const editDialog = await screen.findByRole("dialog");
    expect(within(editDialog).getByText("Actualizá el código, el nivel o el nombre.")).toBeTruthy();
    expect(within(editDialog).queryByLabelText("Jurisdicción padre")).toBeNull();
    const saveButton = within(editDialog).getByRole("button", { name: "Guardar cambios" });
    expect(editDialog.querySelector(".action-drawer__footer")?.contains(saveButton)).toBe(true);
    expect(saveButton.getAttribute("form")).toBe("jurisdiction-edit-form");
  });

  it("nombra Ocultos en el filtro de estado", async () => {
    renderCatalogs();
    const stateFilter = await screen.findByRole("combobox", { name: "Filtrar por estado" });
    expect(within(stateFilter).getByRole("option", { name: "Ocultos" }).getAttribute("value"))
      .toBe("inactive");
  });

  it("muestra una relación oculta ya asignada como opción deshabilitada", async () => {
    const hiddenTaxType = {
      ...taxType,
      id: "tax-type-hidden",
      code: "IIBB-OLD",
      name: "Impuesto anterior",
      isActive: false,
    };
    taxTypes.push(hiddenTaxType);
    const authority = {
      id: "authority-for-hidden-regime",
      code: "AUTH-HIDDEN-REGIME",
      name: "Organismo del régimen",
      jurisdictionId: jurisdiction.id,
      isActive: true,
      jurisdiction,
    };
    authorities.push(authority);
    regimes.push({
      id: "regime-hidden-type",
      code: "REGIME-HIDDEN-TYPE",
      name: "Régimen con impuesto oculto",
      isActive: true,
      authority,
      jurisdiction,
      taxType: hiddenTaxType,
    });
    renderCatalogs();

    await openTab(/^Regímenes/);
    fireEvent.click(await screen.findByText("Régimen con impuesto oculto"));
    const detail = await screen.findByRole("complementary", { name: "Detalle del régimen" });
    fireEvent.click(within(detail).getByRole("button", { name: "Editar" }));

    const select = (await screen.findByLabelText("Impuesto")) as HTMLSelectElement;
    const hiddenOption = within(select).getByRole("option", {
      name: "Impuesto anterior (IIBB-OLD) (oculto)",
    }) as HTMLOptionElement;
    expect(hiddenOption.disabled).toBe(true);
    expect(select.value).toBe(hiddenTaxType.id);
    expect(within(select).getByRole("option", { name: "Impuesto sintético E2E (E2E_TEST_TAX)" })).toBeTruthy();
  });

  it("filtra por búsqueda y abre el detalle del organismo con sus regímenes vinculados", async () => {
    authorities.push(
      {
        id: "authority-a",
        code: "SYN-A",
        name: "Organismo alfa",
        jurisdictionId: jurisdiction.id,
        isActive: true,
        jurisdiction,
      },
      {
        id: "authority-b",
        code: "SYN-B",
        name: "Organismo beta",
        jurisdictionId: jurisdiction.id,
        isActive: true,
        jurisdiction,
      },
    );
    regimes.push({
      id: "regime-a",
      code: "SYN-REG-A",
      name: "Régimen alfa",
      isActive: true,
      authority: authorities[0],
      jurisdiction,
      taxType,
    });
    renderCatalogs();

    expect(await screen.findByText("Organismo beta")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alfa" } });
    expect(screen.queryByText("Organismo beta")).toBeNull();

    fireEvent.click(screen.getByText("Organismo alfa"));
    const detail = await screen.findByRole("complementary", { name: "Detalle del organismo" });
    expect(within(detail).getByText("Regímenes vinculados · 1")).toBeTruthy();
    expect(within(detail).getByText("SYN-REG-A")).toBeTruthy();
  });

  it("señala el régimen cuyo organismo recauda en otra jurisdicción y permite filtrarlo", async () => {
    const other = { ...jurisdiction, id: "jurisdiction-other", code: "AR-OTRA", name: "Otra jurisdicción" };
    authorities.push(
      {
        id: "authority-other",
        code: "SYN-OTRA",
        name: "Organismo de otra jurisdicción",
        jurisdictionId: other.id,
        isActive: true,
        jurisdiction: other,
      },
      {
        id: "authority-same",
        code: "SYN-MISMA",
        name: "Organismo de la misma jurisdicción",
        jurisdictionId: jurisdiction.id,
        isActive: true,
        jurisdiction,
      },
    );
    regimes.push(
      {
        id: "regime-bad",
        code: "SYN-REG-BAD",
        name: "Régimen incoherente",
        isActive: true,
        authority: authorities[0],
        jurisdiction,
        taxType,
      },
      {
        id: "regime-ok",
        code: "SYN-REG-OK",
        name: "Régimen coherente",
        isActive: true,
        authority: authorities[1],
        jurisdiction,
        taxType,
      },
    );
    renderCatalogs();

    await openTab(/^Regímenes/);
    expect(await screen.findByText(/1 régimen tiene un organismo que no corresponde/)).toBeTruthy();
    expect(screen.getAllByText("Revisar")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Sólo con alertas/ }));
    await waitFor(() => expect(screen.queryByText("Régimen coherente")).toBeNull());
    expect(screen.getByText("Régimen incoherente")).toBeTruthy();

    fireEvent.click(screen.getByText("Régimen incoherente"));
    const detail = await screen.findByRole("complementary", { name: "Detalle del régimen" });
    expect(within(detail).getByText(/recauda en Otra jurisdicción/)).toBeTruthy();
  });

  it("muestra junto a los códigos de tipo de impuesto y jurisdicción qué decisión siguen", async () => {
    const tucuman = {
      ...jurisdiction,
      id: "jurisdiction-tuc-warning",
      code: "AR-T",
      name: "Tucumán",
      kind: "PROVINCIAL",
    };
    const iibb = { ...taxType, id: "tax-type-iibb-warning", code: "IIBB", name: "Ingresos Brutos" };
    jurisdictions.push(tucuman);
    taxTypes.push(iibb);
    renderCatalogs();

    await openTab(/^Jurisdicciones/);
    fireEvent.click(await screen.findByText("Tucumán"));
    const jurisdictionDetail = await screen.findByRole("complementary", { name: "Detalle de la jurisdicción" });
    fireEvent.click(within(jurisdictionDetail).getByRole("button", { name: "Editar" }));
    let editDialog = await screen.findByRole("dialog");
    expect(within(editDialog).getByText(/Este código define hoy la familia del motor según la jurisdicción/)).toBeTruthy();

    await openTab(/^Tipos de impuesto/);
    fireEvent.click(await screen.findByText("Ingresos Brutos"));
    const taxTypeDetail = await screen.findByRole("complementary", { name: "Detalle del tipo de impuesto" });
    fireEvent.click(within(taxTypeDetail).getByRole("button", { name: "Editar" }));
    editDialog = await screen.findByRole("dialog");
    expect(within(editDialog).getByText(/Este código define hoy la familia del motor y la fuente de importación/)).toBeTruthy();
  });

  it("muestra junto al código de un régimen de sistema qué decisiones siguen ese código", async () => {
    const tucuman = {
      ...jurisdiction,
      id: "jurisdiction-tuc",
      code: "AR-T",
      name: "Tucumán",
      kind: "PROVINCIAL",
    };
    const iibb = { ...taxType, id: "tax-type-iibb", code: "IIBB", name: "Ingresos Brutos" };
    const authority = {
      id: "authority-tuc",
      code: "DGR-TUC",
      name: "DGR Tucumán",
      jurisdictionId: tucuman.id,
      isActive: true,
      jurisdiction: tucuman,
    };
    jurisdictions.push(tucuman);
    taxTypes.push(iibb);
    authorities.push(authority);
    regimes.push({
      id: "regime-iibb-local",
      code: "IIBB_LOCAL_TUC",
      name: "Ingresos Brutos local",
      isActive: true,
      authority,
      jurisdiction: tucuman,
      taxType: iibb,
    });
    renderCatalogs();
    await openTab(/^Regímenes/);
    fireEvent.click(await screen.findByText("Ingresos Brutos local"));
    const detail = await screen.findByRole("complementary", { name: "Detalle del régimen" });
    fireEvent.click(within(detail).getByRole("button", { name: "Editar" }));

    const editDialog = await screen.findByRole("dialog");
    expect(within(editDialog).getByLabelText("Código")).toBeTruthy();
    expect(within(editDialog).getByText(/Este código define hoy excepciones del motor, la fuente de importación y el permiso del régimen/)).toBeTruthy();
  });

  it("presenta Ocultar como acción reversible y neutra y expone el valor completo en tooltip", async () => {
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
    await openTab(/^Actividades económicas/);

    // El código completo queda accesible (tooltip) aunque la celda se trunque.
    const code = await screen.findByText("E2E_SYN_ACTIVIDAD_LA_RGA_20261105");
    expect(code.getAttribute("title")).toBe("E2E_SYN_ACTIVIDAD_LA_RGA_20261105");
    const name = screen.getByText("Comercio mayorista sintético con nombre extenso");
    expect(name.getAttribute("title")).toBe("Comercio mayorista sintético con nombre extenso");
    const jurisdictionCell = code.closest("tr")?.querySelector(".dense-activity-jurisdiction");
    expect(jurisdictionCell?.textContent).toContain(jurisdiction.name);
    expect(jurisdictionCell?.getAttribute("title")).toContain(jurisdiction.name);
    expect(screen.getByText(/^Desde /)).toBeTruthy();
    expect(screen.queryByText(/— —$/)).toBeNull();

    // Ocultar conserva el dato y se presenta como acción neutra.
    fireEvent.click(code);
    const hide = (await screen.findByRole("button", {
      name: "Ocultar",
    })) as HTMLButtonElement;
    expect(hide.className).toContain("ds-button--ghost");
  });

  it("consulta el catálogo con includeInactive y crea una actividad con código normalizado", async () => {
    renderCatalogs();
    await openTab(/^Actividades económicas/);

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

  it("edita código, jurisdicción, nombre, fuente y vigencia", async () => {
    const anotherJurisdiction = {
      ...jurisdiction,
      id: "jurisdiction-tuc",
      code: "TUC",
      name: "Tucumán",
      kind: "PROVINCIAL",
      parentId: jurisdiction.id,
      parent: { id: jurisdiction.id, code: jurisdiction.code, name: jurisdiction.name, kind: jurisdiction.kind },
    };
    jurisdictions.push(anotherJurisdiction);
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
    await openTab(/^Actividades económicas/);

    fireEvent.click(await screen.findByText("Comercio mayorista"));
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "CM03-02-V2" } });
    fireEvent.change(document.getElementById("activity-edit-jurisdiction") as HTMLSelectElement, {
      target: { value: anotherJurisdiction.id },
    });
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
        code: "CM03-02-V2",
        name: "Comercio mayorista ampliado",
        jurisdictionId: anotherJurisdiction.id,
        source: null,
        validFrom: "2026-01-01",
        validTo: "2027-06-30",
      }),
    );
    expect(await screen.findByText(/Se propagó el cambio de código CM03-02 → CM03-02-V2: 5 referencias actualizadas\. 2 referencias conservan el código anterior \(CM03-02\)\./)).toBeTruthy();
  });

  it("oculta una actividad en uso y la vuelve a mostrar", async () => {
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
    await openTab(/^Actividades económicas/);

    fireEvent.click(await screen.findByText("Comercio mayorista"));
    fireEvent.click(await screen.findByRole("button", { name: "Ocultar" }));
    const drawer = document.querySelector(".action-drawer") as HTMLElement;
    fireEvent.click(within(drawer).getByRole("button", { name: "Ocultar" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/activities/activity-a/deactivate"),
    );
    expect(await screen.findByText(/La actividad quedó oculta en los selectores/)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Mostrar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/activities/activity-a/activate"),
    );
    expect(await screen.findByText(/La actividad vuelve a mostrarse/)).toBeTruthy();
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
    await openTab(/^Actividades económicas/);

    expect(await screen.findByText("Servicios profesionales")).toBeTruthy();
    expect(screen.getByText("Oculta")).toBeTruthy();
    fireEvent.click(screen.getByText("Servicios profesionales"));
    await screen.findByRole("complementary", { name: "Detalle de la actividad" });
    expect(screen.queryByRole("button", { name: "Nueva actividad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mostrar" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("ofrece eliminación sólo al Titular y sólo para catálogos UI de su estudio", async () => {
    authorities.push(
      {
        id: "authority-owned",
        code: "SYN-OWNED-AUTH",
        name: "Organismo propio sintético",
        jurisdictionId: jurisdiction.id,
        isActive: true,
        origin: "UI",
        createdByFirmId: "firm-a",
        jurisdiction,
      },
      {
        id: "authority-reference",
        code: "SYN-REFERENCE-AUTH",
        name: "Organismo de referencia sintético",
        jurisdictionId: jurisdiction.id,
        isActive: true,
        origin: "REFERENCE",
        createdByFirmId: null,
        jurisdiction,
      },
    );
    regimes.push({
      id: "regime-owned",
      code: "SYN-OWNED-REGIME",
      name: "Régimen propio sintético",
      isActive: true,
      origin: "UI",
      createdByFirmId: "firm-a",
      authority: authorities[0],
      jurisdiction,
      taxType,
    });
    activities.push({
      id: "activity-owned",
      code: "SYN-OWNED-ACT",
      name: "Actividad propia sintética",
      jurisdictionId: jurisdiction.id,
      source: null,
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
      origin: "UI",
      createdByFirmId: "firm-a",
    });
    const ownerContext = context();
    ownerContext.capabilities = new Set([...ownerContext.capabilities, "data.delete"]);
    contextMock.current = ownerContext;
    renderCatalogs();

    // Organismos: sólo el creado desde la UI por este estudio ofrece Eliminar.
    fireEvent.click(await screen.findByText("Organismo propio sintético"));
    let detail = await screen.findByRole("complementary", { name: "Detalle del organismo" });
    await within(detail).findByText("Sin usos registrados.");
    fireEvent.click(within(detail).getByText("⋯"));
    let secondaryActions = within(detail).getByRole("group", { name: "Acciones secundarias" });
    let remove = within(secondaryActions).getByRole("button", { name: "Eliminar" });
    expect(remove.className).toContain("ds-button--danger");
    fireEvent.click(screen.getByText("Organismo de referencia sintético"));
    detail = await screen.findByRole("complementary", { name: "Detalle del organismo" });
    expect(within(detail).getByText("SYN-REFERENCE-AUTH")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Eliminar" })).toBeNull();
    expect(within(detail).queryByText("⋯")).toBeNull();

    await openTab(/^Regímenes/);
    fireEvent.click(await screen.findByText("Régimen propio sintético"));
    detail = await screen.findByRole("complementary", { name: "Detalle del régimen" });
    await within(detail).findByText("Sin usos registrados.");
    fireEvent.click(within(detail).getByText("⋯"));
    secondaryActions = within(detail).getByRole("group", { name: "Acciones secundarias" });
    remove = within(secondaryActions).getByRole("button", { name: "Eliminar" });
    expect(remove.className).toContain("ds-button--danger");

    await openTab(/^Actividades económicas/);
    fireEvent.click(await screen.findByText("Actividad propia sintética"));
    detail = await screen.findByRole("complementary", { name: "Detalle de la actividad" });
    await within(detail).findByText("Sin usos registrados.");
    fireEvent.click(within(detail).getByText("⋯"));
    secondaryActions = within(detail).getByRole("group", { name: "Acciones secundarias" });
    remove = within(secondaryActions).getByRole("button", { name: "Eliminar" });
    expect(remove.className).toContain("ds-button--danger");
  });
});
