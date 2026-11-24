import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { goTo, login, pickOption, SUFFIX, syntheticCuit } from "./helpers/ui";

/*
 * Calendario fiscal desde PDF (brief 5A). Recorrido del contador en la app real, por la interfaz:
 * Ajustes del estudio → Calendarios fiscales → «Cargar desde PDF» → revisión junto al PDF → publicar.
 *
 * Datos sintéticos (inventados): el PDF es e2e/fixtures/calendario-arca-2027-sintetico.pdf y la lectura
 * de la IA la responde el stub de CI (e2e/ai-service-stub.mjs) con e2e/fixtures/calendario-arca-2027-lectura-ia.csv.
 *
 * Valores calculados a mano desde el PDF sintético:
 *   terminaciones 0-1 → 15/11/2027; 2-3 → 16/11/2027; 4-5 → 17/11/2027;
 *   6-7 → 18/11/2027 (la IA leyó 19/11/2027 con confianza baja: la celda queda dudosa y el contador la corrige);
 *   8-9 → 22/11/2027.
 */

const PDF = fileURLToPath(new URL("./fixtures/calendario-arca-2027-sintetico.pdf", import.meta.url));
const TITULO = `Calendario nacional 2027 E2E ${SUFFIX}`;

/**
 * El tour guiado se abre 650 ms después de montar el estudio mientras su marca no exista en el
 * almacenamiento local, y mueve el foco al popover: cierra el desplegable del organismo a mitad de
 * la elección. Este recorrido no prueba el tour, así que se deja la misma marca que escribe «Saltar
 * tour» (criterio de integrated-flow.spec.ts).
 */
async function markGuidedTourSeen(page: Page) {
  await page.addInitScript(() => {
    if (window.localStorage.getItem("contable-study-navigation-tour-v1") === null) {
      window.localStorage.setItem("contable-study-navigation-tour-v1", "dismissed");
    }
  });
}

