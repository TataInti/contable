// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TaxCalendarEntriesImportReport } from "@contable/contracts";
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

/* Datos sintéticos. El cajón se prueba con la API mockeada en su frontera (api.get / api.post). */

const FIRM = "firm-a";
const AUTH = "a0000000-0000-4000-8000-000000000001";
const JUR = "b0000000-0000-4000-8000-000000000001";
const CAL_DRAFT = "c0000000-0000-4000-8000-000000000001";
const CAL_PUB = "c0000000-0000-4000-8000-000000000002";
const RUTA_DETALLE = `/firms/${FIRM}/tax-calendars/${CAL_DRAFT}`;
const RUTA_IMPORT = `${RUTA_DETALLE}/entries/import`;
const NOMBRE_CAJON = "Importar celdas desde un archivo";

const CAP_READ = new Set(["tax.calendars.read"]);
const CAP_MANAGE = new Set(["tax.calendars.read", "tax.calendars.manage"]);

const CSV_BUENO =
  "calendario,bloque,concepto,periodo_referencia,criterio_agrupacion,digitos,fecha_completa,nota,origen_celda,confianza,verificado_en_imagen\n" +
  "Nación,IVA,IVA,2026-01,terminacion de CUIT,0-3,2026-02-18,,PDF,alta,si\n";

const INFORME_PRUEBA: TaxCalendarEntriesImportReport = {
  dryRun: true,
  totalFilas: 4,
  validas: 2,
  importadas: 0,
  rechazadas: [
    {
      fila: 4,
      columna: "fecha_completa",
      motivo: "La fecha es obligatoria (AAAA-MM-DD)",
      valorRecibido: null,
    },
    {
      fila: 4,
      columna: "digitos",
      motivo: "Faltan los dígitos: usá un rango (0-3)",
      valorRecibido: null,
    },
  ],
  avisos: [
    {
      fila: 2,
      motivo:
        "Queda marcada como dudosa (verificado_en_imagen distinto de «si»). Revisala en la grilla antes de publicar.",
    },
  ],
  columnasIgnoradas: [],
  encabezadosFaltantes: [],
};

function calendario(id: string, status: "DRAFT" | "PUBLISHED") {
  return {
    id,
    firmId: FIRM,
    taxAuthorityId: AUTH,
    jurisdictionId: JUR,
    year: 2026,
    title: "Calendario sintético 2026",
    version: 1,
    status,
    sourceId: null,
    supersedesId: null,
    createdByUserId: "u-owner",
    publishedByUserId: status === "PUBLISHED" ? "u-owner" : null,
    publishedAt: status === "PUBLISHED" ? "2026-11-10T12:00:00.000Z" : null,
    hiddenByUserId: null,
    hiddenAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    taxAuthority: { id: AUTH, code: "AUT-SYN", name: "Organismo sintético" },
    jurisdiction: { id: JUR, code: "JUR-SYN", name: "Jurisdicción sintética" },
    entries: [],
  };
}

function respond(path: string): Promise<unknown> {
  if (path === "/tax/authorities") {
    return Promise.resolve([
      { id: AUTH, code: "AUT-SYN", name: "Organismo sintético", jurisdictionId: JUR },
    ]);
  }
  if (path === "/tax/jurisdictions") {
    return Promise.resolve([
      {
        id: JUR,
        code: "JUR-SYN",
        name: "Jurisdicción sintética",
        kind: "NATIONAL",
        isActive: true,
      },
    ]);
  }
  if (path === "/tax/types" || path === "/tax/regimes") return Promise.resolve([]);
  if (path === `/firms/${FIRM}/tax-calendars` || path.startsWith(`/firms/${FIRM}/tax-calendars?`)) {
    return Promise.resolve(
      [calendario(CAL_DRAFT, "DRAFT"), calendario(CAL_PUB, "PUBLISHED")].map(
        ({ entries, ...resto }) => ({
          ...resto,
          _count: { entries: entries.length },
        }),
      ),
    );
  }
  if (path.endsWith("/validation")) {
    const id = path.split("/")[4] ?? CAL_DRAFT;
    return Promise.resolve({
      calendarId: id,
      status: "DRAFT",
      entries: 0,
      canPublish: false,
      problems: [],
    });
  }
  if (path === RUTA_DETALLE) return Promise.resolve(calendario(CAL_DRAFT, "DRAFT"));
  if (path === `/firms/${FIRM}/tax-calendars/${CAL_PUB}`)
    return Promise.resolve(calendario(CAL_PUB, "PUBLISHED"));
  return Promise.reject(new ApiError("NOT_FOUND", "No encontramos el recurso solicitado", 404));
}

const get = api.get as unknown as Mock;
const post = api.post as unknown as Mock;

