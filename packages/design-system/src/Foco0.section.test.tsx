// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
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
