import { expect, test, type Page } from "@playwright/test";
import { RUN, SUFFIX, login, mutating, syntheticCuit } from "./helpers/ui";
import {
  IIBB,
  abrirLegajo,
  activarAutorrevision,
  altaClienteRI,
  cargarLibroVentas,
  calcularIIBB,
  clasificarListo,
  crearPeriodoIIBB,
  esperarImporte,
  inscribirIIBB,
  irAlLegajo,
  pick,
  revisarLotesDe,
  rotuloDelPeriodo,
  vincularActividad,
} from "./helpers/liquidacion-ui";
import { type FacturaSintetica } from "./helpers/fuentes-sinteticas";

/**
 * Cambio de actividad desde un mes: el contador registra que desde octubre de 2026 el cliente pasa de
 * «Restaurante y bares (Tucumán)» (IIBB 3,5 %) a «Comercio» (IIBB 4 %). Se opera desde la interfaz.
 *
 *   1. Alta del cliente con IIBB e inscripción, y actividad de restaurante vinculada desde el alta (sin fecha).
 *   2. Registrar cambio de actividad: Comercio desde el mes de octubre de 2026.
 *   3. Períodos de septiembre y octubre de 2026, cada uno con su legajo, su libro de ventas (115.000 neto)
 *      revisado por el Titular.
 *   4. Septiembre usa la actividad anterior: 115.000 × 3,5 % = 4.025,00.
 *   5. Octubre muestra el aviso del cambio en Clasificación y calcula con Comercio: 115.000 × 4 % = 4.600,00.
 *
 * Todo sintético y con el sufijo de la corrida. Importes calculados a mano en este archivo.
 */

const CLIENTE = {
  legalName: `Cliente E2E Cambio ${SUFFIX} S.R.L.`,
  tradeName: `E2E Cambio ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 7_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const ACTIVIDAD_NUEVA = "Comercio";
const SEPTIEMBRE = { start: "2026-09-01", end: "2026-09-30", mes: "Septiembre de 2026", label: `Septiembre 2026 IIBB ${SUFFIX}` };
const OCTUBRE = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026", label: `Octubre 2026 IIBB ${SUFFIX}` };

/** Tres facturas A por 115.000 neto (50.000 + 40.000 + 25.000), con fechas del mes indicado. */
function facturasDelMes(mes: "09" | "10", base: number): FacturaSintetica[] {
  return [
    { fecha: `2026-${mes}-05`, tipo: "1", numero: `${base}1`, docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + base * 10 + 1), denominacion: `Comensal E2E ${mes}-1`, neto: "50000.00", iva: "10500.00" },
    { fecha: `2026-${mes}-12`, tipo: "1", numero: `${base}2`, docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + base * 10 + 2), denominacion: `Comensal E2E ${mes}-2`, neto: "40000.00", iva: "8400.00" },
    { fecha: `2026-${mes}-20`, tipo: "1", numero: `${base}3`, docTipo: "80", docNumero: syntheticCuit(Number.parseInt(RUN, 36) + base * 10 + 3), denominacion: `Comensal E2E ${mes}-3`, neto: "25000.00", iva: "5250.00" },
  ];
}

/** Libro de ventas del mes, importado y revisado por el Titular desde el Legajo de ese mes (lo crea si no existe). */
async function libroDelMesRevisado(page: Page, rotulo: string, facturas: FacturaSintetica[], nombre: string) {
  await abrirLegajo(page, rotulo);
  await page.getByRole("tab", { name: /Fuentes/ }).first().click();
  const { libro } = await cargarLibroVentas(page, facturas, nombre);
  await mutating(page, "/sifere/import", () => libro.getByRole("button", { name: "Importar", exact: true }).click());
  await expect(page.getByRole("dialog", { name: "Importar libro de ventas" })).toBeHidden({ timeout: 60_000 });
  await revisarLotesDe(page, "Gestionar Ventas del período");
}

test("cambio de actividad desde un mes: el legajo avisa y calcula con la actividad de cada mes", async ({ page }) => {
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

  await test.step("Alta del cliente con IIBB y actividad de restaurante (sin fecha: vale desde el alta)", async () => {
    await altaClienteRI(page, CLIENTE);
    await inscribirIIBB(page);
    await vincularActividad(page, IIBB.activity);
    await expect(page.locator("#act-from")).toHaveCount(0);
  });

  await test.step("Registrar cambio de actividad: Comercio desde octubre de 2026", async () => {
    await page.getByRole("tab", { name: /^Actividades/ }).click();
    await page.getByRole("button", { name: "Registrar cambio de actividad", exact: true }).click();
    const cajon = page.locator(".action-drawer");
    await pick(page.locator("#cambio-actividad-nueva"), ACTIVIDAD_NUEVA);
    await page.locator("#cambio-actividad-desde").fill(OCTUBRE.start);
    await page.locator("#cambio-actividad-motivo").fill(`E2E ${SUFFIX}: cambio de rubro del cliente`);
    await mutating(page, "/activities", () => cajon.getByRole("button", { name: "Registrar cambio", exact: true }).click());
    await expect(cajon).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(/Desde .* rige .*cambio de actividad/).first()).toBeVisible();
  });

  await test.step("Períodos de septiembre y octubre de 2026 con su obligación de IIBB", async () => {
    await page.getByRole("tab", { name: /^Períodos y obligaciones/ }).click();
    await crearPeriodoIIBB(page, SEPTIEMBRE);
    await crearPeriodoIIBB(page, OCTUBRE);
    await page.getByRole("tab", { name: "Resumen", exact: true }).click();
    await expect(page.getByText("Configuración completa")).toBeVisible();
  });

  await test.step("Legajos de septiembre y octubre: libro de ventas de cada mes, revisado por el Titular", async () => {
    await activarAutorrevision(page);
    const rotuloSept = rotuloDelPeriodo(SEPTIEMBRE.mes, SEPTIEMBRE.label);
    const rotuloOct = rotuloDelPeriodo(OCTUBRE.mes, OCTUBRE.label);
    await libroDelMesRevisado(page, rotuloSept, facturasDelMes("09", 3), `ventas-sept-${SUFFIX}.xlsx`);
    await libroDelMesRevisado(page, rotuloOct, facturasDelMes("10", 4), `ventas-oct-${SUFFIX}.xlsx`);
  });

  await test.step("Septiembre usa la actividad anterior: 115.000 × 3,5 % = 4.025,00", async () => {
    await irAlLegajo(page, rotuloDelPeriodo(SEPTIEMBRE.mes, SEPTIEMBRE.label));
    await clasificarListo(page);
    await calcularIIBB(page);
    await esperarImporte(page, "4.025,00");
  });

  await test.step("Octubre: el aviso del cambio aparece en Clasificación y calcula con Comercio: 115.000 × 4 % = 4.600,00", async () => {
    await irAlLegajo(page, rotuloDelPeriodo(OCTUBRE.mes, OCTUBRE.label));
    await page.getByRole("tab", { name: /Clasificación/ }).click();
    await expect(page.getByText(/cambió la actividad de Restaurante y bares \(Tucumán\) a Comercio/).first()).toBeVisible({ timeout: 20_000 });
    await clasificarListo(page);
    await calcularIIBB(page);
    await esperarImporte(page, "4.600,00");
    await expect(page.locator(".work-page").first().getByText(/4\.025,00/)).toHaveCount(0);
  });

  test.info().annotations.push({ type: "errores de mutación", description: errores.join(" | ") || "ninguno" });
  expect(errores, "ninguna mutación de la API respondió con error").toEqual([]);
});
