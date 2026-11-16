# Contable — guía del sistema de diseño

Fuente versionada de uso visual e interacción. **Foco v1 es el único lenguaje visual de Contable**, en el estudio, en el portal y en las pantallas de acceso. Los valores fuente viven en `packages/design-system/src/tokens.css`; esta guía describe sus valores reales, el contrato de cada familia de componentes y la receta de cada pantalla de `apps/web/src`. Si cambia un token, un componente o una receta, actualizá esta guía en el mismo PR. La guía UI existente de formularios y paneles sigue siendo la referencia detallada de interacción transaccional: [Guía UI — formularios y paneles emergentes](docs/guia-ui-formularios-paneles.md).

Cada pieza de esta guía lleva uno de dos rótulos de estado: **vigente en main** (el código ya lo cumple) o **extensión aprobada, implementación pendiente** (la dirección está aprobada y todavía no existe en el paquete). Una extensión pendiente se usa recién cuando su PR la incorpora y actualiza su rótulo acá.

## 1. Principios

1. **Resolver el trabajo diario del estudio.** Contable reemplaza planillas Excel de estudios contables: es flexible, guía a la persona y le deja armar sus escenarios. Priorizamos lectura rápida de datos fiscales, estados trazables y acciones claras dentro de la vista de trabajo.
2. **Foco es el lenguaje único.** Toda pantalla se compone con cuatro rasgos: lectura sobre el lienzo, jerarquía inequívoca, información progresiva y acciones deliberadas. Las cajas delimitan interacciones, no cada dato. La apariencia limpia conserva siempre evidencia, advertencias, permisos y validaciones.
3. **Escritorio.** La interfaz se diseña y se verifica en escritorio, a 1440×900 y 1280×720. Los breakpoints y comportamientos móviles ya presentes se documentan como comportamiento existente, no como objetivo de diseño.
4. **Como máximo una acción principal por pantalla o panel activo.** La acción principal se destaca; alternativas, cierre y cancelación usan jerarquía secundaria o ghost. Una pantalla de consulta puede no tener acción principal.
5. **Preservar contexto, trazabilidad y reversibilidad.** Las operaciones transaccionales mantienen visible el cliente y el período, y explican impacto, validación y resultado; una acción de alto impacto pide confirmación.
6. **Un solo sistema.** Las pantallas se arman con las familias C01–C09 de la sección 5 y las recetas de la sección 6. El producto tiene un único estilo: no ofrece selector de estilos ni mantiene una segunda biblioteca de componentes.

### Los cuatro rasgos de Foco

| Rasgo | Qué significa | Cómo se aplica |
|---|---|---|
| Lectura sobre el lienzo | Los datos se leen directamente sobre `--ds-color-background`, ordenados por espacio y líneas | Secciones separadas por `--ds-color-border-subtle` y la escala de espaciado; la superficie con borde queda para lo que se opera (campos, controles, tablas interactivas, popovers y paneles) |
| Jerarquía inequívoca | Cada pantalla tiene un título, un orden de lectura y, como máximo, una acción principal | Un `h1` por pantalla, títulos por rol (`--ds-text-2xl`, `--ds-text-xl`, `--ds-text-lg`), números a la derecha con cifras tabulares y un único fondo de aviso por pantalla |
| Información progresiva | Primero lo necesario para decidir; el detalle se abre por intención | Lista y detalle, pestañas de sección y paneles laterales. El resumen de advertencias y de revisión queda visible; al detalle van los metadatos extensos |
| Acciones deliberadas | Toda acción dice qué va a pasar y responde una sola vez | Confirmación para lo riesgoso, estado «procesando» que evita el doble envío, resultado por un único canal y éxito recién con la confirmación real |

### Cuatro capas

1. **Tokens:** `packages/design-system/src/tokens.css`. Foco v1 usa la paleta y los tokens existentes.
2. **Primitivas:** los componentes de `packages/design-system/src`. Son genéricos: reciben datos y capacidades ya resueltos.
3. **Patrones:** composición de esas primitivas (familias C01–C09). Los adaptadores de `apps/web/src/ui` se conservan cuando ya cumplen una responsabilidad.
4. **Recetas:** cada pantalla conecta datos, capacidades, contexto y navegación (sección 6). Las consultas, los permisos y las reglas de dominio viven en la pantalla o en su pieza de dominio, por ejemplo `PendingFilingReceipts`.

### Reglas transversales

- El resultado de una acción se comunica por un solo canal: la notificación.
- Una instrucción ordinaria es texto neutro; el aviso con fondo y el verde quedan para lo que los necesita.
- Un error local se muestra junto a su fuente y ofrece recuperación.
- Carga y fallo se muestran como carga y como fallo: un dato sin respuesta se expresa con texto («pendiente», «no disponible»), y el cero y «todo al día» se reservan para una respuesta confirmada.
- Cambiar de sección o de pestaña conserva el estado de negocio del registro.
- Importes, porcentajes y cantidades usan cifras tabulares y alineación derecha.
- Las preferencias compartidas existentes se respetan (por ejemplo, la densidad de filas).

### Reglas globales P1–P5

Esta guía y las reglas globales de diseño y producto de Contable (aprobadas por Inti el 11-nov) dicen lo mismo. Cada PR declara qué principio atiende.

| Principio | Qué pide | Dónde se resuelve en esta guía |
|---|---|---|
| **P1 — Todo bloqueo guía** | Si la persona no puede avanzar, la pantalla dice qué falta y ofrece el enlace o botón que lo resuelve. Lo creado queda utilizable o marcado «falta X». Cada cliente y período muestra un único «estado de preparación». «Activo» significa utilizable; lo que está solo adherido o cargado se nombra distinto | C07 (vacío y bloqueo con salida), C08 (aviso con acción), recetas de la sección 6 |
| **P2 — El comportamiento se elige** | Motor, adaptador, política y variantes de cálculo se seleccionan en un desplegable alimentado por catálogo; el nombre que escribe la persona es solo una etiqueta. Las relaciones se resuelven por id o por atributos fiables | C09 (formularios con parámetros seleccionables); los componentes genéricos reciben opciones, no las deducen |
| **P3 — Un concepto, un nombre, un lugar** | Un solo nombre en menú, título, botones, ayudas y mensajes, y un solo lugar donde se edita | Glosario de esta sección; C01 (un título por pantalla); «cada dato una sola vez por pantalla» en la sección 6 |
| **P4 — Los errores hablan** | La API devuelve campo y motivo y un componente común lo muestra junto al campo. El botón de guardar se mantiene habilitado y señala lo que falta; si se deshabilita, el motivo está visible al lado. Los formatos se validan al tipear | C09 (`Field`, `MoneyField`, pie del panel) y «Dónde va cada error» en la sección 5 |
| **P5 — Piezas compartidas** | Panel lateral, barra de acciones, campo con error, estado vacío o bloqueo, tabla y etiqueta de estado son piezas del sistema; un defecto de una pieza se corrige en la pieza. Tokens `--ds-*` por nombre | Las seis piezas de P5 viven en C09, C01, C09, C07, C04 y C08 respectivamente; C02, C03, C05 y C06 son las familias de composición que las ordenan en la pantalla |

Antes de tocar una validación, un bloqueo o un control se lo clasifica: **integridad** (se conserva y se explica), **secuencia** (se convierte en guía: se guarda incompleto y se marca qué falta) u **opinión del sistema** (se quita). Los cambios de reglas de negocio, permisos o flujos se proponen a Ciro y los decide Inti.

### Fechas y períodos

- Un formato por concepto en las pantallas del equipo: **fecha** dd/mm/aaaa con ceros («05/07/2026», «01/01/2027»); **mes** «julio de 2026», en minúscula; **rango** «01/07/2026 al 31/07/2026», sin flecha ni formato ISO; **fecha y hora** «05/07/2026 14:30», en 24 h y en hora de Argentina. Un rango sin fin se muestra «Desde 01/07/2026».
- Valor interno ISO, pantalla en español: el estado, la API, la URL, el `value` de los campos `type="date"` y los nombres de archivo siguen en aaaa-mm-dd. Solo cambia lo que se muestra.
- **Período** de un rango de fechas: si cubre exactamente un mes calendario, se muestra como mes («septiembre de 2026»); en cualquier otro caso, como rango. El encabezado del Legajo muestra el mes («abril de 2026 · Revisión 1»).
- Una sola pieza compartida: `apps/web/src/lib/formatoFechas.ts` (`formatearFecha`, `formatearMes`, `formatearRango`, `formatearPeriodo`, `formatearFechaHora`). El vacío lo indica cada pantalla con el segundo parámetro («—» por defecto). Ninguna pantalla formatea fechas con `toLocaleDateString`, `Intl.DateTimeFormat` ni `slice(0, 10)`.
- Los selectores nativos de fecha del navegador usan el idioma del navegador y quedan fuera de este formato.

### Glosario vigente (P3)

- **Configuración fiscal**: pantalla del cliente. Es el único título de esa pantalla.
- **Ajustes del estudio**: grupo de Usuarios, Módulos, Reglas fiscales y Catálogos fiscales. En main el menú todavía lo rotula «Configuración del estudio»; se alinea en el corte que toque el menú.
- **Ficha del cliente**: su primera sección es el Resumen; un solo «Editar» con secciones; el estado del cliente es una acción aparte.
- **Ocultar**: reversible, se muestra como acción neutra. **Eliminar**: irreversible, solo Titular.
- **Crear a partir de este**: copia para una versión nueva; la pantalla lo anuncia como copia.
- **Vigente**: la versión de reglas que usan los cálculos. «Activar» es solo la acción que la pone en uso.
- **Motor de cálculo vN**: el motor de una versión de reglas. «Opción de cálculo» es el selector que lo elige.
- **Nuevo paquete**: nombre único del alta de un paquete de reglas, en la cabecera y en el estado vacío.
- **Legajo**: el trabajo mensual de un cliente y un período. La URL `/expediente-mensual` y los identificadores internos no cambian.
- **Saldo a favor**: el saldo que favorece al contribuyente. **Disponible** es lo que queda de ese saldo.
- **Acuse de presentación**: el comprobante que emite el organismo al presentar.
- **Calendario fiscal**: vencimientos anuales de un organismo y una jurisdicción, con sus celdas por concepto, terminación de CUIT y período de referencia. Se carga en borrador, se valida y se publica; lo publicado no se edita: se corrige con una versión nueva.
- **Vencimiento**: fecha límite de una obligación. Precedencia: valor manual justificado > calendario publicado del organismo y la jurisdicción > regla de vencimiento. Sin fuente, la obligación queda sin fecha y se avisa qué falta.
- Pendiente de decisión de Inti: nombre y fuente única de «período» (fiscal y contable).

### Decisiones de diseño (cerradas 11-nov)

Siguen vigentes y Foco las aplica tal como están.

1. **Paleta y tipografía:** conservar las familias Source Sans 3 (`--ds-font-sans`) y Source Serif 4 (`--ds-font-serif`) y la paleta existente; usar `--ds-color-text-faint: #716c62` para texto auxiliar con contraste AA sobre las superficies donde se aplica. La carga de las familias debe incluir los glifos Latin y Latin-ext.
2. **Títulos por rol:** aplicar sans para títulos de página (`--ds-text-2xl`), sección (`--ds-text-xl`) y bloque (`--ds-text-lg`), con la escala de peso 400 (`--ds-font-weight-regular`), 600 (`--ds-font-weight-medium`) y 700 (`--ds-font-weight-bold`). Las clases `.ds-title-page`, `.ds-title-section`, `.ds-title-block`, `.ds-text-body`, `.ds-text-help` y `.ds-text-emphasis` quedan disponibles en el paquete; cada pantalla las adopta en el corte que la migra a Foco.
3. **Estados:** en tablas mostrar punto y texto; reservar la píldora para la ficha. Usar cinco tonos con significado fijo: `ok` para resultado correcto/vigente, `aviso` para atención requerida, `peligro` para error o acción de riesgo, `info` para orientación y `neutro` para estado ordinario/inactivo. Los estados usan tokens semánticos, nunca `--ds-color-primary` directamente; el verde de marca se reserva para acción y selección. El valor vigente de `--ds-color-success` coincide con `--ds-color-primary`; su separación visual se coordina con la migración posterior de estados.
4. **Composición:** usar caja para elementos que se operan; separar secciones y filas con línea (`--ds-color-border-subtle`); limitar cada pantalla a un único fondo de aviso, con el token semántico del aviso correspondiente (por ejemplo, `--ds-color-warning-subtle`).
5. **Medidas:** construir separaciones sobre la grilla de 4 px y usar `--ds-space-0-5` (2 px) para el medio paso; `--ds-radius-full` identifica el radio circular. Mantener fila de 32 px y controles de barra de 32 px (`--ds-control-height-sm`), y campos de 40 px (`--ds-control-height-md`).
6. **Componentes:** mantener las primitivas existentes en `packages/design-system/src` y llevar allí Dense*, `StatusBadge`, drawers y diálogo, con exports desde el paquete. Unificar la tabla, la píldora, los avisos y los botones de texto como primitivas compartidas del mismo paquete. Cada token o estilo nuevo respeta la regla contra literales y el baseline de `packages/design-system/literals-baseline.json`.

Decisiones cerradas de Inti que acompañan a las anteriores: solo escritorio; errores en línea junto al campo; composición sin cajas y con alineación; todo lleva usuario y los permisos deciden.

Notas de referencia: guía visual de trabajo en `/root/.hermes/workspace/contable/guia-diseno/` (corte del 11-nov) y contrato y galería Foco v1 en `/root/.hermes/workspace/contable/contrato-foco/` (corte del 14-nov). Esta guía versionada no depende de esos archivos para build o pruebas.

## 2. Color

Los siguientes valores se copian de `packages/design-system/src/tokens.css`. En la columna de uso se indica el empleo actual observado; “no usar” limita la función semántica para evitar reutilizaciones ambiguas.

