// @vitest-environment jsdom
// Datos sintéticos: códigos, nombres y jurisdicciones inventados.
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CajonActividad } from "./CajonActividad";
import type { EconomicActivity } from "../utilidades";

const catalogo: EconomicActivity[] = [
  { id: "act-b", code: "202", name: "Servicios de consultoría", isActive: true, jurisdictionId: "jur-tuc" },
  { id: "act-d", code: "404", name: "Transporte de cargas", isActive: true, jurisdictionId: "jur-tuc" },
  { id: "act-x", code: "909", name: "Actividad inactiva", isActive: false, jurisdictionId: "jur-tuc" },
];
const jurisdicciones = [{ id: "jur-tuc", name: "Tucumán" }];

function renderAlta() {
  const addActivity = { isPending: false, error: null, mutate: vi.fn() };
  function Harness() {
    const [activityIds, setActivityIds] = useState<string[]>([]);
    return (
      <CajonActividad
        openFormStep="actividades"
        setOpenFormStep={vi.fn()}
        activityIds={activityIds}
        setActivityIds={setActivityIds}
        addActivity={addActivity as never}
        activitiesQuery={{ data: catalogo, isLoading: false } as unknown as UseQueryResult<EconomicActivity[]>}
        jurisdictionsQuery={{ data: jurisdicciones, isLoading: false } as unknown as UseQueryResult<{ id: string; name: string }[]>}
        effectiveProfileId="profile-a"
      />
    );
  }
  render(<Harness />);
  return addActivity;
}

afterEach(() => cleanup());

describe("CajonActividad (alta de actividades, brief 4P: selección múltiple)", () => {
  it("no pide fecha: el alta no tiene campo «Desde» y explica que vale para cualquier período", () => {
    renderAlta();
    const dialogo = screen.getByRole("dialog", { name: "Vincular actividad económica" });
    expect(within(dialogo).getByText(/Valen para cualquier período/)).toBeTruthy();
    expect(within(dialogo).queryByLabelText(/Desde/)).toBeNull();
    expect(dialogo.querySelector('input[type="date"]')).toBeNull();
  });

  it("muestra cada actividad del catálogo con su jurisdicción, sin las inactivas", () => {
    renderAlta();
    expect(screen.getByRole("checkbox", { name: /202 — Servicios de consultoría · Tucumán/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /404 — Transporte de cargas · Tucumán/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Actividad inactiva/ })).toBeNull();
  });

  it("el buscador filtra la lista por código, nombre o jurisdicción", () => {
    renderAlta();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar actividad" }), { target: { value: "transporte" } });
    expect(screen.queryByRole("checkbox", { name: /Servicios de consultoría/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Transporte de cargas/ })).toBeTruthy();
  });

  it("vincula todas las elegidas con un solo botón", () => {
    const addActivity = renderAlta();
    fireEvent.click(screen.getByRole("checkbox", { name: /Servicios de consultoría/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Transporte de cargas/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vincular actividad" }));
    expect(addActivity.mutate).toHaveBeenCalledTimes(1);
    expect(addActivity.mutate).toHaveBeenCalledWith(["act-b", "act-d"]);
  });

  it("sin actividades elegidas, el botón queda deshabilitado", () => {
    renderAlta();
    expect((screen.getByRole("button", { name: "Vincular actividad" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
