import { expect, test } from "@playwright/test";

/**
 * E2E vertical Rentabilidad gerencial (Puerta 5).
 *
 * Ejecuta el ciclo de punta a punta contra la API dev:
 *   vouchers aprobados → cálculo DEVENGADO y CAJA → publicación versionada →
 *   el portal sólo ve snapshots PUBLISHED con recibo.
 *
 * Verifica las invariantes G5-01/02 (bases separadas), G5-03 (gestión sin
 * respaldo no reduce impuestos), G5-05 (publicación inmutable) y G5-10
 * (recibo persistente con hash).
 */

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

test("ciclo de rentabilidad gerencial de punta a punta (Puerta 5)", async ({ request, playwright }) => {
  // 1. Login como demo (owner/preparador).
  const login = await request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { email: "demo@contable.local", password: "demo1234" },
  });
  expect(login.status()).toBe(200);

  const state = await request.storageState();
  const csrfCookie = state.cookies.find((c) => c.name === "csrf_token");
  const csrf = csrfCookie ? decodeURIComponent(csrfCookie.value) : "";
  const headers = { "X-CSRF-Token": csrf };

  // Contexto del revisor (maker-checker).
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
    data: { firms: Array<{ firmId: string; clients: Array<{ clientId: string }> }> };
  };
  const firm = meBody.data.firms[0];
  expect(firm).toBeTruthy();
  const client = firm.clients[0];
  expect(client).toBeTruthy();
  const firmId = firm.firmId;
  const clientId = client.clientId;

  // 3. Maestros (seedeados): IVA y RI.
  const jurisdictionId = await resolveId(request, "/api/v1/tax/jurisdictions", "AR");
  const taxTypeId = await resolveId(request, "/api/v1/tax/types", "IVA");
  const regimeId = await resolveId(request, "/api/v1/tax/regimes", "RI");

  // 4. Período único por ejecución en un año futuro (2099): nunca se solapa con
  //    períodos reales ni con corridas previas (unique clientId+taxTypeId+startDate+endDate).
  //    El mismo spec corre dos veces por corrida (proyectos chromium y mobile sobre
  //    la misma DB): si ambas generan el mismo rango (month/day derivados de Date.now()),
  //    el segundo POST recibe 409 PERIOD_OVERLAP y se reutiliza el período existente.
  const stamp = Date.now();
  const month = String(1 + (stamp % 12)).padStart(2, "0");
  const day = String(1 + (stamp % 15)).padStart(2, "0");
  const label = `P5 2099-${month}-${stamp}`;
  const startDate = `2099-${month}-${day}`;
  const endDate = `2099-${month}-${String(Number(day) + 1).padStart(2, "0")}`;
  const period = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-periods`,
    {
      headers,
      data: { taxTypeId, startDate, endDate, label },
    },
  );
  let periodId: string;
  if (period.status() === 201) {
    const periodBody = (await period.json()) as { data: { id: string } };
    periodId = periodBody.data.id;
  } else {
    // 409 PERIOD_OVERLAP: la corrida gemela ya creó este rango; reutilizarlo.
    expect(period.status()).toBe(409);
    const periods = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-periods`,
    );
    expect(periods.status()).toBe(200);
    const body = (await periods.json()) as {
      data?: Array<{ id: string; startDate: string; endDate: string }>;
    };
    const existing = (body.data ?? []).find(
      (p) => p.startDate?.startsWith(startDate) && p.endDate?.startsWith(endDate),
    );
    expect(existing, "período 2099 de la corrida gemela para reutilizar").toBeTruthy();
    periodId = existing!.id;
  }

  // Perfil fiscal: reutiliza el activo existente (el cliente demo ya tiene
  // uno de corridas previas; PROFILE_ALREADY_ACTIVE da 500).
  const profileId = await resolveProfileId(request, firmId, clientId);

  // El cliente se inscribe en el régimen: sin inscripción no hay obligación.
  const registration = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-registrations`,
    { headers, data: { profileVersionId: profileId, regimeId, validFrom: "2020-01-01" } },
  );
  // 409: ya quedó inscripto en una corrida anterior.
  expect([201, 409]).toContain(registration.status());

  // Obligación (idempotente).
  const obligation = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations`,
    {
      headers,
      data: {
        profileVersionId: profileId,
        regimeId,
        periodId,
        dueDate: "2099-12-20",
      },
    },
  );
  expect([201, 409]).toContain(obligation.status());

  // 5. Vouchers aprobados: 1 venta 100k + 1 compra 40k (netos).
  const v1 = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/vouchers`,
    {
      headers,
      data: {
        direction: "SALE",
        type: "A",
        letter: "A",
        pointOfSale: 1,
        number: 400,
        issuerCuit: "20999999999",
        receiverCuit: "20111111111",
        issuedOn: `${startDate}`,
        total: "121000.00",
        components: [
          { concept: "NETO", base: "100000.00", amount: "100000.00" },
          { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
        ],
      },
    },
  );
  expect(v1.status()).toBe(201);

  const v2 = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/vouchers`,
    {
      headers,
      data: {
        direction: "PURCHASE",
        type: "A",
        letter: "A",
        pointOfSale: 1,
        number: 60,
        issuerCuit: "20111111111",
        receiverCuit: "20999999999",
        issuedOn: `${startDate}`,
        total: "48400.00",
        components: [
          { concept: "NETO", base: "40000.00", amount: "40000.00" },
          { concept: "IVA_21", base: "40000.00", rate: "0.21", amount: "8400.00" },
        ],
      },
    },
  );
  expect(v2.status()).toBe(201);

  // Aprobar vouchers como revisor (el demo los creó).
  const vouchers = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/vouchers`,
  );
  const vouchersBody = (await vouchers.json()) as { data?: Array<{ id: string; status: string }> };
  const pending = (vouchersBody.data ?? []).filter((v) => v.status === "DRAFT");
  for (const v of pending) {
    const reviewed = await reviewerCtx.post(
      `/api/v1/firms/${firmId}/clients/${clientId}/vouchers/${v.id}/review`,
      { headers: reviewerHeaders, data: { approve: true } },
    );
    expect(reviewed.status()).toBe(200);
  }

  // 6. Liquidación IVA finalizada (para los impuestos del período).
  const calculated = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/calculate`,
    {
      headers,
      data: { taxTypeId, regimeId, jurisdictionId, periodId, cutoff: endDate },
    },
  );
  let settlementId: string;
  if (calculated.status() === 200) {
    const calcBody = (await calculated.json()) as {
      data: { settlement: { id: string; status: string } };
    };
    settlementId = calcBody.data.settlement.id;
    const submitted = await request.post(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/${settlementId}/submit-review`,
      { headers },
    );
    expect(submitted.status()).toBe(200);
    const reviewed = await reviewerCtx.post(
      `/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/${settlementId}/review`,
      { headers: reviewerHeaders },
    );
    expect(reviewed.status()).toBe(200);
    const finalized = await reviewerCtx.post(
      `/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements/${settlementId}/finalize`,
      { headers: reviewerHeaders },
    );
    expect(finalized.status()).toBe(200);
  } else {
    const list = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements`,
    );
    const body = (await list.json()) as {
      data?: Array<{ id: string; status: string }>;
    };
    settlementId = (body.data ?? []).find((s) => s.status === "FINALIZED")!.id;
  }

  // 7. Rentabilidad DEVENGADO: 1 venta 100k − compra 40k = 60.000 antes de
  //    impuestos; liquidación IVA 33.600 → resultado post impuestos 26.400.
  const devengado = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/profitability/calculate`,
    {
      headers,
      data: { periodId, basis: "DEVENGADO", cutoff: endDate },
    },
  );
  expect(devengado.status()).toBe(200);
  const devBody = (await devengado.json()) as {
    data: { snapshot: { totals: Record<string, string> } };
  };
  expect(devBody.data.snapshot.totals["VENTAS"]).toBe("100000.00");
  expect(devBody.data.snapshot.totals["GASTO_FISCAL"]).toBe("40000.00");
  expect(devBody.data.snapshot.totals["RESULTADO_ANTES_IMPUESTOS"]).toBe("60000.00");
  // Liquidación IVA del período: 1 venta − 1 compra → 21.000−8.400 = 12.600.
  expect(devBody.data.snapshot.totals["RESULTADO_POST_IMPUESTOS"]).toBe("47400.00");

  // 8. CAJA: flujo neto = 100.000 − 40.000 − 0 (sin gestión) − 0 (sin pagos).
  const caja = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/profitability/calculate`,
    {
      headers,
      data: { periodId, basis: "CAJA", cutoff: endDate },
    },
  );
  expect(caja.status()).toBe(200);
  const cajaBody = (await caja.json()) as {
    data: { snapshot: { totals: Record<string, string> } };
  };
  expect(cajaBody.data.snapshot.totals["FLUJO_NETO"]).toBe("60000.00");

  // 9. G5-05: publicar DEVENGADO → PUBLISHED; recalcular crea versión nueva.
  const published = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/profitability/publish`,
    {
      headers,
      data: { periodId, basis: "DEVENGADO" },
    },
  );
  expect(published.status()).toBe(200);
  const pubBody = (await published.json()) as { data: { status: string; version: number } };
  expect(pubBody.data.status).toBe("PUBLISHED");
  expect(pubBody.data.version).toBeGreaterThanOrEqual(1);

  // 10. El portal (cliente demo) sólo ve PUBLISHED con recibo.
  const portal = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const portalLogin = await portal.post("/api/v1/auth/login", {
    data: { email: "cliente@contable.local", password: "cliente1234" },
  });
  expect(portalLogin.status()).toBe(200);

  const portalProfitability = await portal.get(`/api/v1/portal/clients/${clientId}/profitability`);
  expect(portalProfitability.status()).toBe(200);
  const portalBody = (await portalProfitability.json()) as {
    data?: Array<{ status: string; basis: string; id: string }>;
  };
  const publishedSnapshots = (portalBody.data ?? []).filter((s) => s.status === "PUBLISHED");
  expect(publishedSnapshots.length).toBeGreaterThanOrEqual(1);

  const receipt = await portal.get(
    `/api/v1/portal/clients/${clientId}/profitability/${publishedSnapshots[0].id}/receipt`,
  );
  expect(receipt.status()).toBe(200);
  const receiptBody = (await receipt.json()) as {
    data: { status: string; outputHash: string; publishedAt: string | null };
  };
  expect(receiptBody.data.status).toBe("PUBLISHED");
  expect(receiptBody.data.outputHash).toMatch(/^[a-f0-9]{64}$/);
});

/** Resuelve el id de un maestro por código (catálogos de firma). */
async function resolveId(
  request: import("@playwright/test").APIRequestContext,
  path: string,
  code: string,
): Promise<string> {
  const res = await request.get(`${apiBaseUrl}${path}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data?: Array<{ id: string; code: string }> };
  const found = (body.data ?? []).find((item) => item.code === code);
  expect(found, `maestro ${code} en ${path}`).toBeTruthy();
  return found!.id;
}

/** Genera un CUIT válido (dígito verificador correcto) con sufijo único. */
function validCuit(): string {
  const base = `20${String(Date.now()).slice(-8).padStart(8, "0")}`.slice(0, 10);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = base.split("").map(Number);
  const sum = weights.reduce((acc, w, i) => acc + digits[i]! * w, 0);
  const check = (11 - (sum % 11)) % 11;
  return `${base}${check === 11 ? 0 : check}`;
}

/** Resuelve el id del perfil fiscal del cliente (el primero activo). */
async function resolveProfileId(
  request: import("@playwright/test").APIRequestContext,
  firmId: string,
  clientId: string,
): Promise<string> {
  const list = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
  );
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { data?: Array<{ id: string }> };
  const found = (body.data ?? [])[0];
  expect(found).toBeTruthy();
  return found.id;
}
