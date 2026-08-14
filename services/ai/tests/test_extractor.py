from app.extractor import extract_from_text


def test_extract_cuit_and_total() -> None:
    text = (
        "FACTURA A\n"
        "CUIT: 20123456700\n"
        "Fecha: 2026-08-01\n"
        "Neto: 100000.00\n"
        "IVA: 21000.00\n"
        "Total: 121000.00\n"
    )
    result = extract_from_text(text, "voucher-ar-v1")
    assert result.emitterCuit == "20123456700"
    assert result.issueDate == "2026-08-01"
    assert result.totalAmount == "121000.00"
    assert result.netAmount == "100000.00"
    assert result.vatAmount == "21000.00"
    assert result.documentType == "INVOICE"
    assert result.ocrEngine == "embedded-text"


def test_extract_date_dd_mm_yyyy() -> None:
    text = "Fecha de emision: 01/08/2026"
    result = extract_from_text(text, "voucher-ar-v1")
    assert result.issueDate == "2026-08-01"


def test_extract_missing_fields_adds_issues() -> None:
    result = extract_from_text("sin datos utiles", "voucher-ar-v1")
    assert result.emitterCuit is None
    assert result.totalAmount is None
    assert any("CUIT" in i for i in result.issues)
    assert any("Total" in i for i in result.issues)


def test_invalid_cuit_rejected() -> None:
    text = "CUIT: 20123456789\nTotal: 100.00"
    result = extract_from_text(text, "voucher-ar-v1")
    assert result.emitterCuit is None
