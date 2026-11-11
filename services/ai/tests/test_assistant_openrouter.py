"""Pruebas del asistente con OpenRouter simulado (sin red ni datos reales)."""

from __future__ import annotations

import json
import logging
from typing import Any, Self

import httpx
import pytest

from app import assistant
from app.assistant import run_assistant
from app.contracts import (
    AssistantContext,
    AssistantEvidence,
    AssistantRunRequest,
    AssistantTool,
    AssistantToolResult,
)

MODEL = "anthropic/claude-haiku-5.5"
SYNTHETIC_ANSWER = "El saldo de caja es $100.000,00 según el ledger del período."
REMOTE_DETAIL = "secret-remote-detail-xyz"
PROVIDER_EXPECTED = {
    "zdr": True,
    "data_collection": "deny",
    "require_parameters": True,
    "allow_fallbacks": False,
    "only": ["google-vertex", "amazon-bedrock"],
}


def _request(query: str = "¿Cuál es el saldo de caja?") -> AssistantRunRequest:
    evidence = AssistantEvidence(sourceType="LEDGER", sourceId="1.1.1", label="Caja", value="100000.00")
    return AssistantRunRequest(
        runId="01900000-0000-7000-8000-000000000099",
        context=AssistantContext(
            firmId="11111111-1111-4111-8111-111111111111",
            clientId="22222222-2222-4222-8222-222222222222",
            periodId="2026-01",
        ),
        query=query,
        tools=[AssistantTool(name="account_balance", description="Saldo de cuenta")],
        toolResults=[
            AssistantToolResult(
                name="account_balance",
                data={"balance": "100000.00"},
                evidence=[evidence],
            )
        ],
        promptVersion="assistant-ar-v1",
    )


class FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> Any:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeClient:
    def __init__(self, outcome: FakeResponse | Exception, observed: list[dict[str, Any]]) -> None:
        self.outcome = outcome
        self.observed = observed

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(
        self, url: str, *, headers: dict[str, str], json: dict[str, Any]
    ) -> FakeResponse:
        self.observed.append({"url": url, "headers": headers, "request": json})
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _enable(monkeypatch: pytest.MonkeyPatch, model: str = MODEL, gate: str = "true") -> None:
    monkeypatch.setenv("ASSISTANT_OPENROUTER_ENABLED", gate)
    monkeypatch.setenv("OPENROUTER_MODEL", model)
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-test-key")


def _install(
    monkeypatch: pytest.MonkeyPatch,
    outcome: FakeResponse | Exception,
    observed: list[dict[str, Any]],
) -> None:
    monkeypatch.setattr(assistant.httpx, "AsyncClient", lambda **_kwargs: FakeClient(outcome, observed))


def _forbid_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        assistant.httpx,
        "AsyncClient",
        lambda **_kwargs: pytest.fail("no debe abrirse una conexión al proveedor"),
    )


def _success_payload(
    *,
    provider: str | None = "Amazon Bedrock",
    usage: dict[str, Any] | None = None,
    model: str = MODEL,
    content: str = SYNTHETIC_ANSWER,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": content}}],
    }
    if provider is not None:
        payload["provider"] = provider
    if usage is not None:
        payload["usage"] = usage
    return payload


