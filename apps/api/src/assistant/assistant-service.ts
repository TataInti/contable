import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { dec, moneyToString } from "@contable/accounting-engine";

/**
 * Servicio de asistente (Fase 11).
 *
 * Invariantes:
 * - A-001: cifras canónicas 100% exactas (verificación en FastAPI).
 * - A-002: abstención explícita ante falta de datos.
 * - A-003: sin tools prohibidas (catálogo read-only).
 * - A-004: tool call reautorizado en Node (FastAPI no decide permisos).
 * - A-005: prompt injection no ejecuta.
 */

export type AssistantErrorCode =
  | "CONVERSATION_NOT_FOUND"
  | "NO_PERIOD_CONTEXT"
  | "AI_UNAVAILABLE";

export class AssistantError extends Error {
  readonly code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message: string) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
  }
}

export interface AiClientConfig {
  baseUrl: string;
  secret: string;
  serviceId: string;
}

/** Uso informado por el servicio AI; ausente en modo determinista. */
interface AssistantAiUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: string | null;
}

interface AssistantAiResult extends AssistantAiUsage {
  answer: string;
  abstained: boolean;
  abstentionReason: string | null;
  evidence: { kind: string; sourceType: string; sourceId: string; label: string | null; value: string | null }[];
  model: string | null;
  provider: string | null;
  promptVersion: string | null;
}

function nonNegativeInteger(value: number | null | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function decimalCost(value: string | null | undefined): string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? value : "0";
}

export function loadAiClientConfig(): AiClientConfig {
  return {
    baseUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
    secret: process.env.AI_SERVICE_SECRET ?? "",
    serviceId: process.env.AI_SERVICE_ID ?? "api",
  };
}

export class AssistantService {
  constructor(private config: AiClientConfig = loadAiClientConfig()) {}

