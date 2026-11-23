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

import { ClientMutationError, ClientRepository } from "./client-repository.js";

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

  it("un CUIT repetido en el estudio es un 409 CLIENT_CUIT_DUPLICATE y no un error interno", async () => {
    db.clientCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`firmId`,`cuit`)"), {
        code: "P2002",
      }),
    );
    const repo = new ClientRepository();
    const attempt = repo.create(
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

    await expect(attempt).rejects.toBeInstanceOf(ClientMutationError);
    await expect(attempt).rejects.toMatchObject({
      statusCode: 409,
      code: "CLIENT_CUIT_DUPLICATE",
      message: "Ya existe un cliente con ese CUIT en el estudio.",
    });
  });
});
