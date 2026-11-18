// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarSelect } from "./BarSelect.js";

afterEach(() => cleanup());

const periodos = [
  { value: "2026-01", label: "Período sintético 01/2026" },
  { value: "2026-02", label: "Período sintético 02/2026" },
];

describe("BarSelect (desplegable compacto de barra)", () => {
  it("tiene nombre accesible y ninguna etiqueta visible encima", () => {
    const { container } = render(
      <BarSelect label="Período fiscal" options={periodos} value="2026-01" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: "Período fiscal" })).toBeInTheDocument();
    expect(container.querySelector("label")).toBeNull();
  });

  it("muestra las opciones y el valor elegido", () => {
    render(
      <BarSelect label="Período fiscal" options={periodos} value="2026-02" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: "Período fiscal" })).toHaveValue("2026-02");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("informa el cambio", () => {
    const onChange = vi.fn();
    render(
      <BarSelect label="Período fiscal" options={periodos} value="2026-01" onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Período fiscal" }), {
      target: { value: "2026-02" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("es un campo de la familia de campos con la clase de barra", () => {
    render(
      <BarSelect label="Período fiscal" options={periodos} value="2026-01" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: "Período fiscal" })).toHaveClass(
      "ds-field__input",
      "ds-bar-select",
    );
  });
});
