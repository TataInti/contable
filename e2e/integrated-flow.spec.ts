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

test("seguridad anónima y navegación del estudio", async ({ page, request }) => {
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

  await navigateStudy(page, "Contabilidad");
  await expect(page.getByRole("heading", { name: "Contabilidad" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Diario" })).toBeVisible();

  await navigateStudy(page, "Reportes y BI");
  await expect(page.getByRole("heading", { name: "Reportes y análisis" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Balance sintético" })).toBeVisible();
});

test("navegación aislada del portal", async ({ page }) => {
  await loginPortal(page);
  await expect(page.getByRole("heading", { name: "Tu información contable" })).toBeVisible();

  await page.getByRole("link", { name: "Estados y reportes" }).click();
  await expect(page.getByRole("heading", { name: "Estados y reportes" })).toBeVisible();
  await expect(page.getByText("Balance sintético")).toBeVisible();

  await page.getByRole("link", { name: "Perfil" }).click();
  await expect(page.getByLabel("Nombre")).toHaveValue("Cliente Demo");
});

test("carga segura desde el portal", async ({ page }) => {
  await loginPortal(page);
  await page.getByRole("link", { name: "Subir documentos" }).click();
  await expect(page.getByRole("heading", { name: "Subir documentos" })).toBeVisible();
  await page
    .getByLabel("Archivo")
    .setInputFiles("node_modules/playwright-core/lib/server/chromium/appIcon.png");
  await page.getByRole("button", { name: "Subir documento" }).click();
  await expect(page.getByRole("status")).toContainText("Documento subido correctamente", {
    timeout: 15_000,
  });
});