| Token | Valor real | Rol | Usar en | No usar en |
|---|---|---|---|---|
| `--ds-color-background` | `#faf8f4` | Lienzo cálido | Fondo de página y superficies de carga | Tarjetas que deban distinguirse del lienzo |
| `--ds-color-surface` | `#fffdf8` | Superficie principal | Paneles, controles y tarjetas | Estados de hover o selección |
| `--ds-color-surface-muted` | `#f1eee6` | Superficie secundaria | Cabeceras de tabla, controles read-only y fondos discretos | Texto o estados de alerta |
| `--ds-color-surface-hover` | `#f6f3ec` | Hover neutral | Filas, botones y controles al pasar el puntero | Estado seleccionado persistente |
| `--ds-color-surface-pressed` | `#ebe6dc` | Presión neutral | Fondo de controles activos/pressed | Fondo permanente de panel |
| `--ds-color-text` | `#22211d` | Texto principal | Cuerpo, títulos y datos | Fondo de estado |
| `--ds-color-text-muted` | `#625f57` | Texto secundario | Descripciones, labels, metadatos y cabeceras | Mensajes de error o texto deshabilitado |
| `--ds-color-text-faint` | `#716c62` | Texto auxiliar tenue con contraste AA | Eyebrows, pistas cortas y datos secundarios sobre superficies claras y muted | Texto de lectura larga o uso como color de estado |
| `--ds-color-text-disabled` | `#777268` | Texto deshabilitado | Controles disabled | Contenido activo o texto de ayuda |
| `--ds-color-border` | `#d8d2c7` | Separador estándar | Bordes de paneles, controles y divisiones | Texto o indicador de estado por sí solo |
| `--ds-color-border-subtle` | `#e7e2d9` | Separador suave | Líneas internas y filas | Bordes de foco |
| `--ds-color-border-strong` | `#aaa398` | Separador enfatizado | Límites de controles y bordes con mayor presencia | Texto de contenido |
| `--ds-color-control-disabled` | `#ece8df` | Fondo disabled | Controles deshabilitados | Superficies activas |
| `--ds-color-focus` | `#256247` | Indicador de foco | Outline y borde de foco visible | Decoración sin interacción |
| `--ds-color-focus-subtle` | `#c9dfd3` | Tono suave de foco | Tono semántico de halo de foco; token declarado, sin consumidor directo observado | Fondo general; el halo actual usa `--ds-shadow-focus` |
| `--ds-color-primary` | `#256247` | Acción/enlace principal | CTA, enlaces y selección activa | Estados; usar el token semántico correspondiente |
| `--ds-color-primary-hover` | `#1f523c` | Hover primario | Hover de botones primarios | Estado base o confirmación destructive |
| `--ds-color-primary-active` | `#183f2f` | Presión primaria | Estado active de botones | Fondo de panel persistente |
| `--ds-color-on-primary` | `#fffdf8` | Contenido sobre primario | Texto e iconos sobre botones/fondos primarios | Texto sobre superficies claras |
| `--ds-color-danger` | `#a9362a` | Acción o mensaje de peligro | Acción destructiva, errores y estado danger | Acción primaria ordinaria |
| `--ds-color-danger-hover` | `#8e2c23` | Hover destructive | Hover de botón danger | Estado base o texto sobre superficie clara sin verificar contraste |
| `--ds-color-danger-active` | `#72221c` | Presión destructive | Active de botón danger | Fondo neutro |
| `--ds-color-danger-subtle` | `#f4d8d3` | Fondo de peligro suave | Alertas y hover de acción destructiva ghost | Texto de error |
| `--ds-color-on-danger` | `#fffdf8` | Contenido sobre danger | Texto e iconos sobre botones danger | Texto sobre superficie clara |
| `--ds-color-warning` | `#8a570e` | Advertencia | Etiquetas y texto de alerta de advertencia | Error destructivo o estado exitoso |
| `--ds-color-warning-subtle` | `#f8ead3` | Fondo de advertencia | Alertas, badges y notas warning | Fondo de página o texto |
| `--ds-color-success` | `#256247` | Token semántico del tono `ok` | Texto de confirmación, coherencia y estados correctos; acompañar con texto o icono | Usarlo como único indicador; su valor actual coincide con el verde de marca y se diferencia en la migración posterior de estados |
| `--ds-color-info` | `#285d83` | Información | Badge informativo | Acción primaria o advertencia |
| `--ds-color-info-subtle` | `#e3edf4` | Fondo informativo | Fondo de información | Texto de información |
| `--ds-color-selected` | `#e2eee7` | Selección | Fila/área seleccionada y selección de texto | Estado hover transitorio |
| `--ds-color-primary-soft` | `#e2eee7` | Acento primario suave | Navegación activa, tarjetas y superficies seleccionadas | Texto pequeño sobre sí mismo |
| `--ds-color-success-subtle` | `#e5efe9` | Fondo de éxito suave | Confirmaciones y alertas de éxito | Texto de estado |
| `--ds-color-spinner-track` | `#89aa98` | Pista de spinner | Token declarado para el track de carga; sin consumidor directo observado | Texto o fondo de contenido |
| `--ds-surface` | `var(--ds-color-surface)` → `#fffdf8` | Alias operativo de superficie | Módulos que aún usan el alias | Crear una segunda paleta independiente |
| `--ds-surface-muted` | `var(--ds-color-surface-muted)` → `#f1eee6` | Alias operativo de superficie muted | Módulos operativos existentes | Cambiar el valor sin cambiar la fuente de color |
| `--ds-border` | `var(--ds-color-border)` → `#d8d2c7` | Alias operativo de borde | Módulos operativos existentes | Sustituirlo por un color local distinto |
| `--ds-text` | `var(--ds-color-text)` → `#22211d` | Alias operativo de texto | Módulos operativos existentes | Uso como fondo |
| `--ds-text-muted` | `var(--ds-color-text-muted)` → `#625f57` | Alias operativo de texto secundario | Módulos operativos existentes | Mensaje de error/deshabilitado |
| `--ds-accent` | `var(--ds-color-primary)` → `#256247` | Alias operativo de acento | Estilos de estudio que consumen el alias | Definir un acento local distinto |
| `--ds-accent-soft` | `var(--ds-color-primary-soft)` → `#e2eee7` | Alias operativo de acento suave | Estilos de estudio que consumen el alias | Fondo de error o advertencia |

### Contraste medido

Se midieron combinaciones sólidas realmente usadas en la UI (tokens de texto sobre fondos asociados en `global.css`, `study.css`, `Dense.css`, `Button.css`, `Field.css` y badges). Para texto normal se usa 4,5:1; para texto grande —al menos 24 px regular o 18,67 px bold— se usa 3:1. La relación se calculó con luminancia relativa WCAG: convertir cada canal sRGB a lineal (`c/12,92` si `c ≤ 0,04045`; en otro caso `((c+0,055)/1,055)^2,4`), calcular `L = 0,2126R + 0,7152G + 0,0722B` y dividir `(Lclaro + 0,05)/(Loscuro + 0,05)`. Ratios redondeados a dos decimales.

| Par usado | Contraste | Tamaño/umbral | Resultado |
|---|---:|---|---|
| `--ds-color-text` / `--ds-color-background` | 15,19:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text` / `--ds-color-surface` | 15,85:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text` / `--ds-color-selected` | 13,52:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-muted` / `--ds-color-background` | 6,01:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-muted` / `--ds-color-surface` | 6,27:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-muted` / `--ds-color-surface-muted` | 5,50:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-faint` / `--ds-color-background` | 4,92:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-faint` / `--ds-color-surface` | 5,13:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-faint` / `--ds-color-surface-muted` | 4,50:1 | Normal / 4,5:1 | Cumple (4,5017:1 sin redondear) |
| `--ds-color-text-faint` / `--ds-color-surface-hover` | 4,71:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-faint` / `--ds-color-selected` | 4,38:1 | Normal / 4,5:1 | **Bajo el mínimo en filas muted seleccionadas** |
| `--ds-color-text-disabled` / `--ds-color-control-disabled` | 3,91:1 | Normal / 4,5:1 | **Bajo el mínimo** |
| `--ds-color-primary` / `--ds-color-background` | 6,79:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-primary` / `--ds-color-surface` | 7,08:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-primary` / `--ds-color-primary-soft` | 6,04:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-on-primary` / `--ds-color-primary` | 7,08:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-on-primary` / `--ds-color-primary-hover` | 8,86:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-on-primary` / `--ds-color-primary-active` | 11,53:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-on-danger` / `--ds-color-danger` | 6,36:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-on-danger` / `--ds-color-danger-hover` | 8,15:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-on-danger` / `--ds-color-danger-active` | 10,53:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-danger` / `--ds-color-danger-subtle` | 4,81:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-warning` / `--ds-color-warning-subtle` | 5,13:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-success` / `--ds-color-success-subtle` | 6,12:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-info` / `--ds-color-info-subtle` | 5,93:1 | Normal / 4,5:1 | Cumple |

El cálculo WCAG con `--ds-color-text-faint: #716c62` da 4,9206:1 sobre `--ds-color-background`, 5,1342:1 sobre `--ds-color-surface`, 4,5017:1 sobre `--ds-color-surface-muted` y 4,7098:1 sobre `--ds-color-surface-hover`. `DenseTable` permite seleccionar filas muted y usa `--ds-color-selected` de fondo: ese par mide 4,3786:1, por debajo de 4,5:1; `--ds-color-primary-soft` comparte el mismo valor y también mide 4,3786:1 (se usa en el icono de acceso rápido, cuyo contraste no textual supera 3:1). La entrada `Field` sobre su mezcla de superficie mide 5,1311:1. F1 conserva el valor cerrado y no altera estas pantallas; la combinación de fila muted seleccionada queda como brecha explícita para el corte de estados/composición. El contraste de texto disabled se informa frente al umbral general; las excepciones normativas aplicables a controles inactivos requieren evaluación contextual.

## 3. Tipografía

Las familias del sistema son Source Sans 3 para UI y Source Serif 4 para reportes/cifras destacadas, con las pilas fallback declaradas en `packages/design-system/src/tokens.css`. `apps/web/src/styles/fonts.css` conserva sus definiciones de familia y peso; la carga de los subconjuntos Latin y Latin-ext debe cubrir los glifos usados por la interfaz.

| Token | Valor real | Uso observado |
|---|---|---|
| `--ds-font-sans` | `"Source Sans 3", system-ui, -apple-system, sans-serif` | Cuerpo en `global.css`; botones, campos, tablas, Dense UI y textos de interfaz |
| `--ds-font-serif` | `"Source Serif 4", Georgia, serif` | `h1`–`h3` globales, títulos vacíos, marca del shell y cifras destacadas |
| `--ds-font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` | Código fiscal; replica exactamente el fallback previo para conservar su aspecto |
| `--ds-text-xs` | `12px` | Ayudas y metadatos (`Field.css`, `Dense.css`) |
| `--ds-text-sm` | `13px` | Labels, botones pequeños, tablas y descripciones densas |
| `--ds-text-base` | `14px` | Cuerpo, controles y botones estándar |
| `--ds-text-lg` | `16px` | Subtítulos y controles con puntero coarse/móvil |
| `--ds-text-xl` | `20px` | Títulos de sección, estadísticas y vacíos |
| `--ds-text-2xl` | `24px` | Cifras métricas |
| `--ds-text-3xl` | `32px` | Escala tipográfica disponible; no es el tamaño fijo de `DenseHeader` |
| `--ds-leading-tight` | `1.25` | Botones y títulos de estado vacío |
| `--ds-leading-normal` | `1.45` | Cuerpo de campos y tablas |
| `--ds-leading-relaxed` | `1.6` | Descripciones de estado vacío |
| `--ds-font-weight-medium` | `600` | Peso medio definido para controles y títulos |
| `--ds-font-weight-bold` | `700` | Peso bold definido; token sin consumidor directo en los CSS revisados |
| `--ds-font-weight-regular` | `400` | Peso regular para cuerpo, ayuda y escala de roles tipográficos |

Jerarquía observada antes de la migración: el shell usa Source Serif 4 para la marca; los `h1` generales heredan Source Serif 4 (`global.css`). Las páginas estándar usan `.study-page__title` de 30–42 px; el encabezado compacto de `StudyCatalogosFiscales` usa `.dense-head h1` a 26 px; el inspector usa 17 px y los títulos de sección suelen usar 20 px. El cuerpo de `global.css` mide 14 px; los campos y botones usan 14 px, las etiquetas y tablas 13 px, las ayudas 12 px y las estadísticas 20 px. Se observan pesos directos 400, 500, 550, 600, 650, 700 y 750 en la UI; los roles nuevos usan 400/600/700. Las clases tipográficas están definidas en el paquete y no se aplican todavía a pantallas.

### Valores sueltos fuera de tokens: tamaños

Auditoría de los 16 archivos `.css` de `apps/web/src`: literales repetidos en `font-size` y tamaños explícitos de shorthand `font`, sin corregir. En `clamp()` se cuenta cada límite/tamaño explícito. Las rutas son relativas a `apps/web/src`; el número entre paréntesis es el total y luego se muestra el conteo por archivo.

| Literal repetido | Total y archivo(s) |
|---|---|
| `0.8rem` | 7 — `portal/portal.css` 2, `study/study.css` 5 |
| `11px` | 7 — `ui/Dense.css` 7 |
| `30px` | 7 — `App.css` 1, `auth/login.css` 1, `study/study.css` 4, `ui/ActionDrawer.css` 1 |
| `0.72rem` | 6 — `portal/portal.css` 1, `study/study.css` 5 |
| `12.5px` | 6 — `ui/Dense.css` 6 |
| `1rem` | 5 — `portal/portal.css` 1, `study/study.css` 1, `ui/DeletionDrawer.css` 1, `ui/Dense.css` 2 |
| `3vw` | 5 — `portal/portal.css` 2, `study/study.css` 2, `ui/ActionDrawer.css` 1 |
| `0.82rem` | 4 — `portal/portal.css` 1, `study/study.css` 3 |
| `0.9rem` | 4 — `portal/portal.css` 2, `study/study.css` 2 |
| `10px` | 4 — `shells/ContextBar.css` 1, `shells/StudyShell.css` 1, `study/study.css` 1, `ui/Dense.css` 1 |
| `0.85rem` | 3 — `portal/portal.css` 1, `study/study.css` 2 |
| `4vw` | 3 — `auth/login.css` 1, `study/study.css` 2 |
| `5vw` | 3 — `App.css` 1, `auth/login.css` 1, `study/study.css` 1 |
| `0.74rem` | 2 — `study/study.css` 2 |
| `1.15rem` | 2 — `study/study.css` 1, `ui/Dense.css` 1 |
| `11.5px` | 2 — `ui/Dense.css` 2 |
| `2.5vw` | 2 — `study/study.css` 2 |
| `21px` | 2 — `shells/StudyShell.css` 1, `study/study.css` 1 |
| `22px` | 2 — `study/study.css` 2 |
| `23px` | 2 — `shells/StudyShell.css` 1, `ui/ActionDrawer.css` 1 |
| `28px` | 2 — `study/study.css` 2 |
| `38px` | 2 — `auth/login.css` 1, `study/study.css` 1 |
| `42px` | 2 — `study/study.css` 2 |

### Valores sueltos fuera de tokens: colores

| Literal repetido | Total y archivo(s) | Observación |
|---|---|---|
| `#237a57` | 5 — `study/study.css` 5 | Fallback de `--ds-accent`; el alias definido resuelve al color primario actual |
| `#e8f2ee` | 2 — `study/study.css` 2 | Fallback de `--ds-accent-soft`; el alias definido resuelve al color suave actual |

Estos fallback literales no son los colores computados mientras los aliases estén definidos en `tokens.css`. Se dejan intactos y se registran para una actualización futura coordinada.

## 4. Espaciado, radios, capas y sombras

### Tokens de escala y presentación

