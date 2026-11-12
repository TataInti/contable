# ADR-011 — Foto fija inmutable de extracciones aprobadas

- **Estado:** Aceptado
- **Fecha:** 2026-11-12
- **Decisión:** Inti aprobó la opción A para conservar el dato final al aprobar una extracción.
- **Relacionados:** [ADR-006 — RLS obligatorio y runtime non-owner](./0006-rls-obligatorio-runtime-non-owner.md), [ADR-009 — Modelo de extracción multimodal](./0009-modelo-extraccion-claude-haiku-5-5.md)

## Contexto

La aprobación vigente marca la extracción como revisada. El valor final, las correcciones y la trazabilidad de revisión permanecen en `extracted_fields` y deben reconstruirse al consultarlos. La liquidación requiere una referencia estable del dato que el usuario confirmó.

## Decisión

- Cada aprobación crea una fila en `extraction_approved_snapshots`, con una fila única por extracción, identidad de firma/cliente/documento, usuario y fecha de aprobación, versiones de extracción y dato final JSONB.
- La foto se crea en la misma transacción que el compare-and-set de aprobación. Una falla al guardarla revierte también el cambio de estado, la actualización del documento y la auditoría.
- `data.fields` conserva todas las filas de `extracted_fields`: usa `correction` cuando existe y, en su defecto, `normalizedValue` o `rawValue`. Distingue origen `AI`, `CORRECTED` y `HUMAN`, y preserva el valor de IA en `originalValue` cuando hay corrección. `data.reviewIssues` conserva las marcas vigentes al aprobar.
- Las filas de listas preservan `sourcePath` e índice. En el esquema actual los campos persistidos usan aliases (`vatRate`, `perceptionCategory`, etc.); el snapshot resuelve su ruta estable contra el valor original en `voucherData`, mientras que el valor final siempre proviene de `extracted_fields`. Las filas con una ruta explícita conservan esa ruta.
- La lectura se ofrece mediante `GET /api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId/approved-snapshot`, con el mismo scope tenant que la extracción y respuesta 404 cuando la foto no existe.
- La tabla fuerza RLS. La aplicación tiene permisos únicamente de lectura e inserción; un trigger bloquea UPDATE y DELETE también para el owner de la tabla. La fila es autocontenida y no depende de cascadas desde la extracción o el documento.

## Alcance de producto

La foto queda consultable desde la API y todavía no la consume ningún módulo. El puente al libro de IVA, a liquidaciones y la presentación en la web quedan para pasos posteriores.

## Consecuencias

- Cambios posteriores en `extracted_fields` no modifican el dato aprobado.
- El snapshot mantiene su identidad y contenido aunque la extracción deje de estar disponible.
- El endpoint expone el registro exclusivamente dentro del contexto de firma y cliente autorizado.
