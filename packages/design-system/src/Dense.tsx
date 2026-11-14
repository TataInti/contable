import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "./Button.js";

/**
 * Primitivas de vistas administrativas densas (tabla + detalle lateral).
 * Mantienen tokens, tipografías y el patrón de ActionDrawer para altas y
 * ediciones; sólo cambian la jerarquía y el aprovechamiento del espacio.
 */

export type DenseDensity = 28 | 32 | 40;

const DENSITY_STORAGE_KEY = "contable.dense.rowHeight";
const DENSITIES: ReadonlyArray<{ value: DenseDensity; label: string }> = [
  { value: 28, label: "Compacta" },
  { value: 32, label: "Estándar" },
  { value: 40, label: "Cómoda" },
];

function readStoredDensity(): DenseDensity {
  try {
    const stored = Number(window.localStorage.getItem(DENSITY_STORAGE_KEY));
    if (stored === 28 || stored === 32 || stored === 40) return stored;
  } catch {
    // Sin storage disponible: se usa la densidad estándar.
  }
  return 32;
}

/* La densidad es una preferencia de la persona, no de cada pantalla: un solo
   valor compartido, guardado en el navegador y aplicado a todas las tablas. */
const densityListeners = new Set<() => void>();
/** Respaldo en memoria para cuando el navegador no deja guardar. */
let unsavedDensity: DenseDensity | null = null;

function getDensity(): DenseDensity {
  return unsavedDensity ?? readStoredDensity();
}

function applyDensity(value: DenseDensity) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--ds-row-height", `${value}px`);
}

function setDensity(next: DenseDensity) {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, String(next));
    unsavedDensity = null;
  } catch {
    // La preferencia es una comodidad: si no se puede guardar, vale por esta visita.
    unsavedDensity = next;
  }
  applyDensity(next);
  densityListeners.forEach((listener) => listener());
}

function subscribeDensity(listener: () => void) {
  densityListeners.add(listener);
  return () => {
    densityListeners.delete(listener);
  };
}

export function useDensity(): [DenseDensity, (next: DenseDensity) => void] {
  const density = useSyncExternalStore(subscribeDensity, getDensity, () => 32 as DenseDensity);
  useEffect(() => {
    applyDensity(density);
  }, [density]);
  return [density, setDensity];
}

export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/* ───────── Estructura ───────── */

export function DensePage({
  density,
  flow = false,
  className,
  children,
}: {
  density: DenseDensity;
  /** Clase heredada de la página (estilos propios del módulo). */
  className?: string;
  /** Página de varias secciones apiladas: scrollea completa en vez de fijar el alto. */
  flow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`dense-page${flow ? " dense-page--flow" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--dense-row-h": `${density}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Sección compacta de una página de flujo: título, conteo, acciones y contenido. */
export function DenseSection({
  id,
  title,
  count,
  description,
  actions,
  children,
}: {
  id?: string;
  title: string;
  count?: ReactNode;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} className="dense-block" aria-labelledby={headingId}>
      <header className="dense-block__head">
        <h2 id={headingId}>
          {title}
          {count !== undefined ? <span className="dense-count">{count}</span> : null}
        </h2>
        {description ? <p>{description}</p> : null}
        {actions ? <div className="dense-block__actions">{actions}</div> : null}
      </header>
      <div className="dense-block__body">{children}</div>
    </section>
  );
}

/**
 * Encabezado único de una pantalla: título, una línea de descripción y, a la
 * derecha, las acciones (una sola principal). No lleva rótulo superior.
 */
export function DenseHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="dense-head">
      <div className="dense-head__title">
        <h1>{title}</h1>
        {description ? <p className="dense-head__desc">{description}</p> : null}
      </div>
      {actions ? <div className="dense-head__actions">{actions}</div> : null}
    </header>
  );
}

export interface StatItem {
  key: string;
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "warn";
  active?: boolean;
  onSelect?: () => void;
}

