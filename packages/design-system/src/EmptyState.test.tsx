// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button.js";
import { EmptyState } from "./EmptyState.js";

afterEach(() => cleanup());

describe("EmptyState", () => {
  it("expresa por separado la falta de datos y la falta de coincidencias", () => {
    const { rerender, container } = render(
      <EmptyState
        kind="no-data"
        title="Todavía no hay clientes"
        description="Creá el primer cliente para empezar."
        action={<Button>Crear cliente</Button>}
      />,
    );

    expect(container.querySelector(".ds-empty")).toHaveAttribute("data-empty-kind", "no-data");
    expect(screen.getByRole("heading", { name: "Todavía no hay clientes" })).toBeInTheDocument();
    expect(screen.getByText("Creá el primer cliente para empezar.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    rerender(
      <EmptyState
        kind="no-results"
        title="Ningún cliente coincide"
        description="Ajustá la búsqueda o los filtros para ver otros clientes."
      />,
    );
    expect(container.querySelector(".ds-empty")).toHaveAttribute("data-empty-kind", "no-results");
  });
});