// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CajonInscripcion } from "./CajonInscripcion";
import { PestanaRegimenes } from "../pestanas/PestanaRegimenes";
import { SeccionRegimenes } from "../../resumen/secciones/SeccionRegimenes";

const regimenes = [
  { id: "municipal", code: "TEM_SMT", name: "TEM San Miguel de Tucumán", isActive: true, taxType: { id: "tem", name: "Tasa de Actividades Económicas (TEM)", isActive: true }, jurisdiction: { id: "smt", name: "San Miguel de Tucumán", kind: "MUNICIPAL", isActive: true } },
  { id: "national", code: "MT", name: "Monotributo", isActive: true, taxType: { id: "mono", name: "Montributo", isActive: true }, jurisdiction: { id: "ar", name: "Argentina", kind: "NATIONAL", isActive: true } },
  { id: "ri", code: "RI", name: "Responsable Inscripto", isActive: true, taxType: { id: "iva", name: "IVA", isActive: true }, jurisdiction: { id: "ar", name: "Argentina", kind: "NATIONAL", isActive: true } },
  { id: "provincial", code: "IIBB_LOCAL_TUC", name: "IIBB Contribuyente Local Tucumán", isActive: true, taxType: { id: "iibb", name: "Ingresos Brutos", isActive: true }, jurisdiction: { id: "tuc", name: "Provincia de Tucumán", kind: "PROVINCIAL", isActive: true } },
];
function SelectorFixture() {
  const [regimeId, setRegimeId] = useState("");
  return <CajonInscripcion openFormStep="inscripcion" setOpenFormStep={() => undefined} regimeId={regimeId} setRegimeId={setRegimeId} addRegistration={{} as never} regimesQuery={{ data: regimenes, isLoading: false } as never} effectiveProfileId="perfil" />;
}

afterEach(cleanup);

describe("regímenes legibles", () => {
  it("ordena y agrupa las opciones por nivel jurisdiccional, sin mostrar códigos", () => {
    render(<SelectorFixture />);
    const select = screen.getByLabelText("Régimen");
    expect(select.textContent).not.toMatch(/IIBB_LOCAL_TUC|TEM_SMT|\bMT\b|\bRI\b/);
    const groups = [...select.querySelectorAll("optgroup")];
    expect(groups.map((group) => group.label)).toEqual(["Nacional", "Provincial", "Municipal"]);
    expect(groups.map((group) => [...group.querySelectorAll("option")].map((option) => option.textContent))).toEqual([
      ["Monotributo — Montributo · Argentina", "Responsable Inscripto — IVA · Argentina"],
      ["IIBB Contribuyente Local Tucumán — Ingresos Brutos · Provincia de Tucumán"],
      ["TEM San Miguel de Tucumán — Tasa de Actividades Económicas (TEM) · San Miguel de Tucumán"],
    ]);
  });

  it("muestra la ayuda del régimen seleccionado", () => {
    render(<SelectorFixture />);
    fireEvent.change(screen.getByLabelText("Régimen"), { target: { value: "provincial" } });
    expect(screen.getByText("Impuesto: Ingresos Brutos · Jurisdicción: Provincia de Tucumán")).toBeTruthy();
  });

  it("usa la etiqueta completa en el selector y solo el nombre en tablas y resumen", () => {
    const registration = { id: "inscripcion", status: "ACTIVE", validFrom: "2026-01-01", validTo: null, regime: regimenes.find(({ id }) => id === "provincial") };
    render(<PestanaRegimenes canWrite={false} openStepForm={() => undefined} registrationsQuery={{ data: [registration], isLoading: false } as never} cancelRegistration={{} as never} confirm={{} as never} />);
    expect(screen.getByText("IIBB Contribuyente Local Tucumán")).toBeTruthy();
    cleanup();
    render(<SeccionRegimenes fiscal={{ registrations: [registration] } as never} />);
    expect(screen.getByText("IIBB Contribuyente Local Tucumán")).toBeTruthy();
  });
});
