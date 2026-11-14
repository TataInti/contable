# Relevamiento: dar de alta todo lo necesario para procesar un cliente, cargar un comprobante y cerrar el mes

Fecha del recorrido: 13 y 14-nov-2026. Entorno: copia de producción en local (ver "Entorno") con datos de prueba sintéticos.
Prueba automática: [`e2e/alta-y-comprobante-ui.spec.ts`](../../e2e/alta-y-comprobante-ui.spec.ts). Todo se hace desde la interfaz, sin llamar a la API para crear nada.
Comprobante: la foto de un ticket de mesa de restaurante, 16/03/2025 ([`e2e/fixtures/ticket-mesa-8.jpg`](../../e2e/fixtures/ticket-mesa-8.jpg)).

## Lo que se encontró en producción

Producción está vacía de configuración fiscal: tiene el estudio, 4 usuarios, dos jurisdicciones (Nación y Tucumán) y los catálogos de sistema (familias y motores de cálculo). **No tiene tipos de impuesto, organismos, regímenes, actividades, reglas ni clientes**, y el estudio no tiene ningún módulo habilitado. Con esa base, hoy no se puede liquidar nada. El recorrido de abajo es exactamente lo que hay que hacer el día del lanzamiento.

## Resumen

Con los arreglos de este recorrido, **el ciclo completo funciona desde la pantalla**: se crean los impuestos nuevos y sus valores, se da de alta al cliente, se importan los libros, se clasifican los comprobantes, se calcula, se controla, se revisa con una segunda persona, se finaliza, se registra la presentación y el pago, y el cliente ve el resultado en su portal. El crédito fiscal del ticket entra al IVA de marzo. Lo que no se pudo es la lectura automática del ticket (falta la clave del modelo de IA en local) y quedan ocho puntos de pantalla sin corregir (abajo).

## Resultado numérico (marzo 2025, datos de prueba)

| Impuesto | Base | Cálculo | A pagar |
|---|---|---|---|
| IVA | Ventas $ 206.610,75 (IVA $ 43.388,26) y la compra del ticket (IVA $ 5.189,26) | Débito − crédito | **$ 38.199,00** (presentado y pagado) |
| Ingresos Brutos Tucumán | $ 206.610,75 | 3,5 % | **$ 7.231,38** |
| TEM San Miguel de Tucumán | $ 206.610,75 | 0,6 % | **$ 1.239,66** |

Del ticket salen la fecha, el neto ($ 24.710,74), el IVA 21 % ($ 5.189,26) y el número; el CUIT del proveedor y la letra "A" se inventaron porque el ticket no los trae. Las ventas, Ingresos Brutos y TEM son datos sintéticos.

## Qué se hizo, paso a paso

| # | Paso | Dónde |
|---|---|---|
| 0 | Habilitar Bandeja documental, Módulo fiscal e IVA / IIBB Tucumán / TEM del estudio | Módulos de estudios |
| 1 | Crear la jurisdicción San Miguel de Tucumán (municipio) y los tipos de impuesto IVA, Ingresos Brutos y TEM, cada uno con su familia de cálculo | Catálogos fiscales |
| 2 | Crear un organismo por impuesto, los regímenes `RI`, `IIBB_LOCAL_TUC` y `TEM_SMT` (con esos códigos exactos) y tres actividades | Catálogos fiscales |
| 3 | Cargar los valores de cada motor con vigencia desde 01/01/2025: alícuota (21 % / 3,5 % / 0,6 %), mínimo (IIBB $ 1.500, TEM $ 500), vencimiento y fuente normativa; activar | Reglas fiscales |
| 4 | Alta del cliente; perfil fiscal (crear, revisar, activar); inscripción en los tres regímenes; actividades; período marzo 2025 y obligación por impuesto | Clientes, Configuración fiscal |
| 5 | Pedido documental; subir la foto del ticket (validación y antivirus); cargar a mano fecha, neto, total y moneda; aprobar | Trabajo, Bandeja documental |
| 6 | Asignar el cliente al revisor | Usuarios y accesos |
| 7 | Crear el legajo e importar cuatro archivos: Libro IVA Ventas, Libro IVA Compras (el ticket), Ingresos Brutos Tucumán y TEM | Legajo |
| 8 | El revisor revisa los cuatro lotes (control de dos personas) | Legajo, como Revisor |
| 9 | Clasificar las dos ventas (actividad) y la compra (rubro y actividad) | Legajo |
| 10 | Calcular los tres impuestos | Legajo |
| 11 | Resolver los dos controles bloqueantes que piden respaldo (acreditaciones bancarias y caja) con el ticket aprobado | Legajo |
| 12 | Enviar a revisión; el revisor aprueba y finaliza | Legajo, como Revisor |
| 13 | Invitar al cliente al portal, activar su acceso y subir el acuse de presentación | Usuarios y accesos, Portal |
| 14 | Registrar la presentación y el pago del IVA | Legajo |
| 15 | Generar el PDF y el CSV; el cliente ve los tres resultados en su portal | Liquidaciones, Portal |

## Errores del producto que se corrigieron

Detectados por la prueba y arreglados en esta rama (detalle en [hallazgos-recorrido.md](hallazgos-recorrido.md), 4.7 a 4.15):

1. No se podía guardar ninguna alícuota de un tipo de regla ("Invalid uuid").
2. Tras guardar un borrador de reglas no se podía activar.
3. Un cliente recién creado no quedaba seleccionado.
4. **Activar el acceso del cliente al portal fallaba siempre** (error 500 en el servidor). Existe en producción: hace falta aplicar la migración nueva `20261114010000_fix_portal_invitation_accept_ambiguity`.
5. **En un estudio nuevo la pantalla "Módulos de estudios" salía vacía**, sin forma de habilitar el módulo fiscal; sin él ningún cálculo se podía hacer. Ahora lista todos los módulos, apagados.
6. El motor de IVA bloqueaba el cierre por una diferencia de dos centavos entre neto y bases (redondeo del IVA del propio ticket). Ahora usa la misma tolerancia de $ 0,05 que el control de libro del legajo.
7. Al aprobar una extracción, la lista de documentos no se actualizaba: el Legajo no ofrecía el documento como respaldo durante 30 segundos.

