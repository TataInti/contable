import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  categoriaVigente,
  cuotaVigente,
  dueDateOf,
  estadoCuota,
  isPositiveAmount,
  monthKey,
  monthStartFromKey,
  parseIsoDate,
} from "./monotributo-cuota.js";

/** Datos sintéticos: la escala y las vigencias son de prueba, no los importes oficiales. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const D = (value: string) => new Prisma.Decimal(value);

describe("Monotributo: mes, fechas e importes", () => {
  it("convierte AAAA-MM al primer día del mes y rechaza formatos inválidos", () => {
    expect(monthStartFromKey("2026-08")?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(monthStartFromKey("2026-13")).toBeNull();
    expect(monthStartFromKey("26-08")).toBeNull();
    expect(monthStartFromKey("2026-8")).toBeNull();
  });

  it("el vencimiento cae el día 20 del mes de la cuota", () => {
    expect(dueDateOf(d("2026-08-01"))).toBe("2026-08-20");
    expect(dueDateOf(d("2027-01-01"))).toBe("2027-01-20");
    expect(monthKey(d("2026-07-01"))).toBe("2026-07");
  });

  it("acepta fechas reales y rechaza días que no existen", () => {
    expect(parseIsoDate("2026-08-20")?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("20/08/2026")).toBeNull();
  });

  it("el importe del pago es decimal positivo con hasta dos decimales", () => {
    expect(isPositiveAmount("49527.18")).toBe(true);
    expect(isPositiveAmount("100")).toBe(true);
    expect(isPositiveAmount("0")).toBe(false);
    expect(isPositiveAmount("-5")).toBe(false);
    expect(isPositiveAmount("1.234")).toBe(false);
    expect(isPositiveAmount("abc")).toBe(false);
  });
});

describe("Monotributo: categoría por vigencia", () => {
  const filas = [
    { id: "r1", validFrom: d("2026-01-01"), category: "C", activity: "SERVICIOS" },
    { id: "r2", validFrom: d("2026-07-01"), category: "E", activity: "BIENES" },
  ];

  it("cambia en la recategorización de julio y no antes", () => {
    expect(categoriaVigente(filas, d("2026-06-01"))?.category).toBe("C");
    expect(categoriaVigente(filas, d("2026-07-01"))?.category).toBe("E");
    expect(categoriaVigente(filas, d("2026-12-01"))?.activity).toBe("BIENES");
  });

  it("sin vigencia que cubra el mes, devuelve nulo", () => {
    expect(categoriaVigente(filas, d("2025-12-01"))).toBeNull();
    expect(categoriaVigente([], d("2026-07-01"))).toBeNull();
  });
});

describe("Monotributo: cuota de la escala", () => {
  const escala = [
    { validFrom: d("2026-08-01"), validTo: null, category: "A", activity: "SERVICIOS", amount: D("100.00"), source: "fuente-a" },
    { validFrom: d("2026-08-01"), validTo: null, category: "A", activity: "BIENES", amount: D("90.00"), source: "fuente-a" },
    { validFrom: d("2026-02-01"), validTo: d("2026-07-31"), category: "A", activity: "SERVICIOS", amount: D("80.00"), source: "fuente-vieja" },
  ];

  it("toma la cuota del tipo y la categoría vigentes en el mes", () => {
    expect(cuotaVigente(escala, "A", "SERVICIOS", d("2026-08-01"))?.amount.toFixed(2)).toBe("100.00");
    expect(cuotaVigente(escala, "A", "BIENES", d("2026-08-01"))?.amount.toFixed(2)).toBe("90.00");
    expect(cuotaVigente(escala, "A", "SERVICIOS", d("2026-07-01"))?.amount.toFixed(2)).toBe("80.00");
  });

  it("sin escala para el mes o la categoría, devuelve nulo (no inventa importes)", () => {
    expect(cuotaVigente(escala, "B", "SERVICIOS", d("2026-08-01"))).toBeNull();
    expect(cuotaVigente(escala, "A", "SERVICIOS", d("2025-06-01"))).toBeNull();
  });
});

describe("Monotributo: estado único de la cuota", () => {
  it("nombra qué falta y cuándo está pagada", () => {
    expect(estadoCuota({ applies: false, hasCategory: true, fee: D("100"), paid: D("0") })).toBe("NO_APLICA");
    expect(estadoCuota({ applies: true, hasCategory: false, fee: null, paid: D("0") })).toBe("SIN_CATEGORIA");
    expect(estadoCuota({ applies: true, hasCategory: true, fee: null, paid: D("0") })).toBe("SIN_CUOTA");
    expect(estadoCuota({ applies: true, hasCategory: true, fee: D("100"), paid: D("40") })).toBe("PENDIENTE");
    expect(estadoCuota({ applies: true, hasCategory: true, fee: D("100"), paid: D("100") })).toBe("PAGADA");
    expect(estadoCuota({ applies: true, hasCategory: true, fee: D("100"), paid: D("120") })).toBe("PAGADA");
  });
});
