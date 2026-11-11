from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthLive(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = "ok"


class HealthReady(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = "ready"


class ExtractionSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    downloadUrl: str
    mimeType: str
    sizeBytes: int = Field(gt=0)
    sha256: str


class ExtractionOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    country: str = "AR"
    language: str = "es"
    maxPages: int = Field(default=3, gt=0, le=3)
    schemaVersion: Literal["voucher-ar-v2.1"] = "voucher-ar-v2.1"


class ExtractionCallback(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    expiresAt: str


class ExtractionRunRequest(BaseModel):
    """Contrato Node → FastAPI (extra: forbid)."""

    model_config = ConfigDict(extra="forbid")

    contractVersion: str = "1.0"
    runId: str
    firmId: str
    clientId: str
    documentId: str
    source: ExtractionSource
    options: ExtractionOptions
    callback: ExtractionCallback


class ExtractionRunAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: str
    status: str = "ACCEPTED"


class AssistantMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    content: str


class AssistantContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    firmId: str
    clientId: str
    periodId: str | None = None
    fiscalYearId: str | None = None


class AssistantEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = "ACCOUNT"
    sourceType: str
    sourceId: str
    label: str | None = None
    value: str | None = None


class AssistantTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str = ""


class AssistantToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    data: dict[str, object]
    evidence: list[AssistantEvidence] = Field(default_factory=list)


class AssistantRunRequest(BaseModel):
    """Contrato Node → FastAPI para el asistente (extra: forbid)."""

    model_config = ConfigDict(extra="forbid")

    contractVersion: str = "1.0"
    runId: str
    context: AssistantContext
    history: list[AssistantMessage] = Field(default_factory=list)
    query: str
    tools: list[AssistantTool] = Field(default_factory=list)
    toolResults: list[AssistantToolResult] = Field(default_factory=list)
    promptVersion: str = "assistant-ar-v1"


class AssistantRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: str
    answer: str
    abstained: bool = False
    abstentionReason: str | None = None
    evidence: list[AssistantEvidence] = Field(default_factory=list)
    toolCalls: list[str] = Field(default_factory=list)
    model: str | None = None
    provider: str | None = None
    promptVersion: str | None = None
