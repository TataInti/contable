import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./ActionDrawer.css", import.meta.url), "utf8");

function regla(selector: string): string {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("pie de cajón en una línea (Foco 2.8)", () => {
  it("«Cancelar» y la acción principal comparten un mismo renglón", () => {
    expect(regla(".action-drawer__actions")).toMatch(/display:\s*grid/);
    expect(regla(".action-drawer__actions")).toMatch(/grid-template-columns:\s*auto auto/);
  });

  it("el motivo ocupa su propio renglón arriba, a todo el ancho", () => {
    expect(regla(".action-drawer__hint")).toMatch(/grid-row:\s*1/);
    expect(regla(".action-drawer__hint")).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it("el grupo de la acción principal no abre renglón propio", () => {
    expect(regla(".action-drawer__primary")).toMatch(/display:\s*contents/);
  });
});
