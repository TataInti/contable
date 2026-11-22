import { useId, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import "./Field.css";
import "./SearchSelect.css";

export interface SearchSelectOption {
  value: string;
  label: string;
}

export interface SearchSelectGroup {
  label: string;
  options: SearchSelectOption[];
}

export interface SearchSelectProps {
  label: string;
  options?: SearchSelectOption[];
  groups?: SearchSelectGroup[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
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
}: SearchSelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;
  const allOptions = useMemo(() => [...options, ...groups.flatMap((group) => group.options)], [options, groups]);
  const selected = allOptions.find((option) => option.value === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchable = allOptions.length > 7;

  if (!searchable) {
    return (
      <div className="ds-field">
        <label className="ds-field__label" htmlFor={inputId}>{label}</label>
        <select
          id={inputId}
          name={name}
          className={`ds-field__input${className ? ` ${className}` : ""}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required={required}
          aria-label={label}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          {groups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}
        </select>
      </div>
    );
  }

  const filteredGroups = groups.map((group) => ({
    ...group,
    options: group.options.filter((option) => normalize(option.label).includes(normalize(query))),
  })).filter((group) => group.options.length > 0);
  const filteredOptions = options.filter((option) => normalize(option.label).includes(normalize(query)));
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
      setActiveIndex((current) => {
        if (!visibleOptions.length) return -1;
        return event.key === "ArrowDown"
          ? (current + 1) % visibleOptions.length
          : (current <= 0 ? visibleOptions.length - 1 : current - 1);
      });
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const option = visibleOptions[activeIndex];
      if (option) select(option.value);
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
      aria-selected={option.value === value}
      className={`ds-search-select__option${activeIndex === index ? " is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => select(option.value)}
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
      <label className="ds-field__label" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={`ds-field__input${className ? ` ${className}` : ""}`}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        required={required}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQuery(""); setActiveIndex(-1); }}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
      />
      <input type="hidden" name={name} value={value} />
      {open ? (
        <ul id={listboxId} role="listbox" className="ds-search-select__listbox">
          <li role="option" aria-selected={!value} className="ds-search-select__option" onMouseDown={(event) => event.preventDefault()} onClick={() => select("")}>{placeholder}</li>
          {flatOptions}
          {groupedOptions}
          {!visibleOptions.length ? <li className="ds-search-select__empty">No hay opciones que coincidan.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
