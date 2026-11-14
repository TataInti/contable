# Hallazgos del recorrido de punta a punta

Registro vivo de inconsistencias encontradas al usar la app como lo haría un contador, tramo por tramo. Cada hallazgo indica cómo se reproduce, la causa y su estado. Se actualiza en el mismo PR que corrige o descubre algo.

Entorno del recorrido: app local (`localhost:5173`), usuario demo Titular, base de desarrollo.

## Tramos del flujo

| # | Tramo | Estado del recorrido |
|---|---|---|
| 1 | Reglas fiscales: ver, crear versión, editar, guardar, eliminar borrador | Recorrido el 13-nov-2026 |
| 2 | Reglas fiscales: activar una versión y su efecto en liquidaciones | Parcial el 13-nov-2026: se probó el rechazo; falta activar una versión válida y ver su efecto |
| 3 | Catálogos fiscales: régimen, familia de cálculo, organismo | Recorrido el 13-nov-2026 (regímenes); faltan las otras cuatro pestañas |
| 4 | Alta de cliente y configuración fiscal (regímenes, actividades, obligaciones) | Recorrido el 13-nov-2026 con el e2e `e2e/alta-cliente-ui.spec.ts`: catálogos → reglas → cliente → perfil, inscripción, actividad, período, obligación → cálculo aceptado por el servidor |
| 5 | Documentos: subir, leer, revisar, aprobar | Parcial el 13-nov-2026: subida, antivirus, carga a mano y aprobación recorridas con el e2e `e2e/alta-y-comprobante-ui.spec.ts`; la lectura automática no se pudo verificar (sin modelo configurado). Ver [relevamiento-alta-y-comprobante.md](relevamiento-alta-y-comprobante.md) |
| 6 | Legajo: saldos, fuentes, clasificación, cálculo, controles, cierre | Recorridas las seis etapas el 13-nov-2026 con un régimen creado desde la pantalla: sin fuentes definidas, el legajo no recibe datos (ver relevamiento-alta-y-comprobante.md) |
| 7 | Liquidación: calcular, enviar a revisión, aprobar, finalizar, rectificar | Pendiente |
| 8 | Presentación ante el organismo y pago (incluye subir el comprobante de presentación: pedido, sin implementar) | Pendiente |
| 9 | Portal del cliente | Pendiente |

## Cadena de requisitos de una liquidación

El único objetivo de la aplicación es liquidar un impuesto a un cliente. Cada eslabón exige que exista el anterior; el servidor lo controla, no sólo la pantalla.

| # | Eslabón | Exige | Control en el servidor | Estado |
|---|---|---|---|---|
| 1 | Régimen | Familia de cálculo activa con al menos un motor | `REGIME_FAMILY_REQUIRED`, `CALC_FAMILY_WITHOUT_ENGINE` al crear y al editar | Aplicado el 13-nov-2026 |
| 2 | Versión de reglas | Motor de la familia del régimen | `ENGINE_FAMILY_MISMATCH` (ya existía) | Vigente |
| 3 | Obligación | Cliente inscripto en el régimen durante el período | `REGISTRATION_REQUIRED` en los dos caminos de alta de obligación | Aplicado el 13-nov-2026 |
| 4 | Liquidación | Cliente inscripto, paquete con versión activa que cubra el período y motor con cálculo implementado | `REGISTRATION_REQUIRED` (nuevo), `NO_ACTIVE_RULES`, `UNSUPPORTED_ENGINE_VERSION` (ya existían) | Aplicado el 13-nov-2026 |
| 5 | Datos anteriores a estas reglas | — | Los regímenes sin familia ya cargados sólo se pueden ocultar; cualquier otra edición exige asignarles familia | Pendiente: listarlos y completarlos en cada entorno |
| 6 | Tipo de impuesto | Familia por defecto | Sin control: un impuesto puede crearse sin familia (el régimen la exige después) | Pendiente de decisión |
| 7 | Inscripción del cliente | Régimen liquidable (con versión de reglas activa) | Sin control | Pendiente |
| 8 | Período fiscal | Inscripción vigente del cliente en un régimen de ese impuesto | Sin control | Pendiente |

Estado medido en la base local antes de aplicar las reglas (datos de demostración y de pruebas): 13 de 18 regímenes sin familia, 16 de 22 obligaciones y 11 de 17 liquidaciones de clientes sin inscripción.

## Hallazgos

### Tramo 1 · Reglas fiscales

