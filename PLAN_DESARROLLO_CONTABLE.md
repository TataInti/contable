# Plan maestro de reconstrucción fiscal — Contable

> Estado: plan ejecutable derivado de la auditoría integral del repositorio  
> Madurez auditada: prototipo integrado; Puerta 0 = FAIL  
> Fecha de corte: 13 de agosto de 2026  
> Audiencia: producto, responsables contables, frontend, backend, datos, QA e infraestructura  
> Reemplaza: el plan anterior orientado a contabilidad general  
> Regla principal: ninguna función tributaria se habilita a usuarios hasta completar su flujo de punta a punta y superar su puerta fiscal, técnica y operativa

---

## 1. Propósito del producto

Contable debe ser una herramienta de trabajo para estudios contables argentinos cuyo resultado principal sea **preparar, revisar, finalizar y dar seguimiento a liquidaciones de impuestos**.

Los clientes, documentos, OCR, pedidos, asientos internos y reportes son medios para ese fin. No constituyen por sí solos el producto.

El primer resultado útil debe permitir que un estudio:

1. configure el perfil fiscal vigente de un contribuyente;
2. determine qué obligaciones tiene para un período;
3. reúna información oficial, comprobantes y ajustes documentados;
4. normalice y revise los hechos fiscales;
5. calcule una liquidación mediante reglas deterministas y versionadas;
6. explique cada importe hasta su fuente y regla;
7. aplique revisión independiente antes de finalizar;
8. exporte el papel de trabajo y registre manualmente presentación y pago;
9. muestre al cliente sus pendientes, resultados publicados y rentabilidad gerencial.

La aplicación **no almacenará claves fiscales ni presentará declaraciones automáticamente** en esta etapa. El contador seguirá presentando en los portales oficiales y registrará en Contable el acuse, importe, fecha y pago.

### 1.1 Resultado de negocio esperado

Una persona del estudio debe poder entrar a la cartera y responder, sin reconstrucción manual paralela:

- qué clientes tienen vencimientos próximos;
- cuáles liquidaciones están bloqueadas y por qué;
- qué documentación o importaciones faltan;
- qué diferencias necesitan criterio profesional;
- quién preparó y quién revisó;
- qué se presentó, qué se pagó y qué saldo queda;
- cuál fue la rentabilidad mensual del cliente antes y después de impuestos, tanto por devengado como por caja.

### 1.2 Principios no negociables

- **Exactitud antes que automatización.** OCR e IA proponen; reglas y cálculos son deterministas.
- **Reglas con procedencia.** Ninguna regla se activa sin fuente oficial, vigencia, pruebas doradas y aprobación de un profesional matriculado.
- **Trazabilidad completa.** Todo renglón final debe enlazar entradas, ajustes, regla, versión del motor, revisor y evidencia.
- **Maker-checker.** Quien prepara no puede aprobar ni finalizar su propio trabajo.
- **Historial inmutable.** Rectificar crea una nueva versión; nunca reescribe una liquidación finalizada.
- **Separación fiscal y gerencial.** Un gasto de gestión sin respaldo fiscal puede afectar rentabilidad, pero no reduce impuestos salvo regla aplicable y aprobación profesional explícita.
- **Producto vertical.** Un módulo incompleto permanece oculto; no se publica una pantalla que sólo liste datos o simule completar una acción.
- **Contexto obligatorio.** Firma, cliente, impuesto y período deben estar visibles en toda operación sensible.
- **Sin credenciales tributarias.** La primera versión calcula, exporta y registra; no presenta en nombre del contribuyente.

---

## 2. Conclusión de la auditoría actual

### 2.1 Diagnóstico

El repositorio contiene una base técnica valiosa, pero **el backend fiscal no está listo y el frontend no implementa una liquidación real**. El problema principal no es visual: es de dominio, contratos, estados y flujos inconclusos.

Las carpetas, migraciones o comentarios rotulados como Fase 8, Fase 11 o Fase 13 no demuestran madurez. El estado verificable del producto es **prototipo integrado con Puerta 0 no aprobada**.

La implementación actual no debe usarse para obtener posiciones fiscales reales. En particular:

- apps/api/src/tax/vat-service.ts consulta líneas de todos los períodos del cliente sin filtrar por periodId ni cutoff;
- VatRule.rate no participa del cálculo;
- expected y actual se construyen con el mismo importe, por lo que las diferencias siempre quedan vacías;
- una liquidación puede pasar de CALCULATED a FINALIZED sin estado REVIEWED;
- no existe interfaz del estudio para liquidaciones;
- no existe un comprobante fiscal persistido con base, alícuota, componentes, retenciones y percepciones;
- la bandeja genera un asiento de dos líneas usando sólo el total, cuentas elegidas manualmente y ARS forzado;
- el alta de cliente no conduce a configurar condición fiscal, actividades, jurisdicciones, períodos ni obligaciones;
- no existen presentación, acuse, pago, imputación, anticipo ni saldo a favor como flujo completo;
- el reporte actual deriva ingresos y egresos del mayor, pero no separa gastos fiscales de gastos gerenciales ni calcula resultado post-impuestos;
- estados incompatibles entre backend y frontend hacen que pedidos y cierres terminados permanezcan abiertos;
- el selector de período es en varios casos decorativo porque las consultas no lo respetan;
- el CI no levanta PostgreSQL y numerosas suites de integración se omiten mediante skipIf;
- el E2E actual prueba navegación y carga, no un ciclo tributario;
- el publicador de outbox y los permisos runtime tienen brechas operativas conocidas.
- este workspace no contiene metadatos .git, por lo que todavía no puede asociar evidencia de calidad a un commit o tag reproducible.

### 2.2 Matriz de disposición

| Área actual                   | Estado real                                         | Decisión                                                                 |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Autenticación, sesiones y MFA | Base utilizable                                     | Conservar y endurecer pruebas                                            |
| Firma, asignaciones y RLS     | Base utilizable con huecos de capacidades           | Conservar, completar y probar con roles runtime                          |
| Carga segura y almacenamiento | Base utilizable                                     | Conservar; enlazar a pedidos y hechos fiscales                           |
| Auditoría                     | Base utilizable                                     | Extender a toda transición fiscal                                        |
| Partida doble y mayor         | Base técnica utilizable                             | Mantener como evidencia y conciliación interna; retirar de la navegación |
| Clientes                      | ABM parcial                                         | Convertir en onboarding fiscal completo                                  |
| Documentos y OCR              | Pipeline parcial                                    | Convertir en ingestión versionada de hechos fiscales                     |
| IVA actual                    | Cálculo incorrecto                                  | Deshabilitar y reemplazar                                                |
| Obligaciones y recordatorios  | Modelo nominal, sin calendario fiscal confiable     | Rehacer sobre reglas versionadas                                         |
| Cierres y trabajo             | Estados incompatibles y flujos fragmentados         | Unificar alrededor del ciclo de liquidación                              |
| Reportes contables y BI       | Desalineados con el objetivo                        | Retirar de navegación; reemplazar por Rentabilidad                       |
| Asistente                     | Experiencia incompleta, sin autoridad fiscal válida | Ocultar hasta tener herramientas y evidencias seguras                    |
| Portal                        | Base visual aprovechable                            | Reorientar a pedidos, impuestos publicados, pagos y rentabilidad         |
| CI y E2E                      | No demuestran integración fiscal                    | Rehacer como puerta obligatoria                                          |

### 2.3 Elementos que se conservan

- React 19, Vite, TypeScript y TanStack Query.
- Fastify, Prisma y PostgreSQL.
- diseño cálido marfil/verde, tipografías locales y shell separado para el portal;
- auth, MFA, sesiones por dispositivo y contexto multi-tenant;
- almacenamiento de objetos, validación de archivos y cuarentena;
- auditoría append-only;
- motor decimal y validación de partida doble;
- infraestructura BullMQ/Valkey como base, después de corregir entrega y recuperación;
- enfoque de revisión independiente;
- tests unitarios existentes que validen invariantes reales.

### 2.4 Acciones inmediatas de contención

Hasta que exista el nuevo motor:

- deshabilitar por feature flag server-side el cálculo y la finalización de IVA actuales;
- impedir que Bandeja cree asientos automáticos a partir de un total sin desglose;
- ocultar Contabilidad, Reportes genéricos, BI y Asistente de la navegación productiva;
- mostrar sólo módulos con acciones persistentes y verificables;
- etiquetar cualquier dato demo como DEMOSTRACIÓN — NO APTO PARA LIQUIDAR;
- corregir permisos de outbox_events, recuperación de jobs y capacidades de portal antes de aceptar archivos reales.

---

## 3. Decisiones de alcance cerradas

