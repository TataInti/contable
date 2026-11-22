import base64
import csv
import hashlib
import io
import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app import calendar_extraction as ce
from app.auth import sign, sha256_hex
from app.main import app

client = TestClient(app)
PATH = "/internal/v1/calendar-extractions"
PDF = b"%PDF-1.4 sintetico"
SCOPE = ce.CalendarScope(organismo="ARCA", jurisdiccion="Argentina (Nación)", anio=2026, titulo="Calendario nacional 2026")


@pytest.fixture(autouse=True)
def _auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SERVICE_SECRET", "test-secret")


def _body(pdf: bytes = PDF, *, sha: str | None = None, size: int | None = None) -> bytes:
    payload = {
        "contractVersion": "calendar-ar-v1",
        "runId": str(uuid.uuid4()),
        "firmId": "11111111-1111-4111-8111-111111111111",
        "calendar": {"organismo": "ARCA", "jurisdiccion": "Argentina (Nación)", "anio": 2026, "titulo": "Calendario nacional 2026"},
        "source": {
            "pdfBase64": base64.b64encode(pdf).decode("ascii"),
            "mimeType": "application/pdf",
            "sizeBytes": len(pdf) if size is None else size,
            "sha256": sha or hashlib.sha256(pdf).hexdigest(),
        },
    }
    return json.dumps(payload).encode()


def _headers(body: bytes) -> dict[str, str]:
    ts = str(int(time.time()))
    nonce = str(uuid.uuid4())
    sig = sign("POST", PATH, ts, nonce, sha256_hex(body), "test-secret")
    return {
        "Content-Type": "application/json",
        "X-Service-Id": "api",
        "X-Service-Timestamp": ts,
        "X-Service-Nonce": nonce,
        "X-Service-Signature": sig,
    }


def test_filas_a_csv_usa_las_columnas_de_la_importacion_y_escapa_comas() -> None:
    filas = [
        {
            "bloque": "Vencimientos mensuales",
            "concepto": "IVA, régimen general",
            "periodo_referencia": "2026-10",
            "criterio_agrupacion": "terminación de CUIT",
            "digitos": "0123",
            "fecha_completa": "2026-11-18",
            "nota": "",
            "origen_celda": "pág. 2, Vencimientos mensuales",
            "confianza": "alta",
            "verificado_en_imagen": "si",
        },
        "no es un objeto",
    ]
    texto, cantidad = ce.filas_a_csv(filas, "Calendario nacional 2026")
    lector = list(csv.reader(io.StringIO(texto)))
    assert lector[0] == list(ce.CSV_COLUMNS)
    assert cantidad == 1
    assert lector[1][ce.CSV_COLUMNS.index("concepto")] == "IVA, régimen general"
    assert lector[1][ce.CSV_COLUMNS.index("calendario")] == "Calendario nacional 2026"
    assert lector[1][ce.CSV_COLUMNS.index("fecha_completa")] == "2026-11-18"


@pytest.mark.asyncio
async def test_sin_modelo_configurado_la_lectura_queda_no_disponible(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXTRACTION_MODEL", raising=False)
    resultado = await ce.run_calendar_extraction(PDF, "application/pdf", SCOPE)
    assert resultado.status == "UNREADABLE"
    assert resultado.reason == "EXTRACTION_MODEL_NOT_CONFIGURED"
    assert resultado.csv is None


@pytest.mark.asyncio
async def test_lectura_con_modelo_devuelve_csv_de_las_filas(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ce, "_manual_if_unavailable", lambda: None)
    monkeypatch.setattr(ce, "_model_name", lambda: "modelo-de-prueba")
    monkeypatch.setattr(ce, "_prepare_page_images", lambda *a, **k: [b"pagina-1", b"pagina-2"])

    async def modelo_falso(model, pages, scope):
        assert model == "modelo-de-prueba"
        assert len(pages) == 2
        return {"filas": [{"concepto": "IVA", "digitos": "todos", "criterio_agrupacion": "todos", "fecha_completa": "2026-11-18", "periodo_referencia": "2026-10", "confianza": "baja", "verificado_en_imagen": "no"}]}, "proveedor-test", None

    monkeypatch.setattr(ce, "_consultar_modelo", modelo_falso)
    resultado = await ce.run_calendar_extraction(PDF, "application/pdf", SCOPE)
    assert resultado.status == "READ"
    assert resultado.rowCount == 1
    assert resultado.pageCount == 2
    assert resultado.provider == "proveedor-test"
    assert resultado.csv is not None and "IVA" in resultado.csv


@pytest.mark.asyncio
async def test_sin_filas_o_con_falla_del_modelo_no_inventa_celdas(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ce, "_manual_if_unavailable", lambda: None)
    monkeypatch.setattr(ce, "_model_name", lambda: "modelo-de-prueba")
    monkeypatch.setattr(ce, "_prepare_page_images", lambda *a, **k: [b"pagina-1"])

    async def sin_filas(model, pages, scope):
        return {"filas": []}, "p", None

    monkeypatch.setattr(ce, "_consultar_modelo", sin_filas)
    vacio = await ce.run_calendar_extraction(PDF, "application/pdf", SCOPE)
    assert vacio.status == "UNREADABLE" and vacio.reason == "NO_CALENDAR_ROWS" and vacio.csv is None

    async def falla(model, pages, scope):
        return None, None, "MODEL_TIMEOUT"

    monkeypatch.setattr(ce, "_consultar_modelo", falla)
    timeout = await ce.run_calendar_extraction(PDF, "application/pdf", SCOPE)
    assert timeout.status == "UNREADABLE" and timeout.reason == "MODEL_TIMEOUT"


def test_endpoint_responde_503_si_los_datos_de_clientes_no_estan_habilitados(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.delenv("EXTRACTION_CUSTOMER_DATA_ENABLED", raising=False)
    body = _body()
    respuesta = client.post(PATH, content=body, headers=_headers(body))
    assert respuesta.status_code == 503
    assert respuesta.json()["detail"] == "CUSTOMER_DATA_EXTRACTION_DISABLED"


def test_endpoint_rechaza_un_pdf_que_no_coincide_con_su_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NODE_ENV", "development")
    body = _body(sha="0" * 64)
    respuesta = client.post(PATH, content=body, headers=_headers(body))
    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == "SOURCE_INTEGRITY_MISMATCH"


def test_endpoint_sin_firma_no_lee_el_pdf() -> None:
    body = _body()
    respuesta = client.post(PATH, content=body, headers={"Content-Type": "application/json"})
    assert respuesta.status_code == 401
