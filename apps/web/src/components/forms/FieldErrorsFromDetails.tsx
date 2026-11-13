import { Notice } from "@contable/design-system";
import { ApiError, type ApiErrorValidationIssue } from "../../lib/api";

const FIELD_LABELS: Record<string, string> = {
  authorityId: "Organismo recaudador",
  code: "Código",
  concept: "Concepto",
  engineVersion: "Motor compatible con el régimen",
  jurisdictionId: "Jurisdicción",
  minAmount: "Monto mínimo",
  name: "Nombre",
  rate: "Alícuota",
  regimeId: "Régimen",
  rules: "Reglas",
  rulesHash: "Huella de reglas",
  taxTypeId: "Impuesto",
  validFrom: "Vigencia desde",
  validTo: "Vigencia hasta",
};

const VALIDATION_MESSAGES: Record<string, string> = {
  "Invalid date": "Fecha inválida",
  "Invalid input": "Dato inválido",
  Required: "Campo obligatorio",
};

function isValidationIssue(value: unknown): value is ApiErrorValidationIssue {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Partial<ApiErrorValidationIssue>;
  return (
    typeof issue.message === "string" &&
    Array.isArray(issue.path) &&
    issue.path.every((part) => typeof part === "string" || typeof part === "number")
  );
}

function formatIssue(issue: ApiErrorValidationIssue): string {
  const message = VALIDATION_MESSAGES[issue.message] ?? issue.message;
  const field = issue.path.map((part) => FIELD_LABELS[String(part)] ?? String(part)).join(".");
  return field ? `${field}: ${message}` : message;
}

export function FieldErrorsFromDetails({ error }: { error: ApiError }) {
  const rawDetails = error.details?.details;
  const issues = Array.isArray(rawDetails) ? rawDetails.filter(isValidationIssue) : [];
  const messages = issues.length > 0 ? issues.map(formatIssue) : [error.message];

  return (
    <Notice tone="error">
      {messages.map((message, index) => (
        <span key={`${index}-${message}`}>
          {message}
          {index < messages.length - 1 ? <br /> : null}
        </span>
      ))}
    </Notice>
  );
}
