// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PortadaPantallaDemo } from "./Patrones.fixtures.js";

afterEach(() => cleanup());

describe("marco común del demo", () => {
  it("presenta navegación, período, estado, comentarios, acción, pestañas y título", () => {
    render(<PortadaPantallaDemo />);

    expect(screen.getByRole("complementary", { name: "Navegación principal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Legajo" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("textbox", { name: "Buscar período fiscal" })).toHaveValue("octubre de 2026 · IIBB Tucumán");
    expect(screen.getByText("Revisión 1 · Vence el 20/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Listo para calcular")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comentarios · 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calcular liquidación" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Etapas del legajo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "octubre de 2026", level: 1 })).toBeInTheDocument();
  });
});
