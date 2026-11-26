import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncState, Button, Field, Notice, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { formatearFecha } from "../lib/formatoFechas";
import { ActionDrawer } from "../ui/ActionDrawer";
import { DenseToggleGroup } from "../ui/Dense";
import { CalendarioFiscalSelect } from "./CalendarioFiscalSelect";
import {
  CUIT_DIGITS,
  cellFormFromEntry,
  cellIssues,
  cellPayload,
  emptyCellForm,
  serverIssues,
  sortedDigits,
  type AdjustmentKind,
  type CalendarDetail,
  type CalendarEntryRow,
  type CellForm,
  type GroupingKind,
  type ServerIssues,
} from "./calendariosFiscales";
import { useTaxTypesAndRegimes } from "./calendariosFiscalesHooks";

/** Celda de formulario → id del control, para llevar el foco al primer error. */
const FIELD_IDS: Record<string, string> = {
  conceptLabel: "celda-concepto",
  taxTypeId: "celda-impuesto",
  regimeId: "celda-regimen",
  groupingKind: "celda-agrupacion",
  referenceLabel: "celda-periodo-rotulo",
  referencePeriodStart: "celda-periodo-desde",
  referencePeriodEnd: "celda-periodo-hasta",
  dueDate: "celda-vencimiento",
  dueDateRaw: "celda-vencimiento-texto",
  adjustment: "celda-ajuste",
  noteRef: "celda-nota-referencia",
  noteText: "celda-nota-texto",
};

const FIELD_ORDER = [
  "conceptLabel",
  "taxTypeId",
  "regimeId",
  "groupingKind",
  "endingDigits",
  "referencePeriodStart",
  "referencePeriodEnd",
  "referenceLabel",
  "dueDate",
  "dueDateRaw",
  "adjustment",
  "noteRef",
  "noteText",
] as const;

const GROUPING_OPTIONS: ReadonlyArray<{ value: GroupingKind; label: string }> = [
  { value: "ENDING_DIGITS", label: "Por terminación de CUIT" },
  { value: "ALL", label: "Todos (sin terminación)" },
];

const ADJUSTMENT_OPTIONS: ReadonlyArray<{ value: AdjustmentKind; label: string }> = [
  { value: "NONE", label: "Sin ajuste" },
  { value: "HOLIDAY", label: "Feriado" },
  { value: "WEEKEND", label: "Fin de semana" },
  { value: "NOTE", label: "Nota" },
];

const DIGIT_OPTIONS = CUIT_DIGITS.map((digit) => ({ value: digit, label: digit }));

function focusField(key: string) {
  const target =
    key === "endingDigits"
      ? document.querySelector<HTMLElement>("#celda-digitos .dense-seg__option")
      : document.getElementById(FIELD_IDS[key] ?? "");
  target?.focus();
}

/**
 * Alta y edición de una celda en un ActionDrawer. Se valida al tipear con el
 * esquema de packages/contracts; el error del servidor va junto al campo que lo
 * origina, y los demás, en un aviso dentro del formulario.
 */
export function CalendarioFiscalCeldaDrawer({
  isOpen,
  onClose,
  firmId,
  calendarId,
  entry,
}: {
  isOpen: boolean;
  onClose: () => void;
  firmId: string | null;
  calendarId: string;
  entry: CalendarEntryRow | null;
}) {
  if (!isOpen) return null;
  return (
    <ActionDrawer
      isOpen
      onClose={onClose}
      title={entry ? "Editar celda" : "Agregar celda"}
      description="Un vencimiento por fila: el concepto como figura en el PDF, su grupo de terminaciones y su fecha completa."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <CellSubmitButton />
        </>
      }
    >
      <CellForm firmId={firmId} calendarId={calendarId} entry={entry} onClose={onClose} />
    </ActionDrawer>
  );
}

/** Botón de guardar fuera del formulario: lo envía con el atributo form. */
function CellSubmitButton() {
  return (
    <Button type="submit" form="celda-form" variant="primary">
      Guardar celda
    </Button>
  );
}

