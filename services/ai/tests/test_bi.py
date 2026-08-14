from app.bi import BiPlanRequest, plan_bi
from app.contracts import AssistantContext


def _request(query: str, period: str | None = "2026-01") -> BiPlanRequest:
    return BiPlanRequest(
        runId="01900000-0000-7000-8000-000000000099",
        context=AssistantContext(
            firmId="11111111-1111-4111-8111-111111111111",
            clientId="22222222-2222-4222-8222-222222222222",
            periodId=period,
        ),
        query=query,
        metricCatalog=["total_revenue", "total_expenses", "net_income"],
        dimensionCatalog=["account", "period"],
    )


def test_valid_plan() -> None:
    result = plan_bi(_request("¿Cuál es el ingreso total por cuenta?"))
    assert result.rejected is False
    assert result.plan is not None
    assert result.plan.metric == "total_revenue"
    assert "account" in result.plan.dimensions


def test_reject_without_period() -> None:
    result = plan_bi(_request("¿Ingreso total?", period=None))
    assert result.rejected is True
    assert result.rejectionReason == "NO_PERIOD_CONTEXT"


def test_reject_unknown_metric() -> None:
    result = plan_bi(_request("¿Cuántos empleados hay?"))
    assert result.rejected is True
    assert result.rejectionReason == "UNKNOWN_METRIC"


def test_reject_metric_not_allowed() -> None:
    # total_assets no está en el catálogo
    result = plan_bi(_request("¿Cuál es el total de activos?"))
    assert result.rejected is True
    assert result.rejectionReason == "METRIC_NOT_ALLOWED"