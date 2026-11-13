import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * E2E vertical Monotributo (Puerta 4, Fase 4.4).
 *
 * Ejecuta el ciclo tributario completo contra la API dev:
 *   perfil con categoría → obligación mensual → cálculo de cuota →
 *   revisión (maker-checker) → finalización → presentación → pago.
 *
 * Verifica que el motor Monotributo produce la cuota esperada y que el flujo
 * de punta a punta persiste cada transición (no es una pantalla decorativa).
 */

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

test("ciclo Monotributo de punta a punta (Fase 4.4)", async ({ request, playwright }) => {
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
  const client = firm.clients.find((item) => item.clientName === "Cliente E2E Mono");
  expect(client).toBeTruthy();
  const firmId = firm.firmId;
  const clientId = client.clientId;

  // 3. Maestros (seedeados por seed-maestros-fiscales.ts): impuesto MONOTRIBUTO,
  //    régimen MONOTRIBUTO y pack AR_MONOTRIBUTO_V1 ACTIVE.
  const jurisdictionId = await resolveId(request, "/api/v1/tax/jurisdictions", "AR");
  const taxTypeId = await resolveId(request, "/api/v1/tax/types", "MONOTRIBUTO");
  const regimeId = await resolveId(request, "/api/v1/tax/regimes", "MONOTRIBUTO");

  // 4. Período + perfil (categoría B) + obligación.
  const period = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-periods`,
    { headers, data: { taxTypeId, startDate: "2026-01-01", endDate: "2026-01-31", label: "Enero 2026" } },
  );
  let periodId: string;
  if (period.status() === 201) {
    const periodBody = (await period.json()) as { data: { id: string } };
    periodId = periodBody.data.id;
  } else {
    // Reutiliza el período por etiqueta (no la settlement de una corrida
    // previa: su periodId puede corresponder a otro período).
    const periods = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-periods`,
    );
    const body = (await periods.json()) as { data?: Array<{ id: string; label: string }> };
    const found = (body.data ?? []).find((p) => p.label === "Enero 2026");
    expect(found).toBeTruthy();
    periodId = found!.id;
  }

  const profile = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
    {
      headers,
      data: {
        legalName: "Cliente E2E Mono",
        cuit: "20999999999",
        personType: "FISICA",
        nationalCondition: "MONOTRIBUTISTA",
        monotributoCategory: "B",
        validFrom: "2026-01-01",
      },
    },
  );
  const profileId = await resolveProfileId(request, firmId, clientId, profile.status());
  const profileList = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
  );
  expect(profileList.status()).toBe(200);
  const profiles = (await profileList.json()) as {
    data?: Array<{ id: string; status: string; monotributoCategory?: string | null }>;
  };
  const selectedProfile = (profiles.data ?? []).find((item) => item.id === profileId);
  expect(selectedProfile?.monotributoCategory).toBe("B");
  if (selectedProfile?.status === "DRAFT") {
    const submittedProfile = await request.post(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions/${profileId}/submit-review`,
      { headers },
    );
    expect([200, 409]).toContain(submittedProfile.status());
  }
  if (selectedProfile?.status === "DRAFT" || selectedProfile?.status === "IN_REVIEW") {
    // La activación del perfil es una mutación de configuración fiscal y la
    // capability tax.profile.write pertenece al preparador/owner. El
    // maker-checker del ciclo tributario se valida abajo sobre la settlement.
    const activatedProfile = await request.post(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions/${profileId}/activate`,
      { headers },
    );
    expect([200, 409]).toContain(activatedProfile.status());
  }

  // El cliente se inscribe en el régimen: sin inscripción no hay obligación.
  const registration = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-registrations`,
    { headers, data: { profileVersionId: profileId, regimeId, validFrom: "2020-01-01" } },
  );
  // 409: ya quedó inscripto en una corrida anterior.
  expect([201, 409]).toContain(registration.status());

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
    const found = (body.data ?? []).find(
          (o) => o.regime.id === regimeId && o.periodId === periodId,
        );
    expect(found).toBeTruthy();
    obligationId = found!.id;
  }

  // 5. Calcular cuota (categoría B → 30000).
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
    expect(settlement.totals["CATEGORIA"]).toBe("B");
    expect(settlement.totals["CUOTA_MENSUAL"]).toBe("30000.00");
    expect(settlement.totals["TOTAL_A_INGRESAR"]).toBe("30000.00");
  } else {
    const prev = await request.get(
      `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-settlements`,
    );
    const listBody = (await prev.json()) as {
      data?: Array<{
        id: string;
        status: string;
        regime?: { id: string };
        totals: Record<string, string> | null;
      }>;
    };
    // La settlement correcta es la del régimen y período de este ciclo (no
    // cualquier FINALIZED del cliente: los fixtures acumulados del demo
    // pueden incluir liquidaciones de otros regímenes).
    // El período puede variar entre corridas (el create del período es
    // idempotente por fechas pero el fallback puede resolver otro id);
    // el importe esperado valida que sea la settlement del ciclo.
    const existing = (listBody.data ?? []).find(
      (s) => s.status === "FINALIZED" && s.regime?.id === regimeId,
    );
    expect(existing).toBeTruthy();
    settlement = {
      id: existing!.id,
      status: existing!.status,
      totals: existing!.totals ?? {},
    };
    expect(settlement.totals["CUOTA_MENSUAL"]).toBe("30000.00");
    expect(settlement.totals["TOTAL_A_INGRESAR"]).toBe("30000.00");
  }

  // 6. Revisión (maker-checker) y finalización (sólo si no está finalizada).
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

  // 7. Presentación y pago.
    // El filing exige acuse con categoría ACUSE del cliente (§10/B-D4).
  const acuseDocumentId = await createAcuseDocument(playwright, apiBaseUrl, clientId);
const filing = await request.post(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-obligations/${obligationId}/filings`,
    {
      headers,
      data: {
        settlementId: settlement.id,
        filedAt: "2026-02-05",
        amountFiled: "30000.00",
        externalId: "MONO-E2E-001",
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
        amount: "30000.00",
        method: "DEBITO",
      },
    },
  );
  // 409 OVERPAYMENT: la corrida previa ya canceló la obligación.
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
  expect(["PAID", "PARTIALLY_PAID", "FILED"]).toContain(ob!.status);
});

