import { describe, expect, it } from "vitest";
import {
  agruparAvisos,
  agruparRechazos,
  etiquetaGrupo,
  rangosDeFilas,
} from "./calendariosFiscalesImportacion";

const DUDOSA_VERIFICADA =
  "Queda marcada como dudosa (verificado_en_imagen distinto de «si»). Revisala en la grilla antes de publicar.";
const DUDOSA_CONFIANZA =
  "Queda marcada como dudosa (confianza «baja»). Revisala en la grilla antes de publicar.";
const PERIODO_LIBRE = (cuota: number) =>
  `El período «cuota ${cuota}/2026» es texto libre: se importa solo con ese texto, sin fechas de referencia`;

describe("agrupación de avisos (hallazgo 64)", () => {
  it("sin avisos no hay grupos", () => {
    expect(agruparAvisos([])).toEqual([]);
  });

  it("un solo aviso forma un grupo con su fila y su texto, sin detalle", () => {
    const grupos = agruparAvisos([{ fila: 2, motivo: DUDOSA_VERIFICADA }]);
    expect(grupos).toEqual([
      {
        mensaje: "queda marcada como dudosa (no verificada en imagen)",
        filas: [2],
        rangos: "2",
        detalle: [],
      },
    ]);
    expect(grupos.map(etiquetaGrupo)).toEqual([
      "Fila 2: queda marcada como dudosa (no verificada en imagen)",
    ]);
  });

  it("filas contiguas con el mismo texto forman un rango y no llevan detalle", () => {
    const avisos = [98, 99, 100, 101, 102, 103].map((fila) => ({ fila, motivo: "Texto común." }));
    const grupos = agruparAvisos(avisos);
    expect(grupos.map((grupo) => [grupo.rangos, grupo.filas.length, grupo.detalle.length])).toEqual(
      [["98 a 103", 6, 0]],
    );
    expect(grupos.map(etiquetaGrupo)).toEqual(["Filas 98 a 103 (6): texto común."]);
  });

  it("cifras que cambian entre filas: el grupo usa la plantilla y el detalle conserva cada fila", () => {
    const avisos = [98, 99, 100, 101, 102, 103].map((fila, indice) => ({
      fila,
      motivo: PERIODO_LIBRE(indice + 1),
    }));
    const grupos = agruparAvisos(avisos);
    expect(grupos.map(etiquetaGrupo)).toEqual([
      "Filas 98 a 103 (6): el período «cuota N/2026» es texto libre: se importa solo con ese texto, sin fechas de referencia",
    ]);
    expect(grupos[0]?.detalle).toHaveLength(6);
    expect(grupos[0]?.detalle[0]).toEqual({ fila: 98, motivo: PERIODO_LIBRE(1) });
  });

  it("filas no contiguas se separan en tramos", () => {
    const avisos = [2, 3, 4, 9].map((fila) => ({ fila, motivo: DUDOSA_VERIFICADA }));
    expect(agruparAvisos(avisos).map(etiquetaGrupo)).toEqual([
      "Filas 2 a 4 y 9 (4): queda marcada como dudosa (no verificada en imagen)",
    ]);
  });

  it("297 dudosas contiguas se muestran como un solo grupo", () => {
    const avisos = Array.from({ length: 297 }, (_, indice) => ({
      fila: indice + 2,
      motivo: DUDOSA_VERIFICADA,
    }));
    expect(agruparAvisos(avisos).map(etiquetaGrupo)).toEqual([
      "Filas 2 a 298 (297): queda marcada como dudosa (no verificada en imagen)",
    ]);
  });

  it("textos distintos forman grupos aparte, ordenados por su primera fila", () => {
    const grupos = agruparAvisos([
      { fila: 7, motivo: "Aviso B." },
      { fila: 6, motivo: "Aviso A." },
      { fila: 5, motivo: "Aviso A." },
    ]);
    expect(grupos.map(etiquetaGrupo)).toEqual(["Filas 5 a 6 (2): aviso A.", "Fila 7: aviso B."]);
  });

  it("la dudosa por confianza baja conserva su causa en el texto del grupo", () => {
    expect(agruparAvisos([{ fila: 3, motivo: DUDOSA_CONFIANZA }]).map(etiquetaGrupo)).toEqual([
      "Fila 3: queda marcada como dudosa (confianza «baja»)",
    ]);
  });
});

describe("rangos de filas", () => {
  it("cubre sin filas, una fila, un tramo, varios tramos y filas repetidas", () => {
    expect(rangosDeFilas([])).toBe("");
    expect(rangosDeFilas([7])).toBe("7");
    expect(rangosDeFilas([1, 2])).toBe("1 a 2");
    expect(rangosDeFilas([8, 1, 2, 3, 5, 6, 2])).toBe("1 a 3, 5 a 6 y 8");
  });
});

describe("agrupación de filas rechazadas (hallazgo 65)", () => {
  it("sin rechazos no hay grupos", () => {
    expect(agruparRechazos([])).toEqual([]);
  });

  it("cada fila va una sola vez, con todos sus motivos en orden, por número de fila", () => {
    expect(
      agruparRechazos([
        {
          fila: 413,
          columna: "fecha_completa",
          motivo: "Fecha obligatoria AAAA-MM-DD",
          valorRecibido: null,
        },
        { fila: 9, columna: null, motivo: "Fila sin datos", valorRecibido: null },
        {
          fila: 413,
          columna: "digitos",
          motivo: "Dígitos «(inferido)» no reconocidos",
          valorRecibido: "(inferido)",
        },
      ]),
    ).toEqual([
      { fila: 9, motivos: [{ columna: null, motivo: "Fila sin datos" }] },
      {
        fila: 413,
        motivos: [
          { columna: "fecha_completa", motivo: "Fecha obligatoria AAAA-MM-DD" },
          { columna: "digitos", motivo: "Dígitos «(inferido)» no reconocidos" },
        ],
      },
    ]);
  });
});
