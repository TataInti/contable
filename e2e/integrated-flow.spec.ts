import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

async function dismissGuidedTour(page: Page) {
  const skipTour = page.getByRole("button", { name: "Saltar tour", exact: true });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
}

async function navigateStudy(page: Page, label: string) {
  await dismissGuidedTour(page);
  const menu = page.getByRole("button", { name: "Abrir navegación" });
  if (await menu.isVisible()) await menu.click();
  await dismissGuidedTour(page);
  if (["Usuarios y accesos", "Módulos de estudios", "Reglas fiscales", "Catálogos fiscales"].includes(label)) {
    const settingsToggle = page.getByRole("button", { name: "Ajustes del estudio", exact: true });
    if (
      (await settingsToggle.isVisible()) &&
      (await settingsToggle.getAttribute("aria-expanded")) === "false"
    ) {
      await settingsToggle.click();
    }
  }
  await page.getByRole("link", { name: label, exact: true }).click();
}

async function ensureStudyContext(page: Page) {
  const contextBar = page.locator("#context-bar");
  const clientSelect = contextBar.getByRole("combobox", { name: /^Cliente/ });
  const periodSelect = contextBar.getByRole("combobox", { name: /^Período/ });

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
  test.setTimeout(60_000);
  const publicResponse = await request.get(
    `${apiBaseUrl}/api/v1/firms/dddddddd-dddd-4ddd-8ddd-ddddddddd001/clients`,
  );
  expect(publicResponse.status()).toBe(401);

  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("demo@contable.local");
  await page.getByLabel("Contraseña").fill("demo1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Resumen operativo", exact: true })).toBeVisible();
  await ensureStudyContext(page);

  await navigateStudy(page, "Clientes");
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Alimentos del Sur S\.A\./ })).toBeVisible();

  await navigateStudy(page, "Bandeja documental");
  await expect(page.getByRole("heading", { name: "Bandeja documental", exact: true })).toBeVisible();

  await navigateStudy(page, "Trabajo");
  await expect(page.getByRole("heading", { name: "Trabajo", exact: true })).toBeVisible();

  await navigateStudy(page, "Configuración fiscal");
  await expect(page.getByRole("heading", { name: "Configuración fiscal", exact: true })).toBeVisible();

  await navigateStudy(page, "Catálogos fiscales");
  await expect(page.getByRole("heading", { name: "Catálogos fiscales", exact: true })).toBeVisible();

  // La contabilidad de asientos quedó fuera de la navegación: la app se enfoca
  // en el flujo de liquidación fiscal mensual.
  await expect(
    page.getByRole("link", { name: "Contabilidad", exact: true }),
  ).toHaveCount(0);

  // G3-10: worklist de liquidaciones (nueva pantalla fiscal).
  await navigateStudy(page, "Liquidaciones");
  await expect(page.getByRole("heading", { name: "Liquidaciones", exact: true })).toBeVisible();

  await navigateStudy(page, "Expediente mensual");
  await expect(page.getByRole("heading", { name: "Expediente mensual", exact: true })).toBeVisible();

  await navigateStudy(page, "Rentabilidad");
  await expect(page.getByRole("heading", { name: "Rentabilidad", exact: true })).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Liquidaciones en curso", exact: true })).toBeVisible();

  // URL directa al asistente: muestra estado no disponible, no la pantalla.
  await page.goto("/asistente");
  await expect(
    page.getByRole("heading", { name: "Esta sección todavía no está disponible", exact: true }),
  ).toBeVisible();

  await page.goto("/ruta-obsoleta");
  await expect(page.getByRole("heading", { name: "Esta sección no existe", exact: true })).toBeVisible();
});

test("navegación aislada del portal", async ({ page }) => {
  test.setTimeout(60_000);
  await loginPortal(page);
  await expect(page.getByRole("heading", { name: "Tu información contable", exact: true })).toBeVisible();

  // En desktop el nav usa el label largo; en mobile el shortLabel "Reportes".
  const reportesLink = page.getByRole("link", { name: "Estados y reportes" });
  if (await reportesLink.isVisible().catch(() => false)) {
    await reportesLink.click();
  } else {
    await page.getByRole("link", { name: "Reportes" }).click();
  }
  await expect(page.getByRole("heading", { name: "Estados y reportes", exact: true })).toBeVisible();
  await expect(page.getByText("Balance sintético", { exact: true })).toBeVisible();

  // G3-11: liquidaciones publicadas en el portal.
  // Exact para no chocar con el quick-link "Ver liquidaciones" del dashboard.
  const liquidacionesLink = page.getByRole("link", { name: "Liquidaciones", exact: true });
  if (await liquidacionesLink.isVisible().catch(() => false)) {
    await liquidacionesLink.click();
  } else {
    await page.goto("/portal/liquidaciones");
  }
  await expect(page.getByRole("heading", { name: "Liquidaciones publicadas", exact: true })).toBeVisible();

  // Perfil: en mobile el bottom nav no muestra todos los items; navegación
  // directa para evitar la fragilidad del drawer/backdrop.
  await page.goto("/portal/perfil");
  await expect(page).toHaveURL(/\/portal\/perfil/);
  await expect(page.getByLabel("Nombre")).toHaveValue("Cliente Demo");
});