| Grupo | Token | Valor real | Uso |
|---|---|---|---|
| Espacio | `--ds-space-1` | `4px` | Paso base de 4 px |
| Espacio | `--ds-space-0-5` | `2px` | Medio paso permitido de la grilla |
| Espacio | `--ds-space-2` | `8px` | Separación compacta |
| Espacio | `--ds-space-3` | `12px` | Separación de controles y contenidos densos |
| Espacio | `--ds-space-4` | `16px` | Padding habitual de formulario/panel |
| Espacio | `--ds-space-5` | `20px` | Separación amplia |
| Espacio | `--ds-space-6` | `24px` | Padding y separación de sección |
| Espacio | `--ds-space-7` | `28px` | Separación amplia de control |
| Espacio | `--ds-space-8` | `32px` | Padding de panel/empty state |
| Espacio | `--ds-space-10` | `40px` | Separación de bloque |
| Espacio | `--ds-space-12` | `48px` | Separación de sección |
| Espacio | `--ds-space-16` | `64px` | Espacio vertical grande |
| Radio | `--ds-radius-sm` | `3px` | Controles compactos |
| Radio | `--ds-radius-md` | `5px` | Controles y tarjetas estándar |
| Radio | `--ds-radius-lg` | `8px` | Paneles y contenedores mayores |
| Radio | `--ds-radius-full` | `9999px` | Píldoras y formas completamente redondeadas |
| Borde/control | `--ds-border-width` | `1px` | Borde estándar |
| Borde/control | `--ds-border-width-strong` | `2px` | Borde enfatizado e indicador visual |
| Borde/control | `--ds-control-height-sm` | `32px` | Controles de barra; coincide con la altura nominal de fila |
| Borde/control | `--ds-control-height-md` | `40px` | Campos de formulario |
| Borde/control | `--ds-touch-target` | `44px` | Objetivo mínimo del design system para puntero coarse |
| Borde/control | `--ds-focus-width` | `2px` | Grosor del foco |
| Borde/control | `--ds-focus-offset` | `2px` | Separación del foco |
| Sombra | `--ds-shadow-control` | `0 1px 2px rgba(34, 33, 29, 0.07)` | Elevación discreta de control/tabla |
| Sombra | `--ds-shadow-focus` | `0 0 0 3px #c9dfd3` | Halo de foco |
| Sombra | `--ds-shadow-focus-danger` | `0 0 0 3px #f4d8d3` | Halo de foco en error |
| Sombra | `--ds-shadow-popover` | `0 4px 12px rgba(34, 33, 29, 0.12)` | Elevación disponible para popover; sin consumidor directo observado |
| Sombra | `--ds-shadow-menu` | `0 2px 8px rgba(34, 33, 29, 0.1)` | Elevación disponible para menú; sin consumidor directo observado |
| Sombra | `--ds-shadow-float` | `0 8px 24px rgba(34, 33, 29, 0.14)` | Elemento flotante; el shell lo usa en navegación móvil |
| Movimiento | `--ds-duration-fast` | `120ms` | Feedback de interacción |
| Movimiento | `--ds-duration-normal` | `180ms` | Duración disponible; sin consumidor directo observado |
| Movimiento | `--ds-duration-spinner` | `700ms` | Giro de spinner |
| Movimiento | `--ds-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Curva de salida |
| Capa | `--ds-z-base` | `0` | Nivel base disponible; sin consumidor directo observado |
| Capa | `--ds-z-sticky` | `100` | Cabeceras sticky y elementos persistentes |
| Capa | `--ds-z-dropdown` | `200` | Menús y dropdowns |
| Capa | `--ds-z-modal` | `300` | `ActionDrawer`/diálogos |
| Capa | `--ds-z-toast` | `400` | Toasts y skip-link global |

### Valores sueltos recurrentes

Inventario de literales en propiedades `margin`, `padding`, `gap` y `border-radius` de los mismos 16 CSS de la aplicación. Los valores con al menos dos apariciones se muestran con total y ocurrencias por archivo; se omite `0px` porque es un reset, no una medida de espaciado. Rutas relativas a `apps/web/src`.

| Literal de espaciado | Total y archivo(s) |
|---|---|
| `2px` | 40 — `App.css` 1, `auth/login.css` 1, `portal/portal.css` 8, `shells/ContextBar.css` 3, `shells/PortalShell.css` 1, `shells/StudyShell.css` 1, `study/study.css` 15, `styles/global.css` 1, `ui/Dense.css` 9 |
| `10px` | 18 — `study/study.css` 1, `ui/Dense.css` 17 |
| `6px` | 17 — `study/study.css` 1, `styles/global.css` 1, `ui/Dense.css` 13, `ui/GuidedTour.css` 2 |
| `12px` | 13 — `shells/ContextBar.css` 2, `ui/ConfirmAction.css` 4, `ui/Dense.css` 6, `ui/GuidedTour.css` 1 |
| `1px` | 12 — `auth/login.css` 1, `portal/portal.css` 1, `shells/ContextBar.css` 1, `shells/StudyShell.css` 1, `study/study.css` 4, `ui/Dense.css` 4 |
| `4px` | 11 — `study/study.css` 2, `ui/Dense.css` 9 |
| `4vw` | 11 — `portal/portal.css` 3, `shells/ContextBar.css` 1, `shells/PortalShell.css` 3, `shells/StudyShell.css` 1, `study/study.css` 3 |
| `28px` | 9 — `auth/login.css` 4, `shells/ContextBar.css` 1, `study/study.css` 3, `ui/Dense.css` 1 |
| `3vw` | 9 — `App.css` 1, `shells/PortalShell.css` 1, `shells/StudyShell.css` 1, `study/study.css` 4, `ui/ActionDrawer.css` 2 |
| `5px` | 9 — `auth/login.css` 1, `study/study.css` 3, `ui/Dense.css` 5 |
| `20px` | 8 — `auth/login.css` 2, `shells/ContextBar.css` 1, `shells/StudyShell.css` 1, `study/study.css` 2, `ui/ActionDrawer.css` 2 |
| `24px` | 8 — `auth/login.css` 1, `shells/ContextBar.css` 1, `shells/StudyShell.css` 2, `study/study.css` 1, `ui/Dense.css` 3 |
| `8px` | 8 — `ui/Dense.css` 8 |
| `9px` | 8 — `auth/login.css` 1, `study/study.css` 2, `styles/global.css` 1, `ui/Dense.css` 3, `ui/GuidedTour.css` 1 |
| `16px` | 7 — `App.css` 1, `shells/ContextBar.css` 1, `shells/StudyShell.css` 1, `ui/Dense.css` 2, `ui/GuidedTour.css` 2 |
| `0.45rem` | 6 — `study/study.css` 4, `ui/DeletionDrawer.css` 2 |
| `3px` | 6 — `study/study.css` 2, `ui/Dense.css` 4 |
| `48px` | 6 — `App.css` 1, `auth/login.css` 3, `shells/StudyShell.css` 1, `study/study.css` 1 |
| `36px` | 5 — `auth/login.css` 1, `study/study.css` 4 |
| `14px` | 4 — `ui/Dense.css` 4 |
| `18px` | 4 — `study/study.css` 2, `ui/GuidedTour.css` 2 |
| `30px` | 4 — `study/study.css` 1, `ui/ActionDrawer.css` 2, `ui/Dense.css` 1 |
| `5vw` | 4 — `auth/login.css` 1, `portal/portal.css` 2, `study/study.css` 1 |
| `0.55rem` | 3 — `study/study.css` 3 |
| `0.5rem` | 3 — `study/study.css` 1, `ui/DeletionDrawer.css` 2 |
| `40px` | 3 — `App.css` 1, `auth/login.css` 1, `ui/Dense.css` 1 |
| `6vw` | 3 — `auth/login.css` 3 |
| `7px` | 3 — `ui/Dense.css` 3 |
| `0.25rem` | 2 — `study/study.css` 1, `ui/DeletionDrawer.css` 1 |
| `0.35rem` | 2 — `study/study.css` 2 |
| `0.48rem` | 2 — `study/study.css` 2 |
| `0.58rem` | 2 — `study/study.css` 2 |
| `1rem` | 2 — `ui/DeletionDrawer.css` 2 |
| `2.4vw` | 2 — `study/study.css` 2 |
| `2vw` | 2 — `shells/ContextBar.css` 1, `shells/PortalShell.css` 1 |
| `56px` | 2 — `shells/ContextBar.css` 1, `shells/StudyShell.css` 1 |
| `64px` | 2 — `shells/StudyShell.css` 2 |
| `72px` | 2 — `auth/login.css` 2 |

Radios recurrentes fuera de tokens (mismas rutas y criterio): `999px` 13 (`App.css` 1, `auth/login.css` 1, `study/study.css` 8, `styles/global.css` 1, `ui/Dense.css` 1, `ui/GuidedTour.css` 1); `3px` 4 (`shells/StudyShell.css` 4); `10px` 3 y `12px` 3 (`shells/StudyShell.css`); `13px` 3 (`auth/login.css`); `14px` 3 y `18px` 3 (`App.css`); `17px` 3 (`study/study.css`); `4px` 2 (`App.css` 1, `auth/login.css` 1); `5px` 2 (`App.css` 1, `study/study.css` 1).

La escala global de capas está definida por los cinco tokens anteriores. En código se observan literales de contexto: `z-index: 0` una vez en `ui/ActionDrawer.css`, `z-index: 1` cuatro veces (`portal/portal.css` 3, `ui/ActionDrawer.css` 1) y `z-index: 2` una vez en `ui/Dense.css`. `ActionDrawer`/`portal.css` usan algunos como capas locales aisladas. `StudyShell.css` calcula además `--ds-z-dropdown + 1` y `+ 2` para sidebar y cabecera móvil. La cabecera sticky de `Dense.css` con valor `2` difiere de la guía existente, que recomienda `--ds-z-sticky` para header/tabla; se documenta la divergencia real sin modificarla.

Las sombras del sistema están tokenizadas; las excepciones observadas son: `box-shadow: none` 5 veces (`auth/login.css` 1, `study/study.css` 4), más valores de una sola aparición en `ui/ActionDrawer.css` (sombra lateral `-18px 0 44px`), `ui/GuidedTour.css` (scrim `0 0 0 100vmax`), `shells/ContextBar.css` (halo `0 0 0 2px` y línea `0 1px 0`), `study/study.css` (detalle decorativo `14px 0 0`), `auth/login.css` (detalles `18px 0 0` y `36px 0 0`), `ui/Dense.css` (selección inset `inset 0 -2px 0` y `inset 3px 0 0`) y `shells/StudyShell.css` (inset de marca). Los valores funcionales de foco y flotación siguen documentados como tokens; estas excepciones se registran sin normalizarlas.

## 5. Componentes

`packages/design-system/src` es la fuente de los componentes compartidos. Su API pública incluye `Button`, `Field`, `MoneyField`, `Table`, `EmptyState`, `Notice`, las primitivas Dense, `StatusBadge`, `ActionDrawer`, `ConfirmAction`, `ConfirmDialog`, `useConfirmAction`, `AsyncState`, `Icon`, `SectionIndex`, `Switch`, `ToastProvider` y `useNotify`. Las rutas históricas de `apps/web/src/ui` reexportan los componentes migrados para conservar los imports existentes. El paquete expone `@contable/design-system/Dense.css`; el adaptador web lo importa antes de sus reglas contextuales para mantener el orden de la cascada.

Foco organiza esos componentes en **nueve familias, C01 a C09**. Cada familia tiene un contrato: propósito y límite, entradas, variantes, anatomía, estados, interacción, accesibilidad, tokens y aceptación observable. Los nombres de los componentes existentes se mantienen; Foco los evoluciona con props opcionales. Los componentes son genéricos: los estados de consulta, los permisos y las reglas de dominio los resuelve la pantalla que los usa.

### Mapa de familias

| Familia | Componentes base | Estado de la base |
|---|---|---|
| C01 — Encabezado y acciones | `DenseHeader`, `Button`, `Icon` | Vigente en main |
| C02 — Secciones de lectura | `DensePage`, `DenseSection` | Vigente en main, con `surface` |
| C03 — Indicadores con alcance | `StatStrip`, `StatItem` | Vigente en main, con `pressed` |
| C04 — Tablas y agrupación | `Table`, `DenseTable`, `DenseGroup`, `DenseFooter` | Vigente en main, con `groupBy` y `surface` |
| C05 — Filtros y navegación | `DenseToolbar`, `DenseTabs`, `DenseSearch`, `DenseToggleGroup`, `SectionIndex` | Vigente en main |
| C06 — Lista y detalle | `DenseWorkspace`, `Inspector`, `InspectorSection`, `InspectorFacts` | Vigente en main, con `role` y nombre accesible |
| C07 — Carga, error y vacío | `AsyncState`, `DenseLoading`, `EmptyState` | Vigente en main, con `size="inline"` |
| C08 — Estado y mensajes | `StatusBadge`, `Notice`, `ToastProvider`/`useNotify` | Vigente en main |
| C09 — Paneles y confirmación | `ActionDrawer`, `ConfirmAction`/`ConfirmDialog`, `DeletionDrawer`, `Field`, `MoneyField`, `Switch` | Vigente en main |

### Extensiones Foco y su estado

Cada extensión es una prop opcional sobre un componente existente. Mientras su consumidor no migra, cada componente conserva la presentación heredada; las pantallas Foco eligen la variante de forma explícita.

| Base | Pieza | Estado | Condición de compatibilidad |
|---|---|---|---|
| `DenseSection` | `surface?: "integrated" \| "outlined"` | Vigente en main | Adición opcional. `integrated` aplica Foco; `outlined` queda para límites operables justificados. El valor por defecto global se define cuando migraron los consumidores |
| `DenseTable` | `surface?: "integrated" \| "outlined"` | Vigente en main | Mismo criterio. Conserva selección, ordenación, `groupBy` y densidad; sigue siendo la misma tabla |
| `StatItem` | `pressed?: boolean` | Vigente en main | Para ítems que alternan un filtro. `active` y `onSelect` se mantienen. Un ítem que navega conserva semántica de enlace |
| `DenseWorkspace` | `role?: "region" \| "tabpanel"` y nombre accesible | Vigente en main | Los consumidores migran con rol explícito; `tabpanel` requiere su controlador de pestañas. El valor por defecto heredado se cambia con inventario de consumidores |
| `EmptyState` | `size?: "inline"` (se suma a `regular` y `compact`) | Vigente en main | Variante mínima para ausencias secundarias. `compact`, `regular`, `no-data` y `no-results` se mantienen |
| `DenseToggleGroup` | Selección múltiple con `aria-pressed` | Vigente en main (#91) | Se preserva en toda migración visual |
| `DenseTable` | `groupBy(row)` con encabezado de grupo y conteo | Vigente en main (#91) | Se preserva en toda migración visual |
| `ActionDrawer` | `initialFocus?: "content" \| "close"` | Vigente en main | Sin cambios |
| `Notice`, `ToastProvider`, `ActionDrawer` | API actual | Vigente en main | Foco ajusta consumo, composición y pruebas; la API queda igual |

#### Uso de las extensiones Foco

Cada extensión es una prop opcional. Sin ella, la pieza conserva su marcado y su semántica actuales. Las pantallas Foco la eligen de forma explícita; el valor por defecto global se decide en un corte posterior, con el inventario de consumidores.

- `DenseSection` y `DenseTable` con `surface`: usá `integrated` para leer sobre el lienzo. La sección se separa con `--ds-color-border-subtle` y la escala de espaciado; la tabla queda sin marco ni fondo y conserva selección, orden, `groupBy` y densidad. Usá `outlined` solo en un límite operable justificado. Uso incorrecto: encerrar en `outlined` datos de solo lectura por costumbre.
- `StatItem` con `pressed`: usalo en el ítem que alterna un filtro, junto con `onSelect` y `active`, para que `aria-pressed` refleje el filtro. Uso incorrecto: marcar `pressed` en un ítem que navega o en un texto sin `onSelect`.
- `DenseWorkspace` con `role`: usá `region` con nombre accesible cuando la pantalla no tiene pestañas. Usá `tabpanel` cuando un `DenseTabs` lo controla (su `idPrefix` seguido de `-panel` es el `panelId`). Uso incorrecto: `tabpanel` sin una pestaña que lo controle.
- `EmptyState` con `size="inline"`: usalo para una ausencia secundaria dentro de una sección, con su `kind`, título, descripción y acción. Uso incorrecto: un vacío de página completa o un estado de carga, que va en `AsyncState`.

### C01 — Encabezado y acciones

**Base:** `DenseHeader`, `Button`, `Icon`. **Estado:** vigente en main; Foco ajusta la composición.

| Campo | Contrato |
|---|---|
| Propósito y límite | Dar orientación y jerarquizar la próxima acción. Los indicadores van en C03; el encabezado no los repite |
| Entradas | `DenseHeader`: `title`, `description?`, `actions?`. `Button` distingue enlace de acción, `loading`, `disabled` e `iconOnly` con nombre accesible |
| Variantes | `primary`, `secondary`, `ghost`, `text`, `link`, `danger` y `danger-solid`. Es la única familia de botones |
| Anatomía | Un `h1` (24 px, `--ds-text-2xl`, peso 600), una línea de descripción y las acciones alineadas a la derecha. Como máximo una acción primaria por pantalla o panel activo; una pantalla de consulta puede no tener ninguna. Sin rótulo superior: el menú ya dice dónde se está |
| Estados | Datos, contenido extenso, restricción de acceso, actualización con datos previos identificados |
| Interacción | La pantalla decide disponibilidad y destino de cada acción. Capacidades y consultas se resuelven fuera del encabezado |
| Accesibilidad | Nombre accesible y foco visible en cada acción; `iconOnly` requiere `aria-label`; los enlaces conservan semántica de navegación |
| Tokens | `--ds-font-sans`, `--ds-text-2xl`, `--ds-control-height-md`, `--ds-space-4`, `--ds-space-6` |

**Aceptación observable:**
- Un título largo convive con las acciones sin superponerse.
- «Procesando» evita el envío duplicado.
- Una pantalla de consulta se muestra sin botón primario.

#### Button

- **Propósito:** unificar acciones y enlaces de acción con altura, foco, estados y carga normalizados.
- **Variantes:**

| Variante | Cuándo usarla |
|---|---|
| `primary` | Acción principal de la pantalla o panel; como máximo una. |
| `secondary` | Alternativa visible con contorno, como una acción hermana de la principal. |
| `ghost` | Cancelar, cerrar o realizar una acción de baja jerarquía sin caja persistente. |
| `danger` | Acción irreversible o de alto riesgo en pantallas, fichas y filas: texto rojo sobre fondo transparente. |
| `danger-solid` | Botón que confirma el riesgo dentro de un diálogo (`ConfirmDialog`, `DeletionDrawer`). |
| `text` | Acción breve en línea, como Reintentar o una acción secundaria de fila. |
| `link` | Navegación de acción con `href`; mantiene la semántica nativa de enlace. |

- **Tamaños:** `md` mide 40 px y es el tamaño estándar; `row` mide 32 px para filas y barras. `sm` se conserva como alias retrocompatible de `row`. La acción primaria del encabezado de página mide 40 px en todas las pantallas; con puntero coarse conserva el objetivo táctil de 44 px.
- **Props:** admite atributos nativos de `button`; con `href` renderiza un enlace y admite sus atributos nativos. `loading` y `loadingLabel` aplican a botones. `iconOnly` exige `aria-label` en el tipo público.
- **Estados:** hover/active por variante, `:focus-visible`, disabled y loading. Loading informa `aria-busy`, bloquea el control, muestra spinner y puede reemplazar el nombre accesible. Las variantes `text` y `link` usan tokens del sistema.
- **Rojo:** se reserva para lo irreversible. «Ocultar» es reversible y se muestra como acción neutra; «Eliminar» usa `danger`.
- **Correcto:**

```tsx
<Button type="submit" loading={saving} loadingLabel="Guardando">
  Guardar cambios
