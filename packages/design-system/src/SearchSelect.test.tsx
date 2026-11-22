// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchSelect } from "./SearchSelect.js";

afterEach(() => cleanup());

const options = [
  { value: "tucuman", label: "Tucumán" },
  { value: "buenos-aires", label: "Buenos Aires" },
  { value: "cordoba", label: "Córdoba" },
  { value: "salta", label: "Salta" },
  { value: "jujuy", label: "Jujuy" },
  { value: "mendoza", label: "Mendoza" },
  { value: "san-juan", label: "San Juan" },
  { value: "santa-fe", label: "Santa Fe" },
];

describe("SearchSelect", () => {
  it("filtra ignorando mayúsculas y tildes y conserva id/name y opción vacía", () => {
    const onChange = vi.fn();
    const view = render(<SearchSelect id="province" name="province" label="Provincia" options={options} value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Provincia" });
    expect(input).toHaveAttribute("id", "province");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "TUCUMAN" } });
    expect(screen.getByRole("option", { name: "Tucumán" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Buenos Aires" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Tucumán" }));
    expect(onChange).toHaveBeenCalledWith("tucuman");
    view.rerender(<SearchSelect id="province" name="province" label="Provincia" options={options} value="tucuman" onChange={onChange} />);
    expect(document.querySelector('input[name="province"]')).toHaveValue("tucuman");
  });

  it("navega con flechas, Enter y Escape, exponiendo el activo accesible", () => {
    const onChange = vi.fn();
    render(<SearchSelect label="Provincia" options={options} value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Provincia" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("buenos-aires");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("preserva grupos en la lista filtrada", () => {
    render(<SearchSelect label="Régimen" options={[]} groups={[{ label: "Provincial", options }]} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Régimen" }));
    expect(screen.getByRole("group", { name: "Provincial" })).toBeInTheDocument();
    expect(screen.getByText("Elegí…")).toBeInTheDocument();
  });

  it("usa una lista nativa sin búsqueda cuando hay siete opciones o menos", () => {
    render(<SearchSelect label="Condición" options={options.slice(0, 7)} value="" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Condición" }).tagName).toBe("SELECT");
  });
});
