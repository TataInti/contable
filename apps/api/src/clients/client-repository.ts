import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { redact } from "../audit/audit-repository.js";
import type {
  CreateClient,
  UpdateClient,
  CreateClientContact,
  UpdateClientContact,
  ClientProfile,
  CreateAccount,
  CreateCounterparty,
  CreateCostCenter,
  CreateFiscalYear,
} from "@contable/contracts";
import { cuitEnding } from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/** Agrega la terminación de CUIT: dato derivado del CUIT, no se guarda (supuesto S2). */
function withCuitEnding<T extends { cuit: string }>(client: T) {
  return { ...client, cuitEnding: cuitEnding(client.cuit) };
}

/**
 * Repositorio de clientes y maestros (Fase 3).
 * Todas las operaciones requieren contexto de firma (withTenantContext).
 */

export class ClientMutationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClientMutationError";
  }
}

interface ClientContactAuditSnapshot {
  name: string;
  function: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

async function lockClientContacts(
  tx: Prisma.TransactionClient,
  firmId: string,
  clientId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${firmId}), hashtext(${clientId}))::text`;
}

function clientContactAuditSnapshot(contact: ClientContactAuditSnapshot): Prisma.InputJsonValue {
  return redact(contact) as Prisma.InputJsonValue;
}

async function recordClientContactAudit(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  input: {
    firmId: string;
    clientId: string;
    contactId: string;
    action: string;
    before?: ClientContactAuditSnapshot;
    after: ClientContactAuditSnapshot;
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      firmId: input.firmId,
      clientId: input.clientId,
      userId: ctx.userId,
      actorKind: ctx.actorKind,
      action: input.action,
      entityType: "ClientContact",
      entityId: input.contactId,
      ...(input.before ? { before: clientContactAuditSnapshot(input.before) } : {}),
      after: clientContactAuditSnapshot(input.after),
    },
  });
}

export class ClientRepository {
  private scoped<T>(ctx: TenantContext | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return ctx ? withTenantContext(ctx, fn) : prisma.$transaction(fn);
  }

  /** Actualiza la identidad y registra before/after en la misma transacción. */
  async updateIdentity(firmId: string, clientId: string, input: UpdateClient, ctx: TenantContext) {
    const data: Prisma.ClientUncheckedUpdateInput = {};
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.tradeName !== undefined) data.tradeName = input.tradeName;
    if (input.cuit !== undefined) data.cuit = input.cuit;
    if (input.status !== undefined) data.status = input.status;

    return this.scoped(ctx, async (tx) => {
      const before = await tx.client.findFirst({ where: { firmId, id: clientId } });
      if (!before) {
        throw new ClientMutationError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");
      }

      const updated = await tx.client.update({ where: { id: clientId }, data });
      await tx.auditEvent.create({
        data: {
          firmId,
          clientId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "client.updated",
          entityType: "Client",
          entityId: clientId,
          before: redact({
            legalName: before.legalName,
            tradeName: before.tradeName,
            cuit: before.cuit,
            status: before.status,
          }) as Prisma.InputJsonValue,
          after: redact({
            legalName: updated.legalName,
            tradeName: updated.tradeName,
            cuit: updated.cuit,
            status: updated.status,
          }) as Prisma.InputJsonValue,
        },
      });
      return updated;
    }).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        throw new ClientMutationError(
          409,
          "CLIENT_CUIT_CONFLICT",
          "Ya existe un cliente con ese CUIT en este estudio.",
        );
      }
      throw error;
    });
  }

  /** Lista contactos activos e inactivos para permitir mostrarlos nuevamente. */
  async listContacts(firmId: string, clientId: string, ctx: TenantContext) {
    return this.scoped(ctx, (tx) =>
      tx.clientContact.findMany({
        where: { firmId, clientId },
        orderBy: [{ isActive: "desc" }, { isPrimary: "desc" }, { name: "asc" }],
      }),
    );
  }

  /** Crea un contacto y mantiene un único principal por cliente. */
  async createContact(
    firmId: string,
    clientId: string,
    input: CreateClientContact,
    ctx: TenantContext,
  ) {
    return this.scoped(ctx, async (tx) => {
      await lockClientContacts(tx, firmId, clientId);

      if (input.isPrimary) {
        const previousPrimary = await tx.clientContact.findFirst({
          where: { firmId, clientId, isPrimary: true },
        });
        if (previousPrimary) {
          const unmarked = await tx.clientContact.update({
            where: { id: previousPrimary.id },
            data: { isPrimary: false },
          });
          await recordClientContactAudit(tx, ctx, {
            firmId,
            clientId,
            contactId: unmarked.id,
            action: "client.contact.updated",
            before: previousPrimary,
            after: unmarked,
          });
        }
      }

      const created = await tx.clientContact.create({
        data: {
          firmId,
          clientId,
          name: input.name,
          function: input.function ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          isPrimary: input.isPrimary,
          isActive: input.isActive,
        },
      });
      await recordClientContactAudit(tx, ctx, {
        firmId,
        clientId,
        contactId: created.id,
        action: "client.contact.created",
        after: created,
      });
      return created;
    }).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        throw new ClientMutationError(
          409,
          "CLIENT_CONTACT_PRIMARY_CONFLICT",
          "No se pudo asignar el contacto principal; actualizá la lista e intentá nuevamente.",
        );
      }
      throw error;
    });
  }

  /** Edita u oculta/muestra un contacto sin borrarlo físicamente. */
  async updateContact(
    firmId: string,
    clientId: string,
    contactId: string,
    input: UpdateClientContact,
    ctx: TenantContext,
  ) {
    const data: Prisma.ClientContactUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.function !== undefined) data.function = input.function;
    if (input.email !== undefined) data.email = input.email;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.scoped(ctx, async (tx) => {
      await lockClientContacts(tx, firmId, clientId);
      const before = await tx.clientContact.findFirst({
        where: { firmId, clientId, id: contactId },
      });
      if (!before) {
        throw new ClientMutationError(404, "CLIENT_CONTACT_NOT_FOUND", "Contacto no encontrado");
      }

      if (input.isPrimary === true && !before.isPrimary) {
        const previousPrimary = await tx.clientContact.findFirst({
          where: { firmId, clientId, isPrimary: true, id: { not: contactId } },
        });
        if (previousPrimary) {
          const unmarked = await tx.clientContact.update({
            where: { id: previousPrimary.id },
            data: { isPrimary: false },
          });
          await recordClientContactAudit(tx, ctx, {
            firmId,
            clientId,
            contactId: unmarked.id,
            action: "client.contact.updated",
            before: previousPrimary,
            after: unmarked,
          });
        }
      }

      const updated = await tx.clientContact.update({ where: { id: contactId }, data });
      const action = input.isActive === undefined || input.isActive === before.isActive
        ? "client.contact.updated"
        : input.isActive
          ? "client.contact.activated"
          : "client.contact.deactivated";
      await recordClientContactAudit(tx, ctx, {
        firmId,
        clientId,
        contactId,
        action,
        before,
        after: updated,
      });
      return updated;
    }).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        throw new ClientMutationError(
          409,
          "CLIENT_CONTACT_PRIMARY_CONFLICT",
          "No se pudo asignar el contacto principal; actualizá la lista e intentá nuevamente.",
        );
      }
      throw error;
    });
  }

  /** Crea un cliente con su perfil por defecto. */
  async create(firmId: string, input: CreateClient, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const clientData: Prisma.ClientUncheckedCreateInput = {
        firmId,
        legalName: input.legalName,
        cuit: input.cuit,
        status: "ONBOARDING",
      };
      if (input.tradeName !== undefined) clientData.tradeName = input.tradeName;

      const client = await tx.client.create({ data: clientData });

      const profileData: Prisma.ClientProfileUncheckedCreateInput = {
        firmId,
        clientId: client.id,
        functionalCurrency: "ARS",
        fiscalYearEndMonth: 12,
      };
      if (input.vatCondition !== undefined) profileData.vatCondition = input.vatCondition;
      if (input.province !== undefined) profileData.province = input.province;
      if (input.activity !== undefined) profileData.activity = input.activity;
      if (input.legalForm !== undefined) profileData.legalForm = input.legalForm;

      await tx.clientProfile.create({ data: profileData });

      await tx.onboardingChecklist.create({
        data: {
          firmId,
          clientId: client.id,
          items: [],
        },
      });

      return client;
    });
  }

  /** Lista clientes de una firma, con su terminación de CUIT derivada. */
  async list(firmId: string, ctx?: TenantContext) {
    const clients = await this.scoped(ctx, (tx) => tx.client.findMany({
      where: { firmId },
      include: { profile: true },
      orderBy: { legalName: "asc" },
    }));
    return clients.map((client) => withCuitEnding(client));
  }

  /** Obtiene un cliente con su perfil y su terminación de CUIT derivada. */
  async get(firmId: string, clientId: string, ctx?: TenantContext) {
    const client = await this.scoped(ctx, (tx) => tx.client.findFirst({
      where: { firmId, id: clientId },
      include: { profile: true, onboarding: true },
    }));
    return client ? withCuitEnding(client) : null;
  }

  /** Actualiza el perfil contable/fiscal del cliente. */
  async updateProfile(firmId: string, clientId: string, input: Partial<ClientProfile>, ctx?: TenantContext) {
    const data: Prisma.ClientProfileUncheckedUpdateInput = {};
    if (input.functionalCurrency !== undefined) data.functionalCurrency = input.functionalCurrency;
    if (input.accountingStandard !== undefined) data.accountingStandard = input.accountingStandard;
    if (input.fiscalYearEndMonth !== undefined) data.fiscalYearEndMonth = input.fiscalYearEndMonth;
    if (input.vatCondition !== undefined) data.vatCondition = input.vatCondition;
    if (input.iibbJurisdictions !== undefined) data.iibbJurisdictions = input.iibbJurisdictions;
    if (input.province !== undefined) data.province = input.province;
    if (input.activity !== undefined) data.activity = input.activity;
    if (input.legalForm !== undefined) data.legalForm = input.legalForm;
    if (input.serviceStartDate !== undefined) data.serviceStartDate = new Date(input.serviceStartDate);

    return this.scoped(ctx, (tx) => tx.clientProfile.update({
      where: { clientId },
      data,
    }));
  }

  /** Crea un ejercicio fiscal y sus períodos mensuales. */
  async createFiscalYear(firmId: string, clientId: string, input: CreateFiscalYear, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const fiscalYear = await tx.fiscalYear.create({
        data: {
          firmId,
          clientId,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          label: input.label,
        },
      });

      // Crear períodos mensuales
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);
      let ordinal = 1;
      // Normalizar al primer día del mes del inicio (evita desfase de zona horaria)
      const firstMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      const lastMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      let cursor = firstMonth;
      while (cursor <= lastMonth) {
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth();
        const monthEnd = new Date(Date.UTC(year, month + 1, 0));
        const periodEnd = monthEnd > end ? end : monthEnd;
        await tx.accountingPeriod.create({
          data: {
            firmId,
            clientId,
            fiscalYearId: fiscalYear.id,
            startDate: cursor,
            endDate: periodEnd,
            ordinal,
          },
        });
        ordinal++;
        cursor = new Date(Date.UTC(year, month + 1, 1));
      }

      return fiscalYear;
    });
  }

  /** Crea una cuenta en el plan de cuentas del cliente. */
  async createAccount(firmId: string, clientId: string, input: CreateAccount, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const parent = input.parentId
        ? await tx.account.findFirst({ where: { firmId, clientId, id: input.parentId } })
        : null;

    const level = parent ? parent.level + 1 : 0;
    const path = parent ? `${parent.path}.${input.code}` : input.code;

    const data: Prisma.AccountUncheckedCreateInput = {
      firmId,
      clientId,
      code: input.code,
      name: input.name,
      type: input.type,
      normalBalance: input.normalBalance,
      level,
      path,
      isPostable: input.isPostable,
      currencyBehavior: input.currencyBehavior,
      monetaryClassification: input.monetaryClassification,
      vatRole: input.vatRole,
    };
    if (input.parentId !== undefined) data.parentId = input.parentId;

      return tx.account.create({ data });
    });
  }

  /** Lista cuentas del cliente. */
  async listAccounts(firmId: string, clientId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.account.findMany({
      where: { firmId, clientId },
      orderBy: { path: "asc" },
    }));
  }

  /** Crea una contraparte. */
  async createCounterparty(firmId: string, clientId: string, input: CreateCounterparty, ctx?: TenantContext) {
    const data: Prisma.CounterpartyUncheckedCreateInput = {
      firmId,
      clientId,
      cuit: input.cuit,
      legalName: input.legalName,
      country: input.country,
      aliases: input.aliases,
    };
    if (input.tradeName !== undefined) data.tradeName = input.tradeName;
    if (input.taxCondition !== undefined) data.taxCondition = input.taxCondition;
    if (input.address !== undefined) data.address = input.address;

    return this.scoped(ctx, (tx) => tx.counterparty.create({ data }));
  }

  /** Lista contrapartes del cliente. */
  async listCounterparties(firmId: string, clientId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.counterparty.findMany({
      where: { firmId, clientId },
      orderBy: { legalName: "asc" },
    }));
  }

  /** Crea un centro de costo. */
  async createCostCenter(firmId: string, clientId: string, input: CreateCostCenter, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.costCenter.create({
      data: { firmId, clientId, code: input.code, name: input.name },
    }));
  }

  /** Lista centros de costo del cliente. */
  async listCostCenters(firmId: string, clientId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.costCenter.findMany({
      where: { firmId, clientId },
      orderBy: { code: "asc" },
    }));
  }
}
