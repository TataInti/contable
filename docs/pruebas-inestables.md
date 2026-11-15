# Pruebas inestables: causas, arreglos y cómo detectar una nueva

Este documento registra las cuatro inestabilidades del CI de Contable de noviembre de 2026, su causa de fondo y el arreglo aplicado, y qué buscar en el log cuando aparezca una nueva. La regla es corregir la causa: no hay reintentos automáticos (`retries` de Playwright o de Vitest) y no se omiten, borran ni debilitan pruebas o aserciones.

## 1. Deadlock de PostgreSQL (`40P01`) en pruebas de liquidación

Síntoma en el CI: `Raw query failed. Code: 40P01. Message: deadlock detected`, dentro de `$executeRawUnsafe`. Aparece en `settlement-tem.test.ts:309`, `settlement-iibb.test.ts:356`, `workpaper.test.ts:353` y `profitability.test.ts:317`. Runs con la falla: 43533530029, 43367471654, 43456407898 (main), 43646932703, 43654031374 y 43654524573. Localmente se reprodujo con tres workers en `ingestion.test.ts`.

Causa: varias pruebas desactivan los triggers inmutables con `ALTER TABLE … DISABLE TRIGGER` dentro de una transacción. Ese DDL toma un bloqueo SHARE ROW EXCLUSIVE sobre la tabla y choca con los INSERT y DELETE de otra transacción que corre en otro archivo sobre la misma base. Si dos archivos escriben esas tablas a la vez, PostgreSQL puede abortar una de las dos por ciclo de bloqueos. Un VPS de dos núcleos no lo reproduce porque Vitest usa un worker menos que los núcleos disponibles; el runner del CI sí.

Arreglo: `apps/api/vitest.config.ts` pone en serie, en el proyecto `liquidacion-en-serie` con `fileParallelism: false`, los archivos de prueba que escriben las cuatro tablas (`tax_settlements`, `settlement_inputs`, `tax_settlement_lines`, `tax_differences`), directa o indirectamente por sus imports. El resto de la suite sigue en paralelo. La lista se calcula al cargar la configuración, así que un archivo nuevo que escriba esas tablas entra en la serie sin editarla.

Cómo detectar una nueva: buscar `40P01` o `deadlock detected` en el log. Mirar el archivo y la línea marcada con `❯` debajo del error. Si ese archivo escribe las cuatro tablas y no está en la serie, la regla tiene un hueco: suele ser un import dinámico o SQL armado sin el nombre de la tabla.

## 2. Tour guiado que intercepta clics en el e2e «Puerta 3»

Síntoma: `<div role="dialog" class="guided-tour__popover"> intercepts pointer events` seguido de `Test timeout of 60000ms exceeded` en `e2e/integrated-flow.spec.ts`. Runs: 43652413615, 43650129761 y 43534536707.

Causa: el tour guiado se abre 650 ms después de montar el estudio mientras la marca `contable-study-navigation-tour-v1` no exista en el almacenamiento local. El helper `dismissGuidedTour` miraba una sola vez si «Saltar tour» estaba visible. Si el popover llegaba después de ese chequeo, el clic del menú quedaba bloqueado y Playwright lo reintentaba hasta agotar el tiempo.

Arreglo: la prueba «seguridad anónima y navegación del estudio (Puerta 3)» marca el tour como visto con el mismo valor que escribe «Saltar tour» (`dismissed`), mediante `addInitScript`. Es el mecanismo que ya ofrece el producto; no se toca el tour.

Cómo detectar una nueva: buscar `intercepts pointer events` y `guided-tour__popover` en el log. Si aparece en otro spec, revisar si usa un helper con chequeo instantáneo de «Saltar tour» y aplicar la misma marca.

## 3. Error de tipo junto al desplegable en StudyReglasFiscales

Síntoma: `AssertionError: expected undefined to be 'alert'` en `apps/web/src/study/StudyReglasFiscales.test.tsx:419`. Run: 43626194668 (main, commit 53b00cd1); el siguiente run del mismo commit lo pasó sin cambios.

Causa: la prueba tomaba los textos con `findAllByText` y buscaba en esa lista el error de la fila. `findAllByText` resuelve con el primer elemento que coincide, y el error de la fila puede llegar en un render posterior. La búsqueda devolvía `undefined` y la aserción fallaba.

Arreglo: la prueba espera con `waitFor` al elemento con la clase `fiscal-rule-row-error`. Las aserciones de `role="alert"` y de la posición junto al desplegable no cambiaron.

Cómo detectar una nueva: buscar `expected undefined to be` en el log de `apps/web`. Si la falla aparece de forma intermitente, revisar si el elemento buscado llega en un render posterior y si la prueba espera esa condición o solo el primer texto que coincide.

## 4. Dirección leída antes de que la navegación se aplique en StudyCalendariosFiscales

Síntoma: `AssertionError: expected '' to be '?calendario=c0000000-0000-4000-8000-0…'` en `apps/web/src/study/StudyCalendariosFiscales.test.tsx:428`, en la prueba «al crear, abre la ficha de la versión nueva y avisa por el canal de notificaciones». Runs: 43684965498 (rama del PR #116) y 43705143330, intento 1 (main, `2afa613`); el reintento de los jobs fallidos la pasó sin cambios. Localmente se reproduce con el CPU cargado: una corrida suelta falló igual y el bucle de 40 corridas dejó constancia del mismo mensaje.

Causa: el alta avisa y navega en el mismo `onSuccess`, pero son dos actualizaciones de estado distintas. El aviso es estado urgente de `ToastProvider`; la ubicación de `MemoryRouter` se aplica dentro de `React.startTransition` (react-router 7, `dist/development/chunk-62JRHF6Z.mjs:6976`), o sea en un render de menor prioridad. `findByText` resuelve apenas el aviso está en el DOM, antes de que React confirme el render de la transición, y la lectura síncrona de `lastSearch` (el sensor `LocationProbe`) todavía ve la dirección anterior: `''`. Con el CPU cargado la transición se posterga unos milisegundos y la ventana se abre. La prueba «crear una versión a partir de este lo anuncia como copia y abre la copia» tenía el mismo patrón en la línea 483 (`notify.success` → `refresh()` → `onOpen`), aunque todavía no había caído en el CI.

Arreglo: las dos pruebas esperan la dirección con `await waitFor(() => expect(lastSearch).toBe(...))`. La aserción es la misma —el valor esperado no cambió—, solo deja de leerse antes de tiempo. No se tocó el componente: que el aviso preceda a la navegación es una decisión de la pantalla, no un defecto. Las lecturas de `lastSearch` que siguen a un `fireEvent` (líneas 359, 368 y 370) quedaron como estaban: el evento corre dentro de `act`, que aplica la actualización —incluidas las transiciones— antes de devolver.

Cómo detectar una nueva: buscar `expected '' to be` junto a `lastSearch`, `useLocation()` o `window.location` en pruebas de `apps/web`. Si la lectura de la dirección sigue a un `findByText` de un aviso, o a cualquier acción que navega y termina en una promesa, tiene que ir dentro de `waitFor`: el aviso y la navegación son dos renders distintos. Si la lectura sigue a un `fireEvent` sin espera intermedia, no hace falta.

## Reglas que se mantienen

- Ninguna prueba se omite (`skip`, `todo`, `fixme`) ni se deja de correr para que el CI pase.
- No se agregan reintentos automáticos. Una corrida verde tiene que ser una señal confiable.
- Un arreglo explica por qué la prueba era inestable y mantiene las mismas aserciones.
