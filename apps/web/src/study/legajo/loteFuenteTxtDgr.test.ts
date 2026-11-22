import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { importarLoteFuente } from "./loteFuente";
import type { WorkpaperSource } from "./tipos";

// Corte 2D: los TXT de la DGR de Tucumán en el lote de una fuente. Datos sintéticos.
vi.mock("../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

const CUIT_CLIENTE = "20111111112";

function fuente(code: string, label: string): WorkpaperSource {
  return {
    code,
    label,
    required: false,
    present: false,
    status: "PENDING",
    noMovements: null,
    count: 0,
    taxTypeId: "tipo-iibb",
    periodId: "periodo-oct",
    origin: "DGR_RPI_TUC",
    adapterVersion: "ARCA_RET_V1",
    expectedColumns: [],
    batches: [],
  };
}

const FUENTE_IIBB = fuente("IIBB_RPI_TUC", "Retenciones y percepciones IIBB Tucumán");
const FUENTE_TEM = fuente("SMT_RPI_TEM", "Retenciones y percepciones TEM");
const FUENTE_LIBRO = fuente("ARCA_IVA_SALES", "ARCA IVA ventas");

function lineaPercepcion(fecha: string, numero: string): string {
  return (
    "30555555551" +
    "AGENTE DEMO SINTETICO".padEnd(50) +
    fecha +
    "11" +
    " C " +
    "0001" +
    numero.padStart(7) +
    " ".repeat(11) +
    "1500.55".padStart(7) +
    "P" +
    "11"
  );
}

function archivo(nombre: string, contenido: string): File {
  return { name: nombre, text: async () => contenido } as unknown as File;
}

const PERIODO = { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-31T00:00:00.000Z" };

function importar(
  source: WorkpaperSource,
  file: File,
  extra: { fuentes?: WorkpaperSource[]; clientCuit?: string } = {},
) {
  return importarLoteFuente({
    firmId: "firma-1",
    clientId: "cliente-1",
    source,
    file,
    workpaperId: "legajo-1",
    clientCuit: extra.clientCuit ?? CUIT_CLIENTE,
    periodo: PERIODO,
    fuentes: extra.fuentes ?? [FUENTE_IIBB, FUENTE_TEM, FUENTE_LIBRO],
  });
}

describe("importarLoteFuente con TXT de la DGR de Tucumán", () => {
  it("carga las líneas como filas del lote en la fuente de Ingresos Brutos de Tucumán", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: "lote-1", status: "UPLOADED", errorRows: 0 } as never)
      .mockResolvedValueOnce({ totals: { errorRows: 0 } } as never)
      .mockResolvedValueOnce({} as never);
    const file = archivo(
      `per${CUIT_CLIENTE}_F611_221120261015.txt`,
      `${lineaPercepcion("01/10/2026", "1")}\r\n${lineaPercepcion("02/10/2026", "2")}\r\n`,
    );

    const resultado = await importar(FUENTE_IIBB, file);

    expect(resultado.avisos).toEqual([]);
    const validar = vi.mocked(api.post).mock.calls[1]!;
    expect(validar[0]).toBe("/firms/firma-1/clients/cliente-1/import-batches/lote-1/validate");
    const filas = (validar[1] as { rows: Record<string, unknown>[] }).rows;
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ kind: "PERCEPCION", cuitResponsable: CUIT_CLIENTE, amount: "1500.55" });
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(3);
  });

  it("devuelve el aviso de las fechas fuera del período y confirma igual", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: "lote-1", status: "UPLOADED", errorRows: 0 } as never)
      .mockResolvedValueOnce({ totals: { errorRows: 0 } } as never)
      .mockResolvedValueOnce({} as never);
    const file = archivo(`per${CUIT_CLIENTE}_F611_221120261015.txt`, lineaPercepcion("30/09/2026", "1"));

    const resultado = await importar(FUENTE_IIBB, file);

    expect(resultado.avisos).toEqual([
      "1 línea tiene fecha fuera del período (01/10/2026 al 31/10/2026): línea 1. Se carga igual.",
    ]);
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(3);
  });

  it("en la fuente de TEM no lo carga y sugiere la fuente de Ingresos Brutos de Tucumán", async () => {
    const file = archivo(`ret${CUIT_CLIENTE}_F611_221120261015.txt`, lineaPercepcion("01/10/2026", "1"));
    await expect(importar(FUENTE_TEM, file)).rejects.toThrow(
      "Este archivo es de retenciones sufridas de Ingresos Brutos de Tucumán y va en la fuente «Retenciones y percepciones IIBB Tucumán», no en «Retenciones y percepciones TEM». Elegí esa fuente y volvé a importar.",
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it("en la fuente de un libro de IVA tampoco lo carga", async () => {
    const file = archivo(`reca${CUIT_CLIENTE}_F611_221120261015.txt`, "x");
    await expect(importar(FUENTE_LIBRO, file)).rejects.toThrow(
      "Este archivo es de recaudaciones bancarias de Ingresos Brutos de Tucumán y va en la fuente «Retenciones y percepciones IIBB Tucumán», no en «ARCA IVA ventas».",
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it("si el legajo no tiene la fuente correcta, dice dónde se habilita", async () => {
    const file = archivo(`per${CUIT_CLIENTE}_F611_221120261015.txt`, lineaPercepcion("01/10/2026", "1"));
    await expect(importar(FUENTE_TEM, file, { fuentes: [FUENTE_TEM] })).rejects.toThrow(
      "Este legajo no tiene la fuente de Ingresos Brutos de Tucumán: habilitá Ingresos Brutos en la Configuración fiscal del cliente.",
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it("el archivo de otro CUIT se rechaza antes de crear el lote", async () => {
    const file = archivo(`per27999999900_F611_221120261015.txt`, lineaPercepcion("01/10/2026", "1"));
    await expect(importar(FUENTE_IIBB, file)).rejects.toThrow(
      "Este archivo es del CUIT 27-99999990-0, no del cliente (CUIT 20-11111111-2).",
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it("un CSV común en cualquier fuente sigue su camino de siempre", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: "lote-2", status: "UPLOADED", errorRows: 0 } as never)
      .mockResolvedValueOnce({ totals: { errorRows: 0 } } as never)
      .mockResolvedValueOnce({} as never);
    const file = archivo("retenciones.csv", "fecha;importe\n2026-10-01;100");
    const resultado = await importar(FUENTE_TEM, file);
    expect(resultado.avisos).toEqual([]);
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(3);
  });
});
