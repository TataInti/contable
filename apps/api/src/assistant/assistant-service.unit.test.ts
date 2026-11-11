import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantError, AssistantService } from "./assistant-service.js";

/**
 * Pruebas unitarias del servicio de asistente que no tocan la base:
 * saneamiento de errores remotos y pass-through del uso informado por la IA.
 */

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorKind: "USER" as const,
};
const conversation = { clientId: "11111111-2222-4333-8444-999999999999", periodId: "2026-01" };

function service(): AssistantService {
  return new AssistantService({ baseUrl: "http://ai.test", secret: "test", serviceId: "api" });
}

function callAssistant(instance: AssistantService) {
  return (
    instance as unknown as {
      callAssistant: (...args: unknown[]) => Promise<unknown>;
    }
  ).callAssistant.bind(instance);
}

describe("assistant-service (unitario)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("devuelve un mensaje seguro sin el texto remoto ante HTTP 500", async () => {
    const remoteDetail = "upstream-secret-detail-xyz";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(remoteDetail, { status: 500 })),
    );

    const error = await callAssistant(service())(ctx, conversation, "¿Saldo?", []).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AssistantError);
    const assistantError = error as AssistantError;
    expect(assistantError.code).toBe("AI_UNAVAILABLE");
    expect(assistantError.message).not.toContain(remoteDetail);
    expect(assistantError.message).toContain("500");
  });

  it("propaga los contadores de uso informados por la IA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              answer: "El saldo de caja es $100.000,00",
              abstained: false,
              abstentionReason: null,
              evidence: [],
              model: "anthropic/claude-haiku-5.5",
              provider: "Amazon Bedrock",
              promptVersion: "assistant-ar-v1",
              inputTokens: 812,
              outputTokens: 37,
              costUsd: "0.000431",
            }),
            { status: 200 },
          ),
      ),
    );

    const result = (await callAssistant(service())(ctx, conversation, "¿Saldo?", [])) as {
      provider: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: string;
    };

    expect(result.provider).toBe("Amazon Bedrock");
    expect(result.inputTokens).toBe(812);
    expect(result.outputTokens).toBe(37);
    expect(result.costUsd).toBe("0.000431");
  });
});
