// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DenseTabs } from "./Dense";

describe("DenseTabs", () => {
  it("expone todas las pestañas con estado accesible y conserva navegación por flechas", () => {
    const onChange = vi.fn();
    render(
      <DenseTabs
        label="Etapas"
        idPrefix="stage"
        tabs={[
          { id: "ready", label: "Fuentes", status: "Lista" },
          { id: "pending", label: "Clasificación", status: "Con pendientes" },
        ]}
        active="ready"
        onChange={onChange}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Fuentes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Fuentes" })).toHaveAttribute("aria-description", "Lista");
    expect(screen.getByRole("tab", { name: "Clasificación" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Clasificación" })).toHaveAttribute("aria-description", "Con pendientes");
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("pending");
    expect(tabs[1]).toHaveFocus();
  });
});