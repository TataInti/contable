// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DenseTable } from "./Dense.js";

type Fila = { anio: number };

describe("encabezado ordenable de DenseTable (Foco 2.7c)", () => {
  afterEach(cleanup);

  it("sin la prop, el encabezado ordenable no muestra indicador (el marcado de las demás tablas no cambia)", () => {
    render(
      <DenseTable<Fila>
        label="Años"
        columns={[
          {
            key: "anio",
            header: "Año",
            sortValue: (fila) => fila.anio,
            render: (fila) => fila.anio,
          },
        ]}
        rows={[{ anio: 2026 }]}
        rowKey={(fila) => String(fila.anio)}
      />,
    );
    expect(document.querySelector(".dense-sort__pista")).toBeNull();
  });

  it("con sortHint, sin orden muestra un indicador neutro, y al ordenar muestra la dirección", () => {
    const filas: Fila[] = [{ anio: 2026 }, { anio: 2025 }];
    render(
      <DenseTable<Fila>
        label="Años"
        columns={[
          {
            key: "anio",
            header: "Año",
            sortValue: (fila) => fila.anio,
            render: (fila) => fila.anio,
          },
        ]}
        rows={filas}
        rowKey={(fila) => String(fila.anio)}
        sortHint
      />,
    );
    const orden = screen.getByRole("button", { name: "Año" });
    expect(orden.querySelector(".dense-sort__pista")?.textContent).toBe("↕");
    fireEvent.click(orden);
    expect(orden.querySelector(".dense-sort__pista")).toBeNull();
    expect(orden.textContent).toMatch(/[↑↓]/);
  });
});
