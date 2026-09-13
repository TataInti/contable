# Guía UI — formularios y paneles emergentes

> Alcance: interfaz del estudio y portal cliente. Este documento fija el patrón visual y de
> interacción para formularios, paneles laterales y diálogos. No redefine contratos HTTP ni reglas
> de negocio.

## Principio rector

La interfaz de Contable prioriza trabajo denso, trazable y reversible. Una acción de carga,
edición o resolución no debe desplazar tablas, navegación, evidencia ni contexto de cliente/período.
El usuario debe poder abrir una acción, completarla o cancelarla, y volver al mismo punto del flujo.

## Patrón obligatorio: panel lateral de acción

Usar `ActionDrawer` para formularios transaccionales que modifican datos o disparan procesos:

- Alta o edición de cliente.
- Carga documental y asociación a pedidos.
- Pedidos documentales, conversaciones y vista previa de evidencia.
- Asientos manuales, cierres, pagos, presentaciones y liquidaciones.
- Configuración secundaria de reglas fiscales, fuentes, vencimientos o saldos iniciales.

El panel lateral debe:

- Renderizarse en capa modal con `z-index: var(--ds-z-modal)`.
- Cubrir barras sticky, banners y contexto superior. Ningún elemento del shell debe quedar por encima.
- Usar `role="dialog"`, `aria-modal="true"`, `aria-labelledby` y `aria-describedby` cuando haya descripción.
- Enfocar el primer campo accionable al abrirse.
- Cerrar con Escape, botón `Cerrar`, scrim y botón explícito `Cancelar` cuando haya formulario.
- Bloquear scroll del body mientras está abierto.
- Mantener foco dentro del panel con Tab/Shift+Tab.
- Tener acciones principales sticky al pie cuando el formulario pueda requerir scroll.
- Usar `size="wide"` sólo para formularios con evidencia, tablas o más de cuatro campos relevantes.

## Cuándo NO usar panel emergente

Los formularios inline sólo se permiten cuando cumplen todas estas condiciones:

- Son filtros, búsqueda, edición rápida de una sola celda o preferencia no transaccional.
- No desplazan una tabla, stepper, evidencia o panel de revisión importante.
- No requieren confirmación, evidencia, permisos maker-checker ni explicación extensa.
- Pueden completarse en menos de tres campos y no necesitan scroll.

Si una acción crea, modifica, presenta, paga, calcula, aprueba, carga archivos o registra evidencia,
debe ir en `ActionDrawer`.

## Estructura visual del panel

Cada panel debe mantener esta jerarquía:

1. Eyebrow corto: área funcional (`Maker`, `Bandeja`, `Impuestos`, `Saldos`).
2. Título orientado a la acción: `Nuevo asiento manual`, `Calcular liquidación`.
3. Descripción breve: una línea que explique alcance y efecto.
4. Formulario sin tarjeta anidada. El panel ya es el contenedor.
5. Acciones al pie: primaria a la derecha, secundaria/cancelar a la izquierda o antes de la primaria.

No usar encabezados duplicados dentro del formulario si el drawer ya tiene título y descripción.
No anidar `study-panel` dentro del drawer salvo que el contenido sea una sección de evidencia
independiente, no el formulario principal.

## Campos y validación

Los campos deben seguir estas reglas:

- Usar `Field` del design system cuando sea input simple.
- Usar `label.ds-field` para `select` y `textarea` hasta que existan primitives equivalentes.
- Mantener labels explícitos; no depender sólo de placeholders.
- Usar `hint` para formato esperado, no para explicar reglas de negocio largas.
- Mostrar errores cerca del formulario con `role="alert"` y mensaje accionable.
- Deshabilitar submit sólo por requisitos locales obvios; errores de dominio deben venir del backend.
- Preservar `loading`, `loadingLabel` y estado disabled en botones que disparan mutaciones.

## Botones y acciones

La jerarquía de botones debe ser estable:

- Una sola acción primaria por panel.
- `secondary` para avanzar a otra pantalla o acción alternativa.
- `ghost` para cancelar, cerrar o actualizar.
- Acciones irreversibles o de alto impacto deben pedir confirmación o pasar por maker-checker.
- Nunca convertir todos los botones del panel en primarios.

## Navegación de procesos complejos

Procesos como `Expediente mensual` no deben comportarse como un wizard opaco. Deben mostrar:

- Menú completo de etapas siempre disponible.
- Botones simples `Anterior` y `Siguiente`.
- Estado activo con número de etapa y descripción.
- Acciones de etapa separadas de acciones de ciclo completo.
- Posibilidad de volver al paso anterior sin perder filtros ni selección actual.

El stepper es navegación, no validación. La validación real vive en controles, estados y permisos.

## Z-index y solapamientos

Usar sólo la escala nominal del design system:

- Sticky/header/table: `--ds-z-sticky`.
- Dropdown/menu: `--ds-z-dropdown`.
- Paneles emergentes y diálogos: `--ds-z-modal`.
- Toasts/notificaciones globales: `--ds-z-toast`.

No usar valores arbitrarios como `80`, `999` o `9999`. Si un panel se superpone mal, el problema se
corrige en la escala semántica, no elevando componentes individuales.

## Responsive

En desktop el drawer entra desde la derecha y conserva parte del contexto visible. En pantallas
chicas debe ocupar el ancho completo, mantener acciones sticky y conservar navegación por teclado.
No ocultar acciones críticas en mobile; adaptar el layout a una columna.

## Checklist antes de mergear UI transaccional

- [ ] La acción no desplaza la pantalla principal.
- [ ] El panel queda por encima de barras sticky, banners y shell.
- [ ] Escape, scrim, botón Cerrar y botón Cancelar funcionan.
- [ ] El foco entra al primer campo y no se escapa con Tab.
- [ ] Hay una sola acción primaria.
- [ ] Los errores tienen `role="alert"` y texto recuperable.
- [ ] Las acciones largas muestran loading.
- [ ] El formulario pasa lint, build y al menos una prueba/manual smoke del flujo.