function setCapabilities(capabilities: Set<string>) {
  contextMock.current = { firmId: FIRM, capabilities } as unknown as ClientContextValue;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <StudyCalendariosFiscales />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const ficha = (id: string) => `/calendarios-fiscales?calendario=${id}`;

function archivoCsv(texto = CSV_BUENO, nombre = "nacional.csv") {
  return new File([texto], nombre, { type: "text/csv" });
}

/** Abre la ficha del borrador, va a Celdas y abre el cajón. */
async function abrirCajon(caps: Set<string> = CAP_MANAGE) {
  setCapabilities(caps);
  renderAt(ficha(CAL_DRAFT));
  fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
  fireEvent.click(await screen.findByRole("button", { name: NOMBRE_CAJON }));
  return screen.findByRole("dialog", { name: NOMBRE_CAJON });
}

function elegir(dialog: HTMLElement, archivo: File) {
  fireEvent.change(within(dialog).getByLabelText("Archivo CSV"), { target: { files: [archivo] } });
}

async function esperarProbar(dialog: HTMLElement) {
  await waitFor(() =>
    expect(
      (within(dialog).getByRole("button", { name: "Probar sin guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}

/** jsdom no implementa scrollIntoView: se registra a qué elemento se le pide llevar a la vista. */
function espiarScrollIntoView(): Element[] {
  const llamadas: Element[] = [];
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element) {
      llamadas.push(this);
    },
  });
  return llamadas;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => respond(path));
  post.mockImplementation(() => Promise.reject(new Error("POST no esperado en esta prueba")));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("botón «Importar celdas desde un archivo» en la ficha", () => {
  it("aparece en un borrador para quien gestiona calendarios, con su nombre accesible", async () => {
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_DRAFT));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    const boton = await screen.findByRole("button", { name: NOMBRE_CAJON });
    expect(boton.className).toContain("ds-button--secondary");
  });

  it("no aparece en solo lectura ni en un calendario publicado", async () => {
    setCapabilities(CAP_READ);
    renderAt(ficha(CAL_DRAFT));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    await screen.findByText("Todavía no hay celdas");
    expect(screen.queryByRole("button", { name: NOMBRE_CAJON })).toBeNull();
    cleanup();
    setCapabilities(CAP_MANAGE);
    renderAt(ficha(CAL_PUB));
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    await screen.findByText(/Publicado: las celdas no se editan/);
    expect(screen.queryByRole("button", { name: NOMBRE_CAJON })).toBeNull();
  });
});

describe("cajón «Importar celdas desde un archivo»", () => {
  it("explica el formato con las columnas del contrato y deja «Importar» con su motivo", async () => {
    const dialog = await abrirCajon();
    expect(
      within(dialog).getByText(
        "Columnas obligatorias: concepto, criterio_agrupacion, digitos, fecha_completa, periodo_referencia.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Topes: hasta 1 MB y 2.000 filas de datos por archivo."),
    ).toBeTruthy();
    const importar = within(dialog).getByRole("button", {
      name: "Importar celdas",
    }) as HTMLButtonElement;
    expect(importar.disabled).toBe(true);
    expect(within(dialog).getByText("Elegí un archivo para importarlo.")).toBeTruthy();
  });

  it("elegir un archivo muestra su nombre y tamaño y habilita «Probar sin guardar»", async () => {
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    expect(await within(dialog).findByText("nacional.csv · 1 KB")).toBeTruthy();
    await esperarProbar(dialog);
  });

  it("«Probar sin guardar» envía dryRun true y muestra el informe con filas, dudosas y rechazos", async () => {
    post.mockResolvedValueOnce(INFORME_PRUEBA);
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const informe = await within(dialog).findByRole("status");
    expect(within(informe).getByText("Informe de la prueba")).toBeTruthy();
    expect(
      within(informe).getByText(
        "1 celda quedará marcada «Dudosa»: hay que revisarla antes de publicar el calendario.",
      ),
    ).toBeTruthy();
    expect(
      within(informe).getByText(/^Fila 4 \(fecha_completa\): La fecha es obligatoria/),
    ).toBeTruthy();
    expect(within(informe).getByText(/^Fila 2: Queda marcada como dudosa/)).toBeTruthy();
    expect(post).toHaveBeenCalledWith(RUTA_IMPORT, { csv: CSV_BUENO, dryRun: true });
    const importar = within(dialog).getByRole("button", {
      name: "Importar 2 celdas",
    }) as HTMLButtonElement;
    expect(importar.disabled).toBe(false);
  });

  it("tras una prueba correcta, el informe va a la vista y su título recibe el foco", async () => {
    const llamadasAScroll = espiarScrollIntoView();
    post.mockResolvedValueOnce(INFORME_PRUEBA);
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const informe = await within(dialog).findByRole("status");
    const titulo = within(informe).getByRole("heading", { name: "Informe de la prueba" });
    await waitFor(() => expect(document.activeElement).toBe(titulo));
    expect(llamadasAScroll).toContain(informe);
  });

  it("si la prueba falla, el cajón no mueve el foco: no llama a focus()", async () => {
    post.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "Ocurrió un error interno", 500));
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    const probar = within(dialog).getByRole("button", { name: "Probar sin guardar" });
    probar.focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    fireEvent.click(probar);
    await within(dialog).findByRole("alert");
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it("las listas largas del informe son regiones desplazables con nombre accesible", async () => {
    post.mockResolvedValueOnce(INFORME_PRUEBA);
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const informe = await within(dialog).findByRole("status");
    for (const nombre of ["Filas rechazadas", "Avisos"]) {
      const region = within(informe).getByRole("region", { name: nombre });
      expect(region.tabIndex).toBe(0);
      expect(within(region).getByRole("list")).toBeTruthy();
    }
  });

  it("«Importar N celdas» envía dryRun false, refresca la ficha, avisa y cierra el cajón", async () => {
    post.mockResolvedValueOnce(INFORME_PRUEBA);
    post.mockResolvedValueOnce({ ...INFORME_PRUEBA, dryRun: false, importadas: 2 });
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    await within(dialog).findByRole("status");
    const lecturasAntes = get.mock.calls.filter((call) => call[0] === RUTA_DETALLE).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Importar 2 celdas" }));
    expect(
      await screen.findByText(
        "Se importaron 2 celdas; 1 queda dudosa: hay que revisarla antes de publicar el calendario.",
      ),
    ).toBeTruthy();
    expect(post).toHaveBeenLastCalledWith(RUTA_IMPORT, { csv: CSV_BUENO, dryRun: false });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: NOMBRE_CAJON })).toBeNull());
    await waitFor(() =>
      expect(get.mock.calls.filter((call) => call[0] === RUTA_DETALLE).length).toBeGreaterThan(
        lecturasAntes,
      ),
    );
  });

  it("un archivo de más de 1 MB se avisa al elegirlo y no se envía", async () => {
    const dialog = await abrirCajon();
    elegir(dialog, new File([new Uint8Array(1024 * 1024 + 1)], "grande.csv", { type: "text/csv" }));
    expect(
      await within(dialog).findByText(
        "El archivo supera el máximo de 1 MB (pesa 1025 KB). Dividilo en archivos más chicos.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Probar sin guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(dialog).getByText("Elegí otro archivo para probarlo.")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("un archivo vacío se avisa al leerlo y no se envía", async () => {
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv("   \n", "vacio.csv"));
    expect(
      await within(dialog).findByText(
        "El archivo está vacío. Subí un CSV con el encabezado y al menos una fila.",
      ),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("columnas faltantes: el 422 nombra las columnas y se ofrece «Elegir otro archivo»", async () => {
    const mensaje =
      "Faltan columnas obligatorias en el encabezado: fecha_completa. Revisá la primera fila del archivo.";
    post.mockRejectedValueOnce(new ApiError("CALENDAR_VALIDATION_FAILED", mensaje, 422));
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const alerta = await within(dialog).findByRole("alert");
    expect(within(alerta).getByText(mensaje)).toBeTruthy();
    expect(within(alerta).getByRole("button", { name: "Elegir otro archivo" })).toBeTruthy();
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(within(dialog).getByText("Elegí otro archivo para importarlo.")).toBeTruthy();
  });

  it("5xx: «Reintentar» vuelve a probar el mismo archivo", async () => {
    post.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "Ocurrió un error interno", 500));
    post.mockResolvedValueOnce(INFORME_PRUEBA);
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const alerta = await within(dialog).findByRole("alert");
    expect(within(alerta).getByText("Ocurrió un error interno")).toBeTruthy();
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));
    expect(await within(dialog).findByRole("status")).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]).toEqual([RUTA_IMPORT, { csv: CSV_BUENO, dryRun: true }]);
  });

  it("409: el calendario ya no está en borrador; el cajón lo dice y se vuelve a la ficha", async () => {
    post.mockRejectedValueOnce(
      new ApiError(
        "CALENDAR_NOT_DRAFT",
        "El calendario ya no está en borrador: se publicó otra versión.",
        409,
      ),
    );
    const dialog = await abrirCajon();
    elegir(dialog, archivoCsv());
    await esperarProbar(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const alerta = await within(dialog).findByRole("alert");
    expect(
      within(alerta).getByText("El calendario ya no está en borrador: se publicó otra versión."),
    ).toBeTruthy();
    expect(dialog.querySelector("#importar-probar-motivo")?.textContent).toBe(
      "El calendario ya no está en borrador.",
    );
    fireEvent.click(within(alerta).getByRole("button", { name: "Volver a la ficha" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: NOMBRE_CAJON })).toBeNull());
  });
});
