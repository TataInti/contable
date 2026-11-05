import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { CreateClient, ClientProfile, CreateAccount, CreateCounterparty, CreateCostCenter, CreateFiscalYear } from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Repositorio de clientes y maestros (Fase 3).
 * Todas las operaciones requieren contexto de firma (withTenantContext).
 */

export class ClientRepository {
  private scoped<T>(ctx: TenantContext | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return ctx ? withTenantContext(ctx, fn) : prisma.$transaction(fn);
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

  /** Lista clientes de una firma. */
  async list(firmId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.client.findMany({
      where: { firmId },
      include: { profile: true },
      orderBy: { legalName: "asc" },
    }));
  }

  /** Obtiene un cliente con su perfil. */
  async get(firmId: string, clientId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.client.findFirst({
      where: { firmId, id: clientId },
      include: { profile: true, onboarding: true },
    }));
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
