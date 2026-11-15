// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import {
  apiFieldIssue,
  codeConflict,
  isOwnedUiRecord,
  selectionOptions,
  suggestedCode,
  validityLabel,
} from "./utilidades";

describe("utilidades de Catálogos fiscales", () => {
  it("validityLabel muestra la vigencia en el formato único y «—» sin fechas", () => {
    expect(validityLabel("2026-07-01", "2026-07-31")).toBe("01/07/2026 al 31/07/2026");
    expect(validityLabel("2026-07-01", null)).toBe("Desde 01/07/2026");
    expect(validityLabel("", null)).toBe("—");
  });

  it("suggestedCode propone los sufijos -2 y -3 sin repetir códigos existentes", () => {
    expect(suggestedCode("DEMO-IVA", [])).toBe("DEMO-IVA-2");
    expect(suggestedCode("DEMO-IVA", ["DEMO-IVA", "DEMO-IVA-2"])).toBe("DEMO-IVA-3");
    expect(suggestedCode("DEMO-IVA", ["demo-iva-2"])).toBe("DEMO-IVA-3");
  });

  it("suggestedCode respeta el máximo de 40 caracteres", () => {
    const sugerido = suggestedCode("A".repeat(40), []);
    expect(sugerido).toHaveLength(40);
    expect(sugerido.endsWith("-2")).toBe(true);
  });

  it("selectionOptions deja solo los activos y conserva el elegido aunque esté oculto", () => {
    const filas = [
      { id: "a", isActive: true },
      { id: "b", isActive: false },
      { id: "c", isActive: true },
    ];
    expect(selectionOptions(filas).map((fila) => fila.id)).toEqual(["a", "c"]);
    expect(selectionOptions(filas, "b").map((fila) => fila.id)).toEqual(["a", "c", "b"]);
    expect(selectionOptions(filas, "a").map((fila) => fila.id)).toEqual(["a", "c"]);
  });

  it("isOwnedUiRecord exige origen del estudio y la firma del estudio", () => {
    expect(isOwnedUiRecord({ origin: "UI", createdByFirmId: "firm-demo" }, "firm-demo")).toBe(true);
    expect(isOwnedUiRecord({ origin: "UI", createdByFirmId: "firm-otra" }, "firm-demo")).toBe(false);
    expect(isOwnedUiRecord({ origin: "REFERENCE", createdByFirmId: "firm-demo" }, "firm-demo")).toBe(false);
    expect(isOwnedUiRecord({ createdByFirmId: "firm-demo" }, "firm-demo")).toBe(false);
  });

  it("codeConflict devuelve el mensaje solo para CATALOG_CODE_CONFLICT", () => {
    expect(codeConflict(new ApiError("CATALOG_CODE_CONFLICT", "Código ya usado (Demo)", 409))).toBe(
      "Código ya usado (Demo)",
    );
    expect(codeConflict(new ApiError("VALIDATION_ERROR", "Datos inválidos", 422))).toBeUndefined();
    expect(codeConflict(new Error("Código ya usado"))).toBeUndefined();
  });

  it("apiFieldIssue encuentra el mensaje de un campo aunque el path esté anidado", () => {
    const error = new ApiError("VALIDATION_ERROR", "Datos inválidos", 422, null, {
      details: [{ path: ["body", "regime", "calcFamilyId"], message: "Elegí una familia (Demo)" }],
    });
    expect(apiFieldIssue(error, "calcFamilyId")).toBe("Elegí una familia (Demo)");
    expect(apiFieldIssue(error, "moduleId")).toBeUndefined();
    expect(apiFieldIssue(new Error("Sin detalle"), "calcFamilyId")).toBeUndefined();
  });
});
