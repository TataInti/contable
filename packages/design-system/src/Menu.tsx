import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./Button.js";
import { Icon, type IconName } from "./Icon.js";
import "./Menu.css";

export interface MenuActionItem {
  key: string;
  label: string;
  /** Una línea que explica qué hace la acción. */
  description?: string;
  icon?: IconName;
  disabled?: boolean;
  /** Motivo visible si la acción está deshabilitada (P4). Reemplaza la descripción. */
  disabledReason?: string;
  onSelect: () => void;
}

export interface MenuSelectOption {
  key: string;
  label: string;
  /** Estado de la opción, por ejemplo un StatusBadge. */
  status?: ReactNode;
  /** Texto secundario de una línea. */
  secondary?: string;
  disabled?: boolean;
  /** Motivo visible si la opción está deshabilitada (P4). Reemplaza el texto secundario. */
  disabledReason?: string;
}

interface MenuBaseProps {
  /** Nombre accesible de la lista. */
  label: string;
  /** Contenido visible del botón que abre el menú. */
  trigger: ReactNode;
  /** Lado del botón al que se alinea el panel. */
  align?: "start" | "end";
  className?: string;
}

export type MenuProps =
  | (MenuBaseProps & { kind: "actions"; items: MenuActionItem[] })
  | (MenuBaseProps & {
      kind: "select";
      options: MenuSelectOption[];
      /** Clave de la opción elegida; null si no hay ninguna. */
      value: string | null;
      onChange: (key: string) => void;
    });

type FocusOnOpen = "first" | "last" | "selected";

/** Ítems del menú, en orden. Los deshabilitados siguen enfocables para que se lea su motivo. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(
    menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [],
  );
}

/**
 * Menú desplegable (P5). Dos usos: lista de acciones (`kind="actions"`) y lista de selección única
 * (`kind="select"`). Patrón de menú: el botón abre con clic, Enter, Espacio o flecha abajo (la
 * flecha arriba abre en el último); las flechas recorren con vuelta; Inicio y Fin van al primero
 * y al último; Escape cierra y devuelve el foco al botón; Tab y el clic afuera cierran.
 */
export function Menu(props: MenuProps) {
  const { label, trigger, align = "start", className } = props;
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<FocusOnOpen | null>(null);
  const defaultFocus: FocusOnOpen = props.kind === "select" ? "selected" : "first";
  const selectedKey = props.kind === "select" ? props.value : null;
  const onChange = props.kind === "select" ? props.onChange : undefined;

  // Foco inicial al abrir: el primer ítem, el último (flecha arriba) o la opción elegida.
  useEffect(() => {
    if (!open || focusOnOpen.current === null) return;
    const target = focusOnOpen.current;
    focusOnOpen.current = null;
    const items = menuItems(panelRef.current);
    const element =
      target === "last"
        ? items[items.length - 1]
        : target === "selected"
          ? (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])
          : items[0];
    element?.focus();
  }, [open]);

  // Clic afuera: cierra sin mover el foco.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function openMenu(target: FocusOnOpen) {
    focusOnOpen.current = target;
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  /** Ejecuta la elección: cierra el menú, devuelve el foco al botón y luego actúa. */
  function choose(action: () => void) {
    closeMenu(true);
    action();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = menuItems(panelRef.current);
      if (open && items.length > 0) {
        (event.key === "ArrowDown" ? items[0] : items[items.length - 1])?.focus();
      } else {
        openMenu(event.key === "ArrowDown" ? "first" : "last");
      }
    } else if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (open && event.key === "Tab") {
      closeMenu(false);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems(panelRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(current + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[current <= 0 ? items.length - 1 : current - 1]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      case "Tab":
        closeMenu(false);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className={className ? `ds-menu ${className}` : "ds-menu"}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="row"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu(true) : openMenu(defaultFocus))}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
        <Icon name="chevron" size={14} className="ds-menu__flecha" />
      </Button>
      {open ? (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={align === "end" ? "ds-menu__panel ds-menu__panel--end" : "ds-menu__panel"}
          onKeyDown={onMenuKeyDown}
        >
          {props.kind === "actions"
            ? props.items.map((item) => {
                const blocked = item.disabled === true;
                const reasonId = `${menuId}-motivo-${item.key}`;
                const detail =
                  blocked && item.disabledReason ? item.disabledReason : item.description;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="ds-menu__item"
                    aria-disabled={blocked || undefined}
                    aria-describedby={blocked && item.disabledReason ? reasonId : undefined}
                    onClick={() => {
                      if (!blocked) choose(item.onSelect);
                    }}
                  >
                    <span className="ds-menu__icono" aria-hidden="true">
                      {item.icon ? <Icon name={item.icon} size={16} /> : null}
                    </span>
                    <span className="ds-menu__texto">
                      <span className="ds-menu__rotulo">{item.label}</span>
                      {detail ? (
                        <span
                          className="ds-menu__detalle"
                          id={blocked && item.disabledReason ? reasonId : undefined}
                        >
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            : props.options.map((option) => {
                const blocked = option.disabled === true;
                const checked = option.key === selectedKey;
                const reasonId = `${menuId}-motivo-${option.key}`;
                const detail =
                  blocked && option.disabledReason ? option.disabledReason : option.secondary;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    tabIndex={-1}
                    className="ds-menu__item ds-menu__item--opcion"
                    aria-disabled={blocked || undefined}
                    aria-describedby={blocked && option.disabledReason ? reasonId : undefined}
                    onClick={() => {
                      if (!blocked) choose(() => onChange?.(option.key));
                    }}
                  >
                    <span className="ds-menu__icono" aria-hidden="true">
                      {checked ? <Icon name="check" size={16} /> : null}
                    </span>
                    <span className="ds-menu__texto">
                      <span className="ds-menu__linea">
                        <span className="ds-menu__rotulo">{option.label}</span>
                        {option.status ? (
                          <span className="ds-menu__estado">{option.status}</span>
                        ) : null}
                      </span>
                      {detail ? (
                        <span
                          className="ds-menu__detalle"
                          id={blocked && option.disabledReason ? reasonId : undefined}
                        >
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
        </div>
      ) : null}
    </div>
  );
}
