// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, type MenuActionItem, type MenuSelectOption } from "./Menu.js";

afterEach(() => cleanup());

/** Acciones de muestra con datos inventados. Cada prueba recibe sus propios espías. */
function acciones(): MenuActionItem[] {
  return [
    {
      key: "exportar",
      label: "Exportar libros",
      description: "Elige libro y formato.",
      icon: "download",
      onSelect: vi.fn(),
    },
    {
      key: "nuevo",
      label: "Nuevo legajo",
      description: "Crea el legajo del período.",
      icon: "plus",
      onSelect: vi.fn(),
    },
    {
      key: "eliminar",
      label: "Eliminar legajo",
      disabled: true,
      disabledReason: "Solo el Titular puede eliminarlo.",
      onSelect: vi.fn(),
    },
  ];
}

function renderAcciones(items: MenuActionItem[]) {
  render(
    <Menu
      kind="actions"
      label="Acciones del período"
      trigger="Acciones del período"
      items={items}
    />,
  );
  return screen.getByRole("button", { name: "Acciones del período" });
}

describe("Menu de acciones: apertura y foco", () => {
  it("el botón se anuncia como control de menú, cerrado al empezar", () => {
    const disparador = renderAcciones(acciones());
    expect(disparador).toHaveAttribute("aria-haspopup", "menu");
    expect(disparador).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("el clic abre y da el foco al primer ítem (Enter y Espacio llegan como clic del botón)", () => {
    const disparador = renderAcciones(acciones());
    fireEvent.click(disparador);
    expect(disparador).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Acciones del período" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Exportar libros/ })).toHaveFocus();
  });

  it("flecha abajo abre y enfoca el primero; flecha arriba abre y enfoca el último", () => {
    const disparador = renderAcciones(acciones());
    fireEvent.keyDown(disparador, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /Exportar libros/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.keyDown(disparador, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: /Eliminar legajo/ })).toHaveFocus();
  });
});

describe("Menu de acciones: teclado", () => {
  it("las flechas recorren con vuelta; Inicio y Fin van al primero y al último", () => {
    const disparador = renderAcciones(acciones());
    fireEvent.click(disparador);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /Nuevo legajo/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /Exportar libros/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: /Eliminar legajo/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: /Exportar libros/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: /Eliminar legajo/ })).toHaveFocus();
  });

  it("Escape cierra el menú y devuelve el foco al botón", () => {
    const disparador = renderAcciones(acciones());
    fireEvent.click(disparador);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(disparador).toHaveFocus();
  });

  it("Tab cierra el menú", () => {
    const disparador = renderAcciones(acciones());
    fireEvent.click(disparador);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Exportar libros/ }), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("un clic afuera cierra el menú", () => {
    const disparador = renderAcciones(acciones());
    fireEvent.click(disparador);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape no llega al contenedor: no cierra un diálogo que contenga el menú", () => {
    const alEscape = vi.fn();
    render(
      <div onKeyDown={alEscape}>
        <Menu kind="actions" label="Acciones" trigger="Acciones" items={acciones()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Acciones" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(alEscape).not.toHaveBeenCalled();
  });
});

describe("Menu de acciones: estados y resultado", () => {
  it("un ítem deshabilitado se anuncia como no disponible, muestra su motivo y no se ejecuta", () => {
    const items = acciones();
    const disparador = renderAcciones(items);
    fireEvent.click(disparador);
    const bloqueado = screen.getByRole("menuitem", { name: /Eliminar legajo/ });
    expect(bloqueado).toHaveAttribute("aria-disabled", "true");
    expect(bloqueado).toHaveTextContent("Solo el Titular puede eliminarlo.");
    expect(bloqueado).toHaveAccessibleDescription("Solo el Titular puede eliminarlo.");
    fireEvent.click(bloqueado);
    expect(items[2]?.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("activar una acción la ejecuta, cierra el menú y devuelve el foco al botón", () => {
    const items = acciones();
    const disparador = renderAcciones(items);
    fireEvent.click(disparador);
    fireEvent.click(screen.getByRole("menuitem", { name: /Nuevo legajo/ }));
    expect(items[1]?.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(disparador).toHaveFocus();
  });

  it("align=end alinea el panel al borde final del botón", () => {
    render(
      <Menu kind="actions" label="Acciones" trigger="Acciones" align="end" items={acciones()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Acciones" }));
    expect(screen.getByRole("menu")).toHaveClass("ds-menu__panel--end");
  });
});

describe("Menu de selección única", () => {
  const revisiones: MenuSelectOption[] = [
    { key: "r2", label: "Revisión 2", status: "Listo", secondary: "la más reciente" },
    { key: "r1", label: "Revisión 1", secondary: "reemplazada · solo lectura" },
    { key: "r0", label: "Revisión 0", disabled: true, disabledReason: "Pendiente de firma" },
  ];

  function renderSeleccion(onChange = vi.fn(), value: string | null = "r2") {
    render(
      <Menu
        kind="select"
        label="Revisión"
        trigger={`Revisión ${value ?? ""}`.trim()}
        options={revisiones}
        value={value}
        onChange={onChange}
      />,
    );
    return screen.getByRole("button", { name: /Revisión/ });
  }

  it("marca la opción elegida con aria-checked y usa roles de selección de menú", () => {
    const disparador = renderSeleccion();
    fireEvent.click(disparador);
    expect(screen.getByRole("menuitemradio", { name: /Revisión 2/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: /Revisión 1/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("al abrir, el foco va a la opción elegida", () => {
    const disparador = renderSeleccion(vi.fn(), "r1");
    fireEvent.click(disparador);
    expect(screen.getByRole("menuitemradio", { name: /Revisión 1/ })).toHaveFocus();
  });

  it("elegir otra opción la informa, cierra el menú y devuelve el foco al botón", () => {
    const onChange = vi.fn();
    const disparador = renderSeleccion(onChange, "r2");
    fireEvent.click(disparador);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Revisión 1/ }));
    expect(onChange).toHaveBeenCalledWith("r1");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(disparador).toHaveFocus();
  });

  it("una opción deshabilitada muestra su motivo y no se elige", () => {
    const onChange = vi.fn();
    const disparador = renderSeleccion(onChange, "r2");
    fireEvent.click(disparador);
    const bloqueada = screen.getByRole("menuitemradio", { name: /Revisión 0/ });
    expect(bloqueada).toHaveAccessibleDescription("Pendiente de firma");
    fireEvent.click(bloqueada);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("muestra el estado y el texto secundario de cada opción", () => {
    const disparador = renderSeleccion();
    fireEvent.click(disparador);
    const r2 = screen.getByRole("menuitemradio", { name: /Revisión 2/ });
    expect(r2).toHaveTextContent("Listo");
    expect(r2).toHaveTextContent("la más reciente");
  });
});
