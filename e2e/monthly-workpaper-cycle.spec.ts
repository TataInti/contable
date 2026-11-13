import { createHash, randomUUID as cryptoRandomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * E2E vertical del legajo (C, plan piloto fiscal §10).
 *
 * Recorrido de punta a punta:
 *   pedido documental (borrador → envío → carga portal → revisión → completado)
 *   → legajo → saldos verificados → fuentes revisadas →
 *   cálculo IVA → revisión/finalización maker-checker → presentación → pago →
 *   rectificativa versionada.
 *
 * Idempotente: reutiliza fixtures de corridas previas (períodos, obligaciones,
 * liquidaciones FINALIZED, etc.).
 */

const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";

test("ciclo vertical del legajo (§10)", async ({ request, playwright }) => {
  // ---------- Usuarios (estudio + revisor) ----------
  const login = await request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { email: "demo@contable.local", password: "demo1234" },
  });
  expect(login.status()).toBe(200);
  const state = await request.storageState();
  const csrfCookie = state.cookies.find((c) => c.name === "csrf_token");
  const headers = { "X-CSRF-Token": csrfCookie ? decodeURIComponent(csrfCookie.value) : "" };

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

  // ---------- Contexto de firma y cliente ----------
  const runTag = Date.now().toString(36);
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
  const base = `${apiBaseUrl}/api/v1/firms/${firmId}/clients/${clientId}`;

  // Maestros IVA (seedeados).
  const taxTypeId = await resolveId(request, "/api/v1/tax/types", "IVA");
  const regimeId = await resolveId(request, "/api/v1/tax/regimes", "RI");
  const jurisdictionId = await resolveId(request, "/api/v1/tax/jurisdictions", "AR");

  // ---------- 1. Pedido documental en borrador ----------
  const draft = await request.post(`${base}/document-requests`, {
    headers,
    data: {
      title: `Pedido E2E mensual ${new Date().toISOString().slice(0, 10)}`,
      items: [
        { description: "Libro IVA ventas", required: true },
        { description: "Libro IVA compras", required: true },
      ],
    },
  });
  expect(draft.status()).toBe(201);
  const draftBody = (await draft.json()) as {
    data: { id: string; status: string; items: Array<{ id: string }> };
  };
  expect(draftBody.data.status).toBe("DRAFT");
  const requestId = draftBody.data.id;

  // ---------- 2. Envío → visible en portal ----------
  const sent = await request.post(`${base}/document-requests/${requestId}/send`, { headers });
  expect(sent.status()).toBe(200);

  // El pedido enviado es visible en el listado (el portal filtra DRAFT/
  // CANCELLED; verificado en portal-routes.test).
  const listed = await request.get(`${base}/document-requests`);
  expect(listed.status()).toBe(200);
  const listedBody = (await listed.json()) as {
    data?: Array<{ id: string; status: string }>;
  };
  expect((listedBody.data ?? []).find((r) => r.id === requestId)).toBeTruthy();

  // ---------- 3. Un colaborador del cliente carga los documentos requeridos ----------
  // Flujo real de portal: upload session (portal) → PUT a MinIO → complete.
  // El complete liga el documento al ítem y deriva el estado del pedido.
  const portalCtx = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const portalLogin = await portalCtx.post("/api/v1/auth/login", {
    data: { email: "cliente@contable.local", password: "cliente1234" },
  });
  expect(portalLogin.status()).toBe(200);
  const portalState = await portalCtx.storageState();
  const portalCsrf = portalState.cookies.find((c) => c.name === "csrf_token");
  const portalHeaders = {
    "X-CSRF-Token": portalCsrf ? decodeURIComponent(portalCsrf.value) : "",
  };
  const portalBase = `${apiBaseUrl}/api/v1/portal/clients/${clientId}`;
  const pdf = minimalPdf("libro iva ventas");
  const uploadedDocumentIds: string[] = [];
  for (const item of draftBody.data.items) {
    const documentId = await portalUpload(portalCtx, portalBase, portalHeaders, item.id, pdf);
    expect(documentId).toBeTruthy();
    uploadedDocumentIds.push(documentId);
  }

  // ---------- 4. Pedido listo para revisión, no completado ----------
  const ready = await requestStatus(request, base, requestId);
  expect(ready).toBe("READY_FOR_REVIEW");

  // ---------- 5. El estudio acepta los ítems → COMPLETED ----------
  for (const item of draftBody.data.items) {
    const accepted = await request.post(
      `${base}/document-requests/${requestId}/items/${item.id}/accept`,
      { headers },
    );
    expect(accepted.status()).toBe(200);
  }
  const completed = await requestStatus(request, base, requestId);
  expect(completed).toBe("COMPLETED");

  // ---------- 6. Legajo ----------
  // Período único por corrida: evita colisiones con fixtures de corridas
  // previas (el legajo es idempotente por cliente+período).
  // Año rotativo por segundo dentro del rango de cuatro dígitos. Se reserva
  // 9999 para los vencimientos y presentaciones del año siguiente.
  const firstRunYear = 2100;
  const lastRunYear = 9998;
  const runYearRange = lastRunYear - firstRunYear + 1;
  const runYear = firstRunYear + (Math.floor(Date.now() / 1000) % runYearRange);
  const periodLabel = `E2E ${runYear} ${runTag}`;
  const period = await request.post(`${base}/tax-periods`, {
    headers,
    data: {
      taxTypeId,
      startDate: `${runYear}-01-01`,
      endDate: `${runYear}-01-28`,
      label: periodLabel,
    },
  });
  expect(period.status()).toBe(201);
  const periodBody = (await period.json()) as { data: { id: string } };
  const periodId = periodBody.data.id;

  const profile = await request.post(`${base}/tax-profile-versions`, {
    headers,
    data: {
      legalName: "Cliente E2E Legajo",
      cuit: "20999999999",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    },
  });
  const profileId = await resolveProfileId(request, base, profile.status());

  // El cliente se inscribe en el régimen: sin inscripción no hay obligación.
  const registration = await request.post(
    `${base}/tax-registrations`,
    { headers, data: { profileVersionId: profileId, regimeId, validFrom: "2020-01-01" } },
  );
  // 409: ya quedó inscripto en una corrida anterior.
  expect([201, 409]).toContain(registration.status());

  const obligation = await request.post(`${base}/tax-obligations`, {
    headers,
    data: { profileVersionId: profileId, regimeId, periodId, dueDate: `${runYear + 1}-02-20` },
  });
  let obligationId: string;
  if (obligation.status() === 201) {
    const obligationBody = (await obligation.json()) as { data: { id: string } };
    obligationId = obligationBody.data.id;
  } else {
    // Corrida previa: obligación del período actual.
    const list = await request.get(`${base}/tax-obligations`);
    const listBody = (await list.json()) as {
      data?: Array<{ id: string; periodId: string; regime: { id: string } }>;
    };
    const found = (listBody.data ?? []).find(
      (o) => o.periodId === periodId && o.regime.id === regimeId,
    );
    expect(found).toBeTruthy();
    obligationId = found!.id;
  }

  const wp = await request.post(`${base}/monthly-tax-workpapers`, {
    headers,
    data: { periodStart: `${runYear}-01-01`, periodEnd: `${runYear}-01-28` },
  });
  expect([201, 200]).toContain(wp.status());
  const wpBody = (await wp.json()) as {
    data: { id: string; status: string; revision: number };
  };
  const workpaperId = wpBody.data.id;
  expect(wpBody.data.revision).toBe(1);

  // ---------- 7. Saldos anteriores + verificación por revisor ----------
  const opening = await request.post(`${base}/tax-credit-ledger/opening`, {
    headers,
    data: {
      taxTypeId,
      periodId,
      kind: "SALDO_A_FAVOR",
      amount: "5000",
      reference: `E2E saldo anterior ${runTag}`,
    },
  });
  expect(opening.status()).toBe(201);
  const openingBody = (await opening.json()) as {
    data: { id: string; verificationStatus: string };
  };
  expect(openingBody.data.verificationStatus).toBe("PENDING_VERIFICATION");

  const verified = await reviewerCtx.post(
    `${base}/tax-credit-ledger/${openingBody.data.id}/verify`,
    { headers: reviewerHeaders, data: { officialReference: "E2E verificación" } },
  );
  expect(verified.status()).toBe(200);

  // ---------- 8. Fuentes y clasificaciones ----------
  // Importación de libros IVA ventas y compras (ambas fuentes requeridas).
  // Cada lote se vincula al legajo (workpaperId + sourceCode).
  const importBook = async (
    sourceCode: "ARCA_IVA_SALES" | "ARCA_IVA_PURCHASES",
    direction: "SALE" | "PURCHASE",
    counterpartyCuit: string,
  ) => {
    const batch = await request.post(`${base}/import-batches`, {
      headers,
      data: {
        origin: "ARCA",
        taxTypeId,
        periodId,
        adapterVersion: "ARCA_LIBRO_IVA_V1",
        fileHash: `sha256:e2e-wp-${cryptoRandomUUID()}`,
        workpaperId,
        sourceCode,
      },
    });
    expect(batch.status()).toBe(201);
    const batchBody = (await batch.json()) as { data: { id: string } };
    const validated = await request.post(
      `${base}/import-batches/${batchBody.data.id}/validate`,
      {
        headers,
        data: {
          rows: [
            {
              direction,
              letter: "A",
              pointOfSale: "1",
              numberFrom: String(100000 + Math.floor(Math.random() * 100000)),
              numberTo: String(200001 + Math.floor(Math.random() * 100000)),
              cuit: counterpartyCuit,
              issuedOn: `${runYear}-01-10`,
              net: direction === "PURCHASE" ? "40000.00" : "100000.00",
              hasIva: true,
              iva21: direction === "PURCHASE" ? "8400.00" : "21000.00",
              iva105: "0.00",
              iva27: "0.00",
              exempt: "0.00",
              otherTaxes: "0.00",
              currency: "ARS",
            },
          ],
        },
      },
    );
    expect(validated.status()).toBe(200);
    const validatedBody = (await validated.json()) as { data: unknown };
    const committed = await request.post(
      `${base}/import-batches/${batchBody.data.id}/commit`,
      { headers, data: { clientCuit: "20999999999" } },
    );
    // Idempotente: 409 si el lote ya fue committeado en una corrida previa.
    expect([200, 409]).toContain(committed.status());
  };
  await importBook("ARCA_IVA_SALES", "SALE", "20111111111");
  await importBook("ARCA_IVA_PURCHASES", "PURCHASE", "20999999999");

  // Revisar fuentes del legajo (coverage → batches → review).
  // El review exige maker-checker: lo hace el revisor.
  const coverage = await request.get(`${base}/monthly-tax-workpapers/${workpaperId}/coverage`);
  expect(coverage.status()).toBe(200);
  const coverageBody = (await coverage.json()) as {
    data: {
      sources: Array<{
        code: string;
        required: boolean;
        batches: Array<{ id: string; batchStatus: string; reviewStatus: string }>;
      }>;
    };
  };
  for (const source of coverageBody.data.sources.filter((s) => s.required)) {
    for (const batch of source.batches.filter((b) => b.batchStatus === "COMMITTED")) {
      const reviewedSource = await reviewerCtx.post(
        `${base}/monthly-tax-workpapers/${workpaperId}/sources/${batch.id}/review`,
        { headers: reviewerHeaders },
      );
      expect([200, 409]).toContain(reviewedSource.status());
    }
  }

  // Clasificar los vouchers del legajo (rubro/actividad requeridos).
  const classifications = await request.get(
    `${base}/monthly-tax-workpapers/${workpaperId}/classifications`,
  );
  expect(classifications.status()).toBe(200);
  const classificationsBody = (await classifications.json()) as {
    data: { items: Array<{ id: string; direction: string; activityCode: string | null; categoryCode: string | null }> };
  };
  for (const classification of classificationsBody.data.items.filter((c) => !c.activityCode)) {
    // Las compras exigen rubro (SUPER/TRANSPORTE); las ventas, actividad.
    const body = classification.direction === "PURCHASE"
      ? { categoryCode: "SUPER", activityCode: "COMPRA_GENERAL" }
      : { activityCode: "VENTA_GENERAL" };
    const classified = await request.patch(
      `${base}/monthly-tax-workpapers/${workpaperId}/classifications/${classification.id}`,
      { headers, data: body },
    );
    expect([200, 409]).toContain(classified.status());
  }

  // Aprobar vouchers pendientes (maker-checker: revisor).
  const vouchers = await request.get(`${base}/vouchers`);
  expect(vouchers.status()).toBe(200);
  const vouchersBody = (await vouchers.json()) as { data?: Array<{ id: string; status: string }> };
  for (const v of (vouchersBody.data ?? []).filter((x) => x.status === "DRAFT")) {
    const reviewed = await reviewerCtx.post(`${base}/vouchers/${v.id}/review`, {
      headers: reviewerHeaders,
      data: { approve: true },
    });
    expect([200, 409]).toContain(reviewed.status());
  }

  // ---------- 9. Calcular IVA ----------
  const calculated = await request.post(
    `${base}/monthly-tax-workpapers/${workpaperId}/calculate`,
    { headers, data: { cutoff: `${runYear}-01-28` } },
  );
  expect([200, 409, 422]).toContain(calculated.status());
  if (calculated.status() === 200) {
    const calcBody = (await calculated.json()) as {
      data: { workpaper: { status: string }; settlements: Array<{ status: string }> };
    };
    expect(calcBody.data.workpaper.status).toBe("CALCULATED");
  }

  // Resolver controles bloqueantes generados (con evidencia).
  const controls = await request.get(
    `${base}/monthly-tax-workpapers/${workpaperId}/controls`,
  );
  expect(controls.status()).toBe(200);
  const controlsBody = (await controls.json()) as {
    data: Array<{ id: string; severity: string; status: string }>;
  };
  const evidence = await createDocument(request, base, headers, [], uploadedDocumentIds);
  for (const control of controlsBody.data.filter(
    (c) => c.severity === "BLOCKING" && c.status === "OPEN",
  )) {
    const resolved = await reviewerCtx.post(
      `${base}/monthly-tax-workpapers/${workpaperId}/controls/${control.id}/resolve`,
      {
        headers: reviewerHeaders,
        data: {
          resolution: "Conciliación verificada en E2E",
          status: "RESOLVED",
          evidenceDocumentId: evidence,
        },
      },
    );
    expect([200, 409]).toContain(resolved.status());
  }

  // ---------- 10. Preparador envía a revisión ----------
  const submitted = await request.post(
    `${base}/monthly-tax-workpapers/${workpaperId}/submit-review`,
    { headers },
  );
  expect([200, 409]).toContain(submitted.status());

  // ---------- 11. Revisor resuelve y finaliza ----------
  const reviewed = await reviewerCtx.post(
    `${base}/monthly-tax-workpapers/${workpaperId}/review`,
    { headers: reviewerHeaders, data: { approved: true } },
  );
  expect([200, 409]).toContain(reviewed.status());
  const finalized = await reviewerCtx.post(
    `${base}/monthly-tax-workpapers/${workpaperId}/finalize`,
    { headers: reviewerHeaders },
  );
  expect([200, 409]).toContain(finalized.status());
  if (finalized.status() === 200) {
    const finalBody = (await finalized.json()) as { data: { status: string } };
    expect(finalBody.data.status).toBe("FINALIZED");
  }

  // ---------- 12. Presentación y pago ----------
  const detail = (await (
    await request.get(`${base}/monthly-tax-workpapers/${workpaperId}`)
  ).json()) as {
    data: {
      status: string;
      settlements: Array<{
        settlement: { id: string; inputHash: string; outputHash: string; totals: Record<string, string> | null } | null;
      }>;
    };
  };
  const linkedSettlementId = detail.data.settlements[0]?.settlement?.id;
  const linkedSettlement = detail.data.settlements[0]?.settlement;
  if (linkedSettlementId && detail.data.status === "FINALIZED") {
    expect(linkedSettlement?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(linkedSettlement?.outputHash).toMatch(/^[a-f0-9]{64}$/);
    const amountDue = linkedSettlement?.totals?.TOTAL_A_INGRESAR ?? "0.00";
    const filing = await request.post(`${base}/tax-obligations/${obligationId}/filings`, {
      headers,
      data: {
        settlementId: linkedSettlementId,
        filedAt: `${runYear + 1}-02-05`,
        amountFiled: amountDue,
        externalId: `E2E-WP-${Date.now()}`,
        evidenceDocumentId: evidence,
      },
    });
    expect([201, 409], await filing.text()).toContain(filing.status());

    const payment = await request.post(`${base}/tax-obligations/${obligationId}/payments`, {
      headers,
      data: {
        settlementId: linkedSettlementId,
        paidAt: `${runYear + 1}-02-10`,
        amount: amountDue,
        method: "TRANSFERENCIA",
        reference: `E2E-WP-PAGO-${runTag}`,
      },
    });
    expect([201, 409]).toContain(payment.status());

    const artifacts = await request.get(
      `${base}/tax-settlements/${linkedSettlementId}/artifacts`,
    );
    expect(artifacts.status()).toBe(200);
    const artifactsBody = (await artifacts.json()) as {
      data: Array<{ id: string; format: string; checksum: string | null }>;
    };
    const artifact = artifactsBody.data.find((item) => item.format === "csv");
    if (!artifact) {
      const generated = await request.post(
        `${base}/tax-settlements/${linkedSettlementId}/artifacts`,
        { headers, data: { format: "csv" } },
      );
      expect([201, 409]).toContain(generated.status());
    }
  }

  // ---------- 13/14. Portal owner: resultado finalizado y descarga ----------
  const portalSettlements = await portalCtx.get(`${portalBase}/tax-settlements`);
  expect(portalSettlements.status()).toBe(200);
  const portalSettlementsBody = (await portalSettlements.json()) as {
    data: Array<{
      id: string;
      status: string;
      inputHash: string;
      outputHash: string;
      artifacts: Array<{ id: string; format: string }>;
    }>;
  };
  expect(portalSettlementsBody.data.every((item) => item.status === "FINALIZED")).toBe(true);
  const publishedSettlement = portalSettlementsBody.data.find((item) => item.id === linkedSettlementId);
  expect(publishedSettlement).toBeTruthy();
  expect(publishedSettlement?.inputHash).toMatch(/^[a-f0-9]{64}$/);
  expect(publishedSettlement?.outputHash).toMatch(/^[a-f0-9]{64}$/);
  const publishedArtifact = publishedSettlement?.artifacts.find((item) => item.format === "csv");
  expect(publishedArtifact).toBeTruthy();
  const download = await portalCtx.get(
    `${portalBase}/tax-settlements/${linkedSettlementId}/artifacts/${publishedArtifact!.id}/download`,
  );
  expect(download.status()).toBe(200);
  expect((await download.body()).byteLength).toBeGreaterThan(0);

  // ---------- 15. Portal: colaborador puede cargar/mensajear, no consultar ----------
  const collaboratorCtx = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const collaboratorLogin = await collaboratorCtx.post("/api/v1/auth/login", {
    data: { email: "colaborador@contable.local", password: "colaborador1234" },
  });
  expect(collaboratorLogin.status()).toBe(200);
  const collaboratorState = await collaboratorCtx.storageState();
  const collaboratorCsrf = collaboratorState.cookies.find((c) => c.name === "csrf_token");
  const collaboratorHeaders = {
    "X-CSRF-Token": collaboratorCsrf ? decodeURIComponent(collaboratorCsrf.value) : "",
  };
  const collaboratorSettlements = await collaboratorCtx.get(`${portalBase}/tax-settlements`);
  expect(collaboratorSettlements.status()).toBe(403);

  const followUp = await request.post(`${base}/document-requests`, {
    headers,
    data: { title: `Pedido colaborador ${runTag}`, items: [{ description: "Constancia", required: true }] },
  });
  expect(followUp.status()).toBe(201);
  const followUpBody = (await followUp.json()) as {
    data: { id: string; items: Array<{ id: string }> };
  };
  const followUpSent = await request.post(`${base}/document-requests/${followUpBody.data.id}/send`, { headers });
  expect(followUpSent.status()).toBe(200);
  const followUpThread = await request.post(
    `${base}/document-requests/${followUpBody.data.id}/threads`,
    { headers, data: { visibility: "SHARED" } },
  );
  expect(followUpThread.status()).toBe(201);
  const followUpThreadBody = (await followUpThread.json()) as { data: { id: string } };
  const collaboratorRequests = await collaboratorCtx.get(`${portalBase}/document-requests`);
  expect(collaboratorRequests.status()).toBe(200);
  const collaboratorRequestsBody = (await collaboratorRequests.json()) as {
    data: Array<{ id: string; items: Array<{ id: string }>; threads: Array<{ id: string }> }>;
  };
  const visibleFollowUp = collaboratorRequestsBody.data.find((item) => item.id === followUpBody.data.id);
  expect(visibleFollowUp).toBeTruthy();
  const collaboratorDocumentId = await portalUpload(
    collaboratorCtx,
    portalBase,
    collaboratorHeaders,
    visibleFollowUp!.items[0]!.id,
    minimalPdf("respuesta colaborador"),
  );
  expect(collaboratorDocumentId).toBeTruthy();
  const message = await collaboratorCtx.post(`${portalBase}/threads/${followUpThreadBody.data.id}/messages`, {
    headers: collaboratorHeaders,
    data: { body: "Adjunto la constancia solicitada." },
  });
  expect(message.status()).toBe(201);

  // READONLY ve resultados, pero no puede cargar documentos ni mensajear.
  const readonlyCtx = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const readonlyLogin = await readonlyCtx.post("/api/v1/auth/login", {
    data: { email: "readonly@contable.local", password: "readonly1234" },
  });
  expect(readonlyLogin.status()).toBe(200);
  const readonlyState = await readonlyCtx.storageState();
  const readonlyCsrf = readonlyState.cookies.find((c) => c.name === "csrf_token");
  const readonlyHeaders = { "X-CSRF-Token": readonlyCsrf ? decodeURIComponent(readonlyCsrf.value) : "" };
  expect((await readonlyCtx.get(`${portalBase}/tax-settlements`)).status()).toBe(200);
  const readonlyUpload = await readonlyCtx.post(`${portalBase}/document-upload-sessions`, {
    headers: readonlyHeaders,
    data: { requestItemId: visibleFollowUp!.items[0]!.id, expectedMime: "application/pdf" },
  });
  expect(readonlyUpload.status()).toBe(403);

  const ledger = await request.get(`${base}/tax-credit-ledger`);
  expect(ledger.status()).toBe(200);
  const ledgerBody = (await ledger.json()) as {
    data: Array<{ verificationStatus: string; available: string }>;
  };
  const openingEntry = ledgerBody.data.find(
    (l) => l.reference === `E2E saldo anterior ${runTag}`,
  );
  expect(openingEntry?.verificationStatus).toBe("VERIFIED");

  // ---------- 16. Rectificativa crea nueva versión sin alterar la original ----------
  const rectified = await request.post(
    `${base}/monthly-tax-workpapers/${workpaperId}/rectify`,
    { headers },
  );
  // Idempotente: 409 si la corrida previa ya rectificó este legajo.
  expect([200, 201, 409]).toContain(rectified.status());
  if (rectified.status() !== 409) {
    const rectBody = (await rectified.json()) as {
      data: { id: string; revision: number; supersedesId: string | null; status: string };
    };
    expect(rectBody.data.revision).toBe(2);
    expect(rectBody.data.supersedesId).toBe(workpaperId);
    expect(rectBody.data.status).not.toBe("FINALIZED");
  } else {
    // Verifica que exista la revisión 2 de corrida previa.
    const list = await request.get(`${base}/monthly-tax-workpapers`);
    const listBody = (await list.json()) as {
      data?: Array<{ id: string; revision: number; supersedesId: string | null }>;
    };
    const revision2 = (listBody.data ?? []).find(
      (w) => w.supersedesId === workpaperId && w.revision === 2,
    );
    expect(revision2).toBeTruthy();
  }

  // La original sigue FINALIZED (inmutable).
  const original = await workpaperStatus(request, base, workpaperId);
  expect(original).toBe("FINALIZED");
});

