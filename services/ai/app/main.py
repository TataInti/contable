import hashlib
import os

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request

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
from .model_extraction import run_model_extraction
from .voucher_v2 import VoucherExtractionResponse

app = FastAPI(title="Contable AI", version="0.1.0")
auth = ServiceAuth()


def _customer_document_extraction_enabled() -> bool:
    """Keep production customer documents disabled until explicitly activated."""
    if os.getenv("NODE_ENV", "").strip().lower() != "production":
        return True
    return os.getenv("EXTRACTION_CUSTOMER_DATA_ENABLED", "false").strip().lower() in {
        "1",
        "true",
    }


@app.get("/health/live", response_model=HealthLive)
async def health_live() -> HealthLive:
    return HealthLive()


@app.get("/health/ready", response_model=HealthReady)
async def health_ready() -> HealthReady:
    return HealthReady()


@app.post(
    "/internal/v1/extractions",
    response_model=VoucherExtractionResponse,
    dependencies=[Depends(auth.verify)],
)
async def start_extraction(
    payload: ExtractionRunRequest, request: Request
) -> VoucherExtractionResponse:
    """Descarga la fuente y entrega sus páginas al modelo multimodal."""
    if not _customer_document_extraction_enabled():
        raise HTTPException(status_code=503, detail="CUSTOMER_DATA_EXTRACTION_DISABLED")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(payload.source.downloadUrl)
        resp.raise_for_status()
        data = resp.content

    if (
        len(data) != payload.source.sizeBytes
        or hashlib.sha256(data).hexdigest() != payload.source.sha256
    ):
        raise HTTPException(status_code=422, detail="SOURCE_INTEGRITY_MISMATCH")

    return await run_model_extraction(
        data,
        payload.source.mimeType,
        payload.options.maxPages,
    )


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
async def bi_plan_endpoint(payload: BiPlanRequest, request: Request) -> BiPlanResponse:
    """Genera un plan BI validado (A-006: plan inválido nunca ejecuta)."""
    return plan_bi(payload)
