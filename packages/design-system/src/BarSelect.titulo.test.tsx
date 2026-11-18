// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarSelect } from "./BarSelect.js";

describe("desplegable de barra (BarSelect): rótulo completo (Barra 2e)", () => {
  it("el valor elegido lleva su rótulo completo en title, para leerlo cuando el texto se corta", () => {
    const largo = "Septiembre de 2026 · IVA — Impuesto al Valor Agregado · DEMO IVA 2026-09";
    render(
      <BarSelect
        label="Período fiscal"
        value="b"
        onChange={() => undefined}
        options={[
          { value: "a", label: "Enero de 2026 · IVA" },
          { value: "b", label: largo },
        ]}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Período fiscal" }).getAttribute("title")).toBe(
      largo,
    );
  });
});
