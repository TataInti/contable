from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any, Self, cast

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import main, model_extraction, openrouter_policy
from app.contracts import ExtractionRunRequest
from app.model_extraction import run_model_extraction
from app.voucher_v2 import (
    PERCEPTION_CATEGORIES,
    VoucherARV21,
    VoucherExtractionResponse,
    _has_invalid_cuit_check_digit,
    response_from_voucher,
    source_path_for,
)


def _valid_voucher() -> dict[str, Any]:
    return {
        "tipo_documento": "factura",
        "letra": "A",
        "punto_venta": "0001",
        "numero": "00000023",
        "fecha": "2026-11-11",
        "hora": None,
        "cuit_emisor": "30712345671",
        "cuit_receptor": None,
        "razon_social_emisor": "Proveedor Sintético SA",
        "razon_social_receptor": None,
        "condicion_iva": None,
        "neto_gravado": "100.00",
        "iva": [{"alicuota": "21", "importe": "21.00"}],
        "no_gravado": None,
        "exento": None,
        "percepciones": None,
        "total": "121.00",
        "moneda": "ARS",
        "cae": None,
        "cae_vencimiento": None,
        "confianza": {
            "tipo_documento": 0.96,
            "letra": 0.93,
            "punto_venta": 0.92,
            "numero": 0.91,
            "fecha": 0.95,
            "cuit_emisor": 0.94,
            "razon_social_emisor": 0.9,
            "neto_gravado": 0.91,
            "iva.0.alicuota": 0.9,
            "iva.0.importe": 0.9,
            "total": 0.95,
            "moneda": 0.88,
        },
    }


def _response_from_payload(payload: dict[str, Any]) -> VoucherExtractionResponse:
    return response_from_voucher(
        VoucherARV21.model_validate(payload),
        model="test/model",
        provider="test-provider",
        prompt_version="vision-ar-v7",
        input_tokens=None,
        output_tokens=None,
        latency_ms=0,
        estimated_cost_usd=None,
    )


def test_prompt_specifies_ticket_enum_cuit_and_literal_tax_text() -> None:
    ticket_example = (
        '{"tipo_documento":"ticket_no_fiscal","letra":null,"cuit_emisor":null,'
        '"cuit_receptor":null,"cae":null,"confianza":{"tipo_documento":0.95}}'
    )
    prompt = model_extraction._request_payload("test/model", [b"synthetic page"])["messages"][0][
        "content"
    ]

    assert model_extraction.PROMPT_VERSION == "vision-ar-v7"
    assert ticket_example in prompt
    assert VoucherARV21.model_validate(json.loads(ticket_example)).tipo_documento == (
        "ticket_no_fiscal"
    )
    assert (
        "CUIT debe tener exactamente once dígitos consecutivos, sin guiones ni espacios." in prompt
    )
    assert "tipo_documento sólo admite estos literales exactos:" in prompt
    assert "Un recibo de pago es `recibo`" in prompt
    assert (
        "Si el documento es un ticket no fiscal, tipo_documento debe ser exactamente `ticket_no_fiscal`"
        in prompt
    )
    assert "`percepciones.categoria` debe ser exactamente una" in prompt
    assert all(f"`{category}`" in prompt for category in PERCEPTION_CATEGORIES)
    assert "`percepciones.tipo_texto` es la transcripción literal completa" in prompt
    assert "No antepongas `Percepcion` si no está impresa" in prompt
    assert "no reformules ni trunques" in prompt
    assert "`condicion_iva` también es transcripción literal completa" in prompt
    assert (
        "Omití las claves ausentes o no legibles; el contrato las interpreta como null." in prompt
    )
    assert "punto para separar miles y coma para decimales" in prompt
    assert '`$100.000` es cien mil y se devuelve `"100000.00"`' in prompt
    assert '`$121.000` se devuelve `"121000.00"`' in prompt
    assert '`$1.234,56` se devuelve `"1234.56"`' in prompt
    assert '`$121.000,00` se devuelve `"121000.00"`' in prompt
    assert "Nunca interpretes un punto seguido de exactamente tres dígitos como decimal" in prompt
    assert "Ante un formato ambiguo, elegí la lectura argentina y no inventes decimales." in prompt
    assert (
        "En facturas, registrá el importe visible rotulado `Subtotal` o `Neto` en `neto_gravado`"
        in prompt
    )
    assert "`Percep. RG 2408 - DGI` → `IVA`" in prompt


