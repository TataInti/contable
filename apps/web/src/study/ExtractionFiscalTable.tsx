import { Table } from "@contable/design-system";
import type { ExtractedField, VoucherARV2Data } from "../lib/api";

interface ExtractionFiscalTableProps {
  voucherData: VoucherARV2Data | null;
  documentReviewReason: string | null;
  fields: ExtractedField[];
}

interface FiscalRow {
  id: string;
  field: string;
  value: string | null;
  hasValue: boolean;
  reason: string;
}

type ScalarVoucherKey = Exclude<keyof VoucherARV2Data, "hora" | "iva" | "percepciones" | "confianza">;

const SCALAR_FIELDS: { field: string; voucherKey: ScalarVoucherKey; extractedKey: string }[] = [
  { field: "Tipo de documento", voucherKey: "tipo_documento", extractedKey: "voucherType" },
  { field: "Letra", voucherKey: "letra", extractedKey: "letter" },
  { field: "Punto de venta", voucherKey: "punto_venta", extractedKey: "pointOfSale" },
  { field: "Número", voucherKey: "numero", extractedKey: "voucherNumber" },
  { field: "Fecha", voucherKey: "fecha", extractedKey: "issueDate" },
  { field: "CUIT emisor", voucherKey: "cuit_emisor", extractedKey: "issuerTaxId" },
  { field: "CUIT receptor", voucherKey: "cuit_receptor", extractedKey: "receiverTaxId" },
  { field: "Razón social emisor", voucherKey: "razon_social_emisor", extractedKey: "issuerName" },
  { field: "Razón social receptor", voucherKey: "razon_social_receptor", extractedKey: "receiverName" },
  { field: "Condición frente al IVA", voucherKey: "condicion_iva", extractedKey: "vatCondition" },
  { field: "Neto gravado", voucherKey: "neto_gravado", extractedKey: "netAmount" },
  { field: "No gravado", voucherKey: "no_gravado", extractedKey: "nonTaxableAmount" },
  { field: "Exento", voucherKey: "exento", extractedKey: "exemptAmount" },
  { field: "Total", voucherKey: "total", extractedKey: "totalAmount" },
  { field: "Moneda", voucherKey: "moneda", extractedKey: "currency" },
  { field: "CAE", voucherKey: "cae", extractedKey: "cae" },
  { field: "Vencimiento del CAE", voucherKey: "cae_vencimiento", extractedKey: "caeExpiration" },
];

function nonEmptyReason(reason: string | null | undefined): string | null {
  return typeof reason === "string" && reason.trim().length > 0 ? reason : null;
}

function reviewReason(fields: ExtractedField[], documentReason: string | null): string {
  const reasons = [
    ...fields.map((field) => nonEmptyReason(field.reason)),
    nonEmptyReason(documentReason),
  ].filter((reason): reason is string => reason !== null);
  return [...new Set(reasons)].join(" · ");
}

function makeRow(
  id: string,
  field: string,
  value: string | null,
  fields: ExtractedField[],
  documentReason: string | null,
  hasValue = value !== null,
): FiscalRow {
  return {
    id,
    field,
    value,
    hasValue,
    reason: reviewReason(fields, documentReason),
  };
}

function buildRows(
  voucher: VoucherARV2Data | null,
  fields: ExtractedField[],
  documentReason: string | null,
): FiscalRow[] {
  const scalarRow = (index: number): FiscalRow => {
    const definition = SCALAR_FIELDS[index]!;
    const relatedFields = fields.filter((field) => field.key === definition.extractedKey);
    return makeRow(
      definition.voucherKey,
      definition.field,
      voucher?.[definition.voucherKey] ?? null,
      relatedFields,
      documentReason,
    );
  };
  // La API devuelve IVA y percepciones como campos repetidos sin índice estable;
  // sus motivos se muestran en todas las filas del grupo para no atribuirlos mal.
  const vatFields = fields.filter((field) => field.key === "vatRate" || field.key === "vatAmount");
  const perceptionFields = fields.filter(
    (field) => field.key === "perceptionType" || field.key === "perceptionAmount",
  );
  const vatRows: FiscalRow[] =
    voucher?.iva == null
      ? [makeRow("iva-unseen", "IVA", null, vatFields, documentReason)]
      : voucher.iva.length === 0
        ? [makeRow("iva-empty", "IVA", "Sin alícuotas", vatFields, documentReason)]
        : voucher.iva.map((entry, index) => {
            const hasValue = entry.alicuota !== null || entry.importe !== null;
            const rate = entry.alicuota === null ? "no visible" : `${entry.alicuota}%`;
            const amount = entry.importe ?? "no visible";
            return makeRow(
              `iva-${index}`,
              entry.alicuota === null ? `IVA · alícuota ${index + 1}` : `IVA · alícuota ${rate}`,
              `Alícuota: ${rate} · Importe: ${amount}`,
              vatFields,
              documentReason,
              hasValue,
            );
          });
  const perceptionRows: FiscalRow[] =
    voucher?.percepciones == null
      ? [makeRow("percepciones-unseen", "Percepciones", null, perceptionFields, documentReason)]
      : voucher.percepciones.length === 0
        ? [makeRow("percepciones-empty", "Percepciones", "Sin percepciones", perceptionFields, documentReason)]
        : voucher.percepciones.map((entry, index) => {
            const hasValue = entry.tipo !== null || entry.importe !== null;
            return makeRow(
              `percepcion-${index}`,
              entry.tipo === null ? `Percepción ${index + 1}` : `Percepción · ${entry.tipo}`,
              `Tipo: ${entry.tipo ?? "no visible"} · Importe: ${entry.importe ?? "no visible"}`,
              perceptionFields,
              documentReason,
              hasValue,
            );
          });

  return [
    scalarRow(0),
    scalarRow(1),
    scalarRow(2),
    scalarRow(3),
    scalarRow(4),
    scalarRow(5),
    scalarRow(6),
    scalarRow(7),
    scalarRow(8),
    scalarRow(9),
    scalarRow(10),
    ...vatRows,
    scalarRow(11),
    scalarRow(12),
    ...perceptionRows,
    scalarRow(13),
    scalarRow(14),
    scalarRow(15),
    scalarRow(16),
  ];
}

export function ExtractionFiscalTable({
  voucherData,
  documentReviewReason,
  fields,
}: ExtractionFiscalTableProps) {
  const rows = buildRows(voucherData, fields, documentReviewReason);

  return (
    <Table
      aria-label="Datos fiscales extraídos"
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { key: "field", header: "Campo", accessor: (row) => row.field },
        { key: "value", header: "Valor", accessor: (row) => row.value ?? "—" },
        {
          key: "state",
          header: "Estado",
          accessor: (row) => (row.reason ? "a revisar" : row.hasValue ? "leído" : "no visible"),
        },
        { key: "reason", header: "Motivo", accessor: (row) => row.reason },
      ]}
    />
  );
}
