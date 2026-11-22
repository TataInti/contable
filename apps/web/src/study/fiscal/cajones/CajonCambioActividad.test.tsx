// @vitest-environment jsdom
// Datos sintéticos: códigos, nombres y jurisdicciones inventados.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../lib/api";
import { CajonCambioActividad } from "./CajonCambioActividad";
import type { ClientActivityLink, EconomicActivity } from "../utilidades";

type Registrar = ComponentProps<typeof CajonCambioActividad>["registrar"];

const TUCUMAN = "jur-tuc";
const CABA = "jur-caba";

const vigente: ClientActivityLink = {
  id: "link-a",
  isPrimary: true,
  validFrom: "2026-01-01",
  validTo: null,
  activity: { id: "act-a", code: "101", name: "Venta de mercaderías", isActive: true, jurisdictionId: TUCUMAN, jurisdiction: { name: "Tucumán", isActive: true } },
};

// Ocho opciones activas de Tucumán (más de siete: el selector es buscable), más una oculta, una de otro nivel y la ya vigente.
const catalogo: EconomicActivity[] = [
  { id: "act-a", code: "101", name: "Venta de mercaderías", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-b", code: "202", name: "Servicios de consultoría", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-c", code: "303", name: "Alquileres de inmuebles", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-d", code: "404", name: "Transporte de cargas", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-e", code: "505", name: "Actividad oculta", isActive: false, jurisdictionId: TUCUMAN },
  { id: "act-f", code: "606", name: "Impresión gráfica", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-g", code: "707", name: "Panadería", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-h", code: "808", name: "Servicios de limpieza", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-i", code: "909", name: "Comercio mayorista", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-j", code: "915", name: "Hotelería", isActive: true, jurisdictionId: TUCUMAN },
  { id: "act-x", code: "911", name: "Actividad de otro nivel", isActive: true, jurisdictionId: CABA },
];

const activitiesQuery = { data: catalogo, isLoading: false } as unknown as UseQueryResult<EconomicActivity[]>;

const hoy = () => new Date().toISOString().slice(0, 10);

function renderCajon(extra: Partial<Registrar> = {}) {
  const registrar: Registrar = { isPending: false, error: null, mutate: vi.fn(), reset: vi.fn(), ...extra };
  render(
    <CajonCambioActividad isOpen onClose={vi.fn()} vigentes={[vigente]} activitiesQuery={activitiesQuery} registrar={registrar} />,
  );
  return registrar;
}

function elegirActividad(texto: string) {
  const combo = screen.getByRole("combobox", { name: "Actividad nueva" });
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: texto } });
  fireEvent.click(screen.getByRole("option", { name: new RegExp(texto) }));
}

afterEach(() => cleanup());

describe("CajonCambioActividad («Registrar cambio de actividad», brief 4L)", () => {
  it("ofrece solo actividades activas del nivel de un vínculo vigente, sin las que ya están vigentes", () => {
    renderCajon();
    fireEvent.focus(screen.getByRole("combobox", { name: "Actividad nueva" }));
    const opciones = screen.getAllByRole("option").map((opcion) => opcion.textContent);
    expect(opciones).toContain("202 — Servicios de consultoría");
    expect(opciones).toContain("909 — Comercio mayorista");
    expect(opciones).not.toContain("101 — Venta de mercaderías");
    expect(opciones.some((texto) => texto?.includes("Actividad oculta"))).toBe(false);
    expect(opciones.some((texto) => texto?.includes("Actividad de otro nivel"))).toBe(false);
  });

  it("filtra por texto y envía la actividad, el mes y el motivo sin espacios sobrantes", () => {
    const registrar = renderCajon();
    elegirActividad("Transporte");
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "  Suma de fletes  " } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));
    expect(registrar.mutate).toHaveBeenCalledTimes(1);
    expect(registrar.mutate).toHaveBeenCalledWith({ activityId: "act-d", validFrom: hoy(), changeReason: "Suma de fletes" });
  });

  it("sin actividad o sin mes, avisa qué falta junto al campo y no envía", () => {
    const registrar = renderCajon();
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));
    expect(screen.getByText("Elegí la actividad nueva.")).toBeTruthy();
    expect(registrar.mutate).not.toHaveBeenCalled();

    elegirActividad("Panadería");
    fireEvent.change(screen.getByLabelText(/Rige desde/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));
    expect(screen.getByText("Indicá desde qué mes rige el cambio.")).toBeTruthy();
    expect(screen.queryByText("Elegí la actividad nueva.")).toBeNull();
    expect(registrar.mutate).not.toHaveBeenCalled();
  });

  it("un error de la API en la actividad se muestra junto a su campo", () => {
    const mensaje = "La actividad elegida ya rige en ese mes.";
    renderCajon({
      error: new ApiError("VALIDATION_ERROR", mensaje, 422, null, { details: { path: ["activityId"] } }),
    });
    expect(document.querySelector(".ds-field__error")?.textContent).toBe(mensaje);
  });
});