</Button>
<Button type="button" variant="ghost" onClick={cancel}>Cancelar</Button>
<Button type="button" variant="text" size="row" onClick={retry}>Reintentar</Button>
<Button href="#contactos" variant="link" size="row">Ver contactos</Button>
<Button type="button" iconOnly aria-label="Cerrar panel"><span aria-hidden="true">×</span></Button>
```

- **Incorrecto:**

```tsx
<Button>Guardar</Button>
<Button>Cancelar</Button>
<button className="custom-danger-button" onClick={remove}>Eliminar</button>
<Button iconOnly><span aria-hidden="true">×</span></Button>
```

Los dos primeros quedan como acción primaria por defecto. Elegí la jerarquía según el efecto y usá `Button` en vez de una familia CSS local; los controles icon-only siempre llevan nombre accesible.

#### Icon

- **Propósito:** renderizar un glifo SVG del catálogo `ICON_NAMES`.
- **Props:** `name: IconName`; `size` (20 por defecto), `strokeWidth` (1.8), `className` y `title` son opcionales.
- **Estados:** sin `title` es decorativo (`aria-hidden`); con `title` se expone como imagen con nombre accesible.
- **Correcto:**

```tsx
<Icon name="alert" /> <span>Revisar la consulta</span>
```

- **Incorrecto:**

```tsx
<Icon name="alert" aria-label="Alerta" />
```

`aria-label` no forma parte de las props; usá `title` para un icono informativo o acompañalo con texto.

### C02 — Secciones de lectura

**Base:** `DensePage`, `DenseSection`. **Estado:** vigente en main, incluida la prop `surface`.

| Campo | Contrato |
|---|---|
| Propósito y límite | Agrupar contenido con espacio y líneas. La sección ordena la lectura; los datos se leen sobre el lienzo |
| Entradas | `id?`, `title`, `count?`, `description?`, `actions?`, `children` |
| Variantes | `surface="integrated"` aplica Foco; `surface="outlined"` queda para límites operables justificados. La migración es explícita, consumidor por consumidor |
| Anatomía | Título `h2` asociado a la sección, conteo junto al título y contenido sobre el lienzo. La altura se ajusta al contenido |
| Estados | Datos, carga inicial, vacío confirmado, error local o parcial, actualización con datos previos identificados, contenido extenso |
| Interacción | Agrupa contenido. La consulta de datos y la interpretación de una lista vacía son de la pantalla |
| Accesibilidad | `id` estable y `aria-labelledby`; cada título de sección es distinguible por su texto |
| Tokens | `--ds-color-border-subtle`, `--ds-space-4`, `--ds-space-6`, `--ds-text-xl` |

**Aceptación observable:**
- Una sección con una sola fila ocupa el alto de esa fila.
- `count` se muestra con una respuesta confirmada; sin respuesta, el título va sin conteo.
- Las secciones de una pantalla comparten bordes izquierdo y derecho.

### C03 — Indicadores con alcance

**Base:** `StatStrip`, `StatItem`. **Estado:** vigente en main, incluida la prop `pressed`.

| Campo | Contrato |
|---|---|
| Propósito y límite | Resumir datos conocidos y decir su alcance. Cada indicador proviene de una fuente con respuesta; un estado global se muestra cuando todas sus fuentes respondieron |
| Entradas | `StatStrip`: `items` y `label`. Cada ítem: `key`, `label`, `value`, `detail?`, `tone?`, `active?`, `onSelect?`. La pantalla calcula los valores |
| Variantes | Lectura, navegación y filtro. `pressed` identifica al ítem que alterna un filtro; el ítem que navega es un enlace |
| Anatomía | Una línea discreta de cifras bajo el encabezado, valor y etiqueta separados, sin caja ni mayúsculas. Cada dato aparece una sola vez en la pantalla |
| Estados | Datos, carga inicial, vacío confirmado, error local o parcial, actualización con datos previos identificados, contenido extenso |
| Interacción | `onSelect` aplica el filtro o navega; las reglas de dominio se calculan en la pantalla. Un filtro seleccionado se puede restablecer |
| Accesibilidad | `aria-pressed` en los ítems que alternan un filtro; el grupo tiene `role="group"` y nombre. Un valor desconocido se expresa con texto |
| Tokens | `--ds-color-text`, `--ds-color-text-muted`, `--ds-text-xl`, `--ds-space-2`, `--ds-space-6` |

**Aceptación observable:**
- En carga, el indicador dice «pendiente».
- Ante un error, el indicador dice «no disponible».
- Los alcances fiscal y documental se muestran por separado; sumarlos requiere una definición de producto.

Sólo van cifras de la lista que se ve (cantidades, pendientes); el estudio, el cliente y el período ya están en el menú y en la barra de período. Una cifra que filtra la lista es un botón y queda resaltada mientras el filtro está activo.

### C04 — Tablas y agrupación

**Base:** `Table`, `DenseTable`, `DenseGroup`, `DenseFooter`. **Estado:** vigente en main, incluidas la agrupación `groupBy` (#91) y la prop `surface`.

| Campo | Contrato |
|---|---|
| Propósito y límite | Comparar registros y actuar conservando identidad, orden y acceso a la información |
| Entradas | `label`, `columns`, `rows`, `rowKey` y las capacidades existentes: selección, orden, `footer`, `inspectorOpen`. `groupBy(row)` devuelve `key`, `label` y `order` |
| Variantes | `Table` para leer; `DenseTable` para listas con selección, orden y detalle lateral. `surface="integrated"` / `"outlined"` sobre la misma tabla, con la densidad compartida y `groupBy` |
| Anatomía | Filas separadas por líneas, números a la derecha con cifras tabulares, nombre largo legible. La tabla ocupa el alto de su contenido |
| Estados | Datos, carga inicial, vacío confirmado, sin coincidencias, error local o parcial, restricción de acceso, actualización con datos previos identificados, contenido extenso |
| Interacción | Ordenar y seleccionar conservan la identidad de la fila. Agrupar conserva resultados y totales |
| Accesibilidad | Tabla semántica con `aria-sort`; las flechas saltan los encabezados de grupo y seleccionan filas. Las acciones de fila quedan a la vista |
| Tokens | `--ds-color-border-subtle`, `--ds-control-height-sm`, `--ds-text-sm`, `--ds-color-selected`, `--ds-table-head-height`, `--ds-row-height` |

**Aceptación observable:**
- A 1440×900 y 1280×720 la tabla entra en su contenedor y la página no desborda.
- Una tabla extensa se desplaza de forma deliberada, dentro de su contenedor.
- Importes y porcentajes quedan alineados a la derecha.
- «Sin coincidencias» se distingue de «sin registros».
- Selección y agrupación funcionan juntas.

`Table` y `DenseTable` son dos componentes con un mismo aspecto: comparten encabezado (`--ds-table-head-height`) y alto de fila (`--ds-row-height`). Las pantallas usan estos componentes en lugar de escribir `<table>`; las que quedan están registradas como deuda en `apps/web/src/ui/UiPatterns.test.ts`. La densidad de filas es una preferencia de la persona (`useDensity`: 28, 32 o 40 px), se guarda en el navegador, se aplica a todas las tablas y se cambia en un único lugar, el menú de ayuda del estudio.

#### Table

- **Propósito:** tabla semántica con cabecera, alineación opcional y estado vacío.
- **Props/variantes:** `columns`, `rows`, `rowKey`, `empty`; cada columna lleva `key`, `header`, `align` (`left`, `right`, `center`), `render` o `accessor`. Conserva atributos nativos de `table`.
- **Estados:** hover de fila, `focus-within`/selección cuando sus descendientes reciben foco, vacío personalizable; encabezado sticky y contenedor con scroll horizontal.
- **Correcto:**

```tsx
<Table
  columns={[{ key: "code", header: "Código", accessor: (row) => row.code }]}
  rows={activities}
  rowKey={(row) => row.id}
  empty={<EmptyState title="Sin actividades" description="Creá una actividad para empezar." />}
/>
```

- **Incorrecto:**

```tsx
<Table columns={columns} rows={activities} rowKey={() => "same-key"} />
```

La clave debe ser estable y única por fila. `Table` es una tabla de lectura; para filas seleccionables con teclado la pantalla actual usa `DenseTable`.

### C05 — Filtros y navegación

**Base:** `DenseToolbar`, `DenseTabs`, `DenseSearch`, `DenseToggleGroup`, `SectionIndex`. **Estado:** vigente en main; `DenseToggleGroup` llegó con #91. `DenseTabs` y `DenseSearch` viven en el adaptador web `apps/web/src/ui/Dense.tsx`.

| Campo | Contrato |
|---|---|
| Propósito y límite | Cambiar lo que se consulta. Una pestaña es una sección de la pantalla; el estado del negocio se expresa con C08 |
| Entradas | Los contratos actuales. `DenseToggleGroup` recibe `label`, `options` (pares `value` y `label`), `selected` y `onChange(next)`. `DenseTabs` recibe `label`, `tabs`, `active`, `onChange` e `idPrefix?` |
| Variantes | Filtro simple, selección múltiple y navegación de secciones |
| Anatomía | Un lugar por criterio, selección visible y acción «Quitar filtros». Agrupar es una opción distinta de filtrar |
| Estados | Datos, sin coincidencias, contenido extenso |
| Interacción | Los filtros conservan su lugar en la URL donde ya existe. Cambiar de sección conserva el estado del registro |
| Accesibilidad | Pestañas con teclado y selección; opciones múltiples con `aria-pressed`. Etiquetas persistentes además del placeholder |
| Tokens | `--ds-control-height-sm`, `--ds-space-2`, `--ds-space-4`, `--ds-color-primary` |

**Aceptación observable:**
- «Quitar filtros» devuelve la lista completa.
- La agrupación sobrevive a la migración de estilo.
- Cada estado se filtra con un solo control.

#### SectionIndex

- **Propósito:** navegar entre secciones relacionadas de la vista actual.
- **Props:** `items: { id, label, meta? }[]`; `label` opcional nombra el `nav` y por defecto es “Secciones de esta vista”.
- **Estados:** cada elemento crea un enlace `#id`; los metadatos se muestran cuando existen. Los estilos responsivos de estudio y portal permanecen en sus hojas contextuales.
- **Correcto:**

```tsx
<SectionIndex items={[{ id: "profile-data", label: "Datos personales" }]} />
```

- **Incorrecto:**

```tsx
<SectionIndex items={[{ id: "missing-target", label: "Datos personales" }]} />
```

Cada `id` debe coincidir con un destino único de la misma vista.

### C06 — Lista y detalle

**Base:** `DenseWorkspace`, `Inspector`, `InspectorSection`, `InspectorFacts`. **Estado:** vigente en main, con `role` configurable y nombre accesible; el valor por defecto sigue siendo `tabpanel`.

| Campo | Contrato |
|---|---|
| Propósito y límite | Consultar un registro en contexto, con la selección a la vista. El detalle ocupa lugar cuando hay un registro elegido |
| Entradas | `panelId`, `inspector?`, `children`. `Inspector` conserva título, cierre y metadatos |
| Variantes | Lista sola, o lista y detalle cuando la tarea lo justifica. `role="region"` con nombre cuando la pantalla no tiene pestañas; `role="tabpanel"` con su controlador asociado |
| Anatomía | Selección identificable; detalle con líneas y metadatos ordenados en columnas etiqueta/valor, sobre un solo nivel de superficie |
| Estados | Datos, carga inicial, vacío confirmado, error local o parcial, restricción de acceso, contenido extenso |
| Interacción | El detalle se abre por intención; al cerrarlo, el foco vuelve al origen. Cambiar de cliente limpia el detalle anterior según el flujo vigente |
| Accesibilidad | `region` con nombre cuando no pertenece a pestañas; `tabpanel` con controlador asociado. Cada rol responde a una función real |
| Tokens | `--ds-color-selected`, `--ds-color-border-subtle`, `--ds-space-6` |

**Aceptación observable:**
- Con el detalle abierto, la lista sigue legible.
- Cerrar el detalle devuelve el foco a la fila de origen.
- El detalle muestra datos de un solo cliente.

### C07 — Carga, error y vacío

**Base:** `AsyncState`, `DenseLoading`, `EmptyState`. **Estado:** vigente en main, incluida la variante `size="inline"`.

| Campo | Contrato |
|---|---|
| Propósito y límite | Distinguir ausencia confirmada, fallo, falta de acceso y datos todavía sin resolver |
| Entradas | `EmptyState`: `title`, `description?`, `action?`, `size` (`regular`, `compact` o `inline`) y `kind` (`no-data` o `no-results`). `AsyncState` conserva el reintento |
| Variantes | `size="inline"` para ausencias secundarias. Un bloque condicional se omite únicamente después de una respuesta exitosa y vacía |
| Anatomía | Mensaje proporcional al lugar que ocupa. El error queda junto a la fuente afectada |
| Estados | Datos, carga inicial, vacío confirmado, sin coincidencias, error local o parcial, restricción de acceso, actualización con datos previos identificados |
| Interacción | Reintentar repite la consulta local y conserva el trabajo del resto de la pantalla. Durante una actualización, los datos anteriores se identifican como tales |
| Accesibilidad | La carga se anuncia con `role="status"` y mantiene el foco en su lugar; el error recuperable trae su botón; el vacío es contenido ordinario, sin rol de alerta |
| Tokens | `--ds-text-base`, `--ds-color-text-muted`, `--ds-space-3`, `--ds-color-danger` |

**Aceptación observable:**
- Un error se muestra como error, con su reintento.
- «Vacío» y «sin coincidencias» ofrecen salidas distintas.
- Reintentar una fuente conserva el resto de la pantalla.

Todo vacío o bloqueo guía (P1): dice qué falta y ofrece el enlace o botón que lo resuelve. La carga se comunica con un estado de carga y los fallos con `Notice`; `EmptyState` comunica ausencia.

#### EmptyState

- **Propósito:** indicar qué falta con un título, una explicación breve y una única acción primaria cuando hay un paso disponible; tamaño regular o compacto.
- **Props/variantes:** `title` obligatorio; `description` comunica una explicación breve; `action` acepta una sola `ReactElement`, `kind` (`no-data` por defecto o `no-results`), `size` (`regular` por defecto, `compact` o `inline`), atributos nativos de `div`. `data-empty-kind` comunica el motivo sin depender del color.
- **Estados:** no tiene estados interactivos propios; el visual es decorativo y se oculta del árbol accesible. La acción conserva su semántica a través del control hijo.
- **Correcto:**

```tsx
<EmptyState
  size="compact"
  title="Todavía no hay actividades"
  description="Creá una actividad para vincularla a clientes."
  action={<Button onClick={openCreate}>Crear actividad</Button>}
/>
```

- **Incorrecto:**

```tsx
<EmptyState title="Cargando actividades…" />
```

La carga se representa con estado de carga; este componente comunica ausencia de contenido o de coincidencias.

El vacío usa `EmptyState` con título, explicación breve y una única acción primaria cuando hay un paso disponible. Indicá `kind="no-data"` cuando todavía no existen registros y `kind="no-results"` cuando los datos existen pero los filtros no encuentran coincidencias. En el segundo caso, la acción ofrece ajustar o limpiar los filtros.

**Correcto:**

```tsx
<EmptyState kind="no-results" title="Ninguna actividad coincide" description="Ajustá la búsqueda para consultar otras actividades." action={<Button variant="secondary" onClick={clearFilters}>Quitar filtros</Button>} />
```

**Incorrecto:**

```tsx
<EmptyState title="Sin resultados" description="Todavía no hay actividades." />
```

El primer ejemplo identifica que hay datos y propone un ajuste; el segundo confunde una lista filtrada con una lista todavía vacía.

#### AsyncState

- **Propósito:** representar carga o error de una consulta con una acción de reintento.
- **Props:** `loading`, `error`, `loadingLabel`, `errorTitle`, `errorDescription`, `onRetry`; `className` es opcional.
- **Estados:** carga usa `role="status"` y `aria-live="polite"`; error usa un `Notice` de tono `error` (`role="alert"`) con botón Reintentar; sin carga ni error devuelve `null`.
- **Correcto:**

```tsx
<AsyncState loading={query.isLoading} error={query.isError} loadingLabel="Cargando" errorTitle="No se pudo cargar" errorDescription="Reintentá la consulta." onRetry={() => void query.refetch()} />
```

- **Incorrecto:**

```tsx
<AsyncState loading={false} error={false} loadingLabel="" errorTitle="Vacío" errorDescription="Sin datos" onRetry={retry} />
```

Para ausencia de contenido, usá `EmptyState`; `AsyncState` cubre carga y usa `Notice` para el error.

### C08 — Estado y mensajes

**Base:** `StatusBadge`, `Notice`, `ToastProvider`/`useNotify`. **Estado:** vigente en main; Foco unifica el uso de los tres canales.

| Campo | Contrato |
|---|---|
| Propósito y límite | Distinguir tres cosas: el estado de un registro (`StatusBadge`), la situación de la pantalla (`Notice`) y el resultado de una acción (notificación) |
| Entradas | `Notice`: `tone` (`info`, `success`, `warning`, `error`), `title?`, `action?`, `children`. Notificación: `success`, `error`, `info`, con título y duración opcionales, sobre un proveedor único |
| Variantes | Punto y texto para estados. `Notice` cuando la situación merece un aviso. Notificación para el resultado de una acción; un pendiente persistente es una tarea de la pantalla |
| Anatomía | La orientación ordinaria es texto neutro. Como máximo un fondo de aviso por pantalla. Cada éxito se comunica una vez |
| Estados | Datos, error local o parcial, actualización con datos previos identificados |
| Interacción | El éxito se informa con la confirmación real del servidor. El error de campo permanece junto al campo. Los pendientes siguen visibles hasta resolverse |
| Accesibilidad | El texto nombra siempre el estado; el color acompaña. Error con `role="alert"` y el resto con anuncio `polite`, una sola vez |
| Tokens | `--ds-color-success`, `--ds-color-warning`, `--ds-color-danger`, `--ds-color-info`, `--ds-color-warning-subtle` |