def test_natural_language_ticket_label_is_rejected_by_enum() -> None:
    payload = _valid_voucher()
    payload["tipo_documento"] = "TICKET NO FISCAL"

    with pytest.raises(ValidationError) as error:
        VoucherARV21.model_validate(payload)

    assert error.value.errors()[0]["loc"] == ("tipo_documento",)
    assert error.value.errors()[0]["type"] == "literal_error"


def test_voucher_ar_v2_validates_and_maps_existing_ui_keys() -> None:
    voucher = VoucherARV21.model_validate(_valid_voucher())
    result = response_from_voucher(
        voucher,
        model="test/model",
        provider="openrouter",
        prompt_version="vision-ar-v7",
        input_tokens=120,
        output_tokens=48,
        latency_ms=850,
        estimated_cost_usd=0.0002,
    )
    mapped = {field.key: field.normalizedValue for field in result.fields}
    assert result.schemaVersion == "voucher-ar-v2.1"
    assert mapped["issuerTaxId"] == "30712345671"
    assert mapped["issuerName"] == "Proveedor Sintético SA"
    assert mapped["voucherNumber"] == "00000023"
    assert mapped["voucherType"] == "factura"
    assert mapped["pointOfSale"] == "0001"
    assert mapped["issueDate"] == "2026-11-11"
    assert mapped["netAmount"] == "100.00"
    assert mapped["totalAmount"] == "121.00"
    assert mapped["vatAmount"] == "21.00"
    assert mapped["currency"] == "ARS"
    assert result.inputTokens == 120
    assert result.outputTokens == 48
    assert result.latencyMs == 850
    assert result.estimatedCostUsd == 0.0002


@pytest.mark.parametrize("category", PERCEPTION_CATEGORIES)
def test_perception_catalog_accepts_each_category(category: str) -> None:
    payload = _valid_voucher()
    payload["percepciones"] = [
        {"categoria": category, "tipo_texto": "texto impreso", "importe": "1.00"}
    ]
    payload["confianza"].update(
        {
            "percepciones.0.categoria": 0.9,
            "percepciones.0.tipo_texto": 0.9,
            "percepciones.0.importe": 0.9,
        }
    )

    voucher = VoucherARV21.model_validate(payload)

    assert voucher.percepciones is not None
    assert voucher.percepciones[0].categoria == category


def test_unknown_perception_category_becomes_others_and_marks_review() -> None:
    payload = _valid_voucher()
    payload["iva"] = [
        {"alicuota": "21", "importe": "21.00"},
        {"alicuota": "10.5", "importe": "2.00"},
    ]
    payload["percepciones"] = [
        {"categoria": "IIBB", "tipo_texto": "IIBB - dato sintetico", "importe": "1.00"},
        {
            "categoria": "Impuesto Inventado",
            "tipo_texto": "Rótulo fiscal raro",
            "importe": "2.00",
        },
    ]
    payload["confianza"].update(
        {
            "iva.1.alicuota": 0.9,
            "iva.1.importe": 0.9,
            "percepciones.0.categoria": 0.95,
            "percepciones.0.tipo_texto": 0.95,
            "percepciones.0.importe": 0.95,
            "percepciones.1.categoria": 0.95,
            "percepciones.1.tipo_texto": 0.95,
            "percepciones.1.importe": 0.95,
        }
    )
    normalized, unknown_indexes = model_extraction._normalize_perception_categories(payload)
    voucher = VoucherARV21.model_validate(normalized)
    result = response_from_voucher(
        voucher,
        model="test/model",
        provider="openrouter",
        prompt_version="vision-ar-v7",
        input_tokens=None,
        output_tokens=None,
        latency_ms=0,
        estimated_cost_usd=None,
        unrecognized_perception_indexes=unknown_indexes,
    )

    assert voucher.percepciones is not None
    assert voucher.percepciones[1].categoria == "Otras"
    assert voucher.confianza["percepciones.1.categoria"] == 0.0
    assert result.reviewReason == "percepción no reconocida"
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {
            "reason": "percepción no reconocida",
            "sourcePath": "percepciones[1].categoria",
        }
    ]


def test_source_paths_are_stable_for_indexed_vat_and_perception_lists() -> None:
    assert source_path_for("iva", 1, "importe") == "iva[1].importe"
    assert source_path_for("percepciones", 2, "categoria") == "percepciones[2].categoria"


def test_missing_and_explicit_null_fields_remain_null() -> None:
    payload = _valid_voucher()
    payload.pop("cuit_emisor")
    payload.pop("razon_social_emisor")
    payload["cae"] = None
    voucher = VoucherARV21.model_validate(payload)
    assert voucher.cuit_emisor is None
    assert voucher.razon_social_emisor is None
    assert voucher.cae is None


