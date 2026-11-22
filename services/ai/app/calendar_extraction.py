"""Lectura con IA de calendarios fiscales desde su PDF (brief 5A).

Usa la misma vía que la Bandeja (OpenRouter con la política de proveedores y el
modelo configurado en EXTRACTION_MODEL) y las mismas guardas de configuración. Lo que
cambia es el esquema: el modelo devuelve filas de vencimientos y este módulo las
entrega como CSV con las columnas de la importación de calendarios. La API valida
cada fila con el mapeo de siempre; acá no se decide nada del calendario.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import csv
import hashlib
import io
import os
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from .model_extraction import (
    MAX_OUTPUT_TOKENS,
    MODEL_TIMEOUT_SECONDS,
    OPENROUTER_URL,
    _manual_if_unavailable,
    _model_content,
    _model_name,
    _parse_model_json,
    _prepare_page_images,
)
from .openrouter_policy import ALLOWED_OPENROUTER_PROVIDERS, build_provider_payload

CONTRACT_VERSION = "calendar-ar-v1"
PROMPT_VERSION = "calendar-ar-v1"
MAX_CALENDAR_PAGES = 12
MAX_ROWS = 2000

# Mismas columnas y orden que la importación de calendarios (TAX_CALENDAR_IMPORT_COLUMNS).
CSV_COLUMNS = (
    "calendario",
    "bloque",
    "concepto",
    "periodo_referencia",
    "criterio_agrupacion",
    "digitos",
    "fecha_completa",
    "nota",
    "origen_celda",
    "confianza",
    "verificado_en_imagen",
)

SYSTEM_PROMPT = """Sos un extractor de calendarios de vencimientos fiscales argentinos. Leé únicamente las imágenes de páginas adjuntas. Devolvé un único objeto JSON, sin markdown ni texto alrededor, con la forma {"filas": [...]}.

Cada elemento de "filas" es una celda del calendario: una fecha de vencimiento para un concepto, un grupo de terminaciones de CUIT (o «todos») y un período de referencia. Usá exactamente estas claves por fila:
- "bloque": nombre de la sección o tabla del PDF donde está la celda.
- "concepto": nombre del impuesto o régimen tal como figura impreso.
- "periodo_referencia": "AAAA-MM" si el período es un mes (por ejemplo "Octubre 2026" es "2026-10"); si no es un mes, el texto impreso.
- "criterio_agrupacion": "terminación de CUIT" cuando la fecha depende de la última cifra del CUIT; "todos" cuando la fecha vale para todos los contribuyentes.
- "digitos": las terminaciones impresas, por ejemplo "0123" o "4-5"; "todos" si criterio_agrupacion es "todos".
- "fecha_completa": la fecha de vencimiento en AAAA-MM-DD. Si la fecha impresa es DD/MM/AAAA, convertila; la fecha argentina es siempre día/mes.
- "nota": texto de la nota al pie que afecta la celda, o "" si no hay.
- "origen_celda": "pág. N, <bloque o tabla>" con el número de página donde está la celda.
- "confianza": "alta", "media" o "baja" según qué tan legible y sin ambigüedad está la celda.
- "verificado_en_imagen": "si" solo si leíste la fecha y las terminaciones directamente en la imagen; "no" en otro caso.

