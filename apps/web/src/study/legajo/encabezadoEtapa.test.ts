import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/08-operacion-fiscal.css", import.meta.url), "utf8");

function regla(selector: string): string {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("encabezado de etapa del Legajo (Foco 2.8)", () => {
  it("es opaco: fondo con el token de superficie, sin degradado ni transparencias", () => {
    const bloque = regla(".workpaper-process");
    expect(bloque).toMatch(/background:\s*var\(--ds-color-surface\)/);
    expect(bloque).not.toMatch(/transparent|linear-gradient/);
  });

  it("la acción primaria va a la derecha, en la línea de la etapa, antes de la barra", () => {
    expect(regla(".workpaper-process__accion")).toMatch(/justify-items:\s*end/);
    expect(regla(".workpaper-process__nav")).toMatch(/justify-items:\s*end/);
  });

  it("en revisión, Solicitar cambios y Aprobar revisión van en una misma fila (Foco 2.10)", () => {
    expect(regla(".workpaper-process__decision")).toMatch(/display:\s*flex/);
    expect(regla(".workpaper-process__decision")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("las columnas de dos cajones se alinean por arriba", () => {
    expect(regla(".study-form.study-form--alinear-arriba")).toMatch(/align-items:\s*start/);
  });

  it("las filas de la lista de paquetes tienen relleno vertical de tabla densa", () => {
    const bloque = regla(".dense-packs .dense-table tbody td");
    expect(bloque).toMatch(/padding-block:\s*var\(--ds-space-1\)/);
    expect(bloque).toMatch(/height:\s*auto/);
  });
});
