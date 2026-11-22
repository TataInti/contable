import { expect, test } from "@playwright/test";

/** El recorrido de primer uso no interrumpe el alta de un cliente en curso. */
test("una persona nueva puede elegir Provincia sin que se abra el recorrido", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("demo@contable.local");
  await page.getByLabel("Contraseña").fill("demo1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#study-navigation")).toBeVisible();

  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Nuevo cliente" });
  await expect(drawer).toBeVisible();

  const provincia = drawer.getByLabel("Provincia");
  await provincia.fill("Tucumán");
  await expect(page.getByText("Paso 1 · Cliente", { exact: true })).toHaveCount(0);
  const opcion = page.getByRole("option", { name: "Tucumán", exact: true });
  await expect(opcion).toBeVisible();
  await page.waitForTimeout(800);
  await expect(drawer).toBeVisible();
  await expect(provincia).toBeFocused();
  await opcion.click();
  await expect(provincia).toHaveValue("Tucumán");
  await expect(page.getByText("Paso 1 · Cliente", { exact: true })).toHaveCount(0);
});
