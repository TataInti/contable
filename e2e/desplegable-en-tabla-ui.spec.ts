import { expect, test, type Locator, type Page } from "@playwright/test";
import { RUN, SUFFIX, login, mutating, syntheticCuit } from "./helpers/ui";
import {
  IIBB,
  abrirLegajo,
  activarAutorrevision,
  altaClienteRI,
  cargarLibroVentas,
  clickAdd,
  crearPeriodoIIBB,
  inscribirIIBB,
  irAlLegajo,
  revisarLotesDe,
  rotuloDelPeriodo,
  vincularActividad,
} from "./helpers/liquidacion-ui";
import { type FacturaSintetica } from "./helpers/fuentes-sinteticas";

/**
 * Desplegables con búsqueda dentro de una tabla y dentro de un cajón, operados como el contador:
 *
 *   1. Alta del cliente con IIBB y actividad de restaurante vinculada.
 *   2. Cajón «Registrar cambio de actividad»: el desplegable «Actividad nueva» muestra su lista completa
 *      (no queda recortada por el cajón) y se cierra sin registrar nada.
 *   3. Vincular Comercio y Servicios: cada fila de Clasificación tiene cuatro opciones.
 *   4. Octubre de 2026: período, libro de ventas de tres facturas (sintéticas) revisado por el Titular.
 *   5. Legajo › Clasificación: el desplegable «Rubro / actividad» de la primera fila muestra su lista
 *      completa, fuera del borde de la tabla. Se elige por teclado y se guarda con «Actualizar».
 *   6. La segunda fila se elige por clic y se guarda.
 *   7. Se vuelve a abrir el Legajo: las dos clasificaciones quedaron guardadas.
 *
 * Verificación de la lista: el cuadro de la lista se extiende más allá del borde inferior de la tabla y el
 * punto inferior de la lista y cada opción visible están sobre la lista (no los tapa ni los recorta la tabla).
 * Las filas se buscan por el número del comprobante; las actividades, por la etiqueta completa (el catálogo
 * de CI tiene más de una actividad con el código COMERCIO). Todo sintético y con el sufijo de la corrida.
 * Capturas 1440×900: 4v-cajon-desplegable-abierto.png y 4v-clasificacion-desplegable-abierto.png.
 */

