import { expect, test, type Page } from "@playwright/test";
import { RUN, SUFFIX, goTo, login, mutating, pickOption, syntheticCuit } from "./helpers/ui";
import { altaClienteRI, type ClienteRI } from "./helpers/liquidacion-ui";

/**
 * Control de CUIT de la Bandeja, operado como lo opera el contador (desde la interfaz).
 *
 *   1. Dos clientes del estudio (A y B), cada uno con su pedido documental para recibir comprobantes.
 *   2. En la Bandeja de A se sube un comprobante cuyo CUIT emisor es de B y el receptor es de un tercero:
 *      «CUIT de otro cliente», «Aprobar extracción» bloqueado con su motivo y el botón «Mover a B».
 *   3. «Mover a B»: el comprobante sale de la Bandeja de A y aparece en la Bandeja de B.
 *   4. En la Bandeja de A se sube otro comprobante con CUIT de terceros (ni A ni B): «CUIT de otro cliente»,
 *      se acepta con motivo y queda aprobable: «Aprobar extracción» → «Extracción revisada».
 *
 * Los comprobantes son PDF sintéticos con marcadores (CUIT_EMISOR=, CUIT_RECEPTOR=, TOTAL=) que el servicio
 * de IA de e2e/ai-service-stub.mjs lee; no son comprobantes reales. Todos los CUIT tienen dígito verificador.
 */

