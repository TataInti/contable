# Uso gradual del piloto fiscal — diez pasos

Este documento convierte el plan funcional en una secuencia operativa. No se
avanza al paso siguiente si el criterio de cierre del paso actual no tiene
evidencia.

## Estado actual

El gate automatizado está verde en una base aislada: motor fiscal 129/129,
API 333/333, web 19/19, `typecheck`, `lint`, `build` y E2E 16/16 completos en
Chromium y mobile. La corrida histórica real queda separada porque escribe liquidaciones
persistentes y requiere autorización del responsable del piloto. El E2E usa
una base limpia y un `QUEUE_PREFIX` compartido sólo por su API y worker.
La base `contable_piloto` fue recreada, migrada y sembrada nuevamente: parte
con cero períodos y cero liquidaciones históricas, lista para una corrida de
aceptación controlada. Luego se ejecutó enero de 2026 para `Alimentos del Sur
S.A.`: quedó una única liquidación `FINALIZED`, versión 1, por `33.600,00`, con
hashes de entrada y salida. La evidencia está en
`docs/piloto/g6-corrida-historica-enero-2026.md`. Esta corrida valida el
recorrido operativo sobre la base piloto, pero todavía usa datos de control y
no reemplaza la conciliación contra la DDJJ y el papel de trabajo reales.

## Evidencia de corrida UI — enero de 2026

El 2026-09-08 se ejecutó una segunda corrida completa en la base aislada
`contable_ui_20260908`, sin tocar `contable_piloto` ni otras bases. Se abrió el
navegador y se completó el recorrido con los roles titular, cliente y revisor:

1. En Configuración fiscal se creó y activó el perfil de `Alimentos del Sur
   S.A.`, se registraron RI, IIBB Tucumán y TEM, la actividad `COMERCIO`, los
   tres períodos de enero y sus obligaciones materializadas.
2. En Expediente mensual se importaron por UI cuatro fuentes obligatorias, cada
   una con `Committed` y 1/1 filas. El usuario revisor aprobó los cuatro lotes.
3. La clasificación quedó `4 Clasificados / 0 Pendientes` y el expediente pasó
   a `Ready to calculate`.
4. El cálculo UI produjo IVA $12.600,00, IIBB $5.000,00 y TEM $3.000,00, sin
   diferencias de motor abiertas.
5. El cliente cargó por portal el PDF bancario; la bandeja del estudio revisó
   la extracción y el duplicado validado quedó disponible como evidencia.
6. Se resolvieron por UI los dos controles bloqueantes con esa evidencia, el
   titular envió a revisión, el revisor aprobó y finalizó el expediente.
7. Liquidaciones muestra las tres posiciones en estado `Finalizado`. Se cargó
   por portal un documento `ACUSE`, y desde la UI se registraron las tres
   presentaciones y los tres pagos completos: IVA $12.600,00, IIBB $5.000,00 y
   TEM $3.000,00. El portal lista presentación y pago para enero. El rol de
   solo lectura no muestra la navegación de carga de documentos.
8. Trabajo muestra las tres obligaciones de enero con su impuesto, período,
   vencimiento y estado `Pagado`. Desde Liquidaciones se generaron los seis
   artefactos publicados (PDF y CSV de papel de trabajo por impuesto). El
   portal los muestra junto con el nombre completo de IVA, IIBB y TEM y ofrece
   sus descargas.
9. Se inició desde Liquidaciones una rectificación de TEM. La UI dejó visible
   la versión `v2 · Borrador` y conservó la `v1 · Finalizado`; la base confirmó
   `supersedesId` y el mismo importe calculado. La repetición sobre otros
   períodos sigue cubierta por los escenarios E2E.

La repetición del E2E con el arnés corregido ejecutó 16 casos y los 16 pasaron
en Chromium y mobile, incluidos CM03, IIBB, Monotributo, expediente mensual,
rentabilidad, TEM y navegación aislada del portal.

La acción de presentación quedó ejercitada end-to-end después de agregar al
portal el selector visible de documento `ACUSE`. La presentación exige un
settlement `FINALIZED` y evidencia `READY`; la corrida registró las tres
presentaciones con acuse y luego los tres pagos completos, sin dejar saldos
pendientes.

