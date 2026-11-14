import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { RUN, SUFFIX, goTo, login, mutating, pickOption, seen, syntheticCuit } from "./helpers/ui";

/**
 * E2E de punta a punta desde la interfaz, con el comprobante real de una mesa de
 * restaurante (e2e/fixtures/ticket-mesa-8.jpg, 16/03/2025, total $29.900 con IVA 21 %).
 *
 *   1. Impuestos: organismos, regímenes y actividades para IVA, IIBB Tucumán y TEM
 *   2. Valores de los motores: cada paquete de reglas con alícuota, vencimiento y fuente, activado
 *   3. Cliente con su configuración fiscal completa (perfil, 3 inscripciones, actividades, 3 períodos, 3 obligaciones)
 *   4. Comprobante: pedido documental → subida → antivirus y lectura → carga a mano → aprobación
 *   5. Legajo y liquidación: lo que el servidor deja calcular con esa configuración
 *
 * Lo que la interfaz no permite hacer queda dicho en docs/ux/relevamiento-alta-y-comprobante.md.
 * Los datos son sintéticos y llevan un sufijo único por corrida.
 *
 * Requiere el stack completo: API, web, base, Valkey, MinIO, ClamAV, servicio de IA y worker.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = join(fixtures, "ticket-mesa-8.jpg");
const sourceFiles = [
  { source: "Libro IVA Ventas", file: join(fixtures, "libro-iva-ventas-2025-03.json") },
  { source: "Libro IVA Compras", file: join(fixtures, "libro-iva-compras-2025-03.json") },
  { source: "Ingresos Brutos Tucumán", file: join(fixtures, "iibb-tucuman-2025-03.json") },
  { source: "TEM San Miguel de Tucumán", file: join(fixtures, "tem-san-miguel-2025-03.json") },
];

/**
 * Catálogo tal como debe quedar en producción. Los códigos de régimen (RI, IIBB_LOCAL_TUC, TEM_SMT)
 * son los que el legajo reconoce para saber qué libros y archivos pedir.
 */
const taxes = {
  iva: {
    taxType: { code: "IVA", name: "IVA — Impuesto al Valor Agregado", family: "IVA Responsable Inscripto" },
    taxTypeOption: "(IVA)",
    jurisdiction: "(AR)",
    module: "IVA Responsable Inscripto",
    family: null as string | null,
    engine: "IVA RI por alícuota",
    authority: { code: "ARCA", name: "ARCA — Agencia de Recaudación y Control Aduanero" },
    regime: { code: "RI", name: "Responsable Inscripto" },
    pack: { code: "AR_VAT_RI_V1", name: "IVA Responsable Inscripto V1" },
    activity: { code: "E2E-REST-AR", name: "Servicios de restaurante", jurisdiction: "(AR)" },
    allActivities: false,
    minimum: null as string | null,
    rate: "21",
    dueDay: "18",
    source: "Ley de IVA — alícuota general del 21 %",
  },
  iibb: {
    taxType: { code: "IIBB", name: "Ingresos Brutos", family: "IIBB local — Tucumán" },
    taxTypeOption: "(IIBB)",
    jurisdiction: "(AR-T)",
    module: "IIBB local Tucumán",
    family: "IIBB local — Tucumán",
    engine: "IIBB local Tucumán",
    authority: { code: "DGR-TUC", name: "DGR Tucumán" },
    regime: { code: "IIBB_LOCAL_TUC", name: "IIBB Contribuyente Local Tucumán" },
    pack: { code: "AR_IIBB_TUC_LOCAL_V1", name: "IIBB Contribuyente Local Tucumán V1" },
    activity: { code: "E2E-REST-TUC", name: "Servicios de restaurante (Tucumán)", jurisdiction: "(AR-T)" },
    allActivities: true,
    minimum: "1500" as string | null,
    rate: "3.5",
    dueDay: "20",
    source: "Ley Impositiva de Tucumán — alícuota general",
  },
  tem: {
    taxType: { code: "TEM", name: "Tasa de Actividades Económicas (TEM)", family: "Tasa de Espacios Municipales" },
    taxTypeOption: "(TEM)",
    jurisdiction: "(AR-SMT)",
    module: "TEM San Miguel de Tucumán",
    family: null as string | null,
    engine: "TEM San Miguel de Tucumán",
    authority: { code: "SMT-TEM", name: "Municipalidad de San Miguel de Tucumán — TEM" },
    regime: { code: "TEM_SMT", name: "TEM San Miguel de Tucumán" },
    pack: { code: "AR_TEM_SMT_V1", name: "TEM San Miguel de Tucumán V1" },
    activity: { code: "E2E-REST-SMT", name: "Restaurante (municipal)", jurisdiction: "(AR-SMT)" },
    allActivities: false,
    minimum: "500" as string | null,
    rate: "0.6",
    dueDay: "15",
    source: "Ordenanza tarifaria de San Miguel de Tucumán",
  },
};
type Tax = (typeof taxes)[keyof typeof taxes];

