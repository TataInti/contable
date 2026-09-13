---
title: "PLAN DE PRUEBAS"
subtitle: "Piloto fiscal de Contable"
date: "3 de septiembre de 2026"
---

**Documento de implementación y aceptación**

**Proyecto:** Contable  
**Prioridad:** Piloto fiscal primero  
**Cobertura objetivo:** IVA, IIBB local Tucumán, TEM, expediente mensual, portal y rentabilidad  
**Estado:** Gate técnico, E2E y corrida UI de enero 2026 completados; pendiente aceptación funcional/histórica

\newpage

# 1. Propósito y criterio de salida

Este documento define los tests que deben existir y aprobarse para asegurar la implementación del plan surgido de la revisión funcional con el contador. Su función es convertir las decisiones de producto en contratos verificables de motor, servicios, permisos, interfaz y recorrido de punta a punta.

La estrategia será TDD: primero se incorporan tests que fallen exclusivamente por la ausencia del comportamiento acordado; luego se implementan los cambios hasta que toda la suite quede verde. No se duplicarán casos que ya estén cubiertos de forma adecuada.

> **Criterio de salida.** La implementación no se considera lista porque una pantalla funcione manualmente. Deben aprobarse el motor determinista, las integraciones con base real y RLS, la matriz de permisos, el build y el recorrido E2E completo.

## 1.1 Estado de partida

La base actual ya prueba varias invariantes importantes:

- separación de saldos técnico y libre en IVA;
- notas de crédito que reducen la base;
- maker-checker entre preparador y revisor;
- inmutabilidad de liquidaciones finalizadas;
- rectificativas versionadas;
- disponibilidad derivada del libro de créditos;
- aislamiento de saldos por jurisdicción;
- publicación versionada de rentabilidad;
- portal limitado a resultados publicados.

El motor fiscal registra actualmente **129 tests aprobados** y la aplicación web **19 tests aprobados**. El gate estático (`typecheck`, `lint` y `build`) está verde; la suite API queda en **38 archivos / 333 tests aprobados** sobre una base limpia con RLS. La matriz E2E externa queda en **16/16 aprobados**, incluyendo Chromium y mobile, sobre una base aislada con migraciones, `seed-maestros-fiscales`, `seed:piloto` y worker documental activo.

## 1.2 Mapa de cobertura requerida

| Área | Ya existe | Cobertura que se agrega | Nivel |
|---|---|---|---|
| IVA | Cálculo, alícuotas, NC, saldos separados | Saldos verificados, secuencia integrada y redondeo final | Motor + API |
| IIBB/TEM | Cálculo, mínimos, créditos | Saldo verificado, perfil fiscal y jurisdicción | Motor + API |
| CM03 | Motor y ciclo propio | Bloqueo real por feature flag | API + UI |
| Expediente | Workflow, controles y cierre | Paso 0 verificable y operaciones posteriores al cierre | API |
| Documentos | Creación, adjunto y preview | Envío, revisión de ítems y visibilidad de estados | API + E2E |
| Portal | Publicaciones y grants básicos | Comportamiento real por rol y aislamiento | API + E2E |
| Rentabilidad | Gastos, caja/devengado y publicación | Ingresos gerenciales y no contaminación fiscal | API + E2E |
| Navegación | Registry y guards | Expediente canónico, liquidaciones históricas y asistente oculto | Web + E2E |

# 2. Estrategia general de pruebas

## 2.1 Pirámide de cobertura

1. **Motor puro.** Golden tests deterministas para importes, signos, redondeos y reglas por jurisdicción.
2. **Servicios con base real.** Estados, auditoría, RLS, transiciones, maker-checker e inmutabilidad.
3. **Contratos HTTP.** Status codes, schemas, capabilities y filtrado de información.
4. **Componentes web.** Visibilidad, habilitación de acciones y navegación canónica.
5. **E2E vertical.** Un recorrido completo desde el pedido documental hasta la consulta del resultado publicado.

## 2.2 Reglas de calidad de los tests

