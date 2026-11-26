// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ExtractedField,
  ExtractionReviewIssue,
  VoucherData,
} from "../lib/api";
import { ExtractionFiscalTable } from "./ExtractionFiscalTable";
import { AUTOMATED_READING_UNAVAILABLE_MESSAGE } from "./extractionReadiness";

const voucherFixture: VoucherData = {
  tipo_documento: "factura",
  letra: "A",
  punto_venta: "0004",
  numero: "00001234",
  fecha: "2026-10-31",
  hora: "10:15:00",
  cuit_emisor: "20123456786",
  cuit_receptor: "30712345678",
  razon_social_emisor: "Proveedor S.A.",
  razon_social_receptor: "Cliente S.R.L.",
  condicion_iva: "Responsable inscripto",
  neto_gravado: "1000.00",
  iva: [
    { alicuota: "21", importe: "210.00" },
    { alicuota: "10.5", importe: "52.50" },
  ],
  no_gravado: "0.00",
  exento: "0.00",
  percepciones: [
    { tipo: "IIBB", importe: "15.00" },
    { tipo: "IVA", importe: "5.00" },
  ],
  total: "1282.50",
  moneda: "ARS",
  cae: "12345678901234",
  cae_vencimiento: "2026-11-10",
  confianza: {},
};

function renderTable({
  voucher = voucherFixture,
  fields = [],
  reviewReason = null,
  reviewIssues,
}: {
  voucher?: VoucherData | null;
  fields?: ExtractedField[];
  reviewReason?: string | null;
  reviewIssues?: ExtractionReviewIssue[];
} = {}) {
  return render(
    <ExtractionFiscalTable
      voucherData={voucher}
      documentReviewReason={reviewReason}
      reviewIssues={reviewIssues}
      fields={fields}
    />,
  );
}

function rowForField(table: HTMLElement, name: string) {
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryAllByRole("cell")[0]?.textContent === name);
  if (!row) throw new Error(`No se encontró la fila ${name}`);
  return within(row).getAllByRole("cell");
}

afterEach(() => cleanup());

