"""Planner BI (Fase 12).

Invariantes:
- A-006: plan inválido nunca ejecuta (métrica/dimensión/filtro desconocido o cardinalidad excesiva).
- A-008: cifras BI = motor canónico.
- No existe SQL libre.
"""

from pydantic import BaseModel, ConfigDict, Field

from .contracts import AssistantContext


class BiFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    operator: str
    value: str | list[str]


class BiQueryPlanV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = 1
    clientId: str
    fiscalPeriodId: str
    metric: str
    dimensions: list[str] = Field(default_factory=list)
    filters: list[BiFilter] = Field(default_factory=list)
    comparison: str = "NONE"
    limit: int = Field(default=100, ge=1, le=1000)


class BiPlanRequest(BaseModel):
    """Contrato Node → FastAPI para el planner BI (extra: forbid)."""

    model_config = ConfigDict(extra="forbid")

    contractVersion: str = "1.0"
    runId: str
    context: AssistantContext
    query: str
    metricCatalog: list[str] = Field(default_factory=list)
    dimensionCatalog: list[str] = Field(default_factory=list)


class BiPlanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: str
    plan: BiQueryPlanV1 | None = None
    rejected: bool = False
    rejectionReason: str | None = None


# Métricas y dimensiones canónicas (allowlist)
CANONICAL_METRICS = {
    "total_revenue",
    "total_expenses",
    "net_income",
    "total_assets",
    "total_liabilities",
    "equity",
}

# Términos en español → métrica canónica
METRIC_TERMS = {
    "ingreso": "total_revenue",
    "ingresos": "total_revenue",
    "venta": "total_revenue",
    "ventas": "total_revenue",
    "gasto": "total_expenses",
    "gastos": "total_expenses",
    "egreso": "total_expenses",
    "egresos": "total_expenses",
    "resultado": "net_income",
    "ganancia": "net_income",
    "ganancias": "net_income",
    "activo": "total_assets",
    "activos": "total_assets",
    "pasivo": "total_liabilities",
    "pasivos": "total_liabilities",
    "patrimonio": "equity",
}

CANONICAL_DIMENSIONS = {
    "account",
    "period",
    "counterparty",
    "cost_center",
}

MAX_DIMENSIONS = 3
MAX_FILTERS = 5


def _parse_metric(query: str) -> str | None:
    lowered = query.lower()
    for metric in CANONICAL_METRICS:
        if metric.replace("_", " ") in lowered:
            return metric
    for term, metric in METRIC_TERMS.items():
        if term in lowered:
            return metric
    return None


def plan_bi(payload: BiPlanRequest) -> BiPlanResponse:
    """Genera un BiQueryPlanV1 validado (A-006)."""
    # Sin contexto de período → rechazo
    if not payload.context.periodId:
        return BiPlanResponse(
            runId=payload.runId,
            rejected=True,
            rejectionReason="NO_PERIOD_CONTEXT",
        )

    metric = _parse_metric(payload.query)
    if metric is None:
        return BiPlanResponse(
            runId=payload.runId,
            rejected=True,
            rejectionReason="UNKNOWN_METRIC",
        )

    # Validar catálogo (allowlist)
    if metric not in payload.metricCatalog:
        return BiPlanResponse(
            runId=payload.runId,
            rejected=True,
            rejectionReason="METRIC_NOT_ALLOWED",
        )

    # Cardinalidad: dimensiones limitadas
    dimensions: list[str] = []
    dim_terms = {
        "account": ["cuenta", "cuentas", "account"],
        "period": ["periodo", "período", "mes", "period"],
        "counterparty": ["contraparte", "tercero", "proveedor", "cliente", "counterparty"],
        "cost_center": ["centro de costo", "centro de costos", "cost center"],
    }
    for dim, terms in dim_terms.items():
        if any(t in payload.query.lower() for t in terms):
            dimensions.append(dim)
    if len(dimensions) > MAX_DIMENSIONS:
        return BiPlanResponse(
            runId=payload.runId,
            rejected=True,
            rejectionReason="EXCESSIVE_CARDINALITY",
        )

    plan = BiQueryPlanV1(
        clientId=payload.context.clientId,
        fiscalPeriodId=payload.context.periodId,
        metric=metric,
        dimensions=dimensions,
        filters=[],
        comparison="NONE",
        limit=100,
    )

    return BiPlanResponse(runId=payload.runId, plan=plan, rejected=False)