- Cada suite de integración utilizará IDs y datos propios para poder ejecutarse en paralelo.
- Las pruebas de seguridad se ejecutarán con el rol PostgreSQL runtime y RLS activo.
- Ningún test dependerá de la fecha actual, del orden de ejecución o de datos creados por otra suite.
- Los importes se compararán como `Decimal` o strings canónicos, nunca como `float`.
- Los errores esperados validarán código estable y estado HTTP, no sólo texto libre.
- Los tests de interfaz consultarán roles, nombres accesibles y estados de botones; no se apoyarán únicamente en snapshots visuales.
- Un test nuevo debe nacer rojo por el contrato faltante, no por un fixture incompleto o infraestructura inestable.

# 3. Saldos anteriores y expediente mensual

## 3.1 Verificación obligatoria del saldo

Extender `apps/api/src/tax/workpaper.test.ts` con los siguientes contratos:

1. **Saldo manual pendiente.** Crear un saldo manual produce `PENDING_VERIFICATION` y no lo incorpora al cálculo.
2. **Verificación respaldada.** Un revisor puede verificarlo con documento de evidencia o referencia oficial, registrando usuario y fecha.
3. **Maker-checker.** El usuario que crea el saldo no puede verificarlo.
4. **Última rectificativa.** Si existen una presentación original y una rectificativa, sólo la última versión verificada alimenta el período.
5. **Presentación superada.** Intentar usar un saldo de una versión anterior crea un control bloqueante.
6. **Migración segura.** Los saldos existentes migran como pendientes y requieren revisión antes de utilizarse.
7. **Alcance fiscal.** Un saldo sólo puede aplicarse al mismo impuesto, régimen y jurisdicción.
8. **Naturaleza separada.** `IVA_TECNICO`, `IVA_LIBRE` y `SALDO_A_FAVOR` nunca se mezclan silenciosamente.

El test actual que permite cargar un saldo sin documento y usarlo inmediatamente debe dividirse: la carga manual seguirá permitida, pero el uso quedará bloqueado hasta su verificación.

## 3.2 Libro de créditos inmutable

Agregar los siguientes casos:

- el disponible es `importe original + ajustes positivos - usos - compensaciones`;
- un uso externo queda registrado como movimiento inmutable;
- una compensación conserva referencia y autor;
- una aplicación repetida es idempotente o se rechaza sin duplicar el consumo;
- una aplicación superior al disponible falla;
- modificar metadatos no cambia el importe histórico;
- una corrección de monto crea un movimiento compensatorio y deja historial;
- dos ejecuciones concurrentes no pueden gastar el mismo saldo dos veces.

## 3.3 Secuencia IVA integrada

Combinar golden tests del motor con integración del expediente:

- el débito se netea primero con crédito fiscal, Dto. 814 y saldo técnico anterior;
- retenciones, percepciones y saldo libre sólo intervienen después de determinar el saldo técnico;
- retenciones y percepciones nunca alteran el saldo técnico que se arrastra;
- un excedente técnico y un excedente libre se conservan en lotes separados;
- el resultado final mantiene dos decimales después de aplicar ambos tipos de saldo;
- una rectificativa no duplica ni reconsume saldos ya aplicados.

## 3.4 Acciones posteriores al cierre

Extender `apps/api/src/tax/settlement.test.ts` y el expediente con casos negativos:

- registrar una presentación antes de `FINALIZED` falla;
- calcular mora antes de `FINALIZED` falla;
- registrar un pago antes de `FINALIZED` falla;
- aplicar crédito a una deuda no finalizada falla;
- una liquidación finalizada conserva hashes, reglas, líneas y saldos aunque cambien las entradas;
- toda corrección posterior exige una rectificativa nueva.

# 4. Fuentes, clasificación y controles

## 4.1 Notas de crédito y período

Ampliar `packages/tax-engine/src/importers.test.ts` y `apps/api/src/tax/ingestion.test.ts`:

- NC de venta con signo correcto reduce neto e IVA en su alícuota;
- NC de compra con signo correcto reduce el crédito fiscal;
- NC con signo positivo queda inválida o se normaliza de manera explícita y auditable según el adaptador;
- el mismo documento no puede sumar simultáneamente como factura y nota de crédito;
- una fila fuera del período queda observada;
- un lote con filas fuera del período no puede llegar a `REVIEWED` ni alimentar el expediente;
- ventas y compras usan la misma política de signos y fechas.

