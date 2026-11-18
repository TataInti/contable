import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pagina = readFileSync(new URL("./WorkPage.css", import.meta.url), "utf8");
const barra = readFileSync(new URL("./WorkBar.css", import.meta.url), "utf8");
const densa = readFileSync(new URL("./Dense.css", import.meta.url), "utf8");

/** Cuerpo de la regla con ese selector exacto, sin comentarios. */
function regla(css: string, selector: string): string {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const inicio = limpio.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThanOrEqual(0);
  return limpio.slice(inicio, limpio.indexOf("}", inicio));
}

describe("barra de trabajo (WorkBar): reglas CSS", () => {
  it("es opaca, tiene capa sticky y no se fija con top distinto de 0", () => {
    const bloque = regla(barra, ".work-bar");
    expect(bloque).toMatch(/background-color:\s*var\(--ds-color-surface\)/);
    expect(bloque).not.toMatch(/transparent|gradient|rgba?\(/);
    expect(bloque).toMatch(/z-index:\s*var\(--ds-z-sticky\)/);
    expect(bloque).not.toMatch(/position:\s*sticky/);
    expect(bloque).not.toMatch(/(?:^|[\s;{])top\s*:\s*(?!0\b)/);
  });

  it("compensa la barra de desplazamiento del cuerpo para alinear sus bordes", () => {
    expect(regla(barra, ".work-bar")).toMatch(/var\(--work-page-scrollbar,\s*0px\)/);
  });
});

describe("página de trabajo (WorkPage): reglas CSS", () => {
  it("el cuerpo es el único que se desplaza y el área de estudio deja de hacerlo", () => {
    expect(regla(pagina, ".work-page__body")).toMatch(/overflow:\s*auto/);
    const area = regla(pagina, ".study__content:has(> .work-page)");
    expect(area).toMatch(/overflow:\s*hidden/);
    expect(area).toMatch(/padding:\s*0/);
    expect(regla(pagina, ".work-page")).not.toMatch(/overflow:\s*(?:auto|scroll|hidden)/);
  });

  it("el relleno superior va en el contenido, no en el área que se desplaza", () => {
    expect(regla(pagina, ".work-page__content")).toMatch(/padding-top:\s*var\(--ds-space-4\)/);
    expect(regla(pagina, ".work-page__body")).not.toMatch(/padding-top|padding-block-start/);
  });
});

describe("tablas dentro de WorkPage: sin tope ni desplazamiento propio", () => {
  it("la tabla de Table no tiene tope y no crea contenedor de desplazamiento", () => {
    const bloque = regla(pagina, ".work-page .ds-table__wrapper");
    expect(bloque).toMatch(/max-height:\s*none/);
    expect(bloque).toMatch(/overflow:\s*clip/);
    expect(bloque).not.toMatch(/overflow:\s*(?:auto|scroll|hidden)/);
  });

  it("la tabla de DenseTable tampoco tiene tope ni desplazamiento propio", () => {
    expect(regla(pagina, ".work-page .dense-table-scroll")).toMatch(/max-height:\s*none/);
    expect(regla(pagina, ".work-page .dense-table-scroll")).toMatch(/overflow:\s*visible/);
    expect(regla(pagina, ".work-page .dense-table-card")).toMatch(/overflow:\s*clip/);
  });

  it("el ancho mínimo de la tabla impide que se recorte", () => {
    expect(regla(pagina, ".work-page .ds-table__wrapper")).toMatch(/min-width:\s*min-content/);
    expect(regla(pagina, ".work-page .dense-table-card")).toMatch(/min-width:\s*min-content/);
  });
});

describe("reglas de flujo fuera de WorkPage: sin cambios", () => {
  it("la tabla de las páginas de flujo conserva su tope de 420 px y su desplazamiento", () => {
    const bloque = regla(densa, ".dense-page--flow .ds-table__wrapper");
    expect(bloque).toMatch(/max-height:\s*var\(--dense-flow-max,\s*420px\)/);
    expect(bloque).toMatch(/overflow:\s*auto/);
  });

  it("la regla de flujo del área de estudio sigue igual", () => {
    expect(regla(densa, ".study__content:has(> .dense-page--flow)")).toMatch(/overflow:\s*auto/);
  });
});

describe("barra de trabajo: alturas, margen y cabecera pegada (Barra 2c)", () => {
  const tabla = readFileSync(new URL("./Table.css", import.meta.url), "utf8");

  it("las pestañas de etapa no añaden margen superior: la fila de etapas mide 40 px y la barra 89 px", () => {
    expect(regla(barra, ".work-bar__row--secciones .dense-tabs")).toMatch(
      /margin-top:\s*0(?:px)?\s*;/,
    );
  });

  it("el renglón de contexto deja un margen mínimo de 24 px entre el período y la acción", () => {
    expect(regla(barra, ".work-bar__inicio")).toMatch(/margin-inline-end:\s*var\(--ds-space-6\)/);
  });

  it("la cabecera de la tabla se pega bajo la barra: sus celdas son sticky con top 0", () => {
    const encabezado = regla(tabla, ".ds-table thead th");
    expect(encabezado).toMatch(/position:\s*sticky/);
    expect(encabezado).toMatch(/top:\s*0/);
  });

  it("el cuerpo no tiene relleno superior: la cabecera pegada queda a 0 px de la barra", () => {
    expect(regla(pagina, ".work-page__body")).not.toMatch(/padding-top|padding-block-start/);
  });
});