**Aceptación observable:**
- Un acuse pendiente se muestra como tarea en la pantalla.
- Una advertencia sensible permanece visible.
- Una instrucción se lee en texto neutro.

#### Notice

`Notice` presenta un mensaje único con un icono visible, un tono semántico y una acción opcional. El contenido nunca depende sólo del color y un aviso no se anida dentro de otra caja.

| Tono | Cuándo usarlo | Anuncio accesible |
|---|---|---|
| `info` | Orientación o contexto que ayuda a continuar. | `role="status"` |
| `success` | Una acción terminó correctamente y conviene confirmar el resultado. | `role="status"` |
| `warning` | Hay un dato pendiente de revisar o una condición que permite continuar con atención. | `role="status"` |
| `error` | Una consulta o acción falló y hace falta informar el siguiente paso. | `role="alert"` |

El título de `Notice` es opcional. Sumá una acción cuando exista un siguiente paso concreto, por ejemplo `Reintentar`; mantené una sola acción primaria. Reservá `role="alert"` para errores; `info`, `success` y `warning` se anuncian como `status` con prioridad `polite`.

| Tono | Cuándo usar | Texto modelo |
|---|---|---|
| `info` | Orientación contextual para continuar una tarea | “El archivo se asociará a este pedido y quedará disponible para tu estudio.” |
| `success` | Confirmación de una acción completada | “Los cambios quedaron guardados y la ficha ya está actualizada.” |
| `warning` | Atención requerida con continuidad posible | “Revisá el período fiscal para completar el cálculo.” |
| `error` | Fallo que requiere recuperación explícita | “La consulta de obligaciones encontró un problema. Reintentá para actualizar el período.” |

`error` usa `role="alert"`. `info`, `success` y `warning` usan `role="status"` y `aria-live="polite"`. El componente define estos roles según `tone`; el icono aporta una marca reconocible sin depender del color. `action` presenta como máximo una acción clara.

**Correcto:**

```tsx
<Notice tone="warning" title="Revisá el período fiscal" action={<Button onClick={openFiscalSetup}>Configurar período</Button>}>
  Completá la configuración para continuar con el cálculo.
</Notice>
```

**Incorrecto:**

```tsx
<div className="warning-box" style={{ color: "orange" }}>
  <EmptyState title="Aviso" />
</div>
```

#### Textos modelo de avisos y vacíos

- Info: “El perfil está listo para revisar. Consultá los datos antes de guardar.”
- Éxito: “Los cambios quedaron guardados. Continuá con la próxima tarea.”
- Aviso: “Hay datos pendientes de revisar. Abrí el detalle para completar la ficha.”
- Error: “Reintentá la consulta para volver a cargar la cartera.”
- Sin datos: “Todavía no hay clientes” / “Creá el primer cliente para empezar.”
- Sin resultados: “Ningún cliente coincide” / “Ajustá la búsqueda o los filtros para consultar otros clientes.”

**Correcto:**

```tsx
<Notice
  tone="warning"
  title="Hay datos pendientes de revisar"
  action={<Button onClick={openReview}>Abrir detalle</Button>}
>
  Revisá la ficha para continuar con el período.
</Notice>

<EmptyState
  kind="no-results"
  title="Ningún cliente coincide"
  description="Ajustá la búsqueda o los filtros para consultar otros clientes."
/>
```

**Incorrecto:**

```tsx
<div className="form-error" role="status">Falló la consulta.</div>
<div className="alert-box"><Notice tone="error">Falló la consulta.</Notice></div>
<EmptyState title="Sin resultados" />
```

Usá `Notice` en vez de clases locales de aviso, evitá cajas anidadas y diferenciá `no-data` de `no-results`. Un estado vacío no presenta varias acciones primarias ni sustituye el mensaje de carga o el error de consulta.

#### Estados

En tablas, listas y avisos, un estado usa punto + texto plano; el texto siempre nombra el estado. La píldora (borde y fondo) se reserva para la cabecera de la ficha de un registro y la ficha/Resumen del cliente. El punto mide 8 px (`--ds-space-2`), queda centrado con el texto y es decorativo (`aria-hidden="true"`); el texto usa `--ds-color-text` y mantiene contraste mínimo de 4,5:1. El tono `ok` usa `--ds-color-success` sólo en el punto, nunca texto verde ni fondo verde en tablas.

| Tono | Uso | Color del punto |
|---|---|---|
| `ok` | Resultado correcto o activo | `--ds-color-success` |
| `warn` (aviso) | Pendiente o requiere atención | `--ds-color-warning` |
| `danger` (peligro) | Fallo, vencimiento o riesgo | `--ds-color-danger` |
| `info` | En curso o informativo | `--ds-color-info` |
| `muted` (neutro) | Borrador, inactividad o cierre normal | `--ds-color-text-muted` |

En Configuración fiscal, «Principal» identifica un atributo de la actividad y se presenta como texto neutro, sin punto. «Vigente» y «Finalizada» sí expresan estado y usan `StatusBadge`.

#### Estados del paquete y etiquetas visibles

| Clave | Etiqueta | Tono |
|---|---|---|
| `CONFIGURED` | Configurada | `ok` |
| `RESOLVED` | Resuelto | `ok` |
| `WAITING_INPUTS` | Esperando datos | `warn` |
| `READY_TO_CALCULATE` | Listo para calcular | `info` |
| `PARTIALLY_PAID` | Pago parcial | `warn` |
| `CHANGES_REQUESTED` | Cambios solicitados | `warn` |
| `RETIRED` | Retirado | `muted` |
| `INFO` | Informativo | `info` |
| `WARNING` | Aviso | `warn` |
| `BLOCKING` | Bloqueante | `danger` |
| `FINALIZED` | Finalizado | `muted` |
| `SUPERSEDED` | Reemplazado | `muted` |

**Correcto:**

```tsx
<StatusBadge status={row.status} />
<StatusBadge status={client.status} variant="pill" />
```

**Incorrecto:**

```tsx
<StatusBadge status={row.status} variant="pill" />
<span className="status-badge">{row.status}</span>
```

#### StatusBadge

- **Propósito:** presentar un estado contable con su etiqueta conocida o un fallback legible.
- **Props:** `status: string | null | undefined`; `className`, `label` y `variant` (`plain` por defecto o `pill`) son opcionales. `label` permite ajustar la etiqueta visible sin alterar la clave ni el tono. `getStatusBadgeMeta` expone la etiqueta y el tono resuelto; `StatusTone`, `StatusBadgeMeta` y `StatusBadgeVariant` son tipos públicos.
- **Estados:** normaliza espacios, guiones y mayúsculas; los estados conocidos usan su etiqueta/tono configurados y los desconocidos se humanizan como neutros. El DOM conserva `status-badge` y `data-status`, muestra siempre el texto y oculta el punto decorativo con `aria-hidden`.
- **Correcto:**

```tsx
<StatusBadge status={row.status} />
```

- **Incorrecto:**

```tsx
<span className="status-badge">{row.status}</span>
```

Usá el componente para conservar la normalización, etiqueta, tono y atributo de estado compartidos.

#### Notificaciones (`ToastProvider`, `useNotify`)

Canal para decir cómo terminó una acción, salvo el error de una acción de fila, que va junto a su botón. `notify.success` se cierra sola a los 5 s; `notify.error` queda hasta cerrarla; `notify.info` es para avisos sin resultado. Se monta una vez en la raíz de la app. El tono se lee en el icono: la tarjeta va sin fondo de color. El resultado vive en la notificación; `apps/web/src/ui/UiPatterns.test.ts` verifica que ninguna pantalla dibuje una cinta de «Acción completada» ni guarde un estado local para el recibo.

### C09 — Paneles y confirmación

**Base:** `ActionDrawer`, `ConfirmAction`/`ConfirmDialog`, `DeletionDrawer`, `Field`, `MoneyField`, `Switch`. **Estado:** vigente en main; Foco especifica sus estados.

| Campo | Contrato |
|---|---|
| Propósito y límite | Editar o ejecutar de forma deliberada, con la vista de lectura intacta detrás |
| Entradas | `ActionDrawer`: `isOpen`, `onClose`, `title`, `description?`, `children`, `footer?`, `size` (`default` o `wide`), `initialFocus` (`content` o `close`) |
| Variantes | Formulario, lectura detallada y confirmación separada para alto impacto. `danger-solid` confirma el riesgo |
| Anatomía | Contexto arriba, contenido desplazable y pie fijo abajo, con el mismo orden de botones en todos los paneles. Etiquetas persistentes y error junto al campo |
| Estados | Datos, error local o parcial, restricción de acceso, contenido extenso, envío en proceso |
| Interacción | Escape y Cancelar cierran; el foco queda contenido y se restaura al cerrar. «Procesando» impide el doble envío. Las validaciones fiscales son del dominio y se conservan |
| Accesibilidad | Diálogo con nombre y descripción, primer foco deliberado y Tab contenido dentro del panel |
| Tokens | `--ds-control-height-md`, `--ds-color-border-strong`, `--ds-color-focus`, `--ds-space-4`, `--ds-space-6` |

**Aceptación observable:**
- Con contenido largo, el pie sigue alcanzable.
- Un error conserva lo que la persona cargó.
- El botón de guardar se mantiene habilitado y, al intentar, señala lo que falta; si se deshabilita, el motivo está visible al lado (P4).
- Los parámetros de comportamiento se eligen en un desplegable alimentado por catálogo (P2).

#### ActionDrawer

- **Propósito:** panel lateral accesible para formularios y acciones transaccionales.
- **Props:** `isOpen`, `onClose`, `title`, `children`; `description`, `footer`, `closeLabel`, `size` (`default` o `wide`) e `initialFocus` (`content` o `close`) son opcionales. Lleva título y, si hace falta, una línea de descripción, sin rótulo superior.
- **Estados:** cerrado no renderiza DOM; abierto presenta `role="dialog"`, mueve el foco al primer control, limita Tab/Shift+Tab, cierra con Escape, bloquea el scroll del body y restaura el foco previo al cerrar. El panel estándar ocupa el alto completo de la ventana, desplaza el contenido internamente y conserva el pie visible.
- **Correcto:**

```tsx
<ActionDrawer isOpen={open} onClose={close} title="Nuevo cliente">
  <ClientForm />
</ActionDrawer>
```

- **Incorrecto:**

```tsx
<ActionDrawer isOpen={open} title="Nuevo cliente">
  <ClientForm />
</ActionDrawer>
```

Proporcioná siempre `onClose` para el cierre explícito, el scrim y Escape.

#### ConfirmAction y ConfirmDialog

Anatomía del pie de un cajón (Foco 2.7a). El pie va en la prop `footer` de `ActionDrawer`; si tiene acción principal, se compone con `ActionDrawerFooter`: «Cancelar» (ghost) a la izquierda y la acción principal a la derecha, en el mismo renglón; el motivo del botón deshabilitado va en su propio renglón arriba, a todo el ancho y alineado a la derecha (Foco 2.8). El submit del formulario se asocia al botón con `form=`.

- **Propósito:** pedir confirmación in-app antes de ejecutar una acción; `useConfirmAction` administra una solicitud por página y `ConfirmDialog` la presenta.
- **Props:** `ConfirmAction` recibe `open`, `title`, `confirmLabel`, `onConfirm` y `onCancel`; `description`, `tone` (`default` o `danger`) y `cancelLabel` son opcionales. `ConfirmDialog` recibe el estado `confirm` y un `cancelLabel` opcional.
- **Estados:** cerrado no renderiza DOM; abierto expone `role="alertdialog"`, enfoca Confirmar, contiene el foco, cierra con Escape y restaura el foco anterior. El tono danger selecciona la variante destructiva del botón.
- **Correcto:**

```tsx
const confirm = useConfirmAction();
<ConfirmDialog confirm={confirm} />
```

- **Incorrecto:**

```tsx
<ConfirmAction open title="Dar de baja" confirmLabel="Confirmar" onConfirm={save} />
```

Incluí `onCancel` y describí la consecuencia de la acción cuando aporte contexto.

#### Field

- **Propósito:** input HTML con label, hint, prefijo, error y estados visuales accesibles.
- **Props/variantes:** atributos nativos de `input`; `label`, `error`, `hint`, `prefix`; `id` explícito o derivado de `name`; forwardRef.
- **Estados:** hover, foco visible, error (`aria-invalid` y `aria-describedby`), disabled y read-only. El hint se oculta cuando hay error para conservar una sola explicación próxima al campo.
- **Correcto:**

```tsx
<Field id="activity-code" label="Código" hint="Ej.: SERV4" value={code} onChange={onCodeChange} />
```

- **Incorrecto:**

```tsx
<Field placeholder="Código de actividad" value={code} onChange={onCodeChange} />
```

El placeholder no reemplaza un label persistente; proporcioná `label` y una asociación de id.

#### MoneyField

- **Propósito:** campo monetario argentino que presenta agrupación `es-AR` y conserva un valor decimal normalizado para estado/API.
- **Props/variantes:** `value: string` normalizado y `onChange(value: string)`; recibe las demás props de `Field` excepto `type`, `value` y `onChange`; aplica prefijo `$` y `inputMode="decimal"`.
- **Estados:** hereda label, hint, error, foco, disabled y read-only de `Field`; limita a dos decimales y conserva el cursor al reagrupar miles.
- **Correcto:**

```tsx
<MoneyField id="amount" label="Importe" value="1234567.89" onChange={setAmount} />
```

- **Incorrecto:**

```tsx
<MoneyField id="amount" label="Importe" value="1.234.567,89" onChange={setAmount} />
```

El valor de estado/API es normalizado (`1234567.89`); el formato local sólo corresponde a la presentación.

#### Switch

Prende o apaga algo que se guarda al instante (un módulo, una preferencia), con el estado escrito al lado. Recibe `checked`, `onChange(next)` y `label` (nombre accesible); acepta `text` y `busy`. Se expone con `role="switch"` y `aria-checked`; mientras guarda, `busy` bloquea otro clic. Apagar algo que afecta a otros pide confirmación. Dentro de un formulario que se envía después va una casilla.

### Familia Dense del paquete

| Export | Contrato de props o retorno |
|---|---|
| `DenseDensity`, `useDensity` | `DenseDensity` admite `28`, `32` y `40`; `useDensity()` devuelve `[density, setDensity]`, persiste la elección en `contable.dense.rowHeight` y usa `32` como valor inicial o de respaldo. |
| `normalizeSearch(value)` | Normaliza texto a minúsculas, sin tildes y sin espacios al inicio o al final. |
| `DensePage` | Requiere `density` y `children`; acepta `flow` (por defecto `false`) y `className`. |
| `DenseSection` | Requiere `title` y `children`; acepta `id`, `count`, `description`, `actions` y `surface` (`integrated` u `outlined`; sin la prop, la presentación actual). |
| `DenseHeader` | Requiere `title`; acepta `description` y `actions`. |
| `StatStrip`, `StatItem` | `StatStrip` requiere `items` y `label`. Cada item requiere `key`, `label` y `value`; acepta `detail`, `tone="warn"`, `active`, `onSelect` y `pressed`. Un item seleccionable se representa como botón; `pressed` expone `aria-pressed` solo en un item que alterna un filtro. |
| `DenseToolbar` | Agrupa `children` dentro de la barra de herramientas. |
| `DensitySwitch` | Requiere `value: DenseDensity` y `onChange(next)`. |
| `DenseToggleGroup`, `DenseToggleOption` | Requiere `label`, `options` (pares `value` y `label`), `selected` (valores activos) y `onChange(next)`; cada opción es un botón con `aria-pressed` y `next` sigue el orden de `options`. |
| `DenseWorkspace` | Requiere `panelId` y `children`; acepta `inspector` para habilitar la columna lateral y `role` (`tabpanel` por defecto, o `region`, que exige `aria-label` o `aria-labelledby` en el tipo). |
| `DenseTable`, `DenseColumn<T>` | `DenseTable<T>` requiere `label`, `columns`, `rows` y `rowKey`; acepta `selectedKey`, `onSelect`, `rowClassName`, `empty`, `footer`, `inspectorOpen`, `groupBy` y `surface` (`integrated` u `outlined`). `groupBy(row)` devuelve `{ key, label, order }`: agrupa las filas bajo un encabezado con su conteo, ordenado por `order`; el teclado salta los encabezados. Cada columna requiere `key`, `header` y `render`; acepta `sortValue`, `secondary`, `align="right"`, `width`, `className` y `sticky="right"`. |
| `ShortcutHint` | Requiere `items`, una lista de pares `[tecla, descripción]`. |
| `DenseFooter` | Requiere `count` y `noun`; acepta `hint` y `newShortcut` (por defecto `true`). |
| `DenseLoading` | Requiere `label`; anuncia la carga con `role="status"`. |
| `Inspector` | Requiere `label`, `title` y `children`; acepta `subtitle`, `leading`, `onClose`, `footer` y `banner`. |
| `InspectorSection` | Requiere `title` y `children`. |
| `InspectorFacts` | Requiere `items`, una lista de pares `[término, valor]`; omite valores `null`. |
| `useDenseShortcuts` | Requiere `searchRef`; acepta `onNew` y `onEscape`. `/` enfoca la búsqueda, `N` activa el alta y `Esc` cierra el detalle. |

