import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Piezas nuevas de DS-0 (C10–C16): CSS propio y TSX. Cada una se lista aquí para que la prueba la vigile. */
const PIEZAS = [
  "ObjectPanel",
  "ObjectActivity",
  "WorkQueue",
  "MonthSummary",
  "DocumentTriage",
  "ObjectPage",
  "StepFlow",
] as const;

const srcDir = new URL(".", import.meta.url);
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const tokensDefinidos = new Set(
  [...tokens.matchAll(/^\s*(--ds-[\w-]+)\s*:/gm)].map((match) => match[1]),
);

function leer(nombre: string): string {
  return readFileSync(new URL(nombre, srcDir), "utf8");
}

function sinComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("contrato de las piezas DS-0", () => {
  for (const pieza of PIEZAS) {
    it(`${pieza}: su CSS usa solo tokens --ds-* que existen en tokens.css`, () => {
      const css = sinComentarios(leer(`${pieza}.css`));
      const usados = [...css.matchAll(/var\((--ds-[\w-]+)/g)].map((match) => match[1] ?? "");
      expect(usados.length).toBeGreaterThan(0);
      const inexistentes = usados.filter((token) => !tokensDefinidos.has(token));
      expect(inexistentes, `tokens inexistentes en ${pieza}.css`).toEqual([]);
    });

    it(`${pieza}: el CSS no fija colores ni fuentes en valores sueltos`, () => {
      const css = sinComentarios(leer(`${pieza}.css`));
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\brgba?\(/);
      expect(css).not.toMatch(/font-size:\s*\d/);
    });

    it(`${pieza}: el TSX no tiene <select> nativo ni estilos en línea`, () => {
      const tsx = leer(`${pieza}.tsx`);
      expect(tsx).not.toMatch(/<select[\s>]/);
      expect(tsx).not.toMatch(/style=\{\{/);
    });
  }

  it("cada pieza exporta desde index.ts", () => {
    const indice = leer("index.ts");
    for (const pieza of PIEZAS) {
      expect(indice, `${pieza} no está en index.ts`).toContain(`./${pieza}.js`);
    }
  });

  it("todas las piezas nuevas tienen su prueba", () => {
    const archivos = new Set(readdirSync(srcDir));
    for (const pieza of PIEZAS) {
      expect(archivos.has(`${pieza}.test.tsx`), `falta ${pieza}.test.tsx`).toBe(true);
    }
  });
});
