import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  clientCreate: vi.fn(async () => ({ id: "client-a" })),
  clientProfileCreate: vi.fn(async () => ({ id: "profile-a" })),
  onboardingCreate: vi.fn(async () => ({ id: "onboarding-a" })),
}));

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../auth/tenant.js", () => ({
  withTenantContext: async (_ctx: unknown, run: (tx: unknown) => Promise<unknown>) =>
    run({
      client: { create: db.clientCreate },
      clientProfile: { create: db.clientProfileCreate },
      onboardingChecklist: { create: db.onboardingCreate },
    }),
}));

import { ClientRepository } from "./client-repository.js";

const tenantContext = { firmId: "firm-a", userId: "user-a", actorKind: "USER" } as const;

describe("ClientRepository.create — perfil categórico", () => {
  it("persiste los cuatro campos del catálogo en el perfil creado", async () => {
    const repo = new ClientRepository();
    const client = await repo.create(
      "firm-a",
      {
        legalName: "Razón social libre S.A.",
        cuit: "20111111112",
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        activity: "COMERCIO — Comercio",
        legalForm: "Sociedad anónima (SA)",
      },
      tenantContext,
    );

    expect(client.id).toBe("client-a");
    expect(db.clientProfileCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmId: "firm-a",
        clientId: "client-a",
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        activity: "COMERCIO — Comercio",
        legalForm: "Sociedad anónima (SA)",
      }),
    });
  });
});
