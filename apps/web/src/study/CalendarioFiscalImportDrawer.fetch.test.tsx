// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyCalendariosFiscales } from "./StudyCalendariosFiscales";

/*
 * Pruebas en la capa de fetch: corre el cliente api real y la API responde con { data } o
 * { error }, como en producción. Un mock con el cuerpo ya desenvuelto ocultaría si el cajón
 * lee bien el informe (lección del corte 4b).
 */

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

const FIRM = "firm-a";
const AUTH = "a0000000-0000-4000-8000-000000000001";
const JUR = "b0000000-0000-4000-8000-000000000001";
const CAL_DRAFT = "c0000000-0000-4000-8000-000000000001";
const RUTA = `/firms/${FIRM}/tax-calendars/${CAL_DRAFT}`;
const RUTA_IMPORT = `${RUTA}/entries/import`;
const NOMBRE_CAJON = "Importar celdas desde un archivo";
const CSV =
  "concepto,periodo_referencia,criterio_agrupacion,digitos,fecha_completa\nIVA,2026-01,todos,,2026-02-18\n";

const INFORME = {
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

const CUOTA = (cuota: number) =>
  `El período «cuota ${cuota}/2026» es texto libre: se importa solo con ese texto, sin fechas de referencia`;

// Informe con avisos repetidos (cuotas 98 a 103), una dudosa y una fila con dos motivos.
const INFORME_AGRUPADO = {
  dryRun: true,
  totalFilas: 110,
  validas: 109,
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
      motivo: "Dígitos «(inferido)» no reconocidos",
      valorRecibido: "(inferido)",
    },
  ],
  avisos: [
    {
      fila: 2,
      motivo:
        "Queda marcada como dudosa (verificado_en_imagen distinto de «si»). Revisala en la grilla antes de publicar.",
    },
    ...[98, 99, 100, 101, 102, 103].map((fila, indice) => ({
      fila,
      motivo: CUOTA(indice + 1),
    })),
  ],
  columnasIgnoradas: [],
  encabezadosFaltantes: [],
};

type Llamada = { metodo: string; ruta: string; cuerpo: unknown };
const llamadas: Llamada[] = [];
let respuestasImportacion: Array<{ status: number; body: unknown }> = [];
let entradasDetalle: unknown[] = [];

