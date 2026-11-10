# Contable — guía del sistema de diseño

Fuente versionada de uso visual e interacción. Los valores fuente viven en `packages/design-system/src/tokens.css`; esta guía describe sus valores reales y cómo se aplican hoy en `apps/web/src`. Si cambia un token o un componente, actualizá esta guía en el mismo PR. La guía UI existente de formularios y paneles sigue siendo la referencia detallada de interacción transaccional: [Guía UI — formularios y paneles emergentes](docs/guia-ui-formularios-paneles.md).

## 1. Principios

1. **Resolver el trabajo diario del estudio.** Contable reemplaza planillas Excel de estudios contables: priorizamos lectura rápida de datos fiscales, estados trazables y acciones claras dentro de la vista de trabajo.
2. **Escritorio primero, como estado actual.** La interfaz densa se organiza para el espacio de escritorio. El alcance de diseño móvil está fuera de alcance por ahora; los breakpoints y comportamientos móviles ya presentes se documentan como comportamiento existente, no como objetivo nuevo.
3. **Claridad antes que decoración.** Contraste, jerarquía, alineación y estados explican qué dato se consulta y qué efecto tendrá una acción. La ornamentación no compite con contenido operativo.
4. **Una acción principal por pantalla o panel.** La acción principal se destaca; alternativas, cierre y cancelación usan jerarquía secundaria o ghost.
5. **Preservar contexto, trazabilidad y reversibilidad.** Las operaciones transaccionales mantienen visible el cliente/período y explican impacto, validación y resultado; una acción de alto impacto requiere confirmación adecuada.

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
| `--ds-color-text-faint` | `#756f65` | Texto auxiliar tenue | Eyebrows, pistas cortas y datos secundarios sobre superficie clara | Texto de lectura larga o texto sobre superficie muted (ver contraste) |
| `--ds-color-text-disabled` | `#777268` | Texto deshabilitado | Controles disabled | Contenido activo o texto de ayuda |
| `--ds-color-border` | `#d8d2c7` | Separador estándar | Bordes de paneles, controles y divisiones | Texto o indicador de estado por sí solo |
| `--ds-color-border-subtle` | `#e7e2d9` | Separador suave | Líneas internas y filas | Bordes de foco |
| `--ds-color-border-strong` | `#aaa398` | Separador enfatizado | Límites de controles y bordes con mayor presencia | Texto de contenido |
| `--ds-color-control-disabled` | `#ece8df` | Fondo disabled | Controles deshabilitados | Superficies activas |
| `--ds-color-focus` | `#256247` | Indicador de foco | Outline y borde de foco visible | Decoración sin interacción |
| `--ds-color-focus-subtle` | `#c9dfd3` | Tono suave de foco | Tono semántico de halo de foco; token declarado, sin consumidor directo observado | Fondo general; el halo actual usa `--ds-shadow-focus` |
| `--ds-color-primary` | `#256247` | Acción/enlace principal | CTA, enlaces, selección activa y estados positivos | Fondo neutro o texto sobre una superficie oscura sin evaluar contraste |
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
| `--ds-color-success` | `#256247` | Éxito | Texto de confirmación, coherencia y estados correctos | Usarlo como único indicador sin texto/icono |
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
| `--ds-color-text-faint` / `--ds-color-background` | 4,69:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-faint` / `--ds-color-surface` | 4,90:1 | Normal / 4,5:1 | Cumple |
| `--ds-color-text-faint` / `--ds-color-surface-muted` | 4,29:1 | Normal / 4,5:1 | **Bajo el mínimo** |
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

Los dos pares **bajo el mínimo** quedan registrados sin modificar los tokens ni las pantallas. El contraste de texto disabled se informa frente al umbral general; las excepciones normativas aplicables a controles inactivos requieren evaluación contextual.

## 3. Tipografía

Las familias reales están declaradas en `packages/design-system/src/tokens.css` y cargadas desde `apps/web/src/styles/fonts.css`: Source Sans 3 para UI y Source Serif 4 para encabezados y cifras destacadas, con las pilas fallback indicadas. `fonts.css` entrega Source Sans 3 en pesos 400/600/700 y Source Serif 4 en 400/600.

| Token | Valor real | Uso observado |
|---|---|---|
| `--ds-font-sans` | `"Source Sans 3", system-ui, -apple-system, sans-serif` | Cuerpo en `global.css`; botones, campos, tablas, Dense UI y textos de interfaz |
| `--ds-font-serif` | `"Source Serif 4", Georgia, serif` | `h1`–`h3` globales, títulos vacíos, marca del shell y cifras destacadas |
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

Jerarquía hoy: el shell usa Source Serif 4 para la marca; los `h1` generales heredan Source Serif 4 (`global.css`). Las páginas estándar usan `.study-page__title` de 30–42 px; el encabezado compacto de `StudyCatalogosFiscales` usa `.dense-head h1` a 26 px y hereda serif; el inspector usa 17 px y los títulos de sección suelen usar 20 px. El cuerpo de `global.css` mide 14 px; los campos y botones usan 14 px, las etiquetas y tablas 13 px, las ayudas 12 px y las estadísticas 20 px. Se observan además pesos directos 400, 500, 550, 600, 650, 700 y 750 en la UI; 550/650/750 no pertenecen a los tokens de peso actuales. Los headings globales usan 600.

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
| Borde/control | `--ds-border-width` | `1px` | Borde estándar |
| Borde/control | `--ds-border-width-strong` | `2px` | Borde enfatizado e indicador visual |
| Borde/control | `--ds-control-height-sm` | `32px` | Altura base small |
| Borde/control | `--ds-control-height-md` | `40px` | Altura base medium |
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

Los cinco componentes públicos de `packages/design-system/src` ofrecen estos contratos actuales. Los ejemplos incorrectos ilustran usos que el código compila pero contradicen la intención del componente.

### Button

- **Propósito:** acción nativa de botón con altura, foco, estados y carga normalizados.
- **Props/variantes:** props nativas de `button`; `children`; `variant` (`primary` por defecto, `secondary`, `ghost`, `danger`); `size` (`md` por defecto, `sm`); `loading`; `loadingLabel`.
- **Estados:** hover/active por variante, `:focus-visible`, disabled y loading. Loading informa `aria-busy`, bloquea el control, muestra spinner y puede reemplazar el nombre accesible.
- **Correcto:**

```tsx
<Button type="submit" loading={saving} loadingLabel="Guardando">
  Guardar cambios
