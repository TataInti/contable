import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const barra = readFileSync(new URL("./WorkBar.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Cuerpo de la regla con ese selector exacto, sin comentarios. */
function regla(selector: string): string {
  const inicio = barra.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return barra.slice(inicio, barra.indexOf("}", inicio));
}

describe("barra de trabajo (WorkBar): reglas CSS (Barra 2e)", () => {
  it("un botón de texto dentro del aviso no agranda el renglón de avisos: su alto es el de la línea", () => {
    expect(regla(".work-bar__nota .ds-button")).toMatch(/min-block-size:\s*0/);
  });
});