function respuesta(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function calendarioDetalle() {
  return {
    id: CAL_DRAFT,
    firmId: FIRM,
    taxAuthorityId: AUTH,
    jurisdictionId: JUR,
    year: 2026,
    title: "Calendario sintético 2026",
    version: 1,
    status: "DRAFT",
    sourceId: null,
    supersedesId: null,
    createdByUserId: "u-owner",
    publishedByUserId: null,
    publishedAt: null,
    hiddenByUserId: null,
    hiddenAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    taxAuthority: { id: AUTH, code: "AUT-SYN", name: "Organismo sintético" },
    jurisdiction: { id: JUR, code: "JUR-SYN", name: "Jurisdicción sintética" },
    entries: entradasDetalle,
  };
}

function datosGet(ruta: string): unknown {
  if (ruta === RUTA) return calendarioDetalle();
  if (ruta === `${RUTA}/validation`) {
    return { calendarId: CAL_DRAFT, status: "DRAFT", entries: 0, canPublish: false, problems: [] };
  }
  if (ruta.startsWith(`/firms/${FIRM}/tax-calendars`)) {
    const { entries, ...resto } = calendarioDetalle();
    return [{ ...resto, _count: { entries: entries.length } }];
  }
  if (ruta === "/tax/authorities") {
    return [{ id: AUTH, code: "AUT-SYN", name: "Organismo sintético", jurisdictionId: JUR }];
  }
  if (ruta === "/tax/jurisdictions") {
    return [
      {
        id: JUR,
        code: "JUR-SYN",
        name: "Jurisdicción sintética",
        kind: "NATIONAL",
        isActive: true,
      },
    ];
  }
  return [];
}

beforeEach(() => {
  contextMock.current = {
    firmId: FIRM,
    capabilities: new Set(["tax.calendars.read", "tax.calendars.manage"]),
  } as unknown as ClientContextValue;
  llamadas.length = 0;
  respuestasImportacion = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      const ruta = url.replace(/^\/api\/v1/, "");
      const cuerpo = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      llamadas.push({ metodo, ruta, cuerpo });
      if (metodo === "GET") return respuesta(200, { data: datosGet(ruta) });
      if (ruta === RUTA_IMPORT) {
        const siguiente = respuestasImportacion.shift() ?? {
          status: 500,
          body: { error: { code: "INTERNAL_ERROR", message: "Sin respuesta preparada" } },
        };
        return respuesta(siguiente.status, siguiente.body);
      }
      return respuesta(404, {
        error: { code: "NOT_FOUND", message: "No encontramos el recurso solicitado" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function abrirCajonConArchivo() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/calendarios-fiscales?calendario=${CAL_DRAFT}`]}>
          <StudyCalendariosFiscales />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
  fireEvent.click(await screen.findByRole("button", { name: NOMBRE_CAJON }));
  const dialog = await screen.findByRole("dialog", { name: NOMBRE_CAJON });
  fireEvent.change(within(dialog).getByLabelText("Archivo CSV"), {
    target: { files: [new File([CSV], "nacional.csv", { type: "text/csv" })] },
  });
  await waitFor(() =>
    expect(
      (within(dialog).getByRole("button", { name: "Probar sin guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  return dialog;
}

describe("cajón contra el cliente api real (capa de fetch)", () => {
  it("probar sin guardar envía dryRun true y lee el informe desde data", async () => {
    respuestasImportacion = [{ status: 200, body: { data: INFORME } }];
    const dialog = await abrirCajonConArchivo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const informe = await within(dialog).findByRole("status", { name: "Informe de la prueba" });
    expect(
      within(informe).getByText(
        "1 celda quedará marcada «Dudosa»: hay que revisarla antes de publicar el calendario.",
      ),
    ).toBeTruthy();
    // vigente: cambia con hallazgo 65 (antes: /^Fila 4 \(fecha_completa\)/)
    expect(within(informe).getByText("Fila 4")).toBeTruthy();
    const importar = within(dialog).getByRole("button", {
      name: "Importar 2 celdas",
    }) as HTMLButtonElement;
    expect(importar.disabled).toBe(false);
    expect(llamadas.find((llamada) => llamada.ruta === RUTA_IMPORT)).toEqual({
      metodo: "POST",
      ruta: RUTA_IMPORT,
      cuerpo: { csv: CSV, dryRun: true },
    });
  });

  it("importar real envía dryRun false, avisa con el resumen y refresca la ficha", async () => {
    respuestasImportacion = [
      { status: 200, body: { data: INFORME } },
      { status: 200, body: { data: { ...INFORME, dryRun: false, importadas: 2 } } },
    ];
    const dialog = await abrirCajonConArchivo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    await within(dialog).findByRole("status", { name: "Informe de la prueba" });
    const detalleAntes = llamadas.filter(
      (llamada) => llamada.ruta === RUTA && llamada.metodo === "GET",
    ).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Importar 2 celdas" }));
    expect(
      await screen.findByText(
        "Se importaron 2 celdas; 1 queda dudosa: hay que revisarla antes de publicar el calendario.",
      ),
    ).toBeTruthy();
    expect(
      llamadas.filter((llamada) => llamada.ruta === RUTA_IMPORT).map((llamada) => llamada.cuerpo),
    ).toEqual([
      { csv: CSV, dryRun: true },
      { csv: CSV, dryRun: false },
    ]);
    await waitFor(() =>
      expect(
        llamadas.filter((llamada) => llamada.ruta === RUTA && llamada.metodo === "GET").length,
      ).toBeGreaterThan(detalleAntes),
    );
  });

  it("un 422 de columnas muestra el mensaje del cuerpo de error junto al archivo", async () => {
    const mensaje =
      "Faltan columnas obligatorias en el encabezado: concepto. Revisá la primera fila del archivo.";
    respuestasImportacion = [
      {
        status: 422,
        body: {
          error: {
            code: "CALENDAR_VALIDATION_FAILED",
            message: mensaje,
            details: { path: ["csv"] },
          },
        },
      },
    ];
    const dialog = await abrirCajonConArchivo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const alerta = await within(dialog).findByRole("alert");
    expect(within(alerta).getByText(mensaje)).toBeTruthy();
    expect(within(alerta).getByRole("button", { name: "Elegir otro archivo" })).toBeTruthy();
  });

  it("un 5xx ofrece Reintentar y el reintento envía la misma prueba", async () => {
    respuestasImportacion = [
      {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "Ocurrió un error interno" } },
      },
      { status: 200, body: { data: INFORME } },
    ];
    const dialog = await abrirCajonConArchivo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const alerta = await within(dialog).findByRole("alert");
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));
    expect(
      await within(dialog).findByRole("status", { name: "Informe de la prueba" }),
    ).toBeTruthy();
    expect(
      llamadas.filter((llamada) => llamada.ruta === RUTA_IMPORT).map((llamada) => llamada.cuerpo),
    ).toEqual([
      { csv: CSV, dryRun: true },
      { csv: CSV, dryRun: true },
    ]);
  });

  it("informe agrupado: avisos repetidos con su rango y rechazos por fila con sus motivos (hallazgos 64 y 65)", async () => {
    respuestasImportacion = [{ status: 200, body: { data: INFORME_AGRUPADO } }];
    const dialog = await abrirCajonConArchivo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar sin guardar" }));
    const informe = await within(dialog).findByRole("status", { name: "Informe de la prueba" });
    expect(
      within(informe).getByText(
        "Filas 98 a 103 (6): el período «cuota N/2026» es texto libre: se importa solo con ese texto, sin fechas de referencia",
      ),
    ).toBeTruthy();
    expect(
      within(informe).getByText(
        "Fila 98: El período «cuota 1/2026» es texto libre: se importa solo con ese texto, sin fechas de referencia",
      ),
    ).toBeTruthy();
    expect(
      within(informe).getByText("Fila 2: queda marcada como dudosa (no verificada en imagen)"),
    ).toBeTruthy();
    expect(within(informe).getByText("Fila 4")).toBeTruthy();
    expect(
      within(informe).getByText("La fecha es obligatoria (AAAA-MM-DD) · columna fecha_completa"),
    ).toBeTruthy();
    expect(
      within(informe).getByText("Dígitos «(inferido)» no reconocidos · columna digitos"),
    ).toBeTruthy();
    expect(within(informe).queryByRole("region")).toBeNull();
  });
});

function celdaDetalle(
  id: string,
  conceptLabel: string,
  reviewState: "PROPOSED" | "REVIEWED" | "FLAGGED",
) {
  return {
    id,
    conceptLabel,
    taxTypeId: null,
    regimeId: null,
    groupingKind: "ALL",
    endingDigits: null,
    zoneCode: null,
    referencePeriodStart: null,
    referencePeriodEnd: null,
    referenceLabel: null,
    dueDate: "2026-02-18T00:00:00.000Z",
    dueDateRaw: null,
    adjustment: "NONE",
    noteRef: null,
    noteText: null,
    reviewState,
    sortOrder: 0,
  };
}

function renderizarFicha() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/calendarios-fiscales?calendario=${CAL_DRAFT}`]}>
          <StudyCalendariosFiscales />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("pestaña Celdas contra el cliente api real (capa de fetch)", () => {
  beforeEach(() => {
    entradasDetalle = [
      celdaDetalle("c-1", "IVA", "FLAGGED"),
      celdaDetalle("c-2", "IVA", "REVIEWED"),
      celdaDetalle("c-3", "Ingresos brutos", "PROPOSED"),
    ];
  });

  it("«Solo dudosas» filtra con aria-pressed, cuenta las dudosas y dice cuántas filas quedan", async () => {
    renderizarFicha();
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    const tabla = await screen.findByRole("table", { name: "Celdas del calendario" });
    expect(within(tabla).getAllByRole("button", { name: /^Editar / })).toHaveLength(3);
    expect(within(tabla).getAllByText("Dudosa")).toHaveLength(1);
    expect(screen.getByText("3 celdas · 1 dudosa")).toBeTruthy();
    const filtro = screen.getByRole("button", { name: "Solo dudosas" });
    expect(filtro.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(filtro);
    expect(filtro.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 de 3 celdas")).toBeTruthy();
    const editar = within(tabla).getAllByRole("button", { name: /^Editar / });
    expect(editar).toHaveLength(1);
    expect(editar[0]?.getAttribute("aria-label")).toMatch(/^Editar IVA, vence /);
  });

  it("sin celdas dudosas, el filtro lo dice y ofrece quitarlo", async () => {
    entradasDetalle = [celdaDetalle("c-2", "IVA", "REVIEWED")];
    renderizarFicha();
    fireEvent.click(await screen.findByRole("tab", { name: /^Celdas/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Solo dudosas" }));
    expect(await screen.findByText("No hay celdas dudosas")).toBeTruthy();
    expect(
      screen.getByText("Quitá el filtro «Solo dudosas» para ver todas las celdas."),
    ).toBeTruthy();
  });
});

describe("encabezado del cajón (hallazgo 83)", () => {
  it("nombra el calendario de destino: organismo, jurisdicción y año", async () => {
    await abrirCajonConArchivo();
    const dialog = await screen.findByRole("dialog", { name: NOMBRE_CAJON });
    expect(
      within(dialog).getByText(
        "Calendario de destino: Organismo sintético · Jurisdicción sintética · 2026",
      ),
    ).toBeTruthy();
  });
});
