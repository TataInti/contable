# Plan: densidad de información en todo el sitio

Extiende el patrón denso de Catálogos fiscales y Usuarios y accesos
(`apps/web/src/ui/Dense.tsx`) al resto del estudio. Mockup de referencia:
`docs/mockups/densidad-administracion.html`.

## Principios (no se negocian)

- Mismos colores, fuentes y barra lateral. Cambia solo el panel principal.
- Un patrón, no una página a medida: franja de métricas → pestañas/filtros →
  tabla ordenable de 32 px → panel de detalle (inspector) a la derecha.
- Las altas y ediciones siguen en `ActionDrawer` (guía `guia-ui-formularios-paneles.md`).
- Los flujos con confirmación (`ConfirmDialog`, `DeletionDrawer`) y los permisos
  por capacidad no cambian. Solo se mueve dónde se invocan.
- La app oculta los SVG (`.study svg { display:none }`): los controles son texto.
- Cada página mantiene (o mejora) sus tests; se actualizan los que dependían de
  la estructura vieja.
- Los banners "Contexto" y "Próximo paso" (`guided-context`, `guided-next-step`)
  ocupan ~250 px antes de ver datos. Se reemplazan por la franja de métricas y el
  botón principal del encabezado; el "próximo paso" pasa a una `DenseAlert` solo
  cuando hay una acción pendiente real.

## Fases (estado)

| Fase | Páginas | Qué cambió | Estado |
| --- | --- | --- | --- |
| 1 | Clientes | Cartera maestro-detalle: franja de métricas, filtros, tabla de 32 px, inspector con ficha y acciones. | Hecha |
| 2 | Reglas fiscales | Paquetes en tabla densa; versión con pestañas (Alícuotas, Vencimientos, Fuentes, Control profesional); "Próximo paso" como alerta de una línea. | Hecha |
| 3 | Bandeja documental, Trabajo | Franja con las colas/pedidos/cierres como filtros, búsqueda en barra de herramientas, sin banners. | Hecha |
| 4 | Liquidaciones, Rentabilidad, Reportes, Módulos de estudios | Encabezado + franja de métricas; Módulos de estudios con tabla densa y filtros. | Hecha |
| 5 | Expediente mensual, Contabilidad, Resumen del cliente, Onboarding fiscal | Encabezado + franja; Resumen del cliente unifica identidad, métricas y búsqueda en dos filas. | Hecha, **excepto Dashboard** |
| 6 | Portal del cliente | Pasada de densidad solo por CSS (`portal.css`): encabezado, tablas y resumen más compactos. | Hecha |

Quedan fuera a propósito: **Dashboard** (hay trabajo propio sin commitear sobre
`StudyDashboard.tsx` y `study.css`), **Asistente** (es una conversación, no un listado)
y **Ayuda** (es un manual con capítulos).

## Criterios de salida de cada fase

- `tsc`, `eslint` y los tests de la página pasan; no se agregan fallos nuevos.
- Verificación visual en 1440×900 con datos locales: filas visibles antes/después.
- Sin regresión de permisos: acciones ocultas para quien no tiene la capacidad.
- Sin tocar archivos ajenos a la fase (trabajo propio sin commitear de otras personas).

## Fuera de alcance

- Rediseñar la barra lateral, los colores o la tipografía.
- Cambios de API o de modelo de datos.
