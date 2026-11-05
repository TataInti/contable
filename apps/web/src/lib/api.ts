/**
 * Cliente HTTP del frontend (Fase "funcional").
 * Usa el proxy de Vite (/api → localhost:3000) en dev.
 * Respuestas de la API: { data: T } o { error: { code, message } }.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | null;

  constructor(
    code: string,
    message: string,
    status: number,
    requestId: string | null = null,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    this.details = details;
  }
}

const BASE = "/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;

function fallbackMessage(status: number): string {
  if (status === 400) return "La solicitud contiene datos inválidos";
  if (status === 401) return "Tu sesión venció. Volvé a iniciar sesión";
  if (status === 403) return "No tenés permiso para realizar esta acción";
  if (status === 404) return "No encontramos el recurso solicitado";
  if (status === 409) return "La información cambió. Actualizá la pantalla e intentá nuevamente";
  if (status === 429) return "Hay demasiadas solicitudes. Esperá un momento antes de reintentar";
  if (status >= 500) return "El servidor no está disponible en este momento";
  return "No se pudo completar la solicitud";
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("csrf_token="))
      ?.slice("csrf_token=".length);
    if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  }

  let res: Response;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      timedOut ? "La solicitud tardó demasiado. Reintentá en unos minutos" : "No se pudo conectar con el servidor",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await res.json().catch(() => null)) as
    | {
        data?: T;
        error?: { code?: string; message?: string; requestId?: string } & Record<string, unknown>;
      }
    | null;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      err?.code ?? "HTTP_ERROR",
      err?.message ?? fallbackMessage(res.status),
      res.status,
      err?.requestId ?? res.headers.get("x-request-id"),
      err ? { ...err } : null,
    );
  }

  return (payload?.data ?? payload) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  postWithHeaders: <T>(path: string, body: unknown, headers: Record<string, string>) => request<T>("POST", path, body, headers),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export async function downloadFile(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { credentials: "same-origin" });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as
      | { error?: { code?: string; message?: string; requestId?: string } & Record<string, unknown> }
      | null;
    throw new ApiError(
      payload?.error?.code ?? "DOWNLOAD_FAILED",
      payload?.error?.message ?? fallbackMessage(res.status),
      res.status,
      payload?.error?.requestId ?? res.headers.get("x-request-id"),
      payload?.error ? { ...payload.error } : null,
    );
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "reporte";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Sube un archivo a una URL firmada (presigned PUT a MinIO). */
export async function uploadToSignedUrl(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    body: file,
  });
  if (!res.ok) {
    throw new ApiError("UPLOAD_FAILED", `Subida falló: ${res.status}`, res.status);
  }
}

/** Tipos comunes */
export interface MeContext {
  userId: string;
  isPlatformAdmin?: boolean;
  mustChangePassword?: boolean;
  firms: {
    firmId: string;
    firmName: string;
    role: string;
    capabilities: string[];
    clients: { clientId: string; clientName: string; periods: { periodId: string; label: string; status: string }[] }[];
  }[];
}

export interface PortalContext {
  firmId: string;
  firmName: string;
  clientId: string;
  clientName: string;
  role: string;
  periods: { periodId: string; label: string; status: string }[];
}

export interface Client {
  id: string;
  legalName: string;
  cuit: string;
  status: string;
}

