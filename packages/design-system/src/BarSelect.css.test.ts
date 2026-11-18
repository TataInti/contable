import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desplegable = readFileSync(new URL("./BarSelect.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const boton = readFileSync(new URL("./Button.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Cuerpo de la regla con ese selector exacto, sin comentarios. */
function regla(css: string, selector: string): string {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("desplegable de barra (BarSelect): reglas CSS", () => {
  it("tiene la superficie y el borde de los botones de la barra, no el gris de campo", () => {
    const bloque = regla(desplegable, ".ds-field__input.ds-bar-select");
    const secundario = regla(boton, ".ds-button--secondary");
    expect(secundario).toMatch(/background-color:\s*var\(--ds-color-surface\)/);
    expect(secundario).toMatch(/border-color:\s*var\(--ds-color-border-strong\)/);
    expect(bloque).toMatch(/background-color:\s*var\(--ds-color-surface\)/);
    expect(bloque).not.toMatch(/color-mix/);
    expect(bloque).toMatch(/border-color:\s*var\(--ds-color-border-strong\)/);
    expect(bloque).toMatch(/box-shadow:\s*var\(--ds-shadow-control\)/);
  });

  it("crece hasta su contenido y se achica hasta un mínimo: sin tope fijo de 320 px", () => {
    const bloque = regla(desplegable, ".ds-field__input.ds-bar-select");
    expect(bloque).not.toMatch(/max-inline-size:\s*320px/);
    expect(bloque).toMatch(/inline-size:\s*auto/);
    expect(bloque).toMatch(/min-inline-size:\s*calc\(var\(--ds-space-16\)/);
  });
});
