import hashlib

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from .assistant import run_assistant
from .auth import ServiceAuth
from .bi import BiPlanRequest, BiPlanResponse, plan_bi
from .contracts import (
    AssistantRunRequest,
    AssistantRunResponse,
    ExtractionRunRequest,
    HealthLive,
    HealthReady,
)
from .extraction import ExtractionResult
from .extractor import extract_from_image_bytes, extract_from_pdf_bytes

app = FastAPI(title="Contable AI", version="0.1.0")
auth = ServiceAuth()


@app.get("/health/live", response_model=HealthLive)
async def health_live() -> HealthLive:
    return HealthLive()


@app.get("/health/ready", response_model=HealthReady)
async def health_ready() -> HealthReady:
    return HealthReady()


@app.post(
    "/internal/v1/extractions",
    response_model=ExtractionResult,
    dependencies=[Depends(auth.verify)],
)
async def start_extraction(
    payload: ExtractionRunRequest, request: Request
) -> ExtractionResult:
    """Procesa el documento: descarga de la URL firmada y extrae campos."""
    # Descargar el archivo desde la URL firmada (MinIO)
    async with httpx.AsyncClient() as client:
        resp = await client.get(payload.source.downloadUrl)
        resp.raise_for_status()
        data = resp.content

    if len(data) != payload.source.sizeBytes or hashlib.sha256(data).hexdigest() != payload.source.sha256:
        raise HTTPException(status_code=422, detail="SOURCE_INTEGRITY_MISMATCH")

    # Extraer según MIME
    if payload.source.mimeType == "application/pdf":
        result = await run_in_threadpool(extract_from_pdf_bytes, data, payload.options.schemaVersion)
    else:
        result = await run_in_threadpool(
            extract_from_image_bytes,
            data,
            payload.options.schemaVersion,
            payload.options.runQrParser,
        )

    return result


@app.post(
    "/internal/v1/assistant/runs",
    response_model=AssistantRunResponse,
    dependencies=[Depends(auth.verify)],
)
async def run_assistant_endpoint(
    payload: AssistantRunRequest, request: Request
) -> AssistantRunResponse:
    """Procesa una consulta del asistente (abstención + verificación)."""
    return await run_assistant(payload)


@app.post(
    "/internal/v1/bi/plan",
    response_model=BiPlanResponse,
    dependencies=[Depends(auth.verify)],
)
async def bi_plan_endpoint(
    payload: BiPlanRequest, request: Request
) -> BiPlanResponse:
    """Genera un plan BI validado (A-006: plan inválido nunca ejecuta)."""
    return plan_bi(payload)
