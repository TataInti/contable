import { expect, test } from "@playwright/test";
import { RUN, SUFFIX, goTo, pickOption, seen, syntheticCuit } from "./helpers/ui";

/**
 * E2E de alta completa desde la interfaz: deja cargado todo lo que hace falta
 * para poder liquidar un impuesto a un cliente (cadena de requisitos de
 * docs/ux/hallazgos-recorrido.md), sin llamar a la API directamente.
 *
 *   Catálogos fiscales  → jurisdicción, organismo, régimen (familia + módulo), actividad
 *   Reglas fiscales     → paquete, primera versión, alícuota, activación
 *   Clientes            → alta del cliente
 *   Configuración fiscal → perfil (alta, revisión, activación), inscripción en el
 *                          régimen, actividad, período y obligación
 *   Verificación        → la configuración vigente refleja todo y la cadena está completa
 *
 * Todos los datos son sintéticos y llevan un sufijo único por corrida, así que
 * se puede repetir sin colisiones. Usa el impuesto IVA del catálogo de
 * referencia: el motor se resuelve por impuesto y jurisdicción, y un impuesto
 * nuevo no tendría motor para calcular.
 */

const data = {
  jurisdiction: { code: `E2E-N-${SUFFIX}`, name: `Nación E2E ${SUFFIX}` },
  authority: { code: `E2E-A-${SUFFIX}`, name: `Organismo E2E ${SUFFIX}` },
  regime: { code: `E2E-RI-${SUFFIX}`, name: `IVA RI E2E ${SUFFIX}` },
  activity: { code: `E2E-ACT-${SUFFIX}`, name: `Servicios E2E ${SUFFIX}` },
  pack: { code: `E2E-PACK-${SUFFIX}`, name: `Paquete IVA E2E ${SUFFIX}` },
  client: {
    legalName: `Cliente E2E Alta ${SUFFIX} S.A.`,
    tradeName: `E2E Alta ${SUFFIX}`,
    cuit: // Distinto del CUIT de los otros e2e: comparten RUN cuando corren en la misma tanda.
    syntheticCuit(Number.parseInt(RUN, 36) + 1_000),
    fiscalAddress: "Av. Siempre Viva 742, San Miguel de Tucumán",
  },
  validFrom: "2026-01-01",
  period: { start: "2026-10-01", end: "2026-10-31", label: `IVA Octubre 2026 E2E ${SUFFIX}`, dueDate: "2026-11-18" },
  rate: "21",
};

