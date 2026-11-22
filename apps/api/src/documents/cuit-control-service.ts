import type { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import {
  CUIT_ESTADO,
  evaluarCuitDocumento,
  formatearCuit,
  normalizarCuit,
  type ClienteDelEstudio,
  type CuitEstado,
} from "./cuit-control.js";

/**
 * Servicio del control de CUIT de la Bandeja (brief 4A-2): estado por documento, aceptación con
 * motivo, «Mover a» otro cliente del estudio y el freno de la aprobación.
 *
 * Contexto RLS: `app_can_access_client` exige que `app.client_id` coincida con el cliente. Por eso
 * la lista de clientes del estudio (sugerencias y destino de «Mover») se lee en contexto de firma,
 * filtrada por `app_can_access_client`, y el resto de las operaciones del documento en contexto
 * del cliente.
 */

export class CuitControlError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "CuitControlError";
  }
}

const REVISABLE_STATUSES: readonly string[] = ["GENERATED", "NEEDS_REVIEW"];
const CAMPOS_CUIT_BD = [
  "cuitAcceptedExtractionId",
  "cuitAcceptedByUserId",
  "cuitAcceptedAt",
  "cuitAcceptedReason",
] as const;
const PROCESANDO = "Todavía se está procesando: esperá a que termine";

export interface CuitControlView {
  estado: CuitEstado;
  /** Falta resolverlo antes de aprobar: no es correcto y no se aceptó con motivo. */
  pendiente: boolean;
  aceptado: boolean;
  motivo: string | null;
  emisor: string | null;
  receptor: string | null;
  mensaje: string | null;
  sugerido: { clientId: string; legalName: string; cuit: string } | null;
}

type DocumentoParaControl = {
  currentExtractionId: string | null;
  cuitAcceptedExtractionId: string | null;
  cuitAcceptedReason: string | null;
};

function cuitsDelVoucher(voucherData: unknown): { emisor: string | null; receptor: string | null } {
  const voucher =
    voucherData !== null && typeof voucherData === "object" && !Array.isArray(voucherData)
      ? (voucherData as Record<string, unknown>)
      : {};
  return {
    emisor: normalizarCuit(voucher["cuit_emisor"]),
    receptor: normalizarCuit(voucher["cuit_receptor"]),
  };
}

function vista(
  evaluacion: ReturnType<typeof evaluarCuitDocumento>,
  aceptado: boolean,
  motivo: string | null,
): CuitControlView {
  return {
    estado: evaluacion.estado,
    pendiente: evaluacion.estado !== CUIT_ESTADO.CORRECTO && !aceptado,
    aceptado,
    motivo: aceptado ? motivo : null,
    emisor: evaluacion.emisor ? formatearCuit(evaluacion.emisor) : null,
    receptor: evaluacion.receptor ? formatearCuit(evaluacion.receptor) : null,
    mensaje: evaluacion.mensaje,
    sugerido: evaluacion.sugerido
      ? { clientId: evaluacion.sugerido.id, legalName: evaluacion.sugerido.legalName, cuit: evaluacion.sugerido.cuit }
      : null,
  };
}

/** Clientes del estudio a los que el usuario tiene acceso, sin el cliente actual. */
export async function otrosClientesDelEstudio(
  tx: Prisma.TransactionClient,
  firmId: string,
  clientId: string,
): Promise<ClienteDelEstudio[]> {
  return tx.$queryRaw<ClienteDelEstudio[]>`
    SELECT "id", "legalName", "cuit"
    FROM "clients"
    WHERE "firmId" = ${firmId}
      AND "id" <> ${clientId}
      AND app_can_access_client(${firmId}, "id")
    ORDER BY "legalName"
  `;
}

/**
 * Adjunta el control de CUIT a cada documento de la lista o del detalle. Los campos de aceptación
 * de la base no salen en la respuesta. El portal no recibe control: las sugerencias nombran otros
 * clientes del estudio.
 */
