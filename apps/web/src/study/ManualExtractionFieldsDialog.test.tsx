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

    expect(screen.getAllByRole("combobox", { name: /Campo de la fila/ })).toHaveLength(2);
    expect(repeated.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quitar fila 2" }));
    expect(screen.getAllByRole("combobox", { name: /Campo de la fila/ })).toHaveLength(1);
  });

  it("Quitar descarta solo el borrador y envía las filas que quedan", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "1,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 2" }), {
      target: { value: "currency" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Valor de la fila 2" }), {
      target: { value: "USD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Quitar fila 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([{ key: "totalAmount", value: "1.00" }]);
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

  it("normaliza importes, recorta espacios y descarta filas incompletas", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "  1.234,56  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 2" }), {
      target: { value: "currency" },
    });
    expect(screen.getByRole("combobox", { name: "Valor de la fila 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 3" }), {
      target: { value: "sin campo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith([{ key: "totalAmount", value: "1234.56" }]);
  });

  it("muestra el error del importe asociado al campo y bloquea Guardar hasta corregirlo", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    const value = screen.getByRole("textbox", { name: "Valor de la fila 1" }) as HTMLInputElement;
    expect(value.inputMode).toBe("decimal");
    fireEvent.change(value, { target: { value: "no es un importe" } });

    const error = screen.getByText("Ingresá un importe, por ejemplo 1.234,56");
    expect(value.getAttribute("aria-describedby")).toBe(error.id);
    expect((screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(value, { target: { value: "1.234,56" } });
    expect(screen.queryByText("Ingresá un importe, por ejemplo 1.234,56")).toBeNull();
    expect((screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onSave).toHaveBeenCalledWith([{ key: "totalAmount", value: "1234.56" }]);
  });

  it("usa controles de fecha, numéricos y listas del catálogo con etiquetas accesibles", () => {
    const { onSave } = renderDialog();
    const chooseField = (row: number, key: string) => {
      fireEvent.change(screen.getByRole("combobox", { name: `Campo de la fila ${row}` }), {
        target: { value: key },
      });
    };
    const addRow = () => fireEvent.click(screen.getByRole("button", { name: "+ Agregar fila" }));

    chooseField(1, "voucherType");
    const documentType = screen.getByRole("combobox", { name: "Valor de la fila 1" }) as HTMLSelectElement;
    expect(Array.from(documentType.options).map((option) => option.textContent)).toEqual([
      "Seleccioná una opción",
      "Factura",
      "Ticket no fiscal",
      "Recibo",
      "Nota de crédito",
      "Nota de débito",
      "Otro",
      "Ilegible",
    ]);
    addRow();
    chooseField(2, "letter");
    expect(Array.from((screen.getByRole("combobox", { name: "Valor de la fila 2" }) as HTMLSelectElement).options)
      .slice(1).map((option) => option.value)).toEqual(["A", "B", "C", "M", "E", "X"]);
    addRow();
    chooseField(3, "currency");
    expect(Array.from((screen.getByRole("combobox", { name: "Valor de la fila 3" }) as HTMLSelectElement).options)
      .slice(1).map((option) => option.value)).toEqual(["ARS", "USD"]);
    addRow();
    chooseField(4, "vatCondition");
    expect(Array.from((screen.getByRole("combobox", { name: "Valor de la fila 4" }) as HTMLSelectElement).options)
      .slice(1).map((option) => option.value)).toEqual([
      "RESPONSABLE_INSCRIPTO",
      "MONOTRIBUTISTA",
      "EXENTO",
      "NO_RESPONSABLE",
    ]);
    addRow();
    chooseField(5, "issueDate");
    const issueDate = screen.getByLabelText("Valor de la fila 5") as HTMLInputElement;
    expect(issueDate.type).toBe("date");
    fireEvent.change(issueDate, { target: { value: "2026-11-12" } });
    addRow();
    chooseField(6, "issuerTaxId");
    const issuerTaxId = screen.getByLabelText("Valor de la fila 6") as HTMLInputElement;
    expect(issuerTaxId.inputMode).toBe("numeric");
    fireEvent.change(issuerTaxId, { target: { value: "30-12345678-9" } });
    expect(issuerTaxId.value).toBe("30123456789");
    addRow();
    chooseField(7, "pointOfSale");
    const pointOfSale = screen.getByLabelText("Valor de la fila 7") as HTMLInputElement;
    fireEvent.change(pointOfSale, { target: { value: "00a04" } });
    expect(pointOfSale.value).toBe("0004");
    addRow();
    chooseField(8, "cae");
    const cae = screen.getByLabelText("Valor de la fila 8") as HTMLInputElement;
    fireEvent.change(cae, { target: { value: "75123456789012" } });
    expect(cae.inputMode).toBe("numeric");
    addRow();
    chooseField(9, "issuerName");
    const issuerName = screen.getByLabelText("Valor de la fila 9") as HTMLInputElement;
    expect(issuerName.type).toBe("text");
    expect(issuerName.inputMode).toBe("");
    fireEvent.change(issuerName, { target: { value: "Proveedor S.A." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onSave).toHaveBeenCalledWith([
      { key: "issueDate", value: "2026-11-12" },
      { key: "issuerTaxId", value: "30123456789" },
      { key: "pointOfSale", value: "0004" },
      { key: "cae", value: "75123456789012" },
      { key: "issuerName", value: "Proveedor S.A." },
    ]);
  });

  it("mantiene el error visible y conserva lo escrito", () => {
    renderDialog([], "No se pudo conectar con el servidor");
    fireEvent.change(screen.getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "valor pendiente" },
    });

    expect(screen.getByText("No se pudo conectar con el servidor").textContent).toBe("No se pudo conectar con el servidor");
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