## 4.2 Bases, alícuotas y exenciones

Agregar integración en el expediente:

- diferencia entre neto general y suma de bases por alícuota abre `BOOK_RATE_RECONCILIATION` bloqueante;
- diferencia material entre IVA informado y base por tasa bloquea el cálculo;
- actividad sin clasificación mantiene el expediente en `WAITING_INPUTS`;
- actividad sin regla vigente bloquea el motor;
- alícuota o exención atípica contra el perfil fiscal genera advertencia profesional;
- la advertencia nunca reescribe el comprobante original;
- sólo un hallazgo con severidad bloqueante impide finalizar;
- resolver un bloqueo requiere explicación y evidencia del mismo cliente.

## 4.3 IIBB local y TEM

Extender las suites de liquidación por impuesto:

- sólo se aplica saldo anterior verificado;
- un saldo pendiente se muestra, pero no reduce el impuesto;
- el saldo debe corresponder a la jurisdicción de la obligación;
- una retención o percepción sin jurisdicción válida no se imputa automáticamente;
- alícuota o mínimo de la fuente distintos de la regla congelada bloquean;
- una actividad inesperada contra el perfil genera advertencia, no autocorrección;
- los créditos superiores al impuesto generan un nuevo saldo a favor trazable.

## 4.4 Convenio Multilateral durante el piloto

Mantener los golden tests de CM03 y agregar un contrato sobre la ruta real:

- `calculate` devuelve `409` cuando `TAX_CM_ART2` está apagado;
- habilitar el flag para el cliente permite calcular;
- el flag del cliente prevalece sobre el de la firma;
- el expediente no ofrece CM03 cuando el flag está apagado;
- un saldo de una jurisdicción nunca compensa deuda de otra.

Los regímenes especiales de agro, construcción, transporte y otros quedan fuera del E2E del piloto.

# 5. Workflow documental y portal

## 5.1 Lifecycle del pedido

Modificar `apps/api/src/tax/work-f2.test.ts` para fijar estas transiciones:

| Acción | Estado anterior | Estado resultante |
|---|---|---|
| Crear pedido | - | `DRAFT` |
| Enviar pedido | `DRAFT` | `SENT` |
| Adjuntar primer requerido | `SENT` | `IN_PROGRESS` |
| Adjuntar todos los requeridos | `IN_PROGRESS` | `READY_FOR_REVIEW` |
| Aceptar o eximir todos | `READY_FOR_REVIEW` | `COMPLETED` |
| Rechazar un ítem | `READY_FOR_REVIEW` | `IN_PROGRESS` |
| Cancelar | Estado abierto | `CANCELLED` |

Casos adicionales:

- adjuntar no completa el pedido por sí solo;
- no se puede adjuntar a un pedido `DRAFT`, `COMPLETED` o `CANCELLED`;
- los ítems opcionales no bloquean la completitud;
- aceptar, rechazar o eximir exige rol autorizado;
- un ítem rechazado conserva la evidencia previa y el motivo;
- repetir una transición válida no duplica eventos;
- una transición fuera de orden devuelve un error estable.

## 5.2 Visibilidad del portal

Crear `apps/api/src/portal/portal-routes.test.ts` con base real y RLS:

- el portal excluye pedidos `DRAFT` y `CANCELLED`;
- el resumen tampoco los cuenta como pendientes;
- `SENT`, `IN_PROGRESS`, `READY_FOR_REVIEW` y `COMPLETED` son visibles;
- el portal sólo recibe mensajes `SHARED`;
- la carga queda asociada al ítem correcto;
- cargar no implica aceptar;
- un usuario de otro cliente obtiene `404` sin revelar existencia;
- un documento en cuarentena o rechazado no aparece como evidencia disponible.

# 6. Matriz de permisos

Convertir `packages/permissions/src/resolver.test.ts` en una matriz parametrizada y complementarla con pruebas HTTP.

