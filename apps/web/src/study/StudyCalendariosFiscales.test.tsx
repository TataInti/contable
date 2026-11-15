// @vitest-environment jsdom
import { readStudyStyles } from "./studyStyles.testutil";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { ApiError, api } from "../lib/api";
import { StudyCalendariosFiscales } from "./StudyCalendariosFiscales";

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

/* Datos sintéticos rotulados. Los conceptos y terminaciones de IVA e Ingresos Brutos
 * de Tucumán siguen los CSV verificados (calendarios/c0a-*.csv). */

const FIRM = "firm-a";
const AUTH = "a0000000-0000-4000-8000-000000000001";
const JUR = "b0000000-0000-4000-8000-000000000001";
const JUR_TUC = "b0000000-0000-4000-8000-000000000002";
const TYPE_IVA = "d0000000-0000-4000-8000-000000000001";
const REG_IVA = "e0000000-0000-4000-8000-000000000001";
const CAL_DRAFT = "c0000000-0000-4000-8000-000000000001";
const CAL_PUB = "c0000000-0000-4000-8000-000000000002";
const CAL_HIDDEN = "c0000000-0000-4000-8000-000000000003";
const CAL_TUC = "c0000000-0000-4000-8000-000000000004";
const CAL_NEW = "c0000000-0000-4000-8000-000000000005";
const ENTRY_IVA_A = "f0000000-0000-4000-8000-000000000001";
const ENTRY_IVA_B = "f0000000-0000-4000-8000-000000000002";
const ENTRY_IVA_C = "f0000000-0000-4000-8000-000000000003";
const ENTRY_IB = "f0000000-0000-4000-8000-000000000004";
const ENTRY_PUB = "f0000000-0000-4000-8000-000000000005";

const IVA = "IVA — Responsable Inscripto";
const IB = "Ingresos Brutos — anticipo mensual";

const CAP_READ = new Set(["tax.calendars.read"]);
const CAP_MANAGE = new Set(["tax.calendars.read", "tax.calendars.manage"]);
const CAP_PUBLISH = new Set(["tax.calendars.read", "tax.calendars.manage", "tax.calendars.publish"]);
const CAP_PUBLISH_MEMBERS = new Set([...CAP_PUBLISH, "firm.users.manage"]);

const authorities = [{ id: AUTH, code: "AUT-SYN", name: "Organismo sintético", jurisdictionId: JUR }];
const jurisdictions = [
  { id: JUR, code: "JUR-SYN", name: "Jurisdicción sintética", kind: "NATIONAL", isActive: true },
  { id: JUR_TUC, code: "JUR-SYN-2", name: "Jurisdicción sintética 2", kind: "PROVINCIAL", isActive: true },
];
const taxTypes = [{ id: TYPE_IVA, code: "IVA-SYN", name: "Impuesto sintético IVA", isActive: true }];
const regimes = [
  { id: REG_IVA, code: "REG-SYN", name: "Régimen sintético RI", taxType: { id: TYPE_IVA, name: "Impuesto sintético IVA" } },
];
const members = [
  {
    id: "m-1",
    userId: "u-owner",
    role: "OWNER",
    status: "ACTIVE",
    acceptedAt: null,
    user: { name: "Ana Titular", emailNormalized: "ana@estudio.test", status: "ACTIVE" },
  },
];

interface EntryFixture {
  id: string;
  conceptLabel: string;
  groupingKind: "ENDING_DIGITS" | "ALL";
  endingDigits: string | null;
  referenceLabel: string | null;
  referencePeriodStart: string | null;
  referencePeriodEnd: string | null;
  dueDate: string;
  reviewState: "PROPOSED" | "REVIEWED" | "FLAGGED";
  sortOrder: number;
}

