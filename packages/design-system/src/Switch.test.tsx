// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch.js";

afterEach(cleanup);

describe("Switch", () => {
  it("se anuncia como interruptor y avisa el valor contrario al hacer clic", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Módulo de reportes" text="Deshabilitado" />);
    const control = screen.getByRole("switch", { name: "Módulo de reportes" });
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("no admite clics mientras guarda", () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Módulo de reportes" busy />);
    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
