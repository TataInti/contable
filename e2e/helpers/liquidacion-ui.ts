import { Buffer } from "node:buffer";
import { expect, type Locator, type Page } from "@playwright/test";
import { abrirInscripcionManual, goTo, mutating, pickOption, seen } from "./ui";
import { libroVentasXlsx, lineaPercepcionDgr, nombrePercepcionDgr, type FacturaSintetica } from "./fuentes-sinteticas";

/**
 * Pasos de la interfaz que repiten los specs de liquidación de un Responsable Inscripto en Tucumán
 * (cliente, configuración fiscal con IIBB, Legajo, fuentes, autorrevisión y cálculo). Solo clic normal,
 * teclas reales y formularios: nada de evaluate ni force. Los importes se verifican en el propio spec.
 */

export const ALTA = "2025-01-01";
export const VENCIMIENTO = "2026-11-20";
export const IIBB = {
  taxName: "Ingresos Brutos",
  taxOption: "Ingresos Brutos",
  regime: "IIBB Contribuyente Local Tucumán",
  activity: "Restaurante y bares (Tucumán)",
};
export const DGR_AGENTE = "AGENTE DGR SINTETICO E2E";

/** Elige una opción de desplegable (<select> o buscador con lista) con teclas reales. */
export async function pick(campo: Locator, texto: string) {
  if ((await campo.evaluate((elemento) => elemento.tagName)) === "SELECT") return pickOption(campo, texto);
  await campo.click();
  await campo.fill("");
  await campo.pressSequentially(texto, { delay: 10 });
  const listboxId = await campo.getAttribute("aria-controls");
  const opcion = campo.page().locator(`#${listboxId}`).getByRole("option").filter({ hasText: texto }).first();
  await expect(opcion, `opción que contiene «${texto}»`).toBeVisible({ timeout: 10_000 });
  await opcion.click();
}

const FISCAL_TAB: Record<string, RegExp> = {
  "Regímenes adheridos": /^Regímenes/,
  Actividades: /^Actividades/,
  "Períodos fiscales": /^Períodos y obligaciones/,
};

/** Abre la pestaña del bloque de Configuración fiscal y toca su «Agregar». */
export async function clickAdd(page: Page, heading: string) {
  await page.getByRole("tab", { name: FISCAL_TAB[heading]! }).click();
  await page
    .locator(".fiscal-client-overview__heading")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .getByRole("button", { name: "Agregar" })
    .click();
}

export interface ClienteRI {
  legalName: string;
  tradeName: string;
  cuit: string;
  fiscalAddress: string;
}

