import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ArchivoCsvInvalidoError,
  claveDeCelda,
  leerCsvCalendario,
  mapearFila,
  mapearImportacion,
  parsearRegistrosCsv,
  type FilaCsv,
} from "./tax-calendar-csv.js";

/**
 * Lector y mapeo del CSV de calendarios (corte 2b-1), con datos en memoria. Los extractos de
 * __fixtures__ son filas reales de los tres CSV verificados. La prueba de humo con los archivos
 * completos se omite sola cuando no existe la carpeta del brief (no corre en CI).
 */

const CARPETA_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const CARPETA_CSV_REALES = "/root/.hermes/workspace/contable/calendarios";
const ENCABEZADO =
  "calendario,bloque,concepto,periodo_referencia,criterio_agrupacion,digitos,fecha_completa,nota,origen_celda,confianza,verificado_en_imagen";

/** Una fila del formato de 11 columnas con valores por defecto válidos; `pisa` cambia campos. */
function filaCsv(pisa: Partial<Record<string, string>> = {}): string {
  const valores: Record<string, string> = {
    calendario: "nacional-2026",
    bloque: "AUTÓNOMOS",
    concepto: "Autónomos (DDJJ y pago)",
    periodo_referencia: "2026-01",
    criterio_agrupacion: "terminación de CUIT",
    digitos: "0-3",
    fecha_completa: "2026-01-05",
    nota: "",
    origen_celda: "pág.1 · fila ENERO · col.1 (AUTÓNOMOS 0-3) · recorte",
    confianza: "alta",
    verificado_en_imagen: "si",
    ...pisa,
  };
  return ENCABEZADO.split(",")
    .map((columna) => valores[columna] ?? "")
    .map((valor) => (/[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor))
    .join(",");
}

/** Lee un CSV en memoria y devuelve la primera fila mapeada (o el error de archivo). */
function mapearUna(texto: string) {
  return mapearFila(leerCsvCalendario(texto).filas[0] as FilaCsv);
}

function csvCon(...filas: string[]): string {
  return [ENCABEZADO, ...filas].join("\r\n") + "\r\n";
}

/** Motivos de rechazo de una fila, como «columna: motivo», para comparar en las pruebas. */
function motivos(resultado: ReturnType<typeof mapearUna>): string[] {
  return resultado.rechazos.map((rechazo) => `${rechazo.columna ?? "fila"}: ${rechazo.motivo}`);
}

describe("lector de CSV de calendarios", () => {
  it("lee el encabezado en cualquier orden y acepta BOM, CRLF y LF", () => {
    const reordenado =
      "concepto,periodo_referencia,criterio_agrupacion,digitos,fecha_completa,verificado_en_imagen,confianza\n" +
      "IVA — DDJJ,2026-03,todos,todos,2026-04-20,si,alta\n";
    const conBom = "\uFEFF" + reordenado.replace(/\n/g, "\r\n");
    for (const texto of [reordenado, conBom]) {
      const lectura = leerCsvCalendario(texto);
      expect(lectura.filas).toHaveLength(1);
      expect(lectura.filas[0]?.valores.concepto).toBe("IVA — DDJJ");
      expect(lectura.filas[0]?.fila).toBe(2);
    }
  });

  it("respeta comas, comillas dobles y saltos de línea dentro de comillas", () => {
    const registros = parsearRegistrosCsv(
      'a,"b, con coma","c ""entre"" comillas","d\r\nsegunda línea"\r\n',
    );
    expect(registros).toEqual([["a", "b, con coma", 'c "entre" comillas', "d\r\nsegunda línea"]]);
  });

  it("no cuenta las líneas en blanco y numera las filas como la hoja (encabezado = 1)", () => {
    const texto = `${ENCABEZADO}\r\n${filaCsv()}\r\n\r\n\r\n${filaCsv({ concepto: "IVA" })}\r\n`;
    const lectura = leerCsvCalendario(texto);
    expect(lectura.filas.map((fila) => fila.fila)).toEqual([2, 5]);
  });

  it("informa las columnas desconocidas y no las usa", () => {
    const texto = `${ENCABEZADO},responsable,Ver\r\n${filaCsv()},Ana,x\r\n`;
    const lectura = leerCsvCalendario(texto);
    expect(lectura.columnasIgnoradas).toEqual(["responsable", "ver"]);
    expect(lectura.filas[0]?.valores).not.toHaveProperty("responsable");
  });

  it("rechaza el archivo vacío, sin filas de datos, sin columnas obligatorias y con columnas repetidas", () => {
    expect(() => leerCsvCalendario("  \r\n\r\n")).toThrow(ArchivoCsvInvalidoError);
    expect(() => leerCsvCalendario("  \r\n")).toThrow("El archivo está vacío");
    expect(() => leerCsvCalendario(`${ENCABEZADO}\r\n`)).toThrow("no tiene filas de datos");
    expect(() => leerCsvCalendario("concepto,digitos\r\nIVA,0-3\r\n")).toThrow(
      "Faltan columnas obligatorias en el encabezado: criterio_agrupacion, fecha_completa, periodo_referencia",
    );
    expect(() => leerCsvCalendario(`${ENCABEZADO},concepto\r\n${filaCsv()},IVA\r\n`)).toThrow(
      "La columna «concepto» aparece dos veces",
    );
  });

  it("rechaza más de 2.000 filas y más de 1 MB, sin leer las filas", () => {
    const dosMilUna = csvCon(...Array.from({ length: 2001 }, () => filaCsv()));
    expect(() => leerCsvCalendario(dosMilUna)).toThrow(
      "El archivo tiene 2001 filas y el máximo es 2.000",
    );
    const dosMil = csvCon(...Array.from({ length: 2000 }, () => filaCsv()));
    expect(leerCsvCalendario(dosMil).filas).toHaveLength(2000);
    const relleno = "x".repeat(1024 * 1024);
    expect(() => leerCsvCalendario(`${ENCABEZADO}\r\n${filaCsv({ nota: relleno })}\r\n`)).toThrow(
      "supera el máximo de 1 MB",
    );
  });

  it("rechaza una comilla sin cerrar y dice qué revisar", () => {
    expect(() => leerCsvCalendario(`${ENCABEZADO}\r\n${filaCsv()}\r\n"IVA,0-3\r\n`)).toThrow(
      "comilla sin cerrar",
    );
  });
});

describe("mapeo de una fila a una celda", () => {
  it("convierte el rango «0-3» y la lista «0-1-2-3» en terminaciones, y «todos» con terminación en 0123456789", () => {
    expect(mapearUna(csvCon(filaCsv({ digitos: "0-3" }))).celda?.entrada.endingDigits).toBe("0123");
    expect(mapearUna(csvCon(filaCsv({ digitos: "0-1-2-3" }))).celda?.entrada.endingDigits).toBe(
      "0123",
    );
    expect(mapearUna(csvCon(filaCsv({ digitos: "0123" }))).celda?.entrada.endingDigits).toBe(
      "0123",
    );
    expect(mapearUna(csvCon(filaCsv({ digitos: "3-1-2-0" }))).celda?.entrada.endingDigits).toBe(
      "0123",
    );
    expect(mapearUna(csvCon(filaCsv({ digitos: "0-9" }))).celda?.entrada.endingDigits).toBe(
      "0123456789",
    );
    expect(mapearUna(csvCon(filaCsv({ digitos: "todos" }))).celda?.entrada.endingDigits).toBe(
      "0123456789",
    );
    expect(mapearUna(csvCon(filaCsv({ digitos: "0-3" }))).celda?.entrada.groupingKind).toBe(
      "ENDING_DIGITS",
    );
  });

  it("mapea «todos» a ALL sin terminaciones y rechaza otros dígitos con esa agrupación", () => {
    const celda = mapearUna(
      csvCon(filaCsv({ criterio_agrupacion: "todos", digitos: "todos" })),
    ).celda;
    expect(celda?.entrada.groupingKind).toBe("ALL");
    expect(celda?.entrada).not.toHaveProperty("endingDigits");
    expect(
      motivos(mapearUna(csvCon(filaCsv({ criterio_agrupacion: "Todos", digitos: "0-3" })))),
    ).toEqual(["digitos: Con agrupación «todos», los dígitos van como «todos» (recibido «0-3»)"]);
  });

  it("acepta la agrupación sin tildes ni mayúsculas y rechaza una desconocida diciendo cuáles usar", () => {
    expect(
      mapearUna(csvCon(filaCsv({ criterio_agrupacion: "Terminacion de CUIT" }))).celda,
    ).not.toBeNull();
    expect(motivos(mapearUna(csvCon(filaCsv({ criterio_agrupacion: "provincia" }))))).toEqual([
      "criterio_agrupacion: No reconozco la agrupación «provincia»: usá «terminación de CUIT» o «todos»",
    ]);
  });

  it("rechaza dígitos inválidos con el motivo de cada forma: rango invertido, texto, «(inferido)» y repetidos", () => {
    expect(motivos(mapearUna(csvCon(filaCsv({ digitos: "4-2" }))))).toEqual([
      "digitos: El rango «4-2» va de menor a mayor, por ejemplo 0-3",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ digitos: "abc" }))))[0]).toMatch(
      /^digitos: No reconozco los dígitos «abc»/,
    );
    expect(motivos(mapearUna(csvCon(filaCsv({ digitos: "0-1-2-3 (inferido)" }))))[0]).toMatch(
      /^digitos: No reconozco los dígitos «0-1-2-3 \(inferido\)»/,
    );
    expect(motivos(mapearUna(csvCon(filaCsv({ digitos: "0-1-0" }))))).toEqual([
      "digitos: Hay dígitos repetidos en «0-1-0»",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ digitos: "" }))))[0]).toMatch(
      /^digitos: Faltan los dígitos/,
    );
  });

  it("rechaza una fecha vacía, imposible o con otro formato, con el motivo del brief", () => {
    expect(motivos(mapearUna(csvCon(filaCsv({ fecha_completa: "" }))))).toEqual([
      "fecha_completa: La fecha es obligatoria (AAAA-MM-DD)",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ fecha_completa: "2026-02-30" }))))).toEqual([
      "fecha_completa: La fecha no existe",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ fecha_completa: "05/01/2026" }))))).toEqual([
      "fecha_completa: La fecha debe tener el formato aaaa-mm-dd",
    ]);
    expect(
      mapearUna(csvCon(filaCsv({ fecha_completa: "2028-02-29" }))).celda?.entrada.dueDate,
    ).toBe("2028-02-29");
  });

  it("convierte un período «aaaa-mm» en inicio, fin y etiqueta del mes; el texto libre queda solo como etiqueta", () => {
    const febrero = mapearUna(csvCon(filaCsv({ periodo_referencia: "2028-02" }))).celda?.entrada;
    expect(febrero).toMatchObject({
      referencePeriodStart: "2028-02-01",
      referencePeriodEnd: "2028-02-29",
      referenceLabel: "febrero de 2028",
    });
    const semestre = mapearUna(csvCon(filaCsv({ periodo_referencia: "1° semestre" })));
    expect(semestre.celda?.entrada).toMatchObject({ referenceLabel: "1° semestre" });
    expect(semestre.celda?.entrada).not.toHaveProperty("referencePeriodStart");
    expect(semestre.celda?.avisos).toEqual([
      {
        fila: 2,
        motivo:
          "El período «1° semestre» es texto libre: se importa solo con ese texto, sin fechas de referencia",
      },
    ]);
  });

  it("rechaza un mes inexistente, un año fuera de rango y un período vacío", () => {
    expect(motivos(mapearUna(csvCon(filaCsv({ periodo_referencia: "2026-13" }))))).toEqual([
      "periodo_referencia: El mes del período no existe: va de 01 a 12",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ periodo_referencia: "1999-05" }))))).toEqual([
      "periodo_referencia: El año del período debe estar entre 2000 y 2100",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ periodo_referencia: "" }))))).toEqual([
      "periodo_referencia: Falta el período de referencia",
    ]);
  });

  it("rechaza concepto vacío o de más de 200 caracteres y nota de más de 500, con el campo y el motivo", () => {
    expect(motivos(mapearUna(csvCon(filaCsv({ concepto: "" }))))).toEqual([
      "concepto: Falta el concepto de la celda",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ concepto: "x".repeat(201) }))))).toEqual([
      "concepto: El concepto no puede superar los 200 caracteres",
    ]);
    expect(motivos(mapearUna(csvCon(filaCsv({ nota: "n".repeat(501) }))))).toEqual([
      "nota: La nota no puede superar los 500 caracteres",
    ]);
  });

  it("informa cada campo con error de la misma fila, sin repetir el mismo campo", () => {
    expect(motivos(mapearUna(csvCon(filaCsv({ digitos: "4-2", fecha_completa: "" }))))).toEqual([
      "digitos: El rango «4-2» va de menor a mayor, por ejemplo 0-3",
      "fecha_completa: La fecha es obligatoria (AAAA-MM-DD)",
    ]);
  });

  it("rechaza una fila con más valores que columnas, sin mapear sus campos", () => {
    const resultado = mapearUna(`${ENCABEZADO}\r\n${filaCsv()},extra\r\n`);
    expect(resultado.celda).toBeNull();
    expect(motivos(resultado)).toEqual([
      "fila: La fila tiene 1 valor(es) de más: revisá las comas y las comillas de esta fila",
    ]);
  });

  it("marca como dudosa (FLAGGED) toda celda con confianza distinta de «alta» o sin verificar en imagen", () => {
    const baja = mapearUna(csvCon(filaCsv({ confianza: "baja" }))).celda;
    expect(baja?.revision).toBe("FLAGGED");
    expect(baja?.avisos[0]?.motivo).toBe(
      "Queda marcada como dudosa (confianza «baja»). Revisala en la grilla antes de publicar.",
    );
    const noVerificada = mapearUna(csvCon(filaCsv({ verificado_en_imagen: "no" }))).celda;
    expect(noVerificada?.revision).toBe("FLAGGED");
    expect(noVerificada?.avisos[0]?.motivo).toContain("no verificada en imagen");
    expect(mapearUna(csvCon(filaCsv({ confianza: "" }))).celda?.revision).toBe("FLAGGED");
  });

  it("deja REVIEWED y sin avisos la celda con confianza alta y verificada («sí» cuenta como «si»)", () => {
    const celda = mapearUna(csvCon(filaCsv({ verificado_en_imagen: "sí" }))).celda;
    expect(celda?.revision).toBe("REVIEWED");
    expect(celda?.avisos).toEqual([]);
  });

  it("guarda la procedencia: página de origen, extracción con la fila y el origen de la celda", () => {
    const celda = mapearUna(
      csvCon(filaCsv({ bloque: "AUTÓNOMOS", nota: "anticipo del mes" })),
    ).celda;
    expect(celda?.paginaOrigen).toBe(1);
    expect(celda?.extraccion).toEqual({
      origen: "importación CSV",
      bloque: "AUTÓNOMOS",
      origen_celda: "pág.1 · fila ENERO · col.1 (AUTÓNOMOS 0-3) · recorte",
      confianza: "alta",
      verificado_en_imagen: "si",
      fila: 2,
    });
    expect(celda?.entrada.noteText).toBe("anticipo del mes");
    expect(
      mapearUna(csvCon(filaCsv({ origen_celda: "sin página" }))).celda?.paginaOrigen,
    ).toBeNull();
  });

  it("no vincula taxTypeId ni regimeId", () => {
    const entrada = mapearUna(csvCon(filaCsv())).celda?.entrada ?? {};
    expect(entrada).not.toHaveProperty("taxTypeId");
    expect(entrada).not.toHaveProperty("regimeId");
  });
});

