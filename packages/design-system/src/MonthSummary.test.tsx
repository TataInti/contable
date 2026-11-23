// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MonthSummary } from "./MonthSummary.js";

describe("MonthSummary (portada del Legajo)", () => {
  afterEach(() => cleanup());

  it("muestra qué falta con enlaces directos, qué está listo e importe estimado", () => {
    render(
      <MonthSummary
        dueLabel="Vence el 20/11/2026"
        pending={[
          { id: "controles", label: "2 controles bloqueantes", href: "/legajo/controles" },
          { id: "fuentes", label: "1 fuente sin lote", href: "/legajo/fuentes" },
        ]}
        ready={["Saldos", "Clasificación"]}
        estimatedAmount="$ 0,00"
        estimateNote="Estimado; el cálculo final sale en Liquidación."
      />,
    );

    const region = screen.getByRole("region", { name: "Resumen del mes" });
    expect(within(region).getByText("Vence el 20/11/2026")).toBeInTheDocument();
    expect(within(region).getByRole("heading", { name: "Qué falta (2)" })).toBeInTheDocument();

    const enlace = within(region).getByRole("link", { name: "2 controles bloqueantes" });
    expect(enlace).toHaveAttribute("href", "/legajo/controles");
    expect(within(region).getByRole("link", { name: "1 fuente sin lote" })).toHaveAttribute(
      "href",
      "/legajo/fuentes",
    );

    expect(within(region).getByRole("heading", { name: "Listo (2)" })).toBeInTheDocument();
    expect(within(region).getByText("Saldos")).toBeInTheDocument();
    expect(within(region).getByRole("heading", { name: "Importe estimado" })).toBeInTheDocument();
    expect(within(region).getByText("$ 0,00")).toHaveClass("month-summary__importe");
    expect(
      within(region).getByText("Estimado; el cálculo final sale en Liquidación."),
    ).toBeInTheDocument();
  });

  it("sin pendientes lo dice en texto y no dibuja una lista vacía", () => {
    render(<MonthSummary pending={[]} ready={["Fuentes"]} estimatedAmount="$ 1.250,00" />);

    expect(screen.getByRole("heading", { name: "Qué falta (0)" })).toBeInTheDocument();
    expect(screen.getByText("No queda nada pendiente.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("usa el título por defecto y uno propio cuando se entrega", () => {
    const { unmount } = render(<MonthSummary pending={[]} ready={[]} estimatedAmount="$ 0,00" />);
    expect(screen.getByRole("heading", { level: 2, name: "Resumen del mes" })).toBeInTheDocument();
    unmount();

    render(<MonthSummary title="Octubre 2026" pending={[]} ready={[]} estimatedAmount="$ 0,00" />);
    expect(screen.getByRole("heading", { level: 2, name: "Octubre 2026" })).toBeInTheDocument();
  });

  it("dos portadas en la misma página no comparten identificadores", () => {
    render(
      <>
        <MonthSummary pending={[]} ready={[]} estimatedAmount="$ 0,00" />
        <MonthSummary pending={[]} ready={[]} estimatedAmount="$ 0,00" />
      </>,
    );
    const regiones = screen.getAllByRole("region", { name: "Resumen del mes" });
    const ids = regiones.map((region) => region.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
  });

  it("no tiene un <select> nativo", () => {
    render(<MonthSummary pending={[]} ready={[]} estimatedAmount="$ 0,00" />);
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});
