// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { ApiError, api } from "../lib/api";
import { StudyReglasFiscales } from "./StudyReglasFiscales";

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

const activeActivities = [
  {
    id: "act-1",
    code: "CM03-02",
    name: "Comercio mayorista",
    jurisdictionId: "jur-ar",
    source: null,
    validFrom: "2026-01-01",
    validTo: null,
    isActive: true,
  },
  {
    id: "act-2",
    code: "SERV4",
    name: "Servicios profesionales",
    jurisdictionId: "jur-ba",
    source: null,
    validFrom: "2026-01-01",
    validTo: null,
    isActive: true,
  },
];
const hiddenActivity = {
  id: "act-hidden",
  code: "CM03-OLD",
  name: "Comercio histórico",
  jurisdictionId: "jur-ar",
  source: null,
  validFrom: "2020-01-01",
  validTo: null,
  isActive: false,
};
const vatEngines = [
  {
    id: "engine-vat-current",
    engineKey: "vat-ri",
    engineVersion: "ar-vat-ri-v2.1.0",
    familyId: "family-vat",
    familyKey: "VAT_RI",
    label: "IVA RI por alícuota",
  },
  {
    id: "engine-vat-legacy",
    engineKey: "vat-ri-legacy",
    engineVersion: "ar-vat-ri-v1.0.0",
    familyId: "family-vat",
    familyKey: "VAT_RI",
    label: "IVA RI legacy",
  },
];
const iibbEngines = [
  {
    id: "engine-iibb-local",
    engineKey: "iibb-local-tuc",
    engineVersion: "ar-iibb-tuc-local-v1.1.0",
    familyId: "family-iibb",
    familyKey: "IIBB_LOCAL",
    label: "IIBB local Tucumán",
  },
];

function makeDetail(activityCode: string | null) {
  return {
    id: "pack-1",
    code: "IVA-RI-ARCA",
    name: "IVA Responsable Inscripto",
    status: "DRAFT",
    origin: "UI" as "REFERENCE" | "UI",
    createdByFirmId: "firm-a" as string | null,
    regime: {
      id: "regime-1",
      code: "RI",
      name: "Responsable Inscripto",
      calcFamilyId: "family-vat" as string | null,
      taxType: { name: "IVA", code: "IVA" },
      jurisdiction: { id: "jur-ar", name: "Nación", code: "AR" },
      authority: { id: "auth-1", name: "ARCA" },
    },
    versions: [
      {
        id: "version-1",
        version: 1,
        status: "DRAFT",
        origin: "UI" as "REFERENCE" | "UI",
        createdByFirmId: "firm-a" as string | null,
        validFrom: "2026-01-01",
        validTo: null,
        engineVersion: "ar-vat-ri-v2.1.0",
        rulesHash: "abc",
        rateRules: [
          {
            id: "rule-1",
            concept: "Operaciones generales",
            kindId: "kind-rate-vat",
            activityId: activityCode === "CM03-02" ? "act-1" : activityCode === "CM03-OLD" ? "act-hidden" : null,
            categoryCode: null,
            isDefault: false,
            activityCode,
            jurisdictionId: null,
            rate: "21",
            minAmount: null,
            validFrom: "2026-01-01",
            validTo: null,
          },
        ],
        dueDateRules: [],
        sources: [],
      },
    ],
  };
}

function packList(detail: ReturnType<typeof makeDetail>) {
  return [
    {
      id: detail.id,
      code: detail.code,
      name: detail.name,
      status: detail.status,
      origin: detail.origin,
      createdByFirmId: detail.createdByFirmId,
      regime: {
        id: detail.regime.id,
        name: detail.regime.name,
        code: detail.regime.code,
        calcFamilyId: detail.regime.calcFamilyId,
        taxType: { name: "IVA", code: "IVA" },
        jurisdiction: { name: detail.regime.jurisdiction.name },
      },
      versions: detail.versions,
    },
  ];
}