/** Resuelve el id de un perfil fiscal (crea o reutiliza el más reciente). */
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
    const body = (await list.json()) as { data?: Array<{ id: string; monotributoCategory?: string | null }> };
    const categoryB = body.data?.find((item) => item.monotributoCategory === "B");
    if (categoryB) return categoryB.id;
    if (body.data && body.data.length > 0) return body.data[0].id;
  }
  const list = await request.get(
    `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}/tax-profile-versions`,
  );
  const body = (await list.json()) as { data?: Array<{ id: string; monotributoCategory?: string | null }> };
  expect(body.data && body.data.length).toBeGreaterThan(0);
  return body.data?.find((item) => item.monotributoCategory === "B")?.id ?? body.data![0].id;
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

/** Crea un documento ACUSE vía portal (categoría declarada, §10/B-D4). */
async function createAcuseDocument(
  playwright: import("@playwright/test").Playwright,
  apiBaseUrl: string,
  clientId: string,
): Promise<string> {
  // El upload portal exige capability portal.documents.upload: login como
  // colaborador del cliente (mismo usuario del E2E del portal).
  const portal = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const login = await portal.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { email: "cliente@contable.local", password: "cliente1234" },
  });
  expect([200, 429]).toContain(login.status());
  if (login.status() === 429) {
    // Rate limit: el flujo E2E acumulado ya creó acuses reutilizables.
    await portal.dispose();
    throw new Error("RATE_LIMITED_LOGIN");
  }
  const state = await portal.storageState();
  const csrf = state.cookies.find((c) => c.name === "csrf_token");
  const portalHeaders = { "X-CSRF-Token": csrf ? decodeURIComponent(csrf.value) : "" };
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
    headers: portalHeaders,
    data: { category: "ACUSE", expectedMime: "application/pdf" },
  });
  expect(session.status()).toBe(201);
  const sessionBody = (await session.json()) as {
    data: { sessionId: string; objectKey: string; presignedUrl: string };
  };
  const file = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    "binary",
  );
  const put = await portal.fetch(sessionBody.data.presignedUrl, {
    method: "PUT",
    data: file,
    headers: { "Content-Type": "application/pdf", "Content-Length": String(file.length) },
  });
  expect(put.status()).toBe(200);
  const sha256 = createHash("sha256").update(file).digest("hex");
  const complete = await portal.post(
    `${base}/document-upload-sessions/${sessionBody.data.sessionId}/complete`,
    {
      headers: portalHeaders,
      data: {
        originalName: "acuse.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.length,
        sha256,
        objectKey: sessionBody.data.objectKey,
      },
    },
  );
  expect(complete.status()).toBe(201);
  const completeBody = (await complete.json()) as { data: { documentId: string } };
  // El documento pasa por cuarentena antes de quedar utilizable como acuse.
  // Esperar READY evita hacer depender el filing del timing del worker.
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const documents = await portal.get(`${base}/documents`);
    expect(documents.status()).toBe(200);
    const documentsBody = (await documents.json()) as {
      data?: Array<{ id: string; status: string }>;
    };
    const current = documentsBody.data?.find((item) => item.id === completeBody.data.documentId);
    if (current?.status === "READY" || current?.status === "APPLIED") {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(ready).toBe(true);
  await portal.dispose();
  return completeBody.data.documentId;
}
