import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { dec, moneyToString } from "@contable/accounting-engine";

/**
 * Servicio BI (Fase 12).
 *
 * Invariantes:
 * - A-006: plan inválido nunca ejecuta (validación en Node).
 * - A-007: widget conserva fuente/versión/cutoff.
 * - A-008: cifras BI = motor canónico (mismo cálculo que reportes).
 * - No existe SQL libre.
 */

export type BiErrorCode =
  | "PLAN_REJECTED"
  | "METRIC_NOT_FOUND"
  | "DASHBOARD_NOT_FOUND"
  | "WIDGET_NOT_FOUND"
  | "AI_UNAVAILABLE";

export class BiError extends Error {
  readonly code: BiErrorCode;
  constructor(code: BiErrorCode, message: string) {
    super(message);
    this.name = "BiError";
    this.code = code;
  }
}

export interface AiClientConfig {
  baseUrl: string;
  secret: string;
  serviceId: string;
}

export function loadAiClientConfig(): AiClientConfig {
  return {
    baseUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
    secret: process.env.AI_SERVICE_SECRET ?? "",
    serviceId: process.env.AI_SERVICE_ID ?? "api",
  };
}

interface BiPlan {
  version: number;
  clientId: string;
  fiscalPeriodId: string;
  metric: string;
  dimensions: string[];
  filters: { field: string; operator: string; value: string | string[] }[];
  comparison: string;
  limit: number;
}

export type { BiPlan };

export class BiService {
  constructor(private config: AiClientConfig = loadAiClientConfig()) {}

