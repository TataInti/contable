// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";

describe("Button", () => {
  it("expone el estado de carga y bloquea interacciones", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("conserva aria-busy explícito sin activar el estado de carga", () => {
    render(<Button aria-busy={true}>Descargar</Button>);
    const button = screen.getByRole("button", { name: "Descargar" });

    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toHaveAttribute("data-loading");
  });

  it("permite anunciar una etiqueta de carga específica", () => {
    render(
      <Button loading loadingLabel="Guardando cambios">
        Guardar
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Guardando cambios" })).toBeDisabled();
  });

  it("expone las variantes unificadas y la altura de fila", () => {
    render(
      <>
        <Button variant="primary">Guardar</Button>
        <Button variant="secondary">Alternativa</Button>
        <Button variant="ghost">Cancelar</Button>
        <Button variant="danger">Eliminar</Button>
        <Button variant="text">Reintentar</Button>
        <Button size="row">Abrir fila</Button>
        <Button href="#seccion" variant="link">
          Ir a la sección
        </Button>
      </>,
    );

    const cases: Array<[string, string]> = [
      ["Guardar", "primary"],
      ["Alternativa", "secondary"],
      ["Cancelar", "ghost"],
      ["Eliminar", "danger"],
      ["Reintentar", "text"],
      ["Abrir fila", "primary"],
    ];
    for (const [name, variant] of cases) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass(`ds-button--${variant}`);
    }
    expect(screen.getByRole("button", { name: "Abrir fila" })).toHaveClass("ds-button--row");
    expect(screen.getByRole("link", { name: "Ir a la sección" })).toHaveClass("ds-button--link");
  });

  it("mantiene el foco y su clase de indicador visible", () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });

    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveClass("ds-button");
  });

  it("bloquea una acción deshabilitada", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("nombra botones y enlaces icon-only con aria-label", () => {
    render(
      <>
        <Button iconOnly aria-label="Cerrar panel">
          ×
        </Button>
        <Button href="#inicio" iconOnly aria-label="Ir al inicio" variant="link">
          ↗
        </Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Cerrar panel" })).toHaveClass("ds-button--icon-only");
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveClass("ds-button--icon-only");
  });
});