Durante la corrida se corrigió la normalización de fecha en UI y luego se
calcularon y publicaron ambas bases de rentabilidad. El portal mostró los dos
snapshots de enero: devengado $239.400,00 y caja $260.000,00, con sus recibos y
hashes.

La evidencia UI cierra técnicamente el recorrido fiscal, de presentación, pago,
publicación, rectificación y rentabilidad de enero. No reemplaza el criterio de
cierre profesional: todavía hace falta conciliar contra DDJJ y papeles de
trabajo reales y obtener la firma del contador responsable.

## Secuencia

| Paso | Resultado que debe quedar cerrado | Evidencia | Estado |
|---|---|---|---|
| 1. Entorno | `contable_e2e` y `contable_piloto` separados; migraciones, roles y worker reproducibles | Compose, migraciones, seeds y health checks | Automatizado; piloto saneado |
| 2. Perfil fiscal | Cliente, CUIT, condición, jurisdicciones, actividades y reglas aprobadas | Perfil `ACTIVE` y revisión del responsable | Pendiente revisión profesional |
| 3. Documentos/portal | Pedido enviado, carga validada, revisión de ítems y permisos por rol | Pedido `COMPLETED`, evidencia y auditoría | Automatizado |
| 4. Expediente mensual | Fuentes y saldos verificados; controles resueltos | Expediente `FINALIZED` con hashes | Automatizado; enero 2026 ejecutado |
| 5. IVA | Líneas y saldos concilian con el control manual | DDJJ/papel de trabajo vs. liquidación | Corrida de enero completada; pendiente conciliación profesional |
| 6. IIBB/TEM | Jurisdicción, actividades, mínimos y créditos concilian | Control manual por impuesto | Pendiente datos históricos |
| 7. Cierre/pago | Maker-checker, presentación con acuse y pago trazable | Estados, recibos y auditoría | Automatizado; enero 2026 presentado y pagado |
| 8. Publicación | Portal recibe sólo resultados publicados y visibles para el rol correcto | Recibo, nombres de impuesto y seis descargas PDF/CSV visibles | Automatizado; enero 2026 publicado |
| 9. Rentabilidad | Devengado/caja separados y sin contaminar fiscal | Snapshot publicado y hashes | Automatizado |
| 10. Rectificación/repetición | Nueva versión inmutable y repetición sobre otro período | UI `v2 · Borrador`, `v1 · Finalizado`, `supersedesId` y E2E repetible | Ejercitado; requiere aprobación funcional para producción |

### Reproducibilidad del entorno E2E

Si varias bases comparten Valkey, definir un namespace único y repetirlo en la
API y el worker. Por ejemplo:

```bash
QUEUE_PREFIX=contable-e2e-20260908
```

El worker debe usar además `WORKER_DATABASE_URL` de esa misma base. Una base
E2E no debe reutilizar datos de una corrida anterior, porque varios escenarios
crean el mismo período intencionalmente para probar una única ejecución.

## Comandos de operación segura

Primero revisar el alcance sin escribir:

```bash
DATABASE_URL=postgresql://contable:contable@localhost:5432/contable_piloto \
  npm run seed:corrida -w @contable/api -- --dry-run --periodos 1
```

Luego, sólo con autorización explícita, ejecutar un cliente y un período:

```bash
DATABASE_URL=postgresql://contable:contable@localhost:5432/contable_piloto \
  npm run seed:corrida -w @contable/api -- \
  --client-id <cliente> --periodos 1 --confirm-write
```

Después de comparar el resultado con la DDJJ y el papel de trabajo, repetir
para los períodos restantes. Toda diferencia debe registrarse con causa,
responsable, fecha, decisión y evidencia antes de habilitar otro cliente.

## Criterio de cierre del piloto

El piloto sólo se considera cerrado cuando:

1. los períodos históricos de IVA, IIBB y TEM concilian o tienen diferencias
   aceptadas;
2. la rectificativa fue ensayada y conserva la versión original;
3. los usuarios, roles, flags y procedimiento de soporte están confirmados;
4. la base usada para la aceptación no contiene artefactos sintéticos de E2E;
5. el contador responsable firma la aceptación funcional;
6. el gate automatizado vuelve a pasar después de cualquier corrección.
