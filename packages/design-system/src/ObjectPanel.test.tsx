// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ObjectPanel,
  objectPanelValue,
  parseObjectPanelValue,
  withObjectPanel,
  withoutObjectPanel,
} from "./ObjectPanel.js";

/** Lista con un botón por fila que abre el panel, como en la cola de controles. */
function Harness({ onClose = () => undefined, onPrimary = () => undefined }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const origen = useRef<HTMLButtonElement | null>(null);
  const filas = [
    { id: "1", nombre: "Facturas C" },
    { id: "2", nombre: "Ventas sin CUIT" },
  ];
  return (
    <>
      <ul aria-label="Controles bloqueantes">
        {filas.map((fila) => (
          <li key={fila.id}>
            <button
              type="button"
              onClick={(evento) => {
                origen.current = evento.currentTarget;
                setAbierto(fila.id);
              }}
            >
              Abrir {fila.nombre}
            </button>
          </li>
        ))}
      </ul>
      <ObjectPanel
        kind="control"
        isOpen={abierto !== null}
        onClose={() => {
          onClose();
          setAbierto(null);
        }}
        title={`Control: ${filas.find((f) => f.id === abierto)?.nombre ?? ""}`}
        description="Dos comprobantes afectados"
        primaryAction={
          <button type="button" onClick={onPrimary}>
            Aceptar con motivo
          </button>
        }
        returnFocusTo={origen.current}
      >
        <p>Detalle sintético del control</p>
      </ObjectPanel>
    </>
  );
}

describe("ObjectPanel", () => {
  afterEach(() => cleanup());

  it("se presenta como diálogo con nombre y descripción, y muestra el detalle", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Facturas C" }));

    const panel = screen.getByRole("dialog", { name: "Control: Facturas C" });
    expect(panel).toHaveAccessibleDescription("Dos comprobantes afectados");
    expect(panel.querySelector('[data-object-kind="control"]')).not.toBeNull();
    expect(screen.getByText("Detalle sintético del control")).toBeInTheDocument();
    expect(getComputedStyle(screen.getByRole("heading", { name: "Control: Facturas C" })).whiteSpace).toBe("nowrap");
  });

  it("cierra con Escape y devuelve el foco a la fila de origen", async () => {
    render(<Harness />);
    const origen = screen.getByRole("button", { name: "Abrir Ventas sin CUIT" });
    origen.focus();
    fireEvent.click(origen);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(origen);
  });

  it("cierra con el botón Cerrar del encabezado", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Facturas C" }));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fija el pie con una sola acción primaria y la cancela con Cancelar", () => {
    const onPrimary = vi.fn();
    const onClose = vi.fn();
    render(<Harness onPrimary={onPrimary} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Facturas C" }));

    const pie = document.querySelector(".action-drawer__footer");
    expect(pie).not.toBeNull();
    // Dos botones en el pie: «Cancelar» y una sola acción primaria.
    expect(pie?.querySelectorAll("button")).toHaveLength(2);
    const primaria = screen.getByRole("button", { name: "Aceptar con motivo" });
    expect(pie?.contains(primaria)).toBe(true);

    fireEvent.click(primaria);
    expect(onPrimary).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sin acción primaria no dibuja pie", () => {
    render(
      <ObjectPanel kind="lote" isOpen onClose={() => undefined} title="Lote 2026-10">
        <p>Contenido</p>
      </ObjectPanel>,
    );

    expect(document.querySelector(".action-drawer__footer")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Lote 2026-10" })).toBeInTheDocument();
  });

  it("no tiene un <select> nativo", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Facturas C" }));

    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});

describe("parámetro ?panel= del ObjectPanel", () => {
  it("arma y lee el valor tipo-id", () => {
    expect(objectPanelValue("control", "42")).toBe("control-42");
    expect(parseObjectPanelValue("control-42")).toEqual({ kind: "control", id: "42" });
    expect(parseObjectPanelValue("comprobante-a-0001-00000007")).toEqual({
      kind: "comprobante",
      id: "a-0001-00000007",
    });
  });

  it("rechaza valores de tipo desconocido, sin id o vacíos", () => {
    expect(parseObjectPanelValue("cliente-9")).toBeNull();
    expect(parseObjectPanelValue("control-")).toBeNull();
    expect(parseObjectPanelValue("control")).toBeNull();
    expect(parseObjectPanelValue("")).toBeNull();
    expect(parseObjectPanelValue(null)).toBeNull();
  });

  it("agrega el panel a la URL conservando consulta y fragmento", () => {
    expect(
      withObjectPanel(
        "/clientes/7/legajo/2026-10/controles?vista=pendientes#lista",
        "control",
        "42",
      ),
    ).toBe("/clientes/7/legajo/2026-10/controles?vista=pendientes&panel=control-42#lista");
  });

  it("retira el panel al cerrar y deja la URL de la lista", () => {
    expect(
      withoutObjectPanel(
        "/clientes/7/legajo/2026-10/controles?vista=pendientes&panel=control-42#lista",
      ),
    ).toBe("/clientes/7/legajo/2026-10/controles?vista=pendientes#lista");
    expect(withoutObjectPanel("/clientes/7/legajo/2026-10/controles?panel=control-42")).toBe(
      "/clientes/7/legajo/2026-10/controles",
    );
  });
});
