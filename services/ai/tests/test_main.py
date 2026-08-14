import hashlib
import json
import time
from typing import Self

import pytest
from fastapi.testclient import TestClient

from app.auth import sha256_hex, sign
from app.main import app

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
        "maxPages": 100,
        "runQrParser": True,
        "runOcr": True,
        "runVisionFallback": True,
        "schemaVersion": "voucher-ar-v1",
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
    nonce = "nonce-1"
    sig = sign("POST", path, ts, nonce, sha256_hex(body), secret)
    return {
        "Content-Type": "application/json",
        "X-Service-Id": "api",
        "X-Service-Timestamp": ts,
        "X-Service-Nonce": nonce,
        "X-Service-Signature": sig,
    }


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
        "app.main.extract_from_pdf_bytes",
        lambda _data, schema: __import__("app.extractor", fromlist=["extract_from_text"]).extract_from_text(
            "CUIT 30712345675 Fecha 12/08/2026 Total: 121000.00", schema
        ),
    )

    payload = {**VALID_PAYLOAD, "source": {**VALID_PAYLOAD["source"], "sizeBytes": len(fake_pdf), "sha256": hashlib.sha256(fake_pdf).hexdigest()}}
    body = json.dumps(payload).encode()
    res = client.post("/internal/v1/extractions", content=body, headers=_headers(body))
    assert res.status_code == 200
    data = res.json()
    assert data["documentType"] == "INVOICE"
    assert data["ocrEngine"] == "embedded-text"
    assert data["promptVersion"] == "voucher-ar-v1"


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