def test_extraction_response_and_voucher_do_not_contain_items() -> None:
    payload = _valid_voucher()
    voucher = VoucherARV21.model_validate(payload)
    result = response_from_voucher(
        voucher,
        model="test/model",
        provider="openrouter",
        prompt_version="vision-ar-v7",
        input_tokens=10,
        output_tokens=5,
        latency_ms=100,
        estimated_cost_usd=None,
    )
    assert "items" not in VoucherARV21.model_json_schema()["properties"]
    assert "items" not in voucher.model_dump()
    assert "items" not in result.model_dump()


def test_invalid_schema_values_and_unknown_fields_are_rejected() -> None:
    payload = _valid_voucher()
    payload["tipo_documento"] = "invoice"
    with pytest.raises(ValidationError):
        VoucherARV21.model_validate(payload)

    payload = _valid_voucher()
    payload["importe_inventado"] = "121.00"
    with pytest.raises(ValidationError):
        VoucherARV21.model_validate(payload)

    payload = _valid_voucher()
    payload["items"] = []
    with pytest.raises(ValidationError):
        VoucherARV21.model_validate(payload)

    payload = _valid_voucher()
    payload["confianza"]["items.0.descripcion"] = 0.9
    with pytest.raises(ValidationError):
        VoucherARV21.model_validate(payload)

    payload = _valid_voucher()
    payload["confianza"].pop("total")
    with pytest.raises(ValidationError):
        VoucherARV21.model_validate(payload)


def test_cuit_with_dv_10_is_flagged_for_emitter_and_value_is_preserved() -> None:
    payload = _valid_voucher()
    payload["cuit_emisor"] = "20000000010"

    result = _response_from_payload(payload)

    assert result.reviewReason == "CUIT con dígito verificador inválido"
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {
            "reason": "CUIT con dígito verificador inválido",
            "sourcePath": "cuit_emisor",
        }
    ]
    assert result.voucher is not None
    assert result.voucher.cuit_emisor == "20000000010"


def test_cuit_dv_11_maps_to_zero_and_valid_cuit_does_not_mark_review() -> None:
    payload = _valid_voucher()
    payload["cuit_emisor"] = "20000000060"
    assert _has_invalid_cuit_check_digit(payload["cuit_emisor"]) is False

    result = _response_from_payload(payload)

    assert result.reviewIssues == []
    assert result.reviewReason is None


def test_valid_cuit_does_not_mark_review() -> None:
    payload = _valid_voucher()
    payload["cuit_emisor"] = "20123456786"

    result = _response_from_payload(payload)

    assert result.reviewIssues == []
    assert result.reviewReason is None


def test_invalid_emitter_and_receiver_cuits_have_independent_source_paths() -> None:
    payload = _valid_voucher()
    payload["cuit_emisor"] = "30123456789"
    payload["cuit_receptor"] = "20123456789"
    payload["confianza"]["cuit_receptor"] = 0.9

    result = _response_from_payload(payload)

    assert result.reviewReason == "CUIT con dígito verificador inválido"
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {
            "reason": "CUIT con dígito verificador inválido",
            "sourcePath": "cuit_emisor",
        },
        {
            "reason": "CUIT con dígito verificador inválido",
            "sourcePath": "cuit_receptor",
        },
    ]
    assert result.voucher is not None
    assert result.voucher.cuit_emisor == "30123456789"
    assert result.voucher.cuit_receptor == "20123456789"


def test_null_or_short_cuit_skips_check_digit_rule() -> None:
    assert _has_invalid_cuit_check_digit(None) is False
    assert _has_invalid_cuit_check_digit("20-123") is False

    payload = _valid_voucher()
    payload["cuit_emisor"] = None
    payload["confianza"].pop("cuit_emisor")

    result = _response_from_payload(payload)

    assert result.reviewIssues == []
    assert result.reviewReason is None


