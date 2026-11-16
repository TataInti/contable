import { describe, expect, it } from "vitest";
import { createUploadSessionSchema } from "./clients.js";

const REQUEST_ITEM_ID = "11111111-1111-4111-8111-111111111111";

describe("createUploadSessionSchema sin pedido documental (caracterización, corte 5b-1)", () => {
  it("acepta la constancia ACUSE sin pedido", () => {
    expect(createUploadSessionSchema.safeParse({ category: "ACUSE" }).success).toBe(true);
  });

  it("rechaza una categoría ajena sin pedido", () => {
    expect(createUploadSessionSchema.safeParse({ category: "OTRO" }).success).toBe(false);
  });

  it("rechaza una sesión sin pedido ni categoría con el mensaje de pedido", () => {
    const result = createUploadSessionSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "El archivo debe corresponder a un ítem de pedido",
    ]);
  });

  it("acepta un documento de pedido sin categoría", () => {
    expect(createUploadSessionSchema.safeParse({ requestItemId: REQUEST_ITEM_ID }).success).toBe(
      true,
    );
  });

  it("acepta la constancia ACUSE con pedido documental", () => {
    expect(
      createUploadSessionSchema.safeParse({ category: "ACUSE", requestItemId: REQUEST_ITEM_ID })
        .success,
    ).toBe(true);
  });
});

describe("createUploadSessionSchema con la declaración jurada (pruebas en rojo, corte 5b-1)", () => {
  it("acepta la declaración jurada sin pedido", () => {
    expect(createUploadSessionSchema.safeParse({ category: "DECLARACION_JURADA" }).success).toBe(
      true,
    );
  });

  it("acepta la declaración jurada con pedido documental, igual que el acuse", () => {
    expect(
      createUploadSessionSchema.safeParse({
        category: "DECLARACION_JURADA",
        requestItemId: REQUEST_ITEM_ID,
      }).success,
    ).toBe(true);
  });

  it("explica en lenguaje llano qué elegir cuando la categoría no admite el archivo sin pedido", () => {
    const result = createUploadSessionSchema.safeParse({ category: "OTRO" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Para subir un archivo sin pedido, elegí la categoría Acuse de presentación o Declaración jurada.",
    ]);
  });
});
