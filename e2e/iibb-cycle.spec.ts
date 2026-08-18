import { expect, test } from "@playwright/test";

/**
 * E2E vertical IIBB Tucumán local (Puerta 4, Fase 4.1).
 *
 * Ejecuta el ciclo tributario completo contra la API dev:
 *   importación DGR → voucher SALE con actividad → cálculo IIBB →
 *   revisión (maker-checker) → finalización → presentación → pago.
 *
 * Verifica que el motor IIBB produce el resultado esperado y que el flujo
 * de punta a punta persiste cada transición (no es una pantalla decorativa).
 */

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

test("ciclo IIBB Tucumán local de punta a punta (Fase 4.1)", async ({ request, playwright }) => {
  // 1. Login como demo (owner/preparador). El login setea cookies de sesión y
  // CSRF; el fixture `request` de Playwright las mantiene en el resto del test.
  const login = await request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { email: "demo@contable.local", password: "demo1234" },
  });
  expect(login.status()).toBe(200);

  // Header CSRF: las mutaciones exigen X-CSRF-Token (leído de la cookie).
  const state = await request.storageState();
  const csrfCookie = state.cookies.find((c) => c.name === "csrf_token");
  const csrf = csrfCookie ? decodeURIComponent(csrfCookie.value) : "";
  const headers = { "X-CSRF-Token": csrf };

  // Contexto del revisor (maker-checker: quien prepara no revisa ni finaliza).
  const reviewerCtx = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const reviewerLogin = await reviewerCtx.post("/api/v1/auth/login", {
    data: { email: "revisor@contable.local", password: "revisor1234" },
  });
  expect(reviewerLogin.status()).toBe(200);
  const reviewerState = await reviewerCtx.storageState();
  const reviewerCsrf = reviewerState.cookies.find((c) => c.name === "csrf_token");
  const reviewerHeaders = {
    "X-CSRF-Token": reviewerCsrf ? decodeURIComponent(reviewerCsrf.value) : "",
  };

  // 2. Contexto: firma demo + cliente.
  const me = await request.get(`${apiBaseUrl}/api/v1/me/contexts`);
  expect(me.status()).toBe(200);
  const meBody = (await me.json()) as {
    data: {
      firms: Array<{ firmId: string; clients: Array<{ clientId: string }> }>;
    };
  };
  const firm = meBody.data.firms[0];
  expect(firm).toBeTruthy();
  const client = firm.clients[0];
  expect(client).toBeTruthy();
  const firmId = firm.firmId;
  const clientId = client.clientId;

  // 3. Maestros IIBB (seedeados por seed-maestros-fiscales.ts): jurisdicción
  //    Tucumán, impuesto IIBB, régimen IIBB_LOCAL_TUC y pack AR_IIBB_TUC_LOCAL_V1
  //    ACTIVE. Se resuelven por código.
  const jurisdictionId = await resolveId(request, "/api/v1/tax/jurisdictions", "AR-T");
  const taxTypeId = await resolveId(request, "/api/v1/tax/types", "IIBB");
  const regimeId = await resolveId(request, "/api/v1/tax/regimes", "IIBB_LOCAL_TUC");

  // 4. Período + perfil + obligación.
  const period = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-periods`,
    { headers, data: { taxTypeId, startDate: "2026-01-01", endDate: "2026-01-31", label: "Enero 2026" } },
  );
  // Idempotente: si ya existe (409), se reutiliza el período de una
  // liquidación previa del cliente (la corrida anterior dejó fixtures).
  let periodId: string;
  if (period.status() === 201) {
    const periodBody = (await period.json()) as { data: { id: string } };
    periodId = periodBody.data.id;
  } else {
    const prev = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements`,
    );
    const body = (await prev.json()) as { data?: Array<{ periodId: string }> };
    const found = (body.data ?? [])[0];
    expect(found).toBeTruthy();
    periodId = found.periodId;
  }

  // Perfil fiscal (idempotente: reutiliza el primero si existe).
  const profile = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
    {
      headers,
      data: {
        legalName: "Cliente E2E IIBB",
        cuit: "20999999999",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: "2026-01-01",
      },
    },
  );
  const profileId = await resolveProfileId(request, firmId, clientId, profile.status());

  // Obligación IIBB (idempotente: si ya existe, se reutiliza).
  const obligation = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations`,
    {
      headers,
      data: { profileVersionId: profileId, regimeId, periodId, dueDate: "2026-02-20" },
    },
  );
  let obligationId: string;
  if (obligation.status() === 201) {
    const obligationBody = (await obligation.json()) as { data: { id: string } };
    obligationId = obligationBody.data.id;
  } else {
    const list = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations`,
    );
    const body = (await list.json()) as {
      data?: Array<{ id: string; regime: { id: string } }>;
    };
    const found = (body.data ?? []).find((o) => o.regime.id === regimeId);
    expect(found).toBeTruthy();
    obligationId = found!.id;
  }

  // 5. Importación DGR IIBB → voucher SALE con actividad.
  const batch = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/import-batches`,
    {
      headers,
      data: {
        origin: "DGR_IIBB",
        taxTypeId,
        periodId,
        adapterVersion: "DGR_IIBB_V1",
        fileHash: `sha256:e2e-iibb-${Date.now()}`,
      },
    },
  );
  expect(batch.status()).toBe(201);
  const batchBody = (await batch.json()) as { data: { id: string } };
  const batchId = batchBody.data.id;

  const validated = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/import-batches/${batchId}/validate`,
    {
      headers,
      data: {
        rows: [
          { activityCode: "COMERCIO", income: "100000.00", rate: "4" },
          { activityCode: "SERVICIOS", income: "50000.00", rate: "4.5" },
        ],
      },
    },
  );
  expect(validated.status()).toBe(200);

  const committed = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/import-batches/${batchId}/commit`,
    { headers, data: { clientCuit: "20999999999" } },
  );
  expect(committed.status()).toBe(200);

  // Aprobar los vouchers IIBB (el motor sólo calcula con hechos APPROVED).
  // El revisor aprueba (maker-checker: el demo creó los vouchers).
  const vouchers = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/vouchers`,
  );
  expect(vouchers.status()).toBe(200);
  const vouchersBody = (await vouchers.json()) as {
    data?: Array<{ id: string; status: string }>;
  };
  const pending = (vouchersBody.data ?? []).filter((v) => v.status === "DRAFT");
  for (const v of pending) {
    const reviewed = await reviewerCtx.post(
      `/api/v1/firms/${firmId}/clients/${clientId}/vouchers/${v.id}/review`,
      { headers: reviewerHeaders, data: { approve: true } },
    );
    expect(reviewed.status()).toBe(200);
  }

  // 6. Calcular IIBB. Si la corrida anterior ya finalizó la liquidación, el
