import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "./Icon";
import "./Dense.css";

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

export function useDensity(): [DenseDensity, (next: DenseDensity) => void] {
  const [density, setDensity] = useState<DenseDensity>(readStoredDensity);
  const update = (next: DenseDensity) => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, String(next));
    } catch {
      // La preferencia es una comodidad: si no se puede guardar, sigue funcionando.
    }
  };
  return [density, update];
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
  children,
}: {
  density: DenseDensity;
  children: ReactNode;
}) {
  return (
    <div className="dense-page" style={{ "--dense-row-h": `${density}px` } as CSSProperties}>
      {children}
    </div>
  );
}

export function DenseHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="dense-head">
      <div className="dense-head__title">
        <p className="study-page__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <p className="dense-head__desc">{description}</p>
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
          <button key={item.key} type="button" className={className} onClick={item.onSelect}>
            {content}
          </button>
        ) : (
          <div key={item.key} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export interface DenseTab<T extends string> {
  id: T;
  label: string;
  count?: number;
  warnCount?: number;
}

export function DenseTabs<T extends string>({
  label,
  tabs,
  active,
  onChange,
  idPrefix = "dense-tab",
}: {
  label: string;
  tabs: ReadonlyArray<DenseTab<T>>;
  active: T;
  onChange: (id: T) => void;
  idPrefix?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.id);
    document.getElementById(`${idPrefix}-${tab.id}`)?.focus();
  };
  return (
    <div className="dense-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`${idPrefix}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={active === tab.id ? 0 : -1}
          className="dense-tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="dense-count">{tab.count}</span> : null}
          {tab.warnCount ? (
            <span
              className="dense-count dense-count--warn"
              title={`${tab.warnCount} con alertas`}
            >
              <Icon name="alert" size={11} /> {tab.warnCount}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function DenseToolbar({ children }: { children: ReactNode }) {
  return <div className="dense-toolbar">{children}</div>;
}

export function DenseSearch({
  value,
  onChange,
  placeholder,
  inputRef,
  label = "Buscar",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  label?: string;
}) {
  return (
    <label className="dense-search">
      <span className="sr-only">{label}</span>
      <Icon name="search" size={15} />
      <input
        ref={inputRef}
        type="search"
        className="dense-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-keyshortcuts="/"
      />
      <kbd aria-hidden="true">/</kbd>
    </label>
  );
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
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DenseAlert({
  tone = "warn",
  children,
  action,
}: {
  tone?: "warn" | "ok";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`dense-alert dense-alert--${tone}`} role={tone === "warn" ? "status" : undefined}>
      <Icon name={tone === "warn" ? "alert" : "check"} size={17} />
      <span>{children}</span>
      {action ? <span className="dense-alert__action">{action}</span> : null}
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
                      className={column.align === "right" ? "dense-cell--right" : undefined}
                      style={column.width ? { width: column.width } : undefined}
                      aria-sort={
                        direction === 1 ? "ascending" : direction === -1 ? "descending" : undefined
                      }
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          className="dense-sort"
                          onClick={() => toggleSort(column.key)}
                        >
                          {column.header}
                          {direction ? (
                            <span aria-hidden="true">{direction === 1 ? "↑" : "↓"}</span>
                          ) : null}
                        </button>
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
    <span className="dense-shortcuts">
      {items.map(([key, text]) => (
        <span key={key}>
          <kbd>{key}</kbd> {text}
        </span>
      ))}
    </span>
  );
}

/* ───────── Detalle lateral ───────── */

export function Inspector({
  eyebrow,
  title,
  subtitle,
  leading,
  onClose,
  children,
  footer,
  label,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  label: string;
}) {
  return (
    <aside className="dense-inspector" aria-label={label}>
      <header className="dense-inspector__head">
        {leading}
        <div>
          {eyebrow ? <p className="study-page__eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {subtitle ? <p className="dense-inspector__sub">{subtitle}</p> : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className="dense-text-button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            title="Cerrar (Esc)"
          >
            Cerrar
          </button>
        ) : null}
      </header>
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