function mockApi(detail: ReturnType<typeof makeDetail>) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/tax/rule-packs") return Promise.resolve(packList(detail));
    if (path === "/tax/rule-packs/pack-1") return Promise.resolve(detail);
    if (path === `/tax/regimes/${detail.regime.id}/engines`) {
      if (!detail.regime.calcFamilyId) {
        return Promise.reject(new ApiError(
          "REGIME_FAMILY_REQUIRED",
          "Elegí la familia de cálculo del régimen",
          422,
        ));
      }
      return Promise.resolve(detail.regime.calcFamilyId === "family-iibb" ? iibbEngines : vatEngines);
    }
    if (path === `/tax/regimes/${detail.regime.id}/rule-kinds`) {
      return Promise.resolve([{ id: "kind-rate-vat", key: "RATE", label: "Alícuota", subject: "ACTIVITY" }]);
    }
    if (path === "/tax/activities" || path === "/tax/activities?includeInactive=true") return Promise.resolve([...activeActivities, hiddenActivity]);
    if (path === "/tax/regimes") return Promise.resolve([]);
    return Promise.resolve([]);
  }) as never);
}

function context(): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(["tax.rules.read", "tax.rules.propose"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderReglas() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StudyReglasFiscales />
    </QueryClientProvider>,
  );
}