export interface ClientSummary {
  client: Client & {
    tradeName: string | null;
    createdAt: string;
    updatedAt: string;
    profile: {
      functionalCurrency: string;
      accountingStandard: string | null;
      fiscalYearEndMonth: number;
      vatCondition: string | null;
      iibbJurisdictions: string[];
      province: string | null;
      activity: string | null;
      legalForm: string | null;
      serviceStartDate: string | null;
      updatedAt: string;
    } | null;
    onboarding: { completed: boolean; updatedAt: string } | null;
  };
  accounting: {
    fiscalYears: Array<{
      id: string;
      label: string;
      startDate: string;
      endDate: string;
      status: string;
      periods: Array<{
        id: string;
        startDate: string;
        endDate: string;
        ordinal: number;
        status: string;
      }>;
    }>;
  };
  fiscal: {
    profiles: Array<{
      id: string;
      version: number;
      legalName: string;
      cuit: string;
      personType: string;
      nationalCondition: string;
      fiscalAddress: string | null;
      fiscalYearEndMonth: number;
      monotributoCategory: string | null;
      validFrom: string;
      validTo: string | null;
      status: string;
      source: string | null;
      createdAt: string;
    }>;
    registrations: Array<{
      id: string;
      status: string;
      validFrom: string;
      validTo: string | null;
      registrationNumber: string | null;
      profile: { id: string; version: number };
      regime: {
        id: string;
        code: string;
        name: string;
        taxType: { id: string; code: string; name: string };
        jurisdiction: { id: string; code: string; name: string };
      };
    }>;
    activities: Array<{
      id: string;
      isPrimary: boolean;
      validFrom: string;
      validTo: string | null;
      profile: { version: number };
      activity: {
        id: string;
        code: string;
        name: string;
        jurisdiction: { code: string; name: string };
      };
    }>;
    periods: Array<{
      id: string;
      startDate: string;
      endDate: string;
      label: string | null;
      taxType: { id: string; code: string; name: string };
    }>;
    obligations: Array<{
      id: string;
      status: string;
      dueDate: string | null;
      profile: { version: number };
      regime: {
        id: string;
        code: string;
        name: string;
        taxType: { id: string; code: string; name: string };
        jurisdiction: { id: string; code: string; name: string };
      };
      period: { id: string; label: string | null; startDate: string; endDate: string };
    }>;
  };
  counts: { accounts: number; counterparties: number; costCenters: number };
}

export interface Document {
  id: string;
  category?: string | null;
  direction?: string | null;
  status: string;
  createdAt: string;
  fileVersions?: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    bucket?: string | null;
    antivirusStatus: string;
  }[];
  processingJobs?: { id: string; status: string; stage?: string | null; progress: number; error?: string | null }[];
}

export interface ExtractedField {
  id: string;
  key: string;
  rawValue?: string | null;
  normalizedValue?: string | null;
  correction?: string | null;
  confidence: number;
  status: string;
}

export interface DocumentExtraction {
  id: string;
  status: string;
  classification?: string | null;
  confidence?: number | null;
  fields: ExtractedField[];
  items: unknown[];
}

export interface Account { id: string; code: string; name: string; type: string; normalBalance: string }
export interface FiscalYear { id: string; label: string; periods: { id: string; startDate: string; endDate: string; status: string }[] }

export interface JournalEntry {
  id: string;
  sequenceNumber: number | null;
  entryDate: string;
  description: string;
  status: string;
}

export interface TrialBalanceLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitTotal: string;
  creditTotal: string;
  balance: string;
}

export interface TrialBalance {
  lines: TrialBalanceLine[];
  totals: { debitTotal: string; creditTotal: string };
}

export interface FeatureFlag {
  id: string;
  code: string;
  enabled: boolean;
}

export interface ReportPublication {
  id: string;
  status: string;
  publishedAt: string;
  run?: { id: string; result?: ReportResult; cutoff?: string; template?: { code: string; name: string } };
}

export interface ReportResult {
  templateCode?: string;
  templateVersion?: number;
  cutoff?: string;
  generatedAt?: string;
  lines?: { code: string; label: string; value: string; isTotal?: boolean; indent?: number }[];
}

export interface ReportTemplate {
  id: string;
  code: string;
  name: string;
  kind: string;
  version: number;
  lines: { id: string; code: string; label: string; position: number }[];
}

export interface ReportRun {
  id: string;
  status: string;
  cutoff: string;
  createdAt: string;
  resultHash?: string | null;
  result?: ReportResult;
  template: { id: string; code: string; name: string };
  publications: { id: string; status: string }[];
}

export interface ObligationInstance {
  id: string;
  periodLabel: string;
  dueDate: string;
  status: string;
}

export interface DocumentRequest {
  id: string;
  title: string;
  status: string;
  items: { id: string; description: string; required: boolean; status: string }[];
}

export interface RequestMessage {
  id: string;
  authorUserId: string;
  body: string;
  visibility: string;
  createdAt: string;
}

export interface AssistantTurn {
  id: string;
  role: string;
  content: string;
  abstained: boolean;
  evidence: { kind: string; sourceType: string; sourceId: string; label: string | null; value: string | null }[];
}