## Lo que no se pudo hacer

### 1. Lectura automática del ticket

El servicio de lectura responde `OPENROUTER_API_KEY_MISSING`: en producción lee los comprobantes con un modelo (Claude Haiku vía OpenRouter, con la lectura de datos de clientes habilitada) y tiene su clave; en local no. Dejé el servicio local con la misma configuración que producción, salvo la clave. **Intenté tomar la clave del servidor y el sistema lo bloqueó**: copiar una credencial de producción a una máquina de desarrollo necesita tu autorización explícita. Para verificar la lectura hace falta una clave propia de desarrollo o que autorices ese paso.

## Puntos de pantalla sin corregir

| # | Hallazgo | Dónde |
|---|---|---|
| P.1 | La carga manual no ofrece el importe de IVA ni la alícuota; el IVA del ticket sólo entró por el libro de compras importado | Bandeja documental |
| P.2 | No hay pantalla para convertir un comprobante aprobado en comprobante fiscal del cliente (la API tiene la ruta, ninguna pantalla la usa) | Bandeja documental |
| P.3 | El formulario de presentación ofrece "Sin adjuntar por ahora" y el servidor lo rechaza siempre: exige un acuse con categoría ACUSE, que sólo puede subir el cliente desde el portal | Legajo |
| P.4 | El acuse que sube el cliente tarda hasta 30 segundos en aparecer en el estudio (caché) | Legajo |
| P.5 | "Calcular liquidación" desde Liquidaciones no separa los archivos por impuesto: con Ingresos Brutos y TEM cargados en el mismo mes, calcular uno falla ("ACTIVIDAD no resuelve a una actividad única") porque ve los datos del otro. Desde el Legajo sí funciona | Liquidaciones |
| P.6 | Los rubros de compra son dos fijos (SUPER, TRANSPORTE); un restaurante no tiene uno que le corresponda | Legajo, Clasificación |
| P.7 | Los controles de acreditaciones bancarias y de caja bloquean el cierre y piden un documento de respaldo; no hay cómo registrar que no aplican. Se resolvieron con el ticket, que no es un respaldo real | Legajo, Controles |
| P.8 | El portal muestra el período como `2025-03-01T00:00:00.000Z`, el impuesto como "—" y la presentación y el pago como "—" aunque el IVA figura pagado | Portal |

Además, de los cinco regímenes que maneja el sistema (IVA, IIBB local Tucumán, TEM, Convenio Multilateral y Monotributo) este recorrido cubre los tres primeros. Faltan Convenio Multilateral y Monotributo.

## El ticket no es un comprobante fiscal

Es un ticket de mesa (mesa 8, mozo, #1343338): sin CUIT del comercio, tipo y letra de factura, CAE ni QR. Con un ticket así no se puede computar crédito fiscal; en la práctica el cliente tendría que pedir la factura. Verificado: suma de renglones $ 29.900 (3.500 + 4.000 + 5.300 + 2.300 + 12.000 + 2.800, cubiertos a $ 0); neto $ 24.710,74 = 29.900 / 1,21; IVA $ 5.189,26.

## Entorno

El entorno de desarrollo quedó igual a producción en lo que importa para probar:

- **Código:** producción corre el commit `d665041`, el mismo que `main`.
- **Base:** PostgreSQL 18 (la misma versión que producción) en un contenedor local, puerto 5442, con una copia de la base de producción. El script [`infra/scripts/dev-from-prod.sh`](../../infra/scripts/dev-from-prod.sh) la rehace desde cero leyendo producción en sólo lectura; no escribe nada en el servidor.
- **Usuarios locales:** la copia trae las cuentas reales, cuyas contraseñas no se usan. El script agrega `demo@contable.local` / `demo1234` (Titular y administrador de plataforma) y `revisor@contable.local` / `revisor1234`. Nunca van al servidor.
- **Servicios:** ClamAV, servicio de lectura con la configuración de producción (sin la clave) y worker de documentos, todos corriendo desde el código del repositorio. La imagen de Docker `contable-ai` estaba construida de agosto y responde con otro motor: no se usa.
- La copia contiene datos reales de usuarios del estudio: no la compartas ni la subas a ningún lado.

## Cómo correrlo

1. `./infra/scripts/dev-from-prod.sh` (deja la base como producción) y levantar API y worker apuntando a ella (el script imprime los comandos).
2. ClamAV: `docker compose -f infra/compose/docker-compose.yml up -d clamav`; servicio de lectura: `cd services/ai && AI_SERVICE_SECRET=dev-secret EXTRACTION_ENGINE=model EXTRACTION_MODEL=anthropic/claude-haiku-5.5 EXTRACTION_CUSTOMER_DATA_ENABLED=true .venv/bin/uvicorn app.main:app --port 8000`.
3. `E2E_EXTERNAL=1 E2E_WEB_URL=http://127.0.0.1:5173 npx playwright test e2e/alta-y-comprobante-ui.spec.ts` (agregá `--headed` para verlo en una ventana).

La prueba se puede repetir sobre la misma base: si un catálogo ya existe lo reutiliza. El alta de acceso al portal admite 5 intentos cada 10 minutos. Las anotaciones del reporte guardan lo que leyó el sistema solo, cada etapa del legajo y el resultado de cada paso.
