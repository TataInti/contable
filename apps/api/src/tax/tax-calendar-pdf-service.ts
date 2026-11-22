import { createHash, createHmac, randomUUID } from "node:crypto";
import type { CreateTaxCalendarFromPdfInput } from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { loadAiClientConfig } from "../assistant/assistant-service.js";
import { BUCKETS, ObjectStorage } from "../storage/object-storage.js";
import { TaxCalendarError, TaxCalendarRegistryService } from "./tax-calendar-service.js";
import {
  MOTIVO_LECTURA_FALLIDA,
  MOTIVO_LECTURA_NO_DISPONIBLE,
  PdfCalendarioInvalidoError,
  decodificarPdfCalendario as decodificarPdfPuro,
  motivoDeLecturaFallida,
} from "./tax-calendar-pdf-lectura.js";

/** Valida el PDF recibido; un archivo que no sirve es un error 422 de calendarios (CALENDAR_SOURCE_INVALID). */
function decodificarPdfCalendario(pdfBase64: string): Buffer {
  try {
    return decodificarPdfPuro(pdfBase64);
  } catch (err) {
    if (err instanceof PdfCalendarioInvalidoError) {
      throw new TaxCalendarError("CALENDAR_SOURCE_INVALID", err.message, { path: ["pdfBase64"] });
    }
    throw err;
  }
}

/**
 * Alta de un calendario fiscal desde su PDF (brief 5A). La IA propone las celdas; el
 * usuario las revisa y publica con el flujo de siempre. La IA devuelve filas en el mismo
 * formato CSV que la importación, así que el mapeo, las dudosas (FLAGGED) y los rechazos
 * por fila son los del corte 2b-1.
 */

export interface RespuestaLectorCalendario {
  estado: "LEIDO" | "NO_LEIDO";
  /** CSV con las columnas de la importación (solo si estado = LEIDO). */
  csv: string | null;
  paginas: number | null;
  /** Motivo en español para la pantalla (solo si NO_LEIDO). */
  motivo: string | null;
}

export type LectorCalendario = (input: {
  firmId: string;
  pdf: Buffer;
  sha256: string;
  calendario: { organismo: string; jurisdiccion: string; anio: number; titulo: string };
}) => Promise<RespuestaLectorCalendario>;

export type LecturaCalendarioPdf =
  | { estado: "LEIDA"; paginas: number | null; importadas: number; rechazadas: number; dudosas: number; motivo: null }
  | { estado: "SIN_LECTURA"; paginas: number | null; importadas: 0; rechazadas: 0; dudosas: 0; motivo: string };

/** Llama al servicio de IA con la misma firma HMAC que el resto de las llamadas internas (A-004). */
export const leerCalendarioConIa: LectorCalendario = async ({ firmId, pdf, sha256, calendario }) => {
  const config = loadAiClientConfig();
  const path = "/internal/v1/calendar-extractions";
  const payload = {
    contractVersion: "calendar-ar-v1",
    runId: randomUUID(),
    firmId,
    calendar: {
      organismo: calendario.organismo,
      jurisdiccion: calendario.jurisdiccion,
      anio: calendario.anio,
      titulo: calendario.titulo,
    },
    source: {
      pdfBase64: pdf.toString("base64"),
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      sha256,
    },
  };
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const message = `POST${path}${timestamp}${nonce}${bodyHash}`;
  const signature = createHmac("sha256", config.secret).update(message).digest("hex");

  // Un PDF de varias páginas puede tardar: el tope lo fija la IA (55 s por el modelo) con margen.
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Id": config.serviceId,
      "X-Service-Timestamp": timestamp,
      "X-Service-Nonce": nonce,
      "X-Service-Signature": signature,
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null;
    return { estado: "NO_LEIDO", csv: null, paginas: null, motivo: motivoDeLecturaFallida(detail) };
  }
  const paginas = typeof data?.pageCount === "number" ? data.pageCount : null;
  if (data?.status === "READ" && typeof data.csv === "string") {
    return { estado: "LEIDO", csv: data.csv, paginas, motivo: null };
  }
  const reason = typeof data?.reason === "string" ? data.reason : null;
  return { estado: "NO_LEIDO", csv: null, paginas, motivo: motivoDeLecturaFallida(reason) };
};

export class TaxCalendarPdfService {
  constructor(
    private readonly storage: Pick<ObjectStorage, "put" | "getPresignedGetUrl"> = new ObjectStorage(),
    private readonly leer: LectorCalendario = leerCalendarioConIa,
    private readonly registro = new TaxCalendarRegistryService(),
  ) {}