function entry(
  id: string,
  conceptLabel: string,
  endingDigits: string | null,
  dueDate: string,
  referenceLabel: string | null,
  sortOrder: number,
): EntryFixture {
  return {
    id,
    conceptLabel,
    groupingKind: endingDigits ? "ENDING_DIGITS" : "ALL",
    endingDigits,
    referenceLabel,
    referencePeriodStart: referenceLabel ? "2026-01-01T00:00:00.000Z" : null,
    referencePeriodEnd: referenceLabel ? "2026-01-31T00:00:00.000Z" : null,
    dueDate: `${dueDate}T00:00:00.000Z`,
    reviewState: "REVIEWED",
    sortOrder,
  };
}

const DRAFT_ENTRIES: EntryFixture[] = [
  entry(ENTRY_IVA_A, IVA, "0123", "2026-02-18", "Ene-26", 0),
  entry(ENTRY_IVA_B, IVA, "456", "2026-02-19", "Ene-26", 1),
  entry(ENTRY_IVA_C, IVA, "789", "2026-02-20", "Ene-26", 2),
  entry(ENTRY_IB, IB, "01", "2026-02-18", "Anticipo Ene-26", 3),
];

interface CalendarFixture {
  id: string;
  status: "DRAFT" | "PUBLISHED" | "HIDDEN";
  version: number;
  jurisdictionId: string;
  entries: EntryFixture[];
  supersedesId?: string | null;
  publishedAt?: string | null;
  publishedByUserId?: string | null;
  hiddenAt?: string | null;
  hiddenByUserId?: string | null;
  title?: string;
}

function calendar(input: CalendarFixture) {
  const jurisdiction = jurisdictions.find((item) => item.id === input.jurisdictionId) ?? jurisdictions[0]!;
  return {
    id: input.id,
    firmId: FIRM,
    taxAuthorityId: AUTH,
    jurisdictionId: input.jurisdictionId,
    year: 2026,
    title: input.title ?? "Calendario sintético 2026",
    version: input.version,
    status: input.status,
    sourceId: null,
    supersedesId: input.supersedesId ?? null,
    createdByUserId: "u-owner",
    publishedByUserId: input.publishedByUserId ?? null,
    publishedAt: input.publishedAt ?? null,
    hiddenByUserId: input.hiddenByUserId ?? null,
    hiddenAt: input.hiddenAt ?? null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    taxAuthority: { id: AUTH, code: "AUT-SYN", name: "Organismo sintético" },
    jurisdiction: { id: jurisdiction.id, code: jurisdiction.code, name: jurisdiction.name },
    entries: input.entries,
  };
}

const CALENDARS = [
  calendar({ id: CAL_DRAFT, status: "DRAFT", version: 3, jurisdictionId: JUR, entries: DRAFT_ENTRIES, supersedesId: CAL_PUB }),
  calendar({
    id: CAL_PUB,
    status: "PUBLISHED",
    version: 2,
    jurisdictionId: JUR,
    entries: [entry(ENTRY_PUB, IVA, "0123", "2026-02-18", "Ene-26", 0)],
    publishedAt: "2026-11-10T12:00:00.000Z",
    publishedByUserId: "u-owner",
  }),
  calendar({
    id: CAL_HIDDEN,
    status: "HIDDEN",
    version: 1,
    jurisdictionId: JUR,
    entries: [],
    hiddenAt: "2026-11-12T12:00:00.000Z",
    hiddenByUserId: "u-owner",
  }),
  calendar({
    id: CAL_TUC,
    status: "DRAFT",
    version: 1,
    jurisdictionId: JUR_TUC,
    entries: [entry("f0000000-0000-4000-8000-000000000010", IB, "0123456789", "2026-02-18", "Anticipo Ene-26", 0)],
    title: "Calendario sintético Tucumán 2026",
  }),
];

/** Validación del borrador con problemas: falta la cobertura de IB. */
const DRAFT_PROBLEMS = [
  {
    field: "entries[3].endingDigits",
    message: `${IB} (Anticipo Ene-26): faltan los dígitos 2 a 9`,
    severity: "ERROR",
  },
];

let validationOverride: Record<string, unknown> = {};
let listFailures = 0;

