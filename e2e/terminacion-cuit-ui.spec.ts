import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
 * Terminación de CUIT en Clientes y Configuración fiscal (corte 1 del plan de calendarios).
 * Datos sintéticos rotulados: la API se responde desde la prueba (sin base de datos ni datos reales).
 * Medidas de layout a 1440×900 y 1280×720: sin desborde de página y tabla dentro de su contenedor.
 * Con E2E_CAPTURAS_DIR definido, la prueba guarda las capturas en ese directorio.
 */

const FIRM_ID = "firm-sintetica";
const PERIOD_ID = "period-sintetico-2026-10";
const CAPTURAS = process.env.E2E_CAPTURAS_DIR ?? "";

interface ClienteSintetico {
  id: string;
  legalName: string;
  tradeName: null;
  cuit: string;
  cuitEnding: string | null;
  status: "ACTIVE" | "ONBOARDING";
  profile: null;
}

const CLIENTES: ClienteSintetico[] = [
  { id: "cli-0", legalName: "SINTÉTICO 00 S.A.", tradeName: null, cuit: "20000000060", cuitEnding: "0", status: "ACTIVE", profile: null },
  { id: "cli-1", legalName: "SINTÉTICO 01 S.R.L.", tradeName: null, cuit: "20000000001", cuitEnding: "1", status: "ACTIVE", profile: null },
  { id: "cli-2", legalName: "SINTÉTICO 02 S.A.", tradeName: null, cuit: "20000000052", cuitEnding: "2", status: "ACTIVE", profile: null },
  { id: "cli-9a", legalName: "SINTÉTICO 09 A S.R.L.", tradeName: null, cuit: "20000000079", cuitEnding: "9", status: "ACTIVE", profile: null },
  { id: "cli-9b", legalName: "SINTÉTICO 09 B S.A.", tradeName: null, cuit: "20000000079", cuitEnding: "9", status: "ACTIVE", profile: null },
  { id: "cli-sin-cuit", legalName: "SINTÉTICO SIN CUIT", tradeName: null, cuit: "", cuitEnding: null, status: "ONBOARDING", profile: null },
];

const SESION = {
  userId: "usuario-sintetico",
  firms: [
    {
      firmId: FIRM_ID,
      firmName: "Estudio SINTÉTICO",
      role: "TITULAR",
      capabilities: ["client.read", "client.manage", "tax.profile.read"],
      clients: CLIENTES.map((cliente) => ({
        clientId: cliente.id,
        clientName: cliente.legalName,
        periods: [{ periodId: PERIOD_ID, label: "Oct 2026", status: "OPEN" }],
      })),
    },
  ],
};

function respuesta(path: string): unknown {
  if (path === "/me/contexts") return SESION;
  if (path === "/portal/contexts") return [];
  if (path === `/firms/${FIRM_ID}/clients`) return CLIENTES;
  const detalle = path.match(new RegExp(`^/firms/${FIRM_ID}/clients/([^/]+)$`));
  if (detalle) return CLIENTES.find((cliente) => cliente.id === detalle[1]) ?? null;
  // Catálogos y listas secundarias: vacíos (la prueba no los necesita).
  return [];
}

async function prepararSesion(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "contable.context.v2.study",
      JSON.stringify({ firmId: "firm-sintetica", clientId: "cli-9a", periodId: "period-sintetico-2026-10" }),
    );
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.fulfill({
        status: 405,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "SOLO_LECTURA", message: "La prueba responde solo lecturas." } }),
      });
      return;
    }
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(respuesta(path)) });
  });
}

async function medidasDeLayout(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scroll = document.querySelector<HTMLElement>(".dense-table-scroll");
    const tabla = document.querySelector<HTMLElement>("table.dense-table");
    return {
      desbordePagina: root.scrollWidth - root.clientWidth,
      desbordeContenedor: scroll ? scroll.scrollWidth - scroll.clientWidth : -1,
      tablaDentro: scroll && tabla ? tabla.getBoundingClientRect().right <= scroll.getBoundingClientRect().right + 1 : false,
    };
  });
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  const saltar = page.getByRole("button", { name: "Saltar tour" });
  if (await saltar.isVisible().catch(() => false)) await saltar.click();
  await page.screenshot({ path: `${CAPTURAS}/${nombre}` });
}

const filas = (page: Page) => page.locator("tbody tr[data-row-key]");

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test.describe(`escritorio ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("Clientes filtra por dígito, agrupa por terminación y conserva la vista en la URL", async ({ page }) => {
      await prepararSesion(page);
      await page.goto("/clientes");
      await expect(page.getByRole("table", { name: "Cartera de clientes" })).toBeVisible({ timeout: 20_000 });
      await expect(filas(page)).toHaveCount(6);

      const medidas = await medidasDeLayout(page);
      expect(medidas.desbordePagina).toBeLessThanOrEqual(0);
      expect(medidas.desbordeContenedor).toBeLessThanOrEqual(0);
      expect(medidas.tablaDentro).toBe(true);

      const digitos = page.getByRole("group", { name: "Terminación de CUIT" });
      await digitos.getByRole("button", { name: "9" }).click();
      await expect(page).toHaveURL(/terminacion=9/);
      await expect(filas(page)).toHaveCount(2);
      await capturar(page, `clientes-filtrado-${viewport.width}x${viewport.height}.png`);

      await digitos.getByRole("button", { name: "9" }).click();
      await expect(filas(page)).toHaveCount(6);
      await page.getByRole("button", { name: "Agrupar por terminación" }).click();
      await expect(page).toHaveURL(/agrupar=terminacion/);
      await expect(page.locator("tr.dense-group-row")).toHaveCount(5);
      await expect(page.locator("tr.dense-group-row th").last()).toContainText("Sin CUIT");

      const medidasAgrupado = await medidasDeLayout(page);
      expect(medidasAgrupado.desbordePagina).toBeLessThanOrEqual(0);
      expect(medidasAgrupado.desbordeContenedor).toBeLessThanOrEqual(0);
      expect(medidasAgrupado.tablaDentro).toBe(true);
      await capturar(page, `clientes-agrupado-${viewport.width}x${viewport.height}.png`);
    });

    test("Clientes muestra el estado vacío con la acción para quitar el filtro", async ({ page }) => {
      await prepararSesion(page);
      await page.goto("/clientes?terminacion=5");
      await expect(page.getByText("Ningún cliente coincide")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Quitar filtros" }).click();
      await expect(filas(page)).toHaveCount(6);
    });

    test("Configuración fiscal muestra el CUIT y la terminación en el encabezado", async ({ page }) => {
      await prepararSesion(page);
      await page.goto("/configuracion-fiscal");
      const encabezado = page.locator("dl.fiscal-overview[aria-label='Cliente']");
      await expect(encabezado).toContainText("20-00000007-9", { timeout: 20_000 });
      await expect(encabezado).toContainText("Terminación de CUIT");

      const medidas = await medidasDeLayout(page);
      expect(medidas.desbordePagina).toBeLessThanOrEqual(0);
      await capturar(page, `configuracion-fiscal-${viewport.width}x${viewport.height}.png`);
    });
  });
}