| # | Hallazgo | Cómo se reproduce | Causa | Estado |
|---|---|---|---|---|
| 1.1 | Las alícuotas de una versión activa se ven sin forma de editarlas | Abrir Reglas fiscales: el primer paquete es activo; bajar a "Alícuotas y porcentajes" | El botón "Modificar alícuotas" estaba en una línea suelta arriba de la ficha, lejos de la tabla | Corregido: el botón y la explicación de sólo lectura están en la sección de alícuotas |
| 1.2 | "Modificar alícuotas" pide una fecha y, al confirmar, no pasa nada (ver 3.1: la causa de fondo es un régimen sin familia de cálculo) | Paquete activo de un régimen sin motor soportado (por ejemplo `TEM_SMT_TEST_V1`) → Modificar alícuotas → confirmar | La API responde 409 `UNSUPPORTED_TAX_ENGINE_VERSION`, pero el error se mostraba al pie de la página, tapado por el panel | Corregido en la interfaz: el error se muestra dentro del panel. **Pendiente de producto:** un régimen puede tener una versión activa y a la vez no admitir versiones nuevas |
| 1.3 | El panel "Modificar alícuotas" no explica por qué pide sólo una fecha | Abrir el panel | Faltaba decir que es el primer paso y que después se editan los valores | Corregido: texto del panel, botón "Crear borrador y editar", y al crear se lleva al usuario a las alícuotas del borrador |
| 1.4 | La vigencia se muestra un día antes de la fecha cargada | Crear una versión con vigencia 13/11/2026: la ficha y el selector decían 12/11/2026 | La fecha se formateaba en el huso local (UTC-3) en lugar de UTC | Corregido en Reglas fiscales. **Revisar** el mismo patrón en otras pantallas |
| 1.5 | El selector de versión muestra el estado en inglés ("DRAFT") | Paquete con más de una versión | Usaba el valor crudo del estado | Corregido: usa el glosario de estados |
| 1.6 | El campo de alícuota muestra "$" aunque es un porcentaje | Editar un borrador | Reutilizaba el campo de importes | Corregido: muestra "%" |
| 1.7 | El campo de alícuota admitía sólo dos decimales | Cargar 1,125 | El campo numérico cortaba en dos decimales | Corregido: la alícuota admite hasta cuatro decimales (la base guarda seis) |
| 1.8 | La confirmación de "borrador guardado" aparece arriba, fuera de la vista | Guardar un borrador con la página desplazada hacia las alícuotas | El recibo se dibuja al inicio de la página | Pendiente: va con la unificación de avisos (PR #72) |
| 1.9 | El panel de eliminación muestra "DRAFT" en el subtítulo | Eliminar un borrador | Estado crudo | Pendiente |
| 1.10 | "Activar" (verde) y "Eliminar borrador" (rojo sólido) compiten en la ficha del paquete | Seleccionar un borrador | Dos acciones fuertes juntas | Pendiente: la destructiva debería ir a un menú o en estilo discreto |
| 1.11 | Los campos de la tabla se anuncian con un identificador interno ("Alícuota 01a1d52c-…") | Lector de pantalla sobre un borrador | La etiqueta accesible usa el id de la fila | Pendiente: usar el concepto de la fila |
| 1.12 | La línea "Próximo paso: … Editar borrador" sólo desplaza la página | Seleccionar un borrador | Es un atajo de scroll presentado como acción | Pendiente: evaluar quitarla |
| 1.13 | Las reglas ya cargadas muestran "Tipo sin resolver" en la columna nueva "Tipo de regla" | Abrir cualquier paquete activo anterior a la pantalla de reglas tipadas (por ejemplo CM03 Artículo 2 V1) | Las reglas previas no tienen tipo asignado; la pantalla nueva lo muestra como texto técnico | Pendiente: decidir si se migran las reglas existentes o si se muestra un texto que el contador entienda |

### Tramo 2 · Activar una versión de reglas

| # | Hallazgo | Cómo se reproduce | Causa | Estado |
|---|---|---|---|---|
| 2.1 | La confirmación de activar no resume qué se activa | Borrador sin alícuotas ni vencimientos → Activar: el panel muestra sólo la vigencia | Falta el resumen (cantidad de reglas, vencimientos, fuentes) y un aviso cuando está vacío | Pendiente |
| 2.2 | La ficha muestra "Motor 1.0.0" en un paquete cuyo régimen no tiene motores | Paquete "IVA RI B1" → Activar → rechazo "No hay motores fiscales soportados" | La versión guarda un número de motor aunque el régimen no tenga familia de cálculo | Pendiente: es de datos y de validación al crear la versión |

### Tramo 3 · Catálogos fiscales (regímenes)

| # | Hallazgo | Cómo se reproduce | Causa | Estado |
|---|---|---|---|---|
| 3.1 | Un régimen sin familia de cálculo figura como "Activo" y "Coherencia OK" | Regímenes → `TEM_SMT-TEM`: sin familia asignada, pero sin ninguna alerta | El control de coherencia sólo compara organismo y jurisdicción; no mira si el régimen se puede calcular | Corregido en parte: la ficha del régimen muestra "Familia de cálculo" (o "Sin asignar: no se puede calcular") y Reglas fiscales ofrece "Asignar familia de cálculo" en lugar de un botón que falla. **Pendiente:** que cuente como alerta del catálogo |
| 3.2 | La tabla de regímenes no muestra la familia de cálculo ni el motor | Pestaña Regímenes | La columna no existe; a 1280 px la tabla ya tiene scroll horizontal con 8 columnas | Pendiente: revisar qué columnas son necesarias |
| 3.3 | Recuadros verdes para decir que algo está bien | Ficha del régimen ("El organismo corresponde a la jurisdicción") y formulario de edición ("Coherente: …") | Aviso de éxito usado para un estado permanente | Pendiente: pasa a texto con tilde, según la regla de avisos |
| 3.4 | La pestaña muestra dos números sin explicación ("Regímenes 18 2") | Pestañas de Catálogos | El segundo número son alertas | Pendiente |
| 3.5 | (Descartado) Datos de TEM y Monotributo | — | Son datos de demostración, no una definición fiscal | Sin acción |
| 3.6 | "Se usa en 1 lugares" | Ficha de cualquier régimen con un solo uso | Falta el singular | Pendiente |

### Tramo 4 · Alta de cliente y configuración fiscal

| # | Hallazgo | Cómo se reproduce | Causa | Estado |
|---|---|---|---|---|
| 4.1 | Un cliente con liquidación finalizada figuraba sin régimen adherido | Cliente E2E Mono: Liquidaciones muestra una finalizada; Configuración fiscal dice "Sin regímenes adheridos" | El servidor permitía crear obligaciones y liquidar sin inscripción | Corregido en el servidor (eslabones 3 y 4 de la cadena). **Pendiente:** que la pantalla ordene los pasos según esa dependencia |
| 4.2 | Tres botones y tres nombres para lo mismo | Configuración fiscal sin regímenes: "Completar inscripción", "Agregar" y "Registrar inscripción"; el concepto se llama inscripción, adhesión y régimen adherido | Acciones repetidas y vocabulario sin unificar | Pendiente |
| 4.3 | El paso a paso mostraba el texto pegado ("2InscripciónPendiente") | Configuración fiscal | La grilla del botón no alcanzaba al contenido | Corregido |
| 4.4 | El CUIT se mostraba sin guiones en Configuración fiscal y con guiones en Clientes | Comparar ambas pantallas | Cada pantalla formateaba por su cuenta | Corregido: formato compartido |
| 4.5 | El alta permite dejar todo "Sin especificar" y después el cliente figura con "Ficha incompleta" | Alta de cliente → crear sólo con razón social y CUIT | El formulario no indica qué campos hacen falta para que la ficha quede completa | Pendiente |
| 4.6 | "Próximo paso" como título de sección | Configuración fiscal → "Flujo guiado" | Mismo patrón que las franjas | Pendiente: va con el rediseño de la ficha del cliente |
| 4.7 | Los tipos de regla del catálogo no se pueden guardar: "Reglas.0.kindId: Invalid uuid" | Reglas fiscales → borrador → Agregar regla → elegir "Alícuota" → Guardar borrador | La migración sembró los tipos con ids `k1000000-…` (no son UUID) y la ruta de guardado exigía UUID | Corregido en la ruta (acepta el id del catálogo; el servicio valida que exista). **Pendiente:** decidir si se migran los ids a UUID reales; `taxRateRuleSchema` y `createTaxRateRuleSchema` de `packages/contracts` siguen exigiendo UUID para `kindId` |
| 4.8 | Tras guardar un borrador, "Activar" responde "Guardá los cambios del borrador antes de activarlo" | Guardar un borrador nuevo con una regla y pulsar Activar sin recargar | El servidor reemplaza las filas al guardar (ids nuevos) y la pantalla seguía comparando contra las filas locales | Corregido: al guardar se toma lo guardado como borrador de trabajo |
| 4.9 | Después de crear un cliente no queda seleccionado: Configuración fiscal pide "Elegí un cliente" | Clientes → Nuevo cliente → Crear | La pantalla llamaba a `setClientId` con la lista de clientes anterior al refresco de la sesión, y el contexto lo descartaba | Corregido en el contexto: usa siempre la lista más reciente y recuerda el cliente pedido hasta que la sesión lo conoce |
| 4.10 | Al crear el período, el paso guiado salta a Obligaciones pero el panel no se abre | Configuración fiscal → Agregar período → Crear período | El éxito del alta sólo marca el paso y deja el panel cerrado | Pendiente: abrir el panel de obligación con el período recién creado, o decirlo |
| 4.11 | Los datos de prueba del e2e quedan en la base de desarrollo (cliente, jurisdicción, organismo, régimen, actividad, paquete) | Correr `e2e/alta-cliente-ui.spec.ts` | No hay base de pruebas desechable (ver T.2); los códigos llevan un sufijo único por corrida y el cliente además queda con una liquidación calculada | Pendiente: ligado a T.2 |
| 4.12 | Activar el acceso del cliente al portal falla siempre (500) | Invitar al portal → abrir el enlace → completar y enviar | La función SQL `app_accept_portal_invitation` tiene un `ON CONFLICT` ambiguo con sus columnas de retorno (mismo patrón de 20261106000000). Existe en producción | Corregido con la migración `20261114010000_fix_portal_invitation_accept_ambiguity`; **pendiente desplegarla** |
| 4.13 | En un estudio nuevo "Módulos de estudios" sale vacía y el módulo fiscal no se puede habilitar | Estudio sin filas de módulos (producción) | La lista sólo devolvía los módulos con fila | Corregido: la API devuelve todos los módulos conocidos, apagados, y habilitar uno crea la fila |
| 4.14 | El motor de IVA bloquea el cierre por $ 0,02 de diferencia entre neto y bases | Cargar un comprobante cuyo IVA redondeado difiere en un centavo (el ticket real) | La base por alícuota se deriva del IVA ÷ tasa, que amplifica el redondeo; el umbral era de $ 0,02 | Corregido: umbral de $ 0,05 igual al control de libro del legajo, con prueba |
| 4.15 | Aprobar una extracción no actualiza la lista de documentos | Aprobar en Bandeja y abrir Controles del Legajo antes de 30 s | La aprobación sólo invalidaba la extracción | Corregido |
| 4.16 | "Calcular liquidación" desde Liquidaciones mezcla los archivos de todos los impuestos del cliente | Cliente con Ingresos Brutos y TEM cargados el mismo mes: calcular uno falla con `ACTIVITY_RULE_UNRESOLVED` | La consulta de hechos filtra por cliente y fechas, no por impuesto ni fuente (el Legajo sí pasa el alcance) | Pendiente |
| 4.17 | El formulario de presentación ofrece "Sin adjuntar por ahora" y el servidor lo rechaza; el acuse (categoría ACUSE) sólo lo puede subir el cliente por el portal | Legajo → Registrar presentación | Falta el paso de subida del comprobante de presentación por el estudio (pedido ya registrado) | Pendiente |
| 4.18 | El portal muestra el período en formato ISO, el impuesto como "—" y presentación y pago como "—" con el IVA pagado | Portal → Liquidaciones | Formato y campos sin resolver en la lista publicada | Pendiente |
| 4.19 | Los controles de acreditaciones bancarias y de caja bloquean el cierre sin forma de indicar que no aplican | Legajo → Controles | Sólo se pueden resolver con un documento de respaldo | Pendiente |

### Tramo 6 · Legajo, etapa Clasificación (revisión de código, sin recorrer en pantalla)

| # | Hallazgo | Dónde | Causa | Estado |
|---|---|---|---|---|
| 6.1 | La actividad de cada comprobante se escribe a mano | Legajo → Clasificación: campo de texto "Código de actividad" | No se elige de las actividades del cliente ni del catálogo | Pendiente: pasa a ser una selección |
| 6.2 | El rubro de compras tiene dos opciones fijas en el código ("SUPER", "TRANSPORTE") | Legajo → Clasificación, compras | Quedó del Excel de demostración; no sale de ningún catálogo | Pendiente |
| 6.3 | Un comprobante lleva una sola actividad, que vale para todos los impuestos | Modelo `WorkpaperVoucherClassification` | No existe el vínculo comprobante ↔ régimen o variante de alícuota | Pendiente de diseño: selección de tratamiento por impuesto |
| 6.4 | Al clasificar no se ve qué alícuota va a resultar | Legajo → Clasificación | La alícuota se resuelve recién en el cálculo | Pendiente |
| 6.5 | No hay dónde registrar una alícuota reducida, exención o recargo propio de un cliente | Modelo de datos | Las alícuotas existen sólo en las reglas del régimen | Pendiente de diseño: excepción por cliente con vigencia y respaldo |

### Transversales

| # | Hallazgo | Cómo se reproduce | Causa | Estado |
|---|---|---|---|---|
| T.1 | Un paquete con cinco o más borradores posteriores aparecía sin versión activa | Paquete con versión activa v1 y borradores v2 a v6: el listado no mostraba "Vigente" | El listado recorta a las cinco versiones más nuevas | Corregido: la versión activa siempre viaja en el listado |
| T.2 | Las pruebas de integración escriben en la base de desarrollo | Correr `npm test` en `apps/api` con el `.env` local | No hay una base de pruebas separada; quedan regímenes, clientes y borradores de prueba mezclados con los datos de demostración | Pendiente: base de pruebas desechable. Cada corrida completa deja un borrador en el paquete IIBB Tucumán que no se puede borrar (sus liquidaciones de prueba quedan finalizadas e inmutables) |
| T.3 | Los rechazos nuevos del servidor no están verificados en pantalla | Intentar crear una obligación o liquidar a un cliente sin inscripción | Falta recorrerlo en la interfaz y, si hace falta, ofrecer el enlace a la inscripción | Pendiente |

### Recorrido del 14-nov-2026 · plataforma de interfaz (PR #76 a #81)

Hecho en local con datos y en producción (`e6cfe37`), que está vacía de datos de prueba.

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| P.1 | **Producción: el estudio no tiene ningún módulo y la pantalla no deja habilitar ninguno.** Módulos de estudios lista sólo los módulos que ya tienen fila guardada; el estudio de producción no tiene ninguna (`feature-flags` devuelve una lista vacía), así que la pantalla dice "Sin módulos configurados" y no hay forma de prender el módulo fiscal desde la interfaz. Sin ese módulo el servidor rechaza obligaciones y liquidaciones. | Bloquea el flujo en producción | Abierto. Hay un arreglo sin subir en otra sesión (`apps/api/src/flags/routes.ts`: el listado completa los módulos conocidos, apagados) |
| P.2 | Con un cliente abierto en Resumen, el menú resalta "Clientes" además de "Resumen". | Menor | Abierto, visto una sola vez |
| P.3 | Rentabilidad y otras pantallas que piden período muestran "Elegí un período" con el selector arriba; el período ya no se elige por adelantado. Funciona, pero es un paso más al entrar. | Menor | Para decidir: recordar el último período por cliente |
| P.4 | Liquidaciones conserva contador y descripción larga en el encabezado del panel; el resto del panel sigue con texto de más. | Menor | Abierto |
| P.5 | La prueba `settlement-tem.test.ts` (V-004) falló una vez en CI por un bloqueo de base de datos y pasó en las corridas siguientes. | Prueba inestable | Abierto |

Confirmado en pantalla: notificación al habilitar y deshabilitar un módulo, confirmación al deshabilitar, cajón de alta de cliente sin rótulo, densidad de filas desde el menú de ayuda, tablas con el mismo aspecto en Clientes, Liquidaciones, Usuarios y Reglas fiscales.

## Simulador de liquidación ("Probar")

Pestaña **Probar** en Reglas fiscales. Corre el motor real con las reglas guardadas de una versión sobre un caso cargado a mano; no escribe nada. Si la versión es un borrador, compara contra la versión activa del paquete.

| Qué | Estado |
|---|---|
| Ingresos Brutos local y TEM | Disponible desde el 13-nov-2026 |
| Convenio Multilateral, Monotributo, IVA | Pendiente: el servidor responde que todavía no se pueden probar |
| Guardar casos de prueba y volver a correrlos antes de activar | Pendiente |
| Fórmula del impuesto explicada en castellano | Pendiente: hoy se muestra la fórmula tal como la escribe el motor |
| Comparación borrador contra activa, vista en pantalla | Probada por tests del servidor; falta recorrerla en la interfaz |

La traducción de reglas guardadas a reglas del motor vive en `apps/api/src/tax/engine-rules.ts` y la usan tanto la liquidación como el simulador: lo que se prueba es lo que se liquida.

## Pedidos de producto registrados

- El trabajo de una obligación termina cuando el estudio sube el comprobante de la presentación ante el organismo fiscal. Hoy no existe ese paso; queda para diseño y luego código.
