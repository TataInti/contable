import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@contable/design-system";
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
import type { ExtractedField, VoucherData } from "../lib/api";
import {
  EXTRACTION_SCALAR_FIELDS,
  fiscalScalarHasValue,
  type ManualFiscalFieldKey,
} from "./extractionScalarFields";

interface DraftRow {
  id: number;
  key: ManualFiscalFieldKey | "";
  value: string;
}

export interface ManualExtractionFieldValue {
  key: ManualFiscalFieldKey;
  value: string;
}

interface ManualExtractionFieldsDialogProps {
  fields: ExtractedField[];
  voucherData: VoucherData | null;
  isSaving: boolean;
  error: string | null;
  onSave: (fields: ManualExtractionFieldValue[]) => void;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]";

const VOUCHER_TYPE_LABELS: Record<(typeof VOUCHER_DOCUMENT_TYPES)[number], string> = {
  factura: "Factura",
  ticket_no_fiscal: "Ticket no fiscal",
  recibo: "Recibo",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  otro: "Otro",
  ilegible: "Ilegible",
};

function selectOptions(key: ManualFiscalFieldKey): Array<{ value: string; label: string }> | null {
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

function valueForSubmission(key: ManualFiscalFieldKey, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isManualExtractionAmountField(key) ? normalizeManualExtractionAmount(trimmed) : trimmed;
}

function inputError(key: ManualFiscalFieldKey | "", value: string): string | null {
  const trimmed = value.trim();
  if (!key || !trimmed) return null;
  if (isManualExtractionAmountField(key)) {
    return normalizeManualExtractionAmount(trimmed)
      ? null
      : "Ingresá un importe, por ejemplo 1.234,56";
  }
  return manualExtractionFieldError(key, trimmed);
}

export function ManualExtractionFieldsDialog({
  fields,
  voucherData,
  isSaving,
  error,
  onSave,
  onClose,
}: ManualExtractionFieldsDialogProps) {
  const [rows, setRows] = useState<DraftRow[]>([{ id: 1, key: "", value: "" }]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nextRowId = useRef(2);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestCloseRef = useRef<() => void>(() => {});
  const confirmDiscardRef = useRef(false);

  const hasUnsavedChanges = rows.length !== 1 || rows[0]?.key !== "" || rows[0]?.value !== "";
  const requestClose = useCallback(() => {
    if (isSaving) return;
    if (hasUnsavedChanges) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, isSaving, onClose]);
  requestCloseRef.current = requestClose;
  confirmDiscardRef.current = confirmDiscard;

  const rowErrors = useMemo(
    () => new Map(rows.map((row) => [row.id, inputError(row.key, row.value)])),
    [rows],
  );
  const payload = useMemo(
    () => rows.flatMap((row) => {
      if (!row.key) return [];
      const value = valueForSubmission(row.key, row.value);
      return value ? [{ key: row.key, value }] : [];
    }),
    [rows],
  );
  const hasInvalidValues = rows.some((row) => rowErrors.get(row.id) !== null);
  const canSave = !isSaving && payload.length > 0 && !hasInvalidValues;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      ".manual-fields-dialog__table select:not(:disabled)",
    ) ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (confirmDiscardRef.current) {
          setConfirmDiscard(false);
        } else {
          requestCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const scope = confirmDiscardRef.current
        ? dialogRef.current.querySelector<HTMLElement>(".manual-fields-dialog__discard")
        : dialogRef.current;
      if (!scope) return;
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).sort((left, right) => {
        const position = left.compareDocumentPosition(right);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (!scope.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmDiscard) {
      dialogRef.current?.querySelector<HTMLElement>("[data-continue-editing]")?.focus();
    }
  }, [confirmDiscard]);

  const updateRow = (id: number, changes: Partial<Pick<DraftRow, "key" | "value">>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...changes } : row));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    onSave(payload);
  };

  return (
    <div
      className="manual-fields-dialog__scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="manual-fields-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-fields-dialog-title"
        aria-busy={isSaving}
        tabIndex={-1}
      >
        <header className="manual-fields-dialog__header">
          <div>
            <p className="study-page__eyebrow">Carga manual</p>
            <h2 id="manual-fields-dialog-title">Cargar datos a mano</h2>
          </div>
          <button
            className="manual-fields-dialog__close"
            type="button"
            aria-label="Cerrar"
            disabled={isSaving}
            onClick={requestClose}
          >
            ×
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="manual-fields-dialog__table-wrap">
            <table className="manual-fields-dialog__table">
              <thead>
                <tr>
                  <th scope="col">Campo</th>
                  <th scope="col">Valor</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <label className="sr-only" htmlFor={`manual-field-key-${row.id}`}>
                        Campo de la fila {index + 1}
                      </label>
                      <select
                        id={`manual-field-key-${row.id}`}
                        aria-label={`Campo de la fila ${index + 1}`}
                        value={row.key}
                        disabled={isSaving}
                        onChange={(event) => updateRow(row.id, { key: event.target.value as ManualFiscalFieldKey | "" })}
                      >
                        <option value="">Seleccioná un campo</option>
                        {EXTRACTION_SCALAR_FIELDS.map((definition) => {
                          const alreadyHasValue = fiscalScalarHasValue(voucherData, fields, definition);
                          const selectedElsewhere = rows.some((other) => other.id !== row.id && other.key === definition.extractedKey);
                          const optionLabel = `${definition.field}${"optional" in definition && definition.optional ? " (opcional)" : ""}`;
                          return (
                            <option
                              key={definition.extractedKey}
                              value={definition.extractedKey}
                              disabled={alreadyHasValue || selectedElsewhere}
                            >
                              {alreadyHasValue ? `${optionLabel} (ya tiene valor)` : optionLabel}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`manual-field-value-${row.id}`}>
                        Valor de la fila {index + 1}
                      </label>
                      {(() => {
                        const options = row.key ? selectOptions(row.key) : null;
                        const isDate = row.key === "issueDate" || row.key === "caeExpiration";
                        const isAmount = row.key !== "" && isManualExtractionAmountField(row.key);
                        const isDigitsOnly = ["pointOfSale", "voucherNumber", "issuerTaxId", "receiverTaxId", "cae"].includes(row.key);
                        const message = rowErrors.get(row.id);
                        const errorId = `manual-field-value-error-${row.id}`;
                        const commonProps = {
                          id: `manual-field-value-${row.id}`,
                          "aria-label": `Valor de la fila ${index + 1}`,
                          "aria-describedby": message ? errorId : undefined,
                          "aria-invalid": message ? true : undefined,
                          disabled: isSaving,
                        };

                        return (
                          <>
                            {options ? (
                              <select
                                {...commonProps}
                                value={row.value}
                                onChange={(event) => updateRow(row.id, { value: event.target.value })}
                              >
                                <option value="">Seleccioná una opción</option>
                                {options.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                {...commonProps}
                                type={isDate ? "date" : "text"}
                                inputMode={isDate ? undefined : isAmount ? "decimal" : isDigitsOnly ? "numeric" : undefined}
                                value={row.value}
                                onChange={(event) => {
                                  const nextValue = isDigitsOnly
                                    ? event.target.value.replace(/\D/g, "")
                                    : event.target.value;
                                  updateRow(row.id, { value: nextValue });
                                }}
                              />
                            )}
                            {message ? (
                              <p id={errorId} className="manual-fields-dialog__field-error" role="alert">
                                {message}
                              </p>
                            ) : null}
                          </>
                        );
                      })()}
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar fila ${index + 1}`}
                        disabled={isSaving}
                        onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="manual-fields-dialog__add-row">
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving || rows.length >= EXTRACTION_SCALAR_FIELDS.length}
              onClick={() => {
                const id = nextRowId.current++;
                setRows((current) => [...current, { id, key: "", value: "" }]);
              }}
            >
              + Agregar fila
            </Button>
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          {confirmDiscard ? (
            <div className="manual-fields-dialog__discard" role="alertdialog" aria-modal="true" aria-labelledby="manual-fields-discard-title">
              <p id="manual-fields-discard-title">¿Descartar los datos cargados?</p>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  data-continue-editing
                  onClick={() => setConfirmDiscard(false)}
                >
                  Seguir editando
                </Button>
                <Button type="button" variant="danger" onClick={onClose}>
                  Descartar
                </Button>
              </div>
            </div>
          ) : null}

          <footer className="manual-fields-dialog__footer">
            <Button type="button" variant="ghost" disabled={isSaving} onClick={requestClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? "Guardando…" : "Guardar"}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
