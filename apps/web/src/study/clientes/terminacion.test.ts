import { describe, expect, it } from "vitest";
import type { ClientWithProfile } from "./tipos";
import { CUIT_ENDINGS, endingGroup, parseEndingFilter } from "./terminacion";

const fila = (cuitEnding: string | null) => ({ cuitEnding }) as unknown as ClientWithProfile;

describe("terminación de CUIT", () => {
  it("lista los dígitos del 0 al 9 en orden", () => {
    expect(CUIT_ENDINGS).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("lee el filtro de la URL: solo dígitos válidos, sin repetidos y siempre en orden", () => {
    expect(parseEndingFilter(null)).toEqual([]);
    expect(parseEndingFilter("")).toEqual([]);
    expect(parseEndingFilter("9,1,9,x,10,")).toEqual(["1", "9"]);
    expect(parseEndingFilter("7,0")).toEqual(["0", "7"]);
  });

  it("agrupa por dígito con su etiqueta y deja «Sin CUIT» al final", () => {
    expect(endingGroup(fila("7"))).toEqual({ key: "7", label: "Terminación de CUIT 7", order: 7 });
    expect(endingGroup(fila(null))).toEqual({ key: "sin-cuit", label: "Sin CUIT", order: 10 });
  });
});
