"""Contrato voucher-ar-v2.1 y validaciones no modificantes."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .extraction import ExtractedField

VoucherType = Literal[
    "factura",
    "ticket_no_fiscal",
    "recibo",
    "nota_credito",
    "nota_debito",
    "otro",
    "ilegible",
]
PERCEPTION_CATEGORIES = (
    "IIBB",
    "IVA",
    "Ganancias",
    "SUSS",
    "Impuestos internos",
    "Municipal",
    "Otras",
)
PerceptionCategory = Literal[
    "IIBB",
    "IVA",
    "Ganancias",
    "SUSS",
    "Impuestos internos",
    "Municipal",
    "Otras",
]
AmountText = Annotated[str, StringConstraints(pattern=r"^-?\d+(?:\.\d{1,6})?$")]
Confidence = Annotated[float, Field(ge=0, le=1)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VatAmount(StrictModel):
    alicuota: AmountText | None = None
    importe: AmountText | None = None


class Perception(StrictModel):
    categoria: PerceptionCategory
    tipo_texto: str | None = None
    importe: AmountText | None = None


class VoucherARV21(StrictModel):
    """Contenido reconocido desde las imágenes, sin completar valores ausentes."""

    tipo_documento: VoucherType
    letra: str | None = None
    punto_venta: str | None = None
    numero: str | None = None
    fecha: str | None = None
    hora: str | None = None
    cuit_emisor: Annotated[str, StringConstraints(pattern=r"^\d{11}$")] | None = None
    cuit_receptor: Annotated[str, StringConstraints(pattern=r"^\d{11}$")] | None = None
    razon_social_emisor: str | None = None
    razon_social_receptor: str | None = None
    condicion_iva: str | None = None
    neto_gravado: AmountText | None = None
    iva: list[VatAmount] | None = None
    no_gravado: AmountText | None = None
    exento: AmountText | None = None
    percepciones: list[Perception] | None = None
    total: AmountText | None = None
    moneda: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] | None = None
    cae: str | None = None
    cae_vencimiento: str | None = None
    confianza: dict[str, Confidence] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_confidence_and_dates(self) -> VoucherARV21:
        from datetime import date

        if any(path == "items" or path.startswith("items.") for path in self.confianza):
            raise ValueError("voucher-ar-v2.1 no contempla confianza de ítems")

        for date_field in ("fecha", "cae_vencimiento"):
            value = getattr(self, date_field)
            if value is not None:
                try:
                    if date.fromisoformat(value).isoformat() != value:
                        raise ValueError
                except ValueError as exc:
                    raise ValueError(f"{date_field} debe tener formato YYYY-MM-DD") from exc

        for field_name in (
            "tipo_documento",
            "letra",
            "punto_venta",
            "numero",
            "fecha",
            "hora",
            "cuit_emisor",
            "cuit_receptor",
            "razon_social_emisor",
            "razon_social_receptor",
            "condicion_iva",
            "neto_gravado",
            "no_gravado",
            "exento",
            "total",
            "moneda",
            "cae",
            "cae_vencimiento",
        ):
            if getattr(self, field_name) is not None:
                self._require_confidence(field_name)

        for group_name in ("iva", "percepciones"):
            entries = getattr(self, group_name)
            if entries is None:
                continue
            for index, entry in enumerate(entries):
                for field_name, value in entry.model_dump().items():
                    if value is not None:
                        self._require_confidence(f"{group_name}.{index}.{field_name}")
        return self

    def _require_confidence(self, field_path: str) -> None:
        if field_path not in self.confianza:
            raise ValueError(f"falta confianza para {field_path}")


class ReviewIssue(StrictModel):
    """Motivo de revisión y, cuando aplica, ruta estable al campo."""

    reason: str
    sourcePath: str | None = None


class VoucherExtractionResponse(StrictModel):
    schemaVersion: Literal["voucher-ar-v2.1"] = "voucher-ar-v2.1"
    voucher: VoucherARV21 | None = None
    classificationConfidence: Confidence | None = None
    fields: list[ExtractedField] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    reviewReason: str | None = None
    reviewIssues: list[ReviewIssue] = Field(default_factory=list)
    ocrEngine: str = "multimodal-model"
    model: str | None = None
    provider: str | None = None
    promptVersion: str = "vision-ar-v5"
    inputTokens: int | None = Field(default=None, ge=0)
    outputTokens: int | None = Field(default=None, ge=0)
    latencyMs: int = Field(default=0, ge=0)
    estimatedCostUsd: float | None = Field(default=None, ge=0)


_UI_FIELD_KEYS = {
    "tipo_documento": "voucherType",
    "letra": "letter",
    "punto_venta": "pointOfSale",
    "numero": "voucherNumber",
    "fecha": "issueDate",
    "hora": "time",
    "cuit_emisor": "issuerTaxId",
    "cuit_receptor": "receiverTaxId",
    "razon_social_emisor": "issuerName",
    "razon_social_receptor": "receiverName",
    "condicion_iva": "vatCondition",
    "neto_gravado": "netAmount",
    "no_gravado": "nonTaxableAmount",
    "exento": "exemptAmount",
    "total": "totalAmount",
    "moneda": "currency",
    "cae": "cae",
    "cae_vencimiento": "caeExpiration",
}


ARITHMETIC_TOLERANCE = Decimal("0.02")


def source_path_for(group_name: str, index: int, field_name: str) -> str:
    """Construye una ruta estable con índice de lista basado en cero."""
    return f"{group_name}[{index}].{field_name}"


def validate_arithmetic(voucher: VoucherARV21) -> list[str]:
    """Marca desvíos aritméticos y preserva todos los importes originales."""
    reasons: list[str] = []
    if voucher.total is None:
        return reasons
    total = Decimal(voucher.total)

    # Los null indican que el campo no fue visible; no se los interpreta como cero.
    components_available = (
        voucher.neto_gravado is not None
        and voucher.iva is not None
        and all(item.importe is not None for item in voucher.iva)
        and voucher.no_gravado is not None
        and voucher.exento is not None
        and voucher.percepciones is not None
        and all(item.importe is not None for item in voucher.percepciones)
    )
    if components_available:
        component_sum = Decimal(voucher.neto_gravado or "0")
        component_sum += sum(
            (Decimal(item.importe) for item in voucher.iva or [] if item.importe is not None),
            Decimal(0),
        )
        component_sum += Decimal(voucher.no_gravado or "0")
        component_sum += Decimal(voucher.exento or "0")
        component_sum += sum(
            (
                Decimal(item.importe)
                for item in voucher.percepciones or []
                if item.importe is not None
            ),
            Decimal(0),
        )
        if abs(component_sum - total) > ARITHMETIC_TOLERANCE:
            reasons.append("COMPONENT_SUM_MISMATCH")
    return reasons


def response_from_voucher(
    voucher: VoucherARV21,
    *,
    model: str,
    provider: str,
    prompt_version: str,
    input_tokens: int | None,
    output_tokens: int | None,
    latency_ms: int,
    estimated_cost_usd: float | None,
    unrecognized_perception_indexes: tuple[int, ...] = (),
) -> VoucherExtractionResponse:
    fields: list[ExtractedField] = []

    def append_field(path: str, key: str, value: str | None) -> None:
        if value is None:
            return
        fields.append(
            ExtractedField(
                key=key,
                rawValue=value,
                normalizedValue=value,
                confidence=voucher.confianza[path],
                method="VISION",
                status="ACCEPTED",
            )
        )

    for source_key, ui_key in _UI_FIELD_KEYS.items():
        value = getattr(voucher, source_key)
        append_field(source_key, ui_key, value)

    for group_name, aliases in (
        ("iva", {"alicuota": "vatRate", "importe": "vatAmount"}),
        (
            "percepciones",
            {
                "categoria": "perceptionCategory",
                "tipo_texto": "perceptionText",
                "importe": "perceptionAmount",
            },
        ),
    ):
        for index, entry in enumerate(getattr(voucher, group_name) or []):
            for source_key, ui_key in aliases.items():
                value = getattr(entry, source_key)
                append_field(f"{group_name}.{index}.{source_key}", ui_key, value)

    has_fiscal_data = any((voucher.cuit_emisor, voucher.cuit_receptor, voucher.cae, voucher.letra))
    if voucher.tipo_documento == "ticket_no_fiscal" or not has_fiscal_data:
        document_issues = ["sin datos fiscales"]
    else:
        document_issues = validate_arithmetic(voucher)
        if voucher.tipo_documento == "ilegible":
            document_issues.append("DOCUMENT_ILLEGIBLE")
    field_review_issues = [
        ReviewIssue(
            reason="percepción no reconocida",
            sourcePath=source_path_for("percepciones", index, "categoria"),
        )
        for index in unrecognized_perception_indexes
    ]
    review_issues = field_review_issues + [
        ReviewIssue(reason=reason) for reason in dict.fromkeys(document_issues)
    ]
    unique_issues = list(dict.fromkeys(issue.reason for issue in review_issues))
    return VoucherExtractionResponse(
        voucher=voucher,
        classificationConfidence=voucher.confianza["tipo_documento"],
        fields=fields,
        issues=unique_issues,
        reviewReason=", ".join(unique_issues) or None,
        reviewIssues=review_issues,
        model=model,
        provider=provider,
        promptVersion=prompt_version,
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        latencyMs=latency_ms,
        estimatedCostUsd=estimated_cost_usd,
    )


def manual_review_response(
    reason: str,
    *,
    model: str | None = None,
    provider: str | None = None,
    prompt_version: str = "vision-ar-v5",
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    latency_ms: int = 0,
    estimated_cost_usd: float | None = None,
) -> VoucherExtractionResponse:
    return VoucherExtractionResponse(
        reviewReason=reason,
        issues=[reason],
        reviewIssues=[ReviewIssue(reason=reason)],
        model=model,
        provider=provider,
        promptVersion=prompt_version,
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        latencyMs=latency_ms,
        estimatedCostUsd=estimated_cost_usd,
    )
