// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { TableCellStack } from "./Table.js";
import { afterEach, describe, expect, it } from "vitest";
import { DenseSection } from "./Dense.js";

afterEach(() => cleanup());

describe("DenseSection surface (Foco 0)", () => {
  it("sin la prop conserva exactamente la clase heredada", () => {
    const { container } = render(
      <DenseSection id="pendientes" title="Pendientes">
        <p>Contenido</p>
      </DenseSection>,
    );
    expect(container.querySelector("section")).toHaveAttribute("class", "dense-block");
  });

  it("integrated suma su modificador y mantiene el título asociado", () => {
    const { container } = render(
      <DenseSection id="pendientes" title="Pendientes" count={2} surface="integrated">
        <p>Contenido</p>
      </DenseSection>,
    );
    const section = container.querySelector("section");
    expect(section).toHaveClass("dense-block", "dense-block--integrated");
    expect(section).not.toHaveClass("dense-block--outlined");
    expect(section).toHaveAttribute("aria-labelledby", "pendientes-title");
    expect(container.querySelector("h2")).toHaveAttribute("id", "pendientes-title");
  });

  it("outlined pide la presentación heredada de forma explícita", () => {
    const { container } = render(
      <DenseSection id="limites" title="Límites operables" surface="outlined">
        <p>Contenido</p>
      </DenseSection>,
    );
    const section = container.querySelector("section");
    expect(section).toHaveClass("dense-block", "dense-block--outlined");
    expect(section).not.toHaveClass("dense-block--integrated");
  });

  it("ubica descripción junto al título y la acción en la cabecera", () => {
    const { container } = render(
      <DenseSection title="Clasificación" description="Revisá los comprobantes" actions={<button>Acciones por lote</button>}>
        <p>Contenido</p>
      </DenseSection>,
    );
    const header = container.querySelector(".dense-block__head");
    const copy = header?.querySelector(".dense-block__copy");
    const actions = header?.querySelector(".dense-block__actions");
    expect(copy).toContainElement(header?.querySelector("h2") ?? null);
    expect(copy).toContainElement(header?.querySelector("p") ?? null);
    expect(actions).toContainElement(header?.querySelector("button") ?? null);
  });

  it("representa el dato principal y su detalle como dos renglones de una celda", () => {
    const { container } = render(<TableCellStack primary="C 000101" secondary="Venta · actividad Restaurante" />);
    expect(container.querySelector(".ds-table__cell-primary")).toHaveTextContent("C 000101");
    expect(container.querySelector(".ds-table__cell-secondary")).toHaveTextContent("Venta · actividad Restaurante");
    expect(container.querySelector(".ds-table__cell-stack")?.children).toHaveLength(2);
  });

  it("solo admite integrated u outlined", () => {
    const { container } = render(
      // @ts-expect-error: una superficie fuera del contrato no compila
      <DenseSection title="Pendientes" surface="flotante">
        <p>Contenido</p>
      </DenseSection>,
    );
    expect(container.querySelector("section")).toBeInTheDocument();
  });
});