/** Alta de un cliente Responsable Inscripto en Tucumán y su perfil fiscal activo. */
export async function altaClienteRI(page: Page, cliente: ClienteRI) {
  await goTo(page, "Clientes");
  await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
  await page.locator("#client-legal-name").fill(cliente.legalName);
  await page.locator("#client-trade-name").fill(cliente.tradeName);
  await page.locator("#client-cuit").fill(cliente.cuit);
  await pick(page.locator("#client-vat-condition"), "Responsable inscripto");
  await pick(page.locator("#client-province"), "Tucumán");
  await pick(page.locator("#client-legal-form"), "Sociedad de responsabilidad limitada (SRL)");
  await mutating(page, "/clients", () =>
    page.locator(".action-drawer").getByRole("button", { name: "Guardar cliente" }).click(),
  );
  await expect(page).toHaveURL(/\/configuracion-fiscal/);
  await expect(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" })).toHaveValue(
    new RegExp(cliente.legalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  await expect(page.getByRole("button", { name: "Crear nueva versión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear perfil fiscal" })).toHaveCount(0);
}

/** Inscripción en IIBB Tucumán desde el alta del cliente (sin fecha: rige desde el alta). */
export async function inscribirIIBB(page: Page) {
  await clickAdd(page, "Regímenes adheridos");
  await abrirInscripcionManual(page);
  await pick(page.locator("#reg-regime"), IIBB.regime);
  await page.locator("#reg-from").fill(ALTA);
  await mutating(page, "/tax-registrations", () =>
    page.getByRole("button", { name: "Registrar inscripción", exact: true }).last().click(),
  );
}

/** Vincula una actividad del catálogo (sin fecha: vale desde el alta del cliente). */
export async function vincularActividad(page: Page, actividad: string) {
  await vincularActividades(page, [actividad]);
}

/** Vincula varias actividades del catálogo en un solo alta: cada una se busca y se marca con su casilla; un solo «Vincular». */
export async function vincularActividades(page: Page, actividades: string[]) {
  await clickAdd(page, "Actividades");
  const cajon = page.getByRole("dialog", { name: "Vincular actividad económica" });
  for (const actividad of actividades) {
    await cajon.getByRole("searchbox", { name: "Buscar actividad" }).fill(actividad);
    await cajon.getByRole("checkbox", { name: actividad }).check();
  }
  await expect(page.locator("#act-from")).toHaveCount(0);
  await mutating(page, "/activities", () =>
    cajon.getByRole("button", { name: "Vincular actividad", exact: true }).click(),
  );
}

/** Período fiscal de IIBB (un mes) con su obligación. El rótulo es el que aparece en el desplegable del Legajo. */
export async function crearPeriodoIIBB(page: Page, periodo: { start: string; end: string; label: string }) {
  await clickAdd(page, "Períodos fiscales");
  await pick(page.locator("#per-tax-type"), IIBB.taxOption);
  await page.locator("#per-start").fill(periodo.start);
  await page.locator("#per-end").fill(periodo.end);
  await page.locator("#per-label").fill(periodo.label);
  await mutating(page, "/tax-periods", () => page.getByRole("button", { name: "Crear período" }).click());
  await page.getByRole("button", { name: /Completar obligaciones|Crear obligación/ }).first().click();
  await pick(page.locator("#obl-period"), periodo.label);
  await pick(page.locator("#obl-regime"), IIBB.regime);
  await page.locator("#obl-due-date").fill(VENCIMIENTO);
  await mutating(page, "/tax-obligations", () =>
    page.getByRole("button", { name: "Crear obligación", exact: true }).last().click(),
  );
}

/** Rótulo del mes en el desplegable del Legajo: una entrada por mes, «Mes de año» (sin impuesto ni etiqueta del período). */
export const rotuloDelPeriodo = (mes: string, _label?: string) => mes;

/** Abre el Legajo del mes elegido y lo crea si todavía no existe. */
export async function abrirLegajo(page: Page, rotulo: string) {
  await goTo(page, "Liquidaciones");
  await goTo(page, "Legajo");
  await pick(page.getByRole("combobox", { name: "Período fiscal" }), rotulo);
  await mutating(page, "/monthly-tax-workpapers", () => page.getByRole("button", { name: "Nuevo legajo", exact: true }).click());
}

/** Abre el Legajo ya creado y elige el período (sin crear). */
export async function irAlLegajo(page: Page, rotulo: string) {
  await goTo(page, "Liquidaciones");
  await goTo(page, "Legajo");
  await pick(page.getByRole("combobox", { name: "Período fiscal" }), rotulo);
  await expect(page.getByRole("tab", { name: /Fuentes/ }).first()).toBeVisible();
}

/** Libro de ventas en xlsx: se carga desde «Gestionar Ventas del período» (o se reemplaza, si `reemplazar`). `bytes` permite subir exactamente el mismo archivo (mismo hash). */
export async function cargarLibroVentas(page: Page, facturas: FacturaSintetica[], nombre: string, reemplazar = false, bytes?: Buffer) {
  await page.getByRole("tab", { name: /Fuentes/ }).first().click();
  await page.getByRole("button", { name: "Gestionar Ventas del período" }).click();
  if (reemplazar) {
    await page.getByRole("button", { name: "Reemplazar", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Cargar archivo" }).click();
  }
  const panel = page.getByRole("dialog", { name: reemplazar ? "Reemplazar libro IVA" : "Importar libro de ventas" });
  const libro = panel.locator('section[aria-label="Libro de ventas"]');
  await libro.locator('input[type="file"]').setInputFiles({
    name: nombre,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes ?? Buffer.from(libroVentasXlsx(facturas)),
  });
  await expect(libro.getByRole("button", { name: "Importar", exact: true })).toBeEnabled({ timeout: 60_000 });
  return { panel, libro };
}

/** Percepciones de la DGR (TXT): «Gestionar Retenciones y percepciones IIBB Tucumán» → Cargar archivo → Importar. */
export async function cargarPercepcionDgr(page: Page, cuitCliente: string, agenteCuit: string, importe: string, fecha: string, etiqueta: string) {
  await page.getByRole("tab", { name: /Fuentes/ }).first().click();
  await page.getByRole("button", { name: "Gestionar Retenciones y percepciones IIBB Tucumán" }).click();
  await page.getByRole("button", { name: "Cargar archivo" }).click();
  const panel = page.getByRole("dialog", { name: "Gestionar fuente" });
  const contenido = `${lineaPercepcionDgr(agenteCuit, DGR_AGENTE, fecha, importe)}\r\n`;
  await panel.locator('input[type="file"]').setInputFiles({
    name: nombrePercepcionDgr(cuitCliente, etiqueta),
    mimeType: "text/plain",
    buffer: Buffer.from(contenido, "utf-8"),
  });
  await mutating(page, "/import-batches", () => panel.getByRole("button", { name: "Importar archivo" }).click());
  await expect(panel.getByText("Procesando…")).toHaveCount(0, { timeout: 60_000 });
  return panel;
}

/** Cierra el panel «Gestionar» de la fuente. */
export async function cerrarGestion(page: Page) {
  await page.getByRole("button", { name: "Cerrar", exact: true }).last().click();
}

/** Autorrevisión del Titular (Usuarios y accesos → Controles). Idempotente. */
export async function activarAutorrevision(page: Page) {
  await goTo(page, "Usuarios y accesos");
  await expect(page.getByRole("tab", { name: /^Usuarios internos/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /^Controles/ }).click();
  const autorrevision = page.getByRole("checkbox", { name: "Permitir autorrevisión de fuentes y legajos" });
  await expect(autorrevision, "casilla de autorrevisión en Controles").toBeVisible({ timeout: 30_000 });
  if (!(await autorrevision.isChecked())) {
    await mutating(page, "/api/v1/", () => autorrevision.click());
    await expect(autorrevision).toBeChecked();
  }
  await expect(seen(page, "Activada")).toBeVisible();
}

/** Revisa los lotes por revisar de una fuente (Gestionar → Revisar) y cierra el panel. */
export async function revisarLotesDe(page: Page, boton: string) {
  await page.getByRole("tab", { name: /Fuentes/ }).first().click();
  await page.getByRole("button", { name: boton }).click();
  const revisar = page.getByRole("button", { name: "Revisar", exact: true });
  await expect(revisar, `lote de «${boton}» por revisar`).toBeVisible({ timeout: 20_000 });
  await mutating(page, "/api/v1/", () => revisar.click());
  await expect(revisar).toHaveCount(0);
  await cerrarGestion(page);
}

/** Clasificación: «Actualizar» y «Listo para calcular». */
export async function clasificarListo(page: Page) {
  await page.getByRole("tab", { name: /Clasificación/ }).click();
  await page.locator(".work-page").first().getByRole("button", { name: "Actualizar", exact: true }).first().click();
  await expect(page.getByText("Listo para calcular").first()).toBeVisible({ timeout: 20_000 });
}

/** Cálculo solo de IIBB: marca el impuesto y calcula (o recalcula si ya había un cálculo desactualizado). */
export async function calcularIIBB(page: Page) {
  await page.getByRole("tab", { name: /Cálculo/ }).click();
  const casilla = page.getByRole("checkbox", { name: IIBB.taxName });
  if (!(await casilla.isChecked())) await casilla.check();
  const boton = page.getByRole("button", { name: /^(Calcular liquidación|Recalcular)$/ }).first();
  await expect(boton).toBeVisible({ timeout: 20_000 });
  await mutating(page, "/calculate", () => boton.click());
}

/** Espera un importe en la pantalla del Legajo (formato argentino). */
export async function esperarImporte(page: Page, texto: string) {
  const patron = new RegExp(texto.replace(/\./g, "\\.").replace(/,/g, ","));
  await expect(page.locator(".work-page").first().getByText(patron).first(), `importe ${texto} en pantalla`).toBeVisible({ timeout: 20_000 });
}
