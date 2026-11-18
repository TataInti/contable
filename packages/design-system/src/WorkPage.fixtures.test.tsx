// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkPageFixture } from "./WorkPage.fixtures.js";

afterEach(() => cleanup());

describe("ficha de ejemplo de WorkPage", () => {
  it("arma la barra completa: región con nombre, avisos, secciones y la tabla en el cuerpo", () => {
    const { container } = render(<WorkPageFixture />);
    expect(screen.getByRole("region", { name: /Legajo sintético/ })).toBeInTheDocument();
    expect(container.querySelector('[data-renglon="avisos"]')).not.toBeNull();
    expect(container.querySelector('[data-renglon="secciones"]')).not.toBeNull();
    expect(container.querySelector(".work-page__body table")).not.toBeNull();
  });

  it("tiene como máximo una acción primaria en la barra", () => {
    const { container } = render(<WorkPageFixture />);
    expect(container.querySelectorAll(".work-bar .ds-button--primary")).toHaveLength(1);
  });

  it("el menú de acciones se maneja con teclado y explica la acción deshabilitada", () => {
    render(<WorkPageFixture />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Acciones del período" }), {
      key: "ArrowDown",
    });
    expect(screen.getByRole("menuitem", { name: /Exportar libros/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: /Nuevo legajo/ })).toHaveAccessibleDescription(
      "Ya existe un legajo en este período.",
    );
  });

  it("la selección de revisión marca la más reciente y cambia la revisión mostrada", () => {
    render(<WorkPageFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Revisión 2" }));
    expect(screen.getByRole("menuitemradio", { name: /Revisión 2/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Revisión 1/ }));
    expect(screen.getByRole("button", { name: "Revisión 1" })).toBeInTheDocument();
  });
});
