// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DenseTable, DenseToggleGroup, type DenseColumn } from "./Dense.js";

interface Row {
  id: string;
  name: string;
  ending: string | null;
}

const columns: DenseColumn<Row>[] = [{ key: "name", header: "Cliente", render: (row) => row.name }];

const rows: Row[] = [
  { id: "a", name: "Alfa", ending: "1" },
  { id: "b", name: "Beta", ending: "1" },
  { id: "c", name: "Gamma", ending: "2" },
  { id: "d", name: "Delta", ending: null },
];

const groupBy = (row: Row) =>
  row.ending === null
    ? { key: "none", label: "Sin CUIT", order: 10 }
    : { key: row.ending, label: `Terminación ${row.ending}`, order: Number(row.ending) };

afterEach(() => cleanup());

describe("DenseTable con grupos", () => {
  it("antepone a cada grupo un encabezado con su conteo, en el orden de order", () => {
    render(<DenseTable<Row> label="Prueba" columns={columns} rows={rows} rowKey={(row) => row.id} groupBy={groupBy} />);

    const headers = Array.from(document.querySelectorAll("tr.dense-group-row th")).map((th) =>
      th.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(headers).toEqual(["Terminación 1 2", "Terminación 2 1", "Sin CUIT 1"]);
  });

  it("el teclado salta los encabezados al cambiar de grupo", () => {
    const onSelect = vi.fn();
    render(
      <DenseTable<Row>
        label="Prueba"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedKey="b"
        onSelect={onSelect}
        groupBy={groupBy}
      />,
    );

    const beta = document.querySelector('tr[data-row-key="b"]') as HTMLElement;
    fireEvent.keyDown(beta, { key: "ArrowDown" });

    expect(onSelect).toHaveBeenLastCalledWith("c");
  });
});

describe("DenseToggleGroup", () => {
  it("expone aria-pressed y devuelve los valores activos en el orden de las opciones", () => {
    const onChange = vi.fn();
    const options = [
      { value: "0", label: "0" },
      { value: "1", label: "1" },
      { value: "2", label: "2" },
    ];
    render(<DenseToggleGroup label="Terminación de CUIT" options={options} selected={["2"]} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "2" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith(["0", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