def test_cae_expiration_before_issue_date_does_not_trigger_review() -> None:
    payload = _valid_voucher()
    payload["cae_vencimiento"] = "2026-11-10"
    payload["confianza"]["cae_vencimiento"] = 0.9

    result = _response_from_payload(payload)

    assert result.reviewIssues == []
    assert result.reviewReason is None
    assert result.voucher is not None
    assert result.voucher.cae_vencimiento == "2026-11-10"

    # Las otras reglas siguen activas: un CUIT inválido sigue marcando revisión.
    invalid_cuit_payload = _valid_voucher()
    invalid_cuit_payload["cae_vencimiento"] = "2026-11-10"
    invalid_cuit_payload["confianza"]["cae_vencimiento"] = 0.9
    invalid_cuit_payload["cuit_emisor"] = "20000000010"
    invalid_cuit_result = _response_from_payload(invalid_cuit_payload)
    assert [issue.model_dump() for issue in invalid_cuit_result.reviewIssues] == [
        {
            "reason": "CUIT con dígito verificador inválido",
            "sourcePath": "cuit_emisor",
        }
    ]

    # La suma aritmética sigue marcando revisión sin importar el CAE.
    mismatch_payload = _valid_voucher()
    mismatch_payload["cae_vencimiento"] = "2026-11-10"
    mismatch_payload["confianza"]["cae_vencimiento"] = 0.9
    mismatch_payload["total"] = "122.00"
    mismatch_payload["no_gravado"] = "0.00"
    mismatch_payload["exento"] = "0.00"
    mismatch_payload["percepciones"] = []
    mismatch_payload["confianza"].update({"no_gravado": 0.8, "exento": 0.8})
    mismatch_result = _response_from_payload(mismatch_payload)
    assert [issue.model_dump() for issue in mismatch_result.reviewIssues] == [
        {"reason": "COMPONENT_SUM_MISMATCH", "sourcePath": None}
    ]


def test_clean_response_has_no_review_reasons() -> None:
    result = _response_from_payload(_valid_voucher())

    assert result.reviewReason is None
    assert result.issues == []
    assert result.reviewIssues == []


def test_arithmetic_mismatch_marks_review_without_changing_values() -> None:
    payload = _valid_voucher()
    payload["total"] = "122.00"
    payload["no_gravado"] = "0.00"
    payload["exento"] = "0.00"
    payload["percepciones"] = []
    payload["confianza"].update({"no_gravado": 0.8, "exento": 0.8})
    voucher = VoucherARV21.model_validate(payload)
    result = response_from_voucher(
        voucher,
        model="test/model",
        provider="openrouter",
        prompt_version="vision-ar-v7",
        input_tokens=None,
        output_tokens=None,
        latency_ms=0,
        estimated_cost_usd=None,
    )
    assert result.reviewReason == "COMPONENT_SUM_MISMATCH"
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {"reason": "COMPONENT_SUM_MISMATCH", "sourcePath": None}
    ]
    assert result.voucher is not None
    assert result.voucher.total == "122.00"
    assert (
        next(field for field in result.fields if field.key == "totalAmount").normalizedValue
        == "122.00"
    )


def test_non_fiscal_ticket_requires_manual_review() -> None:
    payload = _valid_voucher()
    payload["tipo_documento"] = "ticket_no_fiscal"
    payload["letra"] = None
    payload["cuit_emisor"] = None
    payload["cae"] = None
    payload["confianza"].pop("letra")
    payload["confianza"].pop("cuit_emisor")
    voucher = VoucherARV21.model_validate(payload)
    result = response_from_voucher(
        voucher,
        model="test/model",
        provider="openrouter",
        prompt_version="vision-ar-v7",
        input_tokens=20,
        output_tokens=12,
        latency_ms=250,
        estimated_cost_usd=None,
    )
    assert result.voucher is not None
    assert result.voucher.tipo_documento == "ticket_no_fiscal"
    assert result.voucher.cuit_emisor is None
    assert result.voucher.cae is None
    assert result.reviewReason == "sin datos fiscales"
    assert result.issues == ["sin datos fiscales"]
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {"reason": "sin datos fiscales", "sourcePath": None}
    ]


def test_missing_fiscal_identifiers_skip_arithmetic_validation() -> None:
    payload = _valid_voucher()
    payload["letra"] = None
    payload["cuit_emisor"] = None
    payload["cae"] = None
    payload["total"] = "122.00"
    payload["no_gravado"] = "0.00"
    payload["exento"] = "0.00"
    payload["percepciones"] = []
    payload["confianza"].pop("letra")
    payload["confianza"].pop("cuit_emisor")
    payload["confianza"].update({"no_gravado": 0.8, "exento": 0.8})

    result = response_from_voucher(
        VoucherARV21.model_validate(payload),
        model="test/model",
        provider="openrouter",
        prompt_version="vision-ar-v7",
        input_tokens=20,
        output_tokens=12,
        latency_ms=250,
        estimated_cost_usd=None,
    )

    assert result.reviewReason == "sin datos fiscales"
    assert result.issues == ["sin datos fiscales"]
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {"reason": "sin datos fiscales", "sourcePath": None}
    ]
    assert result.voucher is not None
    assert result.voucher.total == "122.00"


