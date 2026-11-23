import { expect, test } from "@playwright/test";
import { RUN, SUFFIX, goTo, login, syntheticCuit } from "./helpers/ui";
import { altaClienteRI, crearPeriodoIIBB, inscribirIIBB, pick, vincularActividad, IIBB } from "./helpers/liquidacion-ui";

/**
 * Un solo estado de la configuración fiscal (D4), operado como lo opera el contador: se completa la configuración de
 * un Responsable Inscripto en Tucumán y el Resumen del cliente muestra el mismo estado que Configuración fiscal.
 *
 *   1. Alta del cliente, perfil fiscal activo, IIBB con actividad de restaurante y período de octubre con obligación.
 *   2. Configuración fiscal → Resumen: «Configuración completa».
 *   3. Resumen del cliente: «Configuración fiscal» muestra «Completado» (no «Pendiente»).
 *
 * Todo sintético y con el sufijo de la corrida. Solo se opera por la interfaz.
 */

const CLIENTE = {
  legalName: `Cliente E2E Estado ${SUFFIX} S.R.L.`,
  tradeName: `E2E Estado ${SUFFIX}`,
  cuit: syntheticCuit(Number.parseInt(RUN, 36) + 12_000),
  fiscalAddress: "Av. Mate de Luna 1500, San Miguel de Tucumán",
};
const OCTUBRE = { start: "2026-10-01", end: "2026-10-31", mes: "Octubre de 2026", label: `Octubre 2026 IIBB ${SUFFIX}` };

test("el Resumen del cliente muestra la misma configuración fiscal completa que Configuración fiscal", async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);

  await test.step("Ingresar como Titular", () => login(page));

  await test.step("Configuración fiscal completa: perfil activo, IIBB con actividad y período de octubre con obligación", async () => {
    await altaClienteRI(page, CLIENTE);
    await inscribirIIBB(page);
    await vincularActividad(page, IIBB.activity);
    await crearPeriodoIIBB(page, OCTUBRE);
    await page.getByRole("tab", { name: "Resumen", exact: true }).click();
    await expect(page.getByText("Configuración completa")).toBeVisible();
  });

  await test.step("Resumen del cliente: la configuración fiscal figura completa, como en Configuración fiscal", async () => {
    await goTo(page, "Resumen");
    const fila = page.locator(".client-summary__overview-facts > div").filter({ hasText: "Configuración fiscal" });
    await expect(fila, "dato «Configuración fiscal» del Resumen").toContainText("Completado", { timeout: 15_000 });
    await expect(fila).not.toContainText("Pendiente");
    await expect(page.locator(".client-summary__overview-status")).toContainText("Activo");
    await expect(page.locator(".client-summary__overview-status")).not.toContainText("En configuración");
    const encabezado = `${CLIENTE.legalName} · ${CLIENTE.tradeName} · CUIT ${CLIENTE.cuit.slice(0, 2)}-${CLIENTE.cuit.slice(2, 10)}-${CLIENTE.cuit.slice(10)}`;
    await expect(page.getByText(encabezado, { exact: true })).toBeVisible();
  });

  await test.step("La lista de Clientes también muestra el estado persistido", async () => {
    await goTo(page, "Clientes");
    const filaCliente = page.getByRole("row").filter({ hasText: CLIENTE.legalName });
    await expect(filaCliente).toContainText("Activo");
    await expect(filaCliente).not.toContainText("En configuración");
  });

  await test.step("Norma contable opcional (A57): ni el detalle de la ficha ni el Resumen la cuentan como faltante", async () => {
    const fila = page.getByRole("row").filter({ hasText: CLIENTE.legalName });
    await fila.getByRole("button", { name: CLIENTE.legalName, exact: true }).click();
    await expect(page.getByText(/falta[^.]*norma contable/i)).toHaveCount(0);

    await goTo(page, "Resumen");
    await pick(page.getByRole("combobox", { name: "Sección del cliente" }), "Ficha contable");
    await expect(page.getByText("Sin norma contable", { exact: true })).toBeVisible();
    await expect(page.getByText(/falta[^.]*norma contable/i)).toHaveCount(0);
  });
});
