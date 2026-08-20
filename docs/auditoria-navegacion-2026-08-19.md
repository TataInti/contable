# Plan de trabajo — Auditoría de navegación (2026-08-19)

> Alcance: revisión manual de la app completa (estudio + portal) con servidores locales.
> Estado: **solo diagnóstico, sin cambios aplicados**.
> Servidores: API `:3000` (tsx watch), web `:5173` (vite). MinIO caído (warn, no bloquea).

---

## Resumen

La app arranca y las rutas principales cargan. Se detectaron **6 hallazgos**, de los cuales
**2 son bugs funcionales de backend** (worklist 401, administración 500), **2 son bugs de UI**
(nav con placeholder, período sin formatear), **1 es dato demo inválido** (CUIT) y **1 es
comportamiento de router a verificar** (navegación SPA).

---

## Hallazgos

### P1 — `GET /api/v1/portfolio/tax-worklist` devuelve 401 (dashboard roto)

- **Síntoma**: el dashboard carga, pero la sección "Liquidaciones en curso" siempre muestra
  "Sin liquidaciones en curso" aunque existan liquidaciones (hay 3 FINALIZED en la corrida histórica).
- **Causa raíz**: la ruta no tiene `firmId` en el path. En `apps/api/src/auth/guard.ts`, el bloque
  que resuelve capabilities para rutas sin firmId sólo cubre `path.startsWith("/api/v1/tax/")`.
  `/api/v1/portfolio/tax-worklist` no entra ahí → `req.capabilities` queda vacío → 401.
- **Archivos**: `apps/api/src/auth/guard.ts`, `apps/api/src/tax/settlement-routes.ts`.
- **Fix propuesto**: en el guard, para rutas sin firmId que requieran contexto (worklist), resolver
  la primera membresía activa del usuario (como ya se hace para `/api/v1/tax/`) y setear
  `req.firmId` + capabilities. Alternativa: mover la ruta bajo `/firms/:firmId/portfolio/...`.

### P2 — Administración: 500 en `portal-invitations` y `portal-memberships`

- **Síntoma**: al abrir `/administracion`, dos requests devuelven 500 (consola). La sección
  "Acceso del cliente" no muestra invitaciones/miembros.
- **Causa raíz**: el rol runtime (`contable_runtime`) no tiene GRANT sobre las tablas
  `portal_invitations` y `portal_memberships` (sólo el owner `contable` tiene permisos).
  `rls.sql` no las cubre.
- **Archivos**: `apps/api/prisma/rls.sql` (o la migración de grants).
- **Fix propuesto**: agregar `GRANT SELECT, INSERT, UPDATE, DELETE ON portal_invitations,
  portal_memberships TO contable_runtime;` (y RLS policies si aplican).

### P3 — Nav "Rentabilidad" y "Configuración fiscal" con placeholder sin resolver

- **Síntoma**: en `StudyShell`, los links apuntan a `/clientes/:clientId/rentabilidad` y
  `/clientes/:clientId/configuracion-fiscal` (literal `:clientId`, sin reemplazar).
- **Causa raíz**: el href se construye sin interpolar el `clientId` del contexto.
- **Archivos**: `apps/web/src/shells/StudyShell.tsx`.
- **Fix propuesto**: usar el `clientId` del contexto (o navegar a `/clientes` si no hay cliente).

### P4 — Período sin formatear en Liquidaciones

- **Síntoma**: la columna "Período" muestra `2025-10-01T00:00:00.000Z` (ISO crudo).
- **Archivos**: `apps/web/src/study/StudyLiquidaciones.tsx`.
- **Fix propuesto**: formatear con `Intl.DateTimeFormat("es-AR", { month: "short", year: "numeric" })`.

### P5 — CUIT del cliente demo inválido

- **Síntoma**: el cliente demo "Alimentos del Sur S.A." tiene CUIT `20-11111119-9` (`20111111119`),
  que NO pasa el validador de dígito verificador de `packages/contracts/src/primitives.ts`.
- **Causa raíz**: el seed creó el cliente con un CUIT inválido.
- **Archivos**: `apps/api/src/seed-demo.ts` (y `seed-fase2.sql` si aplica).
- **Fix propuesto**: usar un CUIT válido (ej. `20123456700`).

### P6 — Navegación SPA (a verificar)

- **Síntoma**: al hacer click en un link de la nav, la URL cambia pero el contenido no siempre
  re-renderiza (observado con el browser tool; puede ser limitación del tool).
- **Acción**: verificar con uso real / E2E antes de tocar el router.

---

## Verificado OK

- Login `demo@contable.local` / `demo1234`.
- Dashboard (carga; worklist 401 = P1).
- Clientes: listado, crear cliente con CUIT válido → 201, estado "En configuración".
- Bandeja: 1 documento "Extraído".
- Trabajo: 0 pendientes.
- Liquidaciones: 3 corridas históricas (Oct-Dic 2025, $33.600 c/u, botón Rectificar).
- Rentabilidad: devengado/caja sin calcular.
- Configuración fiscal: onboarding, perfil vacío para cliente nuevo.
- Portal: redirige a `/` (demo sin contexto portal).

---

## Orden de ejecución sugerido

1. **P1** (worklist 401) — bug funcional que rompe el dashboard.
2. **P2** (administración 500) — bug funcional de permisos.
3. **P3** (nav placeholder) — bug de UI de navegación.
4. **P4** (período sin formatear) — pulido de UI.
5. **P5** (CUIT demo) — dato demo inválido.
6. **P6** (router) — verificar antes de tocar.

Cada fix debe acompañarse de test (unitario/integración) y verificación manual.
