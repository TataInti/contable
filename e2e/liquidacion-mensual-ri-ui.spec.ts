import { Buffer } from "node:buffer";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { RUN, SUFFIX, goTo, login, markGuidedTourSeen, mutating, pickOption, seen, syntheticCuit } from "./helpers/ui";
import { lineaPercepcionDgr, libroVentasXlsx, nombrePercepcionDgr } from "./helpers/fuentes-sinteticas";

/** Elige una opción de desplegable (<select> o buscador con lista). En el buscador el clic va directo a la opción: la lista se vuelve a dibujar mientras se escribe y el clic con comprobaciones de estabilidad no llegaba. */
async function pick(campo: Locator, texto: string) {
  if ((await campo.evaluate((elemento) => elemento.tagName)) === "SELECT") return pickOption(campo, texto);
  // Tipeo con teclas reales: un fill() recién abierto el cajón perdía la primera letra («estaurante») y no hallaba la opción.
  await campo.click();
  await campo.fill("");
  await campo.pressSequentially(texto, { delay: 10 });
  const listboxId = await campo.getAttribute("aria-controls");
  const opcion = campo.page().locator(`#${listboxId}`).getByRole("option").filter({ hasText: texto }).first();
  await expect(opcion, `opción que contiene «${texto}»`).toBeVisible({ timeout: 10_000 });
  await opcion.evaluate((elemento: HTMLElement) => elemento.click());
}

/**
 * Recorrido completo de un Responsable Inscripto en San Miguel de Tucumán, operado como lo opera el contador.
 *
 *   1. Nuevo cliente en Tucumán (Responsable Inscripto, SRL).
 *   2. Configuración fiscal: perfil, inscripción en los regímenes de sistema IIBB Tucumán y TEM SMT, actividad
 *      de restaurante del catálogo 2026 para cada impuesto, categoría TEM 2026 «B», períodos y obligaciones.
 *   3. Legajo de octubre de 2026 (un mes anterior a la fecha del alta): ventas de ARCA (xlsx, 3 facturas por
 *      115.000) y percepciones de la DGR (TXT, 1.500,55).
 *   4. Cálculo sin mínimo: IIBB 4.025,00 − 1.500,55 = 2.524,45; TEM 690,00 < mínimo B → 10.028,00.
 *   5. Mínimo de IIBB 11.180 → aviso de desactualizado → Recalcular → 11.180,00 − 1.500,55 = 9.679,45.
 *   6. Controles: los 2 bloqueantes se resuelven con motivo desde la pantalla.
 *   7. Autorrevisión del titular: Enviar a revisión → Aprobar revisión (casilla activada en Usuarios y accesos → Controles).
 *   8. Cierre en pasos: Finalizar con confirmación; presentación con acuse, declaración jurada y pago de IIBB y TEM.
 *   9. No verificado en este spec: el saldo que pasa al mes siguiente. La declaración jurada de IIBB y TEM no origina
 *      saldo a favor arrastrable en la pantalla (solo IVA y el detalle por jurisdicción); ver el PR.
 *
 * Importes calculados a mano en este archivo (no salen de la función que se prueba):
 *   IIBB base 115.000 × 3,5 % = 4.025,00 ; percepciones 1.500,55 ; neto 2.524,45
 *   TEM base 115.000 × 0,6 % = 690,00 < mínimo B 10.028,00 ⇒ 10.028,00
 *   IIBB con mínimo 11.180,00 − 1.500,55 = 9.679,45
 *
 * Todo sintético y con el sufijo de la corrida. Solo se opera por la interfaz (login, menús, formularios,
 * botones). Los regímenes, actividades y alícuotas de restaurante son los de sistema (seed del job E2E, que
 * refleja el catálogo de producción 2026); el spec no crea catálogos.
 */

