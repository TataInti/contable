import type { PrismaClient } from "@prisma/client";
import { assertTaxEngineCatalogMatchesRegistry } from "@contable/tax-engine";

export async function assertEngineRegistryAtBoot(
  db: Pick<PrismaClient, "taxEngine">,
): Promise<void> {
  const rows = await db.taxEngine.findMany({
    where: { isActive: true },
    select: { engineKey: true, engineVersion: true, isActive: true },
  });
  assertTaxEngineCatalogMatchesRegistry(rows);
}
