import { expect, test, type Locator } from "@playwright/test";
import { abrirInscripcionManual, goTo, login } from "./helpers/ui";

/**
 * Desplegables con búsqueda en tres pantallas del estudio, operados como el contador: escribe en el campo,
 * la lista se filtra con lo escrito y elige la opción. No guarda nada: cada alta se cancela.
 *
 *   1. Alta de cliente: provincia «Tucum» → Tucumán.
 *   2. Configuración fiscal (cliente de la demo): régimen «Monotrib» → Monotributo, en el formulario de inscripción.
 *   3. Reglas fiscales: nuevo paquete, régimen «Responsable» → Responsable Inscripto.
 */

/** Escribe en el desplegable, comprueba que la lista se filtró con el texto y elige la opción pedida. */
async function buscarYElegir(campo: Locator, escrito: string, opcion: string) {
  await expect(campo).toBeVisible();
  await campo.fill(escrito);
  const listboxId = await campo.getAttribute("aria-controls");
  expect(listboxId, "el desplegable declara su lista (aria-controls)").toBeTruthy();
  const opciones = campo.page().locator(`#${listboxId}`).getByRole("option");
  await expect(opciones.first(), `opciones que contienen «${escrito}»`).toBeVisible({ timeout: 10_000 });
  const textos = await opciones.allTextContents();
  expect(
    textos.some((texto) => texto.toLowerCase().includes(escrito.toLowerCase())),
    `alguna opción contiene «${escrito}» (se ven: ${textos.join(" | ")})`,
  ).toBe(true);
  await opciones.filter({ hasText: opcion }).first().click();
  await expect(campo).toHaveValue(new RegExp(opcion));
}

test("desplegables con búsqueda en alta de cliente, configuración fiscal y reglas", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Alta de cliente: provincia buscada por texto", async () => {
    await goTo(page, "Clientes");
    await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
    await buscarYElegir(page.locator("#client-province"), "Tucum", "Tucumán");
    await page.keyboard.press("Escape");
  });

  await test.step("Configuración fiscal: régimen buscado por texto en la inscripción", async () => {
    // El menú «Configuración fiscal» trabaja sobre el cliente elegido: se elige el de la demo.
    await buscarYElegir(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" }), "Alimentos", "Alimentos del Sur");
    await goTo(page, "Configuración fiscal");
    await page.getByRole("tab", { name: /^Regímenes/ }).click();
    await page
      .locator(".fiscal-client-overview__heading")
      .filter({ has: page.getByRole("heading", { name: "Regímenes adheridos", exact: true }) })
      .getByRole("button", { name: "Agregar" })
      .click();
    await abrirInscripcionManual(page);
    await buscarYElegir(page.locator("#reg-regime"), "Monotrib", "Monotributo");
    await page.keyboard.press("Escape");
  });

  await test.step("Reglas fiscales: régimen buscado por texto en un paquete nuevo", async () => {
    await goTo(page, "Reglas fiscales");
    await page.getByRole("button", { name: /^Nuevo paquete|^Cerrar alta/ }).first().click();
    await buscarYElegir(page.locator("#new-rule-pack-regime"), "Responsable", "Responsable Inscripto");
    await page.keyboard.press("Escape");
  });
});