| Rol | Fiscal | Rentabilidad | Carga | Mensajes | Resultados |
|---|---|---|---|---|---|
| Estudio `OWNER` / `ADMIN` | Completo | Completo | - | - | - |
| `PREPARER` | Preparar y calcular | Ninguno | - | - | - |
| `REVIEWER` | Revisar y finalizar | Ninguno | - | - | - |
| `AUDITOR_READONLY` | Sólo lectura | Ninguno | - | - | - |
| Portal `OWNER` | - | Publicada | Sí | Sí | Sí |
| Portal `COLLABORATOR` | - | No | Sí | Sí | No |
| Portal `READONLY` | - | Publicada | No | No | Sí |

Los tests deben comprobar:

- capabilities exactas por rol, incluyendo las capacidades ausentes;
- usuarios internos no asignados sin acceso al cliente;
- colaborador del portal con rechazo al consultar liquidaciones o rentabilidad;
- usuario `READONLY` con rechazo al cargar o mensajear;
- owner del portal limitado siempre a información publicada;
- toda ruta nueva declarada en el guard;
- deny-by-default para endpoints no mapeados;
- `404` para recurso invisible y `403` para acción no permitida sobre recurso visible.

# 7. Ingresos gerenciales y rentabilidad

## 7.1 Ciclo de ingresos gerenciales

Crear `apps/api/src/tax/management-income.test.ts`:

- alta en `DRAFT` con fecha devengada, fecha de cobro opcional, categoría, moneda e importe;
- envío a revisión;
- aprobación por usuario distinto;
- rechazo con comentario obligatorio;
- evidencia de otro cliente rechazada;
- sólo `APPROVED` participa del cálculo;
- una versión aprobada no se modifica silenciosamente;
- el ingreso gerencial nunca crea comprobante, componente o ajuste fiscal.

## 7.2 Separación fiscal y gerencial

Extender `apps/api/src/tax/profitability.test.ts`:

- un ingreso gerencial aprobado aumenta el resultado devengado;
- en caja sólo entra cuando la fecha de cobro pertenece al período;
- borradores y rechazados no afectan snapshots;
- los comprobantes fiscales aprobados se reutilizan una sola vez;
- no es necesario volver a cargar libros IVA en rentabilidad;
- un ingreso o egreso gerencial no cambia hashes ni totales de IVA, IIBB o TEM;
- devengado y caja mantienen hashes independientes;
- publicar conserva una versión inmutable;
- el portal nunca recibe snapshots `DRAFT` o `SUPERSEDED`.

# 8. Navegación y experiencia del piloto

Modificar las pruebas del registro de módulos y crear pruebas livianas de las vistas:

- **Expediente mensual** contiene las acciones operativas de creación, cálculo, revisión y cierre;
- **Liquidaciones** queda como historial y acceso al detalle, sin acciones paralelas;
- seleccionar una liquidación histórica abre su expediente;
- el asistente no aparece mientras el piloto no lo habilite;
- una URL directa al asistente muestra estado no disponible;
- CM03 no aparece con su flag apagado;
- pago e intereses sólo se habilitan después del cierre;
- las acciones ocultas por capacidad tampoco pueden invocarse por URL o API.

Actualizar `e2e/integrated-flow.spec.ts`, que actualmente espera que el Asistente esté visible.

# 9. Contratos HTTP y OpenAPI

Los tests deben fijar las siguientes interfaces nuevas:

- verificación de lotes de crédito y registro de usos o compensaciones;
- acciones `send`, `accept-item`, `reject-item` y `waive-item` para pedidos;
- CRUD, envío y revisión de `ManagementIncome`;
- capacidades específicas para ingresos gerenciales y publicación de rentabilidad;
- consulta del portal filtrada por estado y rol.

Ampliar `openapi-drift.test.ts` en ambos sentidos:

1. toda ruta documentada debe existir en Fastify;
2. toda ruta pública fiscal o de portal debe estar documentada;
3. cada request y response debe validar contra el schema compartido;
4. toda mutación debe exigir capability y CSRF según corresponda.

# 10. E2E vertical del expediente mensual

Crear `e2e/monthly-workpaper-cycle.spec.ts` con este recorrido único:

