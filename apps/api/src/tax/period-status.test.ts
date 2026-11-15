import { describe, expect, it } from "vitest";
import {
  derivePeriodStatus,
  PERIOD_STATUS_LABELS,
  type PeriodStatusFacts,
} from "./period-status.js";

/**
 * Tabla de estados de c0b §5.4 con datos sintéticos (sin base de datos ni red).
 * Las pruebas de no bloqueo (D3) viven en la suite de integración de la presentación.
 */
const TABLA: {
  caso: string;
  hechos: PeriodStatusFacts;
  codigo: string;
  faltan: string[];
  texto: string | null;
}[] = [
  {
    caso: "legajo sin liquidar (en curso)",
    hechos: { workpaperStatus: "REVIEWED", settlementStatus: null, filing: null },
    codigo: "EN_CURSO",
    faltan: [],
    texto: null,
  },
  {
    caso: "legajo en borrador, sin liquidación todavía (en curso)",
    hechos: { workpaperStatus: "DRAFT", settlementStatus: null, filing: null },
    codigo: "EN_CURSO",
    faltan: [],
    texto: null,
  },
  {
    caso: "liquidación finalizada sin presentación (faltan acuse y DJ)",
    hechos: { workpaperStatus: "FINALIZED", settlementStatus: "FINALIZED", filing: null },
    codigo: "LEGAJO_FINALIZADO_DJ_PENDIENTE",
    faltan: ["ACUSE", "DJ"],
    texto: "Faltan: acuse y declaración jurada",
  },
  {
    caso: "presentación con acuse sin DJ (falta DJ)",
    hechos: {
      workpaperStatus: "FINALIZED",
      settlementStatus: "FINALIZED",
      filing: { hasAcuse: true, hasDeclaration: false },
    },
    codigo: "LEGAJO_FINALIZADO_DJ_PENDIENTE",
    faltan: ["DJ"],
    texto: "Falta: declaración jurada",
  },
  {
    caso: "DJ sin acuse (muestra que falta el acuse)",
    hechos: {
      workpaperStatus: "FINALIZED",
      settlementStatus: "FINALIZED",
      filing: { hasAcuse: false, hasDeclaration: true },
    },
    codigo: "LEGAJO_FINALIZADO_DJ_PENDIENTE",
    faltan: ["ACUSE"],
    texto: "Falta: presentación con acuse",
  },
  {
    caso: "DJ cargada y acuse (completo)",
    hechos: {
      workpaperStatus: "FINALIZED",
      settlementStatus: "FINALIZED",
      filing: { hasAcuse: true, hasDeclaration: true },
    },
    codigo: "COMPLETO",
    faltan: [],
    texto: null,
  },
  {
    caso: "rectificativa: liquidación nueva en borrador con legajo finalizado (vuelve a en curso)",
    hechos: { workpaperStatus: "FINALIZED", settlementStatus: "DRAFT", filing: null },
    codigo: "EN_CURSO",
    faltan: [],
    texto: null,
  },
  {
    caso: "rectificativa: liquidación reemplazada no cuenta como finalizada (en curso)",
    hechos: { workpaperStatus: "FINALIZED", settlementStatus: "SUPERSEDED", filing: null },
    codigo: "EN_CURSO",
    faltan: [],
    texto: null,
  },
  {
    caso: "legajo finalizado sin liquidación vigente (faltan acuse y DJ)",
    hechos: { workpaperStatus: "FINALIZED", settlementStatus: null, filing: null },
    codigo: "LEGAJO_FINALIZADO_DJ_PENDIENTE",
    faltan: ["ACUSE", "DJ"],
    texto: "Faltan: acuse y declaración jurada",
  },
];

describe("derivePeriodStatus (corte 5a, tabla de c0b §5.4)", () => {
  it.each(TABLA)("$caso", ({ hechos, codigo, faltan, texto }) => {
    const estado = derivePeriodStatus(hechos);
    expect(estado.code).toBe(codigo);
    expect(estado.missing).toEqual(faltan);
    expect(estado.missingText).toBe(texto);
  });

  it("usa los rótulos de c0b §5.1 con un solo nombre por estado (P3)", () => {
    expect(PERIOD_STATUS_LABELS).toEqual({
      EN_CURSO: "En curso",
      LEGAJO_FINALIZADO_DJ_PENDIENTE: "Legajo finalizado · DJ pendiente",
      COMPLETO: "Completo",
    });
    const completo = derivePeriodStatus({
      workpaperStatus: "FINALIZED",
      settlementStatus: "FINALIZED",
      filing: { hasAcuse: true, hasDeclaration: true },
    });
    expect(completo.label).toBe("Completo");
  });

  it("es pura: el mismo hecho da el mismo estado y no cambia el dato de entrada", () => {
    const hechos: PeriodStatusFacts = {
      workpaperStatus: "FINALIZED",
      settlementStatus: "FINALIZED",
      filing: { hasAcuse: true, hasDeclaration: false },
    };
    const copia = JSON.parse(JSON.stringify(hechos)) as PeriodStatusFacts;
    expect(derivePeriodStatus(hechos)).toEqual(derivePeriodStatus(hechos));
    expect(hechos).toEqual(copia);
  });
});