const data = {
  client: {
    legalName: `Restaurante E2E ${SUFFIX} S.R.L.`,
    tradeName: `Resto E2E ${SUFFIX}`,
    cuit: syntheticCuit(Number.parseInt(RUN, 36)),
    fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
  },
  validFrom: "2025-01-01",
  periodStart: "2025-03-01",
  periodEnd: "2025-03-31",
  request: { title: `Comprobantes de marzo 2025 (${SUFFIX})`, item: "Ticket de mesa del 16/03/2025" },
  // Lo que dice el ticket fotografiado.
  ticket: { isoDate: "2025-03-16", total: "29900", net: "24710.74", vat: "5189.26" },
};

/** Etiqueta del período de marzo 2025 de cada impuesto (única por corrida). */
function periodLabel(tax: Tax) {
  return `Marzo 2025 ${tax.taxType.code} ${SUFFIX}`;
}

/** Lecturas del catálogo (no crean nada): permiten repetir la prueba sin chocar con lo que ya existe. */
async function exists(page: Page, resource: "jurisdictions" | "types" | "authorities" | "regimes" | "activities" | "rule-packs", code: string) {
  const response = await page.request.get(`/api/v1/tax/${resource}`);
  const body = (await response.json()) as { data: Array<{ code: string }> };
  return body.data.some((item) => item.code === code);
}

async function createJurisdiction(page: Page, jurisdiction: { code: string; name: string; kind: "MUNICIPAL"; parent: string }) {
  if (await exists(page, "jurisdictions", jurisdiction.code)) return;
  await page.getByRole("tab", { name: /^Jurisdicciones/ }).click();
  await page.getByRole("button", { name: "Nueva jurisdicción" }).click();
  await page.locator("#jurisdiction-code").fill(jurisdiction.code);
  await page.locator("#jurisdiction-name").fill(jurisdiction.name);
  await page.locator("#jurisdiction-kind").selectOption(jurisdiction.kind);
  await pickOption(page.locator("#jurisdiction-parent"), jurisdiction.parent);
  await mutating(page, "/tax/jurisdictions", () => page.getByRole("button", { name: "Crear jurisdicción", exact: true }).click());
}

async function createTaxType(page: Page, tax: Tax) {
  if (await exists(page, "types", tax.taxType.code)) return;
  await page.getByRole("tab", { name: /^Tipos de impuesto/ }).click();
  await page.getByRole("button", { name: "Nuevo tipo de impuesto" }).click();
  await page.locator("#tax-type-code").fill(tax.taxType.code);
  await page.locator("#tax-type-name").fill(tax.taxType.name);
  await pickOption(page.locator("#tax-type-default-family"), tax.taxType.family);
  await mutating(page, "/tax/types", () => page.getByRole("button", { name: "Crear tipo de impuesto" }).click());
}

/** Botón "Agregar" del bloque de Configuración vigente que lleva ese título. */
function addButton(page: Page, heading: string) {
  return page
    .locator(".fiscal-client-overview__heading")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .getByRole("button", { name: "Agregar" });
}

async function createAuthority(page: Page, tax: Tax) {
  if (await exists(page, "authorities", tax.authority.code)) return;
  await page.getByRole("tab", { name: /^Organismos recaudadores/ }).click();
  await page.getByRole("button", { name: "Nuevo organismo" }).click();
  await page.locator("#authority-code").fill(tax.authority.code);
  await page.locator("#authority-name").fill(tax.authority.name);
  await pickOption(page.locator("#authority-jurisdiction"), tax.jurisdiction);
  await mutating(page, "/tax/authorities", () => page.getByRole("button", { name: "Crear organismo" }).click());
}

async function createRegime(page: Page, tax: Tax) {
  if (await exists(page, "regimes", tax.regime.code)) return;
  await page.getByRole("tab", { name: /^Regímenes/ }).click();
  await page.getByRole("button", { name: "Nuevo régimen" }).click();
  await page.locator("#regime-code").fill(tax.regime.code);
  await page.locator("#regime-name").fill(tax.regime.name);
  await pickOption(page.locator("#regime-tax-type"), tax.taxTypeOption);
  if (tax.family) await pickOption(page.locator("#regime-calc-family"), tax.family);
  await expect(page.locator("#regime-calc-family")).not.toHaveValue("");
  await pickOption(page.locator("#regime-module"), tax.module);
  await pickOption(page.locator("#regime-jurisdiction"), tax.jurisdiction);
  await pickOption(page.locator("#regime-authority"), tax.authority.code);
  await mutating(page, "/tax/regimes", () => page.getByRole("button", { name: "Crear régimen" }).click());
}

async function createActivity(page: Page, activity: Tax["activity"]) {
  if (await exists(page, "activities", activity.code)) return;
  await page.getByRole("tab", { name: /^Actividades/ }).click();
  await page.getByRole("button", { name: "Nueva actividad" }).click();
  await page.locator("#activity-code").fill(activity.code);
  await page.locator("#activity-name").fill(activity.name);
  await pickOption(page.locator("#activity-jurisdiction"), activity.jurisdiction);
  await page.locator("#activity-valid-from").fill(data.validFrom);
  await mutating(page, "/tax/activities", () => page.getByRole("button", { name: "Crear actividad" }).click());
}

