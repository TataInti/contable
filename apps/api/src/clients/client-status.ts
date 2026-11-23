import { isClientConfigurationComplete } from "@contable/contracts";
import { Prisma } from "@prisma/client";
import type { TenantContext } from "../auth/tenant.js";

export async function activateIfConfigurationComplete(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  clientId: string,
): Promise<boolean> {
  const client = await tx.client.findFirst({
    where: { id: clientId, firmId: ctx.firmId },
    select: { id: true, status: true, profile: { select: { id: true } } },
  });
  if (!client || client.status !== "ONBOARDING") return false;

  const activeProfile = await tx.taxpayerProfileVersion.findFirst({
    where: { firmId: ctx.firmId, clientId, status: "ACTIVE" },
    select: { id: true },
  });
  const [registration, activity, period, obligation] = activeProfile
    ? await Promise.all([
        tx.taxRegistration.findFirst({
          where: { firmId: ctx.firmId, clientId, profileVersionId: activeProfile.id, status: "ACTIVE" },
          select: { id: true },
        }),
        tx.clientActivity.findFirst({
          where: { firmId: ctx.firmId, clientId, profileVersionId: activeProfile.id, validTo: null },
          select: { id: true },
        }),
        tx.taxPeriod.findFirst({ where: { firmId: ctx.firmId, clientId }, select: { id: true } }),
        tx.taxObligation.findFirst({
          where: { firmId: ctx.firmId, clientId, profileVersionId: activeProfile.id },
          select: { id: true },
        }),
      ])
    : [null, null, null, null];

  if (!isClientConfigurationComplete({
    hasAccountingProfile: Boolean(client.profile),
    hasActiveFiscalProfile: Boolean(activeProfile),
    hasActiveRegistration: Boolean(registration),
    hasActiveActivity: Boolean(activity),
    hasTaxPeriod: Boolean(period),
    hasObligation: Boolean(obligation),
  })) {
    return false;
  }

  const changed = await tx.client.updateMany({
    where: { id: clientId, firmId: ctx.firmId, status: "ONBOARDING" },
    data: { status: "ACTIVE" },
  });
  if (changed.count === 0) return false;

  await tx.auditEvent.create({
    data: {
      firmId: ctx.firmId,
      clientId,
      userId: ctx.userId,
      actorKind: ctx.actorKind,
      action: "client.status.automatically_activated",
      entityType: "Client",
      entityId: clientId,
      before: { status: "ONBOARDING" },
      after: { status: "ACTIVE", reason: "CONFIGURATION_COMPLETE" },
    },
  });
  return true;
}
