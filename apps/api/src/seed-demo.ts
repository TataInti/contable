/**
 * Seed de demo (Fase funcional).
 * Crea: firma demo con owner, cliente, ejercicio + períodos, cuentas,
 * asiento posteado balanceado y feature flags habilitados.
 *
 * Uso: npx tsx src/seed-demo.ts
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./auth/password.js";

const DEMO_EMAIL = "demo@contable.local";
const DEMO_PASSWORD = "demo1234";
const REVIEWER_EMAIL = "revisor@contable.local";
const REVIEWER_PASSWORD = "revisor1234";
const PORTAL_EMAIL = "cliente@contable.local";
const PORTAL_PASSWORD = "cliente1234";

async function main() {
  console.log("Seeding demo…");

  // Usuario owner
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { emailNormalized: DEMO_EMAIL },
    update: {},
    create: { emailNormalized: DEMO_EMAIL, name: "Demo Owner", passwordHash },
  });

  // Firma demo (marcada como DEMOSTRACIÓN — NO APTO PARA LIQUIDAR)
  const firm = await prisma.firm.upsert({
    where: { id: "dddddddd-dddd-4ddd-8ddd-ddddddddd001" },
    update: {},
    create: {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddd001",
      legalName: "Estudio Demo S.A. — DEMOSTRACIÓN — NO APTO PARA LIQUIDAR",
      displayName: "Demo",
    },
  });

  // Membresía owner
  await prisma.firmMembership.upsert({
    where: { firmId_userId: { firmId: firm.id, userId: user.id } },
    update: { status: "ACTIVE", role: "OWNER" },
    create: {
      firmId: firm.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
      acceptedAt: new Date(),
    },
  });

  // Usuario revisor (maker-checker: el owner no puede revisar su propio trabajo)
  const reviewer = await prisma.user.upsert({
    where: { emailNormalized: REVIEWER_EMAIL },
    update: {},
    create: { emailNormalized: REVIEWER_EMAIL, name: "Revisor Demo", passwordHash: await hashPassword(REVIEWER_PASSWORD) },
  });
  await prisma.firmMembership.upsert({
    where: { firmId_userId: { firmId: firm.id, userId: reviewer.id } },
    update: { status: "ACTIVE", role: "REVIEWER" },
    create: {
      firmId: firm.id,
      userId: reviewer.id,
      role: "REVIEWER",
      status: "ACTIVE",
      acceptedAt: new Date(),
    },
  });

  // Cliente demo
  const client = await prisma.client.upsert({
    where: { firmId_cuit: { firmId: firm.id, cuit: "20111111199" } },
    update: {},
    create: {
      firmId: firm.id,
      legalName: "Alimentos del Sur S.A.",
      cuit: "20111111199",
      status: "ACTIVE",
    },
  });

  // Asignación del revisor al cliente (maker-checker en E2E).
  await prisma.clientAssignment.upsert({
    where: { firmId_userId_clientId: { firmId: firm.id, userId: reviewer.id, clientId: client.id } },
    update: {},
    create: { firmId: firm.id, userId: reviewer.id, clientId: client.id },
  });

  const portalUser = await prisma.user.upsert({
    where: { emailNormalized: PORTAL_EMAIL },
    update: {},
    create: { emailNormalized: PORTAL_EMAIL, name: "Cliente Demo", passwordHash: await hashPassword(PORTAL_PASSWORD) },
  });
  await prisma.portalMembership.upsert({
    where: { firmId_clientId_userId: { firmId: firm.id, clientId: client.id, userId: portalUser.id } },
    update: { status: "ACTIVE", role: "OWNER", revokedAt: null },
    create: { firmId: firm.id, clientId: client.id, userId: portalUser.id, role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), invitedBy: user.id },
  });

  // Perfil
  await prisma.clientProfile.upsert({
    where: { clientId: client.id },
    update: {},
    create: { firmId: firm.id, clientId: client.id, functionalCurrency: "ARS", fiscalYearEndMonth: 12 },
  });

  // Ejercicio + períodos (12 mensuales)
  const fy = await prisma.fiscalYear.upsert({
    where: {
      clientId_startDate_endDate: {
        clientId: client.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
    },
    update: {},
    create: {
      firmId: firm.id,
      clientId: client.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      label: "2026",
      status: "OPEN",
    },
  });

  for (let m = 1; m <= 12; m++) {
    const start = new Date(Date.UTC(2026, m - 1, 1));
    const end = new Date(Date.UTC(2026, m, 0));
    await prisma.accountingPeriod.upsert({
      where: { clientId_startDate_endDate: { clientId: client.id, startDate: start, endDate: end } },
      update: {},
      create: {
        firmId: firm.id,
        clientId: client.id,
        fiscalYearId: fy.id,
        startDate: start,
        endDate: end,
        ordinal: m,
        status: "OPEN",
      },
    });
  }
  const january = await prisma.accountingPeriod.findFirstOrThrow({
    where: { clientId: client.id, ordinal: 1 },
  });

  // Cuentas
  const caja =
    (await prisma.account.findFirst({
      where: { clientId: client.id, chartVersionId: null, code: "1.1.1" },
    })) ??
    (await prisma.account.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        code: "1.1.1",
        name: "Caja",
        type: "ASSET",
        normalBalance: "DEBIT",
        isPostable: true,
        monetaryClassification: "MONETARY",
        path: "1.1.1",
      },
    }));
  const ventas =
    (await prisma.account.findFirst({
      where: { clientId: client.id, chartVersionId: null, code: "4.1.1" },
    })) ??
    (await prisma.account.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        code: "4.1.1",
        name: "Ventas",
        type: "REVENUE",
        normalBalance: "CREDIT",
        isPostable: true,
        vatRole: "IVA_DEBITO",
        path: "4.1.1",
      },
    }));

  // Asiento posteado (aporte inicial + venta) si no existe
  const existingEntry = await prisma.journalEntry.findFirst({
    where: { clientId: client.id, sequenceNumber: 1 },
  });
  if (!existingEntry) {
    await prisma.journalEntry.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        fiscalYearId: fy.id,
        periodId: january.id,
        entryDate: new Date("2026-01-15"),
        description: "Aporte inicial y venta",
        sourceType: "MANUAL",
        status: "POSTED",
        preparedByUserId: user.id,
        postedByUserId: user.id,
        postedAt: new Date(),
        sequenceNumber: 1,
        lines: {
          create: [
            {
              firmId: firm.id,
              clientId: client.id,
              position: 1,
              accountId: caja.id,
              currencyCode: "ARS",
              debitOriginal: "121000.00",
              creditOriginal: "0.00",
              debitFunctional: "121000.00",
              creditFunctional: "0.00",
            },
            {
              firmId: firm.id,
              clientId: client.id,
              position: 2,
              accountId: ventas.id,
              currencyCode: "ARS",
              debitOriginal: "0.00",
              creditOriginal: "121000.00",
              debitFunctional: "0.00",
              creditFunctional: "121000.00",
            },
          ],
        },
      },
    });
  }

  // Feature flags habilitados (TAX queda APAGADO: el IVA legacy está deshabilitado
  // por flag server-side, G0-01. La firma demo no puede liquidar.)
  const flags = ["DOCUMENTS", "LEDGER", "BANKING", "REPORTING", "PORTAL", "ASSISTANT", "BI"];
  for (const code of flags) {
    const existing = await prisma.featureFlag.findFirst({
      where: { firmId: firm.id, clientId: null, code },
    });
    if (existing) {
      await prisma.featureFlag.update({ where: { id: existing.id }, data: { enabled: true } });
    } else {
      await prisma.featureFlag.create({
        data: { firmId: firm.id, clientId: null, code, enabled: true },
      });
    }
  }

  // Documento demo (para Bandeja / Portal)
  const existingDoc = await prisma.document.findFirst({
    where: { firmId: firm.id, clientId: client.id },
  });
  if (!existingDoc) {
    await prisma.document.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        category: "FACTURA",
        direction: "INBOUND",
        status: "EXTRACTED",
        uploadOrigin: "CLIENT",
        uploadedByUserId: user.id,
      },
    });
  }

  // Plantilla + run + publicación de reporte (para Reportes / Portal)
  const template =
    (await prisma.reportTemplate.findFirst({ where: { firmId: firm.id, code: "BALANCE_SINTETICO" } })) ??
    (await prisma.reportTemplate.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        code: "BALANCE_SINTETICO",
        name: "Balance sintético",
        kind: "BALANCE",
        version: 1,
        isActive: true,
        lines: {
          create: [
            { firmId: firm.id, clientId: client.id, position: 1, code: "CAJA", label: "Caja", formulaAst: { op: "ACCOUNT", accountCode: "1.1.1" } },
            { firmId: firm.id, clientId: client.id, position: 2, code: "VENTAS", label: "Ventas", formulaAst: { op: "ACCOUNT", accountCode: "4.1.1" } },
          ],
        },
      },
    }));
  const run = await prisma.reportRun.findFirst({ where: { firmId: firm.id, clientId: client.id } });
  if (await prisma.reportTemplateLine.count({ where: { templateId: template.id } }) === 0) {
    await prisma.reportTemplateLine.createMany({ data: [
      { firmId: firm.id, clientId: client.id, templateId: template.id, position: 1, code: "CAJA", label: "Caja", formulaAst: { op: "ACCOUNT", accountCode: "1.1.1" } },
      { firmId: firm.id, clientId: client.id, templateId: template.id, position: 2, code: "VENTAS", label: "Ventas", formulaAst: { op: "ACCOUNT", accountCode: "4.1.1" } },
    ] });
  }
  if (!run) {
    const createdRun = await prisma.reportRun.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        templateId: template.id,
        templateVersion: 1,
        cutoff: new Date("2026-01-31"),
        status: "PUBLISHED",
        createdByUserId: user.id,
        publishedByUserId: user.id,
        publishedAt: new Date(),
        result: {
          templateCode: "BALANCE_SINTETICO", templateVersion: 1, cutoff: "2026-01-31",
          lines: [
            { code: "CAJA", label: "Caja", value: "121000.0000", isTotal: false, indent: 0 },
            { code: "VENTAS", label: "Ventas", value: "-121000.0000", isTotal: false, indent: 0 },
          ],
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.reportPublication.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        runId: createdRun.id,
        publishedByUserId: user.id,
      },
    });
  }

  for (const [code, name] of [["total_revenue", "Ingresos"], ["net_income", "Resultado neto"]] as const) {
    const metric = await prisma.biMetric.findFirst({ where: { firmId: firm.id, clientId: client.id, code } });
    if (!metric) await prisma.biMetric.create({ data: { firmId: firm.id, clientId: client.id, code, name, definition: { source: "LEDGER" } } });
  }

  console.log("Demo listo:");
  console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Portal: ${PORTAL_EMAIL} / ${PORTAL_PASSWORD}`);
  console.log(`  Firma: ${firm.id}`);
  console.log(`  Cliente: ${client.id}`);
  console.log(`  Ejercicio: ${fy.id} (período enero: ${january.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