describe("StudyReglasFiscales — selector de actividad del catálogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ofrece opciones de cálculo del régimen y envía el identificador elegido", async () => {
    const detail = { ...makeDetail(null), versions: [] };
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }, { timeout: 5000 }));
    const select = (await screen.findByLabelText("Opción de cálculo")) as HTMLSelectElement;
    expect(select.value).toBe("engine-vat-current");
    expect(within(select).getByRole("option", { name: "IVA RI legacy" })).toBeTruthy();
    expect(within(select).queryByRole("option", { name: "IIBB local Tucumán" })).toBeNull();
    expect(api.get).toHaveBeenCalledWith("/tax/regimes/regime-1/engines");

    fireEvent.change(select, { target: { value: "engine-vat-legacy" } });
    const form = select.closest("form");
    expect(form).not.toBeNull();
    fireEvent.click(within(form!).getByRole("button", { name: "Crear primera versión" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-packs/pack-1/versions", {
        validFrom: expect.any(String),
        engineId: "engine-vat-legacy",
        rulesHash: "PENDING_DRAFT",
      }),
    );
  });

  it("usa las opciones del régimen aunque su código sea propio del estudio", async () => {
    const base = makeDetail(null);
    const detail = {
      ...base,
      versions: [],
      regime: { ...base.regime, code: "RI_ESTUDIO_2026" },
    };
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const select = (await screen.findByLabelText("Opción de cálculo")) as HTMLSelectElement;
    expect(select.value).toBe("engine-vat-current");
    expect(within(select).getByRole("option", { name: "IVA RI legacy" })).toBeTruthy();
  });

  it("muestra únicamente las opciones que devuelve la familia del régimen", async () => {
    const base = makeDetail(null);
    const detail = {
      ...base,
      versions: [],
      regime: { ...base.regime, calcFamilyId: "family-iibb" },
    };
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const select = (await screen.findByLabelText("Opción de cálculo")) as HTMLSelectElement;
    expect(select.value).toBe("engine-iibb-local");
    expect(within(select).getByRole("option", { name: "IIBB local Tucumán" })).toBeTruthy();
    expect(within(select).queryByRole("option", { name: "IVA RI por alícuota" })).toBeNull();
  });

  it("guía a editar el régimen cuando falta la familia de cálculo", async () => {
    const base = makeDetail(null);
    const detail = {
      ...base,
      versions: [],
      regime: { ...base.regime, calcFamilyId: null },
    };
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    expect(await screen.findByText("Elegí una familia de cálculo")).toBeTruthy();
    const editLink = screen.getByRole("link", { name: "Editar régimen" });
    expect(editLink.getAttribute("href")).toBe("/catalogos-fiscales?editRegime=regime-1");
    expect(screen.queryByLabelText("Opción de cálculo")).toBeNull();
    const form = within(await screen.findByRole("dialog"));
    expect((form.getByRole("button", { name: "Crear primera versión" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("marca una vigencia fuera de rango y evita enviar la versión", async () => {
    mockApi({ ...makeDetail(null), versions: [] });
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const date = (await screen.findByLabelText("Vigencia desde")) as HTMLInputElement;
    expect(date.min).toBe("1900-01-01");
    expect(date.max).toBe("2100-12-31");
    fireEvent.change(date, { target: { value: "61001-02-02" } });
    const form = date.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByText(/año entre 1900 y 2100/)).toBeTruthy();
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("ofrece las actividades activas del catálogo y guarda el código elegido", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    expect((await screen.findByLabelText("Tipo de regla rule-1") as HTMLSelectElement).value).toBe("kind-rate-vat");
    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "Sin actividad específica" })).toBeTruthy();
    expect(
      within(select).getByRole("option", { name: "CM03-02 · Comercio mayorista" }),
    ).toBeTruthy();
    expect(select.value).toBe("");

    fireEvent.change(select, { target: { value: "act-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          expect.objectContaining({
            concept: "Operaciones generales",
            kindId: "kind-rate-vat",
            rate: "21",
            activityId: "act-1",
            activityCode: "CM03-02",
            validFrom: "2026-01-01",
          }),
        ],
      }),
    );
  });

  it("filtra las opciones por la jurisdicción del paquete", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    // El paquete es de jur-ar: SERV4 (jur-ba) no debe ofrecerse.
    expect(
      within(select).getByRole("option", { name: "CM03-02 · Comercio mayorista" }),
    ).toBeTruthy();
    expect(
      within(select).queryByRole("option", { name: "SERV4 · Servicios profesionales" }),
    ).toBeNull();
  });

  it("muestra como oculto el código asignado y deshabilita su opción", async () => {
    mockApi(makeDetail("CM03-OLD"));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    expect(select.value).toBe("act-hidden");
    const hiddenOption = within(select).getByRole("option", { name: "CM03-OLD (oculto)" }) as HTMLOptionElement;
    expect(hiddenOption.disabled).toBe(true);
    expect(within(select).getByRole("option", { name: "CM03-02 · Comercio mayorista" })).toBeTruthy();
  });

  it("ofrece las categorías cerradas A–K y envía el código elegido", async () => {
    const base = makeDetail(null);
    const detail = {
      ...base,
      regime: { ...base.regime, calcFamilyId: "family-mono" },
      versions: [{ ...base.versions[0]!, rateRules: [{ ...base.versions[0]!.rateRules[0]!, kindId: "kind-fee", categoryCode: null }] }],
    };
    mockApi(detail);
    const originalGet = vi.mocked(api.get).getMockImplementation();
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path === `/tax/regimes/${detail.regime.id}/rule-kinds`
        ? Promise.resolve([{ id: "kind-fee", key: "FEE", label: "Cuota", subject: "CATEGORY" }])
        : originalGet?.(path) ?? Promise.resolve([])) as never);
    renderReglas();

    const category = (await screen.findByLabelText("Categoría rule-1")) as HTMLSelectElement;
    expect(within(category).getAllByRole("option")).toHaveLength(12);
    expect(within(category).getByRole("option", { name: "Categoría K" })).toBeTruthy();
    fireEvent.change(category, { target: { value: "K" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/tax/rule-versions/version-1/rate-rules",
      expect.objectContaining({ rules: [expect.objectContaining({ kindId: "kind-fee", categoryCode: "K" })] }),
    ));
  });

  it("ubica el error de tipo devuelto por la API junto al desplegable", async () => {
    mockApi(makeDetail(null));
    vi.mocked(api.put).mockRejectedValue(new ApiError(
      "RULE_VERSION_INVALID",
      "Elegí un tipo de regla disponible para este régimen.",
      422,
      null,
      { details: { path: ["rules", "0", "kindId"], message: "Elegí un tipo de regla disponible para este régimen." } },
    ));
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Guardar borrador" }));
    const errors = await screen.findAllByText("Elegí un tipo de regla disponible para este régimen.");
    const inlineError = errors.find((candidate) => candidate.classList.contains("fiscal-rule-row-error"));
    expect(inlineError?.getAttribute("role")).toBe("alert");
    expect(inlineError?.parentElement?.querySelector("select[aria-label='Tipo de regla rule-1']")).toBeTruthy();
  });
});