test("el calendario se arma desde su PDF, el contador corrige la celda dudosa y lo publica", async ({ page }) => {
  test.setTimeout(180_000);

  await test.step("Entra a Calendarios fiscales desde Ajustes del estudio", async () => {
    await markGuidedTourSeen(page);
    await login(page);
    await goTo(page, "Calendarios fiscales");
    await expect(page.getByRole("button", { name: "Cargar desde PDF" }).first()).toBeVisible();
  });

  await test.step("Sin datos completos, la lectura queda deshabilitada y el motivo dice qué falta", async () => {
    await page.getByRole("button", { name: "Cargar desde PDF" }).first().click();
    await expect(page.getByText("Cargar calendario desde PDF", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Leer PDF y armar borrador" })).toBeDisabled();
    await expect(
      page.getByText("Completá organismo, jurisdicción, año, título, impuesto y PDF del calendario."),
    ).toBeVisible();
  });

  await test.step("Elige organismo, jurisdicción, impuesto, año y título, y sube el PDF", async () => {
    await pickOption(page.locator("#cal-pdf-organismo"), "ARCA");
    await pickOption(page.locator("#cal-pdf-jurisdiccion"), "Argentina (Nación)");
    await pickOption(page.locator("#cal-pdf-impuesto"), "IVA");
    await page.locator("#cal-pdf-anio").fill("2027");
    await page.locator("#cal-pdf-titulo").fill(TITULO);
    await page.locator("#cal-pdf-archivo").setInputFiles(PDF);
    await expect(page.getByRole("button", { name: "Leer PDF y armar borrador" })).toBeEnabled();
  });

  await test.step("La IA propone el borrador: 5 celdas, una dudosa, y la ficha abre con el PDF al lado", async () => {
    await page.getByRole("button", { name: "Leer PDF y armar borrador" }).click();
    await expect(page.getByText(/Se propusieron 5 celdas; 1 quedó dudosa para revisar/)).toBeVisible();
    await page.getByRole("tab", { name: /^Celdas/ }).click();
    const visor = page.locator('iframe[title^="PDF del calendario"]');
    await expect(visor).toBeVisible();
    await expect(visor).toHaveAttribute("src", /#page=1$/);
    for (const fecha of ["15/11/2027", "16/11/2027", "17/11/2027", "19/11/2027", "22/11/2027"]) {
      await expect(page.getByText(fecha, { exact: true })).toBeVisible();
    }
  });

  await test.step("Filtra las dudosas y corrige la terminación 6 y 7 con la fecha del PDF", async () => {
    await page.getByRole("button", { name: "Solo dudosas" }).click();
    await expect(page.getByText("1 de 5 celdas")).toBeVisible();
    await page.getByRole("button", { name: /^Editar IVA - Régimen general, vence 19\/11\/2027$/ }).click();
    await page.getByLabel("Fecha de vencimiento (AAAA-MM-DD)").fill("2027-11-18");
    await page.getByRole("button", { name: "Guardar celda" }).click();
    await page.getByRole("button", { name: "Solo dudosas" }).click();
    await expect(page.getByText("18/11/2027", { exact: true })).toBeVisible();
    await expect(page.getByText("19/11/2027", { exact: true })).toHaveCount(0);
  });

  await test.step("Publica el calendario desde el resumen y queda como versión publicada", async () => {
    await page.getByRole("tab", { name: /^Resumen/ }).click();
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await page.getByRole("button", { name: "Publicar calendario" }).click();
    await expect(page.getByText(/Publicada la versión \d+\./)).toBeVisible();
    await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible();
  });

  const cliente = `SINTÉTICO CALENDARIO ${SUFFIX} S.A.`;

  await test.step("Un cliente sintético inscripto en IVA, con CUIT terminado en 6, tiene su período de octubre 2027", async () => {
    const { base, cuit } = await crearClienteSintetico(page, cliente, "6");
    await crearVencimientoDesdeCalendario(page, base, cliente, cuit);
  });

  await test.step("El contador abre el Legajo del cliente y ve el vencimiento corregido, también en el Panel de trabajo", async () => {
    await page.reload();
    await pickOption(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" }), cliente);
    await goTo(page, "Legajo");
    await expect(page.getByRole("heading", { name: "Legajo", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Período fiscal" })).toHaveValue(
      new RegExp(`Octubre de 2027 · IVA.*Oct 2027 E2E ${SUFFIX}`),
    );
    await expect(page.getByText("Vence el 18/11/2027", { exact: true })).toBeVisible();
    await goTo(page, "Trabajo");
    const obligacion = page.getByRole("row").filter({ hasText: `Oct 2027 E2E ${SUFFIX}` });
    await expect(obligacion).toContainText("IVA");
    await expect(obligacion).toContainText("18/11/2027");
    await expect(page.getByText("19/11/2027", { exact: true })).toHaveCount(0);
    await goTo(page, "Panel de trabajo");
    await expect(page.getByText(cliente).first()).toBeVisible();
    await expect(page.getByText("18/11/2027", { exact: true }).first()).toBeVisible();
  });
});

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

/** Sesión del navegador: el mismo token CSRF que el front envía en cada mutación. */
async function encabezados(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token");
  return { "X-CSRF-Token": csrf ? decodeURIComponent(csrf.value) : "" };
}

async function codigoId(page: Page, ruta: string, codigo: string): Promise<string> {
  const response = await page.request.get(`${API}${ruta}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data?: Array<{ id: string; code: string }> };
  const found = (body.data ?? []).find((item) => item.code === codigo);
  expect(found, `${ruta} ${codigo}`).toBeTruthy();
  return found!.id;
}

/** CUIT sintético (dígito verificador válido) cuya última cifra es `digito`. */
function cuitTerminadoEn(digito: string): string {
  for (let seed = 40_000_000 + (parseInt(SUFFIX, 36) % 50_000_000); ; seed += 1) {
    const cuit = syntheticCuit(seed);
    if (cuit.endsWith(digito)) return cuit;
  }
}

/** Datos sintéticos por API (como el spec del Legajo): el cliente nuevo queda en el estudio demo. */
async function crearClienteSintetico(
  page: Page,
  legalName: string,
  terminacion: string,
): Promise<{ base: string; cuit: string }> {
  const me = await page.request.get(`${API}/api/v1/me/contexts`);
  expect(me.status()).toBe(200);
  const firmId = ((await me.json()) as { data: { firms: Array<{ firmId: string }> } }).data.firms[0]!.firmId;
  const cuit = cuitTerminadoEn(terminacion);
  const created = await page.request.post(`${API}/api/v1/firms/${firmId}/clients`, {
    headers: await encabezados(page),
    data: { legalName, cuit },
  });
  expect(created.status(), `alta del cliente ${await created.text().catch(() => "")}`).toBe(201);
  const clientId = ((await created.json()) as { data: { id: string } }).data.id;
  return { base: `${API}/api/v1/firms/${firmId}/clients/${clientId}`, cuit };
}

/** Período de octubre 2027, perfil, inscripción en IVA régimen general y obligación desde el calendario publicado. */
async function crearVencimientoDesdeCalendario(page: Page, base: string, legalName: string, cuit: string): Promise<void> {
  const headers = await encabezados(page);
  const impuesto = await codigoId(page, "/api/v1/tax/types", "IVA");
  const regimen = await codigoId(page, "/api/v1/tax/regimes", "RI");
  const period = await page.request.post(`${base}/tax-periods`, {
    headers,
    data: { taxTypeId: impuesto, startDate: "2027-10-01", endDate: "2027-10-31", label: `Oct 2027 E2E ${SUFFIX}` },
  });
  expect(period.status()).toBe(201);
  const periodId = ((await period.json()) as { data: { id: string } }).data.id;
  const perfil = await page.request.post(`${base}/tax-profile-versions`, {
    headers,
    data: {
      legalName,
      cuit,
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    },
  });
  expect(perfil.status()).toBe(201);
  const perfilId = ((await perfil.json()) as { data: { id: string } }).data.id;
  const inscripcion = await page.request.post(`${base}/tax-registrations`, {
    headers,
    data: { profileVersionId: perfilId, regimeId: regimen, validFrom: "2020-01-01" },
  });
  expect(inscripcion.status()).toBe(201);
  const obligacion = await page.request.post(`${base}/tax-obligations/from-calendar`, {
    headers,
    data: { profileVersionId: perfilId, regimeId: regimen, periodId },
  });
  expect(obligacion.status(), `vencimiento desde calendario ${await obligacion.text().catch(() => "")}`).toBe(201);
}