  /**
   * Guarda el PDF como fuente, crea el borrador enlazado a ella, pide la lectura a la IA e
   * importa las celdas propuestas con el impuesto elegido. Si la lectura falla, el borrador
   * queda vacío y la pantalla ofrece completarlo a mano sobre el PDF.
   */
  async createFromPdf(ctx: TenantContext, input: CreateTaxCalendarFromPdfInput) {
    const pdf = decodificarPdfCalendario(input.pdfBase64);
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    const storageKey = `tax-calendar-sources/${ctx.firmId}/${sha256}.pdf`;
    await this.storage.put(BUCKETS.originals, storageKey, pdf, pdf.length);

    const source = await withTenantContext(ctx, (tx) =>
      tx.taxCalendarSource.upsert({
        where: { firmId_sha256: { firmId: ctx.firmId, sha256 } },
        create: {
          firmId: ctx.firmId,
          storageKey,
          sha256,
          byteSize: pdf.length,
          mimeType: "application/pdf",
          originalName: input.originalName ?? null,
          uploadedByUserId: ctx.userId,
        },
        update: {},
      }),
    );

    const creado = await this.registro.create(ctx, {
      taxAuthorityId: input.taxAuthorityId,
      jurisdictionId: input.jurisdictionId,
      year: input.year,
      title: input.title,
    });
    await withTenantContext(ctx, (tx) =>
      tx.taxCalendar.update({ where: { id: creado.id }, data: { sourceId: source.id } }),
    );

    const detalle = await this.registro.get(ctx, creado.id);
    const respuesta = await this.leer({
      firmId: ctx.firmId,
      pdf,
      sha256,
      calendario: {
        organismo: detalle.taxAuthority.name,
        jurisdiccion: detalle.jurisdiction.name,
        anio: input.year,
        titulo: input.title,
      },
    }).catch((): RespuestaLectorCalendario => ({
      estado: "NO_LEIDO",
      csv: null,
      paginas: null,
      motivo: MOTIVO_LECTURA_NO_DISPONIBLE,
    }));

    let lectura: LecturaCalendarioPdf;
    if (respuesta.estado === "LEIDO" && respuesta.csv !== null) {
      try {
        const informe = await this.registro.importEntries(ctx, creado.id, {
          csv: respuesta.csv,
          dryRun: false,
          taxTypeId: input.taxTypeId,
        });
        lectura =
          informe.importadas > 0
            ? { estado: "LEIDA", paginas: respuesta.paginas, importadas: informe.importadas, rechazadas: informe.rechazadas.length, dudosas: 0, motivo: null }
            : { estado: "SIN_LECTURA", paginas: respuesta.paginas, importadas: 0, rechazadas: 0, dudosas: 0, motivo: "La IA no encontró celdas en el PDF. Completá las celdas a mano sobre el PDF." };
      } catch (err) {
        if (!(err instanceof TaxCalendarError)) throw err;
        lectura = { estado: "SIN_LECTURA", paginas: respuesta.paginas, importadas: 0, rechazadas: 0, dudosas: 0, motivo: `La lectura no se pudo importar: ${err.message}. Completá las celdas a mano sobre el PDF.` };
      }
    } else {
      lectura = { estado: "SIN_LECTURA", paginas: respuesta.paginas, importadas: 0, rechazadas: 0, dudosas: 0, motivo: respuesta.motivo ?? MOTIVO_LECTURA_FALLIDA };
    }

    const calendario = await this.registro.get(ctx, creado.id);
    const dudosas = calendario.entries.filter((entry) => entry.reviewState === "FLAGGED").length;
    return {
      calendar: calendario,
      lectura: lectura.estado === "LEIDA" ? { ...lectura, dudosas } : lectura,
    };
  }

  /** URL temporal del PDF fuente del calendario; null si el calendario no tiene PDF. */
  async sourceUrl(ctx: TenantContext, calendarId: string) {
    const calendario = await withTenantContext(ctx, (tx) =>
      tx.taxCalendar.findFirst({
        where: { id: calendarId, firmId: ctx.firmId },
        select: { source: { select: { storageKey: true, originalName: true, mimeType: true } } },
      }),
    );
    if (!calendario) throw new TaxCalendarError("CALENDAR_NOT_FOUND", "No encontramos el calendario");
    if (!calendario.source) return null;
    const url = await this.storage.getPresignedGetUrl(BUCKETS.originals, calendario.source.storageKey, 300);
    return { url, originalName: calendario.source.originalName, mimeType: calendario.source.mimeType };
  }
}
