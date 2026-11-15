// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BandaEstado } from "./BandaEstado";

describe("BandaEstado: concordancia de número (Foco 2.8)", () => {
  it("usa el singular con 1 legajo y con 1 componente", () => {
    render(<BandaEstado legajos={1} componentes={1} />);
    expect(screen.getByText("Legajo")).toBeTruthy();
    expect(screen.getByText("Componente")).toBeTruthy();
  });

  it("usa el plural con 2 legajos y 0 componentes", () => {
    render(<BandaEstado legajos={2} componentes={0} />);
    expect(screen.getByText("Legajos")).toBeTruthy();
    expect(screen.getByText("Componentes")).toBeTruthy();
  });
});