describe("importación: duplicados", () => {
  it("rechaza una fila igual a una celda que ya tiene el borrador, y la segunda de dos iguales dentro del archivo", () => {
    const texto = csvCon(
      filaCsv(),
      filaCsv({ fecha_completa: "2026-01-09" }),
      filaCsv({ concepto: "IVA" }),
    );
    const existente = claveDeCelda({
      conceptLabel: "Autónomos (DDJJ y pago)",
      groupingKind: "ENDING_DIGITS",
      endingDigits: "0123",
      referencePeriodStart: "2026-01-01",
      referenceLabel: "enero de 2026",
    });
    const resultado = mapearImportacion(leerCsvCalendario(texto), new Set([existente]));
    expect(resultado.rechazadas).toEqual([
      { fila: 2, columna: null, motivo: "Ya existe en este calendario", valorRecibido: null },
      { fila: 3, columna: null, motivo: "Ya existe en este calendario", valorRecibido: null },
    ]);
    expect(resultado.celdas.map((celda) => celda.fila)).toEqual([4]);
    const sinExistentes = mapearImportacion(leerCsvCalendario(texto), new Set());
    expect(sinExistentes.rechazadas).toEqual([
      {
        fila: 3,
        columna: null,
        motivo:
          "Repetida: la fila 2 del archivo tiene el mismo concepto, período, agrupación y dígitos",
        valorRecibido: null,
      },
    ]);
    expect(sinExistentes.celdas.map((celda) => celda.fila)).toEqual([2, 4]);
  });

  it("no toma por repetida una fila inválida: la primera válida de su clave sigue importándose", () => {
    const texto = csvCon(filaCsv({ fecha_completa: "2026-02-30" }), filaCsv());
    const resultado = mapearImportacion(leerCsvCalendario(texto), new Set());
    expect(resultado.rechazadas.map((rechazo) => rechazo.motivo)).toEqual(["La fecha no existe"]);
    expect(resultado.celdas.map((celda) => celda.fila)).toEqual([3]);
  });

  it("la clave no distingue mayúsculas, tildes ni el orden de las terminaciones", () => {
    const a = claveDeCelda({
      conceptLabel: "IVA — DDJJ",
      groupingKind: "ENDING_DIGITS",
      endingDigits: "3210",
      referenceLabel: "Enero",
    });
    const b = claveDeCelda({
      conceptLabel: "iva — ddjj",
      groupingKind: "ENDING_DIGITS",
      endingDigits: "0123",
      referenceLabel: "enero",
    });
    expect(a).toBe(b);
  });
});