| Tema                        | Decisión                                                                    |
| --------------------------- | --------------------------------------------------------------------------- |
| Contribuyentes iniciales    | Responsables inscriptos y monotributistas                                   |
| Nivel nacional              | IVA para responsables inscriptos y seguimiento de monotributo               |
| Nivel provincial            | IIBB Tucumán local y Convenio Multilateral CM03 artículo 2                  |
| Nivel municipal             | TEM de San Miguel de Tucumán                                                |
| Piloto territorial          | Tucumán y San Miguel de Tucumán                                             |
| Fuente primaria             | Importaciones oficiales; documentos, OCR y carga manual completan faltantes |
| Presentación                | Fuera de Contable; se exporta y registra manualmente el resultado           |
| Credenciales fiscales       | No se almacenan                                                             |
| Gastos sin respaldo fiscal  | Gestión separada; no reducen base fiscal por defecto                        |
| Excepción a gasto gerencial | Sólo mediante regla vigente, evidencia y aprobación profesional             |
| Contabilidad visible        | Se oculta por completo de la interfaz de producto                           |
| Rol del mayor               | Evidencia y conciliación interna, no navegación principal                   |
| Rentabilidad                | Vista devengada y vista de caja, siempre separadas                          |
| Gobernanza de reglas        | Fuente oficial, vigencia, hash, golden tests y contador matriculado         |
| Datos existentes            | Sólo demo/desarrollo; se permite reemplazar el baseline de base de datos    |
| Estrategia de entrega       | Puertas verticales; todo módulo incompleto queda oculto                     |
| Documento rector            | Este archivo reemplaza el PLAN_DESARROLLO_CONTABLE.md anterior              |

### 3.1 Incluido en la primera versión utilizable

- onboarding fiscal versionado;
- calendario de obligaciones derivado de reglas;
- importación oficial y reconciliación de archivos;
- comprobantes fiscales y componentes impositivos;
- retenciones, percepciones, saldos anteriores, anticipos y ajustes documentados;
- liquidación IVA;
- liquidación IIBB Tucumán local;
- liquidación CM03 artículo 2, excluyendo regímenes especiales;
- liquidación/seguimiento TEM San Miguel de Tucumán;
- seguimiento mensual y de recategorización de monotributo;
- revisión, finalización, rectificación, exportación, acuse y pago;
- pedidos documentales vinculados a la obligación;
- rentabilidad gerencial devengada y de caja;
- portal del cliente para aportar, consultar y descargar resultados publicados.

### 3.2 Fuera de alcance inicial

- Ganancias;
- Autónomos;
- sueldos, cargas sociales y libro de sueldos;
- bienes personales;
- CM04, CM05 y regímenes especiales de Convenio Multilateral;
- jurisdicciones locales fuera de Tucumán en el primer piloto;
- municipios fuera de San Miguel de Tucumán;
- presentación automática ante ARCA, COMARB, DGR o SMT;
- almacenamiento de claves fiscales;
- conciliación bancaria avanzada;
- estados contables formales;
- asistente generativo con capacidad de modificar o finalizar impuestos;
- recomendaciones legales automáticas.

Estos puntos sólo ingresan al roadmap luego de estabilizar el piloto y repetir el proceso completo de validación normativa.

---

## 4. Usuarios, responsabilidades y permisos

### 4.1 Roles del estudio

| Rol                | Responsabilidad                                                    | Restricciones                                                                   |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Owner/Admin        | Firma, usuarios, asignaciones y configuración operativa            | No aprueba reglas fiscales por ser admin salvo que además tenga rol profesional |
| Preparador         | Importa, normaliza, solicita documentación y prepara liquidaciones | No revisa ni finaliza su propia liquidación                                     |
| Revisor            | Controla hechos, diferencias, reglas y cálculo                     | No puede revisar trabajo propio                                                 |
| Profesional fiscal | Aprueba versiones normativas y finaliza resultados                 | Debe tener matrícula registrada y vigente                                       |
| Auditor/consulta   | Lee evidencia, historial y resultados                              | Sin mutaciones                                                                  |
| Operador de pagos  | Registra presentación y pago                                       | No altera cálculo finalizado                                                    |

Un usuario puede reunir varios roles, pero las restricciones maker-checker se aplican por actor, no sólo por nombre de rol.

### 4.2 Roles del portal

| Rol          | Puede                                                                        | No puede                                       |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| Colaborador  | Responder pedidos, cargar archivos, enviar mensajes, consultar publicaciones | Ver borradores internos o configurar impuestos |
| Sólo lectura | Consultar obligaciones, presentaciones, pagos y reportes publicados          | Cargar, responder o enviar mensajes            |

El guard de autorización debe distinguir ambos roles. El portal Sólo lectura no recibirá accidentalmente capacidades de upload o mensajes.

### 4.3 Capacidades mínimas

- tax.profile.read y tax.profile.write
- tax.rules.read, tax.rules.propose, tax.rules.approve y tax.rules.activate
- tax.vouchers.read, tax.vouchers.prepare y tax.vouchers.review
- tax.settlements.read, calculate, submit_review, review, finalize, rectify y export
- tax.filings.record y tax.payments.record
- tax.management_expenses.read, write y approve_treatment
- profitability.read y profitability.publish
- portal.requests.respond, portal.documents.upload y portal.results.read

Toda ruta debe declarar una capacidad. La ausencia de mapeo debe negar acceso y fallar una prueba automática.

---

## 5. Arquitectura de información objetivo

### 5.1 Navegación del estudio

La navegación primaria se reduce a:

1. **Cartera**
2. **Liquidaciones**
3. **Documentación**
4. **Rentabilidad**
5. **Configuración fiscal**
6. **Administración**

Contabilidad, BI, Reportes genéricos y Asistente desaparecen de la navegación. El mayor continúa disponible únicamente como detalle interno desde una conciliación o evidencia autorizada.

### 5.2 Contexto persistente

El encabezado debe mostrar y conservar:

- firma;
- cliente;
- período fiscal;
- impuesto o régimen;
- estado del trabajo;
- rol efectivo.

Cambiar firma invalida cliente, período e impuesto no compatibles. Cambiar cliente conserva el último período sólo si existe para ese cliente. La interfaz nunca elige silenciosamente un cliente ambiguo.

### 5.3 Cartera como mesa de trabajo

La portada no será una tira de métricas decorativas. Será una lista priorizada por:

- vencimiento;
- riesgo;
- documentación faltante;
- diferencias abiertas;
- estado de revisión;
- presentación pendiente;
- pago pendiente;
- responsable asignado.

Cada fila tendrá una acción siguiente inequívoca: Configurar, Pedir, Revisar, Calcular, Corregir, Finalizar, Registrar presentación o Registrar pago.

Filtros:

- responsable;
- impuesto;
- jurisdicción;
- período;
- estado;
- vencimiento;
- cliente;
- sólo bloqueados.

### 5.4 Espacio fiscal del cliente

Rutas objetivo:

- /clientes/:clientId/resumen
- /clientes/:clientId/configuracion-fiscal
- /clientes/:clientId/documentacion
- /clientes/:clientId/liquidaciones
- /clientes/:clientId/periodos/:periodId/liquidaciones/:settlementId
- /clientes/:clientId/obligaciones
- /clientes/:clientId/rentabilidad
- /clientes/:clientId/historial

El resumen muestra próximos vencimientos, cobertura de entradas, bloqueos, última presentación, saldos a favor y tareas. No muestra métricas contables internas irrelevantes.

Período, impuesto, jurisdicción, responsable, estado y vencimiento se reflejan en la URL. Refrescar, compartir un enlace o volver atrás no debe perder filtros ni contexto. Cambiar de contexto con cambios sin guardar exige confirmación.

### 5.5 Pantalla de liquidación

Debe ser una estación de trabajo con cinco zonas:

1. **Cabecera:** cliente, CUIT, impuesto, período, vencimiento, versión y estado.
2. **Cobertura:** archivos oficiales, comprobantes, retenciones/percepciones, saldo anterior y faltantes.
3. **Cálculo:** renglones agrupados con fórmula, regla y subtotal.
4. **Diferencias y controles:** conciliaciones, advertencias y decisiones pendientes.
5. **Timeline y acciones:** preparador, revisor, recibos, exportación, presentación, pago y rectificativas.

Cada importe permite drill-down hasta:

- lote o documento;
- fila importada o campo extraído;
- componente fiscal;
- ajuste manual y motivo;
- regla y fuente oficial;
- operación aritmética;
- actor y fecha.

### 5.6 Documentación

La bandeja se convierte en una estación de revisión:

- preview del archivo original;
- datos extraídos junto a la evidencia;
- comparación con importación oficial;
- detección de duplicados;
- dirección compra/venta;
- tipo y numeración del comprobante;
- emisor, receptor y CUIT;
- moneda y tipo de cambio;
- netos por alícuota;
- exento/no gravado;
- IVA y otros tributos;
- retenciones y percepciones;
- ítems y actividad sugerida;
- tratamiento fiscal propuesto;
- confianza por campo;
- aceptar, corregir, rechazar o pedir aclaración.

