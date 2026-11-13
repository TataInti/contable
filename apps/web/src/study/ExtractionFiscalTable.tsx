import { Button, Table } from "@contable/design-system";
import { isValidManualExtractionIsoDate } from "@contable/contracts";
import type { ExtractedField, ExtractionReviewIssue, VoucherData } from "../lib/api";
import { effectiveExtractedFieldValue, EXTRACTION_SCALAR_FIELDS } from "./extractionScalarFields";
import {
  AUTOMATED_READING_UNAVAILABLE_MESSAGE,
  isAutomatedReadingUnavailableReason,
} from "./extractionReadiness";

interface ExtractionFiscalTableProps {
  voucherData: VoucherData | null;
  documentReviewReason: string | null;
  reviewIssues?: ExtractionReviewIssue[] | null;
  fields: ExtractedField[];
  onAddManualData?: () => void;
}

interface FiscalRow {
  id: string;
  field: string;
  value: string | null;
  hasValue: boolean;
  reason: string;
  manual: boolean;
}

const SCALAR_FIELDS = EXTRACTION_SCALAR_FIELDS;

const REPEATED_FIELD_GROUPS: Record<string, string> = {
  vatRate: "IVA",
  vatAmount: "IVA",
  perceptionType: "Percepciones",
  perceptionAmount: "Percepciones",
  perceptionCategory: "Percepciones",
  perceptionText: "Percepciones",
};

const AMOUNT_KEYS: ReadonlySet<string> = new Set([
  "netAmount",
  "nonTaxableAmount",
  "exemptAmount",
  "totalAmount",
]);
const NORMALIZED_AMOUNT = /^-?\d+(?:\.\d{1,4})?$/;
const AMOUNT_FORMAT = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function displayScalarValue(key: string, value: string | null): string | null {
  // Los importes llegan normalizados ("29900.00"); se muestran en es-AR
  // ("29.900,00"). Un texto que no es un importe normalizado se deja tal cual
  // para no ocultar lo que realmente se leyó o cargó.
  if (value && AMOUNT_KEYS.has(key) && NORMALIZED_AMOUNT.test(value)) {
    return AMOUNT_FORMAT.format(Number(value));
  }
  if (!value || (key !== "issueDate" && key !== "caeExpiration") || !isValidManualExtractionIsoDate(value)) {
    return value;
  }
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

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
  manual = false,
): FiscalRow {
  return {
    id,
    field,
    value,
    hasValue,
    reason: rowReviewReason(relatedFields, relatedIssues),
    manual,
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
    const correctedValue = relatedFields.find((field) => field.correction?.trim())?.correction ?? null;
    const manualField = relatedFields.find(
      (field) => field.method === "HUMAN" && effectiveExtractedFieldValue(field) !== null,
    );
    const fieldValue = manualField
      ? effectiveExtractedFieldValue(manualField)
      : relatedFields.map(effectiveExtractedFieldValue).find((item) => item !== null) ?? null;
    const value = correctedValue ?? voucher?.[definition.voucherKey] ?? fieldValue;
    return makeRow(
      definition.voucherKey,
      definition.field,
      displayScalarValue(definition.extractedKey, value),
      relatedFields,
      relatedIssues,
      value !== null,
      manualField !== undefined,
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

/**
 * Los motivos de «lectura automática no disponible» se traducen a un mensaje
 * para el revisor; el resto conserva el texto original del backend.
 */
function displayDocumentReason(reason: string): string {
  return isAutomatedReadingUnavailableReason(reason)
    ? AUTOMATED_READING_UNAVAILABLE_MESSAGE
    : reason;
}

export function ExtractionFiscalTable({
  voucherData,
  documentReviewReason,
  reviewIssues,
  fields,
  onAddManualData,
}: ExtractionFiscalTableProps) {
  const issues = reviewIssues ?? [];
  const rows = buildRows(voucherData, fields, issues);
  const documentReasons = uniqueReasons(
    documentReviewReasons(fields, documentReviewReason, reviewIssues).map(displayDocumentReason),
  );
  const automatedReadingUnavailable =
    isAutomatedReadingUnavailableReason(documentReviewReason ?? "") ||
    issues.some((issue) => isAutomatedReadingUnavailableReason(issue.reason));

  return (
    <>
      {documentReasons.length > 0 ? (
        <div className="extraction-document-review" role="status" aria-label="Estado del documento">
          <span>Estado del documento: a revisar · {documentReasons.join(" · ")}</span>
          {automatedReadingUnavailable && onAddManualData ? (
            <Button type="button" variant="ghost" onClick={onAddManualData}>
              Cargar datos a mano
            </Button>
          ) : null}
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
            accessor: (row) => (row.manual ? "cargado a mano" : row.reason ? "a revisar" : row.hasValue ? "leído" : "no visible"),
          },
          { key: "reason", header: "Motivo", accessor: (row) => row.reason },
        ]}
      />
    </>
  );
}
