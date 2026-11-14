// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DenseWorkspace } from "./Dense.js";

afterEach(() => cleanup());

describe("DenseWorkspace role (Foco 0)", () => {
  it("sin role conserva tabpanel y no agrega nombre", () => {
    const { container } = render(
      <DenseWorkspace panelId="clients-panel">
        <p>Tabla</p>
      </DenseWorkspace>,
    );
    const panel = container.querySelector("#clients-panel");
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).not.toHaveAttribute("aria-label");
    expect(panel).not.toHaveAttribute("aria-labelledby");
  });

  it("region con aria-label expone una región con nombre y sin tabpanel", () => {
    render(
      <DenseWorkspace role="region" aria-label="Clientes de la cartera" panelId="clients-panel">
        <p>Tabla</p>
      </DenseWorkspace>,
    );
    expect(screen.getByRole("region", { name: "Clientes de la cartera" })).toHaveAttribute(
      "id",
      "clients-panel",
    );
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  it("region con aria-labelledby toma el nombre del encabezado", () => {
    render(
      <>
        <h2 id="cartera-titulo">Cartera</h2>
        <DenseWorkspace role="region" aria-labelledby="cartera-titulo" panelId="clients-panel">
          <p>Tabla</p>
        </DenseWorkspace>
      </>,
    );
    expect(screen.getByRole("region", { name: "Cartera" })).toHaveAttribute("id", "clients-panel");
  });

  it("tabpanel con su pestaña conserva el rol y toma el nombre de la pestaña", () => {
    render(
      <>
        <button id="tab-clientes" role="tab" aria-controls="clients-panel" type="button">
          Clientes
        </button>
        <DenseWorkspace panelId="clients-panel" aria-labelledby="tab-clientes">
          <p>Tabla</p>
        </DenseWorkspace>
      </>,
    );
    expect(screen.getByRole("tabpanel", { name: "Clientes" })).toHaveAttribute("id", "clients-panel");
  });

  it("con inspector conserva la columna lateral", () => {
    const { container } = render(
      <DenseWorkspace
        role="region"
        aria-label="Clientes"
        panelId="clients-panel"
        inspector={<aside>Detalle</aside>}
      >
        <p>Tabla</p>
      </DenseWorkspace>,
    );
    expect(container.querySelector(".dense-work")).toHaveClass("dense-work--inspector");
  });

  it("region sin nombre accesible no compila", () => {
    const { container } = render(
      // @ts-expect-error: region exige aria-label o aria-labelledby
      <DenseWorkspace role="region" panelId="clients-panel">
        <p>Tabla</p>
      </DenseWorkspace>,
    );
    expect(container.querySelector("#clients-panel")).toBeInTheDocument();
  });
});