const CLIENTE = {
  legalName: `Cliente E2E Desplegable ${SUFFIX} S.R.L.`,
  tradeName: `E2E Desplegable ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 9_400),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const OCTUBRE = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026", label: `Octubre 2026 IIBB ${SUFFIX}` };
const ACTIVIDAD_NUEVA = "Comercio";
// Catálogo de Tucumán sembrado para el E2E (apps/api/src/seed-maestros-fiscales.ts). Se busca por código y se elige
// por la etiqueta anclada al inicio («CÓDIGO — Nombre»): así no coincide con otra actividad de nombre parecido.
const ACTIVIDADES_DESPUES = [
  { buscar: "Comercio", etiqueta: /^COMERCIO — Comercio\b/ },
  { buscar: "Servicios", etiqueta: /^SERVICIOS — Servicios\b/ },
];
// En la lista de cada fila la opción es «CÓDIGO · Nombre».
const OPCION_COMERCIO = /^COMERCIO · /;
const OPCION_RESTO = /^RESTO-TUC · /;
const OPCION_SERVICIOS = /^SERVICIOS · /;
const NUMERO_FILA_1 = "00000501";
const NUMERO_FILA_2 = "00000502";

/** Tres facturas A por 115.000 neto (50.000 + 40.000 + 25.000), todas de octubre de 2026. */
function facturasDeOctubre(): FacturaSintetica[] {
  const base = Number.parseInt(RUN, 36) + 5_000;
  return [
    { fecha: "2026-10-05", tipo: "1", numero: "501", docTipo: "80", docNumero: syntheticCuit(base + 51), denominacion: "Comensal E2E Desplegable 1", neto: "50000.00", iva: "10500.00" },
    { fecha: "2026-10-12", tipo: "1", numero: "502", docTipo: "80", docNumero: syntheticCuit(base + 52), denominacion: "Comensal E2E Desplegable 2", neto: "40000.00", iva: "8400.00" },
    { fecha: "2026-10-20", tipo: "1", numero: "503", docTipo: "80", docNumero: syntheticCuit(base + 53), denominacion: "Comensal E2E Desplegable 3", neto: "25000.00", iva: "5250.00" },
  ];
}

/**
 * Verifica que la lista se vea completa. Con `tabla`: la lista se extiende más allá del borde inferior de la
 * tabla (el caso del defecto). Siempre: su borde inferior y cada opción caen sobre la lista, no sobre lo que la recorta.
 */
async function verificarListaCompleta(page: Page, lista: Locator, opciones: RegExp[], tabla?: Locator) {
  await expect(lista).toBeVisible({ timeout: 10_000 });
  for (const texto of opciones) {
    await expect(lista.getByRole("option", { name: texto }), `opción ${texto} visible`).toBeVisible();
  }
  const caja = await lista.boundingBox();
  expect(caja, "la lista tiene caja visible").not.toBeNull();
  if (tabla) {
    const cajaTabla = await tabla.boundingBox();
    expect(cajaTabla).not.toBeNull();
    expect(caja!.y + caja!.height, "la lista se extiende más allá del borde inferior de la tabla").toBeGreaterThan(
      cajaTabla!.y + cajaTabla!.height,
    );
  }
  // Punto cerca del borde inferior de la lista: tiene que caer sobre la lista, no sobre la tabla que la recortaría.
  const sobreLista = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el && el.closest('[role="listbox"]'));
    },
    [caja!.x + caja!.width / 2, caja!.y + caja!.height - 6],
  );
  expect(sobreLista, "el borde inferior de la lista no queda tapado ni recortado").toBe(true);
  for (const texto of opciones) {
    const opcion = await lista.getByRole("option", { name: texto }).boundingBox();
    const centro = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el && el.closest('[role="listbox"]'));
      },
      [opcion!.x + opcion!.width / 2, opcion!.y + opcion!.height / 2],
    );
    expect(centro, `la opción ${texto} se puede tocar (no la recorta el contenedor)`).toBe(true);
  }
}

/** Vincula actividades del catálogo en un solo alta, eligiendo cada una por su etiqueta completa. */
async function vincularEtiquetas(page: Page, actividades: Array<{ buscar: string; etiqueta: RegExp }>) {
  await clickAdd(page, "Actividades");
  const cajon = page.getByRole("dialog", { name: "Vincular actividad económica" });
  for (const { buscar, etiqueta } of actividades) {
    await cajon.getByRole("searchbox", { name: "Buscar actividad" }).fill(buscar);
    await cajon.getByRole("checkbox", { name: etiqueta }).check();
  }
  await mutating(page, "/activities", () => cajon.getByRole("button", { name: "Vincular actividad", exact: true }).click());
}

/** Libro de ventas del mes, importado y revisado por el Titular desde el Legajo de ese mes. */
async function libroDeOctubreRevisado(page: Page, rotulo: string) {
  await abrirLegajo(page, rotulo);
  await page.getByRole("tab", { name: /Fuentes/ }).first().click();
  const { libro } = await cargarLibroVentas(page, facturasDeOctubre(), `ventas-oct-desplegable-${SUFFIX}.xlsx`);
  await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
  await expect(page.getByRole("dialog", { name: "Importar libros IVA" })).toBeHidden({ timeout: 60_000 });
  await revisarLotesDe(page, "Gestionar Ventas del período");
}

test.use({ viewport: { width: 1440, height: 900 } });

test("desplegable con búsqueda en la tabla de Clasificación y en un cajón: lista completa, elegir y guardar", async ({ page }) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);

  const errores: string[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    if (!response.url().includes("/api/v1/")) return;
    if (response.status() >= 400) errores.push(`${request.method()} ${response.url()} → ${response.status()}`);
  });

  // Fila de Clasificación por el número de su comprobante: la fila tiene su desplegable y su botón «Actualizar».
  const fila = (numero: string) => page.locator("tr").filter({ hasText: numero });

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Alta del cliente con IIBB y actividad de restaurante vinculada", async () => {
    await altaClienteRI(page, CLIENTE);
    await inscribirIIBB(page);
    await vincularActividad(page, IIBB.activity);
  });

  await test.step("Cajón «Registrar cambio de actividad»: la lista de «Actividad nueva» se ve completa y se cierra sin registrar", async () => {
    await page.getByRole("tab", { name: /^Actividades/ }).click();
    await page.getByRole("button", { name: "Registrar cambio de actividad", exact: true }).click();
    const cajon = page.locator(".action-drawer");
    await expect(cajon).toBeVisible();
    const campo = page.locator("#cambio-actividad-nueva");
    await campo.click();
    const lista = page.getByRole("listbox");
    await verificarListaCompleta(page, lista, [new RegExp(ACTIVIDAD_NUEVA)]);
    await page.screenshot({ path: test.info().outputPath("4v-cajon-desplegable-abierto.png") });
    await lista.getByRole("option", { name: new RegExp(ACTIVIDAD_NUEVA) }).first().click();
    await expect(campo).toHaveValue(new RegExp(ACTIVIDAD_NUEVA));
    await cajon.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(cajon).toBeHidden({ timeout: 15_000 });
  });

  await test.step("Vincular Comercio y Servicios: la lista de cada fila tiene cuatro opciones", async () => {
    await vincularEtiquetas(page, ACTIVIDADES_DESPUES);
  });

  await test.step("Octubre de 2026: período con su obligación de IIBB", async () => {
    await page.getByRole("tab", { name: /^Períodos y obligaciones/ }).click();
    await crearPeriodoIIBB(page, OCTUBRE);
  });

  const rotulo = rotuloDelPeriodo(OCTUBRE.mes, OCTUBRE.label);

  await test.step("Libro de ventas de octubre importado y revisado por el Titular", async () => {
    await activarAutorrevision(page);
    await libroDeOctubreRevisado(page, rotulo);
  });

  await test.step("Clasificación: la lista de la primera fila se ve completa (no la recorta la tabla)", async () => {
    await irAlLegajo(page, rotulo);
    await page.getByRole("tab", { name: /Clasificación/ }).click();
    await expect(page.locator('input[id^="actividad-"]')).toHaveCount(3);
    const primera = fila(NUMERO_FILA_1).locator('input[id^="actividad-"]');
    const tabla = primera.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ds-table__wrapper ')][1]");
    await primera.click();
    await verificarListaCompleta(page, page.getByRole("listbox"), [OPCION_COMERCIO, OPCION_RESTO, OPCION_SERVICIOS], tabla);
    await page.screenshot({ path: test.info().outputPath("4v-clasificacion-desplegable-abierto.png") });
  });

  await test.step("Primera fila: se elige COMERCIO por teclado y se guarda con «Actualizar»", async () => {
    const primera = fila(NUMERO_FILA_1).locator('input[id^="actividad-"]');
    await primera.click();
    await primera.pressSequentially("COMERCIO", { delay: 10 });
    await expect(page.getByRole("listbox").getByRole("option", { name: OPCION_COMERCIO })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(primera).toHaveValue(OPCION_COMERCIO);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await mutating(page, "/classifications/", () => fila(NUMERO_FILA_1).getByRole("button", { name: /^Actualizar/ }).click());
  });

  await test.step("Segunda fila: se elige RESTO-TUC con clic y se guarda con «Actualizar»", async () => {
    const segunda = fila(NUMERO_FILA_2).locator('input[id^="actividad-"]');
    await segunda.click();
    const opcion = page.getByRole("listbox").getByRole("option", { name: OPCION_RESTO });
    await expect(opcion).toBeVisible();
    await opcion.click();
    await expect(segunda).toHaveValue(OPCION_RESTO);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await mutating(page, "/classifications/", () => fila(NUMERO_FILA_2).getByRole("button", { name: /^Actualizar/ }).click());
  });

  await test.step("Al volver al Legajo, las dos actividades siguen guardadas", async () => {
    await irAlLegajo(page, rotulo);
    await page.getByRole("tab", { name: /Clasificación/ }).click();
    await expect(fila(NUMERO_FILA_1).locator('input[id^="actividad-"]')).toHaveValue(OPCION_COMERCIO);
    await expect(fila(NUMERO_FILA_2).locator('input[id^="actividad-"]')).toHaveValue(OPCION_RESTO);
  });

  test.info().annotations.push({ type: "errores de mutación", description: errores.join(" | ") || "ninguno" });
  expect(errores, "ninguna mutación de la API respondió con error").toEqual([]);
});