const RUN36 = Number.parseInt(RUN, 36);
const CLIENTE_A: ClienteRI = {
  legalName: `Cliente E2E CUIT A ${SUFFIX} S.R.L.`,
  tradeName: `E2E CUIT A ${SUFFIX}`,
  cuit: syntheticCuit(RUN36 + 8_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const CLIENTE_B: ClienteRI = {
  legalName: `Cliente E2E CUIT B ${SUFFIX} S.R.L.`,
  tradeName: `E2E CUIT B ${SUFFIX}`,
  cuit: syntheticCuit(RUN36 + 8_500),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
/** Terceros que no son clientes del estudio. */
const TERCERO_1 = syntheticCuit(RUN36 + 8_700);
const TERCERO_2 = syntheticCuit(RUN36 + 8_701);
const TERCERO_3 = syntheticCuit(RUN36 + 8_702);

const COMPROBANTE_DE_B = `comprobante-del-cliente-b-${SUFFIX}.pdf`;
const COMPROBANTE_DE_TERCEROS = `comprobante-de-terceros-${SUFFIX}.pdf`;

/** PDF mínimo con los marcadores que lee el servicio de IA de prueba. */
function comprobante(etiqueta: string, emisor: string, receptor: string) {
  return Buffer.from(
    `%PDF-1.4\n% comprobante sintético E2E ${SUFFIX} ${etiqueta}\nCUIT_EMISOR=${emisor}\nCUIT_RECEPTOR=${receptor}\nTOTAL=121000.00\n%%EOF\n`,
    "utf-8",
  );
}

/** Pedido documental con un ítem, para que la Bandeja acepte la carga del cliente activo. */
async function crearPedido(page: Page, titulo: string) {
  await goTo(page, "Trabajo");
  await expect(page.getByRole("heading", { name: "Trabajo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pedir documentación", exact: true }).click();
  await page.locator("#request-title").fill(titulo);
  await page.locator("#request-item").fill("Comprobante de compra del mes");
  await mutating(page, "/document-requests", () =>
    page.locator(".action-drawer").getByRole("button", { name: "Crear pedido", exact: true }).click(),
  );
  await page.locator(".action-drawer").getByRole("button", { name: "Cerrar", exact: true }).click().catch(() => undefined);
}

/** Cambia el cliente en el que se trabaja (menú de contexto del estudio). */
async function cambiarCliente(page: Page, cliente: ClienteRI) {
  await pickOption(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" }), cliente.legalName);
  await expect(page.getByRole("combobox", { name: "Cliente en el que estás trabajando" })).toHaveValue(
    new RegExp(cliente.legalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
}

/** Sube un comprobante a la Bandeja del cliente activo, vinculado al primer ítem pendiente. */
async function subirComprobante(page: Page, archivo: { name: string; buffer: Buffer }) {
  await goTo(page, "Bandeja documental");
  await page.getByRole("button", { name: "Subir documento" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: archivo.name, mimeType: "application/pdf", buffer: archivo.buffer });
  await expect(page.locator("#upload-request-item")).toBeVisible();
  await pickOption(page.locator("#upload-request-item"), "Comprobante de compra del mes");
  await mutating(page, "/complete", () => page.getByRole("button", { name: "Subir y procesar" }).click());
  await page.locator(".action-drawer").getByRole("button", { name: "Cerrar", exact: true }).click();
}

/** Espera el comprobante recién subido en la Bandeja y su control de CUIT. La subida lo deja seleccionado y la
 *  lista conserva esa selección al refrescarse: el spec no vuelve a abrir la fila. */
async function esperarComprobanteSeleccionado(page: Page, nombre: string) {
  const fila = page.getByRole("row", { name: new RegExp(nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
  await expect(fila).toBeVisible({ timeout: 30_000 });
  await expect(fila, `«${nombre}» seleccionado tras subirlo`).toHaveAttribute("aria-current", "true", { timeout: 60_000 });
  await expect(page.locator('section[aria-label="Control de CUIT"]').first(), `control de CUIT de «${nombre}»`).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Procesando comprobante")).toHaveCount(0, { timeout: 120_000 });
}

test("control de CUIT en la Bandeja: CUIT de otro cliente, mover a otro cliente del estudio y aceptar con motivo", async ({ page }) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);

  const errores: string[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    if (!response.url().includes("/api/v1/")) return;
    if (response.status() >= 400) errores.push(`${request.method()} ${response.url()} → ${response.status()}`);
  });

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Clientes A y B del estudio, con su configuración fiscal mínima (perfil activo)", async () => {
    await altaClienteRI(page, CLIENTE_A);
    await altaClienteRI(page, CLIENTE_B);
  });

  await test.step("Cliente A: dos pedidos documentales para recibir un comprobante cada uno", async () => {
    await cambiarCliente(page, CLIENTE_A);
    await crearPedido(page, `Compras de A (${SUFFIX}) 1`);
    await crearPedido(page, `Compras de A (${SUFFIX}) 2`);
  });

  await test.step("Bandeja de A: comprobante del CUIT de B → «CUIT de otro cliente», Aprobar bloqueado y «Mover a» B", async () => {
    await subirComprobante(page, { name: COMPROBANTE_DE_B, buffer: comprobante("de B", CLIENTE_B.cuit, TERCERO_1) });
    await esperarComprobanteSeleccionado(page, COMPROBANTE_DE_B);
    const control = page.locator('section[aria-label="Control de CUIT"]');
    await expect(control.getByText("CUIT de otro cliente")).toBeVisible();
    await expect(control.getByText(new RegExp(`corresponde a ${CLIENTE_B.legalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprobar extracción", exact: true })).toBeDisabled();
    await expect(control.getByRole("button", { name: `Mover a ${CLIENTE_B.legalName}` })).toBeVisible();
  });

  await test.step("Mover a B: el comprobante sale de la Bandeja de A y aparece en la de B", async () => {
    const control = page.locator('section[aria-label="Control de CUIT"]');
    await mutating(page, "/cuit/move", () => control.getByRole("button", { name: `Mover a ${CLIENTE_B.legalName}` }).click());
    await goTo(page, "Bandeja documental");
    await expect(page.getByRole("row", { name: new RegExp(COMPROBANTE_DE_B) })).toHaveCount(0);

    await cambiarCliente(page, CLIENTE_B);
    await goTo(page, "Bandeja documental");
    await expect(page.getByRole("row", { name: new RegExp(COMPROBANTE_DE_B) }).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step("Bandeja de A: comprobante de terceros → «CUIT de otro cliente», se acepta con motivo y queda aprobable", async () => {
    await cambiarCliente(page, CLIENTE_A);
    await subirComprobante(page, { name: COMPROBANTE_DE_TERCEROS, buffer: comprobante("de terceros", TERCERO_2, TERCERO_3) });
    await esperarComprobanteSeleccionado(page, COMPROBANTE_DE_TERCEROS);
    const control = page.locator('section[aria-label="Control de CUIT"]');
    await expect(control.getByText("CUIT de otro cliente")).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprobar extracción", exact: true })).toBeDisabled();
    await expect(control.getByRole("button", { name: /^Mover a / })).toHaveCount(0);

    await control.getByLabel("Motivo para aceptar el CUIT").fill(`E2E ${SUFFIX}: comprobante a nombre de un tercero autorizado.`);
    await mutating(page, "/cuit/accept", () => control.getByRole("button", { name: "Aceptar con motivo", exact: true }).click());
    await expect(page.getByText(/CUIT aceptado con motivo/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprobar extracción", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "Aprobar extracción", exact: true }).click();
    await mutating(page, "/approve", () => page.getByRole("button", { name: "Aprobar extracción", exact: true }).last().click());
    await expect(page.getByText("Extracción revisada").first()).toBeVisible();
  });

  test.info().annotations.push({ type: "errores de mutación", description: errores.join(" | ") || "ninguno" });
  expect(errores, "ninguna mutación de la API respondió con error").toEqual([]);
});