function CellForm({
  firmId,
  calendarId,
  entry,
  onClose,
}: {
  firmId: string | null;
  calendarId: string;
  entry: CalendarEntryRow | null;
  onClose: () => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CellForm>(() =>
    entry ? cellFormFromEntry(entry) : emptyCellForm(),
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [serverNotice, setServerNotice] = useState<ServerIssues | null>(null);
  const issues = cellIssues(form);
  const catalogs = useTaxTypesAndRegimes(firmId, true);

  const taxTypeOptions = (catalogs.taxTypes.data ?? []).map((taxType) => ({
    value: taxType.id,
    label: taxType.name,
  }));
  const regimeOptions = (catalogs.regimes.data ?? [])
    .filter((regime) => !form.taxTypeId || regime.taxType.id === form.taxTypeId)
    .map((regime) => ({ value: regime.id, label: regime.name }));

  const errorFor = (key: string): string | undefined => {
    const issue = (submitted || touched[key] ? issues[key] : undefined) ?? serverFields[key];
    return ["dueDate", "referencePeriodStart", "referencePeriodEnd"].includes(key)
      ? issue?.replaceAll("AAAA-MM-DD", "dd/mm/aaaa")
      : issue;
  };

  const change = <K extends keyof CellForm>(key: K, value: CellForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setTouched((current) => ({ ...current, [key]: true }));
    setServerFields({});
    setServerNotice(null);
  };

  const changeTaxType = (taxTypeId: string) => {
    setForm((current) => {
      const regimeStillValid = (catalogs.regimes.data ?? []).some(
        (regime) =>
          regime.id === current.regimeId && (!taxTypeId || regime.taxType.id === taxTypeId),
      );
      return { ...current, taxTypeId, regimeId: regimeStillValid ? current.regimeId : "" };
    });
    setTouched((current) => ({ ...current, taxTypeId: true }));
    setServerFields({});
    setServerNotice(null);
  };

  const changeGrouping = (groupingKind: GroupingKind) => {
    setForm((current) => ({
      ...current,
      groupingKind,
      digits: groupingKind === "ALL" ? [] : current.digits,
    }));
    setTouched((current) => ({ ...current, groupingKind: true }));
    setServerFields({});
    setServerNotice(null);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const payload = cellPayload(form);
      return entry
        ? api.patch<CalendarDetail>(
            `/firms/${firmId}/tax-calendars/${calendarId}/entries/${entry.id}`,
            payload,
          )
        : api.post<CalendarDetail>(`/firms/${firmId}/tax-calendars/${calendarId}/entries`, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-calendars", firmId] });
      notify.success(
        entry
          ? "Celda guardada. La validación se recalcula."
          : "Celda agregada. La validación se recalcula.",
      );
      onClose();
    },
    onError: (error) => {
      const parsed = serverIssues(error);
      if (Object.keys(parsed.fields).length > 0) setServerFields(parsed.fields);
      else setServerNotice(parsed);
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const first = FIELD_ORDER.find((key) => issues[key] !== undefined);
    if (first) {
      focusField(first);
      return;
    }
    mutation.mutate();
  };

  const selectedDigits = sortedDigits(form.digits);
  const dateValue = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatearFecha(value) : value;
  const changeDate = (
    key: "referencePeriodStart" | "referencePeriodEnd" | "dueDate",
    value: string,
  ) => {
    const clean = value.replace(/[^\d]/g, "").slice(0, 8);
    const display =
      clean.length > 4
        ? `${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4)}`
        : clean.length > 2
          ? `${clean.slice(0, 2)}/${clean.slice(2)}`
          : clean;
    change(
      key,
      clean.length === 8 ? `${clean.slice(4)}-${clean.slice(2, 4)}-${clean.slice(0, 2)}` : display,
    );
  };

  return (
    <form id="celda-form" className="calendario-celda-form" noValidate onSubmit={onSubmit}>
      {serverNotice ? <Notice tone="error">{serverNotice.message}</Notice> : null}
      <Field
        id="celda-concepto"
        name="conceptLabel"
        label="Concepto (como figura en el PDF) *"
        required
        value={form.conceptLabel}
        onChange={(event) => change("conceptLabel", event.target.value)}
        onBlur={() => setTouched((current) => ({ ...current, conceptLabel: true }))}
        error={errorFor("conceptLabel")}
      />
      {catalogs.taxTypes.isError ? (
        <AsyncState
          loading={false}
          error
          loadingLabel="Cargando impuestos"
          errorTitle="No se pudieron cargar los impuestos"
          errorDescription="Reintentá para elegir el impuesto de la celda."
          onRetry={() => void catalogs.taxTypes.refetch()}
        />
      ) : null}
      <CalendarioFiscalSelect
        id="celda-impuesto"
        label="Impuesto (del catálogo)"
        value={form.taxTypeId}
        placeholder="Sin impuesto"
        options={taxTypeOptions}
        onChange={changeTaxType}
        error={errorFor("taxTypeId")}
      />
      {catalogs.regimes.isError ? (
        <AsyncState
          loading={false}
          error
          loadingLabel="Cargando regímenes"
          errorTitle="No se pudieron cargar los regímenes"
          errorDescription="Reintentá para elegir el régimen de la celda."
          onRetry={() => void catalogs.regimes.refetch()}
        />
      ) : null}
      <CalendarioFiscalSelect
        id="celda-regimen"
        label="Régimen (del catálogo)"
        value={form.regimeId}
        placeholder="Sin régimen"
        options={regimeOptions}
        onChange={(value) => change("regimeId", value)}
        error={errorFor("regimeId")}
      />
      <CalendarioFiscalSelect
        id="celda-agrupacion"
        label="Agrupación"
        value={form.groupingKind}
        options={GROUPING_OPTIONS}
        onChange={(value) => changeGrouping(value as GroupingKind)}
        error={errorFor("groupingKind")}
      />
      {form.groupingKind === "ENDING_DIGITS" ? (
        <div id="celda-digitos" className="calendario-celda-digitos">
          <span className="ds-field__label">
            Terminaciones de CUIT (seleccioná los dígitos){" "}
            <span className="calendario-requerido" aria-hidden="true">
              *
            </span>
          </span>
          <DenseToggleGroup
            label="Terminaciones de CUIT"
            options={DIGIT_OPTIONS}
            selected={form.digits}
            onChange={(next) => {
              change("digits", next);
            }}
          />
          {errorFor("endingDigits") ? (
            <span className="ds-field__error" id="celda-digitos-error">
              {errorFor("endingDigits")}
            </span>
          ) : null}
          {selectedDigits === "" ? null : (
            <span className="ds-field__hint">Dígitos elegidos: {selectedDigits}</span>
          )}
        </div>
      ) : null}
      <div className="calendario-celda-seccion">
        <h3>Período de referencia</h3>
        <Field
          id="celda-periodo-rotulo"
          name="referenceLabel"
          label="Rótulo del período de referencia"
          hint="Por ejemplo: Anticipo Ene-26"
          value={form.referenceLabel}
          onChange={(event) => change("referenceLabel", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, referenceLabel: true }))}
          error={errorFor("referenceLabel")}
        />
        <Field
          id="celda-periodo-desde"
          name="referencePeriodStart"
          label="Período de referencia desde"
          hint="dd/mm/aaaa"
          inputMode="numeric"
          maxLength={10}
          placeholder="dd/mm/aaaa"
          value={dateValue(form.referencePeriodStart)}
          onChange={(event) => changeDate("referencePeriodStart", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, referencePeriodStart: true }))}
          error={errorFor("referencePeriodStart")}
        />
        <Field
          id="celda-periodo-hasta"
          name="referencePeriodEnd"
          label="Período de referencia hasta"
          hint="dd/mm/aaaa"
          inputMode="numeric"
          maxLength={10}
          placeholder="dd/mm/aaaa"
          value={dateValue(form.referencePeriodEnd)}
          onChange={(event) => changeDate("referencePeriodEnd", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, referencePeriodEnd: true }))}
          error={errorFor("referencePeriodEnd")}
        />
      </div>
      <div className="calendario-celda-seccion">
        <h3>Vencimiento</h3>
        <Field
          id="celda-vencimiento"
          name="dueDate"
          label="Fecha de vencimiento *"
          required
          hint="dd/mm/aaaa"
          inputMode="numeric"
          maxLength={10}
          placeholder="dd/mm/aaaa"
          value={dateValue(form.dueDate)}
          onChange={(event) => changeDate("dueDate", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, dueDate: true }))}
          error={errorFor("dueDate")}
        />
        <Field
          id="celda-vencimiento-texto"
          name="dueDateRaw"
          label="Texto original de la fecha"
          hint="Como figura en el PDF, si difiere de la fecha."
          value={form.dueDateRaw}
          onChange={(event) => change("dueDateRaw", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, dueDateRaw: true }))}
          error={errorFor("dueDateRaw")}
        />
        <CalendarioFiscalSelect
          id="celda-ajuste"
          label="Ajuste por feriado o fin de semana"
          value={form.adjustment}
          options={ADJUSTMENT_OPTIONS}
          onChange={(value) => change("adjustment", value as AdjustmentKind)}
          error={errorFor("adjustment")}
        />
      </div>
      <div className="calendario-celda-seccion">
        <h3>Nota (opcional)</h3>
        <Field
          id="celda-nota-referencia"
          name="noteRef"
          label="Referencia de la nota"
          value={form.noteRef}
          onChange={(event) => change("noteRef", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, noteRef: true }))}
          error={errorFor("noteRef")}
        />
        <Field
          id="celda-nota-texto"
          name="noteText"
          label="Texto de la nota"
          value={form.noteText}
          onChange={(event) => change("noteText", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, noteText: true }))}
          error={errorFor("noteText")}
        />
      </div>
      <p>Estado de revisión: la celda queda revisada al guardarla.</p>
    </form>
  );
}
