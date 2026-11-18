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
const campo = readFileSync(new URL("./Field.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Selector del desplegable en lectura nativa: un <select> cumple :read-only (Barra 2d). */
const LECTURA = ".ds-field__input.ds-bar-select:read-only:not(:disabled)";

/** Cuerpo de la regla con ese selector exacto, sin comentarios. */
function regla(css: string, selector: string): string {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

/** Especificidad simplificada (clases y pseudoclases): basta para comparar estos selectores. */
function especificidad(selector: string): number {
  return (selector.match(/\.[\w-]+|:[\w-]+(\([^)]*\))?/g) ?? []).length;
}

/** Token de la propiedad background-color de un bloque de reglas. */
function tokenDeFondo(bloque: string): string | undefined {
  return bloque.match(/background-color:\s*(var\([^)]*\))/)?.[1];
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

  it("en lectura nativa (select:read-only) usa el mismo token de fondo que el botón secundario", () => {
    const lectura = regla(desplegable, LECTURA);
    const secundario = regla(boton, ".ds-button--secondary");
    expect(tokenDeFondo(lectura)).toBe("var(--ds-color-surface)");
    expect(tokenDeFondo(lectura)).toBe(tokenDeFondo(secundario));
    expect(lectura).toMatch(/box-shadow:\s*var\(--ds-shadow-control\)/);
    expect(lectura).toMatch(/cursor:\s*pointer/);
  });

  it("su regla de lectura gana a la de campo de solo lectura de Field.css", () => {
    const grisDeCampo = regla(campo, ".ds-field__input:read-only:not(:disabled)");
    expect(tokenDeFondo(grisDeCampo)).toBe("var(--ds-color-surface-muted)");
    regla(desplegable, LECTURA);
    expect(especificidad(LECTURA)).toBeGreaterThan(
      especificidad(".ds-field__input:read-only:not(:disabled)"),
    );
  });
});
