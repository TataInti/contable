import {
  CLIENT_VAT_CONDITION_LABELS,
  MANUAL_EXTRACTION_CURRENCIES,
  MANUAL_EXTRACTION_LETTERS,
  MANUAL_EXTRACTION_VAT_CONDITIONS,
  VOUCHER_DOCUMENT_TYPES,
  isManualExtractionAmountField,
  manualExtractionFieldError,
  normalizeManualExtractionAmount,
} from "@contable/contracts";
import type { ManualExtractionFieldKey } from "@contable/contracts";

const VOUCHER_TYPE_LABELS: Record<(typeof VOUCHER_DOCUMENT_TYPES)[number], string> = {
  factura: "Factura",
  ticket_no_fiscal: "Ticket no fiscal",
  recibo: "Recibo",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  otro: "Otro",
  ilegible: "Ilegible",
};

function selectOptions(key: ManualExtractionFieldKey): Array<{ value: string; label: string }> | null {
  if (key === "voucherType") {
    return VOUCHER_DOCUMENT_TYPES.map((value) => ({ value, label: VOUCHER_TYPE_LABELS[value] }));
  }
  if (key === "letter") return MANUAL_EXTRACTION_LETTERS.map((value) => ({ value, label: value }));
  if (key === "currency") return MANUAL_EXTRACTION_CURRENCIES.map((value) => ({ value, label: value }));
  if (key === "vatCondition") {
    return MANUAL_EXTRACTION_VAT_CONDITIONS.map((value) => ({
      value,
      label: CLIENT_VAT_CONDITION_LABELS[value],
    }));
  }
  return null;
}

export function manualExtractionInputError(
  key: ManualExtractionFieldKey | "",
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!key || !trimmed) return null;
  if (isManualExtractionAmountField(key)) {
    return normalizeManualExtractionAmount(trimmed)
      ? null
      : "Ingresá un importe, por ejemplo 1.234,56";
  }
  return manualExtractionFieldError(key, trimmed);
}

export function normalizeManualExtractionInput(
  key: ManualExtractionFieldKey,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || manualExtractionInputError(key, trimmed)) return null;
  return isManualExtractionAmountField(key)
    ? normalizeManualExtractionAmount(trimmed)
    : trimmed;
}

interface ManualExtractionValueControlProps {
  fieldKey: ManualExtractionFieldKey | "";
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  showValidation?: boolean;
  layout?: "dialog" | "field";
  hint?: string;
}

export function ManualExtractionValueControl({
  fieldKey,
  id,
  label,
  value,
  onChange,
  onBlur,
  disabled = false,
  showValidation = true,
  layout = "dialog",
  hint,
}: ManualExtractionValueControlProps) {
  const message = showValidation ? manualExtractionInputError(fieldKey, value) : null;
  const options = fieldKey ? selectOptions(fieldKey) : null;
  const isDate = fieldKey === "issueDate" || fieldKey === "caeExpiration";
  const isAmount = fieldKey !== "" && isManualExtractionAmountField(fieldKey);
  const isDigitsOnly = ["pointOfSale", "voucherNumber", "issuerTaxId", "receiverTaxId", "cae"].includes(fieldKey);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const controlProps = {
    id,
    "aria-label": label,
    "aria-describedby": describedBy,
    "aria-invalid": message ? true : undefined,
    className: layout === "field" ? `ds-field__input${message ? " ds-field__input--error" : ""}` : undefined,
    disabled,
  };

  return (
    <div className={layout === "field" ? "ds-field" : undefined}>
      <label className={layout === "field" ? "ds-field__label" : "sr-only"} htmlFor={id}>
        {label}
      </label>
      {options ? (
        <select
          {...controlProps}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        >
          <option value="">Seleccioná una opción</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          {...controlProps}
          type={isDate ? "date" : "text"}
          inputMode={isDate ? undefined : isAmount ? "decimal" : isDigitsOnly ? "numeric" : undefined}
          value={value}
          onBlur={onBlur}
          onChange={(event) => {
            const nextValue = isDigitsOnly
              ? event.target.value.replace(/\D/g, "")
              : event.target.value;
            onChange(nextValue);
          }}
        />
      )}
      {hint ? (
        <span id={hintId} className={layout === "field" ? "ds-field__hint" : undefined}>
          {hint}
        </span>
      ) : null}
      {message ? layout === "field" ? (
        <span id={errorId} className="ds-field__error">{message}</span>
      ) : (
        <p id={errorId} className="manual-fields-dialog__field-error" role="alert">{message}</p>
      ) : null}
    </div>
  );
}