describe("StudyReglasFiscales — rótulos de versión sin ambigüedad (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("distingue el borrador en edición de la versión activa del paquete", async () => {
    const detail = makeDetail(null);
    detail.versions = [
      { ...detail.versions[0]!, id: "version-draft", version: 2, status: "DRAFT", rateRules: [] },
      { ...detail.versions[0]!, id: "version-active", version: 4, status: "ACTIVE", rateRules: [] },
    ];
    mockApi(detail);
    renderReglas();

    // El índice menciona ambas versiones: borrador en curso y vigente.
    expect(await screen.findByText("Borrador v2 · Vigente v4")).toBeTruthy();
    // El resumen dice explícitamente qué se está editando y cuál es la activa.
    expect(await screen.findByText("Editando borrador")).toBeTruthy();
    expect(await screen.findByText("Versión activa")).toBeTruthy();
    // El CTA guiado identifica la versión: Editar borrador v2.
    expect(screen.getByRole("button", { name: "Editar borrador v2" })).toBeTruthy();
  });

  it("mantiene el rótulo previo cuando no hay borrador en curso", async () => {
    const detail = makeDetail(null);
    detail.versions = [
      { ...detail.versions[0]!, id: "version-active", version: 4, status: "ACTIVE", rateRules: [] },
    ];
    mockApi(detail);
    renderReglas();

    expect(await screen.findByText("Vigente v4")).toBeTruthy();
    // El detalle cargó: muestra "Versión" como rótulo simple, sin activa extra.
    expect(await screen.findByText(/^Versión$/)).toBeTruthy();
    expect(screen.queryByText("Editando borrador")).toBeNull();
    expect(screen.queryByText("Versión activa")).toBeNull();
  });
});

describe("StudyReglasFiscales — CTA único y submit deshabilitado explicado (F8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("deja un único alta de paquete y explica el submit deshabilitado", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    expect(await screen.findByRole("button", { name: "Crear paquete" })).toBeTruthy();
    // No hay un segundo CTA "Nuevo" en el índice de paquetes.
    expect(screen.queryByRole("button", { name: "Nuevo" })).toBeNull();
    expect(await screen.findByText(/Completá código, nombre y régimen/)).toBeTruthy();
  });

  it("explica por qué no se puede guardar un borrador con filas incompletas", async () => {
    const detail = makeDetail(null);
    detail.versions = [
      { ...detail.versions[0]!, rateRules: [{ ...detail.versions[0]!.rateRules[0]!, concept: "", rate: null as unknown as string, minAmount: null }] },
    ];
    mockApi(detail);
    renderReglas();

    const save = (await screen.findByRole("button", {
      name: "Guardar borrador",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Completá la tasa, cuota o importe/)).toBeTruthy();
  });

  it("muestra al Titular el borrado del paquete y del borrador creados desde UI", async () => {
    const owner = context();
    owner.capabilities = new Set([...owner.capabilities, "data.delete"]);
    contextMock.current = owner;
    mockApi(makeDetail(null));
    renderReglas();

    expect(await screen.findByRole("button", { name: "Eliminar paquete" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Eliminar borrador v1" })).toBeTruthy();
  });

  it("mantiene protegidos los paquetes y versiones de referencia", async () => {
    const owner = context();
    owner.capabilities = new Set([...owner.capabilities, "data.delete"]);
    contextMock.current = owner;
    const detail = makeDetail(null);
    detail.origin = "REFERENCE";
    detail.createdByFirmId = null;
    detail.versions = detail.versions.map((version) => ({
      ...version,
      origin: "REFERENCE",
      createdByFirmId: null,
    }));
    mockApi(detail);
    renderReglas();

    expect(await screen.findByRole("heading", { name: "IVA Responsable Inscripto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Eliminar paquete" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Eliminar borrador/ })).toBeNull();
  });
});

describe("StudyReglasFiscales — estado del selector de regímenes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("distingue la lista vacía y enlaza a Catálogos fiscales", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    expect(await screen.findByText(/Todavía no hay regímenes/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Catálogos fiscales" }).getAttribute("href")).toBe("/catalogos-fiscales");
    expect(screen.queryByText(/No pudimos consultar los regímenes/)).toBeNull();
  });

  it("muestra error de consulta con reintento separado del estado vacío", async () => {
    mockApi(makeDetail(null));
    const originalGet = vi.mocked(api.get).getMockImplementation();
    let regimeReads = 0;
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path === "/tax/regimes") {
        regimeReads += 1;
        return regimeReads === 1
          ? Promise.reject(new Error("Error sintético de consulta"))
          : Promise.resolve([]);
      }
      return originalGet?.(path) ?? Promise.resolve([]);
    }) as never);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    expect(await screen.findByText(/No pudimos consultar los regímenes/)).toBeTruthy();
    expect(screen.queryByText(/Todavía no hay regímenes/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText(/Todavía no hay regímenes/)).toBeTruthy();
  });
});

