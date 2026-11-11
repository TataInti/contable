// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedField, VoucherARV2Data } from "../lib/api";
import { ExtractionFiscalTable } from "./ExtractionFiscalTable";

const voucherFixture: VoucherARV2Data = {
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
}: {
  voucher?: VoucherARV2Data | null;
  fields?: ExtractedField[];
  reviewReason?: string | null;
} = {}) {
  return render(
    <ExtractionFiscalTable
      voucherData={voucher}
      documentReviewReason={reviewReason}
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
  it("muestra los campos fiscales aprobados y separa cada alícuota y percepción", () => {
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
      "Percepción · IIBB",
      "Percepción · IVA",
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
    expect(rowForField(table, "Vencimiento del CAE")[1]!.textContent).toBe("2026-11-10");
    expect(rowForField(table, "IVA · alícuota 21%")[1]!.textContent).toBe(
      "Alícuota: 21% · Importe: 210.00",
    );
    expect(rowForField(table, "IVA · alícuota 10.5%")[1]!.textContent).toBe(
      "Alícuota: 10.5% · Importe: 52.50",
    );
    expect(rowForField(table, "Percepción · IIBB")[1]!.textContent).toBe(
      "Tipo: IIBB · Importe: 15.00",
    );
    expect(rowForField(table, "Percepción · IVA")[1]!.textContent).toBe(
      "Tipo: IVA · Importe: 5.00",
    );
    expect(within(table).queryByText("hora", { exact: true })).toBeNull();
    expect(within(table).queryByText("confianza", { exact: true })).toBeNull();
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

  it("marca a revisar el campo que tiene motivo y muestra el motivo registrado", () => {
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

  it("propaga el motivo de revisión del documento a sus filas", () => {
    renderTable({ reviewReason: "neto + IVA no cierra con el total" });
    const table = screen.getByRole("table", { name: "Datos fiscales extraídos" });
    const net = rowForField(table, "Neto gravado");

    expect(net[2]!.textContent).toBe("a revisar");
    expect(net[3]!.textContent).toBe("neto + IVA no cierra con el total");
  });
});
