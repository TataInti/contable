import type { Capability, FirmRole } from "./capabilities.js";

/** Capacidades por rol. Owner/admin ven toda la firma; el resto sólo clientes asignados. */
const ROLE_CAPABILITIES: Record<FirmRole, ReadonlySet<Capability>> = {
  OWNER: new Set([
    "firm.manage",
    "firm.self_review.manage",
    "firm.users.manage",
    "firm.audit.read",
    "client.read",
    "client.manage",
    "client.assign",
    "data.delete",
    "document.upload",
    "document.prepare",
    "document.review",
    "entry.create",
    "entry.submit",
    "entry.review",
    "entry.post",
    "entry.reverse",
    "period.soft_close",
    "period.hard_close",
    "period.reopen",
    "bank.import",
    "bank.reconcile",
    "vat.calculate",
    "vat.review",
    "vat.finalize",
    "report.configure",
    "report.run",
    "report.review",
    "report.publish",
    "obligation.manage",
    "request.manage",
    "message.internal",
    "message.shared",
    "ai.use",
    "bi.use",
    "tax.profile.read",
    "tax.profile.write",
    "tax.rules.read",
    "tax.rules.propose",
    "tax.rules.approve",
    "tax.rules.activate",
    "tax.vouchers.read",
    "tax.vouchers.prepare",
    "tax.vouchers.review",
    "tax.settlements.read",
    "tax.settlements.calculate",
    "tax.settlements.submit_review",
    "tax.settlements.review",
    "tax.settlements.finalize",
    "tax.settlements.rectify",
    "tax.settlements.export",
    "tax.filings.record",
    "tax.payments.record",
    "tax.management_expenses.read",
    "tax.management_expenses.write",
    "tax.management_expenses.approve_treatment",
    "profitability.read",
    "profitability.calculate",
    "profitability.publish",
  ]),
  ADMIN: new Set([
    "firm.manage",
    "firm.users.manage",
    "firm.audit.read",
    "client.read",
    "client.manage",
    "client.assign",
    "document.upload",
    "document.prepare",
    "document.review",
    "entry.create",
    "entry.submit",
    "entry.review",
    "entry.post",
    "entry.reverse",
    "period.soft_close",
    "period.hard_close",
    "period.reopen",
    "bank.import",
    "bank.reconcile",
    "vat.calculate",
    "vat.review",
    "vat.finalize",
    "report.configure",
    "report.run",
    "report.review",
    "report.publish",
    "obligation.manage",
    "request.manage",
    "message.internal",
    "message.shared",
    "ai.use",
    "bi.use",
    "tax.profile.read",
    "tax.profile.write",
    "tax.rules.read",
    "tax.rules.propose",
    "tax.rules.approve",
    "tax.rules.activate",
    "tax.vouchers.read",
    "tax.vouchers.prepare",
    "tax.vouchers.review",
    "tax.settlements.read",
    "tax.settlements.calculate",
    "tax.settlements.submit_review",
    "tax.settlements.review",
    "tax.settlements.finalize",
    "tax.settlements.rectify",
    "tax.settlements.export",
    "tax.filings.record",
    "tax.payments.record",
    "tax.management_expenses.read",
    "tax.management_expenses.write",
    "tax.management_expenses.approve_treatment",
    "profitability.read",
    "profitability.calculate",
    "profitability.publish",
  ]),
  PREPARER: new Set([
    "client.read",
    "document.upload",
    "document.prepare",
    "entry.create",
    "entry.submit",
    "bank.import",
    "vat.calculate",
    "report.run",
    "obligation.manage",
    "request.manage",
    "message.internal",
    "message.shared",
    "ai.use",
    "bi.use",
    "tax.profile.read",
    "tax.profile.write",
    "tax.rules.read",
    "tax.vouchers.read",
    "tax.vouchers.prepare",
    "tax.settlements.read",
    "tax.settlements.calculate",
    "tax.settlements.submit_review",
    "tax.settlements.export",
    "tax.management_expenses.read",
    "tax.management_expenses.write",
    "profitability.read",
    "profitability.calculate",
  ]),
  REVIEWER: new Set([
    "client.read",
    "document.upload",
    "document.review",
    "entry.review",
    "entry.post",
    "entry.reverse",
    "period.soft_close",
    "period.hard_close",
    "bank.reconcile",
    "vat.review",
    "vat.finalize",
    "report.run",
    "report.review",
    "report.publish",
    "obligation.manage",
    "request.manage",
    "message.internal",
    "message.shared",
    "ai.use",
    "bi.use",
    "tax.profile.read",
    "tax.rules.read",
    "tax.vouchers.read",
    "tax.vouchers.review",
    "tax.settlements.read",
    "tax.settlements.review",
    "tax.settlements.finalize",
    "tax.settlements.rectify",
    "tax.settlements.export",
    "tax.filings.record",
    "tax.payments.record",
    "tax.management_expenses.read",
    "tax.management_expenses.approve_treatment",
    "profitability.read",
    "profitability.calculate",
    "profitability.publish",
  ]),
  AUDITOR_READONLY: new Set([
    "firm.audit.read",
    "client.read",
    "report.run",
    "tax.profile.read",
    "tax.rules.read",
    "tax.vouchers.read",
    "tax.settlements.read",
    "tax.management_expenses.read",
    "profitability.read",
  ]),
};

export interface RoleContext {
  role: FirmRole;
  isAssignedToClient: boolean;
  isPortalMember: boolean;
}

export interface CapabilityContext {
  /** Capacidades otorgadas por rol. */
  capabilities: ReadonlySet<Capability>;
  /** true si el usuario es owner/admin (acceso a toda la firma). */
  firmWide: boolean;
  /** true si el usuario tiene asignación al cliente actual. */
  assignedToClient: boolean;
}

/** Capacidades de rol (sin aplicar scope de cliente). */
export function capabilitiesForRole(role: FirmRole): ReadonlySet<Capability> {
  return ROLE_CAPABILITIES[role];
}

/**
 * Resuelve el contexto de capacidades para un usuario y un cliente concreto.
 * Owner/admin acceden a toda la firma sin asignación; los demás requieren asignación.
 */
export function resolveCapabilities(ctx: RoleContext): CapabilityContext {
  const firmWide = ctx.role === "OWNER" || ctx.role === "ADMIN";
  const capabilities = capabilitiesForRole(ctx.role);

  if (firmWide) {
    return { capabilities, firmWide, assignedToClient: true };
  }

  if (!ctx.isAssignedToClient) {
    // Sin asignación: capacidades de lectura mínimas sólo si el rol las tiene,
    // pero ningún acceso a cliente concreto.
    return { capabilities: new Set<Capability>(), firmWide: false, assignedToClient: false };
  }

  return { capabilities, firmWide: false, assignedToClient: true };
}

/** Verifica una capacidad dentro de un contexto resuelto. */
export function hasCapability(ctx: CapabilityContext, capability: Capability): boolean {
  return ctx.assignedToClient && ctx.capabilities.has(capability);
}
