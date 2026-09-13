// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoneyField } from "./MoneyField.js";

function getInput() {
  return screen.getByRole("textbox", { name: "Importe" });
}

function typeInto(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe("MoneyField", () => {
  it("muestra el separador de miles como decoración visual y normaliza a punto decimal", () => {
    const onChange = vi.fn();
    render(<MoneyField label="Importe" id="amount" value="" onChange={onChange} />);
    const input = getInput();

    typeInto(input, "1200,01");
    expect(input).toHaveValue("1.200,01");
    expect(onChange).toHaveBeenLastCalledWith("1200.01");
  });

  it("acepta punto como separador decimal y lo muestra con coma", () => {
    const onChange = vi.fn();
    render(<MoneyField label="Importe" id="amount" value="" onChange={onChange} />);
    const input = getInput();

    typeInto(input, "1200.01");
    expect(input).toHaveValue("1.200,01");
    expect(onChange).toHaveBeenLastCalledWith("1200.01");
  });

  it("no confunde el punto de miles con un decimal al escribir dígitos", () => {
    const onChange = vi.fn();
    render(<MoneyField label="Importe" id="amount" value="" onChange={onChange} />);
    const input = getInput();

    typeInto(input, "1200");
    expect(input).toHaveValue("1.200");
    expect(onChange).toHaveBeenLastCalledWith("1200");
  });

  it("formatea números grandes con múltiples separadores de miles", () => {
    const onChange = vi.fn();
    render(<MoneyField label="Importe" id="amount" value="" onChange={onChange} />);
    const input = getInput();

    typeInto(input, "1234567,89");
    expect(input).toHaveValue("1.234.567,89");
    expect(onChange).toHaveBeenLastCalledWith("1234567.89");
  });

  it("limita a 2 decimales", () => {
    const onChange = vi.fn();
    render(<MoneyField label="Importe" id="amount" value="" onChange={onChange} />);
    const input = getInput();

    typeInto(input, "10,999");
    expect(input).toHaveValue("10,99");
    expect(onChange).toHaveBeenLastCalledWith("10.99");
  });

  it("muestra el prefijo $", () => {
    render(<MoneyField label="Importe" id="amount" value="1200.01" onChange={() => {}} />);
    expect(screen.getByText("$")).toBeInTheDocument();
  });
});