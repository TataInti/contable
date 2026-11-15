// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button.js";
import { EmptyState } from "./EmptyState.js";

afterEach(() => cleanup());

describe("EmptyState size inline (Foco 0)", () => {
  it("inline suma su modificador y conserva el título como encabezado", () => {
    const { container } = render(<EmptyState size="inline" title="Sin acuses" />);
    const root = container.querySelector(".ds-empty");
    expect(root).toHaveClass("ds-empty", "ds-empty--inline");
    expect(root).not.toHaveClass("ds-empty--regular", "ds-empty--compact");
    expect(screen.getByRole("heading", { level: 3, name: "Sin acuses" })).toBeInTheDocument();
  });

  it("inline conserva kind, descripción y acción", () => {
    const { container } = render(
      <EmptyState
        size="inline"
        kind="no-results"
        title="Ningún período coincide"
        description="Ajustá el filtro."
        action={<Button variant="secondary">Quitar filtros</Button>}
      />,
    );
    expect(container.querySelector(".ds-empty")).toHaveAttribute("data-empty-kind", "no-results");
    expect(screen.getByText("Ajustá el filtro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar filtros" })).toBeInTheDocument();
  });

  it("inline no se anuncia como alerta ni como estado", () => {
    const { container } = render(<EmptyState size="inline" title="Sin datos" />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("sin size el vacío sigue siendo regular", () => {
    const { container } = render(<EmptyState title="Todavía no hay clientes" />);
    expect(container.querySelector(".ds-empty")).toHaveClass("ds-empty--regular");
    expect(container.querySelector(".ds-empty")).not.toHaveClass("ds-empty--inline");
  });

  it("rechaza tamaños fuera del contrato", () => {
    const { container } = render(
      // @ts-expect-error: el tamaño debe ser regular, compact o inline
      <EmptyState title="Sin datos" size="grande" />,
    );
    expect(container.querySelector(".ds-empty")).toBeInTheDocument();
  });
});
