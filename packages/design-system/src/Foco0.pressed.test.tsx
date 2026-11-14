// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatStrip, type StatItem } from "./Dense.js";

afterEach(() => cleanup());

describe("StatStrip pressed (Foco 0)", () => {
  it("sin la prop el filtro no expone aria-pressed y conserva active", () => {
    const onSelect = vi.fn();
    render(
      <StatStrip
        label="Resumen"
        items={[{ key: "p", label: "Pendientes", value: 3, active: true, onSelect }]}
      />,
    );
    const item = screen.getByRole("button", { name: /Pendientes/ });
    expect(item).not.toHaveAttribute("aria-pressed");
    expect(item).toHaveClass("dense-stat", "dense-stat--active");
  });

  it("pressed=true expone aria-pressed=true en un ítem que alterna un filtro", () => {
    const onSelect = vi.fn();
    render(
      <StatStrip
        label="Resumen"
        items={[{ key: "p", label: "Pendientes", value: 3, active: true, pressed: true, onSelect }]}
      />,
    );
    const item = screen.getByRole("button", { name: /Pendientes/ });
    expect(item).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("pressed=false expone aria-pressed=false y el grupo conserva su nombre", () => {
    render(
      <StatStrip
        label="Vistas"
        items={[{ key: "v", label: "Vencidos", value: 1, pressed: false, onSelect: () => undefined }]}
      />,
    );
    expect(screen.getByRole("group", { name: "Vistas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vencidos/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("un ítem sin onSelect sigue siendo texto aunque reciba pressed", () => {
    const { container } = render(
      <StatStrip label="Resumen" items={[{ key: "t", label: "Ítems", value: 5, pressed: true }]} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("div.dense-stat")).not.toHaveAttribute("aria-pressed");
    expect(container.querySelector("div.dense-stat")).toHaveTextContent("Ítems5");
  });

  it("un ítem que navega (onSelect sin pressed) conserva su marcado sin aria-pressed", () => {
    const onSelect = vi.fn();
    render(
      <StatStrip label="Resumen" items={[{ key: "n", label: "Bandeja", value: 2, onSelect }]} />,
    );
    const item = screen.getByRole("button", { name: /Bandeja/ });
    expect(item).not.toHaveAttribute("aria-pressed");
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("pressed solo admite booleanos", () => {
    // @ts-expect-error: pressed es booleano
    const item: StatItem = { key: "x", label: "x", value: 1, pressed: "sí" };
    expect(item.key).toBe("x");
  });
});
