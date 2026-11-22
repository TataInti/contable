import { expect, test, type Page } from "@playwright/test";
import { RUN, SUFFIX, login, mutating, syntheticCuit } from "./helpers/ui";
import {
  activarAutorrevision,
  altaClienteRI,
  abrirLegajo,
  cargarLibroVentas,
  cargarPercepcionDgr,
  cerrarGestion,
  calcularIIBB,
  clasificarListo,
  crearPeriodoIIBB,
  esperarImporte,
  inscribirIIBB,
  irAlLegajo,
  revisarLotesDe,
  rotuloDelPeriodo,
  vincularActividad,
  IIBB,
} from "./helpers/liquidacion-ui";
import { libroVentasXlsx, type FacturaSintetica } from "./helpers/fuentes-sinteticas";

/**
 * Fuentes del Legajo, operadas como las opera el contador. Retirar, volver a cargar y reemplazar un archivo
 * solo se puede antes de calcular el mes («En un mes calculado no se cargan archivos»), así que el recorrido
 * usa dos meses del mismo cliente:
 *
 *   Octubre de 2026 (retiro y recarga de la percepción):
 *   1. Cliente Responsable Inscripto en Tucumán, IIBB con actividad de restaurante, períodos de octubre y septiembre.
 *   2. Libro de ventas de octubre (3 facturas, neto 115.000) y percepción de la DGR (TXT, 1.500,55), revisados por el Titular.
 *   3. Retirar la percepción con motivo → «No hay archivos vigentes» → volver a cargar el mismo TXT y revisarlo.
 *   4. Cálculo: 115.000 × 3,5 % = 4.025,00 ; − 1.500,55 = 2.524,45 (sin mínimo). El descuento cuenta una sola vez.
 *
 *   Septiembre de 2026 (reemplazos del libro de ventas, antes de calcular):
 *   5. Libro de septiembre (neto 115.000) revisado; reemplazarlo con el mismo archivo → «idéntico al que ya está vigente»,
 *      sin lote nuevo.
 *   6. Reemplazarlo con otro libro (neto 100.000) y revisarlo → el cálculo usa solo el nuevo: 100.000 × 3,5 % = 3.500,00.
 *
 * Todo sintético y con el sufijo de la corrida. Importes calculados a mano en este archivo.
 */