describe("extractos reales de los tres CSV verificados", () => {
  function leerExtracto(nombre: string) {
    return leerCsvCalendario(readFileSync(join(CARPETA_FIXTURES, nombre), "utf8"));
  }

  it("el extracto del nacional tiene 12 filas: 11 válidas, 4 dudosas y la de confianza baja rechazada por fecha vacía y dígitos", () => {
    const resultado = mapearImportacion(leerExtracto("c0a-nacional-extracto.csv"), new Set());
    expect(resultado.totalFilas).toBe(12);
    expect(resultado.celdas).toHaveLength(11);
    expect(resultado.celdas.filter((celda) => celda.revision === "FLAGGED")).toHaveLength(4);
    expect(resultado.rechazadas.map((rechazo) => `${rechazo.fila} ${rechazo.columna}`)).toEqual([
      "8 digitos",
      "8 fecha_completa",
    ]);
    expect(resultado.rechazadas[1]?.motivo).toBe("La fecha es obligatoria (AAAA-MM-DD)");
    expect(resultado.celdas.some((celda) => celda.entrada.groupingKind === "ALL")).toBe(true);
    expect(resultado.celdas.some((celda) => celda.entrada.referenceLabel === "PF 2025")).toBe(true);
  });

  it("el extracto del tucumán tiene 11 filas, todas válidas, con períodos de cuota y PF", () => {
    const resultado = mapearImportacion(leerExtracto("c0a-tucuman-extracto.csv"), new Set());
    expect(resultado.totalFilas).toBe(11);
    expect(resultado.celdas).toHaveLength(11);
    expect(resultado.rechazadas).toEqual([]);
    expect(resultado.celdas.filter((celda) => celda.revision === "FLAGGED")).toHaveLength(0);
    expect(resultado.celdas.map((celda) => celda.entrada.referenceLabel)).toContain("cuota 9/2026");
  });

  it("el extracto del municipal tiene 10 filas válidas, con semestres como texto libre y «todos»", () => {
    const resultado = mapearImportacion(leerExtracto("c0a-municipal-extracto.csv"), new Set());
    expect(resultado.totalFilas).toBe(10);
    expect(resultado.celdas).toHaveLength(10);
    expect(resultado.rechazadas).toEqual([]);
    expect(resultado.avisos.filter((aviso) => aviso.motivo.includes("texto libre"))).toHaveLength(
      3,
    );
    expect(resultado.celdas.filter((celda) => celda.entrada.groupingKind === "ALL")).toHaveLength(
      4,
    );
  });
});