//    recálculo da 409 (V-003 inmutable) y se reutiliza la existente finalizada.
  const calculated = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/calculate`,
    {
      headers,
      data: { taxTypeId, regimeId, jurisdictionId, periodId, cutoff: "2026-01-31" },
    },
  );
  let settlement: { id: string; status: string; totals: Record<string, string> };
  if (calculated.status() === 200) {
    const calcBody = (await calculated.json()) as {
      data: { settlement: { id: string; status: string; totals: Record<string, string> } };
    };
    settlement = calcBody.data.settlement;
    expect(settlement.status).toBe("CALCULATED");
    expect(settlement.totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("6250.00");
    expect(settlement.totals["TOTAL_A_INGRESAR"]).toBe("6250.00");
  } else {
    // Reutilizar la settlement existente (finalizada en una corrida previa).
    const prev = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements`,
    );
    const listBody = (await prev.json()) as {
      data?: Array<{ id: string; status: string; totals: Record<string, string> | null }>;
    };
    const existing = (listBody.data ?? []).find((s) => s.status === "FINALIZED");
    expect(existing).toBeTruthy();
    settlement = {
      id: existing!.id,
      status: existing!.status,
      totals: existing!.totals ?? {},
    };
    expect(settlement.totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("6250.00");
    expect(settlement.totals["TOTAL_A_INGRESAR"]).toBe("6250.00");
  }

  // 7. Revisión (maker-checker) y finalización (sólo si no está finalizada).
  if (settlement.status === "CALCULATED") {
    const submitted = await request.post(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/${settlement.id}/submit-review`,
      { headers },
    );
    expect(submitted.status()).toBe(200);

    const reviewed = await reviewerCtx.post(
      `/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/${settlement.id}/review`,
      { headers: reviewerHeaders },
    );
    expect(reviewed.status()).toBe(200);

    const finalized = await reviewerCtx.post(
      `/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/${settlement.id}/finalize`,
      { headers: reviewerHeaders },
    );
    expect(finalized.status()).toBe(200);
    const finalBody = (await finalized.json()) as { data: { status: string } };
    expect(finalBody.data.status).toBe("FINALIZED");
  }

  // 8. Presentación y pago.
  const filing = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations/${obligationId}/filings`,
    {
      headers,
      data: {
        settlementId: settlement.id,
        filedAt: "2026-02-05",
        amountFiled: "6250.00",
        externalId: "IIBB-E2E-001",
      },
    },
  );
  expect([201, 409]).toContain(filing.status());

  const payment = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations/${obligationId}/payments`,
    {
      headers,
      data: {
        settlementId: settlement.id,
        paidAt: "2026-02-10",
        amount: "6250.00",
        method: "TRANSFERENCIA",
      },
    },
  );
  expect([201, 409]).toContain(payment.status());

  // Verificar estado final de la obligación (PAID tras corridas previas o nuevas).
  const obligationCheck = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations`,
  );
  expect(obligationCheck.status()).toBe(200);
  const obBody = (await obligationCheck.json()) as {
    data?: Array<{ id: string; status: string }>;
  };
  const ob = (obBody.data ?? []).find((o) => o.id === obligationId);
  expect(ob).toBeTruthy();
  expect(["PAID", "PARTIALLY_PAID"]).toContain(ob!.status);
});

/** Resuelve el id de un perfil fiscal (crea o reutiliza el primero). */
async function resolveProfileId(
  request: import("@playwright/test").APIRequestContext,
  firmId: string,
  clientId: string,
  createStatus: number,
): Promise<string> {
  if (createStatus === 201) {
    const list = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
    );
    const body = (await list.json()) as { data?: Array<{ id: string }> };
    if (body.data && body.data.length > 0) return body.data[0].id;
  }
  const list = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
  );
  const body = (await list.json()) as { data?: Array<{ id: string }> };
  expect(body.data && body.data.length).toBeGreaterThan(0);
  return body.data![0].id;
}

/** Resuelve el id de un maestro por código. */
async function resolveId(
  request: import("@playwright/test").APIRequestContext,
  listPath: string,
  code: string,
): Promise<string> {
  const list = await request.get(`${apiBaseUrl}${listPath}`);
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { data?: Array<{ id: string; code: string }> };
  const items = body.data ?? [];
  const found = items.find((i) => i.code === code);
  expect(found).toBeTruthy();
  return found!.id;
}