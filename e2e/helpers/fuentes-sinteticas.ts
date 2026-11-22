import { strToU8, zipSync } from "fflate";
import { SIFERE_HEADER_ORDER } from "./libro-iva-headers";

/**
 * Archivos sintéticos para los E2E de liquidación: un libro IVA digital de ventas en .xlsx y los TXT
 * «Mis Recaudaciones» de la DGR de Tucumán. Todos los importes, CUIT y nombres son inventados y se
 * rotulan con el sufijo de la corrida. Las posiciones del TXT siguen el lector de la web
 * (apps/web/src/study/legajo/txtDgrTucuman.ts).
 */

export interface FacturaSintetica {
  fecha: string; // aaaa-mm-dd
  tipo: string; // código ARCA: 1 = Factura A
  numero: string;
  docTipo: string;
  docNumero: string;
  denominacion: string;
  neto: string;
  iva: string;
}

const xmlEscape = (valor: string) =>
  valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(indice: number): string {
  let nombre = "";
  let resto = indice + 1;
  while (resto > 0) {
    const resto26 = (resto - 1) % 26;
    nombre = String.fromCharCode(65 + resto26) + nombre;
    resto = Math.floor((resto - 1) / 26);
  }
  return nombre;
}

/** Libro IVA digital de ventas (una hoja «Ventas») con una fila por factura. Devuelve los bytes del .xlsx. */
export function libroVentasXlsx(facturas: FacturaSintetica[]): Uint8Array {
  const filas: string[][] = [[...SIFERE_HEADER_ORDER]];
  for (const factura of facturas) {
    const valores: Record<string, string> = {
      "Fecha de Emisión": factura.fecha,
      "Tipo de Comprobante": factura.tipo,
      "Punto de Venta": "1",
      "Número de Comprobante": factura.numero,
      "Número de Comprobante Hasta": factura.numero,
      "Tipo Doc.": factura.docTipo,
      "Nro. Doc.": factura.docNumero,
      Denominación: factura.denominacion,
      "Importe Total": (Number(factura.neto) + Number(factura.iva)).toFixed(2),
      "Moneda Original": "PES",
      "Tipo de Cambio": "1",
      "Importe No Gravado": "0",
      "Importe Exento": "0",
      "Neto Gravado IVA 21%": factura.neto,
      "Importe IVA 21%": factura.iva,
      "Total Neto Gravado": factura.neto,
      "Total IVA": factura.iva,
      Actividad: "",
    };
    filas.push(SIFERE_HEADER_ORDER.map((encabezado) => valores[encabezado] ?? ""));
  }
  const celdas = filas.map(
    (fila, indiceFila) =>
      `<row r="${indiceFila + 1}">${fila
        .map(
          (valor, indiceCol) =>
            `<c r="${columnName(indiceCol)}${indiceFila + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(valor)}</t></is></c>`,
        )
        .join("")}</row>`,
  );
  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${celdas.join("")}</sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(hoja),
  });
}

/**
 * Una línea de percepción (o retención) de la DGR: 108 caracteres, marca «P» en la posición 106.
 * `agenteCuit` es el CUIT del agente que practica (11 dígitos con DV válido); `importe` usa punto decimal.
 */
export function lineaPercepcionDgr(agenteCuit: string, razonAgente: string, fecha: string, importe: string): string {
  const campos: Array<[number, string]> = [
    [1, agenteCuit],
    [12, razonAgente.padEnd(50, " ").slice(0, 50)],
    [62, fecha], // dd/mm/aaaa, posiciones 62 a 71
    [72, "01"],
    [75, "A"],
    [77, "0001"],
    [81, "0000123"],
    [99, importe.padStart(7, " ")],
    [106, "P"],
  ];
  const linea = Array.from({ length: 108 }, () => " ");
  for (const [desde, texto] of campos) {
    for (let i = 0; i < texto.length; i += 1) linea[desde - 1 + i] = texto[i]!;
  }
  return linea.join("");
}

/** Nombre que espera el lector: per<CUIT del cliente>_F611_<ddmmaaaahhmm>.txt */
export function nombrePercepcionDgr(cuitCliente: string, ddmmaaaahhmm: string): string {
  return `per${cuitCliente}_F611_${ddmmaaaahhmm}.txt`;
}
