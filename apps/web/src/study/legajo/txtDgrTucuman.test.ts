// Lector de los TXT «Mis Recaudaciones» de la DGR de Tucumán. Todas las líneas son sintéticas:
// misma forma que los archivos reales (ancho fijo 108 y 57), con CUIT, nombres e importes inventados.
import { describe, expect, it } from "vitest";
import { parseSourceFile } from "./archivoFuente";
import { esArchivoTxtDgrTucuman, leerTxtDgrTucuman, tipoDeTxtDgrTucuman } from "./txtDgrTucuman";

const CUIT_CLIENTE = "20111111112";
const CUIT_AGENTE = "30555555551";
const CUIT_BANCO = "30707070702";
const OTRO_CUIT = "27999999900";

const NOMBRE_PER = `per${CUIT_CLIENTE}_F611_221120261015.txt`;
const NOMBRE_RET = `ret${CUIT_CLIENTE}_F611_221120261015.txt`;
const NOMBRE_RECA = `reca${CUIT_CLIENTE}_F611_221120261015.txt`;

interface DatosLinea {
  cuit?: string;
  razon?: string;
  fecha?: string;
  tipo?: string;
  letra?: string;
  pv?: string;
  numero?: string;
  importe?: string;
  marca?: string;
  codigo?: string;
}

/** Línea de 108 posiciones de percepción o retención. */
function lineaPR({
  cuit = CUIT_AGENTE,
  razon = "AGENTE DEMO SINTETICO",
  fecha = "01/10/2026",
  tipo = "11",
  letra = "C",
  pv = "0001",
  numero = "1234567",
  importe = "1500.55",
  marca = "P",
  codigo = "11",
}: DatosLinea = {}): string {
  return (
    cuit +
    razon.padEnd(50) +
    fecha +
    tipo.padEnd(2) +
    " " +
    letra.padEnd(1) +
    " " +
    pv.padEnd(4) +
    numero.padStart(7) +
    " ".repeat(11) +
    importe.padStart(7) +
    marca +
    codigo
  );
}

function lineaReca({
  cuit = CUIT_BANCO,
  fecha = "20261001",
  cuenta = "00000000000000000001",
  importe = "000123.45",
}: { cuit?: string; fecha?: string; cuenta?: string; importe?: string } = {}): string {
  return cuit + fecha + cuenta + " ".repeat(9) + importe.padStart(9);
}

