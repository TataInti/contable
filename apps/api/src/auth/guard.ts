import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Capability, FirmRole } from "@contable/permissions";
import { capabilitiesForRole } from "@contable/permissions";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "./sessions.js";
import { withTenantContext } from "./tenant.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    firmId?: string;
    clientId?: string;
    firmRole?: FirmRole;
    capabilities?: ReadonlySet<Capability>;
    isPortalRequest?: boolean;
    isPlatformAdmin?: boolean;
  }
}

export interface AuthContext {
  userId: string;
  isPlatformAdmin: boolean;
  firmId?: string;
  clientId?: string;
  role?: FirmRole;
  capabilities: ReadonlySet<Capability>;
  isPortal: boolean;
}

type HttpError = Error & { statusCode: number; code: string };

function httpError(statusCode: number, code: string, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode, code });
}

const PUBLIC_PATHS = new Set([
  "/api/v1/ping",
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/verify",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/portal/invitations/accept",
]);

function pathname(url: string): string {
  return url.split("?", 1)[0] ?? url;
}

function pathContext(path: string): { firmId?: string; clientId?: string } {
  const firmMatch = path.match(/^\/api\/v1\/firms\/([^/]+)/);
  const clientMatch = path.match(/^\/api\/v1\/firms\/[^/]+\/clients\/([^/]+)/);
  return {
    ...(firmMatch?.[1] ? { firmId: decodeURIComponent(firmMatch[1]) } : {}),
    ...(clientMatch?.[1] ? { clientId: decodeURIComponent(clientMatch[1]) } : {}),
  };
}

