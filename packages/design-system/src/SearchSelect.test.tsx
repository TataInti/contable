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

/** Rectángulo del campo, simulado: la lista se posiciona desde él (el portal calcula con getBoundingClientRect). */
function campoEn(top: number, width = 300) {
  return { x: 200, y: top, top, bottom: top + 32, left: 200, right: 200 + width, width, height: 32, toJSON: () => ({}) } as DOMRect;
}

describe("SearchSelect en portal (dentro de tablas y cajones con scroll)", () => {
  it("la lista se renderiza en document.body, fuera del contenedor que la recorta", () => {
    render(
      <div data-testid="tabla" style={{ overflow: "auto", height: 40 }}>
        <SearchSelect label="Actividad" options={options} value="" onChange={() => {}} />
      </div>,
    );
    fireEvent.focus(screen.getByRole("combobox", { name: "Actividad" }));
    const listbox = screen.getByRole("listbox");
    expect(listbox.parentElement).toBe(document.body);
    expect(screen.getByTestId("tabla").contains(listbox)).toBe(false);
  });

  it("se ubica con position fixed debajo del campo, con al menos el ancho del campo", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    render(<SearchSelect label="Actividad" options={options} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Actividad" });
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(campoEn(100, 300));
    fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    expect(listbox.style.position).toBe("fixed");
    expect(listbox.style.left).toBe("200px");
    expect(listbox.style.minWidth).toBe("300px");
    expect(parseFloat(listbox.style.top)).toBeGreaterThan(132);
    expect(listbox.style.bottom).toBe("");
  });

  it("abre hacia arriba cuando no hay lugar debajo del campo", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    render(<SearchSelect label="Actividad" options={options} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Actividad" });
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(campoEn(720, 300));
    fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    expect(listbox.style.top).toBe("");
    expect(parseFloat(listbox.style.bottom)).toBeGreaterThan(800 - 720);
  });

  it("reposiciona al hacer scroll en cualquier ancestro", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    render(
      <div data-testid="tabla" style={{ overflow: "auto", height: 200 }}>
        <SearchSelect label="Actividad" options={options} value="" onChange={() => {}} />
      </div>,
    );
    const input = screen.getByRole("combobox", { name: "Actividad" });
    const spy = vi.spyOn(input, "getBoundingClientRect").mockReturnValue(campoEn(100));
    fireEvent.focus(input);
    const antes = screen.getByRole("listbox").style.top;
    spy.mockReturnValue(campoEn(60));
    fireEvent.scroll(screen.getByTestId("tabla"));
    expect(screen.getByRole("listbox").style.top).not.toBe(antes);
  });

  it("un clic dentro de la lista no cuenta como afuera: el campo conserva el foco y elige la opción", () => {
    const onChange = vi.fn();
    render(<SearchSelect label="Actividad" options={options} value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Actividad" });
    fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    expect(fireEvent.mouseDown(listbox)).toBe(false); // el mousedown sobre la lista no mueve el foco
    fireEvent.click(screen.getByRole("option", { name: "Salta" }));
    expect(onChange).toHaveBeenCalledWith("salta");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("el teclado sigue funcionando: aria-activedescendant apunta a una opción de la lista en portal", () => {
    render(<SearchSelect label="Actividad" options={options} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Actividad" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activo = input.getAttribute("aria-activedescendant");
    expect(activo).toBeTruthy();
    expect(document.getElementById(activo!)).toBe(screen.getByRole("listbox").querySelector(".is-active"));
  });

  it("cierra al salir del campo (clic afuera) aunque la lista esté en portal", () => {
    render(<SearchSelect label="Actividad" options={options} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Actividad" });
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("SearchSelect: el buscador se ve", () => {
  it("muestra la lupa y, al abrir, el placeholder «Buscar…»; sin coincidencias lo dice con el texto buscado", () => {
    const { container } = render(<SearchSelect label="Provincia" options={options} value="" onChange={() => {}} />);
    expect(container.querySelector(".ds-search-select__icon")).not.toBeNull();
    const input = screen.getByRole("combobox", { name: "Provincia" });
    expect(input).toHaveAttribute("placeholder", "Elegí…");
    fireEvent.focus(input);
    expect(input).toHaveAttribute("placeholder", "Buscar…");
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByText("Sin resultados para \"xyz\"")).toBeInTheDocument();
  });
});
