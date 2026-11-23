import { expect, test } from "@playwright/test";
import { RUN, SUFFIX, login, mutating, syntheticCuit } from "./helpers/ui";
import {
  activarAutorrevision,
  altaClienteRI,
  abrirLegajo,
  cargarLibroVentas,
  calcularIIBB,
  crearPeriodoIIBB,
  esperarImporte,
  inscribirIIBB,
  irAlLegajo,
  revisarLotesDe,
  rotuloDelPeriodo,
  vincularActividad,
  IIBB,
} from "./helpers/liquidacion-ui";
import type { FacturaSintetica } from "./helpers/fuentes-sinteticas";

/**
 * Recorrido de Controles con cola, panel compartible, resolución, actividad y foco devuelto.
 *
 *   1. Cliente Responsable Inscripto en Tucumán, IIBB con actividad de restaurante y período de octubre de 2026.
 *   2. Libro de ventas de octubre con 2 Facturas C (códigos 11) y 1 Nota de Crédito C (código 13). El perfil RI
 *      no las admite por defecto: el Legajo abre dos controles bloqueantes, uno por grupo.
 *   3. Se revisa el lote, se calcula y se abre Controles: un grupo se acepta con motivo y el otro se excluye del cálculo.
 *   4. Ambos grupos quedan resueltos (desaparecen los campos de motivo y el control queda «Resuelto») y el cierre
 *      avanza: el Paso 1 (Finalizar) deja de estar bloqueado por los controles de perfil.
 *
 * Todo sintético y con el sufijo de la corrida. Solo se opera por la interfaz (login, menús, formularios, botones).
 * Los importes de las facturas se suman a mano: 50.000 + 40.000 = 90.000 de facturas C; la NC resta 10.000 (no
 * entra en este spec el importe del cálculo: lo que se verifica es que los grupos se resuelven y el cierre avanza).
 */

const CLIENTE = {
  legalName: `Cliente E2E Controles Perfil ${SUFFIX} S.R.L.`,
  tradeName: `E2E Controles Perfil ${SUFFIX}`,
  // Offset 11_000: libre entre los syntheticCuit(RUN + n) de e2e/ (máximo previo 10_000); cada spec usa su rango para no repetir CUIT en la firma.
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 15_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const OCTUBRE = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026", label: `Octubre 2026 IIBB ${SUFFIX}` };
const MOTIVO_ACEPTAR = `E2E ${SUFFIX}: el cliente informó que emite las facturas C en el período; se acepta con motivo.`;
const MOTIVO_EXCLUIR = `E2E ${SUFFIX}: la nota de crédito C se excluye del cálculo hasta que el estudio la confirme.`;
const MOTIVO_CONTROL = `E2E ${SUFFIX}: extracto bancario sintético no aportado en la corrida; se resuelve con motivo y queda registrado.`;

/** Facturas C (código 11) y nota de crédito C (código 13), todas sintéticas. */
const COMPROBANTES_C: FacturaSintetica[] = [
  {
    fecha: "2026-10-05",
    tipo: "11",
    numero: "1",
    docTipo: "80",
    docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 9_001),
    denominacion: "Comensal E2E C1",
    neto: "50000.00",
    iva: "0.00",
  },
  {
    fecha: "2026-10-12",
    tipo: "11",
    numero: "2",
    docTipo: "80",
    docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 9_002),
    denominacion: "Comensal E2E C2",
    neto: "40000.00",
    iva: "0.00",
  },
  {
    fecha: "2026-10-20",
    tipo: "13",
    numero: "3",
    docTipo: "80",
    docNumero: syntheticCuit(Number.parseInt(RUN, 36) + 9_003),
    denominacion: "Comensal E2E NC3",
    neto: "10000.00",
    iva: "0.00",
  },
];