  /** Crea una métrica versionada. */
  async createMetric(
    ctx: TenantContext,
    input: { clientId: string; code: string; name: string; definition: unknown },
  ) {
    return withTenantContext(ctx, async (tx) => {
      return tx.biMetric.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          code: input.code,
          name: input.name,
          definition: input.definition as Prisma.InputJsonValue,
        },
      });
    });
  }

  /** Crea un dashboard. */
  async createDashboard(
    ctx: TenantContext,
    input: { clientId: string; name: string; layout?: unknown },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const data: Prisma.BiDashboardUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        name: input.name,
        createdByUserId: ctx.userId,
      };
      if (input.layout !== undefined) data.layout = input.layout as Prisma.InputJsonValue;
      return tx.biDashboard.create({ data });
    });
  }

  /**
   * Genera un plan BI vía FastAPI y lo valida en Node (A-006).
   * Plan rechazado → nunca ejecuta.
   */
  async plan(
    ctx: TenantContext,
    input: { clientId: string; periodId: string; query: string },
  ) {
    const path = "/internal/v1/bi/plan";
    const payload = {
      contractVersion: "1.0",
      runId: randomUUID(),
      context: {
        firmId: ctx.firmId,
        clientId: input.clientId,
        periodId: input.periodId,
      },
      query: input.query,
      metricCatalog: ["total_revenue", "total_expenses", "net_income", "total_assets", "total_liabilities", "equity"],
      dimensionCatalog: ["account", "period", "counterparty", "cost_center"],
    };

    const body = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const message = `POST${path}${timestamp}${nonce}${bodyHash}`;
    const signature = createHmac("sha256", this.config.secret).update(message).digest("hex");

    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Id": this.config.serviceId,
        "X-Service-Timestamp": timestamp,
        "X-Service-Nonce": nonce,
        "X-Service-Signature": signature,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new BiError("AI_UNAVAILABLE", `AI falló: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { plan: BiPlan | null; rejected: boolean; rejectionReason: string | null };
    if (data.rejected || !data.plan) {
      throw new BiError("PLAN_REJECTED", data.rejectionReason ?? "Plan rechazado");
    }

    // A-006: validación adicional en Node (métrica conocida, cardinalidad)
    const allowedMetrics = new Set(["total_revenue", "total_expenses", "net_income", "total_assets", "total_liabilities", "equity"]);
    if (!allowedMetrics.has(data.plan.metric)) {
      throw new BiError("PLAN_REJECTED", "Métrica no permitida");
    }
    if (data.plan.dimensions.length > 3) {
      throw new BiError("PLAN_REJECTED", "Cardinalidad excesiva");
    }

    return data.plan;
  }

  /**
   * Ejecuta un plan contra el motor contable (A-008: cifras canónicas).
   * Calcula la métrica desde el mayor, igual que los reportes.
   */
  async execute(
    ctx: TenantContext,
    input: { clientId: string; plan: BiPlan },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const metric = await tx.biMetric.findFirst({
        where: { firmId: ctx.firmId, clientId: input.clientId, code: input.plan.metric, isActive: true },
      });
      if (!metric) throw new BiError("METRIC_NOT_FOUND", "Métrica no encontrada");

      // Líneas posteadas del período (motor canónico)
      const lines = await tx.journalLine.findMany({
        where: {
          clientId: input.clientId,
          entry: {
            status: { in: ["POSTED", "REVERSED"] },
            periodId: input.plan.fiscalPeriodId,
          },
        },
        include: { account: true },
      });

      // Calcular métrica según tipo
      let value = dec(0);
      for (const line of lines) {
        // El neto se invierte para cuentas con saldo normal CREDIT (revenue, liability, equity)
        const raw = dec(line.debitFunctional.toString()).minus(dec(line.creditFunctional.toString()));
        const net = line.account.normalBalance === "CREDIT" ? raw.negated() : raw;
        switch (input.plan.metric) {
          case "total_revenue":
            if (line.account.type === "REVENUE") value = value.plus(net);
            break;
          case "total_expenses":
            if (line.account.type === "EXPENSE") value = value.plus(net);
            break;
          case "total_assets":
            if (line.account.type === "ASSET") value = value.plus(net);
            break;
          case "total_liabilities":
            if (line.account.type === "LIABILITY") value = value.plus(net);
            break;
          case "equity":
            if (line.account.type === "EQUITY") value = value.plus(net);
            break;
          case "net_income":
            if (line.account.type === "REVENUE") value = value.plus(net);
            if (line.account.type === "EXPENSE") value = value.minus(net);
            break;
        }
      }

      const result = {
        metric: input.plan.metric,
        metricVersion: metric.version,
        cutoff: input.plan.fiscalPeriodId,
        value: moneyToString(value),
        dimensions: input.plan.dimensions,
        source: "LEDGER",
        generatedAt: new Date().toISOString(),
      };

      // A-007: hash reproducible (fuente + versión + cutoff)
      const resultHash = createHash("sha256")
        .update(JSON.stringify({ metric: input.plan.metric, metricVersion: metric.version, cutoff: input.plan.fiscalPeriodId, value: result.value }))
        .digest("hex");

      return { result, resultHash, metric };
    });
  }

  /** Crea un widget en un dashboard (A-007: conserva fuente/versión/cutoff). */
  async createWidget(
    ctx: TenantContext,
    input: { clientId: string; dashboardId: string; title: string; plan: BiPlan; result: unknown; resultHash: string; metricId: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const dashboard = await tx.biDashboard.findFirst({
        where: { id: input.dashboardId, firmId: ctx.firmId },
      });
      if (!dashboard) throw new BiError("DASHBOARD_NOT_FOUND", "Dashboard no encontrado");

      return tx.biWidget.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          dashboardId: input.dashboardId,
          metricId: input.metricId,
          title: input.title,
          plan: input.plan as unknown as Prisma.InputJsonValue,
          cutoff: new Date(),
          status: "READY",
          result: input.result as Prisma.InputJsonValue,
          resultHash: input.resultHash,
          source: "LEDGER",
        },
      });
    });
  }

  /** Guarda un snapshot del dashboard (reproducible). */
  async snapshot(ctx: TenantContext, dashboardId: string, cutoff: string) {
    return withTenantContext(ctx, async (tx) => {
      const dashboard = await tx.biDashboard.findFirst({
        where: { id: dashboardId, firmId: ctx.firmId },
        include: { widgets: true },
      });
      if (!dashboard) throw new BiError("DASHBOARD_NOT_FOUND", "Dashboard no encontrado");

      const resultHash = createHash("sha256")
        .update(JSON.stringify({ dashboardId, cutoff, widgets: dashboard.widgets.map((w) => w.resultHash) }))
        .digest("hex");

      return tx.biSnapshot.create({
        data: {
          firmId: ctx.firmId,
          clientId: dashboard.clientId,
          dashboardId,
          cutoff: new Date(cutoff),
          resultHash,
          result: {
            widgets: dashboard.widgets.map((w) => ({ id: w.id, title: w.title, resultHash: w.resultHash })),
          } as Prisma.InputJsonValue,
        },
      });
    });
  }
}