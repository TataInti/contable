import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { VoucherPermissionsError, VoucherPermissionsService } from "./voucher-permissions-service.js";
import { MonthlyWorkpaperService, WorkpaperError } from "./workpaper-service.js";
import { gruposDeComprobantes, loadPerfilPermitido } from "./voucher-permissions-core.js";
import { PREFIJO_CONTROL_PERFIL } from "./voucher-profile.js";

/**
 * Corte 4B: tipos de comprobante permitidos por cliente y grupos «no corresponde al perfil».
 * Datos sembrados (seed:piloto): cliente monotributista con expediente de octubre 2026 en READY_TO_CALCULATE.
 * Los comprobantes de la prueba son inventados, se marcan con RUN y se borran al terminar.
 */

const FIRM = "3a1a835e-aedb-4575-9cd5-a57db1383345";
const CLIENT = "01a203bc-3e51-73eb-87d6-9810715441ef";
const WORKPAPER = "01a203bc-3f07-7639-83d9-7b4a3e1d8b1c";
const USER = "11111111-1111-4111-8111-111111111111";
const YEAR = 2026;
const RUN = randomUUID().slice(0, 8);
const CTX = { userId: USER, firmId: FIRM, clientId: CLIENT, actorKind: "USER" as const };
const CUIT_CLIENTE_SINTETICO = "20999999993";
const CUIT_CONTRAPARTE_SINTETICA = "27888888883";

const permisos = new VoucherPermissionsService();
const expedientes = new MonthlyWorkpaperService();
const createdVoucherIds: string[] = [];

async function crearVenta(letter: "A" | "C", numero: number, exento = false) {
  const voucher = await prisma.fiscalVoucher.create({
    data: {
      firmId: FIRM,
      clientId: CLIENT,
      direction: "SALE",
      type: letter,
      letter,
      pointOfSale: 1,
      number: numero,
      issuerCuit: CUIT_CLIENTE_SINTETICO,
      receiverCuit: CUIT_CONTRAPARTE_SINTETICA,
      issuedOn: new Date("2026-10-10T00:00:00Z"),
      total: "1210.0000",
      components: {
        create: [
          { firmId: FIRM, clientId: CLIENT, concept: "NETO", base: "1000", amount: "1000" },
          ...(exento
            ? [{ firmId: FIRM, clientId: CLIENT, concept: "EXENTO", base: "210", amount: "210" }]
            : []),
        ],
      },
    },
  });
  createdVoucherIds.push(voucher.id);
  const classification = await prisma.workpaperVoucherClassification.create({
    data: {
      firmId: FIRM,
      clientId: CLIENT,
      workpaperId: WORKPAPER,
      voucherId: voucher.id,
      direction: "SALE",
      counterpartyCuit: CUIT_CONTRAPARTE_SINTETICA,
      documentKind: "INVOICE",
      rateBuckets: [],
      status: "CLASSIFIED",
    },
  });
  return { voucher, classification };
}

async function controlesDelPerfil() {
  return prisma.taxControlFinding.findMany({
    where: { workpaperId: WORKPAPER, code: { startsWith: PREFIJO_CONTROL_PERFIL } },
  });
}

async function materializar(sourceHash: string) {
  // Sin liquidación hija: el control se materializa como en el cálculo (la función es privada, se llama directo).
  const svc = expedientes as unknown as {
    materializeControls: (tx: unknown, input: object) => Promise<void>;
  };
  await prisma.$transaction((tx) =>
    svc.materializeControls(tx, {
      workpaperId: WORKPAPER,
      firmId: FIRM,
      clientId: CLIENT,
      sourceHash,
      sources: [],
      components: [],
      allocationsReady: true,
      allocationsCount: 0,
      periodYear: YEAR,
    }),
  );
}

beforeAll(async () => {
  await prisma.clientVoucherPermission.deleteMany({ where: { clientId: CLIENT, year: YEAR } });
});

