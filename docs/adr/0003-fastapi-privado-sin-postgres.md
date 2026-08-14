# ADR-003 — FastAPI privado y sin acceso directo a PostgreSQL

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 2.5 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

El plan define un servicio Python/FastAPI para IA y OCR, privado y de cómputo. No debe ser autoridad de autorización ni de posting, y no debe acceder directamente a PostgreSQL de negocio.

## Decisión

- FastAPI + Pydantic con `extra="forbid"`.
- Sin acceso directo a PostgreSQL de negocio.
- Autenticación mTLS o HMAC obligatoria; se usará HMAC con rotación de secreto en el despliegue inicial.
- Endpoints internos para extracción, clasificación, embeddings, respuesta del asistente y planificación BI.
- PyMuPDF para texto y render de PDF; OCRmyPDF/Tesseract para PDFs escaneados; OpenCV/Pillow/pillow-heif para imágenes; lectura QR determinista antes de visión.
- OpenRouter para visión y lenguaje cuando el procesamiento local no alcance.
- Respuestas siempre estructuradas, versionadas y validadas con Pydantic.

## Consecuencias

- El navegador nunca llama a FastAPI.
- FastAPI no recibe `firmId` como autorización confiable; Node prepara el input autorizado.
- El LLM no recibe credenciales, URLs permanentes ni acceso a tablas.
- El LLM no genera SQL ejecutable.
- Los contratos Node–FastAPI se definen en [contratos-node-fastapi.md](../contratos-node-fastapi.md).

## Alternativas consideradas

- **FastAPI con acceso directo a PostgreSQL:** descartado por riesgo de tenancy y por violar la frontera de autoridad.