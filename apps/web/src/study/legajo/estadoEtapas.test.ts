import { describe, expect, it } from "vitest";
import { calcularEstadosEtapas } from "./estadoEtapas";

describe("estado por etapa del Legajo", () => {
  it("marca fuentes pendientes y clasificaciones sin resolver y guía hacia esas etapas", () => {
    const resultado = calcularEstadosEtapas({
      sources: [{ required: true, present: false, status: "PENDING", label: "Ventas del período" }],
      classification: { total: 5, classified: 0, pending: 5, ready: false },
      calculationCount: 0,
      blockingControls: 0,
      status: "COLLECTING_INPUTS",
    });
    expect(resultado[1]).toMatchObject({ estado: "Con pendientes", destino: 1, mensaje: "Faltan 1 fuentes obligatorias" });
    expect(resultado[2]).toMatchObject({ estado: "No disponible todavía", destino: 1, accion: "Ir a Fuentes" });
    const conFuentes = calcularEstadosEtapas({
      sources: [{ required: true, present: true, status: "LOADED" }],
      classification: { total: 5, classified: 0, pending: 5, ready: false },
      status: "COLLECTING_INPUTS",
    });
    expect(conFuentes[2]).toMatchObject({ estado: "Con pendientes", destino: 2, mensaje: "Hay 5 comprobantes sin clasificar" });
  });

  it("reconoce Sin movimientos, cálculo pendiente, controles abiertos y finalizado", () => {
    expect(calcularEstadosEtapas({ sources: [{ required: true, present: false, status: "NO_MOVEMENTS" }], status: "COLLECTING_INPUTS" })[1]?.estado).toBe("Lista");
    const sinCalcular = calcularEstadosEtapas({ sources: [], status: "READY_TO_CALCULATE" });
    expect(sinCalcular[3]).toMatchObject({ mensaje: "Falta calcular", destino: 3 });
    const conControl = calcularEstadosEtapas({ sources: [], status: "CALCULATED", calculationCount: 1, blockingControls: 2 });
    expect(conControl[4]).toMatchObject({ mensaje: "Falta resolver controles bloqueantes", destino: 4 });
    expect(conControl[5]).toMatchObject({ destino: 4, accion: "Ir a Controles" });
    expect(calcularEstadosEtapas({ sources: [], status: "FINALIZED", calculationCount: 1 })[5]?.estado).toBe("Lista");
  });
});
