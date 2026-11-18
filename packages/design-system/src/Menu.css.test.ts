import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const menu = readFileSync(new URL("./Menu.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Cuerpo de la regla con ese selector exacto, sin comentarios. */
function regla(selector: string): string {
  const inicio = menu.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return menu.slice(inicio, menu.indexOf("}", inicio));
}

describe("menú (Menu): reglas CSS", () => {
  it("la flecha del disparador apunta hacia abajo: el ícono chevron se gira 90°", () => {
    expect(regla(".ds-menu__flecha")).toMatch(/transform:\s*rotate\(90deg\)/);
  });
});

describe("menú (Menu): disparador con su menú abierto (Barra 2e)", () => {
  it("el disparador abierto lleva el borde del color de foco, como los demás controles", () => {
    expect(regla('.ds-menu > .ds-button[aria-expanded="true"]:not(:disabled)')).toMatch(
      /border-color:\s*var\(--ds-color-focus\)/,
    );
  });
});
