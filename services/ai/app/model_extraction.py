"""Extracción multimodal vía OpenRouter; no ejecuta OCR ni parsing de texto."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import time
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from PIL import Image
from pydantic import ValidationError

from .voucher_v2 import (
    VoucherARV2,
    VoucherExtractionResponse,
    manual_review_response,
    response_from_voucher,
)

PROMPT_VERSION = "vision-ar-v2"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
PDF_DPI = 150
PDF_JPEG_QUALITY = 85
MAX_IMAGE_EDGE = 2048
MAX_PAGES = 3
MAX_OUTPUT_TOKENS = 4096
MODEL_TIMEOUT_SECONDS = 55.0

# ADR-0005 no contiene IDs de modelos/proveedores aprobados. Fallar cerrado
# impide activar modelos no aprobados; la allowlist requiere un cambio revisado.
ALLOWED_OPENROUTER_MODELS: frozenset[str] = frozenset()
ALLOWED_OPENROUTER_PROVIDERS: tuple[str, ...] = ()

SYSTEM_PROMPT = """Sos un extractor multimodal de comprobantes argentinos. Leé únicamente las imágenes de páginas adjuntas. No uses OCR externo, texto embebido del PDF, QR ni conocimiento previo para completar datos. Devolvé solo un objeto JSON compatible con el esquema voucher-ar-v2 solicitado.

Para cada campo, copiá únicamente texto o valores que sean visibles y legibles en la imagen. Si el campo no aparece o no se puede leer, devolvé null; para listas, devolvé null si no hay evidencia legible de esa sección. No inventes valores, no infieras CUIT, CAE, fecha, importes, moneda ni condición fiscal. Conservá importes como cadenas decimales con punto, sin separadores de miles. La fecha y el vencimiento deben ser YYYY-MM-DD. CUIT debe tener once dígitos o ser null. Usá tipo_documento=ilegible cuando el comprobante no pueda clasificarse por su imagen.