describe("StudyReglasFiscales — activación directa por Administrador", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra Activar con capacidad y confirma nombre y vigencia antes de llamar a API", async () => {
    mockApi(makeDetail(null));
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderReglas();

    const activateButton = (await screen.findByRole("button", { name: /^Activar$/ })) as HTMLButtonElement;
    await waitFor(() => expect(activateButton.disabled).toBe(false));
    fireEvent.click(activateButton);

    const confirmation = await screen.findByRole("dialog");
    expect(
      within(confirmation).getByRole("heading", {
        name: "IVA Responsable Inscripto · versión v1",
      }),
    ).toBeTruthy();
    const validity = within(confirmation).getByText(/Vigencia:/);
    expect(validity.textContent).toContain("—");
    expect(api.post).not.toHaveBeenCalled();
    expect(within(confirmation).queryByText(/Al activar esta versión/)).toBeNull();
  });

  it("muestra la advertencia de retiro cuando el paquete ya tiene una versión activa", async () => {
    const detail = makeDetail(null);
    detail.versions.push({ ...detail.versions[0]!, id: "version-active", version: 3, status: "ACTIVE" });
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: /^Activar$/ }));
    const confirmation = await screen.findByRole("dialog");
    expect(
      within(confirmation).getByText(
        "Al activar esta versión, la versión vigente quedará retirada",
      ),
    ).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("cancelar no llama a la API y devuelve el foco al botón Activar", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    const activateButton = await screen.findByRole("button", { name: /^Activar$/ });
    activateButton.focus();
    fireEvent.click(activateButton);
    const confirmation = await screen.findByRole("dialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(document.activeElement).toBe(activateButton));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirmar llama al endpoint y muestra el recibo junto a la tarjeta del paquete", async () => {
    mockApi(makeDetail(null));
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderReglas();

    const activateButton = await screen.findByRole("button", { name: /^Activar$/ });
    fireEvent.click(activateButton);
    const confirmation = await screen.findByRole("dialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Activar versión" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-versions/version-1/activate"),
    );
    const packageCard = activateButton.closest("section");
    expect(packageCard).not.toBeNull();
    expect(
      await within(packageCard!).findByText(
        "La versión v1 quedó activa y disponible para próximos cálculos.",
      ),
    ).toBeTruthy();
    expect(within(packageCard!).getByRole("status")).toBeTruthy();
  });

  it("oculta Activar cuando falta tax.rules.propose aunque exista la capacidad legacy", async () => {
    contextMock.current = {
      ...context(),
      capabilities: new Set(["tax.rules.read", "tax.rules.activate"]),
    };
    mockApi(makeDetail(null));
    renderReglas();

    expect(await screen.findByRole("heading", { name: "IVA Responsable Inscripto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Activar$/ })).toBeNull();
  });

  it("pide guardar las reglas editadas antes de activar el borrador", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    fireEvent.change(await screen.findByLabelText("Concepto rule-1"), {
      target: { value: "Operaciones modificadas" },
    });
    const activateButton = (await screen.findByRole("button", { name: /^Activar$/ })) as HTMLButtonElement;

    expect(activateButton.disabled).toBe(false);
    fireEvent.click(activateButton);

    const packageCard = activateButton.closest("section");
    expect(packageCard).not.toBeNull();
    const activationAlert = await within(packageCard!).findByRole("alert");
    expect(activationAlert.textContent).toContain(
      "Guardá los cambios del borrador antes de activarlo.",
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("muestra error de validación y permite activar una versión histórica en revisión", async () => {
    const detail = makeDetail(null);
    detail.versions = [
      { ...detail.versions[0]!, id: "version-draft", version: 4, status: "DRAFT" },
      { ...detail.versions[0]!, id: "version-review", version: 2, status: "IN_REVIEW" },
      { ...detail.versions[0]!, id: "version-active", version: 3, status: "ACTIVE" },
    ];
    mockApi(detail);
    vi.mocked(api.post).mockRejectedValue(new Error("El hash no coincide con las reglas guardadas."));
    renderReglas();

    const versionSelect = await screen.findByLabelText("Versión del paquete");
    fireEvent.change(versionSelect, { target: { value: "version-review" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Activar$/ }));
    const confirmation = await screen.findByRole("dialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Activar versión" }));

    const packageCard = screen.getByRole("heading", { name: "IVA Responsable Inscripto" }).closest("section");
    expect(packageCard).not.toBeNull();
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/tax/rule-versions/version-review/activate");
      expect(within(packageCard!).getByRole("alert").textContent).toContain("El hash no coincide");
    });
  });

  it("muestra junto al botón un ApiError 409 con su campo y mensaje", async () => {
    mockApi(makeDetail(null));
    vi.mocked(api.post).mockRejectedValue(
      new ApiError("RULE_VERSION_INVALID", "La vigencia no es válida.", 409, null, {
        details: [{ path: ["validFrom"], message: "La vigencia se superpone." }],
      }),
    );
    renderReglas();

    const activateButton = await screen.findByRole("button", { name: /^Activar$/ });
    fireEvent.click(activateButton);
    const confirmation = await screen.findByRole("dialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Activar versión" }));

    const packageCard = activateButton.closest("section");
    expect(packageCard).not.toBeNull();
    const alert = await within(packageCard!).findByRole("alert");
    expect(alert.textContent).toContain("Vigencia desde");
    expect(alert.textContent).toContain("La vigencia se superpone.");
  });

  it("limpia el error viejo de otra mutación para mostrar el error de activación actual", async () => {
    mockApi(makeDetail(null));
    vi.mocked(api.put).mockRejectedValue(new Error("Error viejo de guardado"));
    vi.mocked(api.post).mockRejectedValue(new Error("Error actual de activación"));
    renderReglas();

    const concept = await screen.findByLabelText("Concepto rule-1");
    fireEvent.change(concept, { target: { value: "Cambio temporal" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText("Error viejo de guardado")).toBeTruthy();

    fireEvent.change(concept, { target: { value: "Operaciones generales" } });
    const activateButton = await screen.findByRole("button", { name: /^Activar$/ });
    fireEvent.click(activateButton);
    const confirmation = await screen.findByRole("dialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Activar versión" }));

    const packageCard = activateButton.closest("section");
    expect(packageCard).not.toBeNull();
    expect(await within(packageCard!).findByText("Error actual de activación")).toBeTruthy();
    expect(screen.queryByText("Error viejo de guardado")).toBeNull();
  });
});