test("alta completa de parámetros para procesar un cliente, desde la UI", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(10_000);

  // Errores de red de la API durante todo el recorrido: cualquier 4xx/5xx de mutación es un fallo.
  const failedMutations: string[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    if (!response.url().includes("/api/v1/")) return;
    if (response.status() >= 400) failedMutations.push(`${request.method()} ${response.url()} → ${response.status()}`);
  });

  await test.step("Ingresar como Titular", async () => {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("demo@contable.local");
    await page.getByLabel("Contraseña").fill("demo1234");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Resumen operativo", exact: true })).toBeVisible();
  });

  // ───────────────────────── Catálogos fiscales ─────────────────────────
  await test.step("Catálogos: jurisdicción", async () => {
    await goTo(page, "Catálogos fiscales");
    await expect(page.getByRole("heading", { name: "Catálogos fiscales", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /^Jurisdicciones/ }).click();
    await page.getByRole("button", { name: "Nueva jurisdicción" }).click();
    await page.locator("#jurisdiction-code").fill(data.jurisdiction.code);
    await page.locator("#jurisdiction-name").fill(data.jurisdiction.name);
    await page.locator("#jurisdiction-kind").selectOption("NATIONAL");
    await page.getByRole("button", { name: "Crear jurisdicción", exact: true }).click();
    await expect(seen(page, data.jurisdiction.code)).toBeVisible();
  });

  await test.step("Catálogos: organismo recaudador", async () => {
    await page.getByRole("tab", { name: /^Organismos recaudadores/ }).click();
    await page.getByRole("button", { name: "Nuevo organismo" }).click();
    await page.locator("#authority-code").fill(data.authority.code);
    await page.locator("#authority-name").fill(data.authority.name);
    await pickOption(page.locator("#authority-jurisdiction"), data.jurisdiction.code);
    await page.getByRole("button", { name: "Crear organismo" }).click();
    await expect(seen(page, data.authority.code)).toBeVisible();
  });

  await test.step("Catálogos: régimen con familia de cálculo", async () => {
    await page.getByRole("tab", { name: /^Regímenes/ }).click();
    await page.getByRole("button", { name: "Nuevo régimen" }).click();
    await page.locator("#regime-code").fill(data.regime.code);
    await page.locator("#regime-name").fill(data.regime.name);
    await pickOption(page.locator("#regime-tax-type"), "(IVA)");
    // La familia se completa sola con la del impuesto; se verifica en vez de elegirla.
    await expect(page.locator("#regime-calc-family")).not.toHaveValue("");
    await pickOption(page.locator("#regime-module"), "IVA Responsable Inscripto");
    await pickOption(page.locator("#regime-jurisdiction"), data.jurisdiction.code);
    await pickOption(page.locator("#regime-authority"), data.authority.code);
    await page.getByRole("button", { name: "Crear régimen" }).click();
    await expect(seen(page, data.regime.code)).toBeVisible();
  });

  await test.step("Catálogos: actividad económica", async () => {
    await page.getByRole("tab", { name: /^Actividades/ }).click();
    await page.getByRole("button", { name: "Nueva actividad" }).click();
    await page.locator("#activity-code").fill(data.activity.code);
    await page.locator("#activity-name").fill(data.activity.name);
    await pickOption(page.locator("#activity-jurisdiction"), data.jurisdiction.code);
    await page.locator("#activity-valid-from").fill(data.validFrom);
    await page.getByRole("button", { name: /^Crear actividad|^Guardar|^Crear$/ }).first().click();
    await expect(seen(page, data.activity.code)).toBeVisible();
  });

  // ───────────────────────── Reglas fiscales ─────────────────────────
  await test.step("Reglas: paquete, primera versión, alícuota y activación", async () => {
    await goTo(page, "Reglas fiscales");
    await expect(page.getByRole("heading", { name: "Reglas fiscales", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Nuevo paquete" }).click();
    await page.locator("#new-rule-pack-code").fill(data.pack.code);
    await page.locator("#new-rule-pack-name").fill(data.pack.name);
    await pickOption(page.locator("#new-rule-pack-regime"), data.regime.name);
    await page.getByRole("button", { name: "Crear paquete" }).click();
    await expect(page.getByText("El paquete quedó creado")).toBeVisible();

    // El paquete recién creado queda seleccionado: abrir su primera versión.
    await page.getByRole("button", { name: /Crear primera versión/ }).first().click();
    await page.locator("#first-rule-version-valid-from").fill(data.validFrom);
    const engine = page.locator("#first-rule-version-engine");
    await expect(engine).toBeVisible();
    await pickOption(engine, "IVA RI por alícuota");
    await page.locator(".action-drawer").getByRole("button", { name: "Crear primera versión", exact: true }).click();

    // Alícuota general del IVA para la actividad sintética.
    await page.getByRole("button", { name: /Agregar regla/ }).click();
    const kind = page.locator('select[aria-label^="Tipo de regla"]').first();
    await pickOption(kind, "Alícuota");
    const activity = page.locator('select[aria-label^="Actividad"]').first();
    await pickOption(activity, data.activity.code);
    await page.locator('input[aria-label^="Alícuota"]').first().fill(data.rate);
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(seen(page, "Las reglas del borrador quedaron guardadas.")).toBeVisible();

    await page.getByRole("button", { name: "Activar", exact: true }).click();
    await page.getByRole("button", { name: "Activar versión" }).click();
    await expect(seen(page, "Vigente")).toBeVisible();
  });

  // ───────────────────────── Cliente ─────────────────────────
  await test.step("Clientes: alta del cliente", async () => {
    await goTo(page, "Clientes");
    await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Nuevo cliente/ }).first().click();
    await page.locator("#client-legal-name").fill(data.client.legalName);
    await page.locator("#client-trade-name").fill(data.client.tradeName);
    await page.locator("#client-cuit").fill(data.client.cuit);
    await page.locator("#client-vat-condition").selectOption({ index: 1 });
    await page.locator("#client-province").selectOption({ index: 1 });
    await page.locator("#client-legal-form").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Crear cliente" }).click();
    // Al crearlo, la app lo deja seleccionado y lleva a su configuración fiscal.
    await expect(page).toHaveURL(/\/configuracion-fiscal/);
    await expect(page.getByRole("combobox", { name: /^Cliente/ })).toHaveValue(/.+/);
    await expect(page.locator("#context-bar")).toContainText(data.client.legalName);
  });

  // ───────────────────────── Configuración fiscal ─────────────────────────
  await test.step("Configuración fiscal: perfil (crear, revisar, activar)", async () => {
    await expect(page.getByRole("heading", { name: "Configuración fiscal", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Crear perfil fiscal" }).first().click();
    await page.locator("#pf-legal-name").fill(data.client.legalName);
    await page.locator("#pf-cuit").fill(data.client.cuit);
    await page.locator("#pf-fiscal-address").fill(data.client.fiscalAddress);
    await page.locator("#pf-person-type").selectOption("JURIDICA");
    await page.locator("#pf-condition").selectOption("RESPONSABLE_INSCRIPTO");
    // La vigencia del perfil es también la de la inscripción: debe cubrir el período.
    await page.locator("#pf-valid-from").fill(data.validFrom);
    await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByRole("button", { name: "Activar perfil" }).click();
    await expect(page.getByRole("button", { name: "Crear nueva versión" })).toBeVisible();
  });

  await test.step("Configuración fiscal: inscripción en el régimen", async () => {
    await page.getByRole("button", { name: /Registrar inscripción|Completar inscripción/ }).first().click();
    await pickOption(page.locator("#reg-regime"), data.regime.code);
    await page.getByRole("button", { name: "Registrar inscripción", exact: true }).last().click();
    await expect(seen(page, data.regime.name)).toBeVisible();
  });

  await test.step("Configuración fiscal: actividad principal", async () => {
    await page.getByRole("button", { name: /Vincular actividad|Completar actividades/ }).first().click();
    await pickOption(page.locator("#act-activity"), data.activity.code);
    await page.getByRole("button", { name: "Vincular actividad", exact: true }).last().click();
    await expect(seen(page, data.activity.code)).toBeVisible();
  });

  await test.step("Configuración fiscal: período fiscal", async () => {
    await page.getByRole("button", { name: /Completar períodos|Agregar/ }).last().click();
    await pickOption(page.locator("#per-tax-type"), "(IVA)");
    await page.locator("#per-start").fill(data.period.start);
    await page.locator("#per-end").fill(data.period.end);
    await page.locator("#per-label").fill(data.period.label);
    await page.getByRole("button", { name: "Crear período" }).click();
  });

  await test.step("Configuración fiscal: obligación", async () => {
    // Al crear el período, el paso guiado pasa a Obligaciones (el panel se abre con el botón).
    await page.getByRole("button", { name: "Completar obligaciones" }).click();
    await expect(page.locator("#obl-period")).toBeVisible();
    await pickOption(page.locator("#obl-period"), data.period.label);
    await pickOption(page.locator("#obl-regime"), data.regime.name);
    await page.locator("#obl-due-date").fill(data.period.dueDate);
    await page.getByRole("button", { name: "Crear obligación", exact: true }).last().click();
    await expect(page.getByText("Configuración completa")).toBeVisible();
  });

  await test.step("Verificar: los cinco pasos quedan completos", async () => {
    const steps = page.getByRole("navigation", { name: "Pasos del onboarding fiscal" });
    await expect(steps.getByText("Pendiente")).toHaveCount(0);
    await expect(seen(page, data.regime.name)).toBeVisible();
    await expect(seen(page, data.activity.code)).toBeVisible();
  });

  await test.step("Verificar que el cliente se puede procesar: el servidor acepta calcular la liquidación", async () => {
    await goTo(page, "Liquidaciones");
    await expect(page.getByRole("heading", { name: "Liquidaciones", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Calcular liquidación" }).first().click();
    await pickOption(page.locator("#settlement-tax-period"), data.period.label);
    await pickOption(page.locator("#settlement-regime"), data.regime.name);
    await page.locator("#settlement-cutoff").fill(data.period.end);
    const calculated = page.waitForResponse(
      (response) => response.url().includes("/tax-settlements/calculate") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Calcular", exact: true }).click();
    const response = await calculated;
    // Los rechazos de la cadena de requisitos serían REGISTRATION_REQUIRED, NO_ACTIVE_RULES o
    // UNSUPPORTED_ENGINE_VERSION: ninguno debe aparecer.
    const body = await response.text();
    expect(body, `respuesta de calcular: ${response.status()} ${body}`).not.toMatch(
      /REGISTRATION_REQUIRED|NO_ACTIVE_RULES|UNSUPPORTED_ENGINE_VERSION/,
    );
    expect(response.status(), body).toBe(200);
  });

  expect(failedMutations, `mutaciones rechazadas:\n${failedMutations.join("\n")}`).toEqual([]);
});
