# Contratos Node–FastAPI — Contable

> Contratos internos entre la API Node (autoridad) y el servicio FastAPI (cómputo IA/OCR).
> Autenticación HMAC-SHA256 sobre método, path, timestamp, nonce y hash del body.
> FastAPI no recibe `firmId` como autorización confiable; Node prepara el input autorizado.

## Autenticación

Headers:

```text
X-Service-Id
X-Service-Timestamp
X-Service-Nonce
X-Service-Signature
```

- Firma: HMAC-SHA256 sobre `method + path + timestamp + nonce + sha256(body)`.
- Ventana máxima: 5 minutos.
- Nonces conservados brevemente en Valkey para impedir replay.
- Secretos rotables.
- URLs firmadas de lectura con expiración mínima suficiente para el job.
- Ningún endpoint interno expuesto por Nginx.

## Extracción

### Request

```http
POST /internal/v1/extractions
```

```json
{
  "contractVersion": "1.0",
  "runId": "019...",
  "firmId": "019...",
  "clientId": "019...",
  "documentId": "019...",
  "source": {
    "downloadUrl": "https://signed-short-lived/...",
    "mimeType": "application/pdf",
    "sizeBytes": 12345,
    "sha256": "..."
  },
  "options": {
    "country": "AR",
    "language": "es",
    "maxPages": 3,
    "schemaVersion": "voucher-ar-v2"
  },
  "callback": {
    "url": "http://api:3000/internal/v1/extractions/complete",
    "expiresAt": "..."
  }
}
```

### Response

La respuesta HTTP contiene el voucher-ar-v2 validado, campos fiscales compatibles con la bandeja, motivos de revisión y telemetría (`provider`, modelo exacto, `promptVersion`, tokens de entrada/salida, latencia y costo estimado). El esquema no incluye ítems ni procesa QR. El modelo recibe imágenes de cada página; el texto embebido del PDF no participa en la extracción. El motor de reglas heredado permanece desconectado del endpoint normal.

## Asistente

### Request

```http
POST /internal/v1/assistant/runs
```

Node envía:

- Contexto autorizado.
- Historial mínimo.
- Evidencias delimitadas.
- Tools allowlisted.
- Versiones.
- Política del proveedor.

FastAPI hace streaming a Node. Cada tool call vuelve a Node, donde se revalidan sesión, scope, permisos y argumentos.

## BI

### Request

```http
POST /internal/v1/bi/plan
```

FastAPI devuelve sólo `BiQueryPlanV1`; Node valida y ejecuta. No se envían credenciales ni nombres físicos de tablas.

```ts
interface BiQueryPlanV1 {
  version: 1;
  clientId: string;
  fiscalPeriodId: string;
  metric: string;
  dimensions: string[];
  filters: Array<{
    field: string;
    operator: "eq" | "neq" | "in" | "gte" | "lte";
    value: string | string[];
  }>;
  comparison: "NONE" | "PREVIOUS_PERIOD" | "PREVIOUS_YEAR";
  limit: number;
}
```

## Principios

1. El navegador no llama a FastAPI.
2. FastAPI no recibe `firmId` como autorización confiable.
3. El LLM no recibe credenciales, URLs permanentes ni acceso a tablas.
4. El LLM no genera SQL ejecutable.
5. Los archivos en cuarentena no son descargables ni utilizables por IA.
6. Los exports no consultan tablas fuera del contexto de firma/cliente.