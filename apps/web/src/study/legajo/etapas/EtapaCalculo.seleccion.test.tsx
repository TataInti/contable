// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaxPosition, WorkpaperCalculationComponent } from "../tipos";
import { EtapaCalculo } from "./EtapaCalculo";
import type { SeleccionCalculo } from "./seleccionCalculo";

// Datos inventados (Demo): IIBB Tucumán con mínimo libre e IVA sin mínimo declarado.
const iibb: WorkpaperCalculationComponent = {
  role: "PRINCIPAL",
  required: true,
  obligationId: "ob-iibb",
  habitual: true,
  usaMinimoDeclarado: true,
  minimoAnterior: { amount: "1600.00" },
  obligation: {
    regimeCode: "IIBB_TUC",
    regimeName: "Contribuyente Local Tucumán",
    taxTypeCode: "IIBB",
    taxTypeName: "Ingresos Brutos",
    jurisdictionName: "Tucumán",
  },
  settlement: null,
};
const iva: WorkpaperCalculationComponent = {
  ...iibb,
  obligationId: "ob-iva",
  habitual: false,
  usaMinimoDeclarado: false,
  minimoAnterior: null,
  obligation: {
    regimeCode: "IVA",
    regimeName: "Régimen general",
    taxTypeCode: "IVA",
    taxTypeName: "IVA",
    jurisdictionName: "Nacional",
  },
};
const liquidado: WorkpaperCalculationComponent = {
  ...iibb,
  settlement: {
    id: "s1",
    status: "CALCULATED",
    engineVersion: "ar-iibb-tuc-local-v1.2.0",
    ruleVersionId: "rv1",
    rulesHash: "h",
    totals: {
      BASE_TOTAL: "115000.00",
      IMPUESTO_POR_ACTIVIDAD: "4025.00",
      MINIMO_APLICADO: "5000.00",
      IMPUESTO_DETERMINADO: "5000.00",
      TOTAL_A_INGRESAR: "5000.00",
    },
    lines: [
      { id: "l1", position: 1, concept: "ACTIVIDAD_620100", formula: null, inputs: { rate: "0.035" }, amount: "4025.00" },
    ],
    differences: [],
    f931Inputs: [],
    minimo: { amount: "5000.00", origen: "CAMPO", declaredAt: "2026-11-22T12:00:00.000Z" },
  },
};

function consulta<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as UseQueryResult<T, Error>;
}

function montar(components: WorkpaperCalculationComponent[], seleccion: SeleccionCalculo, onSeleccionChange = vi.fn()) {
  render(
    <EtapaCalculo
      capabilities={new Set<string>()}
      workpaperId="wp-a"
      calculationQuery={consulta(components)}
      positionQuery={consulta<TaxPosition[]>([])}
      calculateInterestMutation={{ isPending: false, mutate: vi.fn(), variables: undefined, error: null } as unknown as UseMutationResult<unknown, Error, { workpaperId: string; obligationId: string }>}
      seleccion={seleccion}
      onSeleccionChange={onSeleccionChange}
    />,
  );
  return onSeleccionChange;
}

afterEach(() => cleanup());

describe("etapa Cálculo: impuestos a liquidar este mes", () => {
  it("marca por defecto el perfil habitual y deja fuera el resto", () => {
    montar([iibb, iva], { obligationIds: ["ob-iibb"], minimums: {} });
    expect(screen.getByRole("checkbox", { name: /Ingresos Brutos/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /IVA/ })).not.toBeChecked();
  });

  it("desmarcar un impuesto informa la nueva selección sin bloquear el resto", () => {
    const onChange = montar([iibb, iva], { obligationIds: ["ob-iibb", "ob-iva"], minimums: {} });
    fireEvent.click(screen.getByRole("checkbox", { name: /IVA/ }));
    expect(onChange).toHaveBeenCalledWith({ obligationIds: ["ob-iibb"], minimums: {} });
  });

  it("el mínimo arranca vacío y muestra el último que usó el cliente como ayuda", () => {
    montar([iibb], { obligationIds: ["ob-iibb"], minimums: {} });
    const campo = screen.getByLabelText("Mínimo del mes") as HTMLInputElement;
    expect(campo.value).toBe("");
    expect(screen.getByText(/El mes anterior usaste .*1\.600,00\. No se aplica solo\./)).toBeInTheDocument();
  });

  it("un impuesto sin marcar queda como no liquidado este mes", () => {
    montar([iibb, iva], { obligationIds: ["ob-iibb"], minimums: {} });
    expect(screen.getByText("No liquidado este mes.")).toBeInTheDocument();
  });

  it("con mínimo aplicado la fórmula lo explica en una línea", () => {
    montar([liquidado], { obligationIds: ["ob-iibb"], minimums: {} });
    expect(screen.getByText("Se aplica el mínimo porque el impuesto por actividad es menor.")).toBeInTheDocument();
    expect(screen.getByText(/× alícuota 3,5 %/)).toBeInTheDocument();
  });

  it("sin mínimo cargado lo dice en una frase", () => {
    const sinMinimo: WorkpaperCalculationComponent = {
      ...liquidado,
      settlement: { ...liquidado.settlement!, minimo: null, totals: { BASE_TOTAL: "115000.00", IMPUESTO_POR_ACTIVIDAD: "4025.00", TOTAL_A_INGRESAR: "4025.00" } },
    };
    montar([sinMinimo], { obligationIds: ["ob-iibb"], minimums: {} });
    expect(screen.getByText("Sin mínimo: completalo si corresponde.")).toBeInTheDocument();
  });

  it("un mínimo con más de dos decimales muestra el motivo junto al campo", () => {
    montar([iibb], { obligationIds: ["ob-iibb"], minimums: { "ob-iibb": "12.345" } });
    const campo = screen.getByLabelText("Mínimo del mes");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Escribí solo el importe, con hasta dos decimales (por ejemplo 1500 o 1500.50).")).toBeInTheDocument();
  });
});