/** Paquete de reglas completo: alícuota, vencimiento y fuente normativa, y activación. */
async function createRulePack(page: Page, tax: Tax) {
  if (await exists(page, "rule-packs", tax.pack.code)) return;
  await page.getByRole("button", { name: /^Nuevo paquete|^Cerrar alta/ }).first().click();
  await page.locator("#new-rule-pack-code").fill(tax.pack.code);
  await page.locator("#new-rule-pack-name").fill(tax.pack.name);
  await pickOption(page.locator("#new-rule-pack-regime"), tax.regime.name);
  await mutating(page, "/tax/rule-packs", () => page.getByRole("button", { name: "Crear paquete" }).click());

  await page.getByRole("button", { name: /Crear primera versión/ }).first().click();
  await page.locator("#first-rule-version-valid-from").fill(data.validFrom);
  await pickOption(page.locator("#first-rule-version-engine"), tax.engine);
  await mutating(page, "/versions", () =>
    page.locator(".action-drawer").getByRole("button", { name: "Crear primera versión", exact: true }).click(),
  );

  // La pestaña activa se conserva al pasar de un paquete a otro (queda la última usada).
  await page.getByRole("tab", { name: /^Alícuotas/ }).click();
  await page.getByRole("button", { name: /Agregar regla/ }).click();
  await pickOption(page.locator('select[aria-label^="Tipo de regla"]').first(), "Alícuota");
  const activity = page.locator('select[aria-label^="Actividad"]').first();
  await pickOption(activity, tax.allActivities ? "Todas las actividades" : tax.activity.code);
  await page.locator('input[aria-label^="Alícuota"]').first().fill(tax.rate);
  if (tax.minimum) await page.locator('input[aria-label^="Mínimo"]').first().fill(tax.minimum);
  await mutating(page, "/rate-rules", () => page.getByRole("button", { name: "Guardar borrador" }).click());

  await page.getByRole("tab", { name: /^Vencimientos/ }).click();
  await page.getByRole("button", { name: "Agregar vencimiento" }).click();
  await page.locator("#rule-due-day").fill(tax.dueDay);
  await page.locator("#rule-due-valid-from").fill(data.validFrom);
  await mutating(page, "/due-date-rules", () => page.getByRole("button", { name: "Guardar vencimiento" }).click());

  await page.getByRole("tab", { name: /^Fuentes/ }).click();
  await page.getByRole("button", { name: "Agregar fuente" }).click();
  await page.locator("#rule-source-title").fill(tax.source);
  await mutating(page, "/sources", () => page.getByRole("button", { name: /^Guardar fuente|^Agregar fuente$/ }).last().click());

  await page.getByRole("button", { name: "Activar", exact: true }).click();
  await mutating(page, "/activate", () => page.getByRole("button", { name: "Activar versión" }).click());
}