function validationFor(id: string) {
  if (validationOverride[id]) return validationOverride[id];
  const target = CALENDARS.find((item) => item.id === id);
  const problems = id === CAL_DRAFT ? DRAFT_PROBLEMS : [];
  return {
    calendarId: id,
    status: target?.status ?? "DRAFT",
    entries: target?.entries.length ?? 0,
    canPublish: problems.length === 0,
    problems,
  };
}

function listFor(params: URLSearchParams) {
  return CALENDARS.filter(
    (item) =>
      (!params.get("year") || item.year === Number(params.get("year"))) &&
      (!params.get("taxAuthorityId") || item.taxAuthorityId === params.get("taxAuthorityId")) &&
      (!params.get("jurisdictionId") || item.jurisdictionId === params.get("jurisdictionId")),
  ).map(({ entries, ...rest }) => ({ ...rest, _count: { entries: entries.length } }));
}

function respond(path: string): Promise<unknown> {
  const [pathname = "", query = ""] = path.split("?");
  if (pathname === "/tax/authorities") return Promise.resolve(authorities);
  if (pathname === "/tax/jurisdictions") return Promise.resolve(jurisdictions);
  if (pathname === "/tax/types") return Promise.resolve(taxTypes);
  if (pathname === "/tax/regimes") return Promise.resolve(regimes);
  if (pathname === `/firms/${FIRM}/members`) return Promise.resolve(members);
  if (pathname === `/firms/${FIRM}/tax-calendars`) {
    if (listFailures > 0) {
      listFailures -= 1;
      return Promise.reject(new ApiError("INTERNAL_ERROR", "Falló la consulta", 500));
    }
    return Promise.resolve(listFor(new URLSearchParams(query)));
  }
  const match = /^\/firms\/firm-a\/tax-calendars\/([^/]+)(\/validation)?$/.exec(pathname);
  if (match) {
    const id = match[1] ?? "";
    if (match[2]) return Promise.resolve(validationFor(id));
    const found = CALENDARS.find((item) => item.id === id);
    if (found) return Promise.resolve(found);
  }
  return Promise.reject(new ApiError("NOT_FOUND", "No encontramos el recurso solicitado", 404));
}

const get = api.get as unknown as Mock;
const post = api.post as unknown as Mock;
const patch = api.patch as unknown as Mock;
const del = api.del as unknown as Mock;

let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

