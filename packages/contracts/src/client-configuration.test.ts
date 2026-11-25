import { describe, expect, it } from "vitest";
import { clientConfigurationMissing, isClientConfigurationComplete } from "./client-configuration.js";

const ready = {
  hasAccountingProfile: true,
  hasActiveFiscalProfile: true,
  hasActiveRegistration: true,
  hasActiveActivity: true,
  hasTaxPeriod: true,
  hasObligation: true,
};

describe("preparación del cliente", () => {
  it("solo está lista cuando no hay faltantes", () => {
    expect(clientConfigurationMissing(ready)).toEqual([]);
    expect(isClientConfigurationComplete(ready)).toBe(true);
  });

  it("devuelve cada paso faltante en orden con destino preciso", () => {
    expect(clientConfigurationMissing({ ...ready, hasActiveActivity: false, hasObligation: false })).toEqual([
      { key: "actividades", label: "actividad fiscal", step: "actividades" },
      { key: "obligaciones", label: "obligación", step: "obligaciones" },
    ]);
    expect(isClientConfigurationComplete({ ...ready, hasActiveActivity: false })).toBe(false);
  });

  it("no considera una actividad contable opcional como requisito fiscal", () => {
    expect(clientConfigurationMissing(ready)).not.toContainEqual(expect.objectContaining({ label: "actividad principal" }));
  });
});