Incluí en confianza un valor entre 0 y 1 por cada campo no nulo, usando como clave el nombre del campo o la ruta de lista (por ejemplo iva.0.importe, percepciones.0.tipo, items.0.descripcion). La confianza es una estimación del modelo, no una validación contable. No agregues explicaciones fuera del JSON."""


def _model_name() -> str | None:
    value = os.getenv("EXTRACTION_MODEL", "").strip()
    return value or None


def _manual_if_unavailable() -> tuple[str, str | None, str | None] | None:
    engine = os.getenv("EXTRACTION_ENGINE", "model").strip().lower()
    if engine != "model":
        return "EXTRACTION_ENGINE_UNSUPPORTED", None, None
    model = _model_name()
    if model is None:
        return "EXTRACTION_MODEL_NOT_CONFIGURED", None, None
    if model not in ALLOWED_OPENROUTER_MODELS:
        return "MODEL_NOT_PRIVACY_ALLOWLISTED", None, model
    if not ALLOWED_OPENROUTER_PROVIDERS:
        return "OPENROUTER_PROVIDER_NOT_PRIVACY_ALLOWLISTED", None, model
    if not os.getenv("OPENROUTER_API_KEY"):
        return "OPENROUTER_API_KEY_MISSING", None, model
    return None


def _image_as_jpeg(data: bytes, *, max_edge: int | None = None) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        source.verify()
    with Image.open(io.BytesIO(data)) as source:
        image = source.convert("RGB")
    if max_edge is not None and max(image.size) > max_edge:
        scale = max_edge / max(image.size)
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=PDF_JPEG_QUALITY, optimize=True)
    return output.getvalue()


def _prepare_page_images(data: bytes, mime_type: str, max_pages: int) -> list[bytes]:
    if max_pages < 1 or max_pages > MAX_PAGES:
        raise ValueError("PAGE_LIMIT_INVALID")
    if mime_type == "application/pdf":
        from pdf2image import convert_from_bytes

        pages = convert_from_bytes(
            data,
            dpi=PDF_DPI,
            first_page=1,
            last_page=max_pages + 1,
            fmt="jpeg",
            thread_count=1,
        )
        if len(pages) > max_pages:
            raise OverflowError("PAGE_LIMIT_EXCEEDED")
        rendered: list[bytes] = []
        for page in pages:
            if max(page.size) > MAX_IMAGE_EDGE:
                scale = MAX_IMAGE_EDGE / max(page.size)
                page = page.resize(
                    (max(1, round(page.width * scale)), max(1, round(page.height * scale))),
                    Image.Resampling.LANCZOS,
                )
            buffer = io.BytesIO()
            page.convert("RGB").save(buffer, format="JPEG", quality=PDF_JPEG_QUALITY, optimize=True)
            rendered.append(buffer.getvalue())
        return rendered
    if mime_type.startswith("image/"):
        return [_image_as_jpeg(data, max_edge=MAX_IMAGE_EDGE)]
    raise ValueError("UNSUPPORTED_MIME_TYPE")


def _json_schema() -> dict[str, Any]:
    return VoucherARV2.model_json_schema()


def _request_payload(model: str, pages: list[bytes]) -> dict[str, Any]:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": "Extraé este comprobante según voucher-ar-v2. Cada imagen corresponde a una página, en orden; usá null para los campos no visibles y no inventes valores.",
        }
    ]
    for index, page in enumerate(pages, start=1):
        data_url = "data:image/jpeg;base64," + base64.b64encode(page).decode("ascii")
        content.extend(
            [
                {"type": "text", "text": f"Página {index}"},
                {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
            ]
        )
    return {
        "model": model,
        "temperature": 0,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "usage": {"include": True},
        "provider": {
            "only": list(ALLOWED_OPENROUTER_PROVIDERS),
            "zdr": True,
            "data_collection": "deny",
            "require_parameters": True,
            "allow_fallbacks": False,
        },
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "voucher_ar_v2",
                "strict": False,
                "schema": _json_schema(),
            },
        },
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
    }


def _usage_numbers(payload: dict[str, Any]) -> tuple[int | None, int | None, float | None]:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None, None, None
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    input_tokens = prompt if isinstance(prompt, int) and prompt >= 0 else None
    output_tokens = completion if isinstance(completion, int) and completion >= 0 else None
    cost = usage.get("cost")
    if cost is None:
        details = usage.get("cost_details")
        if isinstance(details, dict):
            cost = details.get("upstream_inference_cost")
    try:
        cost_usd = float(Decimal(str(cost))) if cost is not None else None
    except (InvalidOperation, ValueError):
        cost_usd = None
    return input_tokens, output_tokens, cost_usd


def _estimate_cost(input_tokens: int | None, output_tokens: int | None) -> float | None:
    input_rate = os.getenv("EXTRACTION_INPUT_USD_PER_MILLION_TOKENS")
    output_rate = os.getenv("EXTRACTION_OUTPUT_USD_PER_MILLION_TOKENS")
    if input_tokens is None or output_tokens is None or input_rate is None or output_rate is None:
        return None
    try:
        cost = (
            Decimal(input_tokens) * Decimal(input_rate)
            + Decimal(output_tokens) * Decimal(output_rate)
        ) / Decimal(1_000_000)
    except InvalidOperation:
        return None
    return float(cost)


def _model_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("MODEL_RESPONSE_SCHEMA_INVALID")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise TypeError("MODEL_RESPONSE_SCHEMA_INVALID")
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        fragments: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                raise TypeError("MODEL_RESPONSE_SCHEMA_INVALID")
            fragment = part.get("text")
            if not isinstance(fragment, str):
                raise TypeError("MODEL_RESPONSE_SCHEMA_INVALID")
            fragments.append(fragment)
        if fragments:
            return "".join(fragments)
    raise ValueError("MODEL_RESPONSE_SCHEMA_INVALID")


def _aggregated_usage(
    attempts: list[tuple[int | None, int | None, float | None]],
) -> tuple[int | None, int | None, float | None]:
    if not attempts or any(item[0] is None or item[1] is None for item in attempts):
        return None, None, None
    input_tokens = sum(item[0] or 0 for item in attempts)
    output_tokens = sum(item[1] or 0 for item in attempts)
    cost: float | None
    if all(item[2] is not None for item in attempts):
        cost = sum(item[2] or 0.0 for item in attempts)
    else:
        cost = _estimate_cost(input_tokens, output_tokens)
    return input_tokens, output_tokens, cost


async def run_model_extraction(
    data: bytes,
    mime_type: str,
    max_pages: int = MAX_PAGES,
) -> VoucherExtractionResponse:
    """Ejecuta un modelo multimodal; cualquier falla termina en revisión manual."""
    unavailable = _manual_if_unavailable()
    if unavailable is not None:
        reason, provider, model = unavailable
        return manual_review_response(reason, provider=provider, model=model)

    model = _model_name()
    assert model is not None  # _manual_if_unavailable validó la configuración.
    started = time.perf_counter()
    try:
        pages = await asyncio.to_thread(_prepare_page_images, data, mime_type, max_pages)
    except OverflowError:
        return manual_review_response(
            "PAGE_LIMIT_EXCEEDED",
            model=model,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )
    except Exception:  # noqa: BLE001 - raster/decoder failures become manual review.
        reason = (
            "PDF_RASTERIZATION_FAILED" if mime_type == "application/pdf" else "IMAGE_DECODE_FAILED"
        )
        return manual_review_response(
            reason,
            model=model,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )

    if not pages:
        return manual_review_response(
            "NO_RENDERED_PAGES",
            model=model,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )
    request_payload = _request_payload(model, pages)
    attempts: list[tuple[int | None, int | None, float | None]] = []
    last_reason = "MODEL_RETRY_EXHAUSTED"
    try:
        timeout = float(os.getenv("EXTRACTION_MODEL_TIMEOUT_SECONDS", str(MODEL_TIMEOUT_SECONDS)))
        if not 0 < timeout <= 60:
            raise ValueError("invalid extraction model timeout")
    except ValueError:
        return manual_review_response("EXTRACTION_MODEL_TIMEOUT_CONFIG_INVALID", model=model)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            for _attempt in range(2):
                try:
                    response = await client.post(
                        OPENROUTER_URL,
                        headers={
                            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                            "Content-Type": "application/json",
                        },
                        json=request_payload,
                    )
                    if response.status_code >= 400:
                        status = response.status_code
                        try:
                            error_payload = response.json()
                            attempts.append(
                                _usage_numbers(error_payload)
                                if isinstance(error_payload, dict)
                                else (None, None, None)
                            )
                        except ValueError:
                            attempts.append((None, None, None))
                        last_reason = f"MODEL_HTTP_ERROR_{status}"
                        continue

                    payload = response.json()
                    if not isinstance(payload, dict):
                        attempts.append((None, None, None))
                        last_reason = "MODEL_RESPONSE_JSON_INVALID"
                        continue
                    attempts.append(_usage_numbers(payload))
                    try:
                        content = _model_content(payload)
                        decoded = json.loads(content)
                    except json.JSONDecodeError:
                        last_reason = "MODEL_JSON_INVALID"
                        continue
                    except ValueError:
                        last_reason = "MODEL_RESPONSE_SCHEMA_INVALID"
                        continue
                    except TypeError:
                        last_reason = "MODEL_RESPONSE_SCHEMA_INVALID"
                        continue
                    if not isinstance(decoded, dict):
                        last_reason = "MODEL_SCHEMA_INVALID"
                        continue
                    try:
                        voucher = VoucherARV2.model_validate(decoded)
                    except ValidationError:
                        last_reason = "MODEL_SCHEMA_INVALID"
                        continue

                    input_tokens, output_tokens, cost = _aggregated_usage(attempts)
                    return response_from_voucher(
                        voucher,
                        model=model,
                        provider="openrouter",
                        prompt_version=PROMPT_VERSION,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        latency_ms=round((time.perf_counter() - started) * 1000),
                        estimated_cost_usd=cost,
                    )
                except httpx.TimeoutException:
                    attempts.append((None, None, None))
                    last_reason = "MODEL_TIMEOUT"
                except httpx.HTTPError:
                    attempts.append((None, None, None))
                    last_reason = "MODEL_HTTP_ERROR"
                except (ValueError, TypeError):
                    attempts.append((None, None, None))
                    last_reason = "MODEL_RESPONSE_JSON_INVALID"
                except Exception:  # noqa: BLE001 - unexpected model-client errors fail closed.
                    attempts.append((None, None, None))
                    last_reason = "MODEL_CALL_FAILED"
    except Exception:  # noqa: BLE001 - client setup failures become manual review.
        attempts.append((None, None, None))
        last_reason = "MODEL_CLIENT_UNAVAILABLE"

    input_tokens, output_tokens, cost = _aggregated_usage(attempts)
    return manual_review_response(
        last_reason,
        model=model,
        provider="openrouter",
        prompt_version=PROMPT_VERSION,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=round((time.perf_counter() - started) * 1000),
        estimated_cost_usd=cost,
    )