No inventes fechas ni terminaciones. Si una celda no se lee con claridad, incluila con confianza "baja" y verificado_en_imagen "no" para que quede marcada como dudosa. Omití texto que no sea calendario (encabezados legales, contactos, publicidad). No agregues explicaciones fuera del JSON."""


class CalendarScope(BaseModel):
    organismo: str = Field(min_length=1, max_length=200)
    jurisdiccion: str = Field(min_length=1, max_length=200)
    anio: int = Field(ge=2000, le=2100)
    titulo: str = Field(min_length=1, max_length=200)


class CalendarSource(BaseModel):
    pdfBase64: str = Field(min_length=1)
    mimeType: Literal["application/pdf"]
    sizeBytes: int = Field(ge=1)
    sha256: str = Field(min_length=64, max_length=64)


class CalendarExtractionRequest(BaseModel):
    contractVersion: str
    runId: str
    firmId: str
    calendar: CalendarScope
    source: CalendarSource


class CalendarExtractionResponse(BaseModel):
    status: Literal["READ", "UNREADABLE"]
    reason: str | None = None
    csv: str | None = None
    pageCount: int | None = None
    rowCount: int = 0
    model: str | None = None
    provider: str | None = None
    promptVersion: str = PROMPT_VERSION


def _unreadable(
    reason: str,
    *,
    model: str | None = None,
    provider: str | None = None,
    page_count: int | None = None,
) -> CalendarExtractionResponse:
    return CalendarExtractionResponse(
        status="UNREADABLE",
        reason=reason,
        model=model,
        provider=provider,
        pageCount=page_count,
    )


def decode_source(pdf_base64: str, size_bytes: int, sha256: str) -> bytes:
    """Decodifica el PDF y verifica tamaño y hash. Lanza ValueError si no coincide."""
    try:
        data = base64.b64decode(pdf_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("SOURCE_INVALID") from exc
    if len(data) != size_bytes or hashlib.sha256(data).hexdigest() != sha256:
        raise ValueError("SOURCE_INTEGRITY_MISMATCH")
    return data


def filas_a_csv(filas: list[Any], titulo: str) -> tuple[str, int]:
    """Convierte las filas del modelo al CSV de la importación. Las filas que no son objetos se descartan."""
    salida = io.StringIO()
    escritor = csv.writer(salida, lineterminator="\n")
    escritor.writerow(CSV_COLUMNS)
    cantidad = 0
    for fila in filas[:MAX_ROWS]:
        if not isinstance(fila, dict):
            continue
        valores: list[str] = []
        for columna in CSV_COLUMNS:
            if columna == "calendario":
                valores.append(titulo)
                continue
            bruto = fila.get(columna)
            if bruto is None:
                valores.append("")
            elif isinstance(bruto, (str, int, float)) and not isinstance(bruto, bool):
                valores.append(str(bruto).strip())
            else:
                valores.append("")
        escritor.writerow(valores)
        cantidad += 1
    return salida.getvalue(), cantidad


def _request_payload(model: str, pages: list[bytes], scope: CalendarScope) -> dict[str, Any]:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"Calendario: {scope.titulo} ({scope.organismo}, {scope.jurisdiccion}, {scope.anio}). "
                "Cada imagen es una página del PDF, en orden. Devolvé el JSON con las celdas."
            ),
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


async def _consultar_modelo(
    model: str, pages: list[bytes], scope: CalendarScope
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Consulta el modelo (hasta dos intentos). Devuelve (objeto, proveedor, motivo de falla)."""
    request_payload = _request_payload(model, pages, scope)
    last_reason = "MODEL_RETRY_EXHAUSTED"
    try:
        async with httpx.AsyncClient(timeout=MODEL_TIMEOUT_SECONDS) as client:
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
                        last_reason = f"MODEL_HTTP_ERROR_{response.status_code}"
                        continue
                    payload = response.json()
                    if not isinstance(payload, dict):
                        last_reason = "MODEL_RESPONSE_JSON_INVALID"
                        continue
                    response_model = payload.get("model")
                    if isinstance(response_model, str) and response_model != model:
                        last_reason = "MODEL_RESPONSE_MODEL_MISMATCH"
                        continue
                    decoded = _parse_model_json(_model_content(payload))
                    if not isinstance(decoded, dict):
                        last_reason = "MODEL_SCHEMA_INVALID"
                        continue
                    proveedor = payload.get("provider")
                    provider = proveedor.strip() if isinstance(proveedor, str) and proveedor.strip() else "openrouter"
                    return decoded, provider, None
                except httpx.TimeoutException:
                    last_reason = "MODEL_TIMEOUT"
                except httpx.HTTPError:
                    last_reason = "MODEL_HTTP_ERROR"
                except (ValueError, TypeError):
                    last_reason = "MODEL_RESPONSE_JSON_INVALID"
    except Exception:  # noqa: BLE001 - fallas del cliente HTTP terminan en revisión manual.
        last_reason = "MODEL_CLIENT_UNAVAILABLE"
    return None, None, last_reason


async def run_calendar_extraction(
    data: bytes,
    mime_type: str,
    scope: CalendarScope,
    max_pages: int = MAX_CALENDAR_PAGES,
) -> CalendarExtractionResponse:
    """Lee el PDF del calendario. Cualquier falla termina en UNREADABLE con un motivo; nunca inventa celdas."""
    unavailable = _manual_if_unavailable()
    if unavailable is not None:
        reason, provider, model = unavailable
        return _unreadable(reason, model=model, provider=provider)

    model = _model_name()
    assert model is not None  # _manual_if_unavailable validó la configuración.
    try:
        pages = await asyncio.to_thread(
            _prepare_page_images, data, mime_type, max_pages, ceiling=MAX_CALENDAR_PAGES
        )
    except OverflowError:
        return _unreadable("PAGE_LIMIT_EXCEEDED", model=model)
    except Exception:  # noqa: BLE001 - PDF dañado o no rasterizable.
        return _unreadable("PDF_RASTERIZATION_FAILED", model=model)
    if not pages:
        return _unreadable("NO_RENDERED_PAGES", model=model)

    decoded, provider_modelo, motivo_falla = await _consultar_modelo(model, pages, scope)
    if decoded is None:
        return _unreadable(motivo_falla or "MODEL_CALL_FAILED", model=model, page_count=len(pages))
    filas = decoded.get("filas")
    if not isinstance(filas, list) or not filas:
        return _unreadable("NO_CALENDAR_ROWS", model=model, provider=provider_modelo, page_count=len(pages))

    csv_text, cantidad = filas_a_csv(filas, scope.titulo)
    return CalendarExtractionResponse(
        status="READ",
        csv=csv_text,
        pageCount=len(pages),
        rowCount=cantidad,
        model=model,
        provider=provider_modelo,
    )