def test_default_engine_does_not_call_legacy_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXTRACTION_ENGINE", raising=False)
    monkeypatch.delenv("EXTRACTION_MODEL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("EXTRACTION_CUSTOMER_DATA_ENABLED", "false")
    monkeypatch.setattr(
        model_extraction,
        "_prepare_page_images",
        lambda *_args: pytest.fail(
            "no se rasteriza ni se ejecuta una ruta de reglas sin modelo aprobado"
        ),
    )

    fake_pdf = b"%PDF-1.4 synthetic fixture"

    class DownloadResponse:
        content = fake_pdf

        def raise_for_status(self) -> None:
            return None

    class DownloadClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, _url: str) -> DownloadResponse:
            return DownloadResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", DownloadClient)
    payload_data = {
        "contractVersion": "1.0",
        "runId": "01900000-0000-7000-8000-000000000001",
        "firmId": "11111111-1111-4111-8111-111111111111",
        "clientId": "22222222-2222-4222-8222-222222222222",
        "documentId": "33333333-3333-4333-8333-333333333333",
        "source": {
            "downloadUrl": "https://signed.example/synthetic.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": len(fake_pdf),
            "sha256": hashlib.sha256(fake_pdf).hexdigest(),
        },
        "options": {
            "country": "AR",
            "language": "es",
            "maxPages": 3,
            "schemaVersion": "voucher-ar-v2.1",
        },
        "callback": {
            "url": "http://api:3000/internal/v1/extractions/complete",
            "expiresAt": "2026-11-11T12:00:00Z",
        },
    }
    request = ExtractionRunRequest.model_validate(payload_data)
    response = asyncio.run(main.start_extraction(request, cast(Any, None)))
    assert response.reviewReason == "EXTRACTION_MODEL_NOT_CONFIGURED"
    assert response.voucher is None
    assert not hasattr(main, "extract_from_pdf_bytes")
    assert not hasattr(main, "extract_from_image_bytes")


def test_production_customer_data_gate_blocks_before_source_download(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.delenv("EXTRACTION_CUSTOMER_DATA_ENABLED", raising=False)
    fake_pdf = b"%PDF-1.4 synthetic fixture"
    payload_data = {
        "contractVersion": "1.0",
        "runId": "01900000-0000-7000-8000-000000000001",
        "firmId": "11111111-1111-4111-8111-111111111111",
        "clientId": "22222222-2222-4222-8222-222222222222",
        "documentId": "33333333-3333-4333-8333-333333333333",
        "source": {
            "downloadUrl": "https://signed.example/synthetic.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": len(fake_pdf),
            "sha256": hashlib.sha256(fake_pdf).hexdigest(),
        },
        "options": {"country": "AR", "language": "es", "maxPages": 3},
        "callback": {
            "url": "http://api:3000/internal/v1/extractions/complete",
            "expiresAt": "2026-11-11T12:00:00Z",
        },
    }
    request = ExtractionRunRequest.model_validate(payload_data)
    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda *_args, **_kwargs: pytest.fail("la compuerta debe ejecutarse antes de descargar"),
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(main.start_extraction(request, cast(Any, None)))

    assert error.value.status_code == 503
    assert error.value.detail == "CUSTOMER_DATA_EXTRACTION_DISABLED"


def test_approved_model_builds_exact_zdr_provider_payload() -> None:
    assert openrouter_policy.ALLOWED_OPENROUTER_MODELS == frozenset({"anthropic/claude-haiku-5.5"})
    assert openrouter_policy.ALLOWED_OPENROUTER_PROVIDERS == (
        "google-vertex",
        "amazon-bedrock",
    )
    payload = model_extraction._request_payload("anthropic/claude-haiku-5.5", [])
    assert payload["provider"] == {
        "zdr": True,
        "data_collection": "deny",
        "require_parameters": True,
        "allow_fallbacks": False,
        "only": ["google-vertex", "amazon-bedrock"],
    }


def test_unallowlisted_qwen_is_blocked_before_network_or_rasterization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXTRACTION_ENGINE", "model")
    monkeypatch.setenv("EXTRACTION_MODEL", "qwen/qwen3.8-flash")
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-test-key")
    monkeypatch.setattr(
        model_extraction,
        "_prepare_page_images",
        lambda *_args: pytest.fail(
            "un modelo no allowlisted no debe rasterizar ni llamar al proveedor"
        ),
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: pytest.fail("un modelo no allowlisted no debe abrir una conexión"),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))
    assert result.reviewReason == "MODEL_NOT_PRIVACY_ALLOWLISTED"
    assert result.provider is None
    assert result.voucher is None
    assert result.model == "qwen/qwen3.8-flash"


