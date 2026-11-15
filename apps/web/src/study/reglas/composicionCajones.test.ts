import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/08-operacion-fiscal.css", import.meta.url), "utf8");

function regla(selector: string): string {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("composición de los cajones de Reglas (Foco 2.10)", () => {
  it("cada ayuda va pegada a su campo: su columna es un bloque propio que no se estira", () => {
    expect(regla(".study-form__campo")).toMatch(/display:\s*grid/);
    expect(regla(".study-form__campo")).toMatch(/align-content:\s*start/);
    expect(regla(".study-form.study-form--alinear-arriba")).toMatch(/align-items:\s*start/);
  });

  it("la línea de consecuencia del motor se lee con el color de texto, no con el de ayuda", () => {
    const bloque = regla(".form-submit-hint.selector-motor-consecuencia");
    expect(bloque).toMatch(/color:\s*var\(--ds-color-text\)/);
    expect(bloque).not.toMatch(/text-muted/);
  });
});
