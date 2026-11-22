import { expect, test, type Locator, type Page } from "@playwright/test";
import { SUFFIX, goTo, login, markGuidedTourSeen, mutating, syntheticCuit, RUN } from "./helpers/ui";

/**
 * Monotributista categoría A servicios, operado como lo opera el contador (cliente nuevo y sintético).
 *
 *   1. Nuevo cliente (condición IVA «Monotributista») → perfil fiscal activo.
 *   2. Configuración fiscal: inscripción en Monotributo y categoría A, actividad de servicios.
 *   3. Legajo del mes: la tarjeta «Monotributo — cuota de …» muestra la cuota de la escala vigente
 *      (A servicios desde 1/08/2026: 49.527,18) y el vencimiento el día 20.
 *   4. Registrar el pago de la cuota → «Pagada», el pago queda en la lista con su importe.
 *
 * Importes calculados a mano: cuota A servicios = 49.527,18 (escala ARCA vigente); vencimiento día 20 del mes.
 * Todo sintético y con el sufijo de la corrida. Solo se opera por la interfaz.
 */

const CLIENTE = {
  legalName: `Cliente E2E Monotributo ${SUFFIX}`,
  tradeName: `E2E Monotributo ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 5_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const ALTA = "2025-01-01";
const CUOTA_A_SERVICIOS = "49.527,18";
const VENCIMIENTO_DIA_20 = /20\/\d{2}\/2026/;

/** Desplegable con búsqueda: escribe, espera la lista y elige la opción cuyo texto empieza por lo pedido (exacto, sin confundir con el placeholder). */
async function pick(campo: Locator, texto: string) {
  await campo.fill(texto);
  const listboxId = await campo.getAttribute("aria-controls");
  const opcion = campo
    .page()
    .locator(`#${listboxId}`)
    .getByRole("option")
    .filter({ hasText: new RegExp(`^${texto}\\b`) })
    .first();
  await expect(opcion, `opción que empieza por «${texto}»`).toBeVisible({ timeout: 10_000 });
  await opcion.evaluate((elemento: HTMLElement) => elemento.click());
}

const importe = (texto: string) => new RegExp(texto.replace(/\./g, "\\.").replace(/,/g, ","));

test("monotributo: categoría A servicios, cuota en el Legajo y pago registrado, desde la interfaz", async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  await markGuidedTourSeen(page);

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Clientes: alta de un monotributista nuevo", async () => {
    await goTo(page, "Clientes");
    await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
    await page.locator("#client-legal-name").fill(CLIENTE.legalName);
    await page.locator("#client-trade-name").fill(CLIENTE.tradeName);
    await page.locator("#client-cuit").fill(CLIENTE.cuit);
    await pick(page.locator("#client-vat-condition"), "Monotributista");
    await pick(page.locator("#client-province"), "Buenos Aires");
    await page.locator(".action-drawer").getByRole("button", { name: "Guardar cliente" }).click();
    await expect(page).toHaveURL(/\/configuracion-fiscal/);
  });

  await test.step("Configuración fiscal: perfil activo", async () => {
    await page.getByRole("button", { name: "Crear perfil fiscal" }).first().click();
    await page.locator("#pf-legal-name").fill(CLIENTE.legalName);
    await page.locator("#pf-cuit").fill(CLIENTE.cuit);
    await page.locator("#pf-fiscal-address").fill(CLIENTE.fiscalAddress);
    await pick(page.locator("#pf-person-type"), "Física");
    await pick(page.locator("#pf-condition"), "Monotributista");
    await page.locator("#pf-valid-from").fill(ALTA);
    await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByRole("button", { name: "Activar perfil" }).click();
    await expect(page.getByRole("button", { name: "Crear nueva versión" })).toBeVisible();
  });

  await test.step("Configuración fiscal: inscripción en Monotributo desde el alta", async () => {
    await page.getByRole("tab", { name: /^Regímenes/ }).click();
    await page
      .locator(".fiscal-client-overview__heading")
      .filter({ has: page.getByRole("heading", { name: "Regímenes adheridos", exact: true }) })
      .getByRole("button", { name: "Agregar" })
      .click();
    await pick(page.locator("#reg-regime"), "Monotributo");
    await page.locator("#reg-from").fill(ALTA);
    await mutating(page, "/tax-registrations", () =>
      page.getByRole("button", { name: "Registrar inscripción", exact: true }).last().click(),
    );
  });

  await test.step("Configuración fiscal: categoría A, actividad de servicios", async () => {
    await page.getByRole("button", { name: /Elegir categoría|Cambiar categoría/ }).first().click();
    await page.locator("#categoria-monotributo-desde").fill(ALTA);
    await pick(page.locator("#categoria-monotributo-actividad"), "Servicios");
    await pick(page.locator("#categoria-monotributo-categoria"), "A");
    await mutating(page, "monotributo", () => page.getByRole("button", { name: "Guardar categoría" }).click());
  });

  await test.step("Legajo: la tarjeta muestra la cuota de la escala y el vencimiento del día 20", async () => {
    await goTo(page, "Liquidaciones");
    await goTo(page, "Legajo");
    const tarjeta = page.locator(".monotributo-card").first();
    await expect(tarjeta.getByRole("heading", { name: /Monotributo — cuota de/ })).toBeVisible();
    await expect(tarjeta.getByText(importe(CUOTA_A_SERVICIOS)).first()).toBeVisible();
    await expect(tarjeta.getByText(VENCIMIENTO_DIA_20).first()).toBeVisible();
  });

  await test.step("Legajo: registrar el pago de la cuota y verlo en el historial", async () => {
    const tarjeta = page.locator(".monotributo-card").first();
    await tarjeta.getByRole("button", { name: "Registrar pago", exact: true }).click();
    await page.locator("#monotributo-pago-importe").fill(CUOTA_A_SERVICIOS);
    await mutating(page, "monotributo", () =>
      page.locator(".action-drawer").getByRole("button", { name: "Registrar pago", exact: true }).click(),
    );
    await expect(tarjeta.getByText("Pagada")).toBeVisible();
    await expect(tarjeta.getByText(/Pagos registrados/)).toBeVisible();
    await expect(tarjeta.getByText(importe(CUOTA_A_SERVICIOS)).first()).toBeVisible();
  });
});