export async function adjuntarControlCuit<T extends DocumentoParaControl & { id: string; status: string }>(
  ctx: TenantContext,
  clientId: string,
  documentos: readonly T[],
): Promise<Array<Omit<T, (typeof CAMPOS_CUIT_BD)[number]> & { cuitControl: CuitControlView | null }>> {
  const sinCampos = (documento: T) => {
    const copia: Record<string, unknown> = { ...documento };
    for (const campo of CAMPOS_CUIT_BD) delete copia[campo];
    return copia as Omit<T, (typeof CAMPOS_CUIT_BD)[number]>;
  };

  if (ctx.actorKind === "PORTAL" || documentos.length === 0) {
    return documentos.map((documento) => ({ ...sinCampos(documento), cuitControl: null }));
  }

  const ids = documentos.map((d) => d.currentExtractionId).filter((id): id is string => Boolean(id));
  const extracciones = ids.length === 0
    ? []
    : await withTenantContext(ctx, (tx) =>
        tx.documentExtraction.findMany({
          where: { firmId: ctx.firmId, clientId, id: { in: ids } },
          select: { id: true, status: true, voucherData: true },
        }),
      );

  const necesitaControl = extracciones.some((e) => REVISABLE_STATUSES.includes(e.status));
  const firmCtx: TenantContext = { userId: ctx.userId, firmId: ctx.firmId, actorKind: ctx.actorKind };
  const contexto = necesitaControl
    ? await withTenantContext(firmCtx, async (tx) => {
        const cliente = await tx.client.findFirst({
          where: { id: clientId, firmId: ctx.firmId },
          select: { legalName: true, cuit: true },
        });
        return {
          cliente,
          otros: await otrosClientesDelEstudio(tx, ctx.firmId, clientId),
        };
      })
    : null;

  return documentos.map((documento) => {
    const extraccion = extracciones.find((e) => e.id === documento.currentExtractionId);
    if (!extraccion || !REVISABLE_STATUSES.includes(extraccion.status) || !contexto?.cliente) {
      return { ...sinCampos(documento), cuitControl: null };
    }
    const { emisor, receptor } = cuitsDelVoucher(extraccion.voucherData);
    const evaluacion = evaluarCuitDocumento({
      clienteNombre: contexto.cliente.legalName,
      clienteCuit: contexto.cliente.cuit,
      emisor,
      receptor,
      otrosClientes: contexto.otros,
    });
    const aceptado = documento.cuitAcceptedExtractionId === extraccion.id;
    return {
      ...sinCampos(documento),
      cuitControl: vista(evaluacion, aceptado, documento.cuitAcceptedReason),
    };
  });
}

/**
 * Freno de la aprobación (P1): un comprobante cuyo CUIT no es el del cliente no se aprueba hasta
 * que se resuelva («Mover a» o aceptarlo con motivo). Se evalúa con el CUIT del cliente y el de la
 * extracción que se aprueba; las sugerencias no cambian si el paso está pendiente.
 */
export async function assertCuitResueltoEnAprobacion(
  tx: Prisma.TransactionClient,
  firmId: string,
  clientId: string,
  documentId: string,
  extraccion: { id: string; voucherData: unknown },
): Promise<void> {
  const cliente = await tx.client.findFirst({
    where: { id: clientId, firmId },
    select: { legalName: true, cuit: true },
  });
  if (!cliente) throw new CuitControlError("CLIENT_NOT_FOUND", 404, "Cliente no encontrado");

  const documento = await tx.document.findFirst({
    where: { id: documentId, firmId, clientId },
    select: { cuitAcceptedExtractionId: true },
  });
  const { emisor, receptor } = cuitsDelVoucher(extraccion.voucherData);
  const evaluacion = evaluarCuitDocumento({
    clienteNombre: cliente.legalName,
    clienteCuit: cliente.cuit,
    emisor,
    receptor,
    otrosClientes: [],
  });
  if (evaluacion.estado === CUIT_ESTADO.CORRECTO) return;
  if (documento?.cuitAcceptedExtractionId === extraccion.id) return;
  throw new CuitControlError(
    "CUIT_PENDIENTE",
    409,
    `Falta revisar el CUIT del comprobante antes de aprobarlo. ${evaluacion.mensaje ?? ""}`.trim(),
  );
}

