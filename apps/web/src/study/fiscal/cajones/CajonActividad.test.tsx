// @vitest-environment jsdom
// Datos sintéticos: códigos, nombres y jurisdicciones inventados.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CajonActividad } from "./CajonActividad";
import type { EconomicActivity } from "../utilidades";

const catalogo: EconomicActivity[] = [
  { id: "act-b", code: "202", name: "Servicios de consultoría", isActive: true, jurisdictionId: "jur-tuc" },
  { id: "act-d", code: "404", name: "Transporte de cargas", isActive: true, jurisdictionId: "jur-tuc" },
];

function renderAlta(activityId: string) {
  const addActivity = { isPending: false, error: null, mutate: vi.fn() };
  render(
    <CajonActividad
      openFormStep="actividades"
      setOpenFormStep={vi.fn()}
      activityId={activityId}
      setActivityId={vi.fn()}
      addActivity={addActivity as never}
      activitiesQuery={{ data: catalogo, isLoading: false } as unknown as UseQueryResult<EconomicActivity[]>}
      effectiveProfileId="profile-a"
    />,
  );
  return addActivity;
}

afterEach(() => cleanup());

describe("CajonActividad (alta de actividad, brief 4L)", () => {
  it("no pide fecha: el alta no tiene campo «Desde» y explica que la actividad vale desde siempre", () => {
    renderAlta("act-b");
    const dialogo = screen.getByRole("dialog", { name: "Vincular actividad económica" });
    expect(within(dialogo).getByText(/Vale para cualquier período/)).toBeTruthy();
    expect(within(dialogo).queryByLabelText(/Desde/)).toBeNull();
    expect(dialogo.querySelector('input[type="date"]')).toBeNull();
  });

  it("vincula la actividad elegida sin enviar fecha", () => {
    const addActivity = renderAlta("act-b");
    fireEvent.click(screen.getByRole("button", { name: "Vincular actividad" }));
    expect(addActivity.mutate).toHaveBeenCalledTimes(1);
  });

  it("sin actividad elegida, el botón queda deshabilitado", () => {
    renderAlta("");
    expect((screen.getByRole("button", { name: "Vincular actividad" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