def _configure_mock_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXTRACTION_ENGINE", "model")
    monkeypatch.setenv("EXTRACTION_MODEL", "test/model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-test-key")
    monkeypatch.setattr(model_extraction, "ALLOWED_OPENROUTER_MODELS", frozenset({"test/model"}))
    monkeypatch.setattr(model_extraction, "ALLOWED_OPENROUTER_PROVIDERS", ("test-provider",))
    monkeypatch.setattr(
        model_extraction, "_prepare_page_images", lambda *_args: [b"synthetic-page"]
    )


class ModelResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self.payload = payload

    def json(self) -> dict[str, Any]:
        return self.payload


class ModelClientSequence:
    def __init__(self, responses: list[ModelResponse], observed: list[dict[str, Any]]) -> None:
        self.responses = responses
        self.observed = observed

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(
        self, url: str, *, headers: dict[str, str], json: dict[str, Any]
    ) -> ModelResponse:
        self.observed.append({"url": url, "headers": headers, "request": json})
        return self.responses.pop(0)


def test_mocked_multimodal_success_records_usage_and_zdr_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    payload = _valid_voucher()
    observed: list[dict[str, Any]] = []
    response = ModelResponse(
        200,
        {
            "model": "test/model",
            "provider": "Amazon Bedrock",
            "usage": {"prompt_tokens": 120, "completion_tokens": 48, "cost": 0.0002},
            "choices": [{"message": {"content": json.dumps(payload)}}],
        },
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence([response], observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))
    request = observed[0]["request"]
    assert len(observed) == 1
    assert request["model"] == "test/model"
    assert request["response_format"] == {"type": "json_object"}
    assert request["provider"] == {
        "only": ["test-provider"],
        "zdr": True,
        "data_collection": "deny",
        "require_parameters": True,
        "allow_fallbacks": False,
    }
    assert any(part.get("type") == "image_url" for part in request["messages"][1]["content"])
    assert result.model == "test/model"
    assert result.provider == "Amazon Bedrock"
    assert result.inputTokens == 120
    assert result.outputTokens == 48
    assert result.estimatedCostUsd == 0.0002