### Estados y composición Dense

- `StatStrip` expresa los estados `active` y `tone="warn"`; su callback selecciona el item y el grupo tiene nombre accesible.
- `DensitySwitch` expone la opción elegida con `aria-pressed`; `useDensity` conserva la selección entre visitas.
- `DenseTable` ordena al activar una cabecera con `sortValue`, alterna ascendente/descendente, oculta columnas `secondary` cuando `inspectorOpen` está activo y comunica selección con `aria-current`. Las filas seleccionables aceptan Enter/Espacio y flechas arriba/abajo.
- `DenseWorkspace` activa el layout lateral cuando recibe `inspector`; `DensePage` conserva su variante de flujo mediante `flow`.
- La lista de paquetes de Reglas fija su tope de flujo en `--dense-flow-max` = `--ds-table-head-height` + 7 × `--ds-space-12`, para que entren siete filas de 45 px. El resto de las listas de flujo conserva el tope de 340 px del paquete.
- `Inspector` presenta de forma opcional banner, cierre y pie; `DenseLoading` distingue la espera del estado vacío.
- `useDenseShortcuts` ignora escritura en campos editables y diálogos abiertos.

`DenseTabs`, `DenseSearch` y `DenseAlert` permanecen en el adaptador de web `apps/web/src/ui/Dense.tsx`; consumen el `Icon` compartido del paquete y la hoja Dense publicada.

**Correcto:**

```tsx
<DensePage density={32}>
  <DenseHeader title="Cartera" description="Clientes del estudio" />
  <DenseWorkspace
    panelId="clientes-panel"
    inspector={<Inspector label="Detalle del cliente" title="Cliente">Ficha del cliente</Inspector>}
  >
    <DenseTable<Cliente>
      label="Clientes"
      columns={[{ key: "name", header: "Cliente", render: (client) => client.name }]}
      rows={clients}
      rowKey={(client) => client.id}
    />
  </DenseWorkspace>
</DensePage>
```

**Incorrecto:**

```tsx
<DenseTable<Cliente> label="Clientes" columns={columns} rows={clients} rowKey={() => "cliente"} />
```

`rowKey` devuelve una identidad estable y única por fila; `DenseWorkspace` recibe el panel de detalle cuando la pantalla ofrece selección y ficha lateral.

### Reglas de uso e inventario del paquete

| Componente/patrón | Destino normativo |
|---|---|
| `Button`, `Field`, `MoneyField`, `Table`, `EmptyState`, `Notice` | Primitivas públicas de `packages/design-system/src` |
| Familia Dense del paquete | Primitivas públicas de `packages/design-system/src`; contratos detallados arriba |
| `DenseTabs`, `DenseSearch`, `DenseAlert` | `DenseTabs` y `DenseSearch` permanecen en el adaptador web. `DenseAlert` se conserva para pantallas fuera de este corte; las pantallas migradas usan `Notice`. |
| Orientación y "próximo paso" | Cuando la pantalla tiene un próximo paso, es su botón principal del encabezado, no un aviso; una pantalla de consulta puede no tener botón principal. Si hace falta orientar, se usa texto neutro, `Notice` con tono `info` o `DenseAlert` con tono `hint` (sin fondo ni color de estado). El tono `success` se reserva para confirmar una acción recién hecha; no se usa para estados permanentes ni para guiar, porque comparte el verde de la marca. Como máximo un aviso con fondo por pantalla |
| Notificaciones (`ToastProvider`, `useNotify`) | Canal para decir cómo terminó una acción, salvo el error de una acción de fila, que va junto a su botón. `notify.success` se cierra sola a los 5 s; `notify.error` queda hasta cerrarla; `notify.info` para avisos sin resultado. Se monta una vez en la raíz de la app. El tono se lee en el icono: la tarjeta no usa fondo de color. Ninguna pantalla dibuja una cinta de "Acción completada" ni guarda un estado local para el recibo: `apps/web/src/ui/UiPatterns.test.ts` falla si reaparece |
| Cómo se comunica cada cosa | Acción que salió bien → notificación. Acción que falló → notificación de error; si el error es de un campo o de un formulario abierto, además junto al campo o dentro del panel. Estado que bloquea el trabajo de la pantalla → un `Notice` fijo, como máximo uno. Todo en orden → nada, o texto gris con tilde |
| Menú del estudio (`StudyShell`) | Dos niveles: **Estudio** (lo de toda la cartera) y **Cliente** (lo del cliente elegido, en el orden del trabajo del mes), más **Ajustes del estudio** (en main, «Configuración del estudio»), siempre a la vista. El cliente se elige una sola vez, con el selector del bloque Cliente; sin cliente, sus secciones se muestran deshabilitadas con el motivo. La barra superior queda sólo para el período contable, en las pantallas que lo necesitan. Cada ítem lleva el icono declarado en `moduleRegistry` |
| Iconos | Los iconos del paquete (`Icon`) se muestran: acompañan a la etiqueta en el menú y en botones, y pueden ir solos sólo en botones con `aria-label`. No se ocultan con reglas globales |
| Encabezado de pantalla (`DenseHeader`) | Uno por pantalla: título (24 px, peso 600), una línea de descripción debajo y, a la derecha, las acciones con una sola principal. No lleva rótulo superior: el menú ya dice dónde se está |
| Resumen de pantalla (`StatStrip`) | Una línea discreta de cifras bajo el encabezado, sin caja ni mayúsculas. Sólo cifras de la lista que se ve (cantidades, pendientes); el estudio, el cliente o el período no van acá porque ya están en el menú y en la barra de período. Una cifra que filtra la lista es un botón y queda resaltada mientras el filtro está activo |
| Acciones riesgosas (`Button` `danger` / `danger-solid`) | En pantallas, fichas y filas el peligro es discreto: `variant="danger"`, texto rojo sobre fondo transparente. El rojo sólido (`danger-solid`) es exclusivo del botón que confirma dentro de un diálogo (`ConfirmDialog`, `DeletionDrawer`). Nunca hay una columna de botones rojos |
| Interruptor (`Switch`) | Prende o apaga algo que se guarda al instante (un módulo, una preferencia), con el estado escrito al lado. Apagar algo que afecta a otros pide confirmación. Dentro de un formulario que se envía después va una casilla |
| Tablas (`Table`, `DenseTable`) | Dos componentes con un mismo aspecto: `Table` para leer y `DenseTable` para listas con selección, orden y detalle lateral. Comparten encabezado (`--ds-table-head-height`) y alto de fila (`--ds-row-height`). No se escribe `<table>` en una pantalla; las cuatro que quedan están registradas como deuda en `UiPatterns.test.ts` |
| Densidad de filas (`useDensity`) | Preferencia de la persona, no de la pantalla: un solo valor (28, 32 o 40 px) guardado en el navegador y aplicado a todas las tablas. Se cambia en un único lugar, el menú de ayuda del estudio. Ninguna barra de filtros lleva el selector |
| Dónde va cada error | **Campo inválido**: debajo del campo. **No se pudo guardar un formulario o cajón**: `Notice` de error dentro del mismo formulario, junto a los botones. **No se pudo cargar una lista**: `Notice` de error con botón Reintentar en el lugar de la lista. **Falló una acción de fila**: el error va junto al botón que la disparó. **Falló una acción de barra** (enviar, publicar, descargar, activar): `notify.error`, nunca un aviso al pie de la página. `actionErrorMessage` arma el texto |
| Títulos de paneles, cajones y fichas | Título y, si hace falta, una línea de descripción. `ActionDrawer` e `Inspector` no tienen rótulo superior; los paneles tampoco |
| Confirmaciones | Toda acción destructiva o que afecta a otros pasa por `ConfirmDialog` (`useConfirmAction`): dice qué va a pasar y el botón nombra la acción. No se usa `window.confirm` |
| Eliminación definitiva | Borrar algo que arrastra datos (un paquete de reglas, un cliente) no ocupa una caja propia en la pantalla: es una acción chica `variant="danger"` junto al título. Pide dos confirmaciones: primero `ConfirmDialog` explica qué se pierde; después `DeletionDrawer` muestra el impacto y pide escribir el nombre |
| Ficha con secciones | Una pantalla con varias secciones de un mismo objeto usa `DenseTabs` arriba, con un **Resumen** como pestaña predeterminada, y una tabla a ancho completo por pestaña. No se apilan cajas ni se ponen dos tablas en columnas |
| Estilos de pantallas (`apps/web/src/study/styles/`) | `study.css` es sólo un índice que importa, en orden, un archivo por área (base, cartera, documentos, operación fiscal, ficha, bandeja…). El orden importa: los posteriores ajustan a los anteriores. Lo que sirve a más de una pantalla va al sistema de diseño, no a estos archivos. Una clase que ya no usa ninguna pantalla se borra junto con el cambio que la dejó sin uso |
| `StatusBadge` | Público en `packages/design-system/src`; conserva el contrato `status`/`className` y los estilos globales/contextuales existentes en la aplicación |
| `ActionDrawer`, `ConfirmAction`, `ConfirmDialog`, `useConfirmAction` | Públicos en `packages/design-system/src`; CSS propio de drawers en el paquete |
| `AsyncState`, `Icon`, `SectionIndex` | Públicos en `packages/design-system/src`; `SectionIndex` conserva las reglas de layout de estudio/portal en sus hojas de aplicación |
| `DeletionDrawer` | Permanece en `apps/web/src/ui`: consulta y elimina mediante `lib/api` y `@tanstack/react-query`; el CSS y la prueba de integración también permanecen en la app |
| Tabla, píldora, aviso y botón de texto | Unificar en `Table`/`DenseTable`, `StatusBadge`, `Notice` y la API textual de `Button` |

Los componentes migrados mantienen imports compatibles en las pantallas existentes. Las reglas visuales que dependen del contexto de estudio o portal permanecen en las hojas de estilo de la aplicación.

## 6. Patrones de pantalla

Cada pantalla de Contable sigue una receta. Hay tres recetas con nombre propio —**R01 Inicio**, **R02 Legajo** y **R03 Reglas fiscales**— y una **receta general, RG**, que usan las demás. La tabla «Pantalla → receta» del final de esta sección asigna una receta a cada pantalla del estudio, del portal y de acceso.

Una receta define la composición y lo que se conserva. Las consultas, los permisos y las reglas de dominio de cada pantalla siguen siendo los del producto: la receta ordena la presentación.

### Composición: sin cajas y alineación

1. Separá los grupos con `--ds-space-0-5` y los tokens de espaciado documentados; alinealos a una grilla común con los mismos bordes izquierdo y derecho.
2. Usá `--ds-color-border-subtle` como línea divisoria fina entre secciones y filas de tablas/listas, nunca alrededor de cada dato.
3. Usá caja solo para lo que se opera: campos, controles, tablas/paneles interactivos, popovers y modales; mantené lectura y datos relacionados en espacio y líneas.
4. Alineá etiquetas y valores por columna y línea base; alineá los números a la derecha con cifras tabulares, sin elementos flotantes ni centrados.
5. Extendé listas y bloques al ancho de la grilla para que terminen en el mismo borde derecho.
6. Mostrá cada dato una sola vez por pantalla y un único fondo de aviso por pantalla, con el tono semántico correspondiente.

### RG — Receta general

**Propósito:** dar a toda pantalla el mismo orden de lectura, de arriba hacia abajo.

**Composición:**
1. **Encabezado (C01):** un título, una línea de descripción y las acciones, con una sola principal como máximo.
2. **Indicadores (C03), opcional:** una línea de cifras de la lista que se ve, con su alcance.
3. **Filtros y navegación (C05), opcional:** pestañas de sección, búsqueda, filtros y agrupación; cada criterio en un solo lugar.
4. **Contenido:** una de tres disposiciones.
   - **Lista:** una tabla a ancho completo (C04).
   - **Lista y detalle:** tabla más detalle lateral que se abre por intención (C04 y C06).
   - **Secciones:** secciones de lectura apiladas sobre el lienzo, cada una con su tabla o sus datos (C02 y C04). Una ficha con varias secciones de un mismo objeto usa `DenseTabs` arriba, con un **Resumen** como pestaña predeterminada, y una tabla a ancho completo por pestaña.
5. **Estados (C07 y C08):** cada fuente de datos muestra su propia carga, su vacío y su error con reintento; hay como máximo un aviso con fondo en la pantalla.
6. **Edición y confirmación (C09):** altas y ediciones en `ActionDrawer`; lo riesgoso pasa por `ConfirmDialog`; la eliminación definitiva suma `DeletionDrawer`.

**Estados que toda pantalla contempla:** carga inicial, datos, vacío confirmado, sin coincidencias (si filtra), error local o parcial, restricción de acceso, actualización con datos previos identificados y contenido extenso.

**Aceptación:** a 1440×900 y 1280×720 la página entra sin desborde horizontal y cada tabla entra en su contenedor; hay un solo `h1`; hay como máximo una acción primaria; todo vacío o bloqueo ofrece su salida (P1); los nombres coinciden con el glosario (P3).

**Formularios:** altas y ediciones usan `ActionDrawer` con título, descripción y campos `Field`; los selects usan `label.ds-field` y `.ds-field__input`, como indica la guía UI. El envío muestra loading y Cancelar usa ghost. El pie usa `ActionDrawerFooter`: «Cancelar» a la izquierda, la acción principal a la derecha y, junto a ella, el motivo mientras la principal está deshabilitada. Un bloque que ocupa las dos columnas del formulario usa la clase `.study-form__full`.

**Confirmación destructiva:** ocultar o desactivar explica qué se conserva (historial y vínculos). La eliminación definitiva pide dos confirmaciones: primero `ConfirmDialog` explica qué se pierde; después `DeletionDrawer` obtiene un preview de impacto, dependencias y bloqueos, pide escribir el nombre y habilita «Eliminar definitivamente» cuando no hay bloqueos, con el motivo a la vista cuando los hay. Las acciones respetan capacidades y propiedad del registro.

**Guía existente:** se conserva como referencia la [guía de formularios y paneles](docs/guia-ui-formularios-paneles.md), que establece `ActionDrawer`, gestión del foco, Escape, cancelación y acciones sticky.

### R01 — Inicio

**Propósito:** mostrar qué hay para resolver en el alcance de quien entra (el estudio en `/`, la empresa del cliente en `/portal`) y llevar a la pantalla donde se resuelve.

**Fechas y períodos:** los períodos y vencimientos de Inicio usan el formato único de la sección «Fechas y períodos».