const CLIENTE = {
  legalName: `Cliente E2E Liquidación ${SUFFIX} S.R.L.`,
  tradeName: `E2E Liquidación ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 2_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const AGENTE_DGR = syntheticCuit(Number.parseInt(RUN, 36) + 3_000);

const ALTA = "2025-01-01";
const PERIODO = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026" };
const VENCIMIENTO = "2026-11-20";

const IIBB = {
  taxName: "Ingresos Brutos",
  taxOption: "Ingresos Brutos",
  regime: "IIBB Contribuyente Local Tucumán",
  activity: "Restaurante y bares (Tucumán)",
  label: `Octubre 2026 IIBB ${SUFFIX}`,
};
const TEM = {
  taxName: "Tributo Económico Municipal (TEM)",
  taxOption: "Tributo Económico Municipal",
  regime: "TEM San Miguel de Tucumán",
  activity: "Restaurante y bares (San Miguel de Tucumán)",
  label: `Octubre 2026 TEM ${SUFFIX}`,
};

/** Facturas A sintéticas del libro de ventas: neto 50.000 + 40.000 + 25.000 = 115.000. */
const FACTURAS = [
  { fecha: "2026-10-05", tipo: "1", numero: "1", docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 4_001), denominacion: "Comensal E2E 1", neto: "50000.00", iva: "10500.00" },
  { fecha: "2026-10-12", tipo: "1", numero: "2", docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 4_002), denominacion: "Comensal E2E 2", neto: "40000.00", iva: "8400.00" },
  { fecha: "2026-10-20", tipo: "1", numero: "3", docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 4_003), denominacion: "Comensal E2E 3", neto: "25000.00", iva: "5250.00" },
];
const PERCEPCION = { importe: "1500.55", fecha: "15/10/2026" };
const MOTIVO_CONTROL = `E2E ${SUFFIX}: extracto bancario sintético no aportado en la corrida; se resuelve con motivo y queda registrado.`;
/** Respaldos sintéticos (PDF mínimo) para el acuse y la declaración jurada; el contenido distinto evita el duplicado por hash. */
const acuseSintetico = (etiqueta: string) => ({
  name: `acuse-${etiqueta}-${SUFFIX}.pdf`,
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.4\n% acuse sintético ${SUFFIX} ${etiqueta}\n%%EOF\n`, "binary"),
});
const declaracionSintetica = (etiqueta: string) => ({
  name: `dj-${etiqueta}-${SUFFIX}.pdf`,
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.4\n% declaración jurada sintética ${SUFFIX} ${etiqueta}\n%%EOF\n`, "binary"),
});

/** Formato argentino de los importes en pantalla (4.025,00). */
const importe = (texto: string) => new RegExp(texto.replace(/\./g, "\\.").replace(/,/g, ","));

// ───────────── helpers de la configuración fiscal del cliente ─────────────

const FISCAL_TAB: Record<string, RegExp> = {
  "Regímenes adheridos": /^Regímenes/,
  Actividades: /^Actividades/,
  "Períodos fiscales": /^Períodos y obligaciones/,
};

async function clickAdd(page: Page, heading: string) {
  await page.getByRole("tab", { name: FISCAL_TAB[heading]! }).click();
  await page
    .locator(".fiscal-client-overview__heading")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .getByRole("button", { name: "Agregar" })
    .click();
}

/** Etiqueta de período como la muestra el desplegable del Legajo: «Octubre de 2026 · Impuesto · etiqueta». */
const rotuloDelPeriodo = (tax: typeof IIBB | typeof TEM) => `${PERIODO.mes} · ${tax.taxName} · ${tax.label}`;

/** Lee un importe en la tabla o texto del Legajo; falla con el texto visible si no aparece. */
async function esperarImporte(page: Page, texto: string) {
  await expect.soft(page.locator(".work-page").first().getByText(importe(texto)).first(), `importe ${texto} en pantalla`).toBeVisible({ timeout: 20_000 });
}

test("liquidación mensual de un Responsable Inscripto en Tucumán, desde la interfaz", async ({ page }) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);
  await markGuidedTourSeen(page);

  const errores: string[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    if (!response.url().includes("/api/v1/")) return;
    if (response.status() >= 400) errores.push(`${request.method()} ${response.url()} → ${response.status()}`);
  });

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Clientes: alta de un cliente nuevo en Tucumán", async () => {
    await goTo(page, "Clientes");
    await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
    await page.locator("#client-legal-name").fill(CLIENTE.legalName);
    await page.locator("#client-trade-name").fill(CLIENTE.tradeName);
    await page.locator("#client-cuit").fill(CLIENTE.cuit);
    await pick(page.locator("#client-vat-condition"), "Responsable inscripto");
    await pick(page.locator("#client-province"), "Tucumán");
    await pick(page.locator("#client-legal-form"), "Sociedad de responsabilidad limitada (SRL)");
    await page.locator(".action-drawer").getByRole("button", { name: "Guardar cliente" }).click();
    await expect(page).toHaveURL(/\/configuracion-fiscal/);
    await expect(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" })).toHaveValue(
      new RegExp(CLIENTE.legalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  await test.step("Configuración fiscal: perfil activo", async () => {
    await page.getByRole("button", { name: "Crear perfil fiscal" }).first().click();
    await page.locator("#pf-legal-name").fill(CLIENTE.legalName);
    await page.locator("#pf-cuit").fill(CLIENTE.cuit);
    await page.locator("#pf-fiscal-address").fill(CLIENTE.fiscalAddress);
    await pick(page.locator("#pf-person-type"), "Jurídica");
    await pick(page.locator("#pf-condition"), "Responsable Inscripto");
    await page.locator("#pf-valid-from").fill(ALTA);
    await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByRole("button", { name: "Activar perfil" }).click();
    await expect(page.getByRole("button", { name: "Crear nueva versión" })).toBeVisible();
  });

  await test.step("Configuración fiscal: inscripción en IIBB Tucumán y TEM SMT (regímenes de sistema) desde el alta", async () => {
    for (const tax of [IIBB, TEM]) {
      await clickAdd(page, "Regímenes adheridos");
      await pick(page.locator("#reg-regime"), tax.regime);
      await page.locator("#reg-from").fill(ALTA);
      await mutating(page, "/tax-registrations", () =>
        page.getByRole("button", { name: "Registrar inscripción", exact: true }).last().click(),
      );
    }
  });

  await test.step("Configuración fiscal: actividad de restaurante del catálogo 2026 para cada impuesto (sin fecha: vale desde el alta)", async () => {
    for (const tax of [IIBB, TEM]) {
      await clickAdd(page, "Actividades");
      await pick(page.locator("#act-activity"), tax.activity);
      // Vincular la actividad no pide fecha: vale desde el alta del cliente (4L). Sin campo «Desde» en el cajón.
      await expect(page.locator("#act-from")).toHaveCount(0);
      await mutating(page, "/activities", () =>
        page.getByRole("button", { name: "Vincular actividad", exact: true }).last().click(),
      );
    }
  });

  await test.step("Configuración fiscal: categoría TEM 2026 «B» del cliente", async () => {
    await page.getByRole("tab", { name: /^Regímenes/ }).click();
    await page.getByRole("button", { name: /Elegir categoría|Cambiar categoría/ }).first().click();
    await pick(page.locator("#categoria-tem"), "B");
    await mutating(page, "/tem-categories", () => page.getByRole("button", { name: "Guardar categoría" }).click());
    await expect(page.getByText(/Categoría 2026: B/).first()).toBeVisible();
  });

  await test.step("Configuración fiscal: período de octubre de 2026 y obligación por impuesto", async () => {
    for (const tax of [IIBB, TEM]) {
      await clickAdd(page, "Períodos fiscales");
      await pick(page.locator("#per-tax-type"), tax.taxOption);
      await page.locator("#per-start").fill(PERIODO.start);
      await page.locator("#per-end").fill(PERIODO.end);
      await page.locator("#per-label").fill(tax.label);
      await mutating(page, "/tax-periods", () => page.getByRole("button", { name: "Crear período" }).click());

      await page.getByRole("button", { name: /Completar obligaciones|Crear obligación/ }).first().click();
      await pick(page.locator("#obl-period"), tax.label);
      await pick(page.locator("#obl-regime"), tax.regime);
      await page.locator("#obl-due-date").fill(VENCIMIENTO);
      await mutating(page, "/tax-obligations", () =>
        page.getByRole("button", { name: "Crear obligación", exact: true }).last().click(),
      );
    }
    await page.getByRole("tab", { name: "Resumen", exact: true }).click();
    await expect(page.getByText("Configuración completa")).toBeVisible();
  });

  await test.step("Legajo de octubre de 2026: se abre aunque el alta sea posterior", async () => {
    await goTo(page, "Liquidaciones");
    await goTo(page, "Legajo");
    await pick(page.getByRole("combobox", { name: "Período fiscal" }), rotuloDelPeriodo(IIBB));
    await mutating(page, "/monthly-tax-workpapers", () => page.getByRole("button", { name: "Nuevo legajo", exact: true }).click());
  });

  await test.step("Fuentes: ventas de ARCA en xlsx (3 facturas por 115.000)", async () => {
    await page.getByRole("tab", { name: /Fuentes/ }).first().click();
    await page.getByRole("button", { name: "Gestionar Ventas del período" }).click();
    await page.getByRole("button", { name: "Cargar archivo" }).click();
    const panel = page.getByRole("dialog", { name: "Importar libros IVA" });
    const libro = panel.locator('section[aria-label="Libro de ventas"]');
    await libro.locator('input[type="file"]').setInputFiles({
      name: `ventas-arca-${SUFFIX}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(libroVentasXlsx(FACTURAS)),
    });
    // Un .xlsx pasa por el análisis de alícuotas antes de importarse: «Importar» se habilita recién después.
    await libro.getByRole("button", { name: "Analizar alícuotas", exact: true }).click();
    await expect(libro.getByRole("button", { name: "Importar", exact: true })).toBeEnabled({ timeout: 60_000 });
    await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
    await expect(panel).toBeHidden({ timeout: 60_000 });
  });

  await test.step("Fuentes: percepciones de la DGR (TXT de 1.500,55)", async () => {
    await page.getByRole("button", { name: "Gestionar Retenciones y percepciones IIBB Tucumán" }).click();
    await page.getByRole("button", { name: "Cargar archivo" }).click();
    const panel = page.getByRole("dialog", { name: "Gestionar fuente" });
    const contenido = `${lineaPercepcionDgr(AGENTE_DGR, "AGENTE DGR SINTETICO E2E", PERCEPCION.fecha, PERCEPCION.importe)}\r\n`;
    await panel.locator('input[type="file"]').setInputFiles({
      name: nombrePercepcionDgr(CLIENTE.cuit, "151020261200"),
      mimeType: "text/plain",
      buffer: Buffer.from(contenido, "utf-8"),
    });
    await mutating(page, "/import-batches", () => panel.getByRole("button", { name: "Importar archivo" }).click());
    await expect(panel.getByText("Procesando…")).toHaveCount(0, { timeout: 60_000 });
    await panel.getByRole("button", { name: "Cerrar", exact: true }).last().click();
    await expect(panel).toBeHidden();
  });

  await test.step("Configuración del estudio: el Titular habilita la autorrevisión (Usuarios y accesos → Controles)", async () => {
    await goTo(page, "Usuarios y accesos");
    // La URL cambia antes de que la pantalla nueva reemplace a la del Legajo: se espera una pestaña propia de
    // Usuarios y accesos. Sin esa espera, el clic en «Controles» caía sobre la pestaña del Legajo (CI 22-nov).
    await expect(page.getByRole("tab", { name: /^Usuarios internos/ })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: /^Controles/ }).click();
    // Idempotente: la opción persiste en la base de la corrida; si ya está activada, no se vuelve a tocar.
    const autorrevision = page.getByRole("checkbox", { name: "Permitir autorrevisión de fuentes y legajos" });
    await expect(autorrevision, "casilla de autorrevisión en Controles").toBeVisible({ timeout: 30_000 });
    if (!(await autorrevision.isChecked())) {
      await mutating(page, "/api/v1/", () => autorrevision.click());
      await expect(autorrevision).toBeChecked();
    }
    await expect(seen(page, "Activada")).toBeVisible();
  });

  await test.step("Fuentes: el Titular revisa los dos lotes que importó", async () => {
    await goTo(page, "Legajo");
    await pick(page.getByRole("combobox", { name: "Período fiscal" }), rotuloDelPeriodo(IIBB));
    await page.getByRole("tab", { name: /Fuentes/ }).first().click();
    // La revisión del lote está en el panel «Gestionar» de cada fuente.
    for (const fuente of ["Gestionar Ventas del período", "Gestionar Retenciones y percepciones IIBB Tucumán"]) {
      await page.getByRole("button", { name: fuente }).click();
      const revisar = page.getByRole("button", { name: "Revisar", exact: true });
      await expect(revisar, `lote de «${fuente}» por revisar`).toBeVisible({ timeout: 20_000 });
      await mutating(page, "/api/v1/", () => revisar.click());
      await expect(revisar).toHaveCount(0);
      await page.getByRole("button", { name: "Cerrar", exact: true }).last().click();
    }
  });

  await test.step("Clasificación lista: las ventas quedan en la actividad del restaurante", async () => {
    await page.getByRole("tab", { name: /Clasificación/ }).click();
    await page.locator(".work-page").first().getByRole("button", { name: "Actualizar", exact: true }).first().click();
    await expect(page.getByText("Listo para calcular").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/3 ventas asignadas automáticamente a la única actividad/).first()).toBeVisible();
  });

  await test.step("Cálculo sin mínimo: IIBB 4.025,00 y TEM 10.028,00 por el mínimo de la categoría B", async () => {
    await page.getByRole("tab", { name: /Cálculo/ }).click();
    await page.getByRole("checkbox", { name: IIBB.taxName }).check();
    await page.getByRole("checkbox", { name: TEM.taxName }).check();
    await page.getByRole("button", { name: "Calcular liquidación", exact: true }).click();
    await esperarImporte(page, "4.025,00");
    await esperarImporte(page, "1.500,55");
    await esperarImporte(page, "2.524,45");
    await esperarImporte(page, "690,00");
    await esperarImporte(page, "10.028,00");
  });

  await test.step("Mínimo de IIBB 11.180: aviso de desactualizado y Recalcular", async () => {
    await page.getByLabel("Mínimo del mes").first().fill("11180");
    await expect(page.locator(".work-page").first().getByRole("status").filter({ hasText: /recalcul|desactualiz/i })).toBeVisible();
    await page.locator(".work-page").first().getByRole("button", { name: "Recalcular", exact: true }).click();
    await esperarImporte(page, "9.679,45");
  });

  await test.step("Controles: los dos bloqueantes se resuelven con motivo desde la pantalla", async () => {
    await page.getByRole("tab", { name: /^Controles/ }).click();
    const panel = page.locator(".work-page").first();
    for (const nombre of ["Acreditaciones bancarias vs. facturación", "Caja e imputaciones del período"]) {
      // Un mismo control puede repetirse por impuesto del legajo: se resuelven todos los abiertos de ese nombre.
      const abiertos = panel
        .locator(".workpaper-control")
        .filter({ hasText: nombre })
        .filter({ has: page.getByRole("textbox", { name: /^Resolución / }) });
      await expect(abiertos.first(), `control «${nombre}»`).toBeVisible({ timeout: 20_000 });
      for (let intento = 0; intento < 4 && (await abiertos.count()) > 0; intento++) {
        const control = abiertos.first();
        await control.getByRole("textbox", { name: /^Resolución / }).fill(MOTIVO_CONTROL);
        await mutating(page, "/resolve", () => control.getByRole("button", { name: "Resolver", exact: true }).click());
        await expect(control.getByRole("button", { name: "Resolver", exact: true })).toHaveCount(0);
      }
      await expect(abiertos, `«${nombre}» sin abiertos`).toHaveCount(0);
    }
    await expect(page.getByText("bloqueantes abiertos")).toHaveCount(0);
  });

  await test.step("Revisión: Enviar a revisión y aprobación del propio Titular (autorrevisión activada)", async () => {
    await mutating(page, "/submit-review", () =>
      page.getByRole("button", { name: "Enviar a revisión", exact: true }).click(),
    );
    await mutating(page, "/review", () => page.getByRole("button", { name: "Aprobar revisión", exact: true }).click());
  });

  await test.step("Cierre: finalizar con confirmación; el mes queda congelado", async () => {
    await page.getByRole("tab", { name: /^Cierre/ }).click();
    const pasos = page.getByRole("list", { name: "Pasos para cerrar el período" });
    await pasos.getByRole("button", { name: "Finalizar", exact: true }).click();
    await mutating(page, "/finalize", () => page.getByRole("button", { name: "Sí, finalizar" }).click());
    await expect(pasos.locator("li").nth(0).getByRole("status")).toHaveText("Hecho");
  });

  await test.step("Cálculo: presentación con acuse, declaración jurada y pago de IIBB y TEM", async () => {
    await page.getByRole("tab", { name: /Cálculo/ }).click();
    const cargas = [
      { tax: IIBB, total: "2524.45", determinado: "4025.00" },
      { tax: TEM, total: "10028.00", determinado: "10028.00" },
    ];
    for (const { tax, total, determinado } of cargas) {
      const etiqueta = tax === IIBB ? "iibb" : "tem";
      const fila = page.getByRole("row").filter({ hasText: tax.taxName });
      const drawer = page.locator(".action-drawer");

      await fila.getByRole("button", { name: "Registrar presentación", exact: true }).click();
      await drawer.getByLabel("Importe presentado").fill(total);
      await drawer.getByLabel("Archivo del acuse").setInputFiles(acuseSintetico(etiqueta));
      await mutating(page, "/filings", () =>
        drawer.getByRole("button", { name: "Registrar presentación", exact: true }).click(),
      );
      await expect(drawer).toBeHidden({ timeout: 60_000 });

      await fila.getByRole("button", { name: /Cargar declaración jurada|Corregir declaración jurada/ }).click();
      await drawer.getByLabel("Impuesto determinado", { exact: true }).fill(determinado);
      await drawer.getByLabel("Saldo a favor técnico", { exact: true }).fill("0.00");
      await drawer.getByLabel("Saldo a favor de libre disponibilidad", { exact: true }).fill("0.00");
      await drawer.getByLabel("Total a pagar", { exact: true }).fill(total);
      await drawer.getByLabel("Archivo de la declaración jurada").setInputFiles(declaracionSintetica(etiqueta));
      await mutating(page, "/declaration", () =>
        drawer.getByRole("button", { name: /Guardar declaración jurada|Guardar corrección/ }).click(),
      );
      // Las diferencias informan y no bloquean: se leen y se cierra el cajón.
      if (await drawer.getByText("Declaración jurada cargada con diferencias").isVisible().catch(() => false)) {
        await drawer.getByRole("button", { name: "Cerrar", exact: true }).click();
      }
      await expect(drawer).toBeHidden({ timeout: 60_000 });

      await fila.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await drawer.getByLabel("Importe", { exact: true }).fill(total);
      await drawer.getByLabel("Fecha de pago").fill("2026-11-20");
      await mutating(page, "/payments", () => drawer.getByRole("button", { name: "Registrar pago", exact: true }).click());
      await expect(drawer).toBeHidden({ timeout: 60_000 });
    }
  });

  await test.step("Cierre: los cuatro pasos quedan hechos y el saldo se informa para el mes siguiente", async () => {
    await page.getByRole("tab", { name: /^Cierre/ }).click();
    const pasos = page.getByRole("list", { name: "Pasos para cerrar el período" });
    for (let i = 0; i < 4; i++) {
      await expect(pasos.locator("li").nth(i).getByRole("status")).toHaveText("Hecho");
    }
    await expect(page.getByRole("region", { name: "Saldo para el mes siguiente" })).toContainText("noviembre de 2026");
  });

  test.info().annotations.push({ type: "errores de mutación", description: errores.join(" | ") || "ninguno" });
  expect(errores, "ninguna mutación de la API respondió con error").toEqual([]);
});
