import { expect, test, type Page, type TestInfo } from "@playwright/test";
declare const process: { env: { CI?: string } };
import { RUN, SUFFIX, login, mutating, syntheticCuit } from "./helpers/ui";
import {
  IIBB,
  activarAutorrevision,
  altaClienteRI,
  abrirLegajo as crearLegajo,
  calcularIIBB,
  cargarLibroVentas,
  crearPeriodoIIBB,
  inscribirIIBB,
  irAlLegajo,
  revisarLotesDe,
  rotuloDelPeriodo,
  vincularActividad,
} from "./helpers/liquidacion-ui";
import type { FacturaSintetica } from "./helpers/fuentes-sinteticas";

const CLIENTE = {
  legalName: `Cliente E2E Comentarios ${SUFFIX} S.R.L.`,
  tradeName: `E2E Comentarios ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 25_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const PERIODO = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026", label: `Octubre 2026 comentarios ${SUFFIX}` };
const COMPROBANTES: FacturaSintetica[] = [
  { fecha: "2026-10-05", tipo: "11", numero: "1", docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 30_001), denominacion: `Venta sintética 1 ${SUFFIX}`, neto: "50000.00", iva: "0.00" },
  { fecha: "2026-10-12", tipo: "11", numero: "2", docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 30_002), denominacion: `Venta sintética 2 ${SUFFIX}`, neto: "40000.00", iva: "0.00" },
  { fecha: "2026-10-20", tipo: "13", numero: "3", docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 30_003), denominacion: `Nota de crédito sintética ${SUFFIX}`, neto: "10000.00", iva: "0.00" },
];

const CAPTURES = "/home/hermes/.hermes/workspace/contable/rediseno-pantallas/comentarios-tarjetas";

async function capturar(page: Page, testInfo: TestInfo, fileName: string) {
  const destination = process.env.CI ? testInfo.outputPath(fileName) : `${CAPTURES}/${fileName}`;
  await page.screenshot({ path: destination });
}

async function prepararLegajoConControles(page: Page) {
  await altaClienteRI(page, CLIENTE);
  await inscribirIIBB(page);
  await vincularActividad(page, IIBB.activity);
  await crearPeriodoIIBB(page, PERIODO);
  const rotulo = rotuloDelPeriodo(PERIODO.mes, PERIODO.label);
  await crearLegajo(page, rotulo);
  const { libro } = await cargarLibroVentas(page, COMPROBANTES, `comentarios-${SUFFIX}.xlsx`);
  await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
  await expect(page.getByRole("dialog", { name: "Importar libros IVA" })).toBeHidden({ timeout: 60_000 });
  await activarAutorrevision(page);
  await irAlLegajo(page, rotulo);
  await revisarLotesDe(page, "Gestionar Ventas del período");
  await calcularIIBB(page);
}

async function abrirEtapa(page: Page, etapa: string) {
  const tab = page.getByRole("tab", { name: new RegExp(`^${etapa}`) });
  await tab.focus();
  await page.keyboard.press("Enter");
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const acciones = page.locator(".workpaper-stage-toolbar");
  if (await acciones.count()) {
    const pestañas = await page.locator(".work-bar__row--secciones").boundingBox();
    const herramientas = await acciones.boundingBox();
    expect(pestañas).not.toBeNull();
    expect(herramientas).not.toBeNull();
    expect(herramientas!.y).toBeGreaterThanOrEqual(pestañas!.y + pestañas!.height);
    expect(await page.locator(".work-bar__row--secciones").getByRole("button", { name: "Actualizar" }).count()).toBe(0);
  }
}

async function verificarBarraADerecha(page: Page) {
  const thread = page.getByRole("region", { name: "Comentarios" });
  await expect(thread).toBeVisible();
  const contenido = page.locator(".workpaper-main");
  const area = await contenido.boundingBox();
  const barra = await page.locator(".comments-sidebar").boundingBox();
  const trabajo = await page.locator(".work-page__body").boundingBox();
  const lista = await thread.locator(".comment-thread__list").boundingBox();
  const formulario = await thread.locator("form").boundingBox();
  expect(barra).not.toBeNull();
  expect(area).not.toBeNull();
  expect(trabajo).not.toBeNull();
  expect(lista).not.toBeNull();
  expect(formulario).not.toBeNull();
  expect(barra!.x).toBeGreaterThan(area!.x);
  expect(barra!.y + barra!.height).toBeCloseTo(trabajo!.y + trabajo!.height, 0);
  expect(formulario!.y).toBeGreaterThan(lista!.y);
  expect(barra!.y + barra!.height - (formulario!.y + formulario!.height)).toBeLessThanOrEqual(14);
  expect(await contenido.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  return thread;
}

test("Comentarios del mes quedan fijos a la derecha en todas las etapas y conservan el plegado", async ({ page, browser }, testInfo) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);
  let commentsUrl: string | null = null;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/comments") && !request.url().includes("/comments/members")) commentsUrl = request.url();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("contable-study-navigation-tour-v1", "dismissed"));
  await login(page);
  await prepararLegajoConControles(page);

  for (const etapa of ["Saldos", "Clasificación", "Controles"]) {
    await abrirEtapa(page, etapa);
    const thread = await verificarBarraADerecha(page);
    await capturar(page, testInfo, `${etapa.toLowerCase().replaceAll("ó", "o")}-1440x900.png`);
    if (etapa === "Clasificación") {
      const comments = ["Antiguo", "Intermedio", "Reciente"].map((label) => `Comentario ${label} E2E ${SUFFIX}`);
      for (const comment of comments) {
        await thread.getByLabel("Escribí un comentario").fill(comment);
        await mutating(page, "/comments", () => thread.getByRole("button", { name: "Comentar", exact: true }).click());
        await expect(thread.getByRole("listitem").filter({ hasText: comment })).toBeVisible();
      }
      const reviewerPage = await browser.newPage();
      await login(reviewerPage, "revisor@contable.local", "revisor1234");
      expect(commentsUrl).toBeTruthy();
      const reviewerComment = `Comentario Revisor E2E ${SUFFIX}`;
      const created = await reviewerPage.evaluate(async ({ url, comment, periodLabel }) => {
        const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("csrf_token="));
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": cookie ? decodeURIComponent(cookie.slice("csrf_token=".length)) : "" },
          body: JSON.stringify({ body: comment, isPersonal: false, periodLabel }),
        });
        return { status: response.status, body: await response.text() };
      }, { url: commentsUrl!, comment: reviewerComment, periodLabel: PERIODO.label });
      expect(created.status, created.body).toBe(201);
      await reviewerPage.close();
      await page.reload();
      await expect(page.getByRole("region", { name: "Comentarios" })).toBeVisible();
      const items = thread.getByRole("listitem");
      await expect(items).toHaveCount(4);
      await expect(items.nth(0)).toContainText(reviewerComment);
      await expect(items.nth(1)).toContainText(comments[2]);
      await expect(items.nth(2)).toContainText(comments[1]);
      await expect(items.nth(3)).toContainText(comments[0]);
      await capturar(page, testInfo, "1440.png");
    }
    if (etapa === "Controles") {
      await expect(thread.getByText(`Comentario Revisor E2E ${SUFFIX}`, { exact: true })).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  for (const etapa of ["Saldos", "Clasificación", "Controles"]) {
    await abrirEtapa(page, etapa);
    await verificarBarraADerecha(page);
    if (etapa === "Clasificación") await capturar(page, testInfo, "1280.png");
  }
  await abrirEtapa(page, "Clasificación");
  const posted = `Comentario publicado E2E ${SUFFIX}`;
  const thread = page.getByRole("region", { name: "Comentarios" });
  await thread.getByLabel("Escribí un comentario").fill(posted);
  await mutating(page, "/comments", () => thread.getByRole("button", { name: "Comentar", exact: true }).click());
  await expect(thread.getByRole("listitem").first()).toContainText(posted);
  await expect(thread.getByRole("listitem").first()).toBeInViewport();
  await capturar(page, testInfo, "publicado.png");
  const plegar = page.getByRole("button", { name: /Plegar comentarios/ });
  await plegar.click();
  const franja = page.getByRole("button", { name: /Comentarios · \d+/ });
  await expect(franja).toBeVisible();
  await capturar(page, testInfo, "comentarios-plegados.png");
  await page.reload();
  await expect(page.getByRole("button", { name: /Comentarios · \d+/ })).toBeVisible();
  await page.getByRole("button", { name: /Comentarios · \d+/ }).click();
  await expect(page.getByRole("region", { name: "Comentarios" })).toBeVisible();

  await abrirEtapa(page, "Controles");
  const control = page.locator(".workpaper-controls [data-row-key] button").first();
  await expect(control).toBeVisible();
  const sidebar = page.locator(".comments-sidebar");
  const sidebarBefore = await sidebar.boundingBox();
  await control.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("region", { name: "Comentarios" })).toBeVisible();
  await capturar(page, testInfo, "panel-control-sobre-comentarios.png");
  const sidebarAfter = await sidebar.boundingBox();
  expect(sidebarAfter?.x).toBe(sidebarBefore?.x);
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Comentarios" })).toBeVisible();
});
