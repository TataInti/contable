// Arnés de las pruebas del detalle de la Bandeja documental (Foco 7b.3a).
// El fetch simulado está a nivel de red: el cliente HTTP, el QueryClient y el proveedor de avisos son los reales.
// Datos sintéticos «Demo»; ninguno de estos valores llega a producción.
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@contable/design-system";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyBandeja } from "./StudyBandeja";

export const BASE = "/api/v1/firms/firm-a/clients/client-a";
export const RUTA_DOCUMENTOS = `${BASE}/documents`;
export const PENDIENTE = "pendiente";

export interface RespuestaSimulada {
  status: number;
  cuerpo: unknown;
}

export type Respuesta = RespuestaSimulada | typeof PENDIENTE;
/** Respuesta fija, o una función que la decide en cada petición (para cambiarla entre reintentos). */
export type Fuente = Respuesta | (() => Respuesta);

export const ERROR_SERVIDOR: RespuestaSimulada = {
  status: 500,
  cuerpo: { error: { code: "INTERNAL_ERROR", message: "Error interno" } },
};

export function contexto(
  capacidades: string[] = ["client.read", "document.upload", "document.review"],
): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

/** fetch simulado: cada petición la resuelve `ruta`. Las respuestas `PENDIENTE` no llegan nunca. */
export function fetchSimulado(ruta: (método: string, url: string) => Respuesta) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const respuesta = ruta((init?.method ?? "GET").toUpperCase(), url);
    if (respuesta === PENDIENTE) return new Promise<Response>(() => undefined);
    return new Response(JSON.stringify(respuesta.cuerpo), {
      status: respuesta.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Documento «Demo» en un estado. `extra` pisa campos (processingJobs, fileVersions…). */
export function documento(
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    status,
    createdAt: "2026-10-31T12:00:00.000Z",
    category: null,
    direction: null,
    fileVersions: [
      {
        id: `fv-${id}`,
        originalName: "factura.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        bucket: "originals",
        antivirusStatus: "CLEAN",
      },
    ],
    processingJobs: [],
    ...extra,
  };
}

/** Extracción «Demo». Sin datos no hay campos que aprobar. */
export function extraccion({
  conDatos = true,
  status = "NEEDS_REVIEW",
}: { conDatos?: boolean; status?: string } = {}) {
  return {
    id: "extraction-a",
    status,
    schemaVersion: "voucher-ar-v2.1",
    ocrEngine: "multimodal-model",
    promptVersion: "vision-ar-v6",
    reviewReason: null,
    voucherData: conDatos
      ? {
          tipo_documento: "factura",
          letra: "A",
          punto_venta: "0004",
          numero: "00001234",
          fecha: "2026-10-31",
          hora: "10:15:00",
          cuit_emisor: "20123456786",
          cuit_receptor: "30712345678",
          razon_social_emisor: "Proveedor S.A.",
          razon_social_receptor: "Cliente S.R.L.",
          condicion_iva: "Responsable inscripto",
          neto_gravado: "1000.00",
          iva: [{ alicuota: "21", importe: "210.00" }],
          no_gravado: "0.00",
          exento: "0.00",
          percepciones: [],
          total: "1210.00",
          moneda: "ARS",
          cae: "12345678901234",
          cae_vencimiento: "2026-11-10",
          confianza: {},
        }
      : null,
    fields: conDatos
      ? [
          {
            id: "field-cuit",
            key: "issuerTaxId",
            rawValue: "20123456786",
            normalizedValue: "20123456786",
            correction: null,
            confidence: 0.98,
            status: "ACCEPTED",
            reason: null,
          },
        ]
      : [],
    items: [],
  };
}

/** Ruta de la Bandeja para un documento: lista, pedidos, detalle, extracción, vista previa y aprobación. */
export function rutaBandeja(
  doc: Record<string, unknown>,
  opciones: { detalle?: Fuente; extraccion?: Fuente; preview?: Fuente; aprobar?: Fuente } = {},
): (método: string, url: string) => Respuesta {
  const id = String(doc.id);
  const resolver = (fuente: Fuente | undefined, porDefecto: Respuesta): Respuesta => {
    if (fuente === undefined) return porDefecto;
    return typeof fuente === "function" ? fuente() : fuente;
  };
  return (método, url) => {
    if (url === RUTA_DOCUMENTOS) return { status: 200, cuerpo: { data: [doc] } };
    if (url === `${BASE}/document-requests`) return { status: 200, cuerpo: { data: [] } };
    if (url === `${BASE}/documents/${id}`)
      return resolver(opciones.detalle, { status: 200, cuerpo: { data: doc } });
    if (url === `${BASE}/documents/${id}/extraction`)
      return resolver(opciones.extraccion, { status: 200, cuerpo: { data: extraccion() } });
    if (url === `${BASE}/documents/${id}/preview`)
      return resolver(opciones.preview, {
        status: 200,
        cuerpo: { data: { url: "https://minio.local/vista-demo" } },
      });
    if (url === `${BASE}/extractions/extraction-a/approve` && método === "POST")
      return resolver(opciones.aprobar, { status: 200, cuerpo: { data: { status: "REVIEWED" } } });
    return {
      status: 404,
      cuerpo: { error: { code: "NOT_FOUND", message: "No encontramos el recurso solicitado" } },
    };
  };
}

/** Cliente de consultas igual al de App.tsx (retry: 1), sin espera entre reintentos. */
export function clienteComoApp(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 0, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

export function renderBandeja(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StudyBandeja />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Deja correr las respuestas simuladas antes de afirmar que no hubo aviso. */
export const esperarTurno = () => new Promise((resolve) => setTimeout(resolve, 80));

/** Como fetchSimulado, pero una respuesta PENDIENTE se rechaza al abortarse la petición (espera vencida del cliente). */
export function fetchSimuladoConAborto(ruta: (método: string, url: string) => Respuesta) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const respuesta = ruta((init?.method ?? "GET").toUpperCase(), url);
    if (respuesta === PENDIENTE) {
      return new Promise<Response>((_resolver, rechazar) => {
        init?.signal?.addEventListener("abort", () =>
          rechazar(new DOMException("La petición fue abortada", "AbortError")),
        );
      });
    }
    return new Response(JSON.stringify(respuesta.cuerpo), {
      status: respuesta.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