1. El estudio crea un pedido documental en borrador.
2. Confirma el envío y el pedido aparece en el portal.
3. Un colaborador del cliente carga los documentos requeridos.
4. El pedido queda listo para revisión, no completado.
5. El estudio acepta los ítems y el pedido se completa.
6. Se crea el expediente mensual.
7. Se cargan saldos anteriores y un revisor los verifica.
8. Se revisan las fuentes y clasificaciones.
9. Se calculan IVA, IIBB local Tucumán y TEM.
10. Un preparador envía el expediente a revisión.
11. Un revisor distinto resuelve controles y finaliza.
12. Se registra la presentación y el pago.
13. Se publica el resultado habilitado para el cliente.
14. El owner del portal lo consulta y descarga.
15. El colaborador puede cargar y mensajear, pero no consultar resultados.
16. Una rectificativa crea una nueva versión sin alterar la original.

El E2E debe verificar además hashes, IDs de versión, recibos de publicación y ausencia de borradores en todas las respuestas del portal.

# 11. Orden de implementación de las pruebas

## Fase A. Gate técnico

1. Corregir los cuatro diagnósticos actuales de TypeScript.
2. Confirmar que lint, suites existentes y build permanecen verdes.
3. Actualizar tests que hoy cristalizan comportamiento contrario al plan.

## Fase B. Contratos críticos del piloto

1. Saldos pendientes, verificación y última rectificativa.
2. Libro de créditos y concurrencia.
3. Workflow documental completo.
4. Visibilidad y roles del portal.
5. Navegación canónica y asistente oculto.

## Fase C. Separación gerencial

1. Ciclo de `ManagementIncome`.
2. Integración con rentabilidad devengada y de caja.
3. Pruebas de no contaminación fiscal.
4. Publicación y acceso por rol.

## Fase D. Aceptación vertical

1. Ejecutar E2E mensual completo.
2. Reliquidar un período histórico ya cerrado.
3. Comparar líneas, saldos y total contra DDJJ y papel de trabajo.
4. Documentar cualquier diferencia antes de habilitar el siguiente cliente.

## 11.1 Estado de implementación y pasos para finalizar

Ya quedaron implementados los ajustes que desbloqueaban el piloto:

1. Contrato de capacidades del portal por rol y restricción de resultados fiscales para `COLLABORATOR` y `READONLY`.
2. Seed reproducible del piloto con flags fiscales, clientes E2E, revisor, membresías y jurisdicciones Tucumán/Córdoba.
3. Categoría Monotributo en el perfil fiscal, activación antes del cálculo y cuota B verificable.
4. Evidencia `ACUSE` lista antes de registrar una presentación; el worker valida hash, antivirus y disponibilidad sin depender de OCR para acuses.
5. Cobertura OpenAPI para las rutas fiscales y de portal incorporadas.
6. E2E mensual con controles, hashes, publicación, descarga del owner, restricciones del colaborador y recorrido responsive.

Los cuatro primeros pasos técnicos ya fueron ejecutados y documentados en esta
iteración:

1. **Separar infraestructura de prueba y piloto.** El desarrollo demo, la base
   E2E y `contable_piloto` quedaron separados; la corrida UI se hizo sobre
   `contable_ui_20260908` y no tocó el piloto.
2. **Repetir el gate técnico.** `typecheck`, `lint`, `build`, motor fiscal
   `129/129`, API `333/333` y web `19/19` quedaron verdes.
3. **Levantar el entorno de aceptación.** Migraciones, seeds, PostgreSQL,
   Valkey, MinIO, ClamAV y worker quedaron operativos para la corrida.
4. **Ejecutar la matriz E2E completa.** Pasaron `16/16` casos en Chromium y
   mobile; además se ejercitó enero de 2026 desde la UI con publicación,
   descarga y rectificación controlada.

Para cerrar el piloto funcional quedan estos pasos:

5. **Ejecutar aceptación con contador.** Reprocesar al menos un período
   histórico cerrado de IVA/IIBB/TEM, comparar líneas, saldos y total contra
   DDJJ/papel de trabajo y registrar diferencias, aun cuando la suite
   automatizada esté verde.