describe("ExtractionFiscalTable", () => {
  it("muestra los campos fiscales y conserva el texto de percepciones v2 antiguas", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const rows = within(table).getAllByRole("row");
    const fieldLabels = rows.slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);

    expect(rows).toHaveLength(22);
    expect(fieldLabels).toEqual([
      "Tipo de documento",
      "Letra",
      "Punto de venta",
      "Número",
      "Fecha",
      "CUIT emisor",
      "CUIT receptor",
      "Razón social emisor",
      "Razón social receptor",
      "Condición frente al IVA",
      "Neto gravado",
      "IVA · alícuota 21%",
      "IVA · alícuota 10.5%",
      "No gravado",
      "Exento",
      "Percepción – sin clasificar",
      "Percepción – sin clasificar",
      "Total",
      "Moneda",
      "CAE",
      "Vencimiento del CAE",
    ]);
    expect(within(rows[0]!).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Campo",
      "Valor",
      "Estado",
      "Motivo",
    ]);
    expect(rowForField(table, "CUIT emisor")[1]!.textContent).toBe("20123456786");
    expect(rowForField(table, "Fecha")[1]!.textContent).toBe("31/10/2026");
    expect(rowForField(table, "Vencimiento del CAE")[1]!.textContent).toBe("10/11/2026");
    expect(rowForField(table, "IVA · alícuota 21%")[1]!.textContent).toBe(
      "Alícuota: 21% · Importe: 210.00",
    );
    expect(rowForField(table, "IVA · alícuota 10.5%")[1]!.textContent).toBe(
      "Alícuota: 10.5% · Importe: 52.50",
    );
    expect(rowForField(table, "Percepción – sin clasificar")[1]!.textContent).toBe(
      "Texto original: IIBB · Importe: 15.00",
    );
    expect(within(table).queryByText("hora", { exact: true })).toBeNull();
    expect(within(table).queryByText("confianza", { exact: true })).toBeNull();
  });

  it("muestra cada percepción v2.1 con categoría e impresión original", () => {
    renderTable({
      voucher: {
        ...voucherFixture,
        percepciones: [
          { categoria: "IIBB", tipo_texto: "IIBB Buenos Aires", importe: "15.00" },
          { categoria: "IVA", tipo_texto: "Percepción IVA", importe: "5.00" },
          { categoria: "Ganancias", tipo_texto: "Retención ganancias", importe: "20.00" },
        ],
      },
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });

    expect(rowForField(table, "Percepción – IIBB")[1]!.textContent).toBe(
      "Texto original: IIBB Buenos Aires · Importe: 15.00",
    );
    expect(rowForField(table, "Percepción – IVA")[1]!.textContent).toBe(
      "Texto original: Percepción IVA · Importe: 5.00",
    );
    expect(rowForField(table, "Percepción – Ganancias")[1]!.textContent).toBe(
      "Texto original: Retención ganancias · Importe: 20.00",
    );
    expect(rowForField(table, "Percepción – IIBB")[2]!.textContent).toBe("leído");
  });

  it("asigna percepción no reconocida a la fila Otras exacta", () => {
    renderTable({
      voucher: {
        ...voucherFixture,
        percepciones: [
          { categoria: "IIBB", tipo_texto: "IIBB Buenos Aires", importe: "15.00" },
          { categoria: "Otras", tipo_texto: "Tributo sin clasificar", importe: "7.00" },
        ],
      },
      reviewIssues: [{ reason: "percepción no reconocida", sourcePath: "percepciones[1].categoria" }],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const iibb = rowForField(table, "Percepción – IIBB");
    const other = rowForField(table, "Percepción – Otras");

    expect(iibb[2]!.textContent).toBe("leído");
    expect(iibb[3]!.textContent).toBe("");
    expect(other[2]!.textContent).toBe("a revisar");
    expect(other[3]!.textContent).toBe("percepción no reconocida");
  });

  it("asigna el motivo de IVA a la segunda de tres filas por sourcePath", () => {
    renderTable({
      voucher: {
        ...voucherFixture,
        iva: [
          { alicuota: "10.5", importe: "10.50" },
          { alicuota: "21", importe: "21.00" },
          { alicuota: "27", importe: "27.00" },
        ],
      },
      reviewIssues: [{ reason: "importe poco legible", sourcePath: "iva[1].importe" }],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const first = rowForField(table, "IVA · alícuota 10.5%");
    const second = rowForField(table, "IVA · alícuota 21%");
    const third = rowForField(table, "IVA · alícuota 27%");

    expect(first[2]!.textContent).toBe("leído");
    expect(first[3]!.textContent).toBe("");
    expect(second[2]!.textContent).toBe("a revisar");
    expect(second[3]!.textContent).toBe("importe poco legible");
    expect(third[2]!.textContent).toBe("leído");
    expect(third[3]!.textContent).toBe("");
  });

  it("muestra motivos sin sourcePath en el estado del documento", () => {
    renderTable({
      reviewReason: "COMPONENT_SUM_MISMATCH",
      reviewIssues: [{ reason: "COMPONENT_SUM_MISMATCH", sourcePath: null }],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const documentStatus = screen.getByRole("status", { name: "Estado del documento" });

    expect(documentStatus.textContent).toBe("Estado del documento: a revisar · COMPONENT_SUM_MISMATCH");
    expect(rowForField(table, "Neto gravado")[2]!.textContent).toBe("leído");
    expect(rowForField(table, "Neto gravado")[3]!.textContent).toBe("");
    expect(rowForField(table, "IVA · alícuota 21%")[2]!.textContent).toBe("leído");
  });

  it.each([
    "CUSTOMER_DATA_EXTRACTION_DISABLED",
    "AI_SERVICE_UNAVAILABLE",
    "MODEL_NOT_CONFIGURED",
  ])("traduce el motivo %s de lectura no disponible a un mensaje accionable", (reason) => {
    renderTable({
      voucher: null,
      reviewReason: reason,
      reviewIssues: [{ reason, sourcePath: null }],
    });

    const documentStatus = screen.getByRole("status", { name: "Estado del documento" });
    expect(documentStatus.textContent).toBe(
      `Estado del documento: a revisar · ${AUTOMATED_READING_UNAVAILABLE_MESSAGE}`,
    );
    expect(documentStatus.textContent).not.toContain(reason);
  });

  it("traduce el reviewReason legado de lectura no disponible sin reviewIssues", () => {
    renderTable({ voucher: null, reviewReason: "AI_SERVICE_UNAVAILABLE" });

    const documentStatus = screen.getByRole("status", { name: "Estado del documento" });
    expect(documentStatus.textContent).toContain(AUTOMATED_READING_UNAVAILABLE_MESSAGE);
    expect(documentStatus.textContent).not.toContain("AI_SERVICE_UNAVAILABLE");
  });

  it("mantiene reviewReason legado en el estado del documento sin marcar todas las filas", () => {
    renderTable({ reviewReason: "neto + IVA no cierra con el total" });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });

    expect(screen.getByRole("status", { name: "Estado del documento" }).textContent).toContain(
      "neto + IVA no cierra con el total",
    );
    expect(rowForField(table, "Neto gravado")[2]!.textContent).toBe("leído");
    expect(rowForField(table, "IVA · alícuota 21%")[2]!.textContent).toBe("leído");
  });

  it("marca los valores null como no visibles", () => {
    renderTable({
      voucher: {
        ...voucherFixture,
        letra: null,
        iva: null,
        percepciones: null,
      },
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });

    const letter = rowForField(table, "Letra");
    expect(letter[1]!.textContent).toBe("—");
    expect(letter[2]!.textContent).toBe("no visible");
    expect(letter[3]!.textContent).toBe("");
    expect(rowForField(table, "IVA")[2]!.textContent).toBe("no visible");
    expect(rowForField(table, "Percepciones")[2]!.textContent).toBe("no visible");
  });

  it.each([
    ["cuit_emisor", "CUIT emisor", "CUIT receptor"],
    ["cuit_receptor", "CUIT receptor", "CUIT emisor"],
    ["cae_vencimiento", "Vencimiento del CAE", "Fecha"],
  ])("asigna el motivo de revisión de %s a su fila escalar", (sourcePath, label, otherLabel) => {
    renderTable({
      reviewIssues: [{ reason: "dato inválido", sourcePath }],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const flagged = rowForField(table, label);

    expect(flagged[2]!.textContent).toBe("a revisar");
    expect(flagged[3]!.textContent).toBe("dato inválido");
    expect(rowForField(table, otherLabel)[2]!.textContent).toBe("leído");
    expect(screen.queryByRole("status", { name: "Estado del documento" })).toBeNull();
  });

  it("marca a revisar el campo escalar que tiene motivo sin alterar los demás", () => {
    renderTable({
      fields: [
        {
          id: "field-cuit-emisor",
          key: "issuerTaxId",
          rawValue: "20123456786",
          normalizedValue: "20123456786",
          correction: null,
          confidence: 0.6,
          status: "NEEDS_REVIEW",
          reason: "CUIT poco legible",
        },
      ],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const cuit = rowForField(table, "CUIT emisor");

    expect(cuit[2]!.textContent).toBe("a revisar");
    expect(cuit[3]!.textContent).toBe("CUIT poco legible");
    expect(rowForField(table, "CUIT receptor")[2]!.textContent).toBe("leído");
  });

  it("tolera reviewIssues vacío o ausente", () => {
    renderTable({ reviewIssues: [] });
    let table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    expect(screen.queryByRole("status", { name: "Estado del documento" })).toBeNull();
    expect(rowForField(table, "IVA · alícuota 21%")[2]!.textContent).toBe("leído");

    cleanup();
    renderTable();
    table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    expect(screen.queryByRole("status", { name: "Estado del documento" })).toBeNull();
    expect(rowForField(table, "Percepción – sin clasificar")[2]!.textContent).toBe("leído");
  });

  it("muestra la corrección efectiva y distingue los campos cargados a mano", () => {
    renderTable({
      voucher: null,
      fields: [
        {
          id: "field-total-corrected",
          key: "totalAmount",
          rawValue: "100",
          normalizedValue: "100",
          correction: "120 sin formato",
          method: "EMBEDDED_TEXT",
          confidence: 0.9,
          status: "CORRECTED",
          reason: null,
        },
        {
          id: "field-issuer-manual",
          key: "issuerTaxId",
          rawValue: null,
          normalizedValue: null,
          correction: "dato cargado",
          method: "HUMAN",
          confidence: 0,
          status: "CORRECTED",
          reason: null,
        },
      ],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });

    expect(rowForField(table, "Total")[1]!.textContent).toBe("120 sin formato");
    expect(rowForField(table, "CUIT emisor")[1]!.textContent).toBe("dato cargado");
    expect(rowForField(table, "CUIT emisor")[2]!.textContent).toBe("cargado a mano");
  });

  it("muestra sin transformar los valores viejos no canónicos", () => {
    renderTable({
      voucher: null,
      fields: [
        {
          id: "field-legacy-date",
          key: "issueDate",
          rawValue: null,
          normalizedValue: null,
          correction: "31/11/2026",
          method: "HUMAN",
          confidence: 0,
          status: "CORRECTED",
          reason: null,
        },
        {
          id: "field-legacy-amount",
          key: "totalAmount",
          rawValue: null,
          normalizedValue: null,
          correction: "importe libre",
          method: "HUMAN",
          confidence: 0,
          status: "CORRECTED",
          reason: null,
        },
      ],
    });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });

    expect(rowForField(table, "Fecha")[1]!.textContent).toBe("31/11/2026");
    expect(rowForField(table, "Total")[1]!.textContent).toBe("importe libre");
  });
});
