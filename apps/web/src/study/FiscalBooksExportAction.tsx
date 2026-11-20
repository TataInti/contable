import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AsyncState, Button, EmptyState, Table, useNotify, type TableColumn } from "@contable/design-system";
import {
  FISCAL_BOOK_TITLES,
  type FiscalBookColumnKey,
  type FiscalBookFormat,
  type FiscalBookKind,
  type FiscalBookSortBy,
  type FiscalBookSortDir,
} from "@contable/contracts";
import { useClientContext } from "../context/ClientContext";
import { ApiError, api, downloadFile } from "../lib/api";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import { StatStrip } from "../ui/Dense";
import {
  ALL_FISCAL_BOOK_COLUMNS,
  FISCAL_BOOK_COLUMN_OPTIONS,
  FISCAL_BOOK_FORMAT_OPTIONS,
  FISCAL_BOOK_KIND_OPTIONS,
  FISCAL_BOOK_SORT_DIR_OPTIONS,
  FISCAL_BOOK_SORT_OPTIONS,
  buildFiscalBookExportUrl,
  fiscalBooksSummaryUrl,
  formatFiscalAmount,
  orderFiscalBookColumns,
  type FiscalBookExcludedGroup,
  type FiscalBooksSummary,
} from "./fiscalBooksExport";

interface FiscalBooksExportActionProps {
  /** Id del período fiscal activo en el Legajo; null si no hay ninguno elegido. */
  periodId: string | null;
  /** Nombre visible del período activo, para el panel. */
  periodLabel: string | null;
  /** Modo controlado (menú de la barra): el padre abre y cierra el cajón y no hay botón propio. */
  abierto?: boolean;
  onCerrar?: () => void;
}

/** Controles del panel que pueden recibir un error del servidor junto a ellos. */
type ExportField = "book" | "format" | "sortBy" | "sortDir" | "columns";

const EXPORT_FIELDS: readonly string[] = ["book", "format", "sortBy", "sortDir", "columns"];

const NO_COLUMNS_MESSAGE = "Elegí al menos una columna para descargar el libro.";

interface DownloadFailure {
  /** Control al que corresponde el error; null si el servidor no informa uno de los controles. */
  field: ExportField | null;
  message: string;
}

const EXCLUDED_COLUMNS: TableColumn<FiscalBookExcludedGroup>[] = [
  { key: "reason", header: "Motivo", accessor: (row) => row.label },
  { key: "count", header: "Comprobantes", align: "right", accessor: (row) => row.count },
];

function optionLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function isValidationIssue(value: unknown): value is { path: Array<string | number>; message: string } {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as { path?: unknown; message?: unknown };
  return typeof issue.message === "string" && Array.isArray(issue.path);
}

/** Toma el campo y el motivo que informa el servidor para mostrarlos junto al control (P4). */
function failureFrom(error: unknown): DownloadFailure {
  // Sin respuesta del servidor (estado 0) el aviso conserva su paso siguiente, sin el texto de la red.
  if (!(error instanceof ApiError) || error.status === 0) {
    return { field: null, message: "No se pudo descargar el libro. Reintentá en unos minutos." };
  }
  const rawIssues: unknown = error.details?.details;
  const issue = Array.isArray(rawIssues) ? rawIssues.find(isValidationIssue) : undefined;
  const serverField: unknown = issue?.path[0] ?? error.details?.field;
  const field =
    typeof serverField === "string" && EXPORT_FIELDS.includes(serverField) ? (serverField as ExportField) : null;
  return { field, message: issue?.message ?? error.message };
}

function emptyDescription(excludedCount: number): string {
  if (excludedCount === 0) {
    return "El período no tiene comprobantes de este libro. Cargalos o importalos en la Bandeja documental y aprobalos.";
  }
  const noun = excludedCount === 1 ? "comprobante" : "comprobantes";
  return `Hay ${excludedCount} ${noun} del período fuera del libro. Revisá sus motivos en la tabla y resolvé lo pendiente en la Bandeja documental.`;
}

interface ExportSelectProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  error: string | null;
  onChange: (value: T) => void;
}

