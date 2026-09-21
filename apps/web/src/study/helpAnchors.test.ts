import { describe, expect, it } from "vitest";
import { HELP_ANCHOR_BY_PATH, HELP_DEFAULT_ANCHOR, helpHrefForPath } from "./helpAnchors";

describe("anclas de ayuda paso a paso", () => {
  it("abre el capítulo de la pantalla activa", () => {
    expect(helpHrefForPath("/bandeja")).toBe("/ayuda#bandeja");
    expect(helpHrefForPath("/expediente-mensual")).toBe("/ayuda#expediente");
    expect(helpHrefForPath("/liquidaciones")).toBe("/ayuda#liquidaciones");
    expect(helpHrefForPath("/configuracion-fiscal")).toBe("/ayuda#configuracion-fiscal");
  });

  it("cae al circuito mensual si la ruta no tiene capítulo propio", () => {
    expect(helpHrefForPath("/no-existe")).toBe(`/ayuda#${HELP_DEFAULT_ANCHOR}`);
  });

  it("cubre las pantallas liberadas de trabajo diario", () => {
    for (const path of [
      "/",
      "/clientes",
      "/bandeja",
      "/trabajo",
      "/expediente-mensual",
      "/liquidaciones",
      "/rentabilidad",
      "/administracion",
      "/reglas-fiscales",
    ]) {
      expect(HELP_ANCHOR_BY_PATH[path]).toBeTruthy();
    }
  });
});