/** Estado de un pedido documental vía listado. */
async function requestStatus(
  request: import("@playwright/test").APIRequestContext,
  base: string,
  id: string,
): Promise<string> {
  const res = await request.get(`${base}/document-requests`);
  const body = (await res.json()) as { data?: Array<{ id: string; status: string }> };
  const found = (body.data ?? []).find((r) => r.id === id);
  expect(found).toBeTruthy();
  return found!.status;
}

/** Estado de un legajo vía listado. */
async function workpaperStatus(
  request: import("@playwright/test").APIRequestContext,
  base: string,
  id: string,
): Promise<string> {
  const res = await request.get(`${base}/monthly-tax-workpapers`);
  const body = (await res.json()) as { data?: Array<{ id: string; status: string }> };
  const found = (body.data ?? []).find((w) => w.id === id);
  expect(found).toBeTruthy();
  return found!.status;
}

/** PDF mínimo válido (magic %PDF) para uploads del E2E. */
function minimalPdf(title: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R/Title(${title})>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
    "binary",
  );
}

/** Sube un archivo por el portal y completa la sesión (ligada al ítem). */
async function portalUpload(
  portalCtx: import("@playwright/test").APIRequestContext,
  portalBase: string,
  portalHeaders: Record<string, string>,
  requestItemId: string,
  file: Buffer,
): Promise<string> {
  const sha256 = createHash("sha256").update(file).digest("hex");
  const session = await portalCtx.post(`${portalBase}/document-upload-sessions`, {
    headers: portalHeaders,
    data: { requestItemId, expectedMime: "application/pdf", category: "ACUSE" },
  });
  expect(session.status()).toBe(201);
  const sessionBody = (await session.json()) as {
    data: { sessionId: string; objectKey: string; presignedUrl: string };
  };
  const put = await portalCtx.fetch(sessionBody.data.presignedUrl, {
    method: "PUT",
    data: file,
    headers: { "Content-Type": "application/pdf", "Content-Length": String(file.length) },
  });
  expect(put.status()).toBe(200);
  const complete = await portalCtx.post(
    `${portalBase}/document-upload-sessions/${sessionBody.data.sessionId}/complete`,
    {
      headers: portalHeaders,
      data: {
        originalName: "libro-iva.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.length,
        sha256,
        objectKey: sessionBody.data.objectKey,
      },
    },
  );
  if (complete.status() !== 201) {
    console.error("complete failed:", complete.status(), await complete.text());
  }
  expect(complete.status()).toBe(201);
  const completeBody = (await complete.json()) as { data: { documentId: string } };
  return completeBody.data.documentId;
}