describe("prueba de humo con los tres CSV completos (solo si existen en este equipo)", () => {
  it.runIf(existsSync(join(CARPETA_CSV_REALES, "c0a-nacional.csv")))(
    "lee 414 + 167 + 118 filas y rechaza 3 del nacional por fecha vacía",
    () => {
      const leer = (nombre: string) =>
        mapearImportacion(
          leerCsvCalendario(readFileSync(join(CARPETA_CSV_REALES, nombre), "utf8")),
          new Set(),
        );
      const nacional = leer("c0a-nacional.csv");
      const tucuman = leer("c0a-tucuman.csv");
      const municipal = leer("c0a-municipal.csv");
      expect(nacional.totalFilas).toBe(414);
      expect(tucuman.totalFilas).toBe(167);
      expect(municipal.totalFilas).toBe(118);
      const filasRechazadas = new Set(nacional.rechazadas.map((rechazo) => rechazo.fila));
      expect(filasRechazadas.size).toBe(3);
      expect(
        nacional.rechazadas.filter((rechazo) => rechazo.columna === "fecha_completa"),
      ).toHaveLength(3);
      expect(nacional.celdas).toHaveLength(411);
      expect(tucuman.rechazadas).toEqual([]);
      expect(municipal.rechazadas).toEqual([]);
    },
  );
});
