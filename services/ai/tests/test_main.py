import hashlib
import json
import time
import uuid
from typing import Self

import pytest
from fastapi.testclient import TestClient

from app.auth import sha256_hex, sign
from app.main import app
from app.voucher_v2 import manual_review_response

client = TestClient(app)

VALID_PAYLOAD = {
    "contractVersion": "1.0",
    "runId": "01900000-0000-7000-8000-000000000001",
    "firmId": "11111111-1111-4111-8111-111111111111",
    "clientId": "22222222-2222-4222-8222-222222222222",
    "documentId": "33333333-3333-4333-8333-333333333333",
    "source": {
        "downloadUrl": "https://signed.example/doc.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 12345,
        "sha256": "a" * 64,
    },
    "options": {
        "country": "AR",
        "language": "es",
        "maxPages": 3,
        "schemaVersion": "voucher-ar-v2.1",
    },
    "callback": {
        "url": "http://api:3000/internal/v1/extractions/complete",
        "expiresAt": "2026-08-12T12:00:00Z",
    },
}


@pytest.fixture(autouse=True)
def _setup_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SERVICE_SECRET", "test-secret")


def _headers(body: bytes, secret: str = "test-secret") -> dict[str, str]:
    path = "/internal/v1/extractions"
    ts = str(int(time.time()))
    nonce = str(uuid.uuid4())
    sig = sign("POST", path, ts, nonce, sha256_hex(body), secret)
    return {
        "Content-Type": "application/json",
        "X-Service-Id": "api",
        "X-Service-Timestamp": ts,
        "X-Service-Nonce": nonce,
        "X-Service-Signature": sig,
    }


async def _manual_model_result(_data: bytes, _mime_type: str, _max_pages: int):
    return manual_review_response("MODEL_NOT_CONFIGURED")


def test_health_live() -> None:
    res = client.get("/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_health_ready() -> None:
    res = client.get("/health/ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ready"}


def test_extraction_requires_auth() -> None:
    res = client.post("/internal/v1/extractions", json={})
    assert res.status_code == 401


def test_extraction_valid_hmac(monkeypatch: pytest.MonkeyPatch) -> None:
    # Mock de la descarga del PDF desde la URL firmada
    fake_pdf = b"%PDF-1.4 fake pdf body"

    class FakeResp:
        content = fake_pdf

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def get(self, url: str) -> FakeResp:
            return FakeResp()

    monkeypatch.setattr("app.main.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(
        "app.main.run_model_extraction",
        _manual_model_result,
    )

    payload = {
        **VALID_PAYLOAD,
        "source": {
            **VALID_PAYLOAD["source"],
            "sizeBytes": len(fake_pdf),
            "sha256": hashlib.sha256(fake_pdf).hexdigest(),
        },
    }
    body = json.dumps(payload).encode()
    res = client.post("/internal/v1/extractions", content=body, headers=_headers(body))
    assert res.status_code == 200
    data = res.json()
    assert data["schemaVersion"] == "voucher-ar-v2.1"
    assert data["voucher"] is None
    assert data["ocrEngine"] == "multimodal-model"
    assert data["promptVersion"] == "vision-ar-v5"
    assert data["reviewReason"] == "MODEL_NOT_CONFIGURED"


def test_extraction_invalid_signature() -> None:
    body = json.dumps(VALID_PAYLOAD).encode()
    headers = _headers(body, secret="wrong-secret")
    res = client.post("/internal/v1/extractions", content=body, headers=headers)
    assert res.status_code == 401


def test_extraction_rejects_unknown_fields() -> None:
    payload = {**VALID_PAYLOAD, "evil": "campo extra"}
    body = json.dumps(payload).encode()
    res = client.post("/internal/v1/extractions", content=body, headers=_headers(body))
    assert res.status_code == 422


def test_hmac_replay_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un request firmado reenviado con el mismo nonce debe rechazarse."""
    # Mock de la descarga para que el primer envío consuma el nonce y llegue al
    # procesamiento (sin esto falla antes con ConnectError).
    fake_pdf = b"%PDF-1.4 fake pdf body"

    class FakeResp:
        content = fake_pdf

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def get(self, url: str) -> FakeResp:
            return FakeResp()

    monkeypatch.setattr("app.main.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(
        "app.main.run_model_extraction",
        _manual_model_result,
    )

    payload = {
        **VALID_PAYLOAD,
        "source": {
            **VALID_PAYLOAD["source"],
            "sizeBytes": len(fake_pdf),
            "sha256": hashlib.sha256(fake_pdf).hexdigest(),
        },
    }
    body = json.dumps(payload).encode()
    headers = _headers(body)

    # Primer envío: firma válida → el nonce queda consumido; la extracción
    # devuelve 200 gracias al mock de descarga.
    res = client.post("/internal/v1/extractions", content=body, headers=headers)
    assert res.status_code == 200

    # Reenviar el MISMO request (mismo nonce+timestamp) debe detectarse como replay.
    res2 = client.post("/internal/v1/extractions", content=body, headers=headers)
    assert res2.status_code == 401
    assert res2.json()["detail"] == "Nonce reutilizado"