export function StatStrip({ items, label }: { items: StatItem[]; label: string }) {
  return (
    <div className="dense-stats" role="group" aria-label={label}>
      {items.map((item) => {
        const content = (
          <>
            <span className="dense-stat__label">{item.label}</span>
            <span className="dense-stat__value">{item.value}</span>
            {item.detail ? <span className="dense-stat__detail">{item.detail}</span> : null}
          </>
        );
        const className = [
          "dense-stat",
          item.tone === "warn" ? "dense-stat--warn" : "",
          item.active ? "dense-stat--active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return item.onSelect ? (
          <Button
            key={item.key}
            type="button"
            variant="text"
            size="row"
            className={className}
            onClick={item.onSelect}
          >
            {content}
          </Button>
        ) : (
          <div key={item.key} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function DenseToolbar({ children }: { children: ReactNode }) {
  return <div className="dense-toolbar">{children}</div>;
}

export function DensitySwitch({
  value,
  onChange,
}: {
  value: DenseDensity;
  onChange: (next: DenseDensity) => void;
}) {
  return (
    <div className="dense-seg" role="group" aria-label="Densidad de filas">
      {DENSITIES.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant="text"
          size="row"
          className="dense-seg__option"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function DenseWorkspace({
  inspector,
  panelId,
  children,
}: {
  inspector?: ReactNode;
  panelId: string;
  children: ReactNode;
}) {
  return (
    <div
      id={panelId}
      role="tabpanel"
      className={`dense-work${inspector ? " dense-work--inspector" : ""}`}
    >
      <div className="dense-work__main">{children}</div>
      {inspector}
    </div>
  );
}

/* ───────── Tabla ───────── */

export interface DenseColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Habilita ordenar por esta columna. */
  sortValue?: (row: T) => string | number | boolean;
  /** Se oculta cuando el panel de detalle está abierto. */
  secondary?: boolean;
  align?: "right";
  width?: string;
  className?: string;
  sticky?: "right";
}

export function DenseTable<T>({
  label,
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  rowClassName,
  empty,
  footer,
  inspectorOpen,
}: {
  label: string;
  columns: ReadonlyArray<DenseColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  footer?: ReactNode;
  inspectorOpen?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const column = sort ? columns.find((item) => item.key === sort.key) : undefined;
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const order = left > right ? 1 : left < right ? -1 : 0;
      return order * sort.direction;
    });
  }, [rows, columns, sort]);

  const visibleColumns = inspectorOpen ? columns.filter((column) => !column.secondary) : columns;

  const toggleSort = (key: string) =>
    setSort((current) =>
      current?.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 },
    );

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, key: string) => {
    if (event.target !== event.currentTarget || !onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(key);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const sibling =
        event.key === "ArrowDown"
          ? event.currentTarget.nextElementSibling
          : event.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement && sibling.dataset.rowKey) {
        sibling.focus();
        onSelect(sibling.dataset.rowKey);
      }
    }
  };

  return (
    <div className="dense-table-card">
      <div className="dense-table-scroll">
        {sorted.length === 0 ? (
          (empty ?? <div className="dense-empty">Sin resultados</div>)
        ) : (
          <table className="dense-table" aria-label={label}>
            <thead>
              <tr>
                {visibleColumns.map((column) => {
                  const direction = sort?.key === column.key ? sort.direction : null;
                  return (
                    <th
                      key={column.key}
                      className={[
                        column.align === "right" ? "dense-cell--right" : "",
                        column.className ?? "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        ...(column.width ? { width: column.width } : {}),
                        ...(column.sticky === "right"
                          ? { position: "sticky", right: 0 }
                          : {}),
                      }}
                      aria-sort={
                        direction === 1 ? "ascending" : direction === -1 ? "descending" : undefined
                      }
                    >
                      {column.sortValue ? (
                        <Button
                          type="button"
                          variant="text"
                          size="row"
                          className="dense-sort"
                          onClick={() => toggleSort(column.key)}
                        >
                          {column.header}
                          {direction ? (
                            <span aria-hidden="true">{direction === 1 ? "↑" : "↓"}</span>
                          ) : null}
                        </Button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const key = rowKey(row);
                const selected = selectedKey === key;
                return (
                  <tr
                    key={key}
                    data-row-key={key}
                    tabIndex={onSelect ? 0 : undefined}
                    aria-current={selected ? "true" : undefined}
                    className={[
                      onSelect ? "dense-row--selectable" : "",
                      selected ? "dense-row--selected" : "",
                      rowClassName?.(row) ?? "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(event) => {
                      if (!onSelect) return;
                      if ((event.target as HTMLElement).closest("select,button,a,input,label")) return;
                      onSelect(selected ? null : key);
                    }}
                    onKeyDown={(event) => onRowKeyDown(event, key)}
                  >
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={[
                          column.align === "right" ? "dense-cell--right" : "",
                          column.className ?? "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={column.sticky === "right" ? { position: "sticky", right: 0 } : undefined}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {footer ? <div className="dense-table-foot">{footer}</div> : null}
    </div>
  );
}

export function ShortcutHint({ items }: { items: ReadonlyArray<[string, string]> }) {
  return (
    <details className="dense-shortcuts">
      <summary aria-label="Atajos de teclado" title="Atajos de teclado">?</summary>
      <span className="dense-shortcuts__panel" role="note">
        {items.map(([key, text]) => (
          <span key={key}>
            <kbd>{key}</kbd> {text}
          </span>
        ))}
      </span>
    </details>
  );
}

/** Pie estándar de las tablas densas: conteo, nota y atajos. */
export function DenseFooter({
  count,
  noun,
  hint,
  newShortcut = true,
}: {
  count: number;
  noun: string;
  hint?: string;
  newShortcut?: boolean;
}) {
  const shortcuts: Array<[string, string]> = [["/", "buscar"]];
  if (newShortcut) shortcuts.push(["N", "nuevo"]);
  shortcuts.push(["Esc", "cerrar"]);
  return (
    <>
      <span>
        {count} {noun}
      </span>
      {hint ? <span>{hint}</span> : null}
      <span className="dense-table-foot__spacer" />
      <ShortcutHint items={shortcuts} />
    </>
  );
}

/** Estado de carga con el mismo marco que la tabla. */
export function DenseLoading({ label }: { label: string }) {
  return (
    <div className="dense-table-card">
      <div className="query-state" role="status">
        <span className="loading-copy">{label}</span>
      </div>
    </div>
  );
}

/* ───────── Detalle lateral ───────── */

export function Inspector({
  title,
  subtitle,
  leading,
  onClose,
  children,
  footer,
  label,
  banner,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  label: string;
  banner?: ReactNode;
}) {
  return (
    <aside className="dense-inspector" aria-label={label}>
      <header className="dense-inspector__head">
        {leading}
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="dense-inspector__sub">{subtitle}</p> : null}
        </div>
        {onClose ? (
          <Button
            type="button"
            variant="text"
            size="row"
            className="dense-inspector__close"
            onClick={onClose}
            aria-label="Cerrar detalle"
            title="Cerrar (Esc)"
          >
            Cerrar
          </Button>
        ) : null}
      </header>
      {banner ? <div className="dense-inspector__banner">{banner}</div> : null}
      <div className="dense-inspector__body">{children}</div>
      {footer ? <footer className="dense-inspector__foot">{footer}</footer> : null}
    </aside>
  );
}

export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dense-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function InspectorFacts({ items }: { items: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="dense-facts">
      {items
        .filter(([, value]) => value !== null)
        .map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
        ))}
    </dl>
  );
}

/* ───────── Atajos de teclado ───────── */

/**
 * `/` enfoca la búsqueda, `N` abre el alta y `Esc` cierra el detalle.
 * No actúa mientras se escribe ni cuando hay un panel o diálogo abierto.
 */
export function useDenseShortcuts({
  searchRef,
  onNew,
  onEscape,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  onNew?: () => void;
  onEscape?: () => void;
}) {
  const handlers = useRef({ onNew, onEscape });
  handlers.current = { onNew, onEscape };

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.key === "n" || event.key === "N") && handlers.current.onNew) {
        event.preventDefault();
        handlers.current.onNew();
      } else if (event.key === "Escape") {
        handlers.current.onEscape?.();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [searchRef]);
}