  /** Crea una conversación. */
  async createConversation(
    ctx: TenantContext,
    input: { clientId: string; periodId?: string; title?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const data: Prisma.AssistantConversationUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        createdByUserId: ctx.userId,
      };
      if (input.periodId !== undefined) data.periodId = input.periodId;
      if (input.title !== undefined) data.title = input.title;
      return tx.assistantConversation.create({ data });
    });
  }

  /**
   * Envía un turno: persiste el mensaje del usuario, llama a FastAPI
   * (A-004: Node autoriza; FastAPI no decide permisos) y persiste la respuesta.
   *
   * La llamada remota se hace FUERA de la transacción de BD (P1: no retener una
   * transacción durante una llamada remota) y con timeout (AbortSignal).
   */
  async sendTurn(
    ctx: TenantContext,
    input: { conversationId: string; query: string },
  ) {
    // 1) Transacción corta: validar conversación, resolver herramientas y
    //    persistir el turno del usuario. No debe convivir con I/O remota.
    const { conversation, userTurn, toolResults } = await withTenantContext(ctx, async (tx) => {
      const conversation = await tx.assistantConversation.findFirst({
        where: { id: input.conversationId, firmId: ctx.firmId },
      });
      if (!conversation) throw new AssistantError("CONVERSATION_NOT_FOUND", "Conversación no encontrada");

      // A-002: sin período → abstención
      if (!conversation.periodId) {
        throw new AssistantError("NO_PERIOD_CONTEXT", "Seleccioná un período para consultar");
      }

      // Persistir turno del usuario
      const userTurn = await tx.assistantTurn.create({
        data: {
          firmId: ctx.firmId,
          clientId: conversation.clientId,
          conversationId: conversation.id,
          role: "USER",
          content: input.query,
        },
      });

      // Resolver herramientas dentro de la misma transacción de lectura.
      const toolResults = await this.resolveToolResults(tx, conversation, input.query);
      return { conversation, userTurn, toolResults };
    });

    // 2) Llamada a FastAPI FUERA de transacción, con timeout.
    const result = await this.callAssistant(ctx, conversation, input.query, toolResults);

    // 3) Transacción corta: persistir el turno del asistente, evidencia y usage.
    return withTenantContext(ctx, async (tx) => {
      const assistantTurn = await tx.assistantTurn.create({
        data: {
          firmId: ctx.firmId,
          clientId: conversation.clientId,
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: result.answer,
          status: result.abstained ? "ABSTAINED" : "COMPLETED",
          abstained: result.abstained,
          abstentionReason: result.abstentionReason,
          model: result.model,
          provider: result.provider,
          promptVersion: result.promptVersion,
          evidence: {
            create: result.evidence.map((e) => ({
              firmId: ctx.firmId,
              clientId: conversation.clientId,
              kind: e.kind,
              sourceType: e.sourceType,
              sourceId: e.sourceId,
              label: e.label ?? null,
              value: e.value ?? null,
            })),
          },
        },
        include: { evidence: true },
      });

      // Registrar usage con los contadores reales cuando la IA los informa.
      await tx.assistantUsage.create({
        data: {
          firmId: ctx.firmId,
          clientId: conversation.clientId,
          conversationId: conversation.id,
          turnId: assistantTurn.id,
          model: result.model ?? "unknown",
          provider: result.provider ?? "internal",
          inputTokens: nonNegativeInteger(result.inputTokens),
          outputTokens: nonNegativeInteger(result.outputTokens),
          costUsd: decimalCost(result.costUsd),
        },
      });

      return { userTurn, assistantTurn };
    });
  }

  /** Lista conversaciones de un cliente. */
  async listConversations(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, async (tx) => {
      return tx.assistantConversation.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { turns: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
      });
    });
  }

  /** Registra feedback de un turno. */
  async addFeedback(
    ctx: TenantContext,
    input: { turnId: string; rating?: number; comment?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const turn = await tx.assistantTurn.findFirst({
        where: { id: input.turnId, firmId: ctx.firmId },
      });
      if (!turn) throw new AssistantError("CONVERSATION_NOT_FOUND", "Turno no encontrado");

      const data: Prisma.AssistantFeedbackUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: turn.clientId,
        turnId: input.turnId,
        createdByUserId: ctx.userId,
      };
      if (input.rating !== undefined) data.rating = input.rating;
      if (input.comment !== undefined) data.comment = input.comment;
      return tx.assistantFeedback.create({ data });
    });
  }

  /** Llama a FastAPI con HMAC (A-004). */
  private async callAssistant(
    ctx: TenantContext,
    conversation: { clientId: string; periodId: string | null },
    query: string,
    toolResults: { name: string; data: Record<string, unknown>; evidence: { kind: string; sourceType: string; sourceId: string; label: string; value: string }[] }[],
  ) {
    const path = "/internal/v1/assistant/runs";
    const payload = {
      contractVersion: "1.0",
      runId: randomUUID(),
      context: {
        firmId: ctx.firmId,
        clientId: conversation.clientId,
        periodId: conversation.periodId,
      },
      history: [],
      query,
      tools: [
        { name: "account_balance", description: "Saldo de cuenta" },
        { name: "trial_balance", description: "Balance de sumas y saldos" },
        { name: "journal", description: "Diario" },
        { name: "ledger", description: "Mayor" },
        { name: "document_lookup", description: "Documento" },
        { name: "obligation_lookup", description: "Obligación" },
      ],
      toolResults,
      promptVersion: "assistant-ar-v1",
    };

    const body = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const message = `POST${path}${timestamp}${nonce}${bodyHash}`;
    const signature = createHmac("sha256", this.config.secret).update(message).digest("hex");

    // Timeout: la llamada remota no puede mantener colgada una request HTTP.
    const timeout = AbortSignal.timeout(15_000);
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
      signal: timeout,
    });

    if (!res.ok) {
      // Sólo el estado HTTP: el texto remoto nunca se propaga al cliente.
      throw new AssistantError("AI_UNAVAILABLE", `El asistente no está disponible (HTTP ${res.status})`);
    }

    return (await res.json()) as AssistantAiResult;
  }

  private async resolveToolResults(
    tx: Prisma.TransactionClient,
    conversation: { clientId: string; periodId: string | null },
    query: string,
  ) {
    if (!conversation.periodId) return [];
    const lines = await tx.journalLine.findMany({
      where: {
        clientId: conversation.clientId,
        entry: { periodId: conversation.periodId, status: { in: ["POSTED", "REVERSED"] } },
      },
      include: { account: true },
    });
    const balances = new Map<string, { id: string; code: string; name: string; value: ReturnType<typeof dec> }>();
    for (const line of lines) {
      const raw = dec(line.debitFunctional.toString()).minus(dec(line.creditFunctional.toString()));
      const value = line.account.normalBalance === "CREDIT" ? raw.negated() : raw;
      const current = balances.get(line.accountId);
      balances.set(line.accountId, {
        id: line.accountId,
        code: line.account.code,
        name: line.account.name,
        value: (current?.value ?? dec(0)).plus(value),
      });
    }
    const normalizedQuery = query.toLocaleLowerCase("es-AR");
    const all = [...balances.values()];
    const selected = all.filter((account) =>
      normalizedQuery.includes(account.code.toLocaleLowerCase("es-AR"))
      || normalizedQuery.includes(account.name.toLocaleLowerCase("es-AR")),
    );
    const visible = (selected.length ? selected : all).slice(0, 20);
    const evidence = visible.map((account) => ({
      kind: "ACCOUNT",
      sourceType: "LEDGER",
      sourceId: account.id,
      label: `${account.code} · ${account.name}`,
      value: moneyToString(account.value),
    }));
    return [{
      name: selected.length ? "account_balance" : "trial_balance",
      data: { periodId: conversation.periodId, accounts: evidence.map(({ sourceId, label, value }) => ({ sourceId, label, value })) },
      evidence,
    }];
  }
}
