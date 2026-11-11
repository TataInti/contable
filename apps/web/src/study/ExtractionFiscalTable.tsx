import { Table } from "@contable/design-system";
import type { ExtractedField, ExtractionReviewIssue, VoucherData } from "../lib/api";

interface ExtractionFiscalTableProps {
  voucherData: VoucherData | null;
  documentReviewReason: string | null;
  reviewIssues?: ExtractionReviewIssue[] | null;
  fields: ExtractedField[];
}

interface FiscalRow {
  id: string;
  field: string;
  value: string | null;
  hasValue: boolean;
  reason: string;
}

type ScalarVoucherKey = Exclude<keyof VoucherData, "hora" | "iva" | "percepciones" | "confianza">;

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

const REPEATED_FIELD_GROUPS: Record<string, string> = {
  vatRate: "IVA",
  vatAmount: "IVA",
  perceptionType: "Percepciones",
  perceptionAmount: "Percepciones",
  perceptionCategory: "Percepciones",
  perceptionText: "Percepciones",
};

function nonEmptyReason(reason: string | null | undefined): string | null {
  return typeof reason === "string" && reason.trim().length > 0 ? reason : null;
}

function uniqueReasons(reasons: Array<string | null | undefined>): string[] {
  return [...new Set(reasons.map(nonEmptyReason).filter((reason): reason is string => reason !== null))];
}

function rowReviewReason(fields: ExtractedField[], issues: ExtractionReviewIssue[]): string {
  return uniqueReasons([
    ...fields.map((field) => field.reason),
    ...issues.map((issue) => issue.reason),
  ]).join(" · ");
}

function issuesForRow(
  issues: ExtractionReviewIssue[],
  collection: "iva" | "percepciones",
  index: number,
): ExtractionReviewIssue[] {
  const prefix = `${collection}[${index}].`;
  return issues.filter((issue) => issue.sourcePath?.startsWith(prefix));
}

function documentReviewReasons(
  fields: ExtractedField[],
  documentReason: string | null,
  reviewIssues: ExtractionReviewIssue[] | null | undefined,
): string[] {
  const issues = reviewIssues ?? [];
  const structuredDocumentReasons = issues
    .filter((issue) => issue.sourcePath === null)
    .map((issue) => issue.reason);
  const structuredReasons = new Set(issues.map((issue) => issue.reason));
  const useLegacyDocumentReason = reviewIssues == null || issues.length === 0;
  const unscopedRepeatedReasons = fields.flatMap((field) => {
    const reason = nonEmptyReason(field.reason);
    const group = REPEATED_FIELD_GROUPS[field.key];
    if (!reason || !group || structuredReasons.has(reason)) return [];
    return [`${group}: ${reason}`];
  });

  return uniqueReasons([
    ...structuredDocumentReasons,
    ...(useLegacyDocumentReason ? [documentReason] : []),
    ...unscopedRepeatedReasons,
  ]);
}

function makeRow(
  id: string,
  field: string,
  value: string | null,
  relatedFields: ExtractedField[],
  relatedIssues: ExtractionReviewIssue[],
  hasValue = value !== null,
): FiscalRow {
  return {
    id,
    field,
    value,
    hasValue,
    reason: rowReviewReason(relatedFields, relatedIssues),
  };
}

function buildRows(
  voucher: VoucherData | null,
  fields: ExtractedField[],
  reviewIssues: ExtractionReviewIssue[],
): FiscalRow[] {
  const scalarRow = (index: number): FiscalRow => {
    const definition = SCALAR_FIELDS[index]!;
    const relatedFields = fields.filter((field) => field.key === definition.extractedKey);
    const relatedIssues = reviewIssues.filter((issue) => issue.sourcePath === definition.voucherKey);
    return makeRow(
      definition.voucherKey,
      definition.field,
      voucher?.[definition.voucherKey] ?? null,
      relatedFields,
      relatedIssues,
    );
  };
  const vatRows: FiscalRow[] =
    voucher?.iva == null
      ? [makeRow("iva-unseen", "IVA", null, [], [])]
      : voucher.iva.length === 0
        ? [makeRow("iva-empty", "IVA", "Sin alícuotas", [], [])]
        : voucher.iva.map((entry, index) => {
            const hasValue = entry.alicuota !== null || entry.importe !== null;
            const rate = entry.alicuota === null ? "no visible" : `${entry.alicuota}%`;
            const amount = entry.importe ?? "no visible";
            return makeRow(
              `iva-${index}`,
              entry.alicuota === null ? `IVA · alícuota ${index + 1}` : `IVA · alícuota ${rate}`,
              `Alícuota: ${rate} · Importe: ${amount}`,
              [],
              issuesForRow(reviewIssues, "iva", index),
              hasValue,
            );
          });
  const perceptionRows: FiscalRow[] =
    voucher?.percepciones == null
      ? [makeRow("percepciones-unseen", "Percepciones", null, [], [])]
      : voucher.percepciones.length === 0
        ? [makeRow("percepciones-empty", "Percepciones", "Sin percepciones", [], [])]
        : voucher.percepciones.map((entry, index) => {
            const isV21 = "categoria" in entry;
            const category = isV21 ? entry.categoria : "sin clasificar";
            const originalText = isV21 ? entry.tipo_texto : entry.tipo;
            const hasValue = originalText !== null || entry.importe !== null;
            return makeRow(
              `percepcion-${index}`,
              `Percepción – ${category}`,
              `Texto original: ${originalText ?? "no visible"} · Importe: ${entry.importe ?? "no visible"}`,
              [],
              issuesForRow(reviewIssues, "percepciones", index),
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
  reviewIssues,
  fields,
}: ExtractionFiscalTableProps) {
  const issues = reviewIssues ?? [];
  const rows = buildRows(voucherData, fields, issues);
  const documentReasons = documentReviewReasons(fields, documentReviewReason, reviewIssues);

  return (
    <>
      {documentReasons.length > 0 ? (
        <div className="extraction-document-review" role="status" aria-label="Estado del documento">
          Estado del documento: a revisar · {documentReasons.join(" · ")}
        </div>
      ) : null}
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
    </>
  );
}
