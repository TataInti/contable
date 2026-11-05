// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
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
        name: detail.regime.name,
        code: detail.regime.code,
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
    if (path === "/tax/activities") return Promise.resolve([...activeActivities]);
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

  it("ofrece motores compatibles del régimen y envía la selección elegida", async () => {
    const detail = { ...makeDetail(null), versions: [] };
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const select = (await screen.findByLabelText("Motor compatible con el régimen")) as HTMLSelectElement;
    expect(select.value).toBe("ar-vat-ri-v2.1.0");
    expect(within(select).getByRole("option", { name: /ar-vat-ri-v1.0.0/ })).toBeTruthy();
    expect(within(select).queryByRole("option", { name: "tax-engine-v1" })).toBeNull();

    fireEvent.change(select, { target: { value: "ar-vat-ri-v1.0.0" } });
    const form = select.closest("form");
    expect(form).not.toBeNull();
    fireEvent.click(within(form!).getByRole("button", { name: "Crear primera versión" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-packs/pack-1/versions", {
        validFrom: expect.any(String),
        engineVersion: "ar-vat-ri-v1.0.0",
        rulesHash: "PENDING_DRAFT",
      }),
    );
  });

  it("resuelve el motor por impuesto aunque el código de régimen sea propio del estudio", async () => {
    const base = makeDetail(null);
    const detail = {
      ...base,
      versions: [],
      regime: { ...base.regime, code: "RI_ESTUDIO_2026" },
    };
    mockApi(detail);
    renderReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Crear primera versión" }));
    const select = (await screen.findByLabelText("Motor compatible con el régimen")) as HTMLSelectElement;
    expect(select.value).toBe("ar-vat-ri-v2.1.0");
    expect(within(select).getByRole("option", { name: /ar-vat-ri-v1.0.0/ })).toBeTruthy();
  });

  it("ofrece las actividades activas del catálogo y guarda el código elegido", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "General" })).toBeTruthy();
    expect(
      within(select).getByRole("option", { name: "CM03-02 · Comercio mayorista" }),
    ).toBeTruthy();
    expect(select.value).toBe("");

    fireEvent.change(select, { target: { value: "CM03-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          expect.objectContaining({
            concept: "Operaciones generales",
            rate: "21",
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

  it("conserva como opción un código histórico hoy desactivado", async () => {
    mockApi(makeDetail("CM03-OLD"));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    expect(select.value).toBe("CM03-OLD");
    expect(within(select).getByRole("option", { name: /código histórico/ })).toBeTruthy();
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
      { ...detail.versions[0]!, rateRules: [{ ...detail.versions[0]!.rateRules[0]!, concept: "" }] },
    ];
    mockApi(detail);
    renderReglas();

    const save = (await screen.findByRole("button", {
      name: "Guardar borrador",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Completá el concepto y la alícuota o el mínimo/)).toBeTruthy();
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