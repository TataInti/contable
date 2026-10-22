import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

async function navigateStudy(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Abrir navegación" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: label, exact: true }).click();
}

async function ensureStudyContext(page: Page) {
  const contextBar = page.locator("#context-bar");
  const clientSelect = contextBar.getByLabel("Cliente");
  const periodSelect = contextBar.getByLabel("Período");

  if ((await clientSelect.inputValue()) === "") {
    const clientOptions = await clientSelect.locator("option").evaluateAll((options) =>
      options
        .map((option) => option.getAttribute("value") ?? "")
        .filter((value) => value.length > 0),
    );
    if (clientOptions.length > 0) await clientSelect.selectOption(clientOptions[0]!);
  }

  if ((await periodSelect.inputValue()) === "") {
    const periodOptions = await periodSelect.locator("option").evaluateAll((options) =>
      options
        .map((option) => option.getAttribute("value") ?? "")
        .filter((value) => value.length > 0),
    );
    if (periodOptions.length > 0) await periodSelect.selectOption(periodOptions[0]!);
  }
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
  await ensureStudyContext(page);

  await navigateStudy(page, "Clientes");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Alimentos del Sur S\.A\./ })).toBeVisible();

  await navigateStudy(page, "Bandeja documental");
  await expect(page.getByRole("heading", { name: "Bandeja documental" })).toBeVisible();

  await navigateStudy(page, "Trabajo");
  await expect(page.getByRole("heading", { name: "Trabajo" })).toBeVisible();

  await navigateStudy(page, "Configuración fiscal");
  await expect(page.getByRole("heading", { name: "Onboarding fiscal del cliente" })).toBeVisible();

  // La contabilidad de asientos quedó fuera de la navegación: la app se enfoca
  // en el flujo de liquidación fiscal mensual.
  await expect(
    page.getByRole("link", { name: "Contabilidad", exact: true }),
  ).toHaveCount(0);

  // G3-10: worklist de liquidaciones (nueva pantalla fiscal).
  await navigateStudy(page, "Liquidaciones");
  await expect(page.getByRole("heading", { name: "Liquidaciones" })).toBeVisible();

  await navigateStudy(page, "Expediente mensual");
  await expect(page.getByRole("heading", { name: "Expediente mensual" })).toBeVisible();

  await navigateStudy(page, "Rentabilidad");
  await expect(page.getByRole("heading", { name: "Rentabilidad" })).toBeVisible();

  // Reportes y análisis (BI) tampoco forma parte de la navegación del estudio.
  await expect(
    page.getByRole("link", { name: "Reportes y análisis", exact: true }),
  ).toHaveCount(0);

  // El asistente contable queda oculto hasta que el piloto lo habilite (§8).
  await expect(
    page.getByRole("link", { name: "Asistente contable", exact: true }),
  ).toHaveCount(0);

  // G5-06: la cartera por riesgo aparece en el dashboard con liquidaciones.
  await navigateStudy(page, "Inicio");
  await expect(page.getByRole("heading", { name: "Liquidaciones en curso" })).toBeVisible();

  // URL directa al asistente: muestra estado no disponible, no la pantalla.
  await page.goto("/asistente");
  await expect(
    page.getByRole("heading", { name: "Esta sección todavía no está disponible" }),
  ).toBeVisible();

  await page.goto("/ruta-obsoleta");
  await expect(page.getByRole("heading", { name: "Esta sección no existe" })).toBeVisible();
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
  await expect(page.getByText("Balance sintético", { exact: true })).toBeVisible();

  // G3-11: liquidaciones publicadas en el portal.
  // Exact para no chocar con el quick-link "Ver liquidaciones" del dashboard.
  const liquidacionesLink = page.getByRole("link", { name: "Liquidaciones", exact: true });
  if (await liquidacionesLink.isVisible().catch(() => false)) {
    await liquidacionesLink.click();
  } else {
    await page.goto("/portal/liquidaciones");
  }
  await expect(page.getByRole("heading", { name: "Liquidaciones publicadas" })).toBeVisible();

  // Perfil: en mobile el bottom nav no muestra todos los items; navegación
  // directa para evitar la fragilidad del drawer/backdrop.
  await page.goto("/portal/perfil");
  await expect(page).toHaveURL(/\/portal\/perfil/);
  await expect(page.getByLabel("Nombre")).toHaveValue("Cliente Demo");
});