const opciones = {
  clientCuit: CUIT_CLIENTE,
  periodo: { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-31T00:00:00.000Z" },
};

describe("líneas de ejemplo", () => {
  it("las líneas sintéticas miden lo que dice el formato", () => {
    expect(lineaPR()).toHaveLength(108);
    expect(lineaReca()).toHaveLength(57);
  });
});

describe("reconocimiento por nombre", () => {
  it.each([
    [NOMBRE_PER, "PERCEPCION"],
    [NOMBRE_RET, "RETENCION"],
    [NOMBRE_RECA, "RECAUDACION"],
    [`per${CUIT_CLIENTE}_F611_221120261015 (1).txt`, "PERCEPCION"],
    [`RET${CUIT_CLIENTE}_F611_221120261015.TXT`, "RETENCION"],
  ])("%s es de tipo %s", (nombre, tipo) => {
    expect(esArchivoTxtDgrTucuman(nombre)).toBe(true);
    expect(tipoDeTxtDgrTucuman(nombre)).toBe(tipo);
  });

  it.each([
    "ventas.txt",
    "retenciones.csv",
    `ret${CUIT_CLIENTE}_F611_221120261015.csv`,
    "percepciones_F611.txt",
    "perfil.txt",
  ])("%s no es un TXT de la DGR: sigue el camino de siempre", (nombre) => {
    expect(esArchivoTxtDgrTucuman(nombre)).toBe(false);
  });

  it("el de Convenio Multilateral se reconoce pero no tiene tipo", () => {
    const nombre = `ret${CUIT_CLIENTE}_F611CM_221120261015.txt`;
    expect(esArchivoTxtDgrTucuman(nombre)).toBe(true);
    expect(tipoDeTxtDgrTucuman(nombre)).toBeNull();
  });
});

describe("percepciones (per…)", () => {
  it("convierte una línea en una fila para el normalizador", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR(), opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.tipo).toBe("PERCEPCION");
    expect(lectura.filas).toEqual([
      {
        kind: "PERCEPCION",
        cuitResponsable: CUIT_CLIENTE,
        cuitAgente: CUIT_AGENTE,
        concept: "IIBB",
        amount: "1500.55",
        issuedOn: "2026-10-01",
        certificateNumber: "C 0001-01234567",
        baseNoInformada: true,
      },
    ]);
  });

  it("sin letra usa el código de tipo de comprobante", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ tipo: "99", letra: " ", pv: "3" }), opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.filas[0]).toMatchObject({ certificateNumber: "99 0003-01234567" });
  });

  it.each([
    ["9999.99", "9999.99"],
    ["9999.9", "9999.9"],
    ["999", "999"],
    ["9999", "9999"],
  ])("acepta el importe %s", (importe, esperado) => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ importe }), opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.filas[0]).toMatchObject({ amount: esperado });
  });

  it("lee varias líneas con CRLF, con salto final o sin él", () => {
    const a = lineaPR({ numero: "1" });
    const b = lineaPR({ numero: "2", fecha: "02/10/2026" });
    for (const contenido of [`${a}\r\n${b}`, `${a}\r\n${b}\r\n`, `${a}\n${b}\n`]) {
      const lectura = leerTxtDgrTucuman(NOMBRE_PER, contenido, opciones);
      expect(lectura.errores).toEqual([]);
      expect(lectura.filas).toHaveLength(2);
    }
  });

  it("acepta la copia que el navegador renombra con « (1)»", () => {
    const lectura = leerTxtDgrTucuman(`per${CUIT_CLIENTE}_F611_221120261015 (1).txt`, lineaPR(), opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.filas).toHaveLength(1);
  });

  it("rechaza con su línea una marca de retención en un archivo de percepciones", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ marca: "R" }), opciones);
    expect(lectura.filas).toEqual([]);
    expect(lectura.errores).toEqual([
      "Línea 1: la marca de la posición 106 es «R» (retención) y este archivo es de percepciones.",
    ]);
  });
});

describe("retenciones (ret…)", () => {
  it("convierte una línea en una retención", () => {
    const lectura = leerTxtDgrTucuman(
      NOMBRE_RET,
      lineaPR({ marca: "R", tipo: "6", letra: "B", pv: "12", numero: "345", importe: "250.5" }),
      opciones,
    );
    expect(lectura.errores).toEqual([]);
    expect(lectura.tipo).toBe("RETENCION");
    expect(lectura.filas[0]).toMatchObject({
      kind: "RETENCION",
      cuitResponsable: CUIT_CLIENTE,
      cuitAgente: CUIT_AGENTE,
      concept: "IIBB",
      amount: "250.5",
      certificateNumber: "B 0012-00000345",
    });
  });

  it("una línea de percepción en un archivo de retenciones se rechaza", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_RET, lineaPR({ marca: "P" }), opciones);
    expect(lectura.errores[0]).toContain("es «P» (percepción) y este archivo es de retenciones");
  });
});

describe("recaudaciones bancarias (reca…)", () => {
  it("convierte una línea en una recaudación bancaria", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_RECA, lineaReca(), opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.tipo).toBe("RECAUDACION");
    expect(lectura.filas).toEqual([
      {
        kind: "RETENCION",
        cuitResponsable: CUIT_CLIENTE,
        cuitAgente: CUIT_BANCO,
        concept: "RECAUDACION_BANCARIA",
        amount: "000123.45",
        issuedOn: "2026-10-01",
        certificateNumber: "00000000000000000001",
        baseNoInformada: true,
      },
    ]);
  });

  it("lee el importe sin ceros y con CRLF final", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_RECA, `${lineaReca({ importe: "45.5" })}\r\n`, opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.filas[0]).toMatchObject({ amount: "45.5" });
  });
});