/** Obtiene un documento READY del cliente (para adjuntar al pedido). */
async function createDocument(
  request: import("@playwright/test").APIRequestContext,
  base: string,
  headers: Record<string, string>,
  excludeIds: string[] = [],
  candidateIds: string[] = [],
): Promise<string> {
  // El worker VALIDATE promueve los uploads a READY; espera activa corta.
  for (let attempt = 0; attempt < 10; attempt++) {
    const docs = await request.get(`${base}/documents`);
    expect(docs.status()).toBe(200);
    const docsBody = (await docs.json()) as { data?: Array<{ id: string; status: string }> };
    const ready = (docsBody.data ?? []).find(
      (d) => d.status === "READY" && !excludeIds.includes(d.id) &&
        (candidateIds.length === 0 || candidateIds.includes(d.id)),
    );
    if (ready) return ready.id;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("No hay documento READY disponible tras esperar al worker");
}

async function resolveId(
  request: import("@playwright/test").APIRequestContext,
  listPath: string,
  code: string,
): Promise<string> {
  const list = await request.get(`${apiBaseUrl}${listPath}`);
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { data?: Array<{ id: string; code: string }> };
  const found = (body.data ?? []).find((i) => i.code === code);
  expect(found).toBeTruthy();
  return found!.id;
}

async function resolvePeriodId(
  createStatus: number,
  request: import("@playwright/test").APIRequestContext,
  base: string,
  startDate: string,
): Promise<string> {
  if (createStatus === 201) {
    // El período recién creado es el último de la lista de obligaciones
    // (la obligación se crea después); el fallback de abajo lo resuelve.
    const obligations = await request.get(`${base}/tax-obligations`);
    const body = (await obligations.json()) as { data?: Array<{ periodId: string }> };
    const found = (body.data ?? [])[0];
    if (found) return found.periodId;
  }
  // Fallback: obligaciones existentes (corrida previa).
  const obligations = await request.get(`${base}/tax-obligations`);
  const body = (await obligations.json()) as { data?: Array<{ periodId: string }> };
  const found = (body.data ?? [])[0];
  expect(found).toBeTruthy();
  return found!.periodId;
}

async function resolveProfileId(
  request: import("@playwright/test").APIRequestContext,
  base: string,
  createStatus: number,
): Promise<string> {
  const list = await request.get(`${base}/tax-profile-versions`);
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { data?: Array<{ id: string }> };
  expect(body.data && body.data.length).toBeGreaterThan(0);
  return body.data![0].id;
}

async function resolveObligationId(
  createStatus: number,
  request: import("@playwright/test").APIRequestContext,
  base: string,
  regimeId: string,
): Promise<string> {
  const list = await request.get(`${base}/tax-obligations`);
  expect(list.status()).toBe(200);
  const body = (await list.json()) as {
    data?: Array<{ id: string; regime: { id: string } }>;
  };
  const found =
    createStatus === 201
      ? (body.data ?? []).find((o) => o.regime.id === regimeId)
      : (body.data ?? []).find((o) => o.regime.id === regimeId);
  expect(found).toBeTruthy();
  return found!.id;
}
