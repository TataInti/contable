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
  it("asocia la etiqueta al combobox visible", () => {
    render(<SearchSelect id="province" name="province" label="Provincia" options={options} value="tucuman" onChange={() => {}} />);
    const labeledControl = screen.getByLabelText("Provincia");
    expect(labeledControl).toHaveAttribute("id", "province");
    expect(labeledControl).toHaveAttribute("role", "combobox");
    expect(screen.getByRole("combobox", { name: "Provincia" })).toBe(labeledControl);
  });

  it("muestra y envía el valor guardado que ya no está en el catálogo", () => {
    const onChange = vi.fn();
    render(
      <form aria-label="Ficha">
        <SearchSelect id="province" name="province" label="Provincia" options={options} value="Provincia de Tucumán" onChange={onChange} />
      </form>,
    );
    const combobox = screen.getByRole("combobox", { name: "Provincia" });
    expect(combobox).toHaveValue("Provincia de Tucumán — valor histórico (conservado)");
    fireEvent.focus(combobox);
    const historicalOption = screen.getByRole("option", { name: "Provincia de Tucumán — valor histórico (conservado)" });
    expect(historicalOption).toBeInTheDocument();
    fireEvent.click(historicalOption);
    expect(onChange).toHaveBeenCalledWith("Provincia de Tucumán");
    expect(new FormData(screen.getByRole("form", { name: "Ficha" }) as HTMLFormElement).get("province"))
      .toBe("Provincia de Tucumán");
  });

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

  it("expone el rótulo completo como title de cada opción", () => {
    render(<SearchSelect label="Provincia" options={options} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Provincia" }));
    expect(screen.getByRole("option", { name: "Buenos Aires" })).toHaveAttribute("title", "Buenos Aires");
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

  it("ofrece búsqueda también con pocas opciones (ya no cae a un select nativo)", () => {
    render(<SearchSelect label="Condición" options={options.slice(0, 3)} value="" onChange={() => {}} />);
    const combobox = screen.getByRole("combobox", { name: "Condición" });
    expect(combobox.tagName).toBe("INPUT");
    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: "cord" } });
    expect(screen.queryByRole("option", { name: "Tucumán" })).toBeNull();
  });

  it("no permite elegir una opción deshabilitada y la saltea con las flechas", () => {
    const onChange = vi.fn();
    const withDisabled = [
      { value: "a", label: "Activa" },
      { value: "b", label: "Oculta (oculto)", disabled: true },
      { value: "c", label: "Otra" },
    ];
    render(<SearchSelect label="Registro" options={withDisabled} value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Registro" });
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("option", { name: "Oculta (oculto)" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("sin opción vacía no ofrece «vacío» en la lista y oculta el rótulo visible si se pide", () => {
    render(<SearchSelect label="Filtrar por estado" hideLabel allowEmpty={false} options={options.slice(0, 2)} value="tucuman" onChange={() => {}} />);
    expect(screen.queryByText("Elegí…")).toBeNull();
    expect(screen.queryByText("Filtrar por estado")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Filtrar por estado" })).toHaveValue("Tucumán");
  });

  it("marca el error y lo enlaza con su mensaje", () => {
    render(
      <>
        <SearchSelect id="province" label="Provincia" options={options} value="" invalid describedBy="province-error" onChange={() => {}} />
        <p id="province-error">Elegí una provincia.</p>
      </>,
    );
    const combobox = screen.getByRole("combobox", { name: "Provincia" });
    expect(combobox).toHaveAttribute("aria-invalid", "true");
    expect(combobox).toHaveAttribute("aria-describedby", "province-error");
  });

  it("un campo obligatorio se valida por el valor elegido, no por el texto del buscador", () => {
    const { rerender } = render(<SearchSelect label="Provincia" options={options} value="" required onChange={() => {}} />);
    const combobox = screen.getByRole("combobox", { name: "Provincia" }) as HTMLInputElement;
    expect(combobox).toHaveAttribute("aria-required", "true");
    expect(combobox.checkValidity()).toBe(false);

    rerender(<SearchSelect label="Provincia" options={options} value="tucuman" required onChange={() => {}} />);
    fireEvent.focus(combobox); // abierto: el buscador queda vacío y el valor sigue elegido
    expect(combobox.value).toBe("");
    expect(combobox.checkValidity()).toBe(true);
  });
});
