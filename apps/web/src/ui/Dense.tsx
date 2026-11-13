import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "@contable/design-system";
import { Icon } from "./Icon";
import "@contable/design-system/Dense.css";

export type { DenseDensity, DenseColumn, StatItem } from "@contable/design-system";
export {
  DenseFooter,
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseSection,
  DenseTable,
  DenseToolbar,
  DenseWorkspace,
  DensitySwitch,
  Inspector,
  InspectorFacts,
  InspectorSection,
  ShortcutHint,
  StatStrip,
  normalizeSearch,
  useDenseShortcuts,
  useDensity,
} from "@contable/design-system";

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
        <Button
          key={tab.id}
          id={`${idPrefix}-${tab.id}`}
          type="button"
          variant="text"
          size="row"
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
        </Button>
      ))}
    </div>
  );
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

export function DenseAlert({
  tone = "warn",
  children,
  action,
}: {
  tone?: "warn" | "hint";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`dense-alert dense-alert--${tone}`} role={tone === "warn" ? "status" : undefined}>
      <Icon name={tone === "warn" ? "alert" : "arrow-right"} size={17} />
      <span>{children}</span>
      {action ? <span className="dense-alert__action">{action}</span> : null}
    </div>
  );
}
