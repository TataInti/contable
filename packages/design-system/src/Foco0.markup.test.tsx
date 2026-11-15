// @vitest-environment jsdom
/*
 * Prueba mecánica de cero cambio (Foco 0): sin las props nuevas, cada pieza produce
 * exactamente el marcado que produce origin/main (5b61719). Las cadenas BASELINE se
 * grabaron en esa base antes de tocar el código; no se editan a mano.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FOCO0_CASES } from "./Foco0.fixtures.js";

const BASELINE: Record<string, string> = {
  "dense-section": "<section id=\"pendientes\" class=\"dense-block\" aria-labelledby=\"pendientes-title\"><header class=\"dense-block__head\"><h2 id=\"pendientes-title\">Pendientes<span class=\"dense-count\">2</span></h2><p>Para revisar</p><div class=\"dense-block__actions\"><button type=\"button\" class=\"ds-button ds-button--secondary ds-button--row\"><span class=\"ds-button__content\">Exportar</span></button></div></header><div class=\"dense-block__body\"><p>Contenido de la sección</p></div></section>",
  "dense-table-plana": "<div class=\"dense-table-card\"><div class=\"dense-table-scroll\"><table class=\"dense-table\" aria-label=\"Acuses pendientes\"><thead><tr><th class=\"\"><button type=\"button\" class=\"ds-button ds-button--text ds-button--row dense-sort\"><span class=\"ds-button__content\">Nombre</span></button></th><th class=\"dense-cell--right\"><button type=\"button\" class=\"ds-button ds-button--text ds-button--row dense-sort\"><span class=\"ds-button__content\">Cantidad</span></button></th><th class=\"\">Estado</th></tr></thead><tbody><tr data-row-key=\"c-1\" class=\"\"><td class=\"\">Cliente sintético A</td><td class=\"dense-cell--right\">2</td><td class=\"\">ACTIVE</td></tr><tr data-row-key=\"c-2\" class=\"\"><td class=\"\">Cliente sintético B</td><td class=\"dense-cell--right\">0</td><td class=\"\">INACTIVE</td></tr></tbody></table></div><div class=\"dense-table-foot\"><span>2 acuses</span><span class=\"dense-table-foot__spacer\"></span><details class=\"dense-shortcuts\"><summary aria-label=\"Atajos de teclado\" title=\"Atajos de teclado\">?</summary><span class=\"dense-shortcuts__panel\" role=\"note\"><span><kbd>/</kbd> buscar</span><span><kbd>Esc</kbd> cerrar</span></span></details></div></div>",
  "dense-table-agrupada-seleccion": "<div class=\"dense-table-card\"><div class=\"dense-table-scroll\"><table class=\"dense-table\" aria-label=\"Cartera de clientes\"><thead><tr><th class=\"\"><button type=\"button\" class=\"ds-button ds-button--text ds-button--row dense-sort\"><span class=\"ds-button__content\">Nombre</span></button></th><th class=\"dense-cell--right\"><button type=\"button\" class=\"ds-button ds-button--text ds-button--row dense-sort\"><span class=\"ds-button__content\">Cantidad</span></button></th></tr></thead><tbody><tr class=\"dense-group-row\"><th scope=\"rowgroup\" colspan=\"2\">Activos <span class=\"dense-count\">1</span></th></tr><tr data-row-key=\"c-1\" tabindex=\"0\" aria-current=\"true\" class=\"dense-row--selectable dense-row--selected\"><td class=\"\">Cliente sintético A</td><td class=\"dense-cell--right\">2</td></tr><tr class=\"dense-group-row\"><th scope=\"rowgroup\" colspan=\"2\">Inactivos <span class=\"dense-count\">1</span></th></tr><tr data-row-key=\"c-2\" tabindex=\"0\" class=\"dense-row--selectable dense-row--muted\"><td class=\"\">Cliente sintético B</td><td class=\"dense-cell--right\">0</td></tr></tbody></table></div><div class=\"dense-table-foot\"><span>2 clientes</span><span>Elegí una fila para ver la ficha</span><span class=\"dense-table-foot__spacer\"></span><details class=\"dense-shortcuts\"><summary aria-label=\"Atajos de teclado\" title=\"Atajos de teclado\">?</summary><span class=\"dense-shortcuts__panel\" role=\"note\"><span><kbd>/</kbd> buscar</span><span><kbd>N</kbd> nuevo</span><span><kbd>Esc</kbd> cerrar</span></span></details></div></div>",
  "dense-table-vacia": "<div class=\"dense-table-card\"><div class=\"dense-table-scroll\"><div class=\"ds-empty ds-empty--compact\" data-empty-kind=\"no-data\"><span class=\"ds-empty__visual\" aria-hidden=\"true\"></span><h3 class=\"ds-empty__title\">Sin módulos configurados</h3></div></div></div>",
  "stat-strip": "<div class=\"dense-stats\" role=\"group\" aria-label=\"Vistas de la bandeja\"><button type=\"button\" class=\"ds-button ds-button--text ds-button--row dense-stat dense-stat--active\"><span class=\"ds-button__content\"><span class=\"dense-stat__label\">Pendientes</span><span class=\"dense-stat__value\">3</span></span></button><div class=\"dense-stat dense-stat--warn\"><span class=\"dense-stat__label\">Vencidos</span><span class=\"dense-stat__value\">5</span><span class=\"dense-stat__detail\">esta semana</span></div><div class=\"dense-stat\"><span class=\"dense-stat__label\">Ítems</span><span class=\"dense-stat__value\">…</span></div></div>",
  "dense-workspace-inspector": "<div id=\"clients-panel\" role=\"tabpanel\" class=\"dense-work dense-work--inspector\"><div class=\"dense-work__main\"><p>Tabla de clientes</p></div><aside class=\"dense-inspector\" aria-label=\"Detalle del cliente\"><header class=\"dense-inspector__head\"><div><h2>Cliente sintético A</h2></div></header><div class=\"dense-inspector__body\">Ficha</div></aside></div>",
  "dense-workspace-sin-inspector": "<div id=\"platform-modules-panel\" role=\"tabpanel\" class=\"dense-work\"><div class=\"dense-work__main\"><p>Módulos</p></div></div>",
  "empty-compact-accion": "<div class=\"ds-empty ds-empty--compact\" data-empty-kind=\"no-data\"><span class=\"ds-empty__visual\" aria-hidden=\"true\"></span><h3 class=\"ds-empty__title\">Sin regímenes adheridos</h3><p class=\"ds-empty__description\">Registrá el régimen fiscal que aplica al contribuyente.</p><div class=\"ds-empty__action\"><button type=\"button\" class=\"ds-button ds-button--secondary ds-button--sm\"><span class=\"ds-button__content\">Registrar inscripción</span></button></div></div>",
  "empty-regular-sin-coincidencias": "<div class=\"ds-empty ds-empty--regular\" data-empty-kind=\"no-results\"><span class=\"ds-empty__visual\" aria-hidden=\"true\"></span><h3 class=\"ds-empty__title\">Ningún cliente coincide</h3><p class=\"ds-empty__description\">Ajustá la búsqueda.</p></div>",
  "empty-por-defecto": "<div class=\"ds-empty ds-empty--regular\" data-empty-kind=\"no-data\"><span class=\"ds-empty__visual\" aria-hidden=\"true\"></span><h3 class=\"ds-empty__title\">Todavía no hay clientes</h3></div>"
};

afterEach(() => cleanup());

describe("Foco 0 - marcado identico sin las props nuevas", () => {
  it("cubre exactamente los casos grabados en origin/main", () => {
    expect(Object.keys(FOCO0_CASES).sort()).toEqual(Object.keys(BASELINE).sort());
  });

  for (const name of Object.keys(BASELINE)) {
    it(`${name} conserva clases y atributos de origin/main`, () => {
      const make = FOCO0_CASES[name];
      if (!make) throw new Error(`caso inexistente: ${name}`);
      const { container } = render(make());
      expect(container.innerHTML).toBe(BASELINE[name]);
    });
  }
});