describe("validaciones", () => {
  it("una línea de largo distinto dice cuánto mide y cuánto debería medir", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, `${lineaPR()}\n${lineaPR().slice(0, 100)}`, opciones);
    expect(lectura.filas).toEqual([]);
    expect(lectura.errores).toEqual(["Línea 2: mide 100 caracteres y las de percepciones miden 108."]);
  });

  it("si todas las líneas tienen la forma de otro tipo, lo sugiere", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaReca(), opciones);
    expect(lectura.errores).toEqual([
      "Las líneas miden 57 caracteres: tienen la forma de una recaudación bancaria (reca…), no de percepciones (108).",
    ]);
  });

  it("una fecha que no existe en el calendario se rechaza con su línea", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ fecha: "31/02/2026" }), opciones);
    expect(lectura.errores).toEqual(["Línea 1: la fecha 31/02/2026 no existe. Debe ser dd/mm/aaaa."]);
  });

  it("una fecha de recaudación inválida se rechaza", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_RECA, lineaReca({ fecha: "20261340" }), opciones);
    expect(lectura.errores).toEqual(["Línea 1: la fecha 20261340 no existe. Debe ser aaaammdd."]);
  });

  it("un importe que no es número se rechaza", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ importe: "12,5" }), opciones);
    expect(lectura.errores).toEqual(["Línea 1: el importe «12,5» no es un número con punto decimal."]);
    const reca = leerTxtDgrTucuman(NOMBRE_RECA, lineaReca({ importe: "abc" }), opciones);
    expect(reca.errores).toEqual(["Línea 1: el importe «abc» no es un número con punto decimal."]);
  });

  it("el CUIT del agente con dígito verificador incorrecto se rechaza", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ cuit: "30555555559" }), opciones);
    expect(lectura.errores).toEqual([
      "Línea 1: el CUIT del agente 30-55555555-9 no es válido (dígito verificador).",
    ]);
  });

  it("el punto de venta que no es numérico se rechaza", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR({ pv: "00X1" }), opciones);
    expect(lectura.errores).toEqual(["Línea 1: el punto de venta «00X1» no es numérico."]);
  });

  it("el archivo de otro CUIT se rechaza diciendo de quién es", () => {
    const lectura = leerTxtDgrTucuman(`per${OTRO_CUIT}_F611_221120261015.txt`, lineaPR(), opciones);
    expect(lectura.filas).toEqual([]);
    expect(lectura.errores).toEqual([
      "Este archivo es del CUIT 27-99999990-0, no del cliente (CUIT 20-11111111-2).",
    ]);
  });

  it("el CUIT del nombre se compara aunque el cliente venga con guiones", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, lineaPR(), { ...opciones, clientCuit: "20-11111111-2" });
    expect(lectura.errores).toEqual([]);
  });

  it("sin CUIT del cliente no puede comparar y lo lee igual", () => {
    const lectura = leerTxtDgrTucuman(`per${OTRO_CUIT}_F611_221120261015.txt`, lineaPR());
    expect(lectura.errores).toEqual([]);
    expect(lectura.filas[0]).toMatchObject({ cuitResponsable: OTRO_CUIT });
  });

  it("un CUIT del nombre con dígito verificador incorrecto se rechaza", () => {
    const lectura = leerTxtDgrTucuman("per20111111119_F611_221120261015.txt", lineaPR(), {});
    expect(lectura.errores).toEqual(["El CUIT del nombre del archivo (20-11111111-9) no es válido."]);
  });

  it("un nombre que no sigue la forma esperada dice cuál es", () => {
    const lectura = leerTxtDgrTucuman("per123_F611_x.txt", lineaPR(), opciones);
    expect(lectura.errores).toEqual([
      "El nombre del archivo debe ser per<CUIT>_F611_<ddmmaaaahhmm>.txt, tal como lo baja «Mis Recaudaciones».",
    ]);
  });

  it("las líneas repetidas se rechazan indicando cuál repite a cuál", () => {
    const a = lineaPR({ numero: "1" });
    const b = lineaPR({ numero: "2" });
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, [a, b, a].join("\r\n"), opciones);
    expect(lectura.filas).toEqual([]);
    expect(lectura.errores).toEqual(["Línea 3: repite la línea 1."]);
  });

  it("un archivo vacío dice que no tiene líneas", () => {
    expect(leerTxtDgrTucuman(NOMBRE_PER, "\r\n", opciones).errores).toEqual(["El archivo no tiene líneas."]);
  });

  it("Convenio Multilateral (F611CM) se rechaza: se incorpora más adelante", () => {
    const lectura = leerTxtDgrTucuman(`ret${CUIT_CLIENTE}_F611CM_221120261015.txt`, "cualquier cosa", opciones);
    expect(lectura.tipo).toBeNull();
    expect(lectura.filas).toEqual([]);
    expect(lectura.errores).toEqual([
      "Convenio Multilateral se incorpora más adelante. Este archivo (F611CM) todavía no se puede cargar.",
    ]);
  });
});

