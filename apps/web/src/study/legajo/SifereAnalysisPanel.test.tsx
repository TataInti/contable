// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SifereAnalysisPanel } from "./SifereAnalysisPanel";

// Análisis ficticio «Demo» de un libro de ventas: dos alícuotas y un tributo.
type Analisis = Parameters<typeof SifereAnalysisPanel>[0]["analysis"];

const analisisDemo: Analisis = {
  direction: "SALE",
  sheetName: "Demo ventas",
  totals: {
    importeTotal: "121000",
    netoGravado: "100000",
    iva: "21000",
    noGravado: "0",
    exento: "0",
  },
  rates: [
    { rate: "21", label: "Alícuota Demo 21 %", net: "80000", tax: "16800", count: 4 },
    { rate: "10.5", label: "Alícuota Demo 10,5 %", net: "20000", tax: "2100", count: 2 },
  ],
  taxes: [{ code: "PERCEPCION_DEMO", label: "Percepción Demo", amount: "1500" }],
  detailRows: 6,
  validRows: 6,
  errorRows: 0,
  rows: [],
};

function texto(elemento: Element | null): string {
  return (elemento?.textContent ?? "").replace(/\s+/g, " ").trim();
}

afterEach(() => cleanup());

describe("SifereAnalysisPanel (análisis de libro IVA)", () => {
  it("muestra importe total, neto gravado e IVA, en ese orden", () => {
    const { container } = render(<SifereAnalysisPanel analysis={analisisDemo} />);
    const totales = Array.from(
      container.querySelectorAll('[aria-label="Totales del libro"] .dense-stat'),
    );
    expect(totales.map((item) => texto(item.querySelector(".dense-stat__label")))).toEqual([
      "Importe total",
      "Neto gravado",
      "IVA",
    ]);
    expect(totales.map((item) => texto(item.querySelector(".dense-stat__value")))).toEqual([
      "$ 121.000,00",
      "$ 100.000,00",
      "$ 21.000,00",
    ]);
  });

  it("dibuja una fila por alícuota con base, IVA y comprobantes", () => {
    const { container } = render(<SifereAnalysisPanel analysis={analisisDemo} />);
    expect(Array.from(container.querySelectorAll("table thead th")).map(texto)).toEqual([
      "Alícuota",
      "Base",
      "IVA",
      "Comp.",
    ]);
    const filas = Array.from(container.querySelectorAll("table tbody tr")).map((fila) =>
      Array.from(fila.querySelectorAll("td")).map(texto),
    );
    expect(filas).toEqual([
      ["Alícuota Demo 21 %", "$ 80.000,00", "$ 16.800,00", "4"],
      ["Alícuota Demo 10,5 %", "$ 20.000,00", "$ 2.100,00", "2"],
    ]);
  });

  it("lista los tributos asociados con su importe", () => {
    const { container } = render(<SifereAnalysisPanel analysis={analisisDemo} />);
    expect(Array.from(container.querySelectorAll("small")).map(texto)).toContain(
      "Tributos asociados",
    );
    const impuestos = Array.from(
      container.querySelectorAll('[aria-label="Tributos asociados"] .dense-stat'),
    );
    expect(impuestos.map((item) => texto(item.querySelector(".dense-stat__label")))).toEqual([
      "Percepción Demo",
    ]);
    expect(impuestos.map((item) => texto(item.querySelector(".dense-stat__value")))).toEqual([
      "$ 1.500,00",
    ]);
  });

  it("cuenta comprobantes y válidos, sin observaciones si no hay errores", () => {
    const { container } = render(<SifereAnalysisPanel analysis={analisisDemo} />);
    expect(texto(container.querySelector(".muted-copy"))).toBe("6 comprobantes · 6 válidos");
  });

  it("agrega las observaciones solo cuando hay filas con error", () => {
    const { container } = render(
      <SifereAnalysisPanel analysis={{ ...analisisDemo, errorRows: 2 }} />,
    );
    expect(texto(container.querySelector(".muted-copy"))).toBe(
      "6 comprobantes · 6 válidos · 2 con observaciones",
    );
  });

  it("no dibuja la tabla ni el bloque de tributos si no hay alícuotas ni tributos", () => {
    const { container } = render(
      <SifereAnalysisPanel analysis={{ ...analisisDemo, rates: [], taxes: [] }} />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector('[aria-label="Tributos asociados"]')).toBeNull();
  });
});
