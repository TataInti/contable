import { describe, expect, it, vi } from "vitest";
import { TAX_ENGINE_DECLARATIONS } from "@contable/tax-engine";
import { assertEngineRegistryAtBoot } from "./engine-registry-boot.js";

const activeRows = TAX_ENGINE_DECLARATIONS.map(({ engineKey, engineVersion }) => ({
  engineKey,
  engineVersion,
  isActive: true,
}));

describe("verificación de motores al arrancar", () => {
  it("consulta el catálogo activo y valida sus nueve implementaciones", async () => {
    const findMany = vi.fn().mockResolvedValue(activeRows);
    const db = { taxEngine: { findMany } } as unknown as Parameters<typeof assertEngineRegistryAtBoot>[0];

    await expect(assertEngineRegistryAtBoot(db)).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { engineKey: true, engineVersion: true, isActive: true },
    });
  });

  it("falla con el diagnóstico del registro si falta un motor del catálogo", async () => {
    const findMany = vi.fn().mockResolvedValue(activeRows.filter((row) => row.engineKey !== "tem-smt"));
    const db = { taxEngine: { findMany } } as unknown as Parameters<typeof assertEngineRegistryAtBoot>[0];

    await expect(assertEngineRegistryAtBoot(db)).rejects.toThrow(/sin fila activa \[tem-smt\]/);
  });
});