6. **Firmar el piloto.** Confirmar usuarios, roles, flags, jurisdicciones,
   credenciales y procedimiento de rectificación; luego habilitar el siguiente
   cliente sólo si la conciliación histórica está documentada.

## 11.2 Higiene pre-commit: archivos a conservar, excluir o revisar

El workspace contiene cambios previos a esta iteración. Antes de hacer `git add -A` hay que separar el alcance del piloto de archivos generados, movimientos documentales y cambios no aprobados. Esta lista documenta la decisión; no autoriza borrar ni revertir cambios automáticamente.

### Deben quedar incluidos si el commit es el de cierre del piloto

- Migraciones nuevas bajo `apps/api/prisma/migrations/`, junto con los cambios compatibles de `schema.prisma` y seeds.
- Código y tests de capacidades, portal, fiscalización, expediente mensual, rentabilidad y worker que estén cubiertos por este plan.
- `e2e/monthly-workpaper-cycle.spec.ts`, los E2E fiscales existentes y `playwright.config.ts`.
- `apps/api/src/seed-piloto.ts` y la documentación de ejecución reproducible.
- `apps/api/src/openapi/spec.ts`, tests de drift y cambios de `packages/permissions` asociados al contrato.
- `apps/api/Dockerfile`, `infra/compose/docker-compose.yml` y `.dockerignore` sólo si el commit también incluye la reproducibilidad del entorno local/CI.
- `package-lock.json` únicamente junto con los cambios de `package.json` que lo expliquen.

### No deben entrar al commit

- Artefactos generados: `dist/`, `build/`, `coverage/`, `test-results/`, `playwright-report/` y `*.tsbuildinfo`.
- Credenciales o configuración local: `.env*` salvo `.env.example`, URLs de bases locales, secretos de MinIO/Valkey/ClamAV y dumps de PostgreSQL.
- Evidencia temporal de ejecución: traces, screenshots, logs, PDFs de prueba y archivos exportados por los E2E.
- Bases o volúmenes Docker (`contable`, `contable_piloto`, `contable_e2e`, `contable_tests`); son estado local, no artefactos versionables.

Estos elementos ya están cubiertos en `.gitignore` o viven fuera del árbol Git; deben verificarse antes de preparar el commit.

### Deben revisarse antes de decidir si se conservan o eliminan

1. **Documentación existente.** Se decidió mantener por ahora todos los documentos originales bajo `docs/`, incluidos los que también tienen copia exacta bajo `docs/dev/`. La duplicación es intencional y no debe convertirse en borrado ni rename en este commit.
2. **Documentos nuevos de decisión.** Se incorporan `Plan-de-pruebas-piloto-fiscal.md` y `Cambios-arquitectura-y-flujos-conversacion-contador.md` al commit documental.
4. **Cambios amplios previos.** Los grupos modificados de `apps/web/src/study/`, `apps/api/src/tax/`, `packages/tax-engine/` y documentación deben revisarse por diff y autoría. Si no tienen relación trazable con una fila de este plan o con una migración incluida, deben quedar fuera del commit de cierre, no borrarse del workspace.
5. **Infraestructura.** `apps/api/Dockerfile`, `infra/compose/docker-compose.yml`, `.dockerignore` y `playwright.config.ts` deben entrar juntos si se quiere que otra persona pueda reproducir el gate; si el objetivo del commit es sólo lógica fiscal, deben separarse en un commit de infraestructura.

### Secuencia segura antes de commit

1. Ejecutar `git diff --check` y revisar `git status --short`.
2. Preparar primero migraciones, código, tests y documentación del piloto; no usar `git add -A`.
3. Confirmar que no quedan borrados bajo `docs/` y que la duplicación `docs/`/`docs/dev/` está documentada.
4. Revisar los dos documentos nuevos con el responsable del repositorio.
5. Comprobar que no se incluyan secretos, bases, artefactos ni cambios sin trazabilidad al plan.
6. Ejecutar nuevamente el gate técnico y la matriz E2E sobre una base limpia antes de crear el commit.

## 11.3 Propuesta de partición de commits

Para evitar un commit monolítico y facilitar la revisión, la lista actual debería particionarse así:

### Commit A — producto fiscal y contratos

- `apps/api/prisma/schema.prisma` y las migraciones nuevas.
- `apps/api/src/auth/`, `apps/api/src/documents/`, `apps/api/src/portal/`, `apps/api/src/tax/` y sus tests relacionados.
- `apps/worker/src/document-processor.ts`.
- `packages/contracts/`, `packages/permissions/` y `packages/tax-engine/` relacionados con el plan.
- `apps/web/src/portal/`, `apps/web/src/study/`, `apps/web/src/ui/` y sus tests sólo cuando el diff corresponda a una capacidad o recorrido del piloto.
- E2E fiscales, mensual y configuración de Playwright.

### Commit B — reproducibilidad de entorno

- `apps/api/Dockerfile`, `.dockerignore` e `infra/compose/docker-compose.yml`.
- `apps/api/package.json`, `package-lock.json` y `playwright.config.ts`.
- `apps/api/src/seed-piloto.ts`, `apps/api/src/seed-maestros-fiscales.ts` y cambios de seeds necesarios para idempotencia.

Este commit debe conservar la documentación exacta para levantar PostgreSQL/Valkey/MinIO/ClamAV y ejecutar el worker. Si no se desea entregar infraestructura en esta iteración, todo este grupo debe quedar fuera como unidad, no parcialmente.

### Commit C — documentación

- `README.md`, `docs/README.md`, `Plan-de-pruebas-piloto-fiscal.md` y `Cambios-arquitectura-y-flujos-conversacion-contador.md`.
- Los documentos originales bajo `docs/` y las copias bajo `docs/dev/`, porque se decidió conservar ambas rutas temporalmente.

### Fuera del commit de cierre hasta revisión de autoría

- Cualquier modificación de `apps/web/src/study/` o `packages/design-system/` que no tenga una referencia directa a navegación, estado o formulario exigido por el plan.
- Cambios de `apps/api/src/tax/` o `packages/tax-engine/` que no tengan test correspondiente, migración asociada o entrada en el mapa de cobertura.
- Borrados documentales sin reemplazo equivalente.
- Cambios de infraestructura si no se va a soportar la reproducción del entorno en CI o por otro desarrollador.

La regla es dejar estos archivos fuera del staging, no eliminarlos del workspace. La eliminación sólo procede después de confirmar que el contenido está duplicado, obsoleto o reemplazado.

# 12. Gate de aceptación

La implementación se acepta únicamente cuando pasan, en este orden:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w @contable/tax-engine`
4. `npm run test -w @contable/api`
5. `npm run test -w @contable/web`
6. `npm run build`
7. E2E de IVA, IIBB, TEM, rentabilidad y expediente mensual
8. `npm test && npm run test:e2e`

## 12.1 Criterios de aceptación funcional

- Ningún saldo no verificado reduce un impuesto.
- Ningún borrador aparece en el portal.
- Ningún usuario ve información fuera de su rol o cliente.
- Ningún dato gerencial modifica una liquidación fiscal.
- Ninguna liquidación finalizada cambia sin rectificativa.
- Todos los resultados son reproducibles con los mismos inputs y reglas.
- El recorrido completo puede repetirse sobre un período histórico y concilia con la DDJJ presentada.

## 12.2 Fuera del alcance de esta entrega

- Medición automática de horas del estudio.
- Gastos operativos y costeo interno del estudio.
- Regímenes especiales de Convenio Multilateral.
- Presentación automática ante organismos fiscales.
- Activación productiva del asistente contable.

Estos elementos quedan como fases posteriores y no deben bloquear el piloto fiscal definido en este documento.

# 13. Resultado esperado

Al completar esta suite, el equipo contará con una barrera automática que valida el flujo completo: documentación solicitada y revisada, saldos oficiales verificados, cálculo fiscal determinista, segregación de funciones, cierre inmutable, rentabilidad separada y publicación segura al cliente.

El valor principal no será sólo detectar regresiones. Los tests funcionarán como especificación ejecutable del producto y evitarán que futuras ampliaciones vuelvan a mezclar liquidación fiscal, información gerencial y visibilidad del portal.
