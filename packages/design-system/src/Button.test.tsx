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

  it("permite anunciar una etiqueta de carga específica", () => {
    render(
      <Button loading loadingLabel="Guardando cambios">
        Guardar
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Guardando cambios" })).toBeDisabled();
  });
});
