// Capturas de pantallas fiscales para PR #10 (entorno aislado local).
// Uso: node tools-capturas.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:4173";
const OUT = "/root/contable-ui-redesign-capturas/despues-corregido";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
async function capture(name, { width, height, path, fullPage = true, scrollBottom = false, actions }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "demo@contable.local");
  await page.fill("input[type=password]", "demo1234");
  await page.getByRole("button", { name: /Entrar a Contable/i }).click();
  await page.waitForURL(/^(?!.*\/login)/, { timeout: 15000 });
  // saltar tour si aparece
  const skip = page.getByRole("button", { name: /Saltar tour/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  // saltar tour si aparece en la pantalla destino
  const skipTarget = page.getByRole("button", { name: /Saltar tour/i });
  if (await skipTarget.isVisible().catch(() => false)) {
    await skipTarget.click();
    await page.waitForTimeout(400);
  }
  if (scrollBottom) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }
  if (actions) await actions(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log("captura", name);
  await context.close();
}

// Catálogos fiscales
await capture("catalogos-fiscales-desktop", { width: 1440, height: 900, path: "/catalogos-fiscales" });
await capture("catalogos-fiscales-mobile", { width: 390, height: 844, path: "/catalogos-fiscales" });
// Reglas fiscales
await capture("reglas-fiscales-desktop-top", { width: 1440, height: 900, path: "/reglas-fiscales" });
await capture("reglas-fiscales-mobile", { width: 390, height: 844, path: "/reglas-fiscales" });
// Reglas fiscales: drawer "Modificar alícuotas" abierto
await capture("reglas-fiscales-drawer-modificar-alicuotas", {
  width: 1440,
  height: 900,
  path: "/reglas-fiscales",
  actions: async (page) => {
    await page.getByRole("button", { name: "Modificar alícuotas" }).click();
    await page.waitForTimeout(500);
  },
});

await browser.close();
console.log("listo");
