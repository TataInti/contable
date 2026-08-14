import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { FeatureFlagService } from "./feature-flag-service.js";

/**
 * Tests de integración de feature flags (Fase 13).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-111111111111";

const flags = new FeatureFlagService();
const ctx = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

describe("feature flags (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM feature_flags WHERE "firmId" = '${FIRM_ALFA}'`);
  });

  it("flag deshabilitado por defecto", async () => {
    const enabled = await flags.isEnabled(ctx, "LEDGER");
    expect(enabled).toBe(false);
  });

  it("habilita y consulta un flag de firma", async () => {
    await flags.set(ctx, { code: "LEDGER", enabled: true });
    const enabled = await flags.isEnabled(ctx, "LEDGER");
    expect(enabled).toBe(true);
  });

  it("flag de cliente sobreescribe flag de firma", async () => {
    await flags.set(ctx, { code: "PORTAL", enabled: true });
    await flags.set(ctx, { code: "PORTAL", enabled: false, clientId: CLIENT_ALFA });

    // Firma habilitada, cliente deshabilitado
    expect(await flags.isEnabled(ctx, "PORTAL")).toBe(true);
    expect(await flags.isEnabled(ctx, "PORTAL", CLIENT_ALFA)).toBe(false);
  });

  it("lista flags de la firma", async () => {
    await flags.set(ctx, { code: "BI", enabled: true });
    const list = await flags.list(ctx);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((f) => f.code === "BI" && f.enabled)).toBe(true);
  });
});