/** Acepta con motivo el CUIT ajeno de un comprobante leído: queda registrado quién, cuándo y por qué. */
export async function aceptarCuit(
  ctx: TenantContext,
  clientId: string,
  documentId: string,
  motivo: string,
): Promise<{ aceptado: true }> {
  return withTenantContext(ctx, async (tx) => {
    const documento = await tx.document.findFirst({
      where: { id: documentId, firmId: ctx.firmId, clientId },
      select: { id: true, status: true, currentExtractionId: true, cuitAcceptedExtractionId: true },
    });
    if (!documento) throw new CuitControlError("DOCUMENT_NOT_FOUND", 404, "Documento no encontrado");
    if (documento.status !== "EXTRACTED") {
      throw new CuitControlError(
        "DOCUMENT_NOT_REVIEWABLE",
        409,
        "Solo se acepta el CUIT de un documento leído y pendiente de aprobación",
      );
    }
    const extraccion = documento.currentExtractionId
      ? await tx.documentExtraction.findFirst({
          where: { id: documento.currentExtractionId, firmId: ctx.firmId, clientId },
          select: { id: true, status: true, voucherData: true },
        })
      : null;
    if (!extraccion || !REVISABLE_STATUSES.includes(extraccion.status)) {
      throw new CuitControlError(
        "DOCUMENT_NOT_REVIEWABLE",
        409,
        "La lectura de este documento ya no está pendiente de revisión",
      );
    }
    if (documento.cuitAcceptedExtractionId === extraccion.id) {
      throw new CuitControlError("CUIT_YA_ACEPTADO", 409, "Ya aceptaste el CUIT de este comprobante");
    }
    const cliente = await tx.client.findFirst({
      where: { id: clientId, firmId: ctx.firmId },
      select: { legalName: true, cuit: true },
    });
    if (!cliente) throw new CuitControlError("CLIENT_NOT_FOUND", 404, "Cliente no encontrado");
    const { emisor, receptor } = cuitsDelVoucher(extraccion.voucherData);
    const evaluacion = evaluarCuitDocumento({
      clienteNombre: cliente.legalName,
      clienteCuit: cliente.cuit,
      emisor,
      receptor,
      otrosClientes: [],
    });
    if (evaluacion.estado === CUIT_ESTADO.CORRECTO) {
      throw new CuitControlError("CUIT_EN_ORDEN", 409, "El CUIT de este comprobante ya coincide con el cliente");
    }

    const aceptadoEn = new Date();
    await tx.document.update({
      where: { id: documentId },
      data: {
        cuitAcceptedExtractionId: extraccion.id,
        cuitAcceptedByUserId: ctx.userId,
        cuitAcceptedAt: aceptadoEn,
        cuitAcceptedReason: motivo,
      },
    });
    await tx.auditEvent.create({
      data: {
        firmId: ctx.firmId,
        clientId,
        userId: ctx.userId,
        actorKind: ctx.actorKind,
        action: "document.cuit.accepted",
        entityType: "Document",
        entityId: documentId,
        before: { estado: evaluacion.estado },
        after: { extractionId: extraccion.id, reason: motivo, acceptedAt: aceptadoEn.toISOString() },
      },
    });
    return { aceptado: true as const };
  });
}

/**
 * «Mover a <cliente>»: pasa el documento y sus filas hijas al cliente elegido del mismo estudio.
 * Solo se mueve un documento que todavía no se aprobó y que no está vinculado a pedidos,
 * comprobantes ni gastos. Corre en contexto de firma para poder escribir en el cliente destino.
 */