test("cola de Controles: resolver desde el Legajo y revisar Actividad en el panel lateral", async ({ page }, testInfo) => {
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

  await test.step("Clientes y configuración fiscal: RI en Tucumán, IIBB con actividad de restaurante y período de octubre", async () => {
    await altaClienteRI(page, CLIENTE);
    await inscribirIIBB(page);
    await vincularActividad(page, IIBB.activity);
    await crearPeriodoIIBB(page, OCTUBRE);
  });

  const rotulo = rotuloDelPeriodo(OCTUBRE.mes, OCTUBRE.label);

  await test.step("Legajo de octubre: libro de ventas con 2 Facturas C y 1 Nota de Crédito C", async () => {
    await abrirLegajo(page, rotulo);
    const { libro } = await cargarLibroVentas(page, COMPROBANTES_C, `ventas-c-${SUFFIX}.xlsx`);
    await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
    await expect(page.getByRole("dialog", { name: "Importar libros IVA" })).toBeHidden({ timeout: 60_000 });
  });

  await test.step("Revisión del lote y cálculo: el Legajo abre los controles de perfil", async () => {
    await activarAutorrevision(page);
    await irAlLegajo(page, rotulo);
    await revisarLotesDe(page, "Gestionar Ventas del período");
    await calcularIIBB(page);
  });

  await test.step("Controles: aceptar un grupo con motivo y excluir el otro del cálculo", async () => {
    await page.getByRole("tab", { name: /^Controles/ }).click();
    const panel = page.locator(".work-page").first();
    const commentsOpen = panel.getByRole("button", { name: /^Comentarios del mes \(\d+\) · Abrir$/ });
    await expect(commentsOpen).toBeVisible();
    await commentsOpen.click();
    await expect(panel.getByLabel("Escribí un comentario")).toBeVisible();
    await panel.getByRole("button", { name: /^Comentarios del mes \(\d+\) · Cerrar$/ }).click();
    const openQueue = panel.getByRole("list", { name: "Controles abiertos" });
    const openItems = openQueue.getByRole("listitem");
    const rowFacturas = openQueue.getByRole("listitem").filter({ hasText: "Facturas C" });
    await expect(rowFacturas).toContainText("2 comprobantes");
    await expect(rowFacturas).toContainText("Los comprobantes no corresponden al perfil fiscal del cliente.");
    await expect(rowFacturas).toContainText("Bloqueante");
    const openCountBefore = await openItems.count();
    await expect(rowFacturas).toHaveCount(1);
    const rowNotas = openQueue.getByRole("listitem").filter({ hasText: "Notas de crédito y débito C" });
    await expect(rowNotas).toContainText("1 comprobante");
    await expect(panel.getByText("Tipo no reconocido")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("controles-cola-1440x900.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: testInfo.outputPath("controles-cola-1280x720.png") });

    await rowFacturas.getByRole("button", { name: /Abrir/ }).click();
    const firstDrawer = page.getByRole("dialog");
    await expect(page).toHaveURL(/panel=control-/);
    await expect(firstDrawer.getByRole("list", { name: "Comprobantes afectados" })).toBeVisible();
    await expect(firstDrawer.getByText("C · 0001-00000001")).toBeVisible();
    await expect(firstDrawer.getByText("C · 0001-00000002")).toBeVisible();
    await expect(firstDrawer.getByRole("button", { name: "Abrir en Clasificación" })).toHaveCount(2);
    await expect(firstDrawer.getByText("Sin actividad todavía")).toBeVisible();
    await expect(firstDrawer.getByLabel("Motivo")).toHaveCount(0);
    await expect(firstDrawer.getByText("Falta escribir el motivo.", { exact: true })).toHaveCount(0);
    await firstDrawer.getByRole("button", { name: "Aceptar con motivo", exact: true }).click();
    await expect(firstDrawer.getByLabel("Motivo")).toBeVisible();
    await expect(firstDrawer.getByRole("button", { name: "Confirmar aceptación" })).toBeDisabled();
    await expect(firstDrawer.getByText("Falta escribir el motivo.", { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(firstDrawer.getByText("C · 0001-00000001")).toBeInViewport();
    await expect(firstDrawer.getByText("C · 0001-00000002")).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("control-panel-1440x900.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(firstDrawer.getByText("C · 0001-00000001")).toBeInViewport();
    await expect(firstDrawer.getByText("C · 0001-00000002")).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("control-panel-1280x720.png") });
    await firstDrawer.getByLabel("Motivo").fill(MOTIVO_ACEPTAR);
    await expect(firstDrawer.getByRole("button", { name: "Confirmar aceptación" })).toBeEnabled();
    await mutating(page, "/profile-groups/", () => firstDrawer.getByRole("button", { name: "Confirmar aceptación" }).click());
    await expect(firstDrawer).toBeHidden();

    await expect(openItems).toHaveCount(openCountBefore - 1);
    await expect(openQueue.getByRole("button", { name: /Abrir Facturas C/ })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Resueltos (3)" })).toBeVisible();
    await panel.getByRole("button", { name: "Resueltos (3)" }).click();
    const resolvedQueue = panel.getByRole("list", { name: "Controles resueltos" });
    const resolvedRow = resolvedQueue.getByRole("listitem").filter({ hasText: "Facturas C" });
    await expect(resolvedRow).toContainText("Resuelto");
    const resolvedButton = resolvedRow.getByRole("button", { name: /Abrir/ });
    await resolvedButton.click();
    const resolvedDrawer = page.getByRole("dialog");
    await expect(resolvedDrawer.getByRole("heading", { name: "Actividad del control" })).toBeVisible();
    await expect(resolvedDrawer.getByText(/Resuelto con motivo: los comprobantes del grupo/)).toBeVisible();
    await expect(resolvedDrawer.getByText(/Usuario que resolvió: .+ · /)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(resolvedDrawer).toBeHidden();
    await expect(resolvedButton).toBeFocused();

    await panel.getByRole("button", { name: /Abiertos \(3\)/ }).click();
    await panel.getByRole("list", { name: "Controles abiertos" }).getByRole("listitem").filter({ hasText: "Notas de crédito y débito C" }).getByRole("button", { name: /Abrir/ }).click();
    const secondDrawer = page.getByRole("dialog");
    await secondDrawer.getByRole("button", { name: "Excluir del cálculo con motivo", exact: true }).click();
    await expect(secondDrawer.getByLabel("Motivo")).toBeVisible();
    await expect(secondDrawer.getByRole("button", { name: "Confirmar exclusión" })).toBeDisabled();
    await secondDrawer.getByLabel("Motivo").fill(MOTIVO_EXCLUIR);
    await expect(secondDrawer.getByRole("button", { name: "Confirmar exclusión" })).toBeEnabled();
    await mutating(page, "/profile-groups/", () => secondDrawer.getByRole("button", { name: "Confirmar exclusión" }).click());
    await expect(secondDrawer).toBeHidden();
    await expect(openQueue.getByRole("button", { name: /Abrir Facturas C/ })).toHaveCount(0);
    await expect(openQueue.getByRole("button", { name: /Abrir Notas de crédito y débito C/ })).toHaveCount(0);
  });

  await test.step("Recalcular con los grupos resueltos: la NC excluida no entra en la base; 90.000 × 3,5 % = 3.150,00", async () => {
    await calcularIIBB(page);
    await esperarImporte(page, "3.150,00");
  });

  await test.step("Controles automáticos: acreditaciones bancarias y caja, resueltas con motivo", async () => {
    await page.getByRole("tab", { name: /^Controles/ }).click();
    for (const nombre of ["Acreditaciones bancarias vs. facturación", "Caja e imputaciones del período"]) {
      const queue = page.getByRole("list", { name: "Controles abiertos" });
      const row = queue.getByRole("listitem").filter({ hasText: nombre });
      await expect(row, `«${nombre}» aparece una sola vez en abiertos`).toHaveCount(1);
      await row.getByRole("button", { name: /Abrir/ }).click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByLabel("Motivo")).toHaveCount(0);
      await drawer.getByRole("button", { name: "Resolver", exact: true }).click();
      await drawer.getByLabel("Motivo").fill(MOTIVO_CONTROL);
      await expect(drawer.getByRole("button", { name: "Confirmar resolución" })).toBeEnabled();
      await mutating(page, "/resolve", () => drawer.getByRole("button", { name: "Confirmar resolución", exact: true }).click());
      await expect(drawer).toBeHidden();
      await expect(queue.getByRole("listitem").filter({ hasText: nombre }), `«${nombre}» no reaparece en abiertos`).toHaveCount(0);
    }
  });

  await test.step("Revisión: enviar a revisión y aprobar (autorrevisión activada)", async () => {
    await mutating(page, "/submit-review", () => page.getByRole("button", { name: "Enviar a revisión", exact: true }).click());
    await mutating(page, "/review", () => page.getByRole("button", { name: "Aprobar revisión", exact: true }).click());
  });

  await test.step("Cierre: el Paso 1 (Finalizar) deja de estar bloqueado por los controles de perfil", async () => {
    await page.getByRole("tab", { name: /^Cierre/ }).click();
    const pasos = page.getByRole("list", { name: "Pasos para cerrar el período" });
    await expect(pasos.getByRole("button", { name: "Finalizar", exact: true })).toBeEnabled({ timeout: 20_000 });
  });

  test.info().annotations.push({ type: "errores de mutación", description: errores.join(" | ") || "ninguno" });
  expect(errores, "ninguna mutación de la API respondió con error").toEqual([]);
});
