import { expect, test, type Locator, type Page } from "@playwright/test";
import { goTo, login, mutating } from "./helpers/ui";
import { pick } from "./helpers/liquidacion-ui";

/**
 * «Probar liquidación» de Reglas fiscales con el mínimo no imponible de Ingresos Brutos Tucumán, operado como lo
 * opera el contador: abre el paquete vigente, va a la pestaña Probar, carga el caso y lee el resultado.
 *
 * Importes calculados a mano en este archivo (no salen del motor que se prueba):
 *   1. Base 115.000, mínimo no imponible 15.000: (115.000 − 15.000) × 3,5 % = 3.500,00. Sin aviso.
 *   2. Base 200.000, mínimo no imponible 15.000: (200.000 − 15.000) × 3,5 % = 6.475,00. Sin aviso.
 *   3. Base 200.000, mínimo no imponible 250.000: el mínimo supera la base, la base queda en cero y el impuesto
 *      es 0,00. Aviso: «El mínimo no imponible supera la base del período…».
 *
 * El aviso aparece solo en el caso 3. Todo sintético; el simulador no guarda nada.
 */

const PAQUETE = "IIBB Contribuyente Local Tucumán V1";
const ALICUOTA = /RESTO-TUC/;
const AVISO = /El mínimo no imponible supera la base del período/;

/** Carga los dos importes del caso, envía la prueba y espera la respuesta del motor. */
async function probar(page: Page, base: string, minimo: string) {
  const sim = page.locator("#rule-simulator");
  const ingreso = sim.getByLabel(ALICUOTA);
  await ingreso.fill(base);
  await sim.getByLabel("Mínimo no imponible", { exact: true }).fill(minimo);
  await mutating(page, "/simulate", () => sim.getByRole("button", { name: "Probar", exact: true }).click());
  return sim;
}

/** El total a ingresar que muestra la prueba (formato argentino): el importe junto a la etiqueta «Total a ingresar». */
async function totalDe(sim: Locator, importe: string) {
  const fila = sim.getByText("Total a ingresar", { exact: true }).locator("..");
  await expect(fila, `total a ingresar ${importe}`).toContainText(importe, { timeout: 15_000 });
}

test("Probar liquidación de Ingresos Brutos Tucumán: el aviso de mínimo solo aparece cuando el mínimo supera la base", async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Reglas fiscales: abrir el paquete de Ingresos Brutos Tucumán y su pestaña Probar", async () => {
    await goTo(page, "Reglas fiscales");
    await page.getByRole("row").filter({ hasText: PAQUETE }).first().click();
    await expect(page.getByRole("heading", { name: PAQUETE, exact: true })).toBeVisible({ timeout: 15_000 });
    // El paquete puede tener un borrador más nuevo (otro spec de la misma base): se prueba la versión vigente, no el borrador.
    const versiones = page.getByRole("combobox", { name: "Versión del paquete" });
    if ((await versiones.count()) > 0) await pick(versiones, "v1 ·");
    await expect(page.locator(".fiscal-rule-summary__meta")).toContainText("Versión v1", { timeout: 15_000 });
    await page.getByRole("tab", { name: "Probar", exact: true }).click();
    await expect(page.locator("#rule-simulator").getByLabel(ALICUOTA)).toBeVisible();
  });

  await test.step("Caso 1: base 115.000 y mínimo 15.000 → 3.500,00, sin aviso", async () => {
    const sim = await probar(page, "115000", "15000");
    await totalDe(sim, "3.500,00");
    await expect(sim.locator(".rule-simulator__warnings")).toHaveCount(0);
    await expect(sim.getByText(AVISO)).toHaveCount(0);
  });

  await test.step("Caso 2: base 200.000 y mínimo 15.000 → 6.475,00, sin aviso (el mínimo no supera la base)", async () => {
    const sim = await probar(page, "200000", "15000");
    await totalDe(sim, "6.475,00");
    await expect(sim.getByText(AVISO)).toHaveCount(0);
  });

  await test.step("Caso 3: base 200.000 y mínimo 250.000 → 0,00, con el aviso de que el mínimo supera la base", async () => {
    const sim = await probar(page, "200000", "250000");
    await totalDe(sim, "0,00");
    await expect(sim.getByText(AVISO)).toBeVisible();
  });
});
