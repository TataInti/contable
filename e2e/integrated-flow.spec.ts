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
  await page.getByRole("link", { name: label, exact: true }).click();
}

async function ensureStudyContext(page: Page) {
  // El cliente se elige en el menú lateral; el período, sólo en las pantallas
  // que lo necesitan, en la barra superior.
  const clientSelect = page.getByRole("combobox", { name: "Cliente en el que estás trabajando" });
  if ((await clientSelect.isEnabled()) && (await clientSelect.inputValue()) === "") {
    await clientSelect.click();
    const clientChoices = page.getByRole("listbox").getByRole("option");
    // La primera opción es el «vacío» (placeholder); la segunda, el primer cliente.
    if ((await clientChoices.count()) > 1) await clientChoices.nth(1).click();
    else await page.keyboard.press("Escape");
  }

  const periodSelect = page.locator("#context-bar").getByRole("combobox", { name: /^Período/ });
  if ((await periodSelect.count()) > 0 && (await periodSelect.isEnabled()) && (await periodSelect.inputValue()) === "") {
    await periodSelect.click();
    const periodChoices = page.getByRole("listbox").getByRole("option");
    if ((await periodChoices.count()) > 1) await periodChoices.nth(1).click();
    else await page.keyboard.press("Escape");
  }
}

async function loginPortal(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("cliente@contable.local");
  await page.getByLabel("Contraseña").fill("cliente1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/portal$/);
}

// El tour guiado se abre 650 ms después de montar el estudio mientras su marca no exista en el
// almacenamiento local. Esta prueba recorre el estudio por el menú y no necesita el tour: la marca
// se deja con el mismo valor que escribe «Saltar tour». Así el popover no intercepta los clics de
// navegación; antes, dismissGuidedTour miraba una sola vez si el popover estaba visible y el
// popover llegaba después del chequeo.
async function markGuidedTourSeen(page: Page) {
  await page.addInitScript(() => {
    if (window.localStorage.getItem("contable-study-navigation-tour-v1") === null) {
      window.localStorage.setItem("contable-study-navigation-tour-v1", "dismissed");
    }
  });
}

test("seguridad anónima y navegación del estudio (Puerta 3)", async ({ page, request }) => {
  test.setTimeout(60_000);
  await markGuidedTourSeen(page);
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

  await navigateStudy(page, "Legajo");
  await expect(page.getByRole("heading", { name: "Legajo", exact: true })).toBeVisible();

  // Rentabilidad no exige período contable (A27 D27-2 a): la pantalla resuelve su período con las
  // obligaciones fiscales del cliente. Muestra su selector de períodos fiscales, o su estado vacío si
  // el cliente no tiene obligaciones; no hay barra de período ni bloqueo «Elegí un período».
  await navigateStudy(page, "Rentabilidad");
  await expect(
    page
      .getByRole("combobox", { name: "Seleccionar período de rentabilidad" })
      .or(page.getByText("Sin período fiscal para calcular", { exact: true })),
  ).toBeVisible();
  await expect(page.locator("#context-bar")).toHaveCount(0);
  await expect(page.getByText("Elegí un período", { exact: true })).toHaveCount(0);
  await ensureStudyContext(page);
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
  await expect(page.getByRole("heading", { name: /Liquidaciones en curso/ })).toBeVisible();

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
