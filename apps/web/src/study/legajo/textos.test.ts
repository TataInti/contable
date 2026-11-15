import { describe, expect, it } from "vitest";
import { identificadorCorto, pluralizar } from "./textos";

describe("pluralizar", () => {
  it("usa el singular solo con uno; el cero y el dos van en plural", () => {
    expect(pluralizar(0, "movimiento", "movimientos")).toBe("0 movimientos");
    expect(pluralizar(1, "movimiento", "movimientos")).toBe("1 movimiento");
    expect(pluralizar(2, "control bloqueante", "controles bloqueantes")).toBe(
      "2 controles bloqueantes",
    );
  });
});

describe("identificadorCorto", () => {
  it("deja los ocho primeros caracteres de un identificador largo", () => {
    expect(identificadorCorto("Cierre 01a1de63-eb18-4c2a-9d3e-6f7a8b9c0d1e · versión 2")).toBe(
      "Cierre 01a1de63 · versión 2",
    );
  });

  it("no cambia un texto sin identificador", () => {
    expect(identificadorCorto("Carga manual · Ana")).toBe("Carga manual · Ana");
  });
});
