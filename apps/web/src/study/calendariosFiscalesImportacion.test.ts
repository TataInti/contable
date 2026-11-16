// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TaxCalendarEntriesImportReport } from "@contable/contracts";
import { ApiError } from "../lib/api";
import {
  COLUMNAS_OBLIGATORIAS,
  COLUMNAS_OPCIONALES,
  celdas,
  errorDeContenido,
  errorDeImportacion,
  errorDeTamano,
  lineaDudosas,
  motivoImportar,
  motivoProbar,
  notificacionImportacion,
  resumenInforme,
  rotuloImportar,
  tamanoArchivo,
} from "./calendariosFiscalesImportacion";

/* Textos sintéticos con el prefijo de los avisos del lector de la API (corte 2b-1). */
const DUDOSA =
  "Queda marcada como dudosa (verificado_en_imagen distinto de «si»). Revisala en la grilla antes de publicar.";
const TEXTO_LIBRE =
  "El período «Anticipo» es texto libre: se importa solo con ese texto, sin fechas de referencia";

function informe(
  overrides: Partial<TaxCalendarEntriesImportReport> = {},
): TaxCalendarEntriesImportReport {
  return {
    dryRun: true,
    totalFilas: 414,
    validas: 411,
    importadas: 0,
    rechazadas: [],
    avisos: [],
    columnasIgnoradas: [],
    encabezadosFaltantes: [],
    ...overrides,
  };
}

describe("textos con concordancia de número", () => {
  it("singular y plural con el número real", () => {
    expect(celdas(1)).toBe("1 celda");
    expect(celdas(411)).toBe("411 celdas");
    expect(celdas(1000)).toBe("1.000 celdas");
    expect(rotuloImportar(null)).toBe("Importar celdas");
    expect(rotuloImportar(1)).toBe("Importar 1 celda");
    expect(rotuloImportar(411)).toBe("Importar 411 celdas");
  });

  it("la línea de dudosas concuerda y nombra «Dudosa»", () => {
    expect(lineaDudosas(0)).toBe("");
    expect(lineaDudosas(1)).toBe(
      "1 celda quedará marcada «Dudosa»: hay que revisarla antes de publicar el calendario.",
    );
    expect(lineaDudosas(297)).toBe(
      "297 celdas quedarán marcadas «Dudosa»: hay que revisarlas antes de publicar el calendario.",
    );
  });

  it("la notificación resume lo importado y lo que queda dudoso", () => {
    expect(notificacionImportacion(1, 0)).toBe("Se importó 1 celda.");
    expect(notificacionImportacion(2, 0)).toBe("Se importaron 2 celdas.");
    expect(notificacionImportacion(411, 297)).toBe(
      "Se importaron 411 celdas; 297 quedan dudosas: hay que revisarlas antes de publicar el calendario.",
    );
    expect(notificacionImportacion(2, 1)).toBe(
      "Se importaron 2 celdas; 1 queda dudosa: hay que revisarla antes de publicar el calendario.",
    );
  });
});

describe("resumen del informe", () => {
  it("cuenta filas rechazadas una sola vez y dudosas por su aviso, no por los avisos de texto libre", () => {
    const resumen = resumenInforme(
      informe({
        rechazadas: [
          {
            fila: 413,
            columna: "fecha_completa",
            motivo: "La fecha es obligatoria (AAAA-MM-DD)",
            valorRecibido: null,
          },
          {
            fila: 413,
            columna: "digitos",
            motivo: "Faltan los dígitos",
            valorRecibido: "0-1-2-3 (inferido)",
          },
          {
            fila: 414,
            columna: "fecha_completa",
            motivo: "La fecha es obligatoria (AAAA-MM-DD)",
            valorRecibido: null,
          },
        ],
        avisos: [
          { fila: 5, motivo: DUDOSA },
          { fila: 6, motivo: TEXTO_LIBRE },
          { fila: 7, motivo: DUDOSA },
        ],
      }),
    );
    expect(resumen).toEqual({ leidas: 414, aImportar: 411, filasRechazadas: 2, dudosas: 2 });
  });
});

