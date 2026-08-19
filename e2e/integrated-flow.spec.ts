import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

async function navigateStudy(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Abrir navegación" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: label, exact: true }).click();
}

async function loginPortal(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("cliente@contable.local");
  await page.getByLabel("Contraseña").fill("cliente1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/portal$/);
}

test("seguridad anónima y navegación del estudio (Puerta 3)", async ({ page, request }) => {
  const publicResponse = await request.get(
    `${apiBaseUrl}/api/v1/firms/dddddddd-dddd-4ddd-8ddd-ddddddddd001/clients`,
  );
  expect(publicResponse.status()).toBe(401);

  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("demo@contable.local");
  await page.getByLabel("Contraseña").fill("demo1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Resumen operativo" })).toBeVisible();

  await navigateStudy(page, "Clientes");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Alimentos del Sur S\.A\./ })).toBeVisible();

  await navigateStudy(page, "Bandeja documental");
  await expect(page.getByRole("heading", { name: "Bandeja documental" })).toBeVisible();

  await navigateStudy(page, "Trabajo");
  await expect(page.getByRole("heading", { name: "Trabajo" })).toBeVisible();

  // G3-10: worklist de liquidaciones (nueva pantalla fiscal).
  await navigateStudy(page, "Liquidaciones");
  await expect(page.getByRole("heading", { name: "Liquidaciones" })).toBeVisible();

  // G5-06: la cartera por riesgo aparece en el dashboard con liquidaciones.
  await navigateStudy(page, "Inicio");
  await expect(page.getByRole("heading", { name: "Liquidaciones en curso" })).toBeVisible();

  // G0-03: Contabilidad y Reportes genéricos ya NO están en la navegación.
  await expect(page.getByRole("link", { name: "Contabilidad" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reportes y BI" })).toHaveCount(0);
});

test("navegación aislada del portal", async ({ page }) => {
  await loginPortal(page);
  await expect(page.getByRole("heading", { name: "Tu información contable" })).toBeVisible();

  // En desktop el nav usa el label largo; en mobile el shortLabel "Reportes".
  const reportesLink = page.getByRole("link", { name: "Estados y reportes" });
  if (await reportesLink.isVisible().catch(() => false)) {
    await reportesLink.click();
  } else {
    await page.getByRole("link", { name: "Reportes" }).click();
  }
  await expect(page.getByRole("heading", { name: "Estados y reportes" })).toBeVisible();
  await expect(page.getByText("Balance sintético")).toBeVisible();

  // G3-11: liquidaciones publicadas en el portal.
  const liquidacionesLink = page.getByRole("link", { name: "Liquidaciones" });
  if (await liquidacionesLink.isVisible().catch(() => false)) {
    await liquidacionesLink.click();
  } else {
    await page.getByRole("link", { name: "Liquidaciones" }).click();
  }
  await expect(page.getByRole("heading", { name: "Liquidaciones publicadas" })).toBeVisible();

  // Perfil: en mobile el bottom nav no muestra todos los items; navegación
  // directa para evitar la fragilidad del drawer/backdrop.
  await page.goto("/portal/perfil");
  await expect(page).toHaveURL(/\/portal\/perfil/);
  await expect(page.getByLabel("Nombre")).toHaveValue("Cliente Demo");
});