@pytest.mark.asyncio
async def test_request_body_is_exact_and_usage_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch)
    observed: list[dict[str, Any]] = []
    _install(
        monkeypatch,
        FakeResponse(
            200,
            _success_payload(
                usage={"prompt_tokens": 812, "completion_tokens": 37, "cost": 0.000431},
            ),
        ),
        observed,
    )

    result = await run_assistant(_request())

    assert len(observed) == 1
    call = observed[0]
    assert call["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer synthetic-test-key"
    request = call["request"]
    assert request["model"] == MODEL
    assert request["provider"] == PROVIDER_EXPECTED
    assert "temperature" not in request
    assert request["max_tokens"] == assistant.MAX_OUTPUT_TOKENS
    assert [message["role"] for message in request["messages"]] == ["system", "user"]
    assert request["messages"][0]["content"] == assistant.SYSTEM_PROMPT
    assert "¿Cuál es el saldo de caja?" in request["messages"][1]["content"]
    assert "<tool-results>" in request["messages"][1]["content"]

    assert result.abstained is False
    assert result.answer == SYNTHETIC_ANSWER
    assert result.provider == "Amazon Bedrock"
    assert result.model == MODEL
    assert result.inputTokens == 812
    assert result.outputTokens == 37
    assert result.costUsd == "0.000431"


@pytest.mark.asyncio
async def test_empty_model_stays_deterministic_without_network(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch, model="")
    _forbid_network(monkeypatch)

    result = await run_assistant(_request())

    assert result.provider == "deterministic"
    assert result.model is None
    assert result.inputTokens is None
    assert "100000.00" in result.answer


@pytest.mark.asyncio
async def test_unallowlisted_model_stays_deterministic_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable(monkeypatch, model="qwen/qwen3.8-flash")
    _forbid_network(monkeypatch)

    result = await run_assistant(_request())

    assert result.provider == "deterministic"
    assert result.model is None
    assert "100000.00" in result.answer


@pytest.mark.asyncio
async def test_disabled_gate_never_calls_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch, gate="false")
    _forbid_network(monkeypatch)

    result = await run_assistant(_request())

    assert result.provider == "deterministic"
    assert result.model is None


@pytest.mark.asyncio
async def test_missing_api_key_never_calls_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch)
    monkeypatch.delenv("OPENROUTER_API_KEY")
    _forbid_network(monkeypatch)

    result = await run_assistant(_request())

    assert result.provider == "deterministic"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [404, 429, 500])
async def test_http_error_degrades_without_remote_text(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    status: int,
) -> None:
    _enable(monkeypatch)
    observed: list[dict[str, Any]] = []
    _install(
        monkeypatch,
        FakeResponse(status, {"error": {"message": REMOTE_DETAIL, "code": 500}}),
        observed,
    )

    with caplog.at_level(logging.WARNING, logger="contable.ai.assistant"):
        result = await run_assistant(_request())

    assert len(observed) == 1
    assert result.abstained is False
    assert result.provider == "deterministic"
    assert result.model is None
    assert result.inputTokens is None and result.outputTokens is None and result.costUsd is None
    assert result.answer == assistant._fallback_answer(result.evidence)
    serialized = json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
    assert REMOTE_DETAIL not in serialized
    assert REMOTE_DETAIL not in caplog.text
    assert f"ASSISTANT_MODEL_HTTP_{status}" in caplog.text


@pytest.mark.asyncio
async def test_timeout_degrades_without_remote_text(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _enable(monkeypatch)
    observed: list[dict[str, Any]] = []
    _install(monkeypatch, httpx.TimeoutException(REMOTE_DETAIL), observed)

    with caplog.at_level(logging.WARNING, logger="contable.ai.assistant"):
        result = await run_assistant(_request())

    assert result.provider == "deterministic"
    assert result.answer == assistant._fallback_answer(result.evidence)
    assert REMOTE_DETAIL not in caplog.text
    assert "ASSISTANT_MODEL_TIMEOUT" in caplog.text


@pytest.mark.asyncio
async def test_unexpected_payload_degrades(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch)
    observed: list[dict[str, Any]] = []
    _install(monkeypatch, FakeResponse(200, {"model": MODEL, "choices": []}), observed)

    result = await run_assistant(_request())

    assert result.provider == "deterministic"
    assert result.answer == assistant._fallback_answer(result.evidence)


@pytest.mark.asyncio
async def test_other_model_in_response_degrades(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch)
    observed: list[dict[str, Any]] = []
    _install(
        monkeypatch,
        FakeResponse(200, _success_payload(model="openai/gpt-other", usage={"prompt_tokens": 1})),
        observed,
    )

    result = await run_assistant(_request())

    assert result.provider == "deterministic"
    assert result.model is None


@pytest.mark.asyncio
async def test_missing_usage_keeps_counters_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable(monkeypatch)
    observed: list[dict[str, Any]] = []
    _install(monkeypatch, FakeResponse(200, _success_payload(provider="Google Vertex")), observed)

    result = await run_assistant(_request())

    assert result.provider == "Google Vertex"
    assert result.inputTokens is None
    assert result.outputTokens is None
    assert result.costUsd is None