describe("StudyReglasFiscales — estado vacío de paquetes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra un único estado vacío y una sola acción para crear paquetes", async () => {
    mockApi(makeDetail(null));
    const originalGet = vi.mocked(api.get).getMockImplementation();
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path === "/tax/rule-packs" ? Promise.resolve([]) : originalGet?.(path) ?? Promise.resolve([])) as never);
    renderReglas();

    expect(await screen.findByRole("heading", { name: "Todavía no hay paquetes de reglas" })).toBeTruthy();
    expect(document.querySelectorAll(".ds-empty")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Nuevo paquete" })).toHaveLength(1);
    expect(document.querySelectorAll(".fiscal-rules .ds-button--primary")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Crear paquete" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Paquetes de reglas disponibles" })).toBeNull();
    expect(screen.queryByText("No hay paquetes configurados.")).toBeNull();

    const guide = screen.getByText(/Secuencia de cambios:/);
    const guideBlock = guide.closest(".fiscal-rules-guide");
    expect(guideBlock).not.toBeNull();
    expect(guideBlock?.parentElement?.classList.contains("fiscal-rules")).toBe(true);
    expect(document.querySelectorAll(".fiscal-rules > .fiscal-rules-guide")).toHaveLength(1);
  });
});

describe("StudyReglasFiscales — validación del tipo de regla", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("señala el tipo en la fila antes de guardar", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    fireEvent.change(await screen.findByLabelText("Tipo de regla rule-1"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    const error = await screen.findByText("Seleccioná un tipo de regla.");
    expect(error.getAttribute("role")).toBe("alert");
    expect(api.put).not.toHaveBeenCalled();
  });
});