describe("archivo: topes y contenido con los textos del lector", () => {
  it("avisa del tamaño y del contenido vacío", () => {
    expect(errorDeTamano(1024 * 1024)).toBeNull();
    expect(errorDeTamano(1024 * 1024 + 1)).toBe(
      "El archivo supera el máximo de 1 MB (pesa 1025 KB). Dividilo en archivos más chicos.",
    );
    expect(errorDeContenido(" \n ")).toBe(
      "El archivo está vacío. Subí un CSV con el encabezado y al menos una fila.",
    );
    expect(errorDeContenido("concepto,digitos")).toBeNull();
  });

  it("muestra el tamaño del archivo en KB con mínimo de 1", () => {
    expect(tamanoArchivo(0)).toBe("1 KB");
    expect(tamanoArchivo(42 * 1024 + 1)).toBe("43 KB");
  });

  it("explica el formato con las columnas del contrato, sin escribirlas a mano", () => {
    expect(COLUMNAS_OBLIGATORIAS).toEqual([
      "concepto",
      "criterio_agrupacion",
      "digitos",
      "fecha_completa",
      "periodo_referencia",
    ]);
    expect(COLUMNAS_OPCIONALES).toEqual([
      "calendario",
      "bloque",
      "nota",
      "origen_celda",
      "confianza",
      "verificado_en_imagen",
    ]);
  });
});

describe("errores de la API", () => {
  it("clasifica por estado y código; el mensaje es el del servidor", () => {
    const columnas =
      "Faltan columnas obligatorias en el encabezado: fecha_completa. Revisá la primera fila del archivo.";
    expect(errorDeImportacion(new ApiError("CALENDAR_VALIDATION_FAILED", columnas, 422))).toEqual({
      tipo: "archivo",
      mensaje: columnas,
    });
    expect(
      errorDeImportacion(new ApiError("CALENDAR_NOT_DRAFT", "Ya no está en borrador.", 409)).tipo,
    ).toBe("borrador");
    expect(
      errorDeImportacion(new ApiError("INTERNAL_ERROR", "Ocurrió un error interno", 500)).tipo,
    ).toBe("reintentar");
    expect(errorDeImportacion(new ApiError("NETWORK_ERROR", "No se pudo conectar", 0)).tipo).toBe(
      "reintentar",
    );
    expect(
      errorDeImportacion(new ApiError("VALIDATION_ERROR", "csv: Falta el contenido", 400)).tipo,
    ).toBe("otro");
    expect(errorDeImportacion(new Error("inesperado")).tipo).toBe("reintentar");
  });
});

describe("motivos de los botones (P4)", () => {
  const base = {
    archivoElegido: true,
    leyendo: false,
    archivoError: null,
    borradorCerrado: false,
    informe: null,
  };

  it("«Probar sin guardar» dice qué falta", () => {
    expect(motivoProbar({ ...base, archivoElegido: false })).toBe(
      "Elegí un archivo para probarlo.",
    );
    expect(motivoProbar({ ...base, leyendo: true })).toBe("Leyendo el archivo…");
    expect(motivoProbar({ ...base, archivoError: "x" })).toBe("Elegí otro archivo para probarlo.");
    expect(motivoProbar({ ...base, borradorCerrado: true })).toBe(
      "El calendario ya no está en borrador.",
    );
    expect(motivoProbar(base)).toBeNull();
  });

  it("«Importar» exige un informe de prueba con celdas para importar", () => {
    expect(motivoImportar({ ...base, archivoElegido: false })).toBe(
      "Elegí un archivo para importarlo.",
    );
    expect(motivoImportar(base)).toBe("Probalo sin guardar para ver el informe antes de importar.");
    expect(motivoImportar({ ...base, informe: informe({ validas: 0 }) })).toBe(
      "No hay celdas para importar: corregí las filas rechazadas y probá de nuevo.",
    );
    expect(motivoImportar({ ...base, informe: informe() })).toBeNull();
  });
});