function requiredCapability(method: string, path: string): Capability | null {
  if (path.includes("/feature-flags")) return method === "GET" ? "firm.manage" : "firm.manage";
  if (/\/members(?:\/|$)|\/invitations(?:\/|$)|\/portal-memberships(?:\/|$)/.test(path)) return "firm.manage";
  if (path.includes("/assignments")) return "client.assign";
  if (path.includes("/document-upload-sessions")) return "document.upload";
  if (path.includes("/extractions/")) {
    return method === "GET" ? "document.prepare" : "document.review";
  }
  if (path.includes("/documents")) return method === "GET" ? "client.read" : "document.upload";
  if (path.includes("/journal-entries")) {
    if (path.endsWith("/submit")) return "entry.submit";
    if (path.endsWith("/review") || path.endsWith("/reject")) return "entry.review";
    if (path.endsWith("/post")) return "entry.post";
    if (path.endsWith("/reverse")) return "entry.reverse";
    return method === "GET" ? "client.read" : "entry.create";
  }
  if (path.includes("/ledger/")) return "client.read";
  if (/\/bank-|\/bank\//.test(path)) return path.includes("reconcil") || path.includes("matches") ? "bank.reconcile" : "bank.import";
  if (path.includes("/vat/")) {
    if (path.endsWith("/finalize")) return "vat.finalize";
    if (path.endsWith("/review")) return "vat.review";
    return "vat.calculate";
  }
  if (path.includes("/obligations")) return method === "GET" ? "client.read" : "obligation.manage";
  if (path.includes("/document-requests")) return method === "GET" ? "client.read" : "request.manage";
  if (path.includes("/threads")) return method === "GET" ? "client.read" : "message.shared";
  if (path.includes("/close-cycles")) return method === "GET" ? "client.read" : "period.soft_close";
  if (path.includes("/report-publications")) return method === "GET" ? "client.read" : "report.publish";
  if (path.includes("/report-runs")) return path.endsWith("/publish") ? "report.publish" : "report.run";
  if (path.includes("/report-templates")) return method === "GET" ? "client.read" : "report.configure";
  if (path.includes("/reports/")) return "report.run";
  if (path.includes("/assistant/")) return "ai.use";
  if (path.includes("/bi/")) return "bi.use";
  if (path.match(/\/clients\/[^/]+\/(accounts|counterparties|cost-centers|fiscal-years|profile)/)) {
    return method === "GET" ? "client.read" : "client.manage";
  }
  if (/\/clients(?:\/[^/]+)?$/.test(path)) return method === "GET" ? "client.read" : "client.manage";
  return null;
}

function readCsrfCookie(req: FastifyRequest): string | undefined {
  return req.cookies.csrf_token as string | undefined;
}

function assertCsrf(req: FastifyRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const cookie = readCsrfCookie(req);
  const header = req.headers["x-csrf-token"];
  if (!cookie || typeof header !== "string" || header.length < 32 || header !== cookie) {
    throw httpError(403, "CSRF_INVALID", "La solicitud no contiene un token CSRF válido");
  }
}

/** Devuelve el contexto ya validado por el hook global. */
export async function requireAuth(req: FastifyRequest): Promise<AuthContext> {
  if (!req.userId || !req.capabilities) {
    throw httpError(401, "UNAUTHENTICATED", "La sesión no es válida o expiró");
  }
  return {
    userId: req.userId,
    isPlatformAdmin: false,
    ...(req.firmId ? { firmId: req.firmId } : {}),
    ...(req.clientId ? { clientId: req.clientId } : {}),
    ...(req.firmRole ? { role: req.firmRole } : {}),
    capabilities: req.capabilities,
    isPortal: req.isPortalRequest === true,
  };
}

export function assertFirmAccess(ctx: AuthContext, pathFirmId: string): void {
  if (ctx.firmId !== pathFirmId) throw httpError(403, "FORBIDDEN", "El estudio no pertenece a la sesión");
}

export function assertCapability(req: FastifyRequest, capability: Capability): void {
  if (!req.capabilities?.has(capability)) {
    throw httpError(403, "CAPABILITY_REQUIRED", `Falta la capacidad ${capability}`);
  }
}

/**
 * Frontera de seguridad deny-by-default. Toda ruta de negocio exige sesión; las
 * rutas con firma/cliente validan membresía, asignación y capacidad antes del handler.
 */
export function authGuardPlugin(app: FastifyInstance) {
  app.decorateRequest("userId", undefined);
  app.decorateRequest("firmId", undefined);
  app.decorateRequest("clientId", undefined);
  app.decorateRequest("firmRole", undefined);
  app.decorateRequest("capabilities", undefined);
  app.decorateRequest("isPortalRequest", false);
  app.decorateRequest("isPlatformAdmin", false);

  app.addHook("onRequest", async (req) => {
    const path = pathname(req.url ?? "");
    if (path.startsWith("/health") || PUBLIC_PATHS.has(path)) return;
    if (!path.startsWith("/api/v1/")) return;

    const refreshToken = req.cookies.refresh_token as string | undefined;
    if (!refreshToken) throw httpError(401, "UNAUTHENTICATED", "Se requiere iniciar sesión");

    const session = await resolveAuthFromToken(refreshToken);
    req.userId = session.userId;
    req.isPlatformAdmin = session.isPlatformAdmin;
    req.capabilities = new Set<Capability>();
    assertCsrf(req);

    if (path.startsWith("/api/v1/portal/")) {
      req.isPortalRequest = true;
      const portalClient = path.match(/^\/api\/v1\/portal\/clients\/([^/]+)/)?.[1];
      if (portalClient) {
        const clientId = decodeURIComponent(portalClient);
        const memberships = await prisma.$queryRaw<{ firmId: string; role: string }[]>`
          SELECT * FROM app_resolve_portal_membership(${session.userId}, ${clientId})
        `;
        const membership = memberships[0];
        if (!membership) throw httpError(404, "RESOURCE_NOT_FOUND", "Recurso no encontrado");
        req.firmId = membership.firmId;
        req.clientId = clientId;
        req.capabilities = new Set<Capability>(["client.read", "document.upload", "message.shared"]);
      }
      return;
    }

    const scoped = pathContext(path);
    if (!scoped.firmId) {
      if (path === "/api/v1/firms" && req.method !== "GET" && !session.isPlatformAdmin) {
        throw httpError(403, "PLATFORM_ADMIN_REQUIRED", "Se requiere administración de plataforma");
      }
      return;
    }
    const firmId = scoped.firmId;
    const clientId = scoped.clientId;

    const membership = await withTenantContext(
      { userId: session.userId, firmId, ...(clientId ? { clientId } : {}), actorKind: "USER" },
      (tx) => tx.firmMembership.findFirst({
        where: { firmId, userId: session.userId, status: "ACTIVE" },
      }),
    );
    if (!membership) throw httpError(404, "RESOURCE_NOT_FOUND", "Recurso no encontrado");

    const role = membership.role as FirmRole;
    const capabilities = capabilitiesForRole(role);
    req.firmId = firmId;
    req.firmRole = role;
    req.capabilities = capabilities;

    if (clientId) {
      const firmWide = role === "OWNER" || role === "ADMIN";
      if (!firmWide) {
        const assignment = await withTenantContext(
          { userId: session.userId, firmId, clientId, actorKind: "USER" },
          (tx) => tx.clientAssignment.findFirst({
            where: { firmId, clientId, userId: session.userId },
            select: { id: true },
          }),
        );
        if (!assignment) throw httpError(404, "RESOURCE_NOT_FOUND", "Recurso no encontrado");
      }
      req.clientId = clientId;
    }

    const capability = requiredCapability(req.method, path);
    if (capability && !capabilities.has(capability)) {
      throw httpError(403, "CAPABILITY_REQUIRED", `Falta la capacidad ${capability}`);
    }
  });
}

/** Resuelve solamente la identidad de la sesión; nunca elige una firma implícita. */
export async function resolveAuthFromToken(refreshToken: string): Promise<AuthContext> {
  const hash = sha256(refreshToken);
  const rows = await prisma.$queryRaw<
    { userId: string; isPlatformAdmin: boolean; userStatus: string; expiresAt: Date; revokedAt: Date | null }[]
  >`SELECT * FROM app_resolve_session(${hash})`;
  const session = rows[0];
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.userStatus !== "ACTIVE") {
    throw httpError(401, "UNAUTHENTICATED", "La sesión no es válida o expiró");
  }
  return {
    userId: session.userId,
    isPlatformAdmin: session.isPlatformAdmin,
    capabilities: new Set<Capability>(),
    isPortal: false,
  };
}