afterAll(async () => {
  await prisma.taxControlFinding.deleteMany({
    where: { workpaperId: WORKPAPER, code: { startsWith: PREFIJO_CONTROL_PERFIL } },
  });
  await prisma.workpaperVoucherClassification.deleteMany({ where: { voucherId: { in: createdVoucherIds } } });
  await prisma.fiscalComponent.deleteMany({ where: { voucherId: { in: createdVoucherIds } } });
  await prisma.fiscalVoucher.deleteMany({ where: { id: { in: createdVoucherIds } } });
  await prisma.clientVoucherPermission.deleteMany({ where: { clientId: CLIENT, year: YEAR } });
  await prisma.$disconnect().catch(() => undefined);
});

describe("tildes de comprobantes por cliente (corte 4B)", () => {
  it("sin fila guardada, rige la propuesta de la condición (monotributista: C y sus notas)", async () => {
    const estado = await permisos.get(CTX, { clientId: CLIENT, year: YEAR });
    expect(estado.origen).toBe("PROPUESTA");
    expect(estado.condicion).toBe("MONOTRIBUTISTA");
    expect(estado.allowedClasses).toEqual(["FACTURA_C", "NOTAS_C"]);
    expect(estado.exemptAllowed).toBe(false);
    expect(estado.offered).toContain("FACTURA_E");
    expect(estado.savedAt).toBeNull();
  });

  it("guardar tildes las fija por año, con quién y cuándo", async () => {
    const guardado = await permisos.set(CTX, {
      clientId: CLIENT,
      year: YEAR,
      allowedClasses: ["FACTURA_C", "FACTURA_A", "FACTURA_A"],
      exemptAllowed: true,
    });
    expect(guardado.origen).toBe("GUARDADO");
    expect(guardado.allowedClasses).toEqual(["FACTURA_C", "FACTURA_A"]);
    expect(guardado.exemptAllowed).toBe(true);
    expect(guardado.savedAt).not.toBeNull();
    const fila = await prisma.clientVoucherPermission.findUnique({
      where: { firmId_clientId_year: { firmId: FIRM, clientId: CLIENT, year: YEAR } },
    });
    expect(fila?.createdByUserId).toBe(USER);
    expect(fila?.updatedByUserId).toBe(USER);
  });

  it("una clase fuera del catálogo se rechaza con el campo y el motivo", async () => {
    await expect(
      permisos.set(CTX, { clientId: CLIENT, year: YEAR, allowedClasses: ["FACTURA_Z"], exemptAllowed: false }),
    ).rejects.toBeInstanceOf(VoucherPermissionsError);
  });

  it("el permitido efectivo del año lee las tildes guardadas", async () => {
    const permitido = await prisma.$transaction((tx) =>
      loadPerfilPermitido(tx, { firmId: FIRM, clientId: CLIENT, year: YEAR }),
    );
    expect(permitido.origen).toBe("GUARDADO");
    expect(permitido.clases).toEqual(["FACTURA_C", "FACTURA_A"]);
    expect(permitido.exentos).toBe(true);
  });
});

