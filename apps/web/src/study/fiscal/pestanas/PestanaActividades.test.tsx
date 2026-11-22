// @vitest-environment jsdom
// Datos sintéticos: códigos, nombres y jurisdicciones inventados.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PestanaActividades } from "./PestanaActividades";
import type { ClientActivityLink } from "../utilidades";

const jurisdiccion = { name: "Tucumán", isActive: true };

const vinculos: ClientActivityLink[] = [
  {
    id: "link-a",
    isPrimary: true,
    validFrom: "2026-01-01",
    validTo: null,
    activity: { id: "act-a", code: "101", name: "Venta de mercaderías", isActive: true, jurisdiction: jurisdiccion },
  },
  {
    id: "link-b",
    isPrimary: false,
    validFrom: "2026-10-01",
    validTo: null,
    isChange: true,
    changeReason: "Suma de ventas de servicios",
    activity: { id: "act-b", code: "202", name: "Servicios de consultoría", isActive: true, jurisdiction: jurisdiccion },
  },
];

function renderPestana(canWrite: boolean) {
  const handlers = { openStepForm: vi.fn(), corregirFecha: vi.fn(), registrarCambio: vi.fn() };
  render(
    <PestanaActividades
      canWrite={canWrite}
      openStepForm={handlers.openStepForm}
      clientActivitiesQuery={{ data: vinculos, isLoading: false } as unknown as UseQueryResult<ClientActivityLink[]>}
      endActivity={{ isPending: false, mutate: vi.fn() } as never}
      corregirFecha={handlers.corregirFecha}
      registrarCambio={handlers.registrarCambio}
      confirm={{ ask: vi.fn() } as never}
      renderEstado={() => <span>Vigente</span>}
    />,
  );
  return handlers;
}

afterEach(() => cleanup());

describe("PestanaActividades (brief 4L)", () => {
  it("la tabla no tiene columna «Desde» y la línea de tiempo muestra el cambio con su motivo", () => {
    renderPestana(true);
    const encabezados = screen.getAllByRole("columnheader").map((th) => th.textContent ?? "");
    expect(encabezados).toContain("Código");
    expect(encabezados).not.toContain("Desde");
    expect(
      screen.getByText("Desde octubre 2026 rige Servicios de consultoría (cambio de actividad) · Suma de ventas de servicios"),
    ).toBeTruthy();
  });

  it("«Corregir mes» aparece solo en el cambio registrado, no en la actividad sin fecha", () => {
    const handlers = renderPestana(true);
    const corregir = screen.getAllByRole("button", { name: "Corregir mes" });
    expect(corregir).toHaveLength(1);
    fireEvent.click(corregir[0]!);
    expect(handlers.corregirFecha).toHaveBeenCalledWith(vinculos[1]);
  });

  it("«Registrar cambio de actividad» abre el cajón de cambio; sin escritura no se ofrece", () => {
    const handlers = renderPestana(true);
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio de actividad" }));
    expect(handlers.registrarCambio).toHaveBeenCalledTimes(1);
  });

  it("sin permiso de escritura no muestra acciones de cambio", () => {
    renderPestana(false);
    expect(screen.queryByRole("button", { name: "Registrar cambio de actividad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Corregir mes" })).toBeNull();
  });
});
