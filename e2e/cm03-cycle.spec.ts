import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * E2E vertical CM03 artículo 2 (Puerta 4, Fase 4.3).
 *
 * Ejecuta el ciclo tributario completo contra la API dev:
 *   importación CM03 → voucher SALE con actividad → cálculo CM03 →
 *   revisión (maker-checker) → finalización → presentación → pago.
 *
 * Verifica que el motor CM03 produce el resultado esperado y que el flujo
 * de punta a punta persiste cada transición (no es una pantalla decorativa).
 */

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

test("ciclo CM03 artículo 2 de punta a punta (Fase 4.3)", async ({ request, playwright }) => {
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
    data: {
      firms: Array<{ firmId: string; clients: Array<{ clientId: string; clientName: string }> }>;
    };
  };
  const firm = meBody.data.firms[0];
  expect(firm).toBeTruthy();
  const client = firm.clients.find((item) => item.clientName === "Cliente E2E CM03");
  expect(client).toBeTruthy();
  const firmId = firm.firmId;
  const clientId = client.clientId;

  // 3. Maestros CM03 (seedeados por seed-maestros-fiscales.ts): jurisdicción
  //    Nación, impuesto IIBB, régimen CM_ART2 y pack AR_IIBB_CM_ART2_V1 ACTIVE.
  const jurisdictionId = await resolveId(request, "/api/v1/tax/jurisdictions", "AR");
  const taxTypeId = await resolveId(request, "/api/v1/tax/types", "IIBB");
  const regimeId = await resolveId(request, "/api/v1/tax/regimes", "CM_ART2");

  // 4. Período + perfil + obligación.
  const period = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-periods`,
    { headers, data: { taxTypeId, startDate: "2026-01-01", endDate: "2026-01-31", label: "Enero 2026" } },
  );
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

  const profile = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
    {
      headers,
      data: {
        legalName: "Cliente E2E CM03",
        cuit: "20999999999",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: "2026-01-01",
      },
    },
  );
  const profileId = await resolveProfileId(request, firmId, clientId, profile.status());

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

  // 5. Importación CM03 → voucher SALE con actividad (base país).
  const batch = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/import-batches`,
    {
      headers,
      data: {
        origin: "CM03",
        taxTypeId,
        periodId,
        adapterVersion: "CM03_V1",
        fileHash: `sha256:e2e-cm03-${Date.now()}`,
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
          { activityCode: "COMERCIO", income: "100000.00" },
          { activityCode: "SERVICIOS", income: "50000.00" },
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

  // Aprobar los vouchers CM03 (el motor sólo calcula con hechos APPROVED).
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

  // 6. Calcular CM03. Si la corrida anterior ya finalizó, el recálculo da 409
  //    (V-003 inmutable) y se reutiliza la existente finalizada.
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
    // TUC: 150000 × 0.6 = 90000 × 4% = 3600; CBA: 150000 × 0.4 = 60000 × 3.5% = 2100
    expect(settlement.totals["IMPUESTO_POR_JURISDICCION"]).toBe("5700.00");
    expect(settlement.totals["TOTAL_A_INGRESAR"]).toBe("5700.00");
  } else {
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
    expect(settlement.totals["IMPUESTO_POR_JURISDICCION"]).toBe("5700.00");
    expect(settlement.totals["TOTAL_A_INGRESAR"]).toBe("5700.00");
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
  const acuseDocumentId = await createAcuseDocument(playwright, apiBaseUrl, clientId);
  const filing = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations/${obligationId}/filings`,
    {
      headers,
      data: {
        settlementId: settlement.id,
        filedAt: "2026-02-05",
        amountFiled: "5700.00",
        externalId: "CM03-E2E-001",
        evidenceDocumentId: acuseDocumentId,
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
        amount: "5700.00",
        method: "TRANSFERENCIA",
      },
    },
  );
  expect([201, 409]).toContain(payment.status());

  // Verificar estado final de la obligación.
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

async function createAcuseDocument(
  playwright: import("@playwright/test").Playwright,
  apiBaseUrl: string,
  clientId: string,
): Promise<string> {
  const portal = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const login = await portal.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { email: "cliente@contable.local", password: "cliente1234" },
  });
  expect(login.status()).toBe(200);
  const state = await portal.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === "csrf_token");
  const headers = { "X-CSRF-Token": csrf ? decodeURIComponent(csrf.value) : "" };
  const base = `${apiBaseUrl}/api/v1/portal/clients/${clientId}`;
  const existingDocuments = await portal.get(`${base}/documents`);
  expect(existingDocuments.status()).toBe(200);
  const existingBody = (await existingDocuments.json()) as {
    data?: Array<{ id: string; status: string; category?: string | null }>;
  };
  const existingAcuse = existingBody.data?.find(
    (item) => (item.status === "READY" || item.status === "APPLIED") && item.category === "ACUSE",
  );
  if (existingAcuse) {
    await portal.dispose();
    return existingAcuse.id;
  }
  const session = await portal.post(`${base}/document-upload-sessions`, {
    headers,
    data: { category: "ACUSE", expectedMime: "application/pdf" },
  });
  expect(session.status()).toBe(201);
  const body = (await session.json()) as { data: { sessionId: string; objectKey: string; presignedUrl: string } };
  const file = Buffer.from("%PDF-1.4\n%%EOF\n", "binary");
  const put = await portal.fetch(body.data.presignedUrl, {
    method: "PUT",
    data: file,
    headers: { "Content-Type": "application/pdf", "Content-Length": String(file.length) },
  });
  expect(put.status()).toBe(200);
  const complete = await portal.post(`${base}/document-upload-sessions/${body.data.sessionId}/complete`, {
    headers,
    data: {
      originalName: "acuse-cm03.pdf",
      mimeType: "application/pdf",
      sizeBytes: file.length,
      sha256: createHash("sha256").update(file).digest("hex"),
      objectKey: body.data.objectKey,
    },
  });
  expect(complete.status()).toBe(201);
  const result = (await complete.json()) as { data: { documentId: string } };
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const documents = await portal.get(`${base}/documents`);
    expect(documents.status()).toBe(200);
    const documentsBody = (await documents.json()) as {
      data?: Array<{ id: string; status: string }>;
    };
    const current = documentsBody.data?.find((item) => item.id === result.data.documentId);
    if (current?.status === "READY" || current?.status === "APPLIED") {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(ready).toBe(true);
  await portal.dispose();
  return result.data.documentId;
}