test("alta de impuestos, motores y cliente, y carga y revisión de un comprobante real", async ({ page, browser }) => {
  // Necesita el stack completo y un administrador de plataforma: sólo corre contra un entorno externo.
  test.skip(process.env.E2E_EXTERNAL !== "1", "Requiere el stack completo (E2E_EXTERNAL=1)");
  test.setTimeout(480_000);
  page.setDefaultTimeout(15_000);

  const failedMutations: string[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    if (!response.url().includes("/api/v1/")) return;
    if (response.status() >= 400) failedMutations.push(`${request.method()} ${response.url()} → ${response.status()}`);
  });

  // Primera lectura automática del comprobante, tal como la entrega el servidor (antes de cargar nada a mano).
  let automaticReading: unknown = null;
  page.on("response", async (response) => {
    if (automaticReading || response.request().method() !== "GET" || !/\/documents\/[^/]+\/extraction$/.test(response.url())) return;
    const body = (await response.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
    if (body?.data && body.data.status !== "GENERATING") {
      const { fields, voucherData, ...rest } = body.data;
      automaticReading = { ...rest, fields: Array.isArray(fields) ? fields.length : fields, voucherData: voucherData ?? null };
    }
  });

  let portalLogin: { email: string; password: string } | null = null;

  await test.step("Ingresar como Titular", () => login(page));

  // ───────────── 0. Módulos del estudio ─────────────
  // Requiere un usuario administrador de plataforma. Un estudio nuevo no tiene ningún módulo encendido.
  await test.step("Módulos de estudios: habilitar documentos, módulo fiscal y los tres regímenes", async () => {
    await goTo(page, "Módulos de estudios");
    await expect(page.getByRole("heading", { name: "Módulos de estudios", exact: true })).toBeVisible();
    for (const code of ["DOCUMENTS", "TAX", "TAX_RI", "TAX_IIBB_LOCAL_TUC", "TAX_TEM_SMT"]) {
      const row = page.locator("tr", { hasText: new RegExp(`${code}(?![_A-Z]{2})`) });
      await expect(row).toHaveCount(1);
      // Cada módulo se prende con su interruptor.
      const toggle = row.getByRole("switch");
      if ((await toggle.getAttribute("aria-checked")) !== "true") {
        await mutating(page, `/feature-flags/${code}`, () => toggle.click());
      }
      await expect(toggle).toHaveAttribute("aria-checked", "true");
    }
  });

  // ───────────── 1. Impuestos ─────────────
  await test.step("Catálogos: organismos, regímenes y actividades de IVA, IIBB y TEM", async () => {
    await goTo(page, "Catálogos fiscales");
    await expect(page.getByRole("heading", { name: "Catálogos fiscales", exact: true })).toBeVisible();
    await createJurisdiction(page, { code: "AR-SMT", name: "San Miguel de Tucumán", kind: "MUNICIPAL", parent: "(AR-T)" });
    for (const tax of Object.values(taxes)) await createTaxType(page, tax);
    for (const tax of Object.values(taxes)) await createAuthority(page, tax);
    for (const tax of Object.values(taxes)) await createRegime(page, tax);
    for (const tax of Object.values(taxes)) await createActivity(page, tax.activity);
    await page.getByRole("tab", { name: /^Regímenes/ }).click();
    for (const tax of Object.values(taxes)) await expect(seen(page, tax.regime.code)).toBeVisible();
  });

  // ───────────── 2. Valores de los motores ─────────────
  await test.step("Reglas: alícuotas, vencimientos y fuentes de los tres impuestos, activadas", async () => {
    await goTo(page, "Reglas fiscales");
    await expect(page.getByRole("heading", { name: "Reglas fiscales", exact: true })).toBeVisible();
    for (const tax of Object.values(taxes)) await createRulePack(page, tax);
    await expect(seen(page, "Vigente")).toBeVisible();
  });

  // ───────────── 3. Cliente y configuración fiscal ─────────────
  await test.step("Clientes: alta del cliente", async () => {
    await goTo(page, "Clientes");
    await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
    await page.locator("#client-legal-name").fill(data.client.legalName);
    await page.locator("#client-trade-name").fill(data.client.tradeName);
    await page.locator("#client-cuit").fill(data.client.cuit);
    await page.locator("#client-vat-condition").selectOption({ index: 1 });
    await pickOption(page.locator("#client-province"), "Tucumán");
    await page.locator("#client-legal-form").selectOption({ index: 1 });
    await page.locator(".action-drawer").getByRole("button", { name: "Crear cliente" }).click();
    await expect(page).toHaveURL(/\/configuracion-fiscal/);
    await expect(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" }).locator("option:checked")).toContainText(data.client.legalName);
  });

  await test.step("Configuración fiscal: perfil activo", async () => {
    await page.getByRole("button", { name: "Crear perfil fiscal" }).first().click();
    await page.locator("#pf-legal-name").fill(data.client.legalName);
    await page.locator("#pf-cuit").fill(data.client.cuit);
    await page.locator("#pf-fiscal-address").fill(data.client.fiscalAddress);
    await page.locator("#pf-person-type").selectOption("JURIDICA");
    await page.locator("#pf-condition").selectOption("RESPONSABLE_INSCRIPTO");
    await page.locator("#pf-valid-from").fill(data.validFrom);
    await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByRole("button", { name: "Activar perfil" }).click();
    await expect(page.getByRole("button", { name: "Crear nueva versión" })).toBeVisible();
  });

  await test.step("Configuración fiscal: inscripción en los tres regímenes", async () => {
    for (const tax of Object.values(taxes)) {
      await addButton(page, "Regímenes adheridos").click();
      await pickOption(page.locator("#reg-regime"), tax.regime.code);
      await mutating(page, "/tax-registrations", () =>
        page.getByRole("button", { name: "Registrar inscripción", exact: true }).last().click(),
      );
    }
  });

  await test.step("Configuración fiscal: actividades del cliente", async () => {
    for (const tax of Object.values(taxes)) {
      await addButton(page, "Actividades").click();
      await pickOption(page.locator("#act-activity"), tax.activity.code);
      await mutating(page, "/activities", () =>
        page.getByRole("button", { name: "Vincular actividad", exact: true }).last().click(),
      );
    }
  });

  await test.step("Configuración fiscal: período de marzo 2025 y obligación por impuesto", async () => {
    for (const tax of Object.values(taxes)) {
      const label = periodLabel(tax);
      await addButton(page, "Períodos fiscales").click();
      await pickOption(page.locator("#per-tax-type"), tax.taxTypeOption);
      await page.locator("#per-start").fill(data.periodStart);
      await page.locator("#per-end").fill(data.periodEnd);
      await page.locator("#per-label").fill(label);
      await mutating(page, "/tax-periods", () => page.getByRole("button", { name: "Crear período" }).click());

      await page.getByRole("button", { name: /Completar obligaciones|Crear obligación/ }).first().click();
      await pickOption(page.locator("#obl-period"), label);
      await pickOption(page.locator("#obl-regime"), tax.regime.name);
      await page.locator("#obl-due-date").fill(`2025-04-${tax.dueDay}`);
      await mutating(page, "/tax-obligations", () =>
        page.getByRole("button", { name: "Crear obligación", exact: true }).last().click(),
      );
    }
    await expect(page.getByRole("navigation", { name: "Pasos del onboarding fiscal" }).getByText("Pendiente")).toHaveCount(0);
  });

  // ───────────── 4. Comprobante ─────────────
  await test.step("Trabajo: pedido documental para recibir el comprobante", async () => {
    await goTo(page, "Trabajo");
    await expect(page.getByRole("heading", { name: "Trabajo", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Nuevo pedido|Crear pedido/ }).first().click();
    await page.locator("#request-title").fill(data.request.title);
    await page.locator("#request-item").fill(data.request.item);
    await mutating(page, "/document-requests", () =>
      page.locator(".action-drawer").getByRole("button", { name: "Crear pedido", exact: true }).click(),
    );
  });

  await test.step("Bandeja: subir la foto del ticket", async () => {
    await goTo(page, "Bandeja documental");
    await page.getByRole("button", { name: "Subir documento" }).first().click();
    await pickOption(page.locator("#upload-request-item"), data.request.item);
    await page.locator('input[type="file"]').setInputFiles(fixture);
    // La confirmación "Documento recibido" desaparece enseguida (el panel pasa a "Primero creá un
    // pedido"), así que se verifica contra la respuesta del servidor que cierra la carga.
    await mutating(page, "/complete", () => page.getByRole("button", { name: "Subir y procesar" }).click());
  });

  await test.step("Bandeja: el worker valida, pasa antivirus y lee el documento", async () => {
    await page.locator(".action-drawer").getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByRole("button", { name: /ticket-mesa-8/ }).first().click();
    await expect(page.getByText("Procesando comprobante")).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Revisá contra el comprobante" })).toBeVisible();
    // Lo que el sistema leyó solo, tal cual lo muestra la pantalla (queda en el reporte de la corrida).
    const detected = await page.locator("table").last().innerText();
    test.info().annotations.push({ type: "lectura automática", description: detected.replace(/\s+/g, " ").slice(0, 600) });
    test.info().annotations.push({ type: "primera lectura (API)", description: JSON.stringify(automaticReading) });
  });

  await test.step("Bandeja: cargar a mano lo que dice el ticket y aprobar la extracción", async () => {
    await page.getByRole("button", { name: /Cargar datos a mano/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Cargar datos a mano" });
    // Qué datos admite la carga manual (para comparar con lo que dice el ticket: neto, IVA 21 %, total).
    const offered = await dialog.getByLabel("Campo de la fila 1").locator("option").allTextContents();
    test.info().annotations.push({ type: "campos de la carga manual", description: offered.filter(Boolean).join(" | ") });
    const rows: Array<[string, string]> = [
      ["Fecha", data.ticket.isoDate],
      ["Neto gravado", data.ticket.net],
      ["Total", data.ticket.total],
      ["Moneda", "ARS"],
    ];
    for (const [index, [field, value]] of rows.entries()) {
      if (index > 0) await dialog.getByRole("button", { name: /Agregar fila/ }).click();
      await pickOption(dialog.getByLabel(`Campo de la fila ${index + 1}`), field);
      const control = dialog.getByLabel(`Valor de la fila ${index + 1}`);
      if ((await control.evaluate((element) => element.tagName)) === "SELECT") await control.selectOption(value);
      else await control.fill(value);
    }
    await mutating(page, "/extraction", () => dialog.getByRole("button", { name: "Guardar", exact: true }).click());
    await expect(page.getByText(/Datos guardados: \d+ campos?/)).toBeVisible();

    await page.getByRole("button", { name: "Aprobar extracción", exact: true }).click();
    await mutating(page, "/approve", () => page.getByRole("button", { name: "Aprobar extracción", exact: true }).last().click());
    await expect(seen(page, "Extracción revisada")).toBeVisible();
  });

  // ───────────── 5. Legajo y liquidación ─────────────
  await test.step("Legajo: crear el legajo de marzo 2025 y recorrer sus etapas", async () => {
    await goTo(page, "Legajo");
    await expect(page.getByRole("heading", { name: "Legajo", exact: true })).toBeVisible();
    await pickOption(page.locator("#monthly-workpaper-tax-period"), periodLabel(taxes.iva));
    await mutating(page, "/monthly-tax-workpapers", () => page.getByRole("button", { name: "Crear legajo" }).click());
    // Libros y archivos de marzo. Del ticket salen fecha, neto, IVA 21 % y número de la única compra; el CUIT
    // del proveedor y la letra A son inventados (el ticket no los trae). Ventas, IIBB y TEM son sintéticos.
    await page.getByRole("tab", { name: /Fuentes/ }).first().click();
    const sourcePanel = page.locator(".workpaper-source-import");
    for (const { source, file } of sourceFiles) {
      await pickOption(sourcePanel.locator("select"), source);
      await sourcePanel.locator('input[type="file"]').setInputFiles(file);
      await mutating(page, "/import-batches", () => sourcePanel.getByRole("button", { name: "Importar lote" }).click());
      await expect(page.getByText("Procesando…")).toHaveCount(0, { timeout: 60_000 });
    }
    test.info().annotations.push({
      type: "legajo · Fuentes tras importar",
      description: (await page.locator(".workpaper-card").first().innerText()).replace(/\s+/g, " ").slice(0, 1800),
    });
  });

  await test.step("Usuarios y accesos: asignar el cliente al revisor", async () => {
    await goTo(page, "Usuarios y accesos");
    const reviewerRow = page.locator("tr", { hasText: "revisor@contable.local" });
    await reviewerRow.getByText("Más acciones").click();
    await reviewerRow.getByRole("button", { name: /Administrar clientes de Revisor local/ }).click();
    const drawer = page.locator(".action-drawer");
    await pickOption(drawer.getByRole("combobox", { name: "Cliente" }), data.client.legalName);
    await mutating(page, "/assignments", () => drawer.getByRole("button", { name: "Asignar cliente" }).click());
    await drawer.getByRole("button", { name: "Cerrar", exact: true }).first().click().catch(() => undefined);
  });

  await test.step("Revisor: revisa los cuatro lotes importados (control de dos personas)", async () => {
    const reviewerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL as string });
    const reviewer = await reviewerContext.newPage();
    reviewer.setDefaultTimeout(15_000);
    await login(reviewer, "revisor@contable.local", "revisor1234");
    await pickOption(reviewer.getByRole("combobox", { name: "Cliente en el que estás trabajando" }), data.client.legalName);
    await goTo(reviewer, "Legajo");
    await pickOption(reviewer.locator("#monthly-workpaper-tax-period"), periodLabel(taxes.iva));
    await reviewer.getByRole("tab", { name: /Fuentes/ }).first().click();
    const pending = reviewer.getByRole("button", { name: "Revisar", exact: true });
    test.info().annotations.push({ type: "revisor · lotes por revisar", description: String(await pending.count()) });
    while (await pending.count()) {
      const before = await pending.count();
      await mutating(reviewer, "/review", () => pending.first().click());
      await expect(pending).toHaveCount(before - 1);
    }
    await reviewerContext.close();
  });

  await test.step("Legajo: clasificación, cálculo y controles tras la revisión", async () => {
    await goTo(page, "Liquidaciones");
    await goTo(page, "Legajo");
    await pickOption(page.locator("#monthly-workpaper-tax-period"), periodLabel(taxes.iva));
    await expect(page.getByRole("tab", { name: /Saldos/ })).toBeVisible();
    for (const stage of ["Saldos", "Fuentes", "Clasificación", "Cálculo", "Controles", "Cierre"]) {
      await page.getByRole("tab", { name: new RegExp(stage) }).click();
      if (stage === "Fuentes") await page.locator(".workpaper-card").first().getByRole("button", { name: "Actualizar", exact: true }).first().click();
      if (stage === "Clasificación") {
        await page.getByRole("button", { name: /Actualizar clasificación/ }).click();
        await page.waitForTimeout(2000);
        const controls = await page.locator(".workpaper-card").first().locator("select, input, button").evaluateAll((els) =>
          els.map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30)}`).filter((x) => x.length > 8),
        );
        test.info().annotations.push({ type: "clasificación · controles", description: controls.join(" | ").slice(0, 1500) });
        // Las dos ventas del libro llevan la actividad del restaurante; la compra (el ticket) lleva rubro y actividad.
        for (const sale of ["B · 0002-00000001", "B · 0002-00000251"]) {
          const row = page.locator("tr", { hasText: sale });
          await row.getByLabel("Código de actividad").fill(taxes.iva.activity.code);
          await mutating(page, "/classifications", () => row.getByRole("button", { name: "Guardar" }).click());
        }
        const purchase = page.locator("tr", { hasText: "A · 0001-01343338" });
        await pickOption(purchase.getByLabel("Rubro del proveedor"), "SUPER");
        await purchase.getByLabel("Código de actividad").fill(taxes.iva.activity.code);
        await mutating(page, "/classifications", () => purchase.getByRole("button", { name: "Guardar" }).click());
        await page.getByRole("button", { name: /Actualizar clasificación/ }).click();
        await page.waitForTimeout(1500);
        test.info().annotations.push({
          type: "legajo · Clasificación tras clasificar",
          description: (await page.locator(".workpaper-card").first().innerText()).replace(/\s+/g, " ").slice(0, 1300),
        });
      }
      const text = await page.locator(".workpaper-card").first().innerText();
      test.info().annotations.push({ type: `legajo · ${stage}`, description: text.replace(/\s+/g, " ").slice(0, 1500) });
    }
  });

  await test.step("Legajo: calcular IVA, IIBB y TEM con los datos importados", async () => {
    await page.getByRole("tab", { name: /Cálculo/ }).click();
    await mutating(page, "/calculate", () => page.locator(".workpaper-card").first().getByRole("button", { name: "Calcular", exact: true }).click());
    await page.waitForTimeout(2500);
    const calcControls = await page.locator(".workpaper-card").first().locator("select, input, textarea, button").evaluateAll((els) =>
      els.map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 40)}`).filter((x) => x.length > 8),
    );
    test.info().annotations.push({ type: "cálculo · controles de pantalla", description: calcControls.join(" | ").slice(0, 1500) });
    test.info().annotations.push({
      type: "legajo · Cálculo tras calcular",
      description: (await page.locator(".workpaper-card").first().innerText()).replace(/\s+/g, " ").slice(0, 2600),
    });
  });

  await test.step("Legajo: controles tras el cálculo", async () => {
    await page.getByRole("tab", { name: /Controles/ }).click();
    await page.waitForTimeout(1500);
    const card = page.locator(".workpaper-card").first();
    test.info().annotations.push({ type: "legajo · Controles tras calcular", description: (await card.innerText()).replace(/\s+/g, " ").slice(0, 1800) });
    const controls = await card.locator("select, input, textarea, button").evaluateAll((els) =>
      els.map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30)}`).filter((x) => x.length > 8),
    );
    test.info().annotations.push({ type: "controles · controles de pantalla", description: controls.join(" | ").slice(0, 1200) });
  });

  await test.step("Legajo: resolver los dos controles bloqueantes con el comprobante aprobado como respaldo", async () => {
    // Acreditaciones bancarias y caja piden respaldo documental. Se usa el ticket aprobado: es lo único que
    // hay cargado y alcanza para recorrer el circuito (no es un respaldo real de acreditaciones bancarias).
    const card = page.locator(".workpaper-card").first();
    for (const control of ["BANK_CREDIT_RECONCILIATION", "CASH_ALLOCATION_RECONCILIATION"]) {
      await card.getByLabel(`Resolución ${control}`).fill("Conciliado contra el comprobante de respaldo cargado en la bandeja.");
      await pickOption(card.getByLabel(`Evidencia ${control}`), "ticket-mesa-8");
      await mutating(page, "/controls", () =>
        card.getByLabel(`Evidencia ${control}`).locator("xpath=ancestor::*[.//button[normalize-space()='Resolver']][1]").getByRole("button", { name: "Resolver" }).click(),
      );
    }
    await page.waitForTimeout(1500);
    test.info().annotations.push({ type: "legajo · Controles tras resolver", description: (await card.innerText()).replace(/\s+/g, " ").slice(0, 1200) });
  });

  await test.step("Legajo: enviar a revisión y mirar el cierre con el revisor", async () => {
    const card = page.locator(".workpaper-card").first();
    await mutating(page, "/submit-review", () => card.getByRole("button", { name: "Enviar a revisión" }).click());
    await page.waitForTimeout(2000);
    test.info().annotations.push({ type: "legajo · tras enviar a revisión", description: (await card.innerText()).replace(/\s+/g, " ").slice(0, 900) });

    const reviewerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL as string });
    const reviewer = await reviewerContext.newPage();
    reviewer.setDefaultTimeout(15_000);
    await login(reviewer, "revisor@contable.local", "revisor1234");
    await pickOption(reviewer.getByRole("combobox", { name: "Cliente en el que estás trabajando" }), data.client.legalName);
    await goTo(reviewer, "Legajo");
    await pickOption(reviewer.locator("#monthly-workpaper-tax-period"), periodLabel(taxes.iva));
    const rcard = reviewer.locator(".workpaper-card").first();
    await reviewer.getByRole("tab", { name: /Cierre/ }).click();
    await reviewer.waitForTimeout(1500);
    test.info().annotations.push({ type: "revisor · cierre", description: (await rcard.innerText()).replace(/\s+/g, " ").slice(0, 1200) });
    await mutating(reviewer, "/review", () => rcard.getByRole("button", { name: "Aprobar revisión" }).click());
    await expect(rcard.getByRole("button", { name: "Finalizar" })).toBeVisible();
    await mutating(reviewer, "/finalize", () => rcard.getByRole("button", { name: "Finalizar" }).click());
    await reviewer.waitForTimeout(2000);
    test.info().annotations.push({ type: "revisor · estado tras finalizar", description: (await rcard.innerText()).replace(/\s+/g, " ").slice(0, 600) });
    await reviewerContext.close();
  });

  await test.step("Portal: invitar al cliente, activar su acceso y subir el acuse de presentación", async () => {
    const portalEmail = `cliente-${SUFFIX.toLowerCase()}@e2e.invalid`;
    const portalPassword = `Cliente-${RUN}-e2e-2025`; // sintética, sólo para esta corrida local
    portalLogin = { email: portalEmail, password: portalPassword };
    await goTo(page, "Usuarios y accesos");
    await page.getByRole("tab", { name: /Accesos del portal/ }).click();
    await page.getByRole("button", { name: /Invitar al portal/ }).first().click();
    await page.locator("#portal-invite-email").fill(portalEmail);
    await mutating(page, "/portal-invitations", () =>
      page.locator(".action-drawer").getByRole("button", { name: /Enviar invitación/ }).click(),
    );
    const link = new URL(await page.getByLabel("Enlace de invitación").inputValue());

    const portalContext = await browser.newContext({ baseURL: test.info().project.use.baseURL as string });
    const portal = await portalContext.newPage();
    portal.setDefaultTimeout(15_000);
    await portal.goto(`${link.pathname}${link.search}`);
    await portal.locator("#invite-name").fill("Cliente de prueba E2E");
    await portal.locator("#invite-email").fill(portalEmail);
    await portal.locator("#invite-password").fill(portalPassword);
    await mutating(portal, "/portal/invitations/accept", () => portal.locator('button[type="submit"]').click());
    await portal.goto("/login");
    await portal.getByLabel("Correo electrónico").fill(portalEmail);
    await portal.getByLabel("Contraseña").fill(portalPassword);
    await portal.getByRole("button", { name: "Entrar" }).click();
    await expect(portal).toHaveURL(/\/portal/);
    await portal.goto("/portal/upload");
    await portal.locator('input[type="file"]').setInputFiles(fixture);
    await portal.locator(".portal-upload__category-select").selectOption("ACUSE");
    await mutating(portal, "/complete", () => portal.getByRole("button", { name: "Subir documento" }).click());
    await portalContext.close();
  });

  await test.step("Legajo: registrar la presentación y el pago del IVA", async () => {
    // La lista de documentos del estudio se mantiene en caché 30 s: el acuse que acaba de subir el cliente
    // aparece recién al vencer (hallazgo de pantalla; no hay forma de forzar la actualización).
    await page.waitForTimeout(31_000);
    await goTo(page, "Liquidaciones");
    await goTo(page, "Legajo");
    await pickOption(page.locator("#monthly-workpaper-tax-period"), periodLabel(taxes.iva));
    await page.getByRole("tab", { name: /Cálculo/ }).click();
    const card = page.locator(".workpaper-card").first();
    await card.getByRole("button", { name: "Registrar presentación" }).first().click();
    const drawer = page.locator(".action-drawer");
    await drawer.getByLabel("Importe presentado").fill("38199.00");
    await drawer.getByLabel("Fecha de presentación").fill("2025-04-17");
    await drawer.getByLabel("Identificador externo").fill(`E2E-VEP-${SUFFIX}`);
    // La constancia la sube el estudio en este mismo paso: se valida (antivirus) y recién
    // entonces se registra la presentación.
    await drawer.getByLabel("Archivo de la constancia").setInputFiles(fixture);
    await mutating(page, "/filings", () => drawer.getByRole("button", { name: "Registrar presentación" }).click());
    await card.getByRole("button", { name: "Registrar pago" }).first().click();
    await drawer.getByLabel("Importe", { exact: true }).fill("38199.00");
    await drawer.getByLabel("Fecha de pago").fill("2025-04-18");
    await drawer.getByLabel("Referencia").fill(`E2E-PAGO-${SUFFIX}`);
    await mutating(page, "/payments", () => drawer.getByRole("button", { name: "Registrar pago" }).click());
    await page.waitForTimeout(2000);
    test.info().annotations.push({ type: "legajo · tras presentar y pagar", description: (await card.innerText()).replace(/\s+/g, " ").slice(-900) });
  });

  await test.step("Liquidaciones: lo finalizado y lo que se puede generar", async () => {
    await goTo(page, "Liquidaciones");
    await expect(page.getByRole("heading", { name: "Liquidaciones", exact: true })).toBeVisible();
    await page.waitForTimeout(2500);
    const main = page.locator("main");
    test.info().annotations.push({ type: "liquidaciones · pantalla", description: (await main.innerText()).replace(/\s+/g, " ").slice(0, 1500) });
    // Papeles de trabajo de la liquidación finalizada (IIBB, el período que muestra la pantalla).
    for (const format of ["PDF", "CSV"]) {
      await mutating(page, "/artifacts", () => main.getByRole("button", { name: format, exact: true }).click());
    }
    await expect(page.getByText(/Se generó el papel de trabajo en CSV/)).toBeVisible();
  });

  await test.step("Portal: lo que ve el cliente de sus liquidaciones", async () => {
    const credentials = portalLogin!;
    const portalContext = await browser.newContext({ baseURL: test.info().project.use.baseURL as string });
    const portal = await portalContext.newPage();
    portal.setDefaultTimeout(15_000);
    await portal.goto("/login");
    await portal.getByLabel("Correo electrónico").fill(credentials.email);
    await portal.getByLabel("Contraseña").fill(credentials.password);
    await portal.getByRole("button", { name: "Entrar" }).click();
    await expect(portal).toHaveURL(/\/portal/);
    await portal.goto("/portal/liquidaciones");
    await expect(portal.getByRole("heading", { name: "Liquidaciones publicadas", exact: true })).toBeVisible();
    await portal.waitForTimeout(2500);
    test.info().annotations.push({ type: "portal · liquidaciones", description: (await portal.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 700) });
    await portalContext.close();
  });

  expect(failedMutations, `mutaciones rechazadas:\n${failedMutations.join("\n")}`).toEqual([]);
});
