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
 * Controles de «no corresponde al perfil» (corte 4B) en un Responsable Inscripto, operados como los opera el contador.
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
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 8_000),
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

test("controles de perfil de un Responsable Inscripto: aceptar un grupo y excluir el otro, y el cierre avanza", async ({
  page,
}) => {
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
    const motivos = panel.getByRole("textbox", { name: /^Motivo / });
    await expect(motivos, "grupos de perfil abiertos").toHaveCount(2, { timeout: 20_000 });
    await expect(panel.getByText("Facturas C: 2 comprobantes")).toBeVisible();

    const controlAbierto = () =>
      panel.locator(".workpaper-control").filter({ has: page.getByRole("textbox", { name: /^Motivo / }) }).first();

    const primero = controlAbierto();
    await primero.getByRole("textbox", { name: /^Motivo / }).fill(MOTIVO_ACEPTAR);
    await mutating(page, "/profile-groups/", () => primero.getByRole("button", { name: "Aceptar con motivo", exact: true }).click());

    const segundo = controlAbierto();
    await segundo.getByRole("textbox", { name: /^Motivo / }).fill(MOTIVO_EXCLUIR);
    await mutating(page, "/profile-groups/", () => segundo.getByRole("button", { name: "Excluir del cálculo", exact: true }).click());

    // Ambos grupos resueltos: no quedan campos de motivo, ni la leyenda de bloqueo del perfil, y cada control figura «Resuelto».
    await expect(motivos, "no quedan grupos de perfil abiertos").toHaveCount(0);
    await expect(panel.getByText("No quedan comprobantes pendientes en ese grupo")).toHaveCount(0);
    const controlesDePerfil = panel.locator(".workpaper-control").filter({ hasText: "No corresponde al perfil del cliente" });
    await expect(controlesDePerfil).toHaveCount(2);
    await expect(controlesDePerfil.nth(0)).toContainText("Resuelto");
    await expect(controlesDePerfil.nth(1)).toContainText("Resuelto");
  });

  await test.step("Recalcular con los grupos resueltos: la NC excluida no entra en la base; 90.000 × 3,5 % = 3.150,00", async () => {
    await calcularIIBB(page);
    await esperarImporte(page, "3.150,00");
  });

  await test.step("Controles automáticos: acreditaciones bancarias y caja, resueltas con motivo", async () => {
    await page.getByRole("tab", { name: /^Controles/ }).click();
    const panel = page.locator(".work-page").first();
    for (const nombre of ["Acreditaciones bancarias vs. facturación", "Caja e imputaciones del período"]) {
      const abiertos = panel
        .locator(".workpaper-control")
        .filter({ hasText: nombre })
        .filter({ has: page.getByRole("textbox", { name: /^Resolución / }) });
      for (let intento = 0; intento < 4 && (await abiertos.count()) > 0; intento++) {
        const control = abiertos.first();
        await control.getByRole("textbox", { name: /^Resolución / }).fill(MOTIVO_CONTROL);
        await mutating(page, "/resolve", () => control.getByRole("button", { name: "Resolver", exact: true }).click());
        await expect(control.getByRole("button", { name: "Resolver", exact: true })).toHaveCount(0);
      }
      await expect(abiertos, `«${nombre}» sin abiertos`).toHaveCount(0);
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
