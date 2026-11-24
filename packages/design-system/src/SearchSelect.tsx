import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import "./Field.css";
import "./SearchSelect.css";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** La opción se ve pero no se puede elegir (por ejemplo, un registro oculto). */
  disabled?: boolean;
}

export interface SearchSelectGroup {
  label: string;
  options: SearchSelectOption[];
}

export interface SearchSelectProps {
  label: string;
  options?: readonly SearchSelectOption[];
  groups?: readonly SearchSelectGroup[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  /** false: el valor siempre es una opción y la lista no ofrece «vacío». Por defecto, sí. */
  allowEmpty?: boolean;
  /** Oculta el rótulo visible; el combobox conserva la etiqueta accesible (filtros de barra). */
  hideLabel?: boolean;
  /** Campo con error: se marca el control y se enlaza con su mensaje. */
  invalid?: boolean;
  describedBy?: string;
  onBlur?: () => void;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

/**
 * La lista se dibuja en el documento (portal) con posición fija calculada desde el campo: así no la recorta
 * ningún contenedor con scroll (tablas, cajones, paneles). Alturas en px, igual que el máximo de 16 rem del CSS.
 */
const LISTBOX_MAX_HEIGHT = 256;
const LISTBOX_MIN_HEIGHT = 96;
/** Con menos espacio debajo del campo que esto, la lista abre hacia arriba (si arriba hay más lugar). */
const LISTBOX_MIN_BELOW = 160;
const LISTBOX_GAP = 4;
const VIEWPORT_MARGIN = 8;

interface ListboxPlacement {
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

function placementFor(field: DOMRect): ListboxPlacement {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const below = viewportHeight - field.bottom - LISTBOX_GAP - VIEWPORT_MARGIN;
  const above = field.top - LISTBOX_GAP - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, field.left);
  const width = { minWidth: field.width, maxWidth: Math.max(field.width, viewportWidth - left - VIEWPORT_MARGIN) };
  if (below < Math.min(LISTBOX_MAX_HEIGHT, LISTBOX_MIN_BELOW) && above > below) {
    return { left, ...width, bottom: viewportHeight - field.top + LISTBOX_GAP, maxHeight: Math.min(LISTBOX_MAX_HEIGHT, Math.max(above, LISTBOX_MIN_HEIGHT)) };
  }
  return { left, ...width, top: field.bottom + LISTBOX_GAP, maxHeight: Math.min(LISTBOX_MAX_HEIGHT, Math.max(below, LISTBOX_MIN_HEIGHT)) };
}

export function SearchSelect({
  label,
  options = [],
  groups = [],
  value,
  onChange,
  id,
  name,
  placeholder = "Elegí…",
  className,
  disabled,
  required,
  allowEmpty = true,
  hideLabel,
  invalid,
  describedBy,
  onBlur,
}: SearchSelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;
  const allOptions = useMemo(() => [...options, ...groups.flatMap((group) => group.options)], [options, groups]);
  const selected = allOptions.find((option) => option.value === value);
  const historicalOption: SearchSelectOption | null = value && !selected
    ? { value, label: `${value} — valor histórico (conservado)` }
    : null;
  const availableOptions: readonly SearchSelectOption[] = historicalOption ? [...options, historicalOption] : options;
  const selectedLabel = selected?.label ?? historicalOption?.label;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<ListboxPlacement | null>(null);

  // Mientras la lista está abierta se ubica sobre el campo, y se vuelve a ubicar con scroll (de cualquier ancestro) o cambio de tamaño.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const update = () => {
      const field = inputRef.current;
      if (field) setPlacement(placementFor(field.getBoundingClientRect()));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // La validez sigue al valor elegido, no al texto del buscador: mientras el desplegable está
  // abierto el campo muestra la búsqueda (vacía al enfocar) y no debe bloquear el envío.
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? "Elegí una opción." : "");
  }, [required, value]);

  const filteredGroups = groups.map((group) => ({
    ...group,
    options: group.options.filter((option) => normalize(option.label).includes(normalize(query))),
  })).filter((group) => group.options.length > 0);
  const filteredOptions = availableOptions.filter((option) => normalize(option.label).includes(normalize(query)));
  const visibleOptions = [...filteredOptions, ...filteredGroups.flatMap((group) => group.options)];
  const select = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  };
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setOpen(true);
    setActiveIndex(-1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const count = visibleOptions.length;
        if (!count) return -1;
        // Recorre en círculo y saltea las opciones deshabilitadas.
        let index = current < 0 ? (step > 0 ? -1 : count) : current;
        for (let attempt = 0; attempt < count; attempt += 1) {
          index = (index + step + count) % count;
          if (!visibleOptions[index]?.disabled) return index;
        }
        return -1;
      });
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const option = visibleOptions[activeIndex];
      if (option && !option.disabled) select(option.value);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
  };
  const renderOption = (option: SearchSelectOption, index: number) => (
    <li
      id={`${listboxId}-option-${index}`}
      key={option.value}
      role="option"
      data-value={option.value}
      aria-selected={option.value === value}
      aria-disabled={option.disabled || undefined}
      className={`ds-search-select__option${option.disabled ? " is-disabled" : ""}${activeIndex === index ? " is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!option.disabled) select(option.value);
      }}
    >{option.label}</li>
  );
  let optionIndex = 0;
  const flatOptions = filteredOptions.map((option) => renderOption(option, optionIndex++));
  const groupedOptions = filteredGroups.map((group) => {
    const children = group.options.map((option) => renderOption(option, optionIndex++));
    return <li role="group" aria-label={group.label} key={group.label}><div className="ds-search-select__group-label">{group.label}</div><ul>{children}</ul></li>;
  });

  return (
    <div className="ds-field ds-search-select">
      {hideLabel ? null : <label className="ds-field__label" htmlFor={inputId}>{label}</label>}
      <input
        ref={inputRef}
        id={inputId}
        className={`ds-field__input${invalid ? " ds-field__input--error" : ""}${className ? ` ${className}` : ""}`}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        value={open ? query : selectedLabel ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQuery(""); setActiveIndex(-1); onBlur?.(); }}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
      />
      <input type="hidden" name={name} value={value} />
      {/* Un clic dentro de la lista (también en su barra de desplazamiento) no quita el foco del campo. */}
      {open && placement ? createPortal(
        <ul
          id={listboxId}
          role="listbox"
          className="ds-search-select__listbox"
          style={{ position: "fixed", ...placement }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {allowEmpty ? <li role="option" data-value="" aria-selected={!value} className="ds-search-select__option" onMouseDown={(event) => event.preventDefault()} onClick={() => select("")}>{placeholder}</li> : null}
          {flatOptions}
          {groupedOptions}
          {!visibleOptions.length ? <li className="ds-search-select__empty">No hay opciones que coincidan.</li> : null}
        </ul>,
        document.body,
      ) : null}
    </div>
  );
}