</Button>
<Button type="button" variant="ghost" onClick={cancel}>Cancelar</Button>
```

- **Incorrecto:**

```tsx
<Button>Guardar</Button>
<Button>Cancelar</Button>
```

Ambos quedan como acción primaria por defecto; asigná una sola primaria y una variante secundaria/ghost para las alternativas.

### Field

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

### MoneyField

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

### Table

- **Propósito:** tabla semántica con cabecera, alineación opcional y estado vacío.
- **Props/variantes:** `columns`, `rows`, `rowKey`, `empty`; cada columna lleva `key`, `header`, `align` (`left`, `right`, `center`), `render` o `accessor`. Conserva atributos nativos de `table`.
- **Estados:** hover de fila, `focus-within`/selección cuando sus descendientes reciben foco, vacío personalizable; encabezado sticky y contenedor con scroll horizontal.
- **Correcto:**

```tsx
<Table
  columns={[{ key: "code", header: "Código", accessor: (row) => row.code }]}
  rows={activities}
  rowKey={(row) => row.id}
  empty={<EmptyState title="Sin actividades" />}
/>
```

- **Incorrecto:**

```tsx
<Table columns={columns} rows={activities} rowKey={() => "same-key"} />
```

La clave debe ser estable y única por fila. `Table` es una tabla de lectura; para filas seleccionables con teclado la pantalla actual usa `DenseTable`.

### EmptyState

- **Propósito:** estado vacío informativo, con acción opcional y tamaño regular/compact.
- **Props/variantes:** `title` obligatorio, `description`, `action`, `size` (`regular` por defecto o `compact`), atributos nativos de `div`.
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

## 6. Patrones de pantalla

`apps/web/src/study/StudyCatalogosFiscales.tsx` es el ejemplo observado de una página densa operativa; sus estilos base están en `study/study.css` y las primitivas densas en `ui/Dense.css`.

- **Encabezado + métricas + pestañas:** `DenseHeader` presenta eyebrow “Administración fiscal”, título, descripción y CTA contextual para crear en la pestaña activa. `StatStrip` resume jurisdicciones, tipos de impuesto, organismos, regímenes, actividades, registros del estudio y alertas de coherencia; las métricas pertinentes permiten cambiar de categoría. `DenseTabs` organiza las cinco categorías y muestra conteos/alertas.
- **Filtros:** `DenseToolbar` combina búsqueda por código/nombre, jurisdicción, origen y estado; en regímenes agrega filtro de alertas y ofrece densidad de filas compacta/estándar/cómoda. La búsqueda normaliza tildes/mayúsculas; las reglas de selección y filtros se restablecen al cambiar pestaña.
- **Tabla + panel de detalle:** `DenseWorkspace` contiene `DenseTable` y `Inspector`. Al seleccionar fila se abre el detalle lateral, oculta columnas secundarias y muestra ficha, relaciones y acciones disponibles. Las filas soportan Enter/Espacio y flechas arriba/abajo; el escritorio conserva scroll interior y el layout de inspector se apila bajo 1100 px.
- **Estado vacío y carga/error:** cada categoría diferencia “todavía no hay registros” de “ningún registro coincide con filtros” con `EmptyState` compacto. La pantalla conserva placeholders de carga y alertas de consulta con acción de reintento.
- **Formularios:** altas/ediciones usan `ActionDrawer`, jerarquía eyebrow/título/descripción y campos `Field`; los selects usan `label.ds-field` y `.ds-field__input`, como indica la guía UI. Las acciones de submit muestran loading y cancelación usa ghost. La creación de régimen comunica en vivo la coherencia entre jurisdicción y organismo.
- **Confirmación destructiva:** la desactivación de una actividad usa un drawer que explica que se conserva historial y vínculos. La eliminación definitiva usa `DeletionDrawer`: primero obtiene un preview de impacto, dependencias y bloqueos; exige coincidencia exacta con el texto esperado; habilita “Eliminar definitivamente” sólo si no hay bloqueos y no está procesando; al terminar revalida consultas y muestra un recibo. Las acciones respetan capacidades y propiedad del registro.
- **Guía existente:** se conserva como referencia la [guía de formularios y paneles](docs/guia-ui-formularios-paneles.md), que establece `ActionDrawer`, gestión del foco, Escape, cancelación y acciones sticky. El uso actual de `ActionDrawer` en esta pantalla coincide. La guía exige errores con `role="alert"`: `MutationError` y errores de consulta lo proporcionan, mientras el error local que renderiza `Field` sólo queda enlazado con `aria-describedby`; esta diferencia queda registrada para una futura decisión.

## 7. Accesibilidad

### Medido y presente

- Los pares medidos y sus dos resultados **bajo el mínimo** están en la sección 2; el cálculo usa los valores sólidos y la fórmula WCAG indicados.
- `global.css` define `:focus-visible` con outline de 2 px; `Button` y `Field` añaden tratamientos propios. `Field` vincula label, hint y error por id, y expone `aria-invalid` en error.
- `ActionDrawer` usa `role="dialog"`, `aria-modal`, nombre/descripción accesibles, mueve foco al primer control, mantiene Tab/Shift+Tab dentro, cierra con Escape, bloquea scroll y restaura foco. El shell ofrece skip-link y nombre de navegación.
- `DenseTabs` implementa `tablist`/`tab`, estado seleccionado y flechas izquierda/derecha. `DenseTable` ofrece selección por teclado y ordenación con botones nativos. La pantalla anuncia el panel de detalle, búsquedas, filtros y estados de carga/alerta con etiquetas o roles.
- El design system fija `--ds-touch-target` en 44 px. `Button` llega a esa altura para puntero coarse; `Field` usa 44 px en pantallas estrechas o puntero coarse; las celdas de `Table` crecen a 44 px para puntero coarse.

### Brechas observadas, sin corrección en este encargo

- `--ds-color-text-faint` sobre `--ds-color-surface-muted` mide 4,29:1, por debajo de 4,5:1 en texto normal; `--ds-color-text-disabled` sobre `--ds-color-control-disabled` mide 3,91:1 frente al umbral general. Ambos pares están identificados en la tabla de contraste.
- En Dense UI varios objetivos interactivos quedan por debajo del objetivo interno de 44 px: `.dense-tab` tiene `min-height: 36px`; `.dense-input` y `.dense-select` miden 30 px; `.dense-toggle` mide 30 px; botones de `.dense-seg` miden 28 px. En el shell, `.study__nav-link` tiene 42 px. El botón móvil de menú sí mide 44 px.
- `StatStrip` marca visualmente el elemento activo pero sus botones no exponen `aria-pressed`/`aria-current`; el grupo sí tiene `role="group"` y nombre accesible.
- `Field` relaciona su error mediante `aria-describedby` pero no añade `role="alert"`; por eso el anuncio inmediato recomendado por la guía existente no está garantizado en el componente por sí solo.
- La tabla genérica `Table` usa semántica nativa, pero no implementa selección/foco de fila ni manejo de flechas; el patrón administrativo de catálogo obtiene ese soporte mediante `DenseTable`.

## 8. Cómo extender

- Creá un token cuando un valor represente una decisión semántica compartida por más de un componente/pantalla, un estado reutilizable o una escala que deba mantenerse coherente. Para una excepción local de una sola vista, primero verificá si ya existe un token apropiado; no agregues aliases que dupliquen valores.
- Nombrá por familia, rol y estado con la convención existente: por ejemplo `--ds-color-primary-hover`, `--ds-space-4`, `--ds-text-sm`, `--ds-radius-md` y `--ds-shadow-control`. Usá nombres semánticos para color/estado y escalas para dimensiones; los sufijos de estado deben identificar el estado funcional.
- Definí el valor en `packages/design-system/src/tokens.css`; reutilizalo desde componentes o pantallas y verificá contraste, foco, teclado y objetivo táctil en el contexto donde se usa.
- Actualizá `DESIGN.md` en el mismo PR que modifique tokens, familias, componentes o patrones. La prueba `packages/design-system/src/design-md.test.ts` comprueba que cada token citado exista y que todos los tokens de color, tipografía y radio queden documentados.