function setCapabilities(capabilities: Set<string>) {
  contextMock.current = { firmId: FIRM, capabilities } as unknown as ClientContextValue;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <StudyCalendariosFiscales />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  validationOverride = {};
  listFailures = 0;
  lastSearch = "";
  get.mockImplementation((path: string) => respond(path));
  post.mockImplementation((path: string) => {
    if (path.endsWith("/publish")) {
      return Promise.resolve({
        calendar: calendar({ id: CAL_DRAFT, status: "PUBLISHED", version: 3, jurisdictionId: JUR, entries: DRAFT_ENTRIES }),
        hiddenCalendarId: CAL_PUB,
      });
    }
    if (path.endsWith("/hide")) {
      return Promise.resolve(calendar({ id: CAL_PUB, status: "HIDDEN", version: 2, jurisdictionId: JUR, entries: [] }));
    }
    if (path.endsWith("/show")) {
      return Promise.resolve({
        calendar: calendar({ id: CAL_HIDDEN, status: "PUBLISHED", version: 1, jurisdictionId: JUR, entries: [] }),
        hiddenCalendarId: CAL_PUB,
      });
    }
    if (path.endsWith("/create-from")) {
      return Promise.resolve(
        calendar({ id: CAL_NEW, status: "DRAFT", version: 4, jurisdictionId: JUR, entries: [], supersedesId: CAL_PUB }),
      );
    }
    if (path.endsWith("/entries")) {
      return Promise.resolve(calendar({ id: CAL_DRAFT, status: "DRAFT", version: 3, jurisdictionId: JUR, entries: DRAFT_ENTRIES }));
    }
    return Promise.resolve(calendar({ id: CAL_NEW, status: "DRAFT", version: 1, jurisdictionId: JUR, entries: [] }));
  });
  patch.mockImplementation(() =>
    Promise.resolve(calendar({ id: CAL_DRAFT, status: "DRAFT", version: 3, jurisdictionId: JUR, entries: DRAFT_ENTRIES })),
  );
  del.mockImplementation(() => Promise.resolve(null));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const listUrl = "/calendarios-fiscales";
const ficha = (id: string) => `/calendarios-fiscales?calendario=${id}`;

describe("lista de calendarios", () => {
  it("muestra la carga inicial con su texto y después la tabla", async () => {
    setCapabilities(CAP_READ);
    get.mockImplementation((path: string) =>
      path.includes("/tax-calendars") ? new Promise(() => undefined) : respond(path),
    );
    renderAt(listUrl);
    expect(await screen.findByText("Cargando los calendarios")).toBeTruthy();
  });

  it("muestra el vacío confirmado con la salida para crear el primero", async () => {
    setCapabilities(CAP_MANAGE);
    get.mockImplementation((path: string) => (path.includes("/tax-calendars") ? Promise.resolve([]) : respond(path)));
    renderAt(listUrl);
    expect(await screen.findByText("Todavía no hay calendarios")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Nuevo calendario" }).length).toBe(2);
  });

  it("ofrece reintentar cuando la lista falla y se recupera al reintentar", async () => {
    setCapabilities(CAP_READ);
    listFailures = 1;
    renderAt(listUrl);
    expect(await screen.findByText("No se pudieron cargar los calendarios")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table", { name: "Calendarios fiscales" })).toBeTruthy();
  });

  it("lee los filtros de la dirección y «Quitar filtros» vacía el enlace", async () => {
    setCapabilities(CAP_READ);
    renderAt(`${listUrl}?anio=2026&estado=publicado`);
    const table = await screen.findByRole("table", { name: "Calendarios fiscales" });
    expect(within(table).getAllByRole("row").length).toBe(2);
    expect((screen.getByRole("combobox", { name: "Año" }) as HTMLSelectElement).value).toBe("2026");
    expect(screen.getByRole("button", { name: "Publicado" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(lastSearch).toBe("");
    expect((await screen.findByRole("table", { name: "Calendarios fiscales" })).querySelectorAll("tbody tr").length).toBe(4);
  });

  it("cambiar un filtro escribe la dirección", async () => {
    setCapabilities(CAP_READ);
    renderAt(listUrl);
    await screen.findByRole("table", { name: "Calendarios fiscales" });
    fireEvent.change(screen.getByRole("combobox", { name: "Año" }), { target: { value: "2026" } });
    expect(lastSearch).toContain("anio=2026");
    fireEvent.click(screen.getByRole("button", { name: "Oculto" }));
    expect(lastSearch).toContain("estado=oculto");
  });

  it("sin coincidencias ofrece quitar filtros", async () => {
    setCapabilities(CAP_READ);
    renderAt(`${listUrl}?anio=2026&estado=oculto&jurisdiccion=${JUR_TUC}`);
    expect(await screen.findByText("Ningún calendario coincide")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Quitar filtros" }).length).toBe(2);
  });

  it("los estados de la lista se leen con punto y texto", async () => {
    setCapabilities(CAP_READ);
    renderAt(listUrl);
    await screen.findByRole("table", { name: "Calendarios fiscales" });
    const hiddenLabel = document.querySelector('[data-status="HIDDEN"] .status-badge__label');
    expect(hiddenLabel?.textContent).toBe("Oculto");
    expect(document.querySelector('[data-status="HIDDEN"] .status-badge__dot')?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("alta de calendario", () => {
  it("valida el año al tipear y muestra el error del servidor junto al organismo", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(listUrl);
    fireEvent.click((await screen.findAllByRole("button", { name: "Nuevo calendario" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo calendario" });
    fireEvent.change(within(dialog).getByLabelText("Año"), { target: { value: "1999" } });
    expect(within(dialog).getByText("El año debe estar entre 2000 y 2100")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Organismo"), { target: { value: AUTH } });
    fireEvent.change(within(dialog).getByLabelText("Jurisdicción"), { target: { value: JUR } });
    fireEvent.change(within(dialog).getByLabelText("Año"), { target: { value: "2026" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Calendario sintético 2026" } });
    post.mockImplementationOnce(() =>
      Promise.reject(
        new ApiError("CALENDAR_REFERENCE_NOT_FOUND", "El organismo no existe en el catálogo", 422, null, {
          code: "CALENDAR_REFERENCE_NOT_FOUND",
          message: "El organismo no existe en el catálogo",
          details: { path: ["taxAuthorityId"] },
        }),
      ),
    );
    fireEvent.submit(document.getElementById("nuevo-calendario-form")!);
    expect(await within(dialog).findByText("El organismo no existe en el catálogo")).toBeTruthy();
    expect(post.mock.calls[0]?.[1]).toEqual({ taxAuthorityId: AUTH, jurisdictionId: JUR, year: 2026, title: "Calendario sintético 2026" });
  });

  it("al crear, abre la ficha de la versión nueva y avisa por el canal de notificaciones", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(listUrl);
    fireEvent.click((await screen.findAllByRole("button", { name: "Nuevo calendario" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo calendario" });
    fireEvent.change(within(dialog).getByLabelText("Organismo"), { target: { value: AUTH } });
    fireEvent.change(within(dialog).getByLabelText("Jurisdicción"), { target: { value: JUR } });
    fireEvent.change(within(dialog).getByLabelText("Año"), { target: { value: "2026" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Calendario sintético 2026" } });
    fireEvent.submit(document.getElementById("nuevo-calendario-form")!);
    expect(await screen.findByText("Calendario creado: versión 1 en borrador.")).toBeTruthy();
    await waitFor(() => expect(lastSearch).toBe(`?calendario=${CAL_NEW}`));
  });
});

describe("ficha del calendario", () => {
  it("muestra las tres secciones en pestañas y un solo h1", async () => {
    setCapabilities(CAP_PUBLISH);
    renderAt(ficha(CAL_DRAFT));
    const tabs = await screen.findByRole("tablist", { name: "Secciones del calendario" });
    expect(within(tabs).getByRole("tab", { name: /^Resumen/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(tabs).getByRole("tab", { name: /^Celdas/ })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /^Versiones/ })).toBeTruthy();
    const headings = document.querySelectorAll("h1");
    expect(headings.length).toBe(1);
    expect(headings[0]?.textContent).toBe("Calendarios fiscales");
  });

  it("con problemas, Publicar queda deshabilitado con el motivo al lado y lleva al primer problema", async () => {
    setCapabilities(CAP_PUBLISH);
    renderAt(ficha(CAL_DRAFT));
    const publish = await screen.findByRole("button", { name: "Publicar" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No se puede publicar: falta 1 problema por resolver/)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(`${IB} \\(Anticipo Ene-26\\): faltan los dígitos 2 a 9`)).length).toBeGreaterThan(0);

    // Con un solo problema hay un solo enlace: «Ir al problema», en el informe.
    expect(screen.getAllByRole("button", { name: "Ir al problema" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Ir al primer problema" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ir al problema" }));
    expect(screen.getByRole("tab", { name: /^Celdas/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.getAttribute("data-row-key")).toBe(ENTRY_IB);
  });

  it("sin problemas, Publicar pide confirmación, envía la llamada y avisa la versión que dejó de estar visible", async () => {
    setCapabilities(CAP_PUBLISH);
    validationOverride[CAL_DRAFT] = { calendarId: CAL_DRAFT, status: "DRAFT", entries: 4, canPublish: true, problems: [] };
    renderAt(ficha(CAL_DRAFT));
    const publish = await screen.findByRole("button", { name: "Publicar" });
    await vi.waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(publish);
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Las obligaciones ya creadas no cambian/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Publicar calendario" }));
    await vi.waitFor(() =>
      expect(post.mock.calls.some((call) => call[0] === `/firms/${FIRM}/tax-calendars/${CAL_DRAFT}/publish`)).toBe(true),
    );
    expect(await screen.findByText("Publicada la versión 3. Dejó de estar visible la versión 2.")).toBeTruthy();
  });

  it("crear una versión a partir de este lo anuncia como copia y abre la copia", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_PUB));
    fireEvent.click(await screen.findByRole("button", { name: "Crear una versión a partir de este" }));
    expect(
      await screen.findByText(
        "Copia creada: versión 4 en borrador, a partir de la versión 2. Corregila y publicala cuando esté lista.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(lastSearch).toBe(`?calendario=${CAL_NEW}`));
  });

  it("ocultar y mostrar: el aviso de mostrar informa la versión que dejó de estar visible", async () => {
    setCapabilities(CAP_PUBLISH);
    renderAt(ficha(CAL_PUB));
    fireEvent.click(await screen.findByRole("button", { name: "Ocultar" }));
    expect(await screen.findByText("La versión 2 quedó oculta. Podés volver a mostrarla.")).toBeTruthy();

    cleanup();
    renderAt(ficha(CAL_HIDDEN));
    fireEvent.click((await screen.findAllByRole("button", { name: "Mostrar" }))[0]!);
    expect(
      await screen.findByText("La versión 1 vuelve a estar visible. Dejó de estar visible la versión 2."),
    ).toBeTruthy();
  });

  it("versiones: el historial muestra quién y cuándo publicó", async () => {
    setCapabilities(CAP_PUBLISH_MEMBERS);
    renderAt(ficha(CAL_PUB));
    fireEvent.click(await screen.findByRole("tab", { name: /^Versiones/ }));
    const table = await screen.findByRole("table", { name: "Versiones del calendario" });
    expect(within(table).getAllByRole("row").length).toBe(4);
    expect(within(table).getByText(/2026-11-10 · Ana Titular/)).toBeTruthy();
  });
});

describe("celdas", () => {
  it("agrupa por concepto y muestra la terminación como texto (IVA 0-3, 4-6, 7-9; IB Tucumán con rótulo corrido)", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_DRAFT));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    const table = await screen.findByRole("table", { name: "Celdas del calendario" });
    expect(within(table).getByText("0 a 3")).toBeTruthy();
    expect(within(table).getByText("4 a 6")).toBeTruthy();
    expect(within(table).getByText("7 a 9")).toBeTruthy();
    expect(within(table).getByText("0 a 1")).toBeTruthy();
    expect(within(table).getByText("Anticipo Ene-26 (2026-01-01 a 2026-01-31)")).toBeTruthy();
    expect(table.querySelectorAll("tr.dense-group-row").length).toBe(2);
  });

  it("agregar: valida la fecha al tipear, exige los dígitos al guardar y envía la celda", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_DRAFT));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar celda" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar celda" });
    fireEvent.change(within(dialog).getByLabelText("Concepto (como figura en el PDF)"), {
      target: { value: "Concepto sintético" },
    });
    fireEvent.change(within(dialog).getByLabelText("Fecha de vencimiento (AAAA-MM-DD)"), {
      target: { value: "2026-02-30" },
    });
    expect(within(dialog).getByText("La fecha debe ser una fecha real con formato AAAA-MM-DD")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Fecha de vencimiento (AAAA-MM-DD)"), {
      target: { value: "2026-02-27" },
    });
    fireEvent.submit(document.getElementById("celda-form")!);
    expect(within(dialog).getByText("Indicá las terminaciones de la celda (por ejemplo 0123)")).toBeTruthy();

    const digits = within(within(dialog).getByRole("group", { name: "Terminaciones de CUIT" }));
    fireEvent.click(digits.getByRole("button", { name: "0" }));
    fireEvent.click(digits.getByRole("button", { name: "1" }));
    fireEvent.click(digits.getByRole("button", { name: "2" }));
    fireEvent.click(digits.getByRole("button", { name: "3" }));
    fireEvent.submit(document.getElementById("celda-form")!);
    await vi.waitFor(() =>
      expect(post.mock.calls.some((call) => call[0] === `/firms/${FIRM}/tax-calendars/${CAL_DRAFT}/entries`)).toBe(true),
    );
    const payload = post.mock.calls.find((call) => call[0] === `/firms/${FIRM}/tax-calendars/${CAL_DRAFT}/entries`)?.[1];
    expect(payload).toMatchObject({
      conceptLabel: "Concepto sintético",
      groupingKind: "ENDING_DIGITS",
      endingDigits: "0123",
      dueDate: "2026-02-27",
    });
  });

  it("editar abre la celda con sus datos y guarda con PATCH", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_DRAFT));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    fireEvent.click(await screen.findByRole("button", { name: `Editar ${IB}, vence 2026-02-18` }));
    const dialog = await screen.findByRole("dialog", { name: "Editar celda" });
    expect((within(dialog).getByLabelText("Concepto (como figura en el PDF)") as HTMLInputElement).value).toBe(IB);
    fireEvent.change(within(dialog).getByLabelText("Rótulo del período de referencia"), {
      target: { value: "Anticipo Ene-26 corregido" },
    });
    fireEvent.submit(document.getElementById("celda-form")!);
    await vi.waitFor(() => expect(patch.mock.calls.length).toBe(1));
    expect(patch.mock.calls[0]?.[0]).toBe(`/firms/${FIRM}/tax-calendars/${CAL_DRAFT}/entries/${ENTRY_IB}`);
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ referenceLabel: "Anticipo Ene-26 corregido", endingDigits: "01" });
  });

  it("quitar pide confirmación y llama a la baja de celda; no se ofrece en un calendario publicado", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_DRAFT));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    fireEvent.click(await screen.findByRole("button", { name: `Quitar ${IB}, vence 2026-02-18` }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/El calendario sigue en borrador/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Quitar celda" }));
    await vi.waitFor(() => expect(del.mock.calls.length).toBe(1));
    expect(del.mock.calls[0]?.[0]).toBe(`/firms/${FIRM}/tax-calendars/${CAL_DRAFT}/entries/${ENTRY_IB}`);
    expect(await screen.findByText("Celda quitada. La validación se recalcula.")).toBeTruthy();

    cleanup();
    renderAt(ficha(CAL_PUB));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    await screen.findByRole("table", { name: "Celdas del calendario" });
    expect(screen.queryByRole("button", { name: /^Quitar / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agregar celda" })).toBeNull();
    expect(screen.getByText(/Publicado: las celdas no se editan/)).toBeTruthy();
  });
});

describe("permisos y estados", () => {
  it("solo lectura: sin acciones de edición y con el motivo a la vista", async () => {
    setCapabilities(CAP_READ);
    renderAt(listUrl);
    await screen.findByRole("table", { name: "Calendarios fiscales" });
    expect(screen.queryByRole("button", { name: "Nuevo calendario" })).toBeNull();
    expect(screen.getByText(/Tu rol consulta los calendarios/)).toBeTruthy();
    cleanup();

    renderAt(ficha(CAL_DRAFT));
    await screen.findByRole("tablist", { name: "Secciones del calendario" });
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^Celdas/ }));
    expect(screen.queryByRole("button", { name: "Agregar celda" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Editar / })).toBeNull();
    expect(screen.getByText(/Solo lectura: tu rol consulta las celdas/)).toBeTruthy();
  });

  it("con manage pero sin publish, edita y no ofrece publicar", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_DRAFT));
    await screen.findByRole("tablist", { name: "Secciones del calendario" });
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
    expect(screen.getByText("Publicar lo hacen el Titular y el Administrador.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^Celdas/ }));
    expect(screen.getByRole("button", { name: "Agregar celda" })).toBeTruthy();
  });

  it("como máximo una acción primaria visible en la ficha", async () => {
    setCapabilities(CAP_PUBLISH);
    validationOverride[CAL_DRAFT] = { calendarId: CAL_DRAFT, status: "DRAFT", entries: 4, canPublish: true, problems: [] };
    renderAt(ficha(CAL_DRAFT));
    const publish = await screen.findByRole("button", { name: "Publicar" });
    await vi.waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelectorAll(".ds-button--primary").length).toBe(1);
  });
});

describe("pulido de Calendarios fiscales (Foco 2.7c)", () => {
  it("el subtítulo usa el voseo del resto de la aplicación", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(listUrl);
    expect(
      await screen.findByText("Cargá, revisá y publicá los vencimientos de cada organismo y jurisdicción."),
    ).toBeTruthy();
  });

  it("el grupo de estado muestra el elegido y «Todos» vuelve a la lista completa", async () => {
    setCapabilities(CAP_READ);
    renderAt(`${listUrl}?estado=publicado`);
    await screen.findByRole("table", { name: "Calendarios fiscales" });
    expect(screen.getByRole("button", { name: "Publicado" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(lastSearch).not.toContain("estado=");
  });

  it("sin estado elegido, «Todos» aparece pulsado", async () => {
    setCapabilities(CAP_READ);
    renderAt(listUrl);
    await screen.findByRole("table", { name: "Calendarios fiscales" });
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("«Crear calendario» queda deshabilitado con el motivo al lado hasta completar los campos", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(listUrl);
    fireEvent.click((await screen.findAllByRole("button", { name: "Nuevo calendario" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo calendario" });
    const crear = within(dialog).getByRole("button", { name: "Crear calendario" }) as HTMLButtonElement;
    expect(crear.disabled).toBe(true);
    expect(within(dialog).getByRole("note").textContent).toBe("Completá organismo, jurisdicción, año y título.");
    fireEvent.change(within(dialog).getByLabelText("Organismo"), { target: { value: AUTH } });
    fireEvent.change(within(dialog).getByLabelText("Jurisdicción"), { target: { value: JUR } });
    fireEvent.change(within(dialog).getByLabelText("Año"), { target: { value: "1999" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Calendario sintético 2026" } });
    expect(within(dialog).getByRole("note").textContent).toBe("Revisá el año.");
    fireEvent.change(within(dialog).getByLabelText("Año"), { target: { value: "2026" } });
    expect(crear.disabled).toBe(false);
    expect(within(dialog).queryByRole("note")).toBeNull();
  });

  it("con dos problemas el motivo va en plural y la barra ofrece «Ir al primer problema»", async () => {
    setCapabilities(CAP_PUBLISH);
    validationOverride[CAL_DRAFT] = {
      calendarId: CAL_DRAFT,
      status: "DRAFT",
      entries: 4,
      canPublish: false,
      problems: [
        ...DRAFT_PROBLEMS,
        { field: "entries[0].endingDigits", message: "Falta la terminación 0 de IVA", severity: "ERROR" },
      ],
    };
    renderAt(ficha(CAL_DRAFT));
    expect(await screen.findByText("No se puede publicar: faltan 2 problemas por resolver")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Ir al primer problema" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Ir a la celda" })).toHaveLength(2);
  });

  it("Año tiene ancho corto y la lista de problemas no lleva viñeta (estilos con tokens)", () => {
    const estilos = readStudyStyles();
    expect(estilos).toMatch(/\.study-form \.calendario-anio\s*\{[^}]*max-width:\s*calc\(var\(--ds-control-height-md\) \* 2\);/);
    expect(estilos).toMatch(/\.calendario-problemas\s*\{[^}]*list-style:\s*none;/);
  });
});