def test_mocked_argentine_thousands_amounts_are_preserved_and_pass_arithmetic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    payload = _valid_voucher()
    payload["neto_gravado"] = "100000.00"
    payload["iva"][0]["importe"] = "21000.00"
    payload["no_gravado"] = "0.00"
    payload["exento"] = "0.00"
    payload["percepciones"] = []
    payload["total"] = "121000.00"
    payload["confianza"].update({"no_gravado": 0.9, "exento": 0.9})
    observed: list[dict[str, Any]] = []
    response = ModelResponse(
        200,
        {
            "model": "test/model",
            "usage": {"prompt_tokens": 32, "completion_tokens": 12, "cost": 0.0001},
            "choices": [{"message": {"content": json.dumps(payload)}}],
        },
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence([response], observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic invoice image", "image/png", 1))

    assert result.voucher is not None
    assert result.voucher.neto_gravado == "100000.00"
    assert result.voucher.iva is not None
    assert result.voucher.iva[0].importe == "21000.00"
    assert result.voucher.total == "121000.00"
    assert result.reviewReason is None
    assert result.reviewIssues == []
    system_prompt = observed[0]["request"]["messages"][0]["content"]
    assert '`$100.000` es cien mil y se devuelve `"100000.00"`' in system_prompt


def test_unexpected_response_model_is_rejected_without_accepting_voucher(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    observed: list[dict[str, Any]] = []
    response = ModelResponse(
        200,
        {
            "model": "test/unapproved",
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "cost": 0.01},
            "choices": [{"message": {"content": json.dumps(_valid_voucher())}}],
        },
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence([response, response], observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))

    assert len(observed) == 2
    assert result.reviewReason == "MODEL_RESPONSE_MODEL_MISMATCH"
    assert result.voucher is None


def test_markdown_fenced_json_is_parsed_before_schema_validation() -> None:
    assert model_extraction._parse_model_json('```json\n{"ok": true}\n```') == {"ok": True}


def test_mocked_non_fiscal_ticket_requires_manual_review(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    payload = _valid_voucher()
    payload["tipo_documento"] = "ticket_no_fiscal"
    payload["cuit_emisor"] = None
    payload["cae"] = None
    payload["confianza"].pop("cuit_emisor")
    observed: list[dict[str, Any]] = []
    response = ModelResponse(
        200,
        {
            "usage": {"prompt_tokens": 30, "completion_tokens": 16, "cost": 0.0001},
            "choices": [{"message": {"content": json.dumps(payload)}}],
        },
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence([response], observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic ticket image", "image/png", 1))
    assert len(observed) == 1
    assert result.voucher is not None
    assert result.voucher.tipo_documento == "ticket_no_fiscal"
    assert result.voucher.cuit_emisor is None
    assert result.voucher.cae is None
    assert result.reviewReason == "sin datos fiscales"
    assert result.issues == ["sin datos fiscales"]
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {"reason": "sin datos fiscales", "sourcePath": None}
    ]


def test_pdf_over_page_limit_is_not_partially_sent_to_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)

    def over_limit(*_args: object) -> list[bytes]:
        raise OverflowError("synthetic over-limit PDF")

    monkeypatch.setattr(model_extraction, "_prepare_page_images", over_limit)
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: pytest.fail("un PDF sobre el límite no debe llegar al modelo"),
    )

    result = asyncio.run(run_model_extraction(b"synthetic PDF", "application/pdf", 3))
    assert result.reviewReason == "PAGE_LIMIT_EXCEEDED"
    assert result.voucher is None


def test_model_failure_retries_once_then_returns_manual_review_without_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    observed: list[dict[str, Any]] = []
    responses = [ModelResponse(503, {"error": {"message": "synthetic"}}) for _ in range(2)]
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence(responses, observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))
    assert len(observed) == 2
    assert result.reviewReason == "MODEL_HTTP_ERROR_503"
    assert result.voucher is None
    assert result.fields == []


def test_invalid_model_json_retries_once_then_requires_manual_review(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    observed: list[dict[str, Any]] = []
    invalid = ModelResponse(
        200,
        {
            "usage": {"prompt_tokens": 12, "completion_tokens": 3, "cost": 0.01},
            "choices": [{"message": {"content": "{malformed"}}],
        },
    )
    responses = [invalid, invalid]
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence(responses, observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))
    assert len(observed) == 2
    assert result.reviewReason == "MODEL_JSON_INVALID"
    assert result.voucher is None


def test_model_schema_error_retries_once_then_requires_manual_review(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    observed: list[dict[str, Any]] = []
    invalid = _valid_voucher()
    invalid["tipo_documento"] = "invoice"
    response = ModelResponse(
        200,
        {
            "usage": {"prompt_tokens": 12, "completion_tokens": 3, "cost": 0.01},
            "choices": [{"message": {"content": json.dumps(invalid)}}],
        },
    )
    responses = [response, response]
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence(responses, observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))
    assert len(observed) == 2
    assert result.reviewReason == "MODEL_SCHEMA_INVALID"
    assert result.voucher is None


@pytest.mark.parametrize(
    ("raw", "expected_date", "expected_time"),
    [
        ("2025-03-16", "2025-03-16", None),
        ("16/03/2025", "2025-03-16", None),
        ("16/03/25", "2025-03-16", None),
        ("16-03-2025", "2025-03-16", None),
        ("16/03/2025 14:35", "2025-03-16", "14:35:00"),
        ("16/03/2025T14:35:22", "2025-03-16", "14:35:22"),
        ("2025-03-16T14:35:00", "2025-03-16", "14:35:00"),
    ],
)
def test_date_normalization_accepts_argentine_and_iso_formats(
    raw: str, expected_date: str, expected_time: str | None
) -> None:
    payload = _valid_voucher()
    payload["fecha"] = raw
    payload["hora"] = None

    normalized, issues = model_extraction._normalize_voucher_dates(payload)

    assert issues == []
    assert normalized["fecha"] == expected_date
    assert normalized.get("hora") == expected_time
    assert VoucherARV21.model_validate(normalized).fecha == expected_date


def test_date_normalization_discards_only_impossible_date_and_keeps_total() -> None:
    payload = _valid_voucher()
    payload["fecha"] = "31/02/2025"

    normalized, issues = model_extraction._normalize_voucher_dates(payload)

    assert "fecha" not in normalized
    assert "fecha" not in normalized["confianza"]
    assert normalized["total"] == "121.00"
    assert [issue.model_dump() for issue in issues] == [
        {"reason": "fecha ilegible", "sourcePath": "fecha"}
    ]
    voucher = VoucherARV21.model_validate(normalized)
    assert voucher.fecha is None
    assert voucher.total == "121.00"


def test_cae_expiration_accepts_local_date_and_normalizes_to_iso() -> None:
    payload = _valid_voucher()
    payload["cae_vencimiento"] = "16/03/25"
    payload["confianza"]["cae_vencimiento"] = 0.9

    normalized, issues = model_extraction._normalize_voucher_dates(payload)

    assert issues == []
    assert normalized["cae_vencimiento"] == "2025-03-16"
    assert VoucherARV21.model_validate(normalized).cae_vencimiento == "2025-03-16"


def test_time_normalization_accepts_hh_mm_and_discards_invalid_time_only() -> None:
    payload = _valid_voucher()
    payload["hora"] = "9:05"
    payload["confianza"]["hora"] = 0.9

    normalized, issues = model_extraction._normalize_voucher_dates(payload)

    assert issues == []
    assert normalized["hora"] == "09:05:00"

    payload = _valid_voucher()
    payload["hora"] = "25:00"
    payload["confianza"]["hora"] = 0.9

    normalized, issues = model_extraction._normalize_voucher_dates(payload)

    assert "hora" not in normalized
    assert "hora" not in normalized["confianza"]
    assert [issue.model_dump() for issue in issues] == [
        {"reason": "hora ilegible", "sourcePath": "hora"}
    ]
    voucher = VoucherARV21.model_validate(normalized)
    assert voucher.fecha == "2026-11-11"
    assert voucher.hora is None


def test_prompt_v7_specifies_date_time_normalization_and_ticket_example() -> None:
    prompt = model_extraction._request_payload("test/model", [b"synthetic page"])["messages"][0][
        "content"
    ]
    example = (
        '{"tipo_documento":"ticket_no_fiscal","fecha":"2025-03-16","hora":"14:35:00",'
        '"total":"12500.00","letra":null,"cuit_emisor":null,"cuit_receptor":null,'
        '"cae":null,"confianza":{"tipo_documento":0.95,"fecha":0.9,"hora":0.9,"total":0.95}}'
    )

    assert "Si la fecha impresa es dd/mm/aa o dd/mm/aaaa, con o sin hora" in prompt
    assert "nunca otro formato" in prompt
    assert "interpretala como día/mes y nunca como mes/día" in prompt
    assert "un año de dos dígitos se completa como 20AA" in prompt
    assert example in prompt
    assert VoucherARV21.model_validate(json.loads(example)).hora == "14:35:00"


def test_mocked_argentine_date_with_time_normalizes_without_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    payload = _valid_voucher()
    payload["fecha"] = "16/03/2025 14:35"
    payload["hora"] = None
    observed: list[dict[str, Any]] = []
    response = ModelResponse(
        200,
        {
            "model": "test/model",
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "cost": 0.0001},
            "choices": [{"message": {"content": json.dumps(payload)}}],
        },
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence([response], observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))

    assert len(observed) == 1
    assert result.promptVersion == "vision-ar-v7"
    assert result.reviewReason is None
    assert result.voucher is not None
    assert result.voucher.fecha == "2025-03-16"
    assert result.voucher.hora == "14:35:00"
    mapped = {field.key: field.normalizedValue for field in result.fields}
    assert mapped["issueDate"] == "2025-03-16"
    assert mapped["time"] == "14:35:00"


def test_mocked_impossible_date_keeps_voucher_and_total_with_review_issue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_mock_model(monkeypatch)
    payload = _valid_voucher()
    payload["fecha"] = "31/02/2025"
    observed: list[dict[str, Any]] = []
    response = ModelResponse(
        200,
        {
            "model": "test/model",
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "cost": 0.0001},
            "choices": [{"message": {"content": json.dumps(payload)}}],
        },
    )
    monkeypatch.setattr(
        model_extraction.httpx,
        "AsyncClient",
        lambda **_kwargs: ModelClientSequence([response], observed),
    )

    result = asyncio.run(run_model_extraction(b"synthetic image", "image/png", 1))

    assert len(observed) == 1
    assert result.promptVersion == "vision-ar-v7"
    assert result.reviewReason == "fecha ilegible"
    assert [issue.model_dump() for issue in result.reviewIssues] == [
        {"reason": "fecha ilegible", "sourcePath": "fecha"}
    ]
    assert result.voucher is not None
    assert result.voucher.fecha is None
    assert result.voucher.total == "121.00"
    mapped = {field.key: field.normalizedValue for field in result.fields}
    assert "issueDate" not in mapped
    assert mapped["totalAmount"] == "121.00"