export async function moverDocumentoACliente(
  ctx: TenantContext,
  clientId: string,
  documentId: string,
  clienteDestinoId: string,
): Promise<{ clientId: string }> {
  if (clienteDestinoId === clientId) {
    throw new CuitControlError("MISMO_CLIENTE", 400, "Elegí otro cliente: el comprobante ya está en este");
  }
  const firmCtx: TenantContext = { userId: ctx.userId, firmId: ctx.firmId, actorKind: ctx.actorKind };
  return withTenantContext(firmCtx, async (tx) => {
    const documento = await tx.document.findFirst({
      where: { id: documentId, firmId: ctx.firmId, clientId },
      select: {
        id: true,
        status: true,
        _count: {
          select: {
            fiscalVouchers: true,
            expenseEvidence: true,
            evidenceLinks: true,
            requestItems: true,
            taxFilings: true,
            taxFilingDeclarations: true,
          },
        },
      },
    });
    if (!documento) throw new CuitControlError("DOCUMENT_NOT_FOUND", 404, "Documento no encontrado");
    if (documento.status !== "EXTRACTED") {
      throw new CuitControlError(
        "DOCUMENT_NOT_MOVABLE",
        409,
        "Solo se mueve un documento que todavía no se aprobó",
      );
    }
    const vinculos = Object.values(documento._count).reduce((total, n) => total + n, 0);
    if (vinculos > 0) {
      throw new CuitControlError(
        "DOCUMENT_LINKED",
        409,
        "Este documento ya está vinculado a un pedido, comprobante o gasto: no se puede mover",
      );
    }
    const activo = await tx.documentProcessingJob.findFirst({
      where: { firmId: ctx.firmId, clientId, documentId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    if (activo) throw new CuitControlError("DOCUMENT_STILL_PROCESSING", 409, PROCESANDO);

    const destino = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "clients"
      WHERE "firmId" = ${ctx.firmId}
        AND "id" = ${clienteDestinoId}
        AND app_can_access_client(${ctx.firmId}, "id")
    `;
    if (destino.length === 0) {
      throw new CuitControlError(
        "CLIENT_NOT_FOUND",
        404,
        "No encontramos ese cliente o no tenés acceso a él",
      );
    }

    const extracciones = await tx.documentExtraction.findMany({
      where: { firmId: ctx.firmId, clientId, documentId },
      select: { id: true },
    });
    const extraccionIds = extracciones.map((e) => e.id);

    const movido = await tx.document.updateMany({
      where: { id: documentId, firmId: ctx.firmId, clientId, status: "EXTRACTED" },
      data: {
        clientId: clienteDestinoId,
        cuitAcceptedExtractionId: null,
        cuitAcceptedByUserId: null,
        cuitAcceptedAt: null,
        cuitAcceptedReason: null,
      },
    });
    if (movido.count !== 1) {
      throw new CuitControlError(
        "DOCUMENT_STATE_CHANGED",
        409,
        "El estado del documento cambió. Actualizá la bandeja e intentá de nuevo",
      );
    }
    const filas = { firmId: ctx.firmId, clientId };
    await tx.documentFileVersion.updateMany({ where: { ...filas, documentId }, data: { clientId: clienteDestinoId } });
    await tx.documentProcessingJob.updateMany({ where: { ...filas, documentId }, data: { clientId: clienteDestinoId } });
    await tx.documentExtraction.updateMany({ where: { ...filas, documentId }, data: { clientId: clienteDestinoId } });
    await tx.extractedField.updateMany({
      where: { ...filas, extractionId: { in: extraccionIds } },
      data: { clientId: clienteDestinoId },
    });
    await tx.extractedLineItem.updateMany({
      where: { ...filas, extractionId: { in: extraccionIds } },
      data: { clientId: clienteDestinoId },
    });
    await tx.auditEvent.create({
      data: {
        firmId: ctx.firmId,
        clientId: clienteDestinoId,
        userId: ctx.userId,
        actorKind: ctx.actorKind,
        action: "document.cuit.moved",
        entityType: "Document",
        entityId: documentId,
        before: { clientId },
        after: { clientId: clienteDestinoId },
      },
    });
    return { clientId: clienteDestinoId };
  });
}