const CLIENTE = {
  legalName: `Cliente E2E Fuentes ${SUFFIX} S.R.L.`,
  tradeName: `E2E Fuentes ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 6_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const AGENTE_DGR = syntheticCuit(Number.parseInt(RUN, 36) + 6_500);
const OCTUBRE = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026", label: `Octubre 2026 IIBB ${SUFFIX}` };
const SEPTIEMBRE = { start: "2026-09-01", end: "2026-09-30", mes: "Septiembre de 2026", label: `Septiembre 2026 IIBB ${SUFFIX}` };
const PERCEPCION = { importe: "1500.55", fecha: "15/10/2026", etiqueta: "151020261200" };

/** Facturas A sintéticas por mes: la base es la suma de los netos. */
function facturas(mes: "09" | "10", base: number, netos: string[]): FacturaSintetica[] {
  return netos.map((neto, indice) => ({
    fecha: `2026-${mes}-${String(5 + indice * 8).padStart(2, "0")}`,
    tipo: "1",
    numero: String(base + indice),
    docTipo: "80",
    docNumero: syntheticCuit(Number.parseInt(RUN, 36) + base * 10 + indice),
    denominacion: `Comensal E2E ${mes}-${indice + 1}`,
    neto,
    iva: (Number(neto) * 0.21).toFixed(2),
  }));
}
/** Octubre: 50.000 + 40.000 + 25.000 = 115.000 neto. */
const LIBRO_OCTUBRE = facturas("10", 101, ["50000.00", "40000.00", "25000.00"]);
/** Septiembre: 50.000 + 40.000 + 25.000 = 115.000 neto (mismas bases, otro mes). */
const LIBRO_SEPTIEMBRE = facturas("09", 301, ["50000.00", "40000.00", "25000.00"]);
/** Septiembre, otra base: 60.000 + 40.000 = 100.000 neto. */
const LIBRO_SEPTIEMBRE_NUEVA_BASE = facturas("09", 401, ["60000.00", "40000.00"]);
/** Bytes exactos del libro de septiembre: el reemplazo «con el mismo archivo» sube estos mismos bytes (mismo hash). */
const BYTES_SEPTIEMBRE = Buffer.from(libroVentasXlsx(LIBRO_SEPTIEMBRE));

/** Importe que no debe aparecer en la pantalla del Legajo (p. ej. el descuento contado dos veces). */
async function importeAusente(page: Page, texto: string) {
  const patron = new RegExp(texto.replace(/\./g, "\\.").replace(/,/g, ","));
  await expect(page.locator(".work-page").first().getByText(patron), `«${texto}» no debe aparecer`).toHaveCount(0);
}

/** Libro de ventas ya cargado e importado: se abre el panel y se importa (sin reemplazar). */
async function importarLibro(page: Page, datos: FacturaSintetica[], nombre: string, bytes?: Buffer) {
  const { libro } = await cargarLibroVentas(page, datos, nombre, false, bytes);
  await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
  await expect(page.getByRole("dialog", { name: "Importar libros IVA" })).toBeHidden({ timeout: 60_000 });
}

test("fuentes del Legajo: retirar y volver a cargar una percepción, y reemplazar un libro antes de calcular", async ({ page }) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);

  const errores: string[] = [];
  let rechazoEsperado = false;
  page.on("response", (response) => {
    const request = response.request();
    if (rechazoEsperado) return;
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    if (!response.url().includes("/api/v1/")) return;
    if (response.status() >= 400) errores.push(`${request.method()} ${response.url()} → ${response.status()}`);
  });

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Clientes y configuración fiscal: alta, IIBB con actividad de restaurante y períodos de septiembre y octubre de 2026", async () => {
    await altaClienteRI(page, CLIENTE);
    await inscribirIIBB(page);
    await vincularActividad(page, IIBB.activity);
    await crearPeriodoIIBB(page, OCTUBRE);
    await crearPeriodoIIBB(page, SEPTIEMBRE);
    await page.getByRole("tab", { name: "Resumen", exact: true }).click();
    await expect(page.getByText("Configuración completa")).toBeVisible();
  });

  const rotuloOctubre = rotuloDelPeriodo(OCTUBRE.mes, OCTUBRE.label);
  const rotuloSeptiembre = rotuloDelPeriodo(SEPTIEMBRE.mes, SEPTIEMBRE.label);

  await test.step("Legajo de octubre: libro de ventas de 115.000 y percepción de la DGR de 1.500,55", async () => {
    await abrirLegajo(page, rotuloOctubre);
    await importarLibro(page, LIBRO_OCTUBRE, `ventas-oct-${SUFFIX}.xlsx`);
    await cargarPercepcionDgr(page, CLIENTE.cuit, AGENTE_DGR, PERCEPCION.importe, PERCEPCION.fecha, PERCEPCION.etiqueta);
    await cerrarGestion(page);
  });

  await test.step("Revisión de octubre: el Titular revisa los dos lotes (autorrevisión activada en Controles)", async () => {
    await activarAutorrevision(page);
    await irAlLegajo(page, rotuloOctubre);
    await revisarLotesDe(page, "Gestionar Ventas del período");
    await revisarLotesDe(page, "Gestionar Retenciones y percepciones IIBB Tucumán");
  });

  await test.step("Retirar la percepción con motivo: queda en el historial y deja de figurar como vigente", async () => {
    await page.getByRole("tab", { name: /Fuentes/ }).first().click();
    await page.getByRole("button", { name: "Gestionar Retenciones y percepciones IIBB Tucumán" }).click();
    await page.getByRole("button", { name: "Retirar", exact: true }).click();
    await page.getByLabel("Motivo").fill(`E2E ${SUFFIX}: retiro para probar el ciclo; el mismo archivo se vuelve a cargar y revisar.`);
    await mutating(page, "/retire", () => page.getByRole("button", { name: "Confirmar retiro" }).click());
    await expect(page.getByText("No hay archivos vigentes")).toBeVisible();
    await cerrarGestion(page);
  });

  await test.step("Volver a cargar el mismo TXT y revisarlo: el mismo archivo cuenta de nuevo", async () => {
    await cargarPercepcionDgr(page, CLIENTE.cuit, AGENTE_DGR, PERCEPCION.importe, PERCEPCION.fecha, PERCEPCION.etiqueta);
    await cerrarGestion(page);
    await revisarLotesDe(page, "Gestionar Retenciones y percepciones IIBB Tucumán");
  });

  await test.step("Cálculo de octubre: IIBB 4.025,00 − 1.500,55 = 2.524,45, descontado una sola vez", async () => {
    await clasificarListo(page);
    await calcularIIBB(page);
    await esperarImporte(page, "4.025,00");
    await esperarImporte(page, "1.500,55");
    await esperarImporte(page, "2.524,45");
    // Descontar dos veces daría 4.025,00 − 3.001,10 = 1.023,90: no debe aparecer.
    await importeAusente(page, "1.023,90");
  });

  await test.step("Legajo de septiembre: libro de ventas de 115.000 importado y revisado", async () => {
    await abrirLegajo(page, rotuloSeptiembre);
    await importarLibro(page, LIBRO_SEPTIEMBRE, `ventas-sept-${SUFFIX}.xlsx`, BYTES_SEPTIEMBRE);
    await revisarLotesDe(page, "Gestionar Ventas del período");
  });

  await test.step("Reemplazar el libro de septiembre con el mismo archivo: «idéntico al que ya está vigente», nada nuevo", async () => {
    await page.getByRole("tab", { name: /Fuentes/ }).first().click();
    await page.getByRole("button", { name: "Gestionar Ventas del período" }).click();
    await page.getByRole("button", { name: "Reemplazar", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Reemplazar libro IVA" });
    const libro = panel.locator('section[aria-label="Libro de ventas"]');
    await libro.locator('input[type="file"]').setInputFiles({
      name: `ventas-sept-${SUFFIX}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: BYTES_SEPTIEMBRE,
    });
    await libro.getByRole("button", { name: "Analizar alícuotas", exact: true }).click();
    await expect(libro.getByRole("button", { name: "Importar", exact: true })).toBeEnabled({ timeout: 60_000 });
    rechazoEsperado = true;
    const [respuesta] = await Promise.all([
      page.waitForResponse((item) => item.url().includes("/sifere/import") && item.request().method() === "POST"),
      libro.getByRole("button", { name: "Importar", exact: true }).click(),
    ]);
    rechazoEsperado = false;
    expect(respuesta.status(), "el mismo archivo se rechaza sin crear lote").toBeGreaterThanOrEqual(400);
    await expect(panel.getByText(/idéntico al que ya está vigente/)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("Reemplazar con otra base (100.000) y calcular solo con el nuevo: 100.000 × 3,5 % = 3.500,00", async () => {
    const { libro } = await cargarLibroVentas(page, LIBRO_SEPTIEMBRE_NUEVA_BASE, `ventas-sept-nueva-base-${SUFFIX}.xlsx`, true);
    await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
    await expect(page.getByRole("dialog", { name: "Reemplazar libro IVA" })).toBeHidden({ timeout: 60_000 });
    await revisarLotesDe(page, "Gestionar Ventas del período");
    await clasificarListo(page);
    await calcularIIBB(page);
    await esperarImporte(page, "3.500,00");
    await importeAusente(page, "4.025,00");
  });

  test.info().annotations.push({ type: "errores de mutación", description: errores.join(" | ") || "ninguno" });
  expect(errores, "ninguna mutación de la API respondió con error").toEqual([]);
});
