# Contratos backend — catálogo de actividades económicas (primer corte backend)

Estado: backend implementado en `feat/catalogo-actividades` (worktree aislado desde origin/main). La UI que consume estos contratos es trabajo de las otras dos instancias (PR #10 Catálogos/Reglas y ficha de cliente); este documento fija qué esperar del servidor. Sin merge ni deploy hasta OK explícito.

## Fuente única de verdad

- Tabla: `economic_activities` (Prisma `EconomicActivity`): `id, code, name, jurisdictionId, source, validFrom, validTo, isActive, createdAt, updatedAt`. Unicidad `(code, jurisdictionId)`. **No hay borrado**: desactivar es el mecanismo de baja; el historial (vínculos de cliente y reglas) se conserva.
- Contratos compartidos backend/frontend: `packages/contracts/src/economic-activities.ts` (`createEconomicActivitySchema`, `updateEconomicActivitySchema`, `ACTIVITY_CODE_PATTERN`, `normalizeActivityCode`, tipo `CatalogEconomicActivity`).

## Endpoints (base `/api/v1`)

| Método | Ruta | Capability | Notas |
|---|---|---|---|
| GET | `/tax/activities?jurisdictionId={uuid}&includeInactive=true` | `tax.rules.read` | Por defecto devuelve **sólo activas** (para selectores). La administración del catálogo debe pedir `includeInactive=true`. Orden por `code` asc, tope 1000. |
| POST | `/tax/activities` | `tax.rules.propose` | Alta. Body: `code, name, jurisdictionId, source?, validFrom (YYYY-MM-DD), validTo?`. `code` se normaliza (trim + mayúsculas) y valida formato. |
| PATCH | `/tax/activities/:activityId` | `tax.rules.propose` | Edición de `name`, `source` (string o `null`), `validFrom`, `validTo` (string o `null` para limpiar). **`code` y `jurisdictionId` no son editables** (400 si se envían). |
| POST | `/tax/activities/:activityId/activate` | `tax.rules.propose` | Reactiva. 409 `ACTIVITY_STATE_UNCHANGED` si ya está en ese estado. |
| POST | `/tax/activities/:activityId/deactivate` | `tax.rules.propose` | Baja lógica. No borra ni invalida vínculos/reglas existentes. |

Las respuestas de PATCH/activate/deactivate incluyen `activeClientLinks` (cantidad de vínculos de cliente vigentes, `client_activities.validTo IS NULL`) para que la UI advierta antes de desactivar algo en uso. Las filas del catálogo siguen teniendo la forma `CatalogEconomicActivity` más ese campo extra en mutaciones.

## Errores (formato `{ error: { code, message } }`)

- 400 `VALIDATION_ERROR` — schema Zod (formato de código, campos desconocidos).
- 404 `ACTIVITY_NOT_FOUND` / `JURISDICTION_NOT_FOUND`.
- 409 `CATALOG_CODE_CONFLICT` (código duplicado en la jurisdicción), `ACTIVITY_VALIDITY_INVALID` (validTo < validFrom), `ACTIVITY_STATE_UNCHANGED`, `ACTIVITY_FIELD_IMMUTABLE` (defensa en servicio), `ACTIVITY_CODE_INVALID`, `ACTIVITY_CODE_UNKNOWN`, `ACTIVITY_CODE_INACTIVE`, `ACTIVITY_CODE_JURISDICTION_MISMATCH`.

## Vínculo reglas ↔ catálogo (validación en servidor)

- `POST /tax/rule-versions/:id/rate-rules` y `PUT .../rate-rules` validan `activityCode` contra el catálogo: debe existir (409 `ACTIVITY_CODE_UNKNOWN`), cumplir formato (`ACTIVITY_CODE_INVALID`) y, si la regla declara `jurisdictionId`, estar publicado para esa jurisdicción (`ACTIVITY_CODE_JURISDICTION_MISMATCH`).
- Altas nuevas exigen actividad **activa** (`ACTIVITY_CODE_INACTIVE`). El reemplazo por lote (`PUT`) exige sólo existencia: los borradores clonados de versiones históricas pueden conservar códigos hoy desactivados. La validación corre ANTES del `deleteMany`, así un lote inválido no destruye el borrador.
- El servidor guarda `activityCode` normalizado (trim + mayúsculas).
- Versiones APPROVED/ACTIVE siguen inmutables (`RULE_VERSION_IMMUTABLE`): las reglas vigentes no se reescriben, compatibilidad histórica intacta.

## Coherencia ficha ↔ catálogo

- `POST /firms/:firmId/clients/:clientId/activities` ahora exige actividad existente (`ACTIVITY_NOT_FOUND`) y activa (`ACTIVITY_INACTIVE`). Los vínculos ya guardados no se invalidan si la actividad se desactiva después.
- La ficha NO debe enviar texto descriptivo: el selector consume `GET /tax/activities` (activas) y envía `activityId`.

## Auditoría

Eventos en `audit_events` (append-only, dentro de la misma transacción): `tax.activity.created`, `tax.activity.updated` (before/after de name/source/vigencia), `tax.activity.activated`, `tax.activity.deactivated`. `entityType: "EconomicActivity"`.

## UI siguiente (qué falta, fuera de este corte)

1. **Catálogos (PR #10, otra instancia)**: pantalla de administración del catálogo con `includeInactive=true`, alta/edición/desactivación-activación usando los esquemas de `@contable/contracts`; usar `activeClientLinks` para el aviso de desactivación. NO modificar `GET` para historial: `includeInactive` es el parámetro acordado.
2. **Configuración fiscal (onboarding)**: el selector ya recibe sólo activas; mantener `activityId` como valor del vínculo.
3. **Reglas fiscales**: si la UI envía `activityCode`, esperar 409 con los códigos de arriba; el error trae el código exacto para marcar la fila.
4. **Ficha**: reemplazar texto descriptivo por selector + `activityId` (instancia dedicada ya trabajando).

## Límites del corte

- Sin migración de esquema: `EconomicActivity` ya tenía `source`, `validTo`, `isActive`. No se agregó FK de `tax_rate_rules.activityCode` → catálogo (el vínculo es textual y hay valores históricos): la validación es de servidor en escritura.
- Sin borrado físico ni endpoint DELETE, por diseño (historial).
- Permisos: se mantienen `tax.rules.read` / `tax.rules.propose` (coherente con los demás maestros fiscales). Elevar a una capability dedicada tipo `tax.catalog.manage` es decisión de producto pendiente.
- Pendiente para un corte posterior: UI de administración, endpoints de importación masiva, y evento de auditoría para vínculos cliente-actividad.
