import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/08-operacion-fiscal.css", import.meta.url), "utf8");
const cssBarra = readFileSync(
  new URL("../../../../../packages/design-system/src/WorkBar.css", import.meta.url),
  "utf8",
);

function regla(selector: string): string {
  const inicio = css.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

function reglaBarra(selector: string): string {
  const inicio = cssBarra.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector} en WorkBar.css`).toBeGreaterThanOrEqual(0);
  return cssBarra.slice(inicio, cssBarra.indexOf("}", inicio));
}

describe("encabezado de etapa del Legajo (Foco 2.8)", () => {
  it("es opaco: fondo con el token de superficie, sin degradado ni transparencias", () => {
    // vigente: cambia con A29 (la barra de trabajo reemplaza el encabezado de etapa; la regla es la de WorkBar.css)
    const bloque = reglaBarra(".work-bar");
    expect(bloque).toMatch(/background(-color)?:\s*var\(--ds-color-surface\)/);
    expect(bloque).not.toMatch(/transparent|linear-gradient/);
  });

  it("la acción primaria va a la derecha, en la línea de la etapa, antes de la barra", () => {
    // vigente: cambia con A29 (la acción queda a la derecha del renglón de contexto, dentro de la barra)
    expect(reglaBarra(".work-bar__fin")).toMatch(/margin-inline-start:\s*auto/);
    expect(reglaBarra(".work-bar__fin")).toMatch(/display:\s*flex/);
  });

  it("en revisión, Solicitar cambios y Aprobar revisión van en una misma fila (Foco 2.10)", () => {
    // vigente: cambia con A29 (Solicitar cambios y Aprobar revisión comparten el grupo de acciones de la barra)
    expect(reglaBarra(".work-bar__fin")).toMatch(/display:\s*flex/);
    expect(reglaBarra(".work-bar__fin")).toMatch(/gap:/);
  });

  it("las columnas de dos cajones se alinean por arriba", () => {
    expect(regla(".study-form.study-form--alinear-arriba")).toMatch(/align-items:\s*start/);
  });

  it("las filas de la lista de paquetes tienen relleno vertical de tabla densa", () => {
    const bloque = regla(".dense-packs .dense-table tbody td");
    expect(bloque).toMatch(/padding-block:\s*var\(--ds-space-1\)/);
    expect(bloque).toMatch(/height:\s*auto/);
  });

  it("la regla .workpaper-process ya no existe en la hoja del Legajo (Barra 2a)", () => {
    // vigente: cambia con A29 (la tarjeta y su regla se retiran; la barra no usa .workpaper-process)
    expect(css).not.toContain(".workpaper-process");
    expect(css).not.toContain(".workpaper-card");
  });

  it("ningún elemento del Legajo queda sticky dentro del cuerpo, salvo el encabezado de las tablas (Barra 2a)", () => {
    const selectores = [...css.matchAll(/([^{}]+)\{[^{}]*position:\s*sticky[^{}]*\}/g)]
      .map((m) => m[1]!.trim())
      .filter((s) => /workpaper|work-/.test(s));
    for (const selector of selectores) {
      expect(selector, `sticky fuera de un encabezado de tabla: ${selector}`).toMatch(/thead/);
    }
  });
});
