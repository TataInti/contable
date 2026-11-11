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

from .openrouter_policy import (
    ALLOWED_OPENROUTER_MODELS,
    ALLOWED_OPENROUTER_PROVIDERS,
    build_provider_payload,
)
from .voucher_v2 import (
    PERCEPTION_CATEGORIES,
    VoucherARV21,
    VoucherExtractionResponse,
    manual_review_response,
    response_from_voucher,
)

PROMPT_VERSION = "vision-ar-v5"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
PDF_DPI = 150
PDF_JPEG_QUALITY = 85
MAX_IMAGE_EDGE = 2048
MAX_PAGES = 3
MAX_OUTPUT_TOKENS = 4096
MODEL_TIMEOUT_SECONDS = 55.0

SYSTEM_PROMPT = """Sos un extractor multimodal de comprobantes argentinos. Leé únicamente las imágenes de páginas adjuntas. No uses OCR externo, texto embebido del PDF, QR ni conocimiento previo para completar datos. Devolvé un único objeto JSON plano, sin markdown, fences ni texto circundante.

Usá sólo estas claves exactas de voucher-ar-v2.1: tipo_documento, letra, punto_venta, numero, fecha, hora, cuit_emisor, cuit_receptor, razon_social_emisor, razon_social_receptor, condicion_iva, neto_gravado, iva, no_gravado, exento, percepciones, total, moneda, cae, cae_vencimiento y confianza. Los datos del emisor y del receptor van en sus claves planas; no los anides. No agregues claves schema, vencimiento, punto_de_venta, base_imponible ni envoltorios emisor, receptor o voucher. Cada elemento de iva usa alicuota e importe. Cada elemento de percepciones usa categoria, tipo_texto e importe.

Para cada campo, copiá únicamente texto o valores que sean visibles y legibles en la imagen. Omití las claves ausentes o no legibles; el contrato las interpreta como null. No inventes valores, no infieras CUIT, CAE, fecha, importes, moneda ni condición fiscal. Conservá importes y alícuotas como cadenas decimales con punto, sin separadores de miles. La fecha y cae_vencimiento deben ser YYYY-MM-DD. CUIT debe tener exactamente once dígitos consecutivos, sin guiones ni espacios. Usá tipo_documento=ilegible cuando el comprobante no pueda clasificarse por su imagen.

tipo_documento sólo admite estos literales exactos: `factura`, `ticket_no_fiscal`, `recibo`, `nota_credito`, `nota_debito`, `otro` o `ilegible`. Un recibo de pago es `recibo`; usá `ticket_no_fiscal` únicamente para un ticket no fiscal, no porque falten datos tributarios. Si el documento es un ticket no fiscal, tipo_documento debe ser exactamente `ticket_no_fiscal`, nunca su etiqueta en lenguaje natural. Ejemplo mínimo válido para un ticket no fiscal:
{"tipo_documento":"ticket_no_fiscal","letra":null,"cuit_emisor":null,"cuit_receptor":null,"cae":null,"confianza":{"tipo_documento":0.95}}

`percepciones.categoria` debe ser exactamente una de estas categorías: `IIBB`, `IVA`, `Ganancias`, `SUSS`, `Impuestos internos`, `Municipal` u `Otras`. Clasificá por el impuesto/régimen que se ve; usá `Otras` como respaldo cuando no puedas clasificar. `percepciones.tipo_texto` es la transcripción literal completa del texto impreso que identifica esa percepción. No antepongas `Percepcion` si no está impresa, conservá las palabras y calificadores posteriores al nombre del impuesto, no reformules ni trunques. Ejemplo: para el rótulo impreso `IIBB - dato sintetico`, devolvé `{"categoria":"IIBB","tipo_texto":"IIBB - dato sintetico","importe":"157.30"}`. Si el texto no se ve o no se puede leer, dejá tipo_texto en null; no lo completes. `condicion_iva` también es transcripción literal completa; conservá cada palabra impresa.

Incluí en confianza un valor entre 0 y 1 por cada campo no nulo, usando como clave el nombre del campo o la ruta de lista (por ejemplo iva.0.importe, percepciones.0.categoria, percepciones.0.tipo_texto). La confianza es una estimación del modelo, no una validación contable. No agregues explicaciones fuera del JSON."""


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


def _request_payload(model: str, pages: list[bytes]) -> dict[str, Any]:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": "Extraé este comprobante según voucher-ar-v2.1. Cada imagen corresponde a una página, en orden. Usá las claves exactas y planas de voucher-ar-v2.1 indicadas por el sistema; omití campos ausentes y no inventes valores.",
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
        "max_tokens": MAX_OUTPUT_TOKENS,
        "usage": {"include": True},
        "provider": build_provider_payload(ALLOWED_OPENROUTER_PROVIDERS),
        "response_format": {"type": "json_object"},
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


def _parse_model_json(content: str) -> Any:
    """Parse JSON while tolerating a surrounding Markdown code fence."""
    text = content.strip()
    lines = text.splitlines()
    if lines and lines[0].strip().startswith("```"):
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)


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


def _normalize_perception_categories(
    decoded: dict[str, Any],
) -> tuple[dict[str, Any], tuple[int, ...]]:
    """Mapea categorías inválidas o de respaldo a Otras y las marca para revisión."""
    perceptions = decoded.get("percepciones")
    if not isinstance(perceptions, list):
        return decoded, ()

    normalized = dict(decoded)
    normalized_perceptions: list[Any] = []
    confidence = decoded.get("confianza")
    normalized_confidence = dict(confidence) if isinstance(confidence, dict) else {}
    unknown_indexes: list[int] = []
    for index, perception in enumerate(perceptions):
        if not isinstance(perception, dict):
            normalized_perceptions.append(perception)
            continue
        category = perception.get("categoria")
        text = perception.get("tipo_texto")
        if (
            category not in PERCEPTION_CATEGORIES
            or category == "Otras"
            or not isinstance(text, str)
            or not text.strip()
        ):
            category = "Otras"
            unknown_indexes.append(index)
            normalized_confidence[f"percepciones.{index}.categoria"] = 0.0
        normalized_perceptions.append({**perception, "categoria": category})

    normalized["percepciones"] = normalized_perceptions
    if "confianza" in decoded or unknown_indexes:
        normalized["confianza"] = normalized_confidence
    return normalized, tuple(unknown_indexes)


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
                    response_model = payload.get("model")
                    if isinstance(response_model, str) and response_model != model:
                        last_reason = "MODEL_RESPONSE_MODEL_MISMATCH"
                        continue
                    try:
                        content = _model_content(payload)
                        decoded = _parse_model_json(content)
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
                        normalized, unknown_perception_indexes = _normalize_perception_categories(
                            decoded
                        )
                        voucher = VoucherARV21.model_validate(normalized)
                    except ValidationError:
                        last_reason = "MODEL_SCHEMA_INVALID"
                        continue

                    input_tokens, output_tokens, cost = _aggregated_usage(attempts)
                    response_provider = payload.get("provider")
                    provider = (
                        response_provider.strip()
                        if isinstance(response_provider, str) and response_provider.strip()
                        else "openrouter"
                    )
                    return response_from_voucher(
                        voucher,
                        model=model,
                        provider=provider,
                        prompt_version=PROMPT_VERSION,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        latency_ms=round((time.perf_counter() - started) * 1000),
                        estimated_cost_usd=cost,
                        unrecognized_perception_indexes=unknown_perception_indexes,
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
