# Threat model — Contable

> Modelo de amenazas por frontera. Se documenta por frontera: navegador, Nginx, API Node, workers, FastAPI, proveedor IA, PostgreSQL, Valkey, MinIO, SMTP, backups y operadores.
> Los escenarios de mayor impacto se priorizan; cada uno tiene mitigación y señal de detección.

## Escenarios de mayor impacto

| ID | Amenaza | Impacto | Mitigación | Señal de detección |
|---|---|---|---|---|
| TH-01 | Lectura o mutación de un cliente desde otro estudio | Crítico | Capabilities + RLS `FORCE`, FKs compuestas, namespaces, tests adversariales | 403/404 o acceso anómalo → incidente crítico |
| TH-02 | Usuario de portal accede a borradores, notas internas o datos de otro cliente | Crítico | Modelo de publicación separado, queries específicas, E2E de roles | Recurso interno visible → retirar portal/feature |
| TH-03 | Cuenta comprometida de personal con cartera amplia | Crítico | MFA obligatorio, sesiones por dispositivo, refresh rotado, rate limiting, reautenticación | Login anómalo, replay de refresh |
| TH-04 | Archivo malicioso, bomba de descompresión, PDF activo o contenido que explota OCR | Crítico | Cuarentena, magic byte, ClamAV, sandbox, límites, red privada | Malware/parser crash → aislar objeto/worker |
| TH-05 | URL firmada filtrada u object key predecible | Alto | URLs firmadas breves, object key UUID, autorización antes de firmar | Descarga no autorizada |
| TH-06 | Prompt injection alojado en comprobante o adjunto | Crítico | Datos no confiables delimitados, tools mínimas, reautorización Node, red-team | Tool/cita/contexto anómalo |
| TH-07 | Modelo/proveedor conserva o enruta datos fuera de política | Crítico | ZDR, `data_collection: deny`, allowlist, revisión contractual, minimización | Política/endpoint cambia → kill switch |
| TH-08 | Posting duplicado o modificación de registros contabilizados | Crítico | Idempotency reservation, uniques, outbox, transacciones serializables, inmutabilidad | Doble asiento/email/import |
| TH-09 | Manipulación de reglas, índices, tipos de cambio o plantillas históricas | Alto | Versionado, fuente/checksum, aprobación, reproducción | Serie revisada o inconsistente |
| TH-10 | Exposición mediante logs, trazas, analytics, backups o entornos de prueba | Crítico | Redacción, datasets sintéticos, accesos, DLP/proceso | Dato detectado → contener |
| TH-11 | Acceso administrativo o de soporte sin consentimiento y trazabilidad | Alto | Grants temporales, scope mínimo, banner visible, auditoría | Grant inexistente/vencido/revocado |
| TH-12 | Compromiso del VPS, imagen de contenedor, dependencia o pipeline CI/CD | Crítico | Host reforzado, imágenes por digest, SBOM, branch protection, secret scan | Vulnerabilidad crítica/alta |

## Por frontera

### Navegador

- XSS: React + sanitización explícita; sin `dangerouslySetInnerHTML` con contenido no confiable.
- CSP estricta, HSTS, `frame-ancestors`, `Referrer-Policy`, permisos mínimos.
- CORS allowlist; servicios internos sin CORS público.
- CSRF token para mutaciones autenticadas por cookie.

### Nginx

- Único servicio expuesto a Internet.
- TLS, rate limits, headers seguros.
- No expone endpoints internos.

### API Node

- Validación cerrada con Zod; rechazar campos desconocidos en contratos sensibles.
- Queries parametrizadas; SQL manual aislado, revisado y testeado.
- Autorización por capacidades antes de cada operación.
- `Idempotency-Key` con reserva transaccional previa.
- `ETag`/`If-Match` para concurrencia optimista.
- Errores sanitizados; sin stack, query, ruta interna ni IDs sensibles.

### Workers

- Jobs idempotentes por clave natural o `deduplicationKey`.
- Dead-letter lógico y panel de reintentos.
- Egress restringido para workers que procesan documentos.
- Parsers/OCR en contenedores sin privilegios, filesystem efímero, sin credenciales de base, con límites CPU/memoria.

### FastAPI

- Sin acceso directo a PostgreSQL de negocio.
- Autenticación HMAC con timestamp/nonce/replay protection.
- Pydantic `extra="forbid"`.
- No decide permisos; Node reautoriza cada tool call.

### Proveedor IA

- OpenRouter ZDR, `data_collection: deny`, allowlist.
- Logging de input/output deshabilitado.
- Prompts/respuestas completas no en logs técnicos.
- Kill switch global y feature flags por firma.

### PostgreSQL

- RLS `FORCE`, runtime non-owner sin `BYPASSRLS`.
- FKs compuestas `firm_id` + `client_id`.
- `SET LOCAL` de contexto por transacción; pool sin contexto persistente.

### Valkey

- No es fuente de verdad; jobs persistentes se reconstruyen desde PostgreSQL/outbox.
- Nonces conservados brevemente para replay protection.

### MinIO

- Buckets separados por clasificación.
- Versionado y checksum.
- URLs firmadas breves.

### SMTP

- Outbox durable; reintentos sin doble email.
- `providerMessageId` para dedupe.

### Backups

- Cifrados con clave separada del host primario.
- Restore drill recurrente.
- Destino offsite.

### Operadores

- Soporte mediante grants temporales, scope mínimo, banner visible y auditoría.
- Sin acceso implícito.
- Reautenticación para acciones sensibles.

## Retención y legal hold

- Línea base técnica: conservar libros, registraciones, comprobantes y evidencias vinculadas al menos diez años desde el hito legal aplicable, y más si una norma, contrato, litigio o legal hold lo exige.
- Backups y derivados con reglas explícitas.
- "Borrar" una fila no promete purga inmediata de copias legales.
- La política concreta de retención debe ser aprobada jurídicamente.

## Anonimización

- CUIT, email, nombre, documento y cuenta bancaria redactados en logs y métricas.
- Datos de desarrollo sintéticos; producción anonimizada sólo mediante proceso aprobado.
- Correcciones anonimizadas pueden alimentar evaluaciones internas sólo con consentimiento y reglas de privacidad.

## Red-team continuo (IA)

- Prompt injection indirecta.
- Data exfiltration.
- Tool confusion.
- Citation spoofing.
- Cross-tenant retrieval.
- Denial of wallet.