No se crea un asiento real al aprobar el documento. Se crea o versiona un hecho fiscal aprobado y, si corresponde, se deriva evidencia interna para conciliación.

### 5.7 Rentabilidad

La pantalla separa dos vistas:

**Devengado**

- ventas netas del período;
- gastos con respaldo fiscal;
- gastos de gestión sin respaldo fiscal;
- impuestos que constituyen costo del período;
- resultado antes de impuestos;
- resultado gerencial luego de impuestos.

**Caja**

- cobros;
- pagos con respaldo fiscal;
- pagos de gestión;
- pagos impositivos;
- flujo neto luego de impuestos.

IVA trasladado o computable se presenta como posición fiscal y efecto de caja, no como gasto económico salvo tratamiento específico aprobado. La interfaz explica la definición de cada subtotal y no denomina estados contables a estos reportes gerenciales.

### 5.8 Portal

Navegación:

- Inicio
- Pendientes
- Impuestos
- Rentabilidad
- Mensajes
- Perfil

El portal permite:

- responder un pedido y asociar cada archivo al ítem correcto;
- ver si el archivo está recibido, observado o aceptado;
- consultar sólo liquidaciones publicadas;
- descargar papel de trabajo, acuse y comprobante de pago cuando estén publicados;
- ver vencimientos, importes y estados traducidos;
- consultar rentabilidad publicada;
- conversar dentro del contexto de una obligación.

No muestra borradores, reglas internas, diferencias del estudio ni información de otros clientes.

Rutas de detalle objetivo:

- /portal/pendientes/:requestId
- /portal/documentos
- /portal/impuestos/:obligationId
- /portal/rentabilidad/:periodId

### 5.9 Estados de interfaz obligatorios

Toda consulta y mutación debe contemplar:

- carga con descripción específica;
- vacío verdadero y accionable;
- error saneado con reintento;
- actualización en curso;
- dato desactualizado;
- conflicto de versión;
- éxito con recibo persistente;
- operación parcial;
- permiso insuficiente;
- dependencia externa no disponible.

No se utilizará Sin resultados mientras una consulta esté cargando. Las acciones irreversibles exigen confirmación contextual, motivo cuando corresponda y recibo posterior.

### 5.10 Accesibilidad y responsive

- labels asociados a todos los campos;
- contraste WCAG AA;
- foco visible;
- navegación completa por teclado;
- regiones live para jobs y errores;
- objetivos táctiles mínimos de 44 por 44 píxeles;
- tablas que se transforman en tarjetas o filas apiladas en móvil;
- drawer accesible en estudio y navegación inferior en portal;
- no usar dos carruseles horizontales apilados;
- fechas y montos con formato argentino y texto equivalente para lectores de pantalla;
- respeto de prefers-reduced-motion.

---

## 6. Flujos funcionales de punta a punta

### 6.1 Alta y onboarding fiscal

1. El estudio crea el cliente con razón social, CUIT y tipo de persona.
2. Configura una versión de perfil fiscal con vigencia.
3. Declara condición nacional: responsable inscripto o monotributista.
4. Registra actividades y códigos vigentes.
5. Registra IIBB local Tucumán o Convenio Multilateral.
6. Para Convenio, carga jurisdicciones y coeficientes aplicables.
7. Registra TEM San Miguel de Tucumán cuando corresponda.
8. Carga saldos iniciales, anticipos y créditos con evidencia.
9. El sistema deriva obligaciones y períodos.
10. Un profesional revisa y activa la versión.

Puerta: no se puede calcular un impuesto si falta perfil vigente, inscripción compatible, actividad, jurisdicción, regla aprobada o período.

### 6.2 Ingestión de información

1. El preparador crea un lote indicando origen, impuesto y período.
2. Importa archivo oficial con adaptador versionado.
3. El sistema valida formato, encabezado, CUIT, período, totales y duplicados.
4. Cada fila queda visible con estado y error específico.
5. Documentos u OCR completan filas faltantes o aportan evidencia.
6. Retenciones y percepciones se importan o cargan como certificados.
7. El preparador resuelve conflictos y envía hechos a revisión.
8. El revisor aprueba o rechaza.

Una importación nunca se confirma parcialmente sin mostrar qué filas quedaron fuera. Reintentar el mismo lote no duplica hechos.

### 6.3 Preparación de una liquidación

1. El estudio abre cliente, impuesto y período.
2. El sistema materializa o recupera la obligación correspondiente.
3. La cobertura indica entradas presentes y faltantes.
4. El preparador fija cutoff.
5. El motor selecciona sólo hechos aprobados dentro del período y cutoff.
6. Aplica reglas exactas, saldos, retenciones, percepciones, anticipos y redondeos.
7. Genera renglones, controles, advertencias e inputHash/outputHash.
8. Concilia contra fuentes independientes cuando existan.
9. El preparador resuelve bloqueos o documenta decisiones.
10. Envía la liquidación a revisión.

### 6.4 Revisión y finalización

1. El revisor recibe un resumen de cambios desde la última ejecución.
2. Inspecciona cobertura, diferencias, ajustes y reglas.
3. Puede aprobar, pedir cambios o rechazar.
4. La aprobación registra comentario, actor, fecha y hashes.
5. Un profesional autorizado finaliza.
6. La base impide UPDATE o DELETE de la versión finalizada.
7. Se genera papel de trabajo y artefactos de exportación.

No se finaliza con diferencias bloqueantes, entradas pendientes, reglas no aprobadas o si preparador y revisor son la misma persona.

### 6.5 Presentación y pago

1. El contador presenta fuera de la aplicación.
2. Registra fecha, identificador externo, importe presentado y adjunta acuse.
3. La obligación pasa a FILED sólo con evidencia.
4. Registra uno o más pagos, compensaciones o créditos aplicados.
5. Cada imputación actualiza saldo pendiente sin alterar el cálculo.
6. La obligación pasa a PAID únicamente cuando la asignación cubre el importe exigible.
7. Pagos parciales permanecen visibles.

### 6.6 Rectificación

1. Se crea una nueva versión desde una finalizada.
2. Se fija nuevo cutoff y se recalculan entradas; no se copian totales.
3. El sistema muestra delta por renglón contra la versión anterior.
4. Se exige motivo y evidencia.
5. Repite maker-checker y finalización.
6. Presentación y pago rectificativos se registran por separado.
7. La versión anterior queda SUPERSEDED, consultable e inmutable.

### 6.7 Gasto de gestión sin respaldo fiscal

1. Cliente o estudio aporta imagen/recibo y datos mínimos.
2. Se registra como ManagementExpense en estado PENDING_REVIEW.
3. Se categoriza para rentabilidad y se marca su efecto devengado y/o de caja.
4. Por defecto, taxTreatment es MANAGEMENT_ONLY.
5. Para usarlo fiscalmente, el profesional debe crear una decisión de tratamiento que cite regla vigente, explique razonabilidad y adjunte evidencia.
6. La decisión genera un TaxAdjustment trazable y requiere revisión independiente.

La interfaz evita términos que puedan sugerir ocultamiento. Distingue gasto con respaldo fiscal, gasto de gestión y ajuste fiscal aprobado.

### 6.8 Pedido documental

1. El preparador crea un pedido ligado a cliente, obligación, período e ítems.
2. El portal recibe un mensaje claro y fecha objetivo.
3. El cliente sube el archivo dentro del ítem.
4. El estudio acepta, observa o rechaza con motivo.
5. El estado del pedido se deriva de sus ítems.
6. Al completar, la cobertura de la liquidación se actualiza.

Estados unificados:

- Pedido: DRAFT, SENT, IN_PROGRESS, READY_FOR_REVIEW, COMPLETED, CANCELLED.
- Ítem: PENDING, ATTACHED, ACCEPTED, REJECTED, WAIVED.

---

## 7. Modelo de dominio objetivo

### 7.1 Convenciones

- UUID para identificadores.
- firmId y clientId obligatorios en toda entidad del cliente.
- claves foráneas compuestas que impidan relaciones entre tenants.
- FORCE ROW LEVEL SECURITY en tablas multi-tenant.
- montos y tasas en Decimal de precisión explícita; API como string.
- fechas fiscales como LocalDate; instantes de auditoría en UTC.
- currency en ISO 4217.
- período definido por startDate y endDate, no por etiqueta libre.
- version entero y optimistic locking en agregados editables.
- createdBy, updatedBy, reason y auditEvent en mutaciones sensibles.
- inmutabilidad SQL para hechos aprobados, reglas activas y liquidaciones finalizadas.