describe("grupos «no corresponde al perfil» en el expediente (corte 4B)", () => {
  it("una factura A con tilde guardada no tiene grupo; sin esa tilde, la factura A cae en FACTURA_A", async () => {
    const { voucher, classification } = await crearVenta("A", 900001 + Number(RUN.slice(0, 4).replace(/\D/g, "1")));
    const filas = await prisma.workpaperVoucherClassification.findMany({
      where: { id: classification.id },
      include: { voucher: { include: { components: true, importRow: { select: { raw: true } } } } },
    });
    const conTilde = await prisma.$transaction((tx) =>
      loadPerfilPermitido(tx, { firmId: FIRM, clientId: CLIENT, year: YEAR }),
    );
    expect(gruposDeComprobantes(filas, conTilde).size).toBe(0);

    const sinTilde = { clases: ["FACTURA_C" as const], exentos: false, origen: "GUARDADO" as const, condicion: null };
    const grupos = gruposDeComprobantes(filas, sinTilde);
    expect([...grupos.keys()]).toEqual(["FACTURA_A"]);
    expect(grupos.get("FACTURA_A")?.[0]?.voucher.id).toBe(voucher.id);
  });

  it("materializa un control bloqueante por grupo; excluir con motivo lo resuelve y lo registra", async () => {
    // Estado de la prueba: tildes con FACTURA_A y C; se quitan las A para que el grupo aparezca.
    await permisos.set(CTX, { clientId: CLIENT, year: YEAR, allowedClasses: ["FACTURA_C"], exemptAllowed: true });
    const { classification } = await crearVenta("A", 900002);
    await materializar(`hash-4b-${RUN}-1`);
    const controles = await controlesDelPerfil();
    const grupoA = controles.find((control) => control.code === `${PREFIJO_CONTROL_PERFIL}FACTURA_A`);
    expect(grupoA).toBeTruthy();
    expect(grupoA?.severity).toBe("BLOCKING");
    expect(grupoA?.status).toBe("OPEN");
    expect(Number(grupoA?.actual)).toBe(2);

    await expect(expedientes.excludeProfileGroup(CTX, WORKPAPER, "FACTURA_A", "   ")).rejects.toBeInstanceOf(
      WorkpaperError,
    );
    await expedientes.excludeProfileGroup(CTX, WORKPAPER, "FACTURA_A", "Factura emitida por error de carga");
    const excluido = await prisma.workpaperVoucherClassification.findUnique({ where: { id: classification.id } });
    expect(excluido?.excludedAt).not.toBeNull();
    expect(excluido?.excludedReason).toBe("Factura emitida por error de carga");

    await expect(expedientes.excludeProfileGroup(CTX, WORKPAPER, "FACTURA_A", "otra vez")).rejects.toBeInstanceOf(
      WorkpaperError,
    );
  });

  it("aceptar con motivo deja el comprobante registrado como del cliente y el grupo deja de bloquear", async () => {
    const { classification } = await crearVenta("A", 900003);
    await expedientes.acceptProfileGroup(CTX, WORKPAPER, "FACTURA_A", "Factura de un trabajo puntual del año");
    const aceptado = await prisma.workpaperVoucherClassification.findUnique({ where: { id: classification.id } });
    expect(aceptado?.profileAcceptedAt).not.toBeNull();
    expect(aceptado?.profileAcceptedByUserId).toBe(USER);
    expect(aceptado?.profileAcceptedReason).toBe("Factura de un trabajo puntual del año");

    await materializar(`hash-4b-${RUN}-2`);
    const controles = await controlesDelPerfil();
    const abiertos = controles.filter((control) => control.status === "OPEN");
    expect(abiertos.map((control) => control.code)).not.toContain(`${PREFIJO_CONTROL_PERFIL}FACTURA_A`);
    const anterior = controles.find((control) => control.sourceHash === `hash-4b-${RUN}-1`);
    expect(anterior?.status).toBe("RESOLVED");
  });

  it("un exento sin tilde de exentos forma el grupo EXENTO; con la tilde deja de bloquear", async () => {
    await permisos.set(CTX, { clientId: CLIENT, year: YEAR, allowedClasses: ["FACTURA_C"], exemptAllowed: false });
    await crearVenta("C", 900004, true);
    await materializar(`hash-4b-${RUN}-3`);
    const exentos = (await controlesDelPerfil()).filter(
      (control) => control.code === `${PREFIJO_CONTROL_PERFIL}EXENTO` && control.status === "OPEN",
    );
    expect(exentos).toHaveLength(1);
    expect(Number(exentos[0]?.actual)).toBe(1);

    await permisos.set(CTX, { clientId: CLIENT, year: YEAR, allowedClasses: ["FACTURA_C"], exemptAllowed: true });
    await materializar(`hash-4b-${RUN}-4`);
    const abiertosTrasTilde = (await controlesDelPerfil()).filter(
      (control) => control.code === `${PREFIJO_CONTROL_PERFIL}EXENTO` && control.status === "OPEN",
    );
    expect(abiertosTrasTilde).toHaveLength(0);
  });
});
