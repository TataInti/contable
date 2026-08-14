# Checklist normativo — Contable

> Checklist de fuentes normativas y responsables de validación.
> **Estado:** borrador. Cada regla fiscal/contable requiere fuente, jurisdicción, versión, vigencia, responsable de validación y tests antes de habilitarse.
> Última verificación documental de enlaces: 2026-08-12. Consultar texto vigente antes de activar o modificar una regla.

## Normas contables y registraciones

| Ítem | Fuente | Responsable | Estado |
|---|---|---|---|
| RT 54 (Norma Unificada Argentina de Contabilidad) | [FACPCE](https://www.facpce.org.ar/wp-content/uploads/2022/07/RT54.pdf) | Contador | Pendiente |
| Texto ordenado y modificaciones de RT 54 | [FACPCE — índice RT](https://normasweb.facpce.org.ar/normas-huerfanas/resoluciones-tecnicas/) | Contador | Pendiente |
| Adopción jurisdiccional del Consejo Profesional | Por jurisdicción del cliente | Contador | Pendiente |
| Resolución JG 660/26 y dispensa transitoria | [FACPCE](https://www.facpce.org.ar/nueva-resolucion-de-junta-de-gobierno-660-26-precisiones-sobre-su-aplicacion-y-uso-de-la-dispensa-por-restricciones-operativas/) | Contador | Pendiente |
| Código Civil y Comercial arts. 320–331 (registros, Diario, conservación 10 años) | [Argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/ley-26994-235975/actualizacion) | Contador | Pendiente |
| Ajuste por inflación e índices | [FACPCE — ajustes](https://www.facpce.org.ar/ajustes/) | Contador | Pendiente |
| Tipo de cambio de referencia A 3500 y TCNPM | [BCRA](https://www.bcra.gob.ar/tipo-cambio-referencia-comunicacion-a-3500-tcnpm/) | Contador | Pendiente |

## ARCA e IVA

| Ítem | Fuente | Responsable | Estado |
|---|---|---|---|
| Web Services de factura electrónica | [ARCA](https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp) | Contador | Pendiente |
| Manual del Libro IVA Digital | [ARCA](https://www.arca.gob.ar/iva/documentos/libro-de-iva-digita-manual-del-usuario.pdf) | Contador | Pendiente |
| Especificaciones de carga del Libro IVA Digital | [ARCA](https://arca.gob.ar/iva/sujetos-exentos/ayuda/especificaciones-de-carga.asp) | Contador | Pendiente |
| RG 4597 y texto vigente del régimen de registración electrónica | [ARCA](https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A4597%7Co%3A3%7Ca%3A2019%7Cf%3A30%2F09%2F2019) | Contador | Pendiente |

## Datos personales

| Ítem | Fuente | Responsable | Estado |
|---|---|---|---|
| Ley 25.326 (texto actualizado) | [Argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion) | Legal | Pendiente |
| Obligaciones de responsables de bases de datos | [AAIP](https://www.argentina.gob.ar/aaip/datospersonales/responsables/obligaciones) | Legal | Pendiente |
| Derechos de titulares | [AAIP](https://www.argentina.gob.ar/aaip/datospersonales/derechos) | Legal | Pendiente |
| Trámites del Registro Nacional de Bases de Datos | [AAIP](https://www.argentina.gob.ar/aaip/datospersonales/tramites) | Legal | Pendiente |

## UIF y ejercicio profesional

| Ítem | Fuente | Responsable | Estado |
|---|---|---|---|
| Resolución 42/2024 (texto actualizado) | [Argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-42-2024-397423/actualizacion) | Contador/Legal | Pendiente |
| Resoluciones vigentes por tipo de sujeto obligado | [UIF](https://www.argentina.gob.ar/uif/normativa-uif/resoluciones-aplicables-cada-sujeto-obligado) | Contador/Legal | Pendiente |

## Privacidad del proveedor IA

| Ítem | Fuente | Responsable | Estado |
|---|---|---|---|
| OpenRouter Zero Data Retention | [OpenRouter](https://openrouter.ai/docs/guides/features/zdr) | Seguridad | Pendiente |
| Selección y políticas de proveedores | [OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection) | Seguridad | Pendiente |

## Reglas de producto que requieren decisión humana

- [ ] Política decimal, redondeo, fechas y monedas.
- [ ] Clasificación monetaria/no monetaria para inflación.
- [ ] Criterio de cierre suave/duro y reapertura.
- [ ] Mapeo de reportes (situación patrimonial y resultados).
- [ ] Tratamiento de percepciones/retenciones en la posición IVA.
- [ ] Política de retención (aprobación jurídica).
- [ ] Responsable/encargado en cada tratamiento de datos.
- [ ] Transferencias internacionales y subencargados (proveedor IA).

## Regla de validación

Una regla fiscal/contable no se habilita hasta tener:

1. Fuente oficial y jurisdicción.
2. Versión y vigencia.
3. Responsable de validación.
4. Tests (positivo, negativo, límite).
5. Snapshot/hash cuando sea legalmente posible.