describe("avisos de fecha fuera del período", () => {
  it("avisa las líneas con fecha fuera del mes pero las conserva", () => {
    const contenido = [
      lineaPR({ numero: "1", fecha: "30/09/2026" }),
      lineaPR({ numero: "2", fecha: "15/10/2026" }),
      lineaPR({ numero: "3", fecha: "01/11/2026" }),
    ].join("\r\n");
    const lectura = leerTxtDgrTucuman(NOMBRE_PER, contenido, opciones);
    expect(lectura.errores).toEqual([]);
    expect(lectura.filas).toHaveLength(3);
    expect(lectura.avisos).toEqual([
      "2 líneas tienen fecha fuera del período (01/10/2026 al 31/10/2026): líneas 1 y 3. Se cargan igual.",
    ]);
  });

  it("sin líneas fuera del período no hay avisos", () => {
    expect(leerTxtDgrTucuman(NOMBRE_PER, lineaPR(), opciones).avisos).toEqual([]);
  });

  it("en recaudaciones también compara la fecha", () => {
    const lectura = leerTxtDgrTucuman(NOMBRE_RECA, lineaReca({ fecha: "20250930" }), opciones);
    expect(lectura.avisos).toEqual([
      "1 línea tiene fecha fuera del período (01/10/2026 al 31/10/2026): línea 1. Se carga igual.",
    ]);
  });
});

describe("parseSourceFile con los TXT de la DGR", () => {
  it.each([
    [NOMBRE_PER, lineaPR(), "PERCEPCION"],
    [NOMBRE_RET, lineaPR({ marca: "R" }), "RETENCION"],
    [NOMBRE_RECA, lineaReca(), "RETENCION"],
  ])("%s se lee con el lector de la DGR", (nombre, contenido, kind) => {
    const filas = parseSourceFile(nombre, contenido, { clientCuit: CUIT_CLIENTE });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ kind, cuitResponsable: CUIT_CLIENTE });
  });

  it("si el archivo tiene errores, lanza con todos los motivos y su línea", () => {
    expect(() =>
      parseSourceFile(NOMBRE_PER, `${lineaPR({ fecha: "31/02/2026" })}\n${lineaPR({ importe: "x" })}`, {
        clientCuit: CUIT_CLIENTE,
      }),
    ).toThrow(
      "El archivo tiene 2 errores. Línea 1: la fecha 31/02/2026 no existe. Debe ser dd/mm/aaaa. " +
        "Línea 2: el importe «x» no es un número con punto decimal.",
    );
  });

  it("si hay muchos errores, muestra los primeros y cuenta el resto", () => {
    const contenido = Array.from({ length: 8 }, (_, i) =>
      lineaPR({ numero: String(i + 1), fecha: "99/99/9999" }),
    ).join("\n");
    expect(() => parseSourceFile(NOMBRE_PER, contenido, { clientCuit: CUIT_CLIENTE })).toThrow(
      /Hay 3 errores más\.$/,
    );
  });

  it("el TXT de Convenio Multilateral lanza el aviso", () => {
    expect(() => parseSourceFile(`ret${CUIT_CLIENTE}_F611CM_221120261015.txt`, "x")).toThrow(
      "Convenio Multilateral se incorpora más adelante",
    );
  });

  it("un TXT con otro nombre sigue leyéndose como texto delimitado con encabezado", () => {
    expect(parseSourceFile("demo.txt", "Proveedor;Importe\nProveedor Demo;100")).toEqual([
      { Proveedor: "Proveedor Demo", Importe: "100" },
    ]);
  });
});
