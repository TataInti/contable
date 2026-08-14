from pydantic import BaseModel, ConfigDict, Field


class ExtractedField(BaseModel):
    """Campo extraído con evidencia."""

    model_config = ConfigDict(extra="forbid")

    key: str
    rawValue: str | None = None
    normalizedValue: str | None = None
    confidence: float = Field(ge=0, le=1)
    page: int | None = Field(default=None, ge=1)
    boundingBox: dict[str, object] | None = None
    method: str = "OCR"
    status: str = "ACCEPTED"


class ExtractedLineItem(BaseModel):
    """Ítem de línea extraído."""

    model_config = ConfigDict(extra="forbid")

    description: str
    quantity: str | None = None
    unitPrice: str | None = None
    netAmount: str | None = None
    vatRate: str | None = None
    vatAmount: str | None = None
    totalAmount: str | None = None
    confidence: float = Field(ge=0, le=1)
    page: int | None = Field(default=None, ge=1)
    boundingBox: dict[str, object] | None = None
    method: str = "OCR"
    status: str = "ACCEPTED"


class ExtractionResult(BaseModel):
    """Resultado estructurado de la extracción."""

    model_config = ConfigDict(extra="forbid")

    documentType: str
    direction: str = "NEUTRAL"
    letter: str | None = None
    pointOfSale: str | None = None
    number: str | None = None
    emitterCuit: str | None = None
    receiverCuit: str | None = None
    issueDate: str | None = None
    totalAmount: str | None = None
    netAmount: str | None = None
    vatAmount: str | None = None
    currency: str | None = None
    classificationConfidence: float = Field(ge=0, le=1)
    fields: list[ExtractedField] = Field(default_factory=list)
    items: list[ExtractedLineItem] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    ocrEngine: str = "embedded-text"
    model: str | None = None
    provider: str | None = None
    promptVersion: str | None = None