### 7.2 Maestros y perfil fiscal

| Entidad                | Propósito                                    | Invariantes                             |
| ---------------------- | -------------------------------------------- | --------------------------------------- |
| Jurisdiction           | Nación, provincia o municipio y jerarquía    | Código estable, vigencia y padre válido |
| TaxAuthority           | ARCA, COMARB, DGR Tucumán, SMT               | Vinculada a jurisdicción                |
| TaxType                | IVA, Monotributo, IIBB, TEM                  | Código estable                          |
| TaxRegime              | RI, Monotributo, local, CM artículo 2        | Compatible con tipo y jurisdicción      |
| TaxpayerProfileVersion | Identidad y condición fiscal en una vigencia | Versionado, no solapado                 |
| TaxRegistration        | Alta/baja por impuesto y régimen             | No solapar regímenes incompatibles      |
| EconomicActivity       | Actividad y código oficial                   | Fuente y vigencia                       |
| ClientActivity         | Actividad del cliente por jurisdicción       | Principal/secundaria y vigencia         |
| ProfessionalCredential | Matrícula del aprobador fiscal               | Jurisdicción, número y vigencia         |
| TaxPeriod              | Período fiscal concreto                      | Único por cliente, impuesto y fechas    |

TaxpayerProfileVersion incluye como mínimo:

- razón social y CUIT normalizado;
- tipo de persona;
- condición nacional;
- domicilio fiscal;
- cierre de ejercicio cuando aplique;
- fecha desde/hasta;
- fuente y actor;
- estado DRAFT, IN_REVIEW, ACTIVE o SUPERSEDED.

### 7.3 Reglas fiscales

| Entidad         | Propósito                                              |
| --------------- | ------------------------------------------------------ |
| TaxRulePack     | Agrupa una implementación fiscal desplegable           |
| TaxRuleVersion  | Snapshot de reglas con vigencia y hash                 |
| TaxRateRule     | Alícuota por actividad, concepto, jurisdicción y rango |
| TaxMinimumRule  | Mínimo fijo o condicional                              |
| TaxBracketRule  | Escalas, topes y categorías                            |
| DueDateRule     | Vencimiento por período y terminación de CUIT          |
| Holiday         | Ajustes de calendario                                  |
| RoundingRule    | Precisión y modalidad por concepto                     |
| NormativeSource | URL, autoridad, fecha, archivo y checksum              |
| RuleApproval    | Aprobación profesional y resultado de golden tests     |

Estados de regla:

DRAFT → IN_REVIEW → APPROVED → ACTIVE → RETIRED

Una versión APPROVED o ACTIVE no se edita. Corregirla crea una versión nueva. Una liquidación referencia los IDs y hashes exactos utilizados.

### 7.4 Ingestión y hechos fiscales

| Entidad                | Propósito                                           |
| ---------------------- | --------------------------------------------------- |
| ImportBatch            | Lote, origen, archivo, adaptador, período y totales |
| ImportRow              | Fila cruda, normalizada, errores y estado           |
| ImportAdapterVersion   | Formato soportado y fixtures                        |
| Document               | Evidencia original inmutable                        |
| DocumentExtraction     | Propuesta OCR/IA versionada                         |
| FiscalVoucher          | Comprobante normalizado aprobado                    |
| FiscalVoucherLine      | Ítems o agrupaciones económicas                     |
| FiscalComponent        | Neto, IVA, exento, no gravado u otro tributo        |
| WithholdingCertificate | Retención sufrida o practicada                      |
| PerceptionCertificate  | Percepción sufrida o practicada                     |
| TaxAdjustment          | Ajuste manual con regla, motivo y evidencia         |
| EvidenceLink           | Relación campo/renglón con archivo, fila o fuente   |

FiscalVoucher debe registrar:

- dirección PURCHASE o SALE;
- tipo, letra, punto de venta y número;
- emisor, receptor y CUIT;
- fecha de emisión, contabilización y servicio cuando corresponda;
- moneda, tipo de cambio y fuente;
- total;
- componentes por base, alícuota e impuesto;
- conceptos exentos y no gravados;
- otros tributos;
- vínculo al documento y/o fila oficial;
- estado, versión y hash;
- flags de duplicado y conflicto.

Clave de duplicidad fiscal cuando aplique:

firmId + clientId + dirección + CUIT contraparte + tipo + punto de venta + número

Para tickets sin numeración suficiente se usa fingerprint secundario, pero nunca se fusiona automáticamente sin revisión.

### 7.5 Gastos gerenciales

| Entidad              | Propósito                                 |
| -------------------- | ----------------------------------------- |
| ManagementExpense    | Gasto económico con o sin respaldo fiscal |
| ExpenseEvidence      | Archivo, recibo o nota                    |
| TaxTreatmentDecision | Decisión profesional sobre computabilidad |
| CashMovementLink     | Fecha e importe efectivamente pagado      |

Estados:

DRAFT → PENDING_REVIEW → APPROVED → REJECTED → SUPERSEDED

Tratamientos:

- MANAGEMENT_ONLY
- FISCAL_COMPUTABLE
- FISCAL_NON_COMPUTABLE
- PENDING_PROFESSIONAL_DECISION

FISCAL_COMPUTABLE exige RuleVersion, motivo, evidencia, profesional, revisor distinto y TaxAdjustment derivado.

### 7.6 Obligaciones y liquidaciones

| Entidad               | Propósito                                   |
| --------------------- | ------------------------------------------- |
| ObligationRuleVersion | Cómo se materializa una obligación          |
| TaxObligation         | Obligación cliente/impuesto/período         |
| TaxSettlement         | Cabecera versionada del cálculo             |
| SettlementInput       | Snapshot de cada entrada usada              |
| TaxSettlementLine     | Renglón, fórmula, regla y resultado         |
| TaxDifference         | Control, severidad, estado y resolución     |
| TaxCreditLedgerEntry  | Saldo a favor, anticipo o crédito inmutable |
| TaxCreditAllocation   | Aplicación de crédito a una liquidación     |
| TaxExportArtifact     | Papel de trabajo o archivo oficial          |
| TaxFiling             | Presentación manual y acuse                 |
| TaxPayment            | Pago, compensación o reversa                |
| PaymentAllocation     | Imputación a obligación o saldo             |

Estados de liquidación:

DRAFT → CALCULATED → IN_REVIEW → CHANGES_REQUESTED → CALCULATED  
IN_REVIEW → REVIEWED → FINALIZED → SUPERSEDED

Los jobs tienen estados separados QUEUED, RUNNING, SUCCEEDED y FAILED. Un error técnico no cambia la liquidación a un estado de negocio falso.

Estados derivados de obligación:

- PENDING
- WAITING_INPUTS
- READY_TO_CALCULATE
- IN_REVIEW
- READY_TO_FILE
- FILED
- PARTIALLY_PAID
- PAID
- OVERDUE
- NOT_APPLICABLE

TaxSettlement conserva:

- impuesto, régimen, jurisdicción y período;
- cutoff;
- versión;
- engineVersion;
- rulesHash;
- inputHash y outputHash;
- totales;
- preparador y revisor;
- diferencias;
- versión reemplazada;
- timestamps de transición.

### 7.7 Rentabilidad

ProfitabilitySnapshot debe ser reproducible y conservar:

- cliente, mes, base DEVENGADO o CAJA;
- cutoff;
- ventas;
- gastos fiscales;
- gastos gerenciales;
- impuestos económicos;
- pagos de impuestos;
- posición IVA informativa;
- resultado antes de impuestos;
- resultado o flujo luego de impuestos;
- IDs de entradas;
- fórmula y versión;
- fecha de publicación.

Publicar crea snapshot inmutable. Cambiar una entrada genera nueva versión y no altera lo que el portal ya descargó.

---

## 8. Rule packs iniciales

Se implementan como paquetes versionados y activables por feature flag server-side:

| Código               | Alcance                                          |
| -------------------- | ------------------------------------------------ |
| AR_VAT_RI_V1         | IVA para responsables inscriptos                 |
| AR_MONOTRIBUTO_V1    | Categoría, cuota, vencimiento y recategorización |
| AR_IIBB_TUC_LOCAL_V1 | IIBB contribuyente local Tucumán                 |
| AR_IIBB_CM_ART2_V1   | CM03 artículo 2 sin regímenes especiales         |
| AR_TEM_SMT_V1        | TEM San Miguel de Tucumán                        |

### 8.1 Proceso de alta de una regla

1. Un responsable incorpora fuente oficial y snapshot.
2. Modela vigencia, jurisdicción, condición y fórmula.
3. Define ejemplos y casos borde.
4. Implementa o actualiza el motor puro.
5. Agrega golden tests con resultados esperados.
6. Otro desarrollador revisa código y datos.
7. Un contador matriculado verifica fuente, alcance y resultados.
8. El sistema calcula hashes.
9. La versión se aprueba.
10. Se activa para un conjunto piloto.

Ningún usuario administrativo puede editar una alícuota directamente en producción.

### 8.2 Revalidación

- antes del comienzo de cada vigencia;
- cuando la autoridad publica un cambio;
- cuando cambia un formato de importación;
- cuando un golden test difiere;
- ante una rectificativa causada por regla;
- como control programado aunque no haya aviso externo.

---

## 9. Motores deterministas

Se creará packages/tax-engine como biblioteca pura, sin Prisma, HTTP, reloj global ni llamadas externas.

Entrada común:

- perfil fiscal y registro vigentes;
- período y cutoff explícitos;
- hechos aprobados;
- saldos y créditos;
- rule versions;
- parámetros de redondeo;
- engineVersion.

Salida común:

- renglones tipados;
- subtotales y total;
- advertencias;
- bloqueos;
- conciliaciones;
- trazas de fórmula;
- inputHash y outputHash.

El mismo conjunto de entrada debe producir exactamente la misma salida.

### 9.1 IVA responsable inscripto

Debe contemplar, según regla vigente y caso:

- ventas y compras del período;
- bases por alícuota;
- débito y crédito fiscal;
- notas de crédito y débito;
- exentos y no gravados;
- prorrateo cuando corresponda;
- ajustes;
- retenciones y percepciones;
- saldos técnicos y de libre disponibilidad diferenciados;
- saldos anteriores y aplicaciones;
- moneda extranjera y fuente de tipo de cambio;
- período sin movimientos;
- comparación con importaciones oficiales;
- diferencias entre hechos y fuente de conciliación.

El motor jamás toma todas las líneas del mayor. Filtra por cliente, impuesto, período, cutoff, aprobación y versión.

### 9.2 Monotributo

Debe contemplar:

- categoría y vigencia;
- parámetros oficiales versionados;
- cuota aplicable y componentes;
- vencimiento;
- pagos y deuda;
- ventanas de recategorización;
- alertas por parámetros cargados;
- historial de categoría.

No inventa categoría. Una sugerencia de recategorización queda pendiente de decisión profesional.

### 9.3 IIBB Tucumán local

Debe contemplar:

- actividad y nomenclador vigente;
- base imponible por actividad;
- alícuota;
- mínimos;
- retenciones, percepciones, recaudaciones bancarias y otros créditos admitidos;
- saldo anterior;
- ajustes;
- total a ingresar o saldo;
- vencimiento.

Todo concepto depende de la versión aprobada; este documento no fija una fórmula legal permanente.

### 9.4 Convenio Multilateral CM03 artículo 2

Debe contemplar:

- base país;
- coeficiente unificado versionado;
- distribución por jurisdicción;
- actividades;
- ajustes;
- retenciones y percepciones por jurisdicción;
- saldos anteriores;
- control de suma de coeficientes;
- diferencias de redondeo;
- exportación/papel de trabajo compatible con el proceso manual.

Quedan bloqueados los regímenes especiales hasta tener su propio rule pack.

### 9.5 TEM San Miguel de Tucumán

Debe contemplar:

- actividad y régimen;
- base imponible;
- alícuota y mínimo vigente;
- excepciones configuradas;
- retenciones y percepciones;
- saldo anterior;
- período y vencimiento;
- papel de trabajo para carga manual.

### 9.6 Diferencias

Cada control tiene severidad:

- INFO: explicación sin acción;
- WARNING: requiere revisión;
- BLOCKING: impide enviar a revisión o finalizar.

Resolver una diferencia exige actor, fecha, decisión, comentario y evidencia. Nunca se elimina del historial.

---

## 10. API y contratos

### 10.1 Fuente de verdad

Los esquemas Zod de packages/contracts serán la fuente de requests y responses. De ellos se generará:

- OpenAPI 3.1;
- cliente TypeScript para apps/web;
- validadores de rutas;
- fixtures contractuales.

El CI falla si una ruta no está documentada, si el cliente generado tiene drift o si una respuesta no cumple el contrato.

### 10.2 Convenciones

- prefijo /api/v1;
- scope /firms/:firmId/clients/:clientId;
- importes y tasas como string decimal;
- fechas civiles ISO YYYY-MM-DD;
- instantes ISO UTC;
- Idempotency-Key obligatorio en creaciones y transiciones;
- ETag y If-Match para edición concurrente;
- traceId en todos los errores;
- paginación cursor-based;
- filtros de período obligatorios en consultas fiscales;
- recibo persistente para mutaciones;
- 409 para transición o versión en conflicto;
- 422 para datos válidos sintácticamente pero bloqueados por dominio.

Envelope de error:

- code estable;
- message en español;
- fieldErrors opcional;
- traceId;
- retryable;
- details saneado.

### 10.3 Endpoints objetivo

**Perfil fiscal**

- GET y POST /tax-profile-versions
- POST /tax-profile-versions/:id/submit-review
- POST /tax-profile-versions/:id/activate
- GET y POST /tax-registrations
- GET y POST /activities
- GET /available-obligations

**Reglas**

- GET y POST /tax-rule-packs
- GET y POST /tax-rule-versions
- POST /tax-rule-versions/:id/submit-review
- POST /tax-rule-versions/:id/approve
- POST /tax-rule-versions/:id/activate
- GET /tax-rule-versions/:id/sources
- GET /tax-rule-versions/:id/golden-results

**Ingestión**

- POST /import-batches
- POST /import-batches/:id/upload
- POST /import-batches/:id/validate
- POST /import-batches/:id/commit
- GET /import-batches/:id/rows
- GET y POST /vouchers
- POST /vouchers/:id/submit-review
- POST /vouchers/:id/approve
- POST /vouchers/:id/reject
- GET y POST /withholdings
- GET y POST /perceptions
- GET y POST /management-expenses
- POST /management-expenses/:id/approve-treatment

**Liquidaciones**

- GET y POST /tax-settlements
- POST /tax-settlements/:id/calculate
- GET /tax-settlements/:id/coverage
- GET /tax-settlements/:id/lines
- GET /tax-settlements/:id/differences
- POST /tax-settlements/:id/submit-review
- POST /tax-settlements/:id/request-changes
- POST /tax-settlements/:id/review
- POST /tax-settlements/:id/finalize
- POST /tax-settlements/:id/rectify
- POST /tax-settlements/:id/artifacts
- GET /tax-settlements/:id/timeline

**Cumplimiento**

- GET /tax-obligations
- POST /tax-obligations/:id/filings
- POST /tax-obligations/:id/payments
- POST /tax-payments/:id/reverse
- GET /tax-credit-ledger
- POST /tax-credit-allocations

**Operación**

- GET /portfolio/tax-worklist
- GET /profitability
- POST /profitability/:period/publish
- endpoints de pedidos documentales ligados a obligationId y requestItemId;
- endpoints de portal limitados a recursos publicados.

### 10.4 Jobs y eventos

Los cálculos grandes, importaciones, OCR y exports devuelven 202 con jobId y receiptId.

El outbox debe:

- reservar con lease;
- recuperar PROCESSING vencidos;
- reintentar con backoff;
- mover a dead letter tras el máximo;
- marcar PUBLISHED sólo después del éxito downstream;
- usar clave de idempotencia en consumidor;
- emitir métricas de edad, reintentos y fallos;
- evitar secretos o tokens en payload.

SSE o polling muestran progreso real sin usar puntos suspensivos como único feedback.

---

## 11. Arquitectura técnica

### 11.1 Componentes

| Componente           | Responsabilidad                                              |
| -------------------- | ------------------------------------------------------------ |
| apps/web             | Producto del estudio y portal                                |
| apps/api             | Auth, tenancy, workflows, persistencia y contratos HTTP      |
| apps/worker          | Imports, calendarios, reminders, artifacts y outbox          |
| services/ai          | OCR/extracción como propuesta, nunca cálculo ni autorización |
| packages/tax-engine  | Motores deterministas                                        |
| packages/contracts   | Schemas, OpenAPI y cliente                                   |
| packages/permissions | Capacidades y resolución                                     |
| packages/storage     | Evidencia y objetos                                          |
| PostgreSQL           | Fuente de verdad transaccional                               |
| Valkey/BullMQ        | Trabajo asíncrono recuperable                                |
| MinIO                | Originales, fuentes normativas y artefactos                  |

### 11.2 Límites

- services/ai no escribe resultados fiscales finalizados.
- apps/web no duplica fórmulas.
- las rutas HTTP no contienen reglas tributarias.
- Prisma no es la única defensa de estados; PostgreSQL impone invariantes críticas.
- el mayor contable no es la fuente exclusiva de comprobantes o impuestos.
- los exports se generan desde snapshots finalizados.
- un feature flag fiscal se evalúa en API además de UI.

### 11.3 Base de datos

Como no existen datos productivos, se reemplazará el baseline demo:

1. preservar sólo migraciones necesarias para auth, tenancy y almacenamiento;
2. consolidar un nuevo baseline fiscal coherente;
3. eliminar seeds que simulan IVA contabilizando el total de ventas como débito fiscal;
4. crear seed de demostración explícito con casos fiscalmente consistentes;
5. probar migrate deploy desde base vacía;
6. probar roles owner, migrator, runtime, worker y readonly;
7. documentar reset de desarrollo;
8. una vez iniciado el piloto, adoptar migraciones exclusivamente forward-only.

Todas las tablas del cliente tendrán RLS, grants explícitos e índices por firmId, clientId, periodId y estado.

### 11.4 Seguridad

- aislamiento RLS probado con dos firmas y dos clientes;
- menor privilegio para runtime y worker;
- URLs firmadas de corta duración;
- originales y acuses inmutables;
- escaneo antivirus;
- checksum de archivos;
- redacción de datos sensibles en logs;
- no registrar contenido de comprobantes en telemetría;
- MFA obligatorio para aprobación profesional y operaciones administrativas sensibles;
- reautenticación para activar reglas, finalizar, rectificar o revertir pagos;
- tokens de invitación hasheados, nunca en outbox en texto plano;
- rate limit por identidad y tenant;
- backups cifrados y restauración ensayada.

### 11.5 Observabilidad

Métricas mínimas:

- jobs pendientes, edad y dead letters;
- importaciones por formato y tasa de error;
- OCR por tipo, confianza y corrección humana;
- liquidaciones por estado y tiempo en estado;
- diferencias bloqueantes;
- vencimientos próximos y vencidos;
- reglas próximas a expirar;
- errores por endpoint y traceId;
- latencia de worklist y cálculo;
- fallos RLS/capacidad;
- presentación y pago incompletos.

Alertas:

- outbox atascado;
- worker sin heartbeat;
- backup o restore-check fallido;
- regla activa sin fuente accesible;
- vencimiento sin obligación materializada;
- liquidación finalizada sin artifact;
- FILED sin acuse o PAID sin asignación completa;
- aumento de 422/409 o errores de importador.

---

## 12. Plan de implementación por puertas

No se trabajará por capas horizontales que dejen todas las pantallas a medias. Cada puerta entrega una capacidad vertical y no expone la siguiente hasta cumplir aceptación.

Cada puerta es binaria: PASS o FAIL. Compilar, renderizar o funcionar sólo con seed/mocks no equivale a PASS. Una excepción exige dueño, riesgo aceptado, vencimiento y feature flag apagado por defecto.

La evidencia de cada puerta debe guardar:

- commit SHA y tag;
- URL y resultado de CI;
- versión de migración y dataset;
- comandos ejecutados;
- JUnit, coverage, E2E y reportes de seguridad;
- hashes de exports relevantes;
- aprobaciones técnica, funcional, fiscal y de seguridad aplicables.

### Puerta 0 — Contención y verdad operativa

**Objetivo:** impedir resultados engañosos y hacer confiable el entorno de desarrollo/CI.

Trabajo:

- G0-01: bloquear endpoints de cálculo/finalización IVA legacy mediante flag server-side;
- G0-02: retirar creación automática de asientos desde StudyBandeja;
- G0-03: ocultar rutas Contabilidad, Reportes genéricos, BI y Asistente;
- G0-04: unificar enums de pedidos y cierres entre DB, API, contratos y UI;
- G0-05: corregir capacidades de obligation-instances y portal READONLY;
- G0-06: corregir grants de outbox_events y relaciones Prisma implícitas;
- G0-07: agregar lease, retry, reclaim y dead-letter al outbox;
- G0-08: arrancar PostgreSQL, Valkey y almacenamiento en CI;
- G0-09: eliminar skipIf de suites DB y fallar si una suite se omite;
- G0-10: marcar y aislar los datos demo.
- G0-11: recuperar o inicializar correctamente el repositorio Git y asociarlo a su origen antes de generar evidencia de release.

Puerta de salida:

- ninguna UI permite obtener o finalizar el IVA legacy;
- suite CI levanta infraestructura real y ejecuta migraciones;
- pruebas con contable_runtime completan auth, RLS, upload y outbox;
- estados compartidos tienen una sola definición;
- no hay acción visible que devuelva éxito sin cambio persistido.
- existe SHA/tag reproducible para todos los artefactos del gate.

### Puerta 1 — Fundación fiscal y contratos

**Objetivo:** crear el vocabulario y las invariantes sobre las que se construyen todos los impuestos.

Trabajo:

- G1-01: nuevo baseline Prisma y RLS;
- G1-02: modelos de jurisdicción, autoridad, impuesto y régimen;
- G1-03: perfil fiscal, inscripción, actividad y matrícula profesional;
- G1-04: tax periods y obligación materializada;
- G1-05: rule packs, fuentes, vigencias, aprobación y hashes;
- G1-06: packages/tax-engine con decimal, hashing y trazas;
- G1-07: contratos Zod, OpenAPI 3.1 y cliente generado;
- G1-08: capabilities fiscales y auditoría;
- G1-09: UI de onboarding fiscal;
- G1-10: calendario determinista y feriados versionados.

Puerta de salida:

- un cliente RI y uno monotributista completan onboarding;
- se rechazan registros incompatibles o solapados;
- una regla aprobada es inmutable y reproducible;
- ningún endpoint fiscal carece de capability y contrato;
- las obligaciones se derivan sin carga manual de fechas libres;
- el profesional firma una versión usando matrícula vigente.

### Puerta 2 — Ingestión y subledger fiscal

**Objetivo:** convertir archivos y evidencia en hechos fiscales aprobados.

Trabajo:

- G2-01: ImportBatch, ImportRow y adaptadores versionados;
- G2-02: primer adaptador ARCA para compras/ventas;
- G2-03: adaptador de retenciones/percepciones;
- G2-04: FiscalVoucher, líneas y componentes;
- G2-05: deduplicación y reconciliación de fuentes;
- G2-06: estación documental con preview y evidencia por campo;
- G2-07: requestItemId obligatorio al responder pedidos;
- G2-08: ManagementExpense y tratamiento profesional;
- G2-09: revisión independiente de hechos;
- G2-10: importación atómica, idempotente y reanudable.

Puerta de salida:

- un lote válido se importa, revisa y reproduce;
- un lote inválido muestra errores por fila sin commit parcial oculto;
- reintentar no duplica;
- cada componente aprobado llega a su archivo o fila fuente;
- OCR nunca supera silenciosamente un valor oficial;
- un gasto gerencial afecta rentabilidad pero no impuesto por defecto.

### Puerta 3 — Vertical IVA completa

**Objetivo:** completar el primer ciclo tributario real antes de habilitar otros.

Trabajo:

- G3-01: AR_VAT_RI_V1 aprobado;
- G3-02: motor IVA puro;
- G3-03: cobertura, cálculo, diferencias y conciliación;
- G3-04: workflow maker-checker;
- G3-05: finalización e inmutabilidad SQL;
- G3-06: papel de trabajo y export;
- G3-07: presentación manual y acuse;
- G3-08: pago, compensación y saldo;
- G3-09: rectificativa con delta;
- G3-10: pantalla de liquidación y worklist;
- G3-11: portal de resultado publicado;
- G3-12: E2E RI completo.

Puerta de salida:

- golden cases validados por contador coinciden al centavo;
- filtro de período y cutoff está probado;
- mismo input/rules/engine produce mismo hash;
- no finaliza con bloqueos ni sin revisor distinto;
- finalizados no se modifican ni con acceso SQL runtime;
- export, acuse, pagos y saldos tienen drill-down;
- el flujo completo funciona en desktop y portal móvil;
- IVA se habilita sólo para clientes piloto.

### Puerta 4 — IIBB, TEM y monotributo

**Objetivo:** ampliar sobre la misma arquitectura sin crear módulos paralelos.

Orden interno:

1. IIBB Tucumán local.
2. TEM San Miguel de Tucumán.
3. Convenio Multilateral CM03 artículo 2.
4. Monotributo.

Trabajo por cada rule pack:

- fuente y snapshot oficial;
- adaptadores necesarios;
- reglas y motor;
- golden tests;
- pantallas reutilizando TaxSettlement;
- export/papel de trabajo;
- presentación y pago;
- revisión profesional;
- feature flag independiente;
- E2E vertical.

Puerta de salida:

- cada impuesto supera individualmente los mismos gates de IVA;
- coeficientes CM se validan y suman según regla;
- regímenes especiales aparecen como NO SOPORTADO, no se calculan parcialmente;
- IIBB y TEM aplican saldos/deducciones sólo en jurisdicción correcta;
- monotributo conserva historial de categoría y no decide recategorización automáticamente.

### Puerta 5 — Rentabilidad y portal operativo

**Objetivo:** entregar valor gerencial sin mezclarlo con el cálculo fiscal.

Trabajo:

- G5-01: ProfitabilitySnapshot devengado;
- G5-02: ProfitabilitySnapshot caja;
- G5-03: separación respaldo fiscal/gestión;
- G5-04: tratamiento de impuestos económicos y efecto de caja;
- G5-05: publicación versionada;
- G5-06: dashboard de cartera por riesgo;
- G5-07: portal con pendientes, impuestos, pagos y rentabilidad;
- G5-08: timeline de comunicación por obligación;
- G5-09: responsive y accesibilidad;
- G5-10: recibos persistentes y recuperación de errores.

Puerta de salida:

- cada subtotal tiene definición y drill-down;
- gestión sin respaldo no modifica una liquidación sin aprobación;
- devengado y caja nunca se mezclan;
- el portal sólo ve snapshots publicados;
- colaborador y Sólo lectura tienen capacidades distintas;
- un cliente completa un pedido desde móvil y ve el recibo.

### Puerta 6 — Piloto y endurecimiento

**Objetivo:** demostrar operación segura con casos representativos antes de ampliar alcance.

Trabajo:

- G6-01: seleccionar clientes piloto RI, monotributo, local y CM;
- G6-02: ejecutar períodos históricos en paralelo con liquidaciones manuales;
- G6-03: registrar diferencias y corregir reglas/importadores;
- G6-04: ensayo de rectificativa, pago parcial y saldo a favor;
- G6-05: restore drill y continuidad;
- G6-06: prueba de carga con cartera y documentos representativos;
- G6-07: revisión de seguridad y privacidad;
- G6-08: capacitación y runbooks;
- G6-09: sign-off fiscal, técnico y operativo;
- G6-10: activar progresivamente por firma/cliente/impuesto.

Puerta de salida:

- tres períodos consecutivos por régimen coinciden con el control profesional o tienen diferencias explicadas y aceptadas;
- no existen incidentes P0/P1 abiertos;
- restore verificado;
- observabilidad y soporte tienen dueño;
- rollback de feature flag ensayado;
- cada flujo tiene runbook y evidencia de sign-off.

---

## 13. Estrategia de pruebas

### 13.1 CI obligatorio

El workflow debe iniciar:

- PostgreSQL;
- roles migrator, runtime y worker;
- Valkey;
- MinIO;
- ClamAV o sustituto controlado del mismo contrato.

Se crearán scripts canónicos:

- ci:static
- test:unit
- test:db
- test:contract
- test:e2e
- test:security
- test:performance
- test:recovery

Cada script falla si su dependencia no está disponible. skip, todo, skipIf o una suite con cero assertions cuentan como FAIL en CI.

Orden:

1. instalar;
2. validar Prisma;
3. aplicar migraciones;
4. verificar grants y RLS;
5. lint;
6. typecheck;
7. unit tests;
8. integration tests;
9. build;
10. E2E crítico.

No se permiten describe.skipIf por ausencia de DB. Si la dependencia no inicia, el job falla.

### 13.2 Unitarias y propiedades

- decimales y redondeos;
- período/cutoff;
- state machines;
- fórmulas puras por rule pack;
- hashing determinista;
- asignación de saldos y pagos;
- invariantes de coeficientes;
- idempotencia;
- no duplicidad;
- generación de vencimientos;
- permisos.

Property tests:

- mismo input produce misma salida;
- el total es igual a suma de líneas después de redondeo;
- ninguna entrada fuera del período afecta el resultado;
- asignaciones no superan el saldo disponible;
- una rectificativa no modifica la versión anterior;
- una operación de otro tenant nunca cambia el resultado.

### 13.3 Golden tests fiscales

Cada caso incluye:

- perfil;
- período;
- hechos;
- reglas y fuentes;
- cálculo esperado por renglón;
- criterio de redondeo;
- firma del profesional;
- checksum.

Casos mínimos IVA:

- múltiples alícuotas;
- nota de crédito;
- exento y no gravado;
- compra posterior al cutoff;
- comprobante de otro período;
- prorrateo;
- retenciones y percepciones;
- saldo anterior;
- moneda extranjera;
- sin movimientos;
- rectificativa;
- dos ejecuciones idénticas.

Casos mínimos IIBB/TEM:

- múltiples actividades;
- mínimo versus cálculo por alícuota;
- retención, percepción y recaudación;
- saldo a favor;
- crédito insuficiente;
- cambio de regla entre vigencias;
- período sin actividad.

Casos mínimos CM:

- varias jurisdicciones;
- coeficiente válido;
- coeficiente inválido;
- redondeo de distribución;
- deducciones por jurisdicción;
- actividad fuera de alcance;
- régimen especial bloqueado.

Casos mínimos monotributo:

- cambio de categoría por vigencia;
- cuota mensual;
- pago parcial;
- recategorización pendiente;
- parámetro fuera de rango;
- vencimiento.

### 13.4 Integración

- perfil → obligación;
- importación → voucher;
- documento/OCR → revisión;
- voucher → settlement;
- calculation job → receipt;
- review → finalize;
- finalize → artifact;
- filing → payment → allocation;
- rectification;
- management expense → profitability;
- pedido portal → documento → cobertura;
- outbox → worker → estado final;
- caída y reanudación de worker;
- dos solicitudes concurrentes con misma idempotency key.

Las pruebas usan el rol contable_runtime, no el propietario de PostgreSQL.

### 13.5 Seguridad

- firma A no lee/escribe firma B;
- cliente A no puede enlazar período, archivo o regla de cliente B;
- portal no accede a endpoints del estudio;
- Sólo lectura no carga ni mensajea;
- preparador no revisa ni finaliza;
- regla no activa no se aplica;
- finalized no admite UPDATE/DELETE;
- archivo no validado no se procesa;
- token de invitación no aparece en DB/log/outbox en claro;
- IDOR devuelve respuesta indistinguible;
- CSRF, rate limit y sesión revocada.

### 13.6 E2E

Escenarios obligatorios:

1. Owner crea y asigna cliente.
2. Profesional activa perfil fiscal.
3. Preparador importa compras/ventas.
4. Revisor aprueba hechos.
5. Preparador calcula IVA.
6. Revisor pide cambio y luego aprueba.
7. Profesional finaliza.
8. Operador registra presentación y pago parcial/completo.
9. Cliente ve publicación en portal.
10. Cliente responde pedido desde móvil.
11. Estudio rectifica sin perder historia.
12. Rentabilidad muestra devengado y caja con gasto gerencial.

Cada escenario se ejecuta al menos con dos usuarios del estudio y uno del portal. El suite móvil usa viewport realista y nombres accesibles estables.

### 13.7 Calidad de interfaz

- axe o equivalente sin violaciones serias en rutas críticas;
- snapshots visuales desktop y móvil;
- loading/error/empty/conflict/success probados;
- tabulación completa;
- targets táctiles;
- strings largos y montos grandes;
- zona horaria America/Argentina/Tucuman;
- conexión lenta y reintento;
- ninguna confirmación destructiva se omite.

### 13.8 Rendimiento inicial

Objetivos de piloto:

- worklist p95 menor a 2 segundos con 300 clientes;
- apertura de liquidación p95 menor a 2 segundos sin artifacts pesados;
- importación de 10.000 filas como job, con progreso y sin bloquear API;
- cálculo de 10.000 hechos en menos de 30 segundos como job;
- paginación obligatoria sobre colecciones;
- cero consultas sin límite en endpoints de lista.

Los objetivos se verifican con datos sintéticos representativos antes de la Puerta 6.

---

## 14. Migración y retiro de la implementación actual

### 14.1 Estrategia

Como el entorno contiene sólo datos demo, no se hará una migración compleja del modelo fiscal incorrecto.

- exportar sólo usuarios, firmas y asignaciones si fueran necesarios;
- resetear datos fiscales, contables demo, reportes y obligaciones actuales;
- crear baseline nuevo;
- conservar originales de prueba sólo si están marcados como demo;
- sembrar casos consistentes por régimen;
- invalidar feature flags legacy;
- retirar modelos VatRule/VatLiquidation antiguos al quedar reemplazados;
- retirar rutas legacy cuando el frontend ya consuma contratos nuevos.

### 14.2 Tabla de reemplazo

