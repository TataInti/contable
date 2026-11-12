// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractedField } from "../lib/api";
import { ManualExtractionFieldsDialog } from "./ManualExtractionFieldsDialog";

function renderDialog(fields: ExtractedField[] = [], error: string | null = null) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <ManualExtractionFieldsDialog
      fields={fields}
      voucherData={null}
      isSaving={false}
      error={error}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManualExtractionFieldsDialog", () => {
  it("abre un diálogo accesible con los 17 campos escalares y CAE al final como opcional", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Cargar datos a mano" });
    const select = within(dialog).getByRole("combobox", { name: "Campo de la fila 1" }) as HTMLSelectElement;
    const options = Array.from(select.options).filter((option) => option.value);

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(options).toHaveLength(17);
    expect(options.slice(-2).map((option) => option.textContent)).toEqual([
      "CAE (opcional)",
      "Vencimiento del CAE (opcional)",
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      "Tipo de documento",
      "Letra",
      "Punto de venta",
      "Número",
      "Fecha",
      "CUIT emisor",
      "CUIT receptor",
      "Razón social emisor",
      "Razón social receptor",
      "Condición frente al IVA",
      "Neto gravado",
      "No gravado",
      "Exento",
      "Total",
      "Moneda",
      "CAE (opcional)",
      "Vencimiento del CAE (opcional)",
    ]);
    expect(document.activeElement).toBe(select);
  });

  it("agrega y quita filas, y evita elegir dos veces el mismo campo", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "voucherType" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    const secondSelect = screen.getByRole("combobox", { name: "Campo de la fila 2" }) as HTMLSelectElement;
    const repeated = within(secondSelect).getByRole("option", { name: "Tipo de documento" }) as HTMLOptionElement;

    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(repeated.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quitar fila 2" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("Quitar descarta solo el borrador y envía las filas que quedan", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "primer dato" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 2" }), {
      target: { value: "currency" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 2" }), {
      target: { value: "borrador a quitar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Quitar fila 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([{ key: "totalAmount", value: "primer dato" }]);
  });

  it("deshabilita los campos con valor existente y los identifica", () => {
    renderDialog([
      {
        id: "field-total",
        key: "totalAmount",
        rawValue: "100",
        normalizedValue: "100",
        correction: null,
        method: "EMBEDDED_TEXT",
        confidence: 0.9,
        status: "ACCEPTED",
      },
    ]);
    const select = screen.getByRole("combobox", { name: "Campo de la fila 1" });
    const total = within(select).getByRole("option", { name: "Total (ya tiene valor)" }) as HTMLOptionElement;
    expect(total.disabled).toBe(true);
  });

  it("deshabilita Guardar y la edición mientras la petición está en curso", () => {
    render(
      <ManualExtractionFieldsDialog
        fields={[]}
        voucherData={null}
        isSaving
        error={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Valor de la fila 1" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("envía los valores como texto libre, recorta espacios y descarta filas incompletas", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "  importe libre  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 2" }), {
      target: { value: "currency" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 2" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 3" }), {
      target: { value: "sin campo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith([{ key: "totalAmount", value: "importe libre" }]);
  });

  it("mantiene el error visible y conserva lo escrito", () => {
    renderDialog([], "No se pudo conectar con el servidor");
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "valor pendiente" },
    });

    expect(screen.getByRole("alert").textContent).toBe("No se pudo conectar con el servidor");
    expect((screen.getByRole("textbox", { name: "Valor de la fila 1" }) as HTMLInputElement).value).toBe("valor pendiente");
    expect((screen.getByRole("combobox", { name: "Campo de la fila 1" }) as HTMLSelectElement).value).toBe("totalAmount");
  });

  it("cierra sin cambios directamente y pide confirmación para descartar cambios", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Escape cierra directamente cuando no hay cambios", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("al cancelar con cambios permite seguir editando o descartar", () => {
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "borrador" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const confirmation = screen.getByRole("alertdialog", { name: "¿Descartar los datos cargados?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Seguir editando" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Valor de la fila 1" }) as HTMLInputElement).value).toBe("borrador");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape y el clic fuera piden confirmación cuando hay cambios", () => {
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "borrador" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "¿Descartar los datos cargados?" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".manual-fields-dialog__scrim")!);
    expect(screen.getByRole("alertdialog", { name: "¿Descartar los datos cargados?" })).toBeTruthy();
  });

  it("mantiene el foco dentro del diálogo", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "100" },
    });
    const first = screen.getByRole("button", { name: "Cerrar" });
    const save = screen.getByRole("button", { name: "Guardar" });
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });
});
