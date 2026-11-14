// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DenseTable, type DenseColumn, type DenseGroup } from "./Dense.js";

afterEach(() => cleanup());

interface Client {
  id: string;
  name: string;
  amount: number;
  status: "ACTIVE" | "INACTIVE";
}

const clients: Client[] = [
  { id: "z", name: "Zeta", amount: 1, status: "INACTIVE" },
  { id: "a", name: "Alfa", amount: 3, status: "ACTIVE" },
  { id: "m", name: "Mora", amount: 2, status: "ACTIVE" },
];

const columns: DenseColumn<Client>[] = [
  { key: "name", header: "Nombre", render: (row) => row.name, sortValue: (row) => row.name },
  {
    key: "amount",
    header: "Importe",
    render: (row) => row.amount,
    sortValue: (row) => row.amount,
    align: "right",
  },
];

const groupBy = (row: Client): DenseGroup => ({
  key: row.status,
  label: row.status === "ACTIVE" ? "Activos" : "Inactivos",
  order: row.status === "ACTIVE" ? 0 : 1,
});

describe("DenseTable surface (Foco 0)", () => {
  it("sin la prop conserva la tarjeta heredada", () => {
    const { container } = render(
      <DenseTable<Client> label="Clientes" columns={columns} rows={clients} rowKey={(row) => row.id} />,
    );
    expect(container.querySelector(".dense-table-card")).toHaveAttribute("class", "dense-table-card");
  });

  it("integrated suma su modificador y mantiene la misma tabla", () => {
    const { container } = render(
      <DenseTable<Client>
        label="Clientes"
        surface="integrated"
        columns={columns}
        rows={clients}
        rowKey={(row) => row.id}
      />,
    );
    const card = container.querySelector(".dense-table-card");
    expect(card).toHaveClass("dense-table-card", "dense-table-card--integrated");
    expect(card).not.toHaveClass("dense-table-card--outlined");
    expect(screen.getByRole("table", { name: "Clientes" })).toBeInTheDocument();
  });

  it("outlined pide la presentación heredada de forma explícita", () => {
    const { container } = render(
      <DenseTable<Client>
        label="Clientes"
        surface="outlined"
        columns={columns}
        rows={clients}
        rowKey={(row) => row.id}
      />,
    );
    const card = container.querySelector(".dense-table-card");
    expect(card).toHaveClass("dense-table-card", "dense-table-card--outlined");
    expect(card).not.toHaveClass("dense-table-card--integrated");
  });

  it("combina surface con groupBy, selección, ordenación y teclado", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DenseTable<Client>
        label="Cartera"
        surface="integrated"
        groupBy={groupBy}
        columns={columns}
        rows={clients}
        rowKey={(row) => row.id}
        selectedKey="a"
        onSelect={onSelect}
      />,
    );
    const table = screen.getByRole("table", { name: "Cartera" });

    const groupRows = container.querySelectorAll("tr.dense-group-row");
    expect(groupRows).toHaveLength(2);
    expect(groupRows[0]).toHaveTextContent("Activos 2");
    expect(groupRows[1]).toHaveTextContent("Inactivos 1");

    const selected = table.querySelector('tr[data-row-key="a"]');
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected).toHaveClass("dense-row--selected");

    fireEvent.click(within(table).getByRole("button", { name: "Nombre" }));
    const keys = Array.from(table.querySelectorAll("tr[data-row-key]")).map((row) =>
      row.getAttribute("data-row-key"),
    );
    expect(keys).toEqual(["a", "m", "z"]);
    expect(within(table).getByRole("columnheader", { name: /Nombre/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    const mora = table.querySelector('tr[data-row-key="m"]');
    fireEvent.click(mora!);
    expect(onSelect).toHaveBeenLastCalledWith("m");
    fireEvent.keyDown(mora!, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("z");
  });

  it("solo admite integrated u outlined", () => {
    const { container } = render(
      // @ts-expect-error: una superficie fuera del contrato no compila
      <DenseTable<Client> label="Clientes" surface="flotante" columns={columns} rows={clients} rowKey={(row) => row.id} />,
    );
    expect(container.querySelector(".dense-table-card")).toBeInTheDocument();
  });
});