**Vigente en main (se conserva):** el recordatorio de acuses de presentación pendientes (#87) y su presentación ajustada (#90); «Liquidaciones en curso» deja afuera las liquidaciones `FINALIZED` y `SUPERSEDED` (#90), porque lo finalizado sin presentar ya figura en el recordatorio de acuses.

**Foco 2.8:** las acciones de fila de las tres tablas (Liquidaciones, Otros circuitos y acuses) usan la pieza de enlace `dense-link`, igual que «Ver todas» y «Abrir obligaciones»; el texto «Abrir» y el nombre accesible no cambian. Los contadores de Inicio y de la banda del Legajo concuerdan con el número (singular con 1).

**Composición:**
1. Encabezado C01 con el alcance del estudio y «Actualizar» como acción secundaria.
2. Indicadores C03 con su alcance.
3. Pendientes accionables, con los datos necesarios para decidir.
4. Acuses pendientes y liquidaciones en curso como listas separadas, cada una con su fuente y su conteo.
5. Otros circuitos y panorama como contenido secundario, sobre el lienzo.

**Acuses, información que se conserva:** cliente, impuesto, período, vencimiento, antigüedad desde la finalización y «Abrir legajo» según capacidad. Se mantiene la ordenación inicial del producto (la más antigua primero) y se anuncia otra ordenación si la persona la cambia.

**Decisión de producto pendiente de Inti (G07):** la prioridad relativa entre correcciones, acuses y vencimientos. Esta guía no la fija: la receta mantiene visibles los tres tipos de trabajo y conserva el orden vigente en main hasta que Inti lo defina. La ubicación en la pantalla es composición, no una regla de riesgo.

| Estado o evento | Respuesta |
|---|---|
| Carga inicial | Indicador discreto de carga; las cifras dicen «pendiente» |
| Datos | Filas accionables, acceso al contexto y campos esenciales |
| Vacío confirmado | El bloque condicional de acuses se omite, como define #87 |
| Error de acuses | Error y Reintentar locales; las demás fuentes siguen disponibles |
| Actualización | «Actualizar» alcanza resumen, liquidaciones en curso y acuses; los datos previos se identifican como tales |
| Falta de acceso | La pantalla dice que la fuente está restringida para el rol y muestra el resto |
| Abrir legajo | Conserva el cliente y sigue el flujo del producto para el contexto fiscal |
| Liquidación finalizada o reemplazada | Figura fuera de «en curso» |

**Estado: migrada** (Foco 1, corte 1). Lo vigente tras la migración: encabezado con «Actualizar» como acción secundaria y «Revisar bandeja» como única primaria; cifras con «pendiente», «no disponible» o «restringido» en lugar de cero; acuses y liquidaciones en listas separadas, con sus estados propios, y obligaciones pendientes a continuación, en el orden de main; otros circuitos y panorama como secciones secundarias del lienzo, sin panel lateral; región de trabajo con nombre accesible. **Cumple G03** (para esta pantalla), **G05** y **G06** (sección 7). G07 sigue pendiente de Inti.

**Estado (Foco 2.7c):** cada acción de fila de Inicio es un botón `ghost` con nombre completo: «Abrir liquidación de <impuesto>, versión N», «Abrir legajo de <cliente>» y «Abrir <circuito>» en Otros circuitos, con un solo tratamiento. El dato secundario de «Impuesto» va en renglón propio (la misma regla de Reglas, Foco 2.7a). «Abrir obligaciones» y «Ver clientes» tienen relleno vertical de objetivo.

### R02 — Legajo

**Propósito:** consultar un período y continuar sus tareas, distinguiendo pestaña, etapa y estado del legajo.

**Fechas y períodos:** el período del legajo y las fechas de pago, presentación y cálculo usan el formato único de la sección «Fechas y períodos».

**Composición:** encabezado C01; contexto de cliente, impuesto, período y revisión; estado en texto (C08); advertencia de autorrevisión visible; secciones con pestañas (C05); tabla (C04); respaldo y metadatos en detalle o panel (C06 y C09).

**Entradas de pantalla:** identificación de contexto, estado, revisión, capacidades, fuentes de saldos y enlaces de respaldo. Los saldos y la posibilidad de cargar o rectificar los resuelve el dominio; la tabla los presenta.

**Variantes:** consulta y edición según los permisos reales de quien entra.

**Interacciones que se conservan:** cambiar período, consultar fuentes y respaldo, importar, rectificar y ver historial cuando el flujo actual los habilita.

**Estados:** carga con el contexto del registro que se está abriendo; restricción con su explicación; vacío de saldos acotado a la sección de saldos; error local; actualización identificada; tabla extensa con acceso al respaldo.

**Aceptación:** pasar de Saldos a Fuentes conserva «Finalizado» como estado; la advertencia de revisión por la misma persona que preparó queda a la vista; el identificador y la evidencia siguen accesibles en el detalle; al cerrar el panel, el foco vuelve al origen.

**Estado: migrada** (Foco 2). Lo vigente tras la migración: encabezado con «Nuevo legajo» como acción secundaria; cada revisión se lee en una tarjeta con sus etapas; las etapas con consultas muestran el error con «Reintentar»; una sola acción primaria por tarjeta, la de su estado, que va en la línea «ETAPA N DE 6», a la derecha y antes de la barra de etapas, para verse sin desplazar a 1280×720 en cualquier etapa (Foco 2.8); el encabezado de etapa es opaco (`--ds-color-surface`) y su período se muestra como mes; «Finalizar», «Crear rectificativa» y «Eximir» piden confirmación, y el diálogo de «Eximir» nombra el control y cita el motivo escrito; el contador de controles bloqueantes es información de la tarjeta y no una región de alerta; la carga de una etapa se anuncia una sola vez; el motivo de «Resolver» y «Eximir» va junto a los botones, que no cambian de lugar al escribir; una revisión reemplazada se lee como resumen de solo lectura. Desvíos declarados: la tarjeta del legajo conserva su borde de contenedor (las etapas no llevan caja propia), y las reglas de composición propias del Legajo (`workpaper-*`) siguen vigentes porque el marcado las usa; retirarlas exige rehacer ese marcado con piezas del sistema y queda como trabajo posterior.

### R03 — Reglas fiscales

Estado (Foco 2.7a): los cajones de Reglas usan el pie fijo de `ActionDrawerFooter` con «Cancelar» a la izquierda y el motivo junto a la acción principal; «Activar versión» conserva su cajón (decisión D-R3-B de Inti, fila A3) con el pie de `ActionDrawerFooter`; «Opción de cálculo» preselecciona la opción de origen y dice la consecuencia al cambiarla; la lista cuenta «N de M paquetes» cuando no entran todas las filas; Vencimientos, Fuentes, Control profesional y Probar van sin caja. Pendiente: la pestaña Alícuotas sigue con caja (hallazgo 26 de ux).

**Fechas y períodos:** las vigencias, las fechas de versión, de fuente y de vencimiento usan el formato único de la sección «Fechas y períodos».

**Propósito:** elegir un paquete, comprender su versión y vigencia, y preparar cambios de forma deliberada.

**Composición:** encabezado C01 con el alta global como acción secundaria; lista y detalle (C06); metadatos; pestañas (C05); tabla (C04); una acción contextual destacada, que es la principal del panel.

**Entradas de pantalla:** paquetes visibles para el rol, versión seleccionada, estado, vigencia, parámetros y capacidades. Alícuotas, revisores y activación son del dominio.

**Variantes:** versión vigente de lectura y borrador editable, conforme al producto. La activación directa y la revisión existentes se mantienen como están.

**Interacciones que se conservan:** selección de paquete; consulta de alícuotas, vencimientos, fuentes y control; preparación de una modificación; creación global, permisos y confirmaciones. Preparar un borrador deja intacta la versión vigente.

**Estados:** carga, error local con la lista disponible, restricción, vacío de paquetes, actualización y texto extenso.

**Aceptación:** la versión vigente se identifica como de sólo lectura; el paquete seleccionado se ve en la lista; hay una acción contextual principal.

**Estado: migrada** (Foco 3). Lo vigente tras la migración: «Nuevo paquete» como acción secundaria, y como primaria solo cuando no hay paquetes; una sola acción primaria por panel; el error de una consulta va junto al dato afectado, con «Reintentar» (`reglas/Errores.tsx`); el resumen de la versión va sin caja. Desvíos declarados: Alícuotas y Control profesional conservan la caja `study-panel`, y las reglas `fiscal-rule-*` que el marcado usa siguen vigentes; la caja y esas reglas quedan como trabajo posterior.

**Catálogos fiscales** usa esta misma receta: una sola `DenseTabs` con los conteos de las cinco categorías; debajo, una línea breve con propios, referencia y alertas. La barra de filtros, la tabla y el detalle comparten la grilla; los datos del detalle usan columnas etiqueta/valor y los conteos numéricos se alinean a la derecha. Cada conteo aparece una vez, las cifras van a la derecha y la tabla tiene el ancho del resto de la pantalla.

### Matriz de información y acciones preservadas

| Receta | Información esencial | Accesos que se conservan |
|---|---|---|
| R01 Inicio | Cliente, impuesto, período, vencimiento, antigüedad, estado de liquidación y alcance de cada fuente | Abrir legajo, consultar liquidación, filtrar, actualizar y reintentar |
| R02 Legajo | Contexto fiscal, revisión, estado, advertencia de autorrevisión, importes, movimientos y evidencia | Cambiar período, navegar secciones, ver respaldo e historial, importar y rectificar según capacidades; **Exportar libros** (encabezado, acción secundaria; la ve quien tiene `tax.vouchers.read`): descarga el libro de compras o de ventas del período activo en xlsx o csv, con resumen previo de incluidos y excluidos por motivo |
| R03 Reglas fiscales | Paquete, versión, vigencia, estado, parámetros y condición de lectura | Elegir paquete, consultar secciones, preparar modificación, alta global |
| R03 Calendarios fiscales | Organismo, jurisdicción, año, versión, estado, celdas (concepto, grupo de terminaciones, período, vencimiento, ajuste y revisión), validación de cobertura, versiones y quién las publicó u ocultó | Crear calendario, agregar, editar y quitar celdas en borrador, crear versión a partir de este, publicar, ocultar y mostrar. Solo lectura sin `tax.calendars.manage`; publicar solo con `tax.calendars.publish` |
| RG | La información que la pantalla muestra hoy | Todas las acciones que la pantalla ofrece hoy, según capacidades |

**Estado (Foco 2.7c), Calendarios fiscales:** el alta usa el pie `ActionDrawerFooter` («Cancelar» a la izquierda y «Crear calendario» a la derecha) y muestra el motivo junto al botón mientras no se puede crear. La ficha en borrador concuerda en singular y plural y, con un solo problema, ofrece un único enlace («Ir al problema»). La lista muestra el estado elegido en «Estado», con «Todos» para volver a la lista completa (selección múltiple), y el encabezado «Año» muestra su indicador de orden (`sortHint` de `DenseTable`). El subtítulo usa voseo.

Cada PR de migración incluye su matriz antes/después de información y accesos.

### Pantalla → receta

Cubre todas las pantallas de `apps/web/src` en main: 18 del estudio (`study/`), 9 del portal (`portal/`) y 5 de acceso (4 en `auth/` y «sin acceso», que vive en `App.tsx`), 32 en total. La columna de familias y componentes es la composición destino: los componentes que la pantalla todavía no usa en main se incorporan en su corte. La columna «Corte» es el orden de migración; el corte 0 son las extensiones de primitivas, previo a toda pantalla.

| Nº | Pantalla (ruta) | Archivo | Receta | Familias y componentes Foco (composición destino) | Corte |
|---:|---|---|---|---|---:|
| 1 | Inicio (`/`) | `study/StudyDashboard.tsx` | R01 | C01, C02, C03, C04, C07, C08 — `DenseHeader`, `StatStrip`, `DenseSection`, `DenseTable`, `DenseWorkspace`, `InspectorFacts`, `AsyncState`, `EmptyState`, `StatusBadge` (migrada) | 1 (migrada) |
| 2 | Legajo (`/expediente-mensual`) | `study/StudyExpedienteMensual.tsx` | R02 | C01, C02, C03, C04, C05, C06, C07, C08, C09 — `DenseHeader`, `StatStrip`, `DenseTabs`, `Table`, `StatusBadge`, `ActionDrawer`, `MoneyField` | 2 (migrada) |
| 3 | Reglas fiscales (`/reglas-fiscales`) | `study/StudyReglasFiscales.tsx` | R03 | C01, C03, C04, C05, C06, C07, C08, C09 — `DenseHeader`, `DenseTabs`, `DenseTable`, `DenseWorkspace`, `ActionDrawer`, `ConfirmDialog`, `DeletionDrawer` | 3 (migrada) |
| 4 | Catálogos fiscales (`/catalogos-fiscales`) | `study/StudyCatalogosFiscales.tsx` | R03 | C01, C04, C05, C06, C07, C08, C09 — `DenseTabs`, `DenseSearch`, `DenseTable`, `Inspector`, `ActionDrawer`, `DeletionDrawer` | 4 |
| 5 | Clientes (`/clientes`) | `study/StudyClientes.tsx` | RG, lista y detalle | C01, C03, C04, C05, C06, C07, C08, C09 — `StatStrip`, `DenseToggleGroup`, `DenseTable` con `groupBy`, `Inspector`, `ActionDrawer` | 5 |
| 6 | Usuarios y accesos (`/administracion`) | `study/StudyAdministracion.tsx` | RG, lista y detalle | C01, C03, C04, C05, C06, C07, C08, C09 — `DenseTabs`, `DenseTable`, `Inspector`, `ActionDrawer`, `ConfirmDialog` | 6 |
| 7 | Módulos de estudios (`/administracion-plataforma`) | `study/StudyAdministracionPlataforma.tsx` | RG, lista | C01, C03, C04, C05, C07, C09 — `StatStrip`, `DenseSearch`, `DenseTable`, `Switch`, `ConfirmDialog` | 6 |
| 8 | Resumen del cliente (`/resumen-cliente`) | `study/StudyResumenCliente.tsx` | RG, secciones | C01, C02, C04, C05, C07, C08 — `DenseHeader`, `DenseTabs`, `Table`, `EmptyState`, `StatusBadge` | 7 |
| 9 | Configuración fiscal (`/configuracion-fiscal`) | `study/StudyOnboardingFiscal.tsx` | RG, secciones | C01, C02, C04, C05, C07, C08, C09 — `DenseTabs`, `Table`, `StatusBadge`, `ActionDrawer`, `ConfirmDialog` | 7 |
| 10 | Bandeja documental (`/bandeja`) | `study/StudyBandeja.tsx` | RG, lista y detalle | C01, C03, C04, C05, C06, C07, C08, C09 — `StatStrip`, `DenseSearch`, `Table`, `StatusBadge`, `ActionDrawer`, `ConfirmDialog` | 7 |
| 11 | Trabajo (`/trabajo`) | `study/StudyTrabajo.tsx` | RG, secciones | C01, C02, C03, C04, C07, C08, C09 — `StatStrip`, `DenseSection`, `Table`, `StatusBadge`, `ActionDrawer` | 7 |
| 12 | Liquidaciones (`/liquidaciones`) | `study/StudyLiquidaciones.tsx` | RG, lista | C01, C02, C03, C04, C07, C08, C09 — `StatStrip`, `Table`, `StatusBadge`, `ActionDrawer` | 7 |
| 13 | Rentabilidad (`/rentabilidad`) | `study/StudyRentabilidad.tsx` | RG, secciones | C01, C02, C03, C07, C08, C09 — `StatStrip`, `DenseSection`, `StatusBadge`, `ConfirmDialog` | 7 |
| 14 | Ayuda (`/ayuda`) | `study/StudyAyuda.tsx` | RG, secciones | C01, C02, C05 — `DenseHeader`, `DenseSection`, `SectionIndex` | 9 |
| 15 | Estados de ruta: módulo no disponible y página no encontrada del estudio y del portal | `study/StudyRouteStates.tsx` | RG, sólo estados | C07 — `EmptyState` con su salida | 9 |
| 16 | Contabilidad (`/contabilidad`, no liberada) | `study/StudyContabilidad.tsx` | RG, secciones | C01, C02, C03, C04, C07, C08, C09 — `StatStrip`, `Table`, `StatusBadge`, `ActionDrawer`, `MoneyField` | 10 |
| 17 | Reportes y análisis (`/reportes`, no liberada) | `study/StudyReportes.tsx` | RG, secciones | C01, C02, C03, C04, C07, C08, C09 — `StatStrip`, `Table`, `StatusBadge`, `ConfirmDialog` | 10 |
| 18 | Asistente contable (`/asistente`, no liberada) | `study/StudyAsistente.tsx` | RG, secciones | C01, C02, C07, C08 — `DenseHeader`, `DenseSection`, `EmptyState`, `Notice` | 10 |
| 19 | Inicio del portal (`/portal`) | `portal/PortalDashboard.tsx` | R01 | C01, C02, C05, C07 — encabezado, secciones «Para resolver» y accesos, `SectionIndex`, `AsyncState` | 8 |
| 20 | Pendientes (`/portal/pendientes`) | `portal/PortalPendientes.tsx` | RG, lista | C01, C02, C04, C05, C07, C08 — `Table`, `StatusBadge`, `EmptyState`, `Notice` | 8 |
| 21 | Subir documentos (`/portal/upload`) | `portal/PortalUpload.tsx` | RG, secciones | C01, C02, C04, C05, C07, C08, C09 — formulario de carga, `Table`, `StatusBadge`, `Notice` | 8 |
| 22 | Impuestos (`/portal/impuestos`) | `portal/PortalObligaciones.tsx` | RG, lista | C01, C02, C04, C05, C07, C08 — `Table`, `StatusBadge`, `EmptyState` | 8 |
| 23 | Liquidaciones (`/portal/liquidaciones`) | `portal/PortalLiquidaciones.tsx` | RG, lista | C01, C02, C04, C05, C07, C08 — `Table`, `StatusBadge`, `EmptyState` | 8 |
| 24 | Rentabilidad (`/portal/rentabilidad`) | `portal/PortalRentabilidad.tsx` | RG, secciones | C01, C02, C05, C07, C08 — secciones Devengado y Caja, `EmptyState`, `Notice` | 8 |
| 25 | Estados y reportes (`/portal/reportes`) | `portal/PortalReportes.tsx` | RG, lista | C01, C02, C04, C05, C07, C08 — `Table`, `EmptyState`, `Notice` | 8 |
| 26 | Mensajes (`/portal/mensajes`) | `portal/PortalMensajes.tsx` | RG, lista y detalle | C01, C02, C05, C06, C07, C08, C09 — conversaciones y respuesta, `EmptyState`, `Notice` | 8 |
| 27 | Perfil (`/portal/perfil`) | `portal/PortalPerfil.tsx` | RG, secciones | C01, C02, C05, C07, C08, C09 — `Field`, `Notice`, `EmptyState` | 8 |
| 28 | Ingreso y verificación en dos pasos (`/login`) | `auth/LoginPage.tsx` | RG, formulario en página | C01, C08, C09 — título y descripción, `Field`, `Notice`, `Button` | 11 |
| 29 | Cambio de contraseña temporal (`/cambiar-contrasena`) | `auth/ChangePasswordPage.tsx` | RG, formulario en página | C01, C07, C08, C09 — título y descripción, `Field`, `Notice`, `Button`, estados de sesión | 11 |
| 30 | Aceptar invitación al portal (`/aceptar-invitacion`) | `auth/AcceptPortalInvitation.tsx` | RG, formulario en página | C01, C07, C08, C09 — título y descripción, `Field`, `Notice`, `Button`, estado de enlace incompleto | 11 |
| 31 | Recuperar acceso (`/recuperar-acceso`) | `auth/RecoverAccessPage.tsx` | RG, formulario en página | C01, C07, C08, C09 — título y descripción, `Field`, `Notice`, `Button`, estado de enlace incompleto | 11 |
| 32 | Sin acceso (`/sin-acceso`), carga de sesión y conexión no disponible | `App.tsx` | RG, sólo estados | C07 — `EmptyState` con su salida, carga | 11 |
| 33 | Calendarios fiscales (`/calendarios-fiscales`) | `study/StudyCalendariosFiscales.tsx` | R03 | C01, C02, C04, C05, C07, C08, C09 — `DensePage`, `DenseHeader`, `DenseToolbar`, `DenseTabs`, `DenseSection` (`surface="integrated"`), `DenseTable` con `groupBy`, `DenseToggleGroup`, `InspectorFacts`, `ActionDrawer`, `ConfirmDialog`, `Field`, `StatusBadge`, `AsyncState`, `EmptyState`, `useNotify` | nace en Foco |

**Desvío de Clientes (D5-11):** la pantalla no tiene «Actualizar»: la lista se refresca al mutar y al volver a la pestaña, y el estado «actualización con datos previos identificados» no aplica a esta pantalla.

**Pantallas de acceso (28 a 32).** Se muestran sin menú ni barra de período, antes de entrar a un espacio de trabajo. Usan RG con estas precisiones, todas con piezas vigentes en main:

- **El formulario es el contenido de la página:** campos `Field` y un solo botón principal. No va en `ActionDrawer`, porque no hay una lista detrás del panel.
- **Un `h1` y una línea de descripción (C01).** En main estas pantallas llevan un rótulo sobre el título (`login__secure` en Ingreso, Aceptar invitación y Recuperar acceso; `no-workspace__eyebrow` en «sin acceso» y en conexión no disponible) y un título de 30 a 44 px; adoptan la anatomía de C01 en su corte.
- **Mensajes (C08):** el error del envío va en `Notice` de tono `error` dentro del formulario; el resultado que se informa al volver a `/login` va en `Notice` de tono `success`. Así está en main.
- **Estados (C07):** enlace incompleto, sesión que se está validando, conexión no disponible y cuenta sin espacio asignado dicen qué pasó y ofrecen su salida (P1).
- **Lo vigente se preserva:** los pasos del ingreso (incluido el código de seis dígitos), los mínimos de contraseña, las redirecciones y los textos de seguridad son del producto. La receta ordena la presentación.

**Piezas de dominio y de apoyo** (viven dentro de una pantalla y migran con ella):

| Archivo | Pantalla que la usa | Familias Foco |
|---|---|---|
| `study/PendingFilingReceipts.tsx` | Inicio | C02, C04, C07 |
| `study/WorkpaperSourceReviewAction.tsx` | Legajo | C01, C09 |
| `study/RuleSimulator.tsx` | Reglas fiscales | C04, C08, C09 |
| `study/StudyUserAssignments.tsx` | Usuarios y accesos | C07, C09 |
| `study/ExtractionFiscalTable.tsx` | Bandeja documental | C04 |
| `study/ManualExtractionFieldsDialog.tsx` | Bandeja documental | C04, C09 |
| `study/ManualExtractionValueControl.tsx` | Bandeja documental | C09 |
| `portal/PortalUI.tsx` | Las nueve pantallas del portal (`PortalPageHeader`, `PortalLoading`, `PortalRetryButton`) | C01, C07 |
| `study/moduleRegistry.tsx` | Registro de módulos y rutas del estudio (sin interfaz propia) | — |
| `environment/EnvironmentStatusBanner.tsx` | Todas las rutas, incluidas las de acceso: aviso «Entorno incompleto» sobre el contenido. Migra en el corte 11 | C08 |

**Resto de `apps/web/src`** (archivos `.tsx` que no son pantalla; no llevan receta ni corte propio):

| Archivo | Qué es | Por qué queda fuera de la tabla de pantallas |
|---|---|---|
| `shells/StudyShell.tsx`, `shells/PortalShell.tsx`, `shells/ContextBar.tsx` | Marco de navegación: menú del estudio, barra del portal y barra de período | Rodean a todas las pantallas y no son una de ellas. Los rige la fila «Menú del estudio» de la sección 5. Ningún corte de esta tabla los incluye: el corte que los toque se define en el plan de implementación |
| `ui/GuidedTour.tsx` | Recorrido guiado del estudio | Lo monta `StudyShell` y va con el marco de navegación |
| `ui/ActionDrawer.tsx`, `ui/AsyncState.tsx`, `ui/ConfirmAction.tsx`, `ui/DeletionDrawer.tsx`, `ui/Dense.tsx`, `ui/Icon.tsx`, `ui/SectionIndex.tsx`, `ui/StatusBadge.tsx` | Adaptadores web de componentes del paquete | Son primitivas: sus contratos están en las familias C01 a C09 de la sección 5 y sus extensiones van en el corte 0 |
| `components/forms/FieldErrorsFromDetails.tsx` | Lista de errores por campo que devuelve la API, dentro de un formulario | Pieza de formulario (C09); migra con las pantallas que la usan: Legajo, Reglas fiscales y Catálogos fiscales |
| `context/ClientContext.tsx`, `session/SessionContext.tsx`, `main.tsx` | Proveedores de cliente y de sesión, y arranque de la app | Sin interfaz propia |
| `demo/Demo.tsx` | Muestra interna de componentes del paquete | Ningún archivo la importa y no tiene ruta: no es alcanzable desde el sitio |

**Orden de migración:**

| Corte | Qué migra | Condición |
|---:|---|---|
| 0 | Extensiones de primitivas: semántica de filtros y de lista-detalle (`pressed`, `role`), superficies (`surface`) y vacío `inline` | Los consumidores actuales conservan su presentación |
| 1 | Inicio (R01) | Estados independientes por fuente y actualización completa (G05, G06) |
| 2 | Legajo (R02) | Matriz de accesos antes/después |
| 3 | Reglas fiscales (R03) | Matriz de accesos antes/después |
| 4 | Catálogos fiscales | Misma receta R03 |
| 5 | Clientes | Agrupación y selección por terminación de CUIT intactas (G08) |
| 6 | Usuarios y accesos; Módulos de estudios | — |
| 7 | Pantallas del cliente: Resumen del cliente, Configuración fiscal, Bandeja documental, Trabajo, Liquidaciones, Rentabilidad | En el orden del trabajo del mes |
| 8 | Portal: Inicio del portal primero y luego las otras ocho | `PortalUI.tsx` converge en las familias C01 y C07; el encabezado del portal, que en main lleva rótulo superior, adopta la anatomía de C01 |
| 9 | Ayuda y estados de ruta | — |
| 10 | Contabilidad, Reportes y análisis, Asistente contable | Migran antes de liberarse |
| 11 | Acceso: Ingreso, Cambio de contraseña temporal, Aceptar invitación, Recuperar acceso, «sin acceso» con los estados de sesión, y el aviso de entorno | Los pasos del ingreso, las redirecciones y los textos de seguridad quedan intactos; todo estado ofrece su salida (P1); el encabezado adopta la anatomía de C01 |

Los cortes 1 a 3 siguen el orden del contrato Foco v1 (Inicio; Legajo y Reglas; resto). El orden de los cortes 4 a 11 agrupa pantallas que comparten receta y es un borrador: el plan de implementación define el orden final.

## 7. Accesibilidad

### Medido y presente

- Los pares medidos y sus dos resultados **bajo el mínimo** están en la sección 2; el cálculo usa los valores sólidos y la fórmula WCAG indicados.
- `global.css` define `:focus-visible` con outline de 2 px; `Button` y `Field` añaden tratamientos propios. `Field` vincula label, hint y error por id, y expone `aria-invalid` en error.
- `ActionDrawer` usa `role="dialog"`, `aria-modal`, nombre/descripción accesibles, mueve foco al primer control, mantiene Tab/Shift+Tab dentro, cierra con Escape, bloquea scroll y restaura foco. El shell ofrece skip-link y nombre de navegación.
- `DenseTabs` implementa `tablist`/`tab`, estado seleccionado y flechas izquierda/derecha. `DenseTable` ofrece selección por teclado y ordenación con botones nativos; con `groupBy`, las flechas saltan los encabezados de grupo. `DenseToggleGroup` expone cada opción con `aria-pressed`.
- El design system fija `--ds-touch-target` en 44 px. `Button` llega a esa altura para puntero coarse; `Field` usa 44 px en pantallas estrechas o puntero coarse; las celdas de `Table` crecen a 44 px para puntero coarse.

### Compromisos de implementación Foco (G01–G08)

Cada brecha es un compromiso del PR que implementa su pieza. Base de verificación: lectura de código de `origin/main`.

| Nº | Pieza | Situación en main | Compromiso | Tipo |
|---|---|---|---|---|
| G01 | `DenseSection`, `DenseTable` | Composición con marcos en los consumidores heredados | `surface="integrated"` opcional y migración explícita, consumidor por consumidor | Vigente en main |
| G02 | `StatStrip` | El ítem de filtro marca `active` de forma visual y sus botones no exponen `aria-pressed` | `pressed` comunica la selección en los ítems que alternan un filtro; los que navegan son enlaces | Vigente en main |
| G03 | `DenseWorkspace` | `role="tabpanel"` fijo, también en pantallas sin pestañas | `role="region"` con nombre, o `tabpanel` con su controlador | Vigente en main; cumplido en Inicio (Foco 1, corte 1) |
| G04 | `EmptyState` | Tamaños `regular` y `compact` | `size="inline"` para ausencias secundarias | Vigente en main |
| G05 | `PendingFilingReceipts` | Usa `query.data ?? []` y devuelve `null` con cero filas, sin separar carga y error | Estados locales de carga y de error con Reintentar; el bloque se omite únicamente tras una respuesta vacía | Cumplido en Inicio (Foco 1, corte 1) |
| G06 | «Actualizar» de Inicio (`StudyDashboard`) | Refresca resumen y liquidaciones en curso | Incluye la consulta de acuses y dice qué alcanza la actualización | Cumplido en Inicio (Foco 1, corte 1) |
| G07 | Inicio | El orden visual entre circuitos no define una prioridad fiscal | **Decisión de producto pendiente de Inti.** Hasta entonces se conservan a la vista correcciones, acuses y vencimientos, en el orden vigente | Producto pendiente |
| G08 | `DenseToggleGroup`, `DenseTable.groupBy` | Vigentes en main (#91) | Se preservan en toda migración visual, con sus pruebas | Compatibilidad |

Ninguno de estos compromisos agrega reglas de negocio ni cambia permisos.

### Aceptación de accesibilidad de cada PR

Todo PR que implementa una pieza o migra una pantalla a Foco verifica, sobre los componentes React reales:

- **Zoom al 200 %:** el contenido y las acciones siguen disponibles y legibles a 1440×900 y 1280×720.
- **Lector de pantalla:** nombres accesibles, roles, estados (`aria-pressed`, `aria-sort`, `aria-current`, `aria-invalid`) y anuncios de carga, error y resultado, cada uno una sola vez.
- **Teclado:** recorrido completo, foco visible, foco contenido en paneles y diálogos, y foco restaurado al cerrar.
- **Contraste:** los pares de la sección 2; todo par nuevo se mide y se agrega a esa tabla.
- **Layout:** sin desborde de página y tabla dentro de su contenedor, con pruebas automáticas en ambos viewports.

La galería del contrato Foco v1 validó composición e interacción sobre HTML de referencia; el zoom, el lector de pantalla y los indicadores no textuales se validan en el PR de implementación.

### Brechas observadas previas, vigentes

- `--ds-color-text-disabled` sobre `--ds-color-control-disabled` mide 3,91:1 frente al umbral general. `--ds-color-text-faint` cumple sobre las superficies generales, muted y hover; la fila muted seleccionada queda en 4,3786:1, según la tabla de contraste y la decisión de conservar el token exacto.
- En Dense UI varios objetivos interactivos quedan por debajo del objetivo interno de 44 px: `.dense-tab` tiene `min-height: 36px`; `.dense-input` y `.dense-select` miden 30 px; botones de `.dense-seg` miden 28 px. En el shell, `.study__nav-link` tiene 42 px. El botón móvil de menú sí mide 44 px.
- `Field` relaciona su error mediante `aria-describedby` pero no añade `role="alert"`; por eso el anuncio inmediato recomendado por la guía de formularios y paneles no está garantizado en el componente por sí solo.
- La tabla genérica `Table` usa semántica nativa, pero no implementa selección/foco de fila ni manejo de flechas; las listas con selección obtienen ese soporte mediante `DenseTable`.

## 8. Cómo extender

### Migración a Foco por corte

- **Un corte, una pieza.** Cada PR implementa una pieza (una extensión de primitiva o una pantalla de la tabla «Pantalla → receta») y, en el mismo PR, actualiza su sección de `DESIGN.md`: el rótulo pasa de «extensión aprobada, implementación pendiente» a «vigente en main» y la tabla refleja la pantalla migrada.
- **Cada PR declara su principio.** La descripción dice qué principio (P1–P5) atiende y qué causa de fondo cierra. Un arreglo que vale para una sola pantalla explica por qué no va a la pieza compartida.
- **Una sola biblioteca.** Foco evoluciona los componentes de `packages/design-system/src` con props opcionales y conserva sus nombres. Lo que sirve a más de una pantalla va al paquete; un defecto de una pieza se corrige en la pieza.
- **El CSS heredado se retira al final.** Una regla de `apps/web/src/study/styles/` o de `portal.css` se borra en el PR que migra a su último consumidor, junto con el cambio que la deja sin uso. Mientras quede un consumidor, la regla se conserva.
- **Lo vigente se preserva.** Toda migración conserva la información y los accesos de la pantalla (matriz antes/después), la agrupación y selección por terminación de CUIT (#91) y las reglas de Inicio (#87 y #90).
- **Un patrón se corrige una vez.** Un hallazgo que se repite en dos pantallas se trata como patrón y se corrige en la pieza compartida.
- **Producto decide producto.** Cambios de reglas de negocio, permisos o flujos se proponen a Ciro y los decide Inti. Una decisión pendiente (por ejemplo G07) se anota como pendiente en la guía y la pantalla conserva el comportamiento vigente.

### Tokens

- Foco v1 usa los tokens existentes. Creá un token cuando un valor represente una decisión semántica compartida por más de un componente/pantalla, un estado reutilizable o una escala que deba mantenerse coherente. Para una excepción local de una sola vista, primero verificá si ya existe un token apropiado; no agregues aliases que dupliquen valores.
- Nombrá por familia, rol y estado con la convención existente: por ejemplo `--ds-color-primary-hover`, `--ds-space-4`, `--ds-text-sm`, `--ds-radius-md` y `--ds-shadow-control`. Usá nombres semánticos para color/estado y escalas para dimensiones; los sufijos de estado deben identificar el estado funcional.
- Definí el valor en `packages/design-system/src/tokens.css`; reutilizalo desde componentes o pantallas y verificá contraste, foco, teclado y objetivo táctil en el contexto donde se usa.

### Pruebas que protegen la guía

- Actualizá `DESIGN.md` en el mismo PR que modifique tokens, familias, componentes o patrones. La prueba `packages/design-system/src/design-md.test.ts` comprueba que cada token citado exista y que todos los tokens de color, tipografía y radio queden documentados.
- La prueba `packages/design-system/src/design-literals.test.ts` controla por archivo los literales px de `font-size`/`font`, `padding`/`margin`/`gap`, `border-radius` y los colores `#hex`/`rgb()` en CSS y estilos inline TSX de `apps/web/src` y `packages/design-system/src`; excluye `tokens.css`, cero y el ancho de borde de 1 px.
- Para regenerar `packages/design-system/literals-baseline.json`, ejecutar `node packages/design-system/scripts/design-literals.mjs --write`. El script compara contra la línea base vigente y rechaza cualquier aumento; el baseline solo puede bajar al migrar literales, nunca ampliarse para aceptar nuevos.
- `apps/web/src/ui/UiPatterns.test.ts` impide que reaparezcan patrones retirados: confirmación o recibo dibujados en la pantalla, botón de peligro sólido fuera de una confirmación, selector de densidad en una pantalla, tabla escrita a mano, rótulo sobre un título y confirmación del navegador.
- Las medidas de layout (desbordes, anchos, orden de botones, pie del panel) a 1440×900 y 1280×720 se verifican con pruebas automáticas.