| Actual                         | Reemplazo                                     |
| ------------------------------ | --------------------------------------------- |
| ClientProfile genérico         | TaxpayerProfileVersion + TaxRegistration      |
| VatRule                        | TaxRulePack + TaxRuleVersion + reglas tipadas |
| VatLiquidation                 | TaxSettlement versionado                      |
| Obligation manual              | ObligationRuleVersion + TaxObligation         |
| asiento desde total extraído   | FiscalVoucher + componentes revisados         |
| CloseCycle genérico            | ciclo derivado del estado de la obligación    |
| ReportRun contable             | ProfitabilitySnapshot                         |
| dashboard de métricas          | TaxWorklist                                   |
| selector de período decorativo | TaxPeriod obligatorio en contrato             |

### 14.3 Compatibilidad

No se mantiene compatibilidad funcional con un cálculo incorrecto. Durante una transición corta, las rutas legacy pueden responder 410 Gone con código TAX_LEGACY_DISABLED y enlace interno al nuevo flujo.

---

## 15. Operación, publicación y rollout

### 15.1 Feature flags

Flags por:

- firma;
- cliente;
- impuesto;
- rule pack;
- lectura versus mutación.

El backend es autoridad. La UI sólo refleja la decisión.

### 15.2 Activación

Orden:

1. equipo interno;
2. firma piloto;
3. clientes seleccionados;
4. impuesto individual;
5. período histórico;
6. período corriente supervisado;
7. ampliación gradual.

Un impuesto puede apagarse sin ocultar resultados finalizados ni evidencia.

### 15.3 Soporte

Runbooks mínimos:

- importación rechazada;
- OCR detenido;
- outbox atascado;
- regla incorrecta;
- cálculo no reproducible;
- vencimiento faltante;
- artifact fallido;
- presentación o pago mal registrado;
- rectificación;
- sospecha de fuga de tenant;
- restore.

### 15.4 Indicadores de adopción y calidad

- porcentaje de clientes con perfil activo;
- cobertura de entradas antes de calcular;
- porcentaje de liquidaciones sin planilla paralela;
- tiempo desde entradas completas hasta finalización;
- diferencias por causa;
- rectificativas por error de regla/dato/operación;
- porcentaje presentado y pagado a tiempo;
- correcciones OCR;
- tareas devueltas por revisión;
- uso de portal en pedidos;
- incidentes por severidad.

No se optimiza velocidad sacrificando tasa de diferencias o rectificativas.

---

## 16. Riesgos y mitigaciones

| Riesgo                          | Impacto                       | Mitigación                                                              |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Cambio normativo                | Cálculo incorrecto            | Reglas versionadas, monitoreo, vigencia, fuente y activación controlada |
| Fuente oficial cambia formato   | Importación rota              | Adaptadores versionados, fixtures y detección explícita                 |
| OCR propone valor erróneo       | Hecho incorrecto              | Oficial prevalece, confianza por campo y revisión                       |
| Exceso de confianza del usuario | Riesgo profesional            | Estados claros, evidencia, maker-checker y disclaimers de borrador      |
| Regla aprobada tarde            | Bloquea vencimientos          | Calendario de revalidación y alertas                                    |
| Scope creep tributario          | Todos los módulos incompletos | Puertas verticales y fuera de alcance explícito                         |
| Regímenes especiales CM         | Resultado incompleto          | Bloquear y mostrar NO SOPORTADO                                         |
| Mezcla gasto fiscal/gerencial   | Reduce impuesto indebidamente | Subledgers separados y aprobación profesional                           |
| Doble procesamiento             | Duplicados o saldos erróneos  | Idempotencia, constraints y consumers idempotentes                      |
| Concurrencia                    | Pérdida de decisión           | ETag/If-Match y 409                                                     |
| Fuga multi-tenant               | Exposición crítica            | RLS forzada, FKs compuestas y pruebas runtime                           |
| Worker caído                    | Jobs estancados               | Lease, reclaim, dead letter y alertas                                   |
| Artifact o acuse perdido        | Falta de evidencia            | Objeto inmutable, checksum y backup                                     |
| Rentabilidad mal interpretada   | Decisión gerencial errónea    | Definiciones, devengado/caja separados y drill-down                     |
| Frontend vuelve a ser ABM       | Bajo valor                    | Worklist por riesgo y E2E tributario como gate                          |
| Workspace sin historial Git     | Releases no reproducibles     | Restaurar origen, exigir SHA/tag y firmar evidencia por commit          |

---

## 17. Definición de terminado

Una capacidad tributaria está terminada sólo si:

- existe dominio persistente, API, UI y autorización;
- su flujo comienza en una necesidad real y termina en resultado persistido;
- no depende de una planilla paralela para completar el cálculo;
- las reglas tienen fuente, vigencia, hash y aprobación profesional;
- el motor tiene golden tests;
- períodos y cutoff están probados;
- el cálculo es reproducible;
- maker-checker está impuesto por servicio y base;
- hay loading, vacío, error, conflicto, progreso y recibo;
- cada importe tiene drill-down;
- finalizados son inmutables;
- rectificación conserva historia;
- presentación y pago tienen evidencia;
- RLS se prueba con runtime;
- E2E desktop y móvil pasa;
- accesibilidad crítica pasa;
- observabilidad y runbook existen;
- la función puede desactivarse sin perder lectura histórica;
- no quedan P0/P1 abiertos;
- un contador matriculado firma el resultado de validación.

Una pantalla no está terminada si sólo muestra una tabla, usa datos demo, no persiste la acción, omite errores, requiere conocer códigos internos o no permite completar el siguiente paso.

---

## 18. Orden exacto de ejecución

1. Ejecutar Puerta 0 completa.
2. Reemplazar baseline y contratos en Puerta 1.
3. Construir onboarding fiscal antes de volver a alta masiva de clientes.
4. Construir importación y FiscalVoucher antes de cualquier motor.
5. Completar IVA de punta a punta.
6. Pilotear IVA histórico y corregir.
7. Reutilizar la arquitectura para IIBB Tucumán.
8. Agregar TEM SMT.
9. Agregar CM03 artículo 2.
10. Agregar monotributo.
11. Completar Rentabilidad y portal.
12. Ejecutar Puerta 6.
13. Sólo entonces evaluar nuevos impuestos o jurisdicciones.

Dependencia crítica:

    Perfil fiscal
      → reglas aprobadas
      → obligación y período
      → fuentes importadas
      → hechos revisados
      → motor determinista
      → revisión
      → finalización
      → exportación
      → presentación
      → pago
      → rentabilidad/publicación

No se permite invertir esta cadena construyendo primero dashboards o pantallas vacías.

---

## 19. Referencias oficiales iniciales

Estas referencias sirven para iniciar el relevamiento. Cada rule pack debe guardar su propia fuente, archivo, fecha de consulta y checksum, y debe revalidarse al activarse.

- ARCA — IVA Simple, especificaciones: https://www.arca.gob.ar/iva/iva-simple/especificaciones-especiales.asp
- ARCA — Resolución General 4597 y modificaciones: https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A4597%7Co%3A3%7Ca%3A2019%7Cf%3A30%2F09%2F2019
- ARCA — Mis Retenciones: https://www.arca.gob.ar/genericos/retenciones.asp
- ARCA — Monotributo, desarrollo de actividad: https://www.arca.gob.ar/monotributo/ayuda/desarrollo-de-la-actividad.asp
- ARCA — Categorías vigentes de monotributo: https://ftp.arca.gob.ar/monotributo/categorias.asp
- ARCA — Parámetros de monotributo: https://arca.gob.ar/monotributo/ayuda/parametros.asp
- COMARB — SIFERE Web y presentación CM03: https://webpreprod.comarb.gob.ar/descargas/faqs/sifere/76_sifere_web_pasos_ddjj.pdf
- DGR Tucumán — nomenclador, padrón y alícuotas: https://extranet.rentastucuman.gov.ar/nomina/rentastuc2/nwbiblioteca/nomenclador.php
- DGR Tucumán — nomenclador vigente publicado: https://www.rentastucuman.gob.ar/nomina/rentastuc2/nwx1ut2pa3lo/nomencladordgr.pdf
- Municipalidad de San Miguel de Tucumán — guía TEM: https://guiadetramites.smt.gob.ar/categoria?sub=166
- Municipalidad de San Miguel de Tucumán — Boletín Oficial Digital: https://smt.gob.ar/nota/boletin-oficial-digital/56

Última revisión documental inicial: 13 de agosto de 2026.

---

## 20. Criterio final de éxito

La reconstrucción será exitosa cuando, para cada régimen habilitado, un estudio pueda cerrar un período desde la recopilación de información hasta el registro del pago, explicar cada número y repetir el resultado, sin abandonar Contable para reconstruir el papel de trabajo.

La aplicación debe reducir trabajo manual repetitivo sin sustituir el criterio profesional. Su promesa no es llevar una contabilidad genérica: es convertir un proceso tributario argentino complejo en un flujo controlado, trazable y operable.
