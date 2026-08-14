import { prisma } from "../lib/prisma.js";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Alta de firmas, membresías, invitaciones y asignaciones.
 * La creación de una firma y su owner se hace SIN contexto de firma (sinTenant),
 * porque la firma aún no existe.
 */

export class FirmRepository {
  async createFirmForExistingOwner(input: { actorId: string; legalName: string; displayName: string; taxId: string | null }) {
    const rows = await prisma.$queryRaw<{ id: string; legalName: string; displayName: string; taxId: string | null }[]>`
      SELECT * FROM app_create_firm_for_owner(${input.actorId}, ${input.legalName}, ${input.displayName}, ${input.taxId})
    `;
    return rows[0] ?? null;
  }
  /** Crea un miembro de firma (owner/admin). */
  async addMember(firmId: string, userId: string, role: string, ctx?: TenantContext) {
    const execute = (tx: Parameters<Parameters<typeof withTenantContext>[1]>[0]) => tx.firmMembership.create({
      data: { firmId, userId, role: role as never, status: "ACTIVE", acceptedAt: new Date() },
    });
    return ctx ? withTenantContext(ctx, execute) : execute(prisma);
  }

  /** Lista las membresías de un usuario. */
  async membershipsForUser(userId: string) {
    return prisma.firmMembership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { firm: true },
    });
  }

  /** Resuelve el rol de un usuario dentro de una firma. */
  async roleInFirm(userId: string, firmId: string) {
    const membership = await prisma.firmMembership.findFirst({
      where: { userId, firmId, status: "ACTIVE" },
    });
    return membership?.role ?? null;
  }

  /** Asigna un cliente a un usuario. */
  async assignClient(firmId: string, userId: string, clientId: string, ctx?: TenantContext) {
    const execute = (tx: Parameters<Parameters<typeof withTenantContext>[1]>[0]) => tx.clientAssignment.create({
      data: { firmId, userId, clientId },
    });
    return ctx ? withTenantContext(ctx, execute) : execute(prisma);
  }
}
