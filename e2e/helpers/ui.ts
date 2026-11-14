import { expect, type Locator, type Page } from "@playwright/test";

/** Utilidades compartidas por los e2e que recorren la interfaz del estudio. */

export const RUN = Date.now().toString(36).toUpperCase();
export const SUFFIX = RUN.slice(-6);

/**
 * CUIT sintético con dígito verificador válido (prefijo 30: persona jurídica).
 * Cuando el resto da 10 no existe dígito válido para ese prefijo: se prueba el
 * número siguiente.
 */
export function syntheticCuit(seed: number): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (let candidate = seed; ; candidate += 1) {
    const base = `30${String(candidate % 100_000_000).padStart(8, "0")}`;
    const sum = base.split("").reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0);
    const remainder = 11 - (sum % 11);
    if (remainder === 10) continue;
    return `${base}${remainder === 11 ? 0 : remainder}`;
  }
}

export async function dismissGuidedTour(page: Page) {
  const skipTour = page.getByRole("button", { name: "Saltar tour", exact: true });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
}

export async function login(page: Page, email = "demo@contable.local", password = "demo1234") {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("#context-bar")).toBeVisible();
}

export async function goTo(page: Page, label: string) {
  await dismissGuidedTour(page);
  const menu = page.getByRole("button", { name: "Abrir navegación" });
  if (await menu.isVisible()) await menu.click();
  await dismissGuidedTour(page);
  if (["Usuarios y accesos", "Módulos de estudios", "Reglas fiscales", "Catálogos fiscales"].includes(label)) {
    const settingsToggle = page.getByRole("button", { name: "Ajustes del estudio", exact: true });
    if ((await settingsToggle.isVisible()) && (await settingsToggle.getAttribute("aria-expanded")) === "false") {
      await settingsToggle.click();
    }
  }
  await page.getByRole("link", { name: label, exact: true }).click();
}

/** Primer texto visible (los <option> ocultos de los selectores también coinciden con getByText). */
export function seen(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

/** Elige la opción de un <select> cuyo texto contiene `text` (las etiquetas llevan códigos extra). Espera a que las opciones carguen. */
export async function pickOption(select: Locator, text: string) {
  let value: string | null = null;
  await expect
    .poll(
      async () => {
        value = await select.locator("option").evaluateAll(
          (options, wanted) =>
            options.find((option) => (option.textContent ?? "").includes(wanted as string))?.getAttribute("value") ?? null,
          text,
        );
        return value;
      },
      { message: `opción que contiene «${text}»`, timeout: 10_000 },
    )
    .toBeTruthy();
  await select.selectOption(value!);
}

/** Espera una respuesta de mutación de la API mientras se ejecuta `action`, y exige que sea exitosa. */
export async function mutating(page: Page, urlPart: string, action: () => Promise<unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (item) => item.url().includes(urlPart) && ["POST", "PUT", "PATCH"].includes(item.request().method()),
    ),
    action(),
  ]);
  expect(response.status(), `${urlPart} → ${response.status()} ${await response.text().catch(() => "")}`).toBeLessThan(300);
  return response;
}