function ExportSelect<T extends string>({ id, label, value, options, error, onChange }: ExportSelectProps<T>) {
  const errorId = `${id}-error`;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={error ? "ds-field__input ds-field__input--error" : "ds-field__input"}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="ds-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Acción «Exportar libros» del Legajo (corte 7b): botón secundario y panel para
 * descargar el libro de compras o de ventas del período activo. El servidor
 * decide qué comprobantes entran; la pantalla muestra su resumen y arma la descarga.
 */
export function FiscalBooksExportAction({ periodId, periodLabel, abierto, onCerrar }: FiscalBooksExportActionProps) {
  const { firmId, clientId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const controlado = abierto !== undefined;
  const panelAbierto = controlado ? abierto : open;
  // Al abrir desde el menú se limpia el error del intento anterior, como en el modo propio.
  useEffect(() => {
    if (controlado && abierto) {
      setFailure(null);
      setColumnsNotice(null);
    }
  }, [controlado, abierto]);
  const [book, setBook] = useState<FiscalBookKind>("purchases");
  const [format, setFormat] = useState<FiscalBookFormat>("xlsx");
  const [columns, setColumns] = useState<readonly FiscalBookColumnKey[]>(ALL_FISCAL_BOOK_COLUMNS);
  const [sortBy, setSortBy] = useState<FiscalBookSortBy>("issuedOn");
  const [sortDir, setSortDir] = useState<FiscalBookSortDir>("asc");
  const [columnsNotice, setColumnsNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<DownloadFailure | null>(null);

  const canRead = capabilities.has("tax.vouchers.read");
  const scopeReady = Boolean(firmId && clientId && periodId);
  const scope = { firmId: firmId ?? "", clientId: clientId ?? "", periodId: periodId ?? "" };

  const summaryQuery = useQuery({
    queryKey: ["fiscal-books-summary", firmId, clientId, periodId],
    queryFn: () => api.get<FiscalBooksSummary>(fiscalBooksSummaryUrl(scope)),
    enabled: panelAbierto && scopeReady,
  });

  const downloadMutation = useMutation({
    mutationFn: () => downloadFile(buildFiscalBookExportUrl({ ...scope, book, format, columns, sortBy, sortDir })),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      notify.success(`${FISCAL_BOOK_TITLES[book]} descargado en ${optionLabel(FISCAL_BOOK_FORMAT_OPTIONS, format)}.`);
    },
    onError: (error) => setFailure(failureFrom(error)),
  });

  const openPanel = () => {
    setFailure(null);
    setColumnsNotice(null);
    setOpen(true);
  };
  const closePanel = () => {
    if (!controlado) setOpen(false);
    onCerrar?.();
  };
  const goToBandeja = () => {
    closePanel();
    navigate("/bandeja");
  };

  const toggleColumn = (key: FiscalBookColumnKey, checked: boolean) => {
    const next = checked ? orderFiscalBookColumns([...columns, key]) : columns.filter((item) => item !== key);
    setColumns(next);
    setColumnsNotice(next.length === 0 ? NO_COLUMNS_MESSAGE : null);
  };

  const download = () => {
    if (columns.length === 0) {
      setColumnsNotice(NO_COLUMNS_MESSAGE);
      return;
    }
    downloadMutation.mutate();
  };

  const missingScope = !clientId
    ? "Elegí un cliente para exportar sus libros."
    : !periodId
      ? "Elegí un período fiscal para exportar sus libros."
      : null;

  const bookSummary = summaryQuery.data?.books[book];
  const downloadBlock = bookSummary
    ? bookSummary.included.count === 0
      ? "No hay comprobantes aprobados para descargar en este libro."
      : null
    : summaryQuery.isError
      ? "El resumen no cargó: reintentá para poder descargar."
      : "Cargando el resumen: podrás descargar cuando termine.";

  const fieldError = (field: ExportField): string | null => (failure?.field === field ? failure.message : null);
  const unlinkedFailure = failure && failure.field === null ? failure.message : null;
  const columnsError = columnsNotice ?? fieldError("columns");

  if (!canRead) return null;

  return (
    <>
      {controlado ? null : (
      <>
      <Button
        type="button"
        variant="secondary"
        disabled={Boolean(missingScope)}
        aria-describedby={missingScope ? "fiscal-books-export-scope" : undefined}
        onClick={openPanel}
      >
        <Icon name="download" size={16} />
        Exportar libros
      </Button>
      {missingScope ? (
        <span id="fiscal-books-export-scope" className="ds-field__hint">
          {missingScope}
        </span>
      ) : null}
      </>
      )}
      <ActionDrawer
        isOpen={panelAbierto}
        onClose={closePanel}
        title="Exportar libros"
        description={`${periodLabel ? `Período ${periodLabel}. ` : ""}Elegí el libro, el formato, las columnas y el orden; antes de descargar ves qué entra y qué queda afuera.`}
        footer={
          <>
            {downloadBlock ? <span className="ds-field__hint">{downloadBlock}</span> : null}
            {unlinkedFailure ? (
              <span className="ds-field__error" role="alert">
                {unlinkedFailure}
              </span>
            ) : null}
            <Button type="button" variant="ghost" onClick={closePanel}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={downloadMutation.isPending}
              loadingLabel="Descargando"
              disabled={Boolean(downloadBlock)}
              onClick={download}
            >
              Descargar libro
            </Button>
          </>
        }
      >
        <ExportSelect
          id="fiscal-books-book"
          label="Libro"
          value={book}
          options={FISCAL_BOOK_KIND_OPTIONS}
          error={fieldError("book")}
          onChange={setBook}
        />

        <AsyncState
          loading={summaryQuery.isLoading}
          error={summaryQuery.isError && !summaryQuery.data}
          loadingLabel="Cargando el resumen del período…"
          errorTitle="No se pudo cargar el resumen"
          errorDescription="Reintentá la consulta para ver qué entra en el libro."
          onRetry={() => void summaryQuery.refetch()}
        />
        {bookSummary ? (
          <>
            <StatStrip
              label={`Resumen de ${FISCAL_BOOK_TITLES[book]}`}
              items={[
                { key: "included", label: "Entran", value: bookSummary.included.count, detail: "comprobantes aprobados" },
                { key: "excluded", label: "Quedan afuera", value: bookSummary.excludedCount, detail: "con su motivo" },
                { key: "total", label: "Total del libro", value: formatFiscalAmount(bookSummary.included.totals.total) },
              ]}
            />
            {bookSummary.included.count === 0 ? (
              <EmptyState
                kind="no-data"
                title="No hay comprobantes aprobados para este libro"
                description={emptyDescription(bookSummary.excludedCount)}
                action={
                  <Button type="button" variant="secondary" onClick={goToBandeja}>
                    Ir a la Bandeja documental
                  </Button>
                }
              />
            ) : null}
            {bookSummary.included.count > 0 && bookSummary.excludedCount === 0 ? (
              <p className="ds-field__hint">Ningún comprobante queda afuera del libro.</p>
            ) : null}
            {bookSummary.excluded.length > 0 ? (
              <Table columns={EXCLUDED_COLUMNS} rows={bookSummary.excluded} rowKey={(row) => row.reason} />
            ) : null}
          </>
        ) : null}

        <ExportSelect
          id="fiscal-books-format"
          label="Formato"
          value={format}
          options={FISCAL_BOOK_FORMAT_OPTIONS}
          error={fieldError("format")}
          onChange={setFormat}
        />

        <div className="ds-field" role="group" aria-labelledby="fiscal-books-columns-title">
          <span id="fiscal-books-columns-title" className="ds-field__label">
            Columnas
          </span>
          <span className="ds-field__hint">Se descargan en el orden del libro. Dejá al menos una.</span>
          {FISCAL_BOOK_COLUMN_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={columns.includes(option.value)}
                onChange={(event) => toggleColumn(option.value, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {columnsError ? (
            <span className="ds-field__error" role="alert">
              {columnsError}
            </span>
          ) : null}
        </div>

        <ExportSelect
          id="fiscal-books-sort-by"
          label="Ordenar por"
          value={sortBy}
          options={FISCAL_BOOK_SORT_OPTIONS}
          error={fieldError("sortBy")}
          onChange={setSortBy}
        />
        <ExportSelect
          id="fiscal-books-sort-dir"
          label="Sentido del orden"
          value={sortDir}
          options={FISCAL_BOOK_SORT_DIR_OPTIONS}
          error={fieldError("sortDir")}
          onChange={setSortDir}
        />
      </ActionDrawer>
    </>
  );
}
