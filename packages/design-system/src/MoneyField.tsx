import { useRef, useState, useEffect } from "react";
import { Field, type FieldProps } from "./Field.js";

export interface MoneyFieldProps extends Omit<FieldProps, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** Decimales admitidos. 2 para importes; una alícuota puede necesitar más. */
  maxDecimals?: number;
}

const DEFAULT_MAX_DECIMALS = 2;

const INTEGER = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
});

/**
 * Formatea un valor normalizado (ej. "1234567.89") a su representación
 * visible es-AR (ej. "1.234.567,89"). El punto es el separador de miles
 * (puramente visual) y la coma el separador decimal.
 */
function formatValue(value: string, maxDecimals: number): string {
  if (!value) return "";
  const [intPart, fracPart] = value.split(".");
  const formattedInt = INTEGER.format(Number(intPart || "0"));
  if (fracPart !== undefined) {
    return `${formattedInt},${fracPart.slice(0, maxDecimals)}`;
  }
  return formattedInt;
}

/**
 * Formatea el texto que el usuario está escribiendo en el input.
 * - El separador de miles (punto) se inserta en la parte entera pero es solo
 *   visual: no forma parte del valor.
 * - El separador decimal es la coma, o el punto que el usuario escribió
 *   explícitamente (detectado como el último punto con a lo sumo `maxDecimals`
 *   dígitos después).
 */
function formatInput(raw: string, maxDecimals: number): string {
  const hasComma = raw.includes(",");
  let intText = "";
  let fracText: string | null = null;

  if (hasComma) {
    const [int, ...frac] = raw.split(",");
    intText = int ?? "";
    fracText = frac.join("");
  } else {
    const lastDot = raw.lastIndexOf(".");
    if (lastDot !== -1) {
      const afterDigits = raw.slice(lastDot + 1).replace(/[^\d]/g, "");
      if (afterDigits.length <= maxDecimals) {
        intText = raw.slice(0, lastDot);
        fracText = afterDigits;
      } else {
        intText = raw;
      }
    } else {
      intText = raw;
    }
  }

  const intDigits = intText.replace(/[^\d]/g, "");
  const formattedInt = intDigits ? INTEGER.format(Number(intDigits)) : "";

  if (fracText !== null) {
    return `${formattedInt},${fracText.slice(0, maxDecimals)}`;
  }
  return formattedInt;
}

/**
 * Convierte el texto visible del input a un valor normalizado para la API.
 * - El separador de miles (punto) se descarta (es solo visual).
 * - El separador decimal es la coma, o el punto que el usuario escribió
 *   explícitamente (a lo sumo `maxDecimals` dígitos después).
 * - Se limitan a `maxDecimals` decimales.
 */
function parseInput(raw: string, maxDecimals: number): string {
  const hasComma = raw.includes(",");
  let intText = "";
  let fracText: string | null = null;

  if (hasComma) {
    const [int, ...frac] = raw.split(",");
    intText = int ?? "";
    fracText = frac.join("");
  } else {
    const lastDot = raw.lastIndexOf(".");
    if (lastDot !== -1) {
      const afterDigits = raw.slice(lastDot + 1).replace(/[^\d]/g, "");
      if (afterDigits.length <= maxDecimals) {
        intText = raw.slice(0, lastDot);
        fracText = afterDigits;
      } else {
        intText = raw;
      }
    } else {
      intText = raw;
    }
  }

  const intDigits = intText.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  if (fracText !== null) {
    if (fracText === "") return intDigits || "0";
    return `${intDigits || "0"}.${fracText.slice(0, maxDecimals)}`;
  }
  return intDigits;
}

/**
 * Mapea la posición del cursor desde el texto previo al nuevo display,
 * ignorando los separadores de miles (puntos) que son solo visuales.
 */
function mapCursor(before: string, after: string, cursor: number): number {
  const beforeSig = before.slice(0, cursor).replace(/\./g, "").length;
  let sig = 0;
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== ".") sig++;
    if (sig === beforeSig) return i + 1;
  }
  return after.length;
}

function isDecimalSeparator(key: string): boolean {
  return key === "," || key === ".";
}

/**
 * Campo numérico en formato es-AR. Por defecto muestra el símbolo de pesos;
 * `prefix` permite otra unidad (por ejemplo "%" para una alícuota) sin perder
 * el formato ni la normalización del valor.
 */
export function MoneyField({
  value,
  onChange,
  prefix = "$",
  maxDecimals = DEFAULT_MAX_DECIMALS,
  ...rest
}: MoneyFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSentRef = useRef<string>(value);
  const [display, setDisplay] = useState(() => formatValue(value, maxDecimals));

  useEffect(() => {
    if (value !== lastSentRef.current) {
      setDisplay(formatValue(value, maxDecimals));
      lastSentRef.current = value;
    }
  }, [value, maxDecimals]);

  return (
    <Field
      {...rest}
      ref={inputRef}
      prefix={prefix}
      type="text"
      inputMode="decimal"
      value={display}
      onKeyDown={(event) => {
        if (isDecimalSeparator(event.key) && display.includes(",")) {
          event.preventDefault();
          return;
        }
        rest.onKeyDown?.(event);
      }}
      onChange={(event) => {
        const el = inputRef.current;
        const before = event.target.value;
        const selectionStart = el?.selectionStart ?? null;
        const selectionEnd = el?.selectionEnd ?? null;

        const normalized = parseInput(before, maxDecimals);
        const nextDisplay = formatInput(before, maxDecimals);
        setDisplay(nextDisplay);
        lastSentRef.current = normalized;
        onChange(normalized);

        requestAnimationFrame(() => {
          if (!el) return;
          if (selectionStart !== null && selectionEnd !== null) {
            const nextPos = mapCursor(before, nextDisplay, selectionStart);
            el.setSelectionRange(nextPos, nextPos);
          }
        });
      }}
    />
  );
}
