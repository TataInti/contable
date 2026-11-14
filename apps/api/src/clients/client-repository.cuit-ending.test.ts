import { beforeEach, describe, expect, it, vi } from "vitest";

// Repositorio sin base de datos: las consultas Prisma se reemplazan por una transacción falsa.
const tx = vi.hoisted(() => ({
  client: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn((fn: (client: unknown) => unknown) => fn(tx)),
  },
}));

import { ClientRepository } from "./client-repository.js";

const FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("ClientRepository: terminación de CUIT derivada", () => {
  beforeEach(() => {
    tx.client.findMany.mockReset();
    tx.client.findFirst.mockReset();
  });

  it("list devuelve cuitEnding en cada cliente y null cuando falta el CUIT", async () => {
    tx.client.findMany.mockResolvedValue([
      { id: "c1", legalName: "Cliente sintético 01", cuit: "20000000079" },
      { id: "c2", legalName: "Cliente sintético 02", cuit: "" },
    ]);

    const rows = await new ClientRepository().list(FIRM);

    expect(rows.map((row) => [row.id, row.cuitEnding])).toEqual([
      ["c1", "9"],
      ["c2", null],
    ]);
  });

  it("get devuelve cuitEnding en el detalle del cliente", async () => {
    tx.client.findFirst.mockResolvedValue({
      id: "c1",
      cuit: "20000000060",
      profile: null,
      onboarding: null,
    });

    const client = await new ClientRepository().get(FIRM, "c1");

    expect(client?.cuitEnding).toBe("0");
    expect(client?.cuit).toBe("20000000060");
  });

  it("get devuelve null cuando el cliente no existe", async () => {
    tx.client.findFirst.mockResolvedValue(null);

    await expect(new ClientRepository().get(FIRM, "inexistente")).resolves.toBeNull();
  });
});
