import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Capability, FirmRole } from "@contable/permissions";
import { capabilitiesForRole } from "@contable/permissions";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "./sessions.js";
import { withTenantContext } from "./tenant.js";
import { portalCapabilities, type PortalRole } from "./portal-capabilities.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    firmId?: string;
    clientId?: string;
    firmRole?: FirmRole;
    capabilities?: ReadonlySet<Capability>;
    isPortalRequest?: boolean;
    isPlatformAdmin?: boolean;
    mustChangePassword?: boolean;
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
  "/api/v1/system/ready",
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/verify",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/auth/access-recovery/redeem",
  "/api/v1/portal/invitations/accept",
]);

const PASSWORD_CHANGE_PATHS = new Set([
  "/api/v1/auth/password/change",
  "/api/v1/me/contexts",
  "/api/v1/portal/contexts",
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

/**
 * F0.8: política de autorización declarativa (deny-by-default).
 *
 * Cada regla declara un patrón de ruta (regex) y una función que resuelve la
 * capability según el método HTTP. La evaluación recorre la tabla en orden:
 * la primera regla que matchea gana. Si ninguna matchea, la ruta queda SIN
 * política y el guard la deniega (403/404), nunca la autoriza por omisión.
 *
 * El guard y la prueba de cobertura consumen esta misma tabla: la prueba
 * falla si una ruta Fastify de negocio no tiene política declarada.
 */
interface RoutePolicy {
  /** Regex sobre el pathname (sin query). */
  match: RegExp;
  /** Resuelve la capability según el método y el path. Devuelve null para denegar. */
  resolve: (method: string, path: string) => Capability | null;
}

const ROUTE_POLICY: readonly RoutePolicy[] = [
  {
    match: /\/firms\/[^/]+\/settings\/self-review$/,
    resolve: (m) => (m === "GET" ? "firm.manage" : m === "PATCH" ? "firm.self_review.manage" : null),
  },
  { match: /\/feature-flags/, resolve: () => "firm.manage" },
  { match: /\/client-profile-catalogs\/activities$/, resolve: (m) => (m === "GET" ? "client.read" : null) },
  // Catálogo de normas contables del estudio: lectura con la ficha de cliente
  // (cualquier rol que lee clientes necesita el selector), administración
  // (alta/edición/activación) reservada a firm.manage como los demás parámetros.
  { match: /\/accounting-standards/, resolve: (m) => (m === "GET" ? "client.read" : "firm.manage") },
  { match: /\/firms\/[^/]+\/profile$/, resolve: () => "firm.users.manage" },
  { match: /\/members(?:\/|$)|\/users(?:\/|$)/, resolve: () => "firm.users.manage" },
  { match: /\/portal-memberships(?:\/|$)/, resolve: () => "firm.users.manage" },
  { match: /\/invitations(?:\/|$)/, resolve: () => "firm.manage" },
  { match: /\/assignments/, resolve: () => "firm.users.manage" },
  { match: /\/document-upload-sessions/, resolve: () => "document.upload" },
  { match: /\/extractions\//, resolve: (m) => (m === "GET" ? "document.prepare" : "document.review") },
  { match: /\/documents\/[^/]+\/reprocess$/, resolve: (m) => (m === "POST" ? "document.review" : null) },
  { match: /\/documents/, resolve: (m) => (m === "GET" ? "client.read" : "document.upload") },
  { match: /\/journal-entries\/[^/]+\/submit$/, resolve: () => "entry.submit" },
  { match: /\/journal-entries\/[^/]+\/(review|reject)$/, resolve: () => "entry.review" },
  { match: /\/journal-entries\/[^/]+\/post$/, resolve: () => "entry.post" },
  { match: /\/journal-entries\/[^/]+\/reverse$/, resolve: () => "entry.reverse" },
  {
    match: /\/journal-entries/,
    resolve: (m) => {
      if (m === "GET") return "client.read";
      return "entry.create";
    },
  },
  { match: /\/ledger\//, resolve: () => "client.read" },
  {
    match: /\/bank-|\/bank\//,
    resolve: (m, path) => (path.includes("reconcil") || path.includes("matches") ? "bank.reconcile" : "bank.import"),
  },
  {
    match: /\/vat\//,
    resolve: (m, path) => {
      if (path.endsWith("/finalize")) return "vat.finalize";
      if (path.endsWith("/review")) return "vat.review";
      return "vat.calculate";
    },
  },
  {
    match: /\/tax-profile-versions/,
    resolve: (m) => (m === "GET" ? "tax.profile.read" : "tax.profile.write"),
  },
  { match: /\/tax-registrations/, resolve: (m) => (m === "GET" ? "tax.profile.read" : "tax.profile.write") },
  { match: /\/tax-periods/, resolve: (m) => (m === "GET" ? "tax.profile.read" : "tax.profile.write") },
  // G5 fix: filings/payments de una obligación se mapean a sus capacidades
  // específicas ANTES del catch-all de /tax-obligations.
  { match: /\/tax-obligations\/.*\/filings$/, resolve: () => "tax.filings.record" },
  { match: /\/tax-obligations\/.*\/payments$/, resolve: () => "tax.payments.record" },
  { match: /\/tax-obligations/, resolve: (m) => (m === "GET" ? "tax.profile.read" : "tax.profile.write") },
  // Borrado definitivo de catálogos y reglas fiscales: sólo Titular (OWNER).
  // Las rutas de preview y DELETE se declaran antes de los mapeos generales
  // para que no caigan en tax.rules.propose / tax.profile.write.
  { match: /\/tax\/(authorities|regimes|activities|jurisdictions|types)\/[^/]+\/deletion-preview$/, resolve: () => "data.delete" },
  { match: /\/tax\/(authorities|regimes|activities|jurisdictions|types)\/[^/]+$/, resolve: (m) => (m === "DELETE" ? "data.delete" : (m === "GET" ? "tax.rules.read" : "tax.rules.propose")) },
  { match: /\/tax\/rule-packs\/[^/]+\/deletion-preview$/, resolve: () => "data.delete" },
  { match: /\/tax\/rule-packs\/[^/]+$/, resolve: (m) => (m === "DELETE" ? "data.delete" : (m === "GET" ? "tax.rules.read" : "tax.rules.propose")) },
  { match: /\/tax\/rule-versions\/[^/]+\/deletion-preview$/, resolve: () => "data.delete" },
  { match: /\/tax\/rule-versions\/[^/]+$/, resolve: (m) => (m === "DELETE" ? "data.delete" : (m === "GET" ? "tax.rules.read" : "tax.rules.propose")) },
  { match: /\/tax\/jurisdictions/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/tax\/types/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/tax\/authorities/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/tax\/regimes/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/tax\/activities/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/tax\/holidays/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  {
    match: /\/tax\/rule-versions\//,
    resolve: (m, path) => {
      // Probar una liquidación no escribe nada: alcanza con poder leer reglas.
      if (path.endsWith("/simulate")) return "tax.rules.read";
      if (path.endsWith("/approve")) return "tax.rules.approve";
      if (path.endsWith("/activate") || path.endsWith("/submit-review")) return "tax.rules.propose";
      return m === "GET" ? "tax.rules.read" : "tax.rules.propose";
    },
  },
  {
    match: /\/tax-rule-versions/,
    resolve: (m, path) => {
      if (path.endsWith("/approve")) return "tax.rules.approve";
      if (path.endsWith("/activate")) return "tax.rules.activate";
      if (path.endsWith("/submit-review")) return "tax.rules.propose";
      return m === "GET" ? "tax.rules.read" : "tax.rules.propose";
    },
  },
  { match: /\/tax-rule-packs/, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/tax\/credentials/, resolve: (m) => (m === "GET" ? "tax.profile.read" : "tax.profile.write") },
  {
    match: /\/import-batches/,
    resolve: (m, path) => {
      if (path.endsWith("/validate") || path.endsWith("/commit")) return "tax.vouchers.prepare";
      return m === "GET" ? "tax.vouchers.read" : "tax.vouchers.prepare";
    },
  },
  {
    match: /\/sifere\/analyze/,
    resolve: () => "tax.vouchers.prepare",
  },
  {
    match: /\/sifere\/import/,
    resolve: () => "tax.vouchers.prepare",
  },
  {
    match: /\/sifere\/template/,
    resolve: () => "tax.vouchers.read",
  },
  {
    match: /\/vouchers/,
    resolve: (m, path) => {
      if (path.endsWith("/review") || path.endsWith("/approve") || path.endsWith("/reject")) {
        return "tax.vouchers.review";
      }
      if (path.endsWith("/submit-review")) return "tax.vouchers.prepare";
      return m === "GET" ? "tax.vouchers.read" : "tax.vouchers.prepare";
    },
  },
  { match: /\/withholdings|\/perceptions/, resolve: (m) => (m === "GET" ? "tax.vouchers.read" : "tax.vouchers.prepare") },
  {
    match: /\/management-expenses/,
    resolve: (m, path) => {
      if (path.endsWith("/approve-treatment")) return "tax.management_expenses.approve_treatment";
      if (path.endsWith("/reject")) return "tax.management_expenses.approve_treatment";
      if (path.endsWith("/submit-review")) return "tax.management_expenses.write";
      return m === "GET" ? "tax.management_expenses.read" : "tax.management_expenses.write";
    },
  },
  {
    // C (§7.1): ingresos gerenciales. Ciclo propio de revisión: aprobar es
    // revisión (PREPARER no puede), crear/editar es write, leer es read.
    match: /\/management-incomes/,
    resolve: (m, path) => {
      if (path.endsWith("/approve")) return "tax.management_expenses.approve_treatment";
      if (path.endsWith("/reject")) return "tax.management_expenses.approve_treatment";
      if (path.endsWith("/submit-review")) return "tax.management_expenses.write";
      return m === "GET" ? "tax.management_expenses.read" : "tax.management_expenses.write";
    },
  },
  {
    match: /\/monthly-tax-workpapers/,
    resolve: (m, path) => {
      if (path.endsWith("/calculate")) return "tax.settlements.calculate";
      if (path.endsWith("/submit-review")) return "tax.settlements.submit_review";
      if (path.includes("/sources/") && path.endsWith("/review")) return "tax.vouchers.review";
      if (path.includes("/classifications/") && m !== "GET") return "tax.vouchers.prepare";
      if (path.includes("/allocations/") && m !== "GET") return "tax.vouchers.prepare";
      if (path.endsWith("/review")) return "tax.settlements.review";
      if (path.endsWith("/finalize")) return "tax.settlements.finalize";
      if (path.endsWith("/rectify")) return "tax.settlements.rectify";
      if (path.includes("/controls/") && path.endsWith("/resolve")) return "tax.settlements.review";
      return m === "GET" ? "tax.settlements.read" : "tax.settlements.calculate";
    },
  },
  {
    match: /\/tax-settlements/,
    resolve: (m, path) => {
      if (path.endsWith("/calculate")) return "tax.settlements.calculate";
      if (path.includes("/artifacts")) return "tax.settlements.export";
      if (path.endsWith("/submit-review")) return "tax.settlements.submit_review";
      if (path.endsWith("/request-changes") || path.endsWith("/review")) return "tax.settlements.review";
      if (path.endsWith("/finalize")) return "tax.settlements.finalize";
      // G4.4 fix: rectify-with-delta es una rectificativa; un PREPARER (que
      // sólo tiene calculate) no debe poder iniciarla. Se declara ANTES del
      // endsWith("/rectify") para que no caiga al default calculate.
      if (path.endsWith("/rectify-with-delta") || path.endsWith("/rectify")) return "tax.settlements.rectify";
      if (path.endsWith("/export")) return "tax.settlements.export";
      return m === "GET" ? "tax.settlements.read" : "tax.settlements.calculate";
    },
  },
  { match: /\/tax-credit-ledger\/[^/]+\/verify$/, resolve: () => "tax.settlements.review" },
  { match: /\/tax-credit-ledger\/[^/]+\/(movements|corrections)$/, resolve: () => "tax.settlements.calculate" },
  { match: /\/tax-credit-ledger/, resolve: (m) => (m === "GET" ? "tax.settlements.read" : "tax.settlements.calculate") },
  { match: /\/tax-position/, resolve: () => "tax.settlements.read" },
  { match: /\/tax-credit-allocations/, resolve: () => "tax.settlements.calculate" },
  { match: /\/tax-worklist/, resolve: () => "tax.settlements.read" },
  {
    match: /\/profitability/,
    resolve: (m, path) => {
      if (path.endsWith("/publish")) return "profitability.publish";
      if (path.endsWith("/calculate")) return "profitability.calculate";
      return m === "GET" ? "profitability.read" : "profitability.calculate";
    },
  },
  { match: /\/tax-obligations\/.*\/filings$/, resolve: () => "tax.filings.record" },
  { match: /\/tax-obligations\/.*\/payments$/, resolve: () => "tax.payments.record" },
  { match: /\/tax-payments\/.*\/reverse$/, resolve: () => "tax.payments.record" },
  { match: /\/tax\//, resolve: (m) => (m === "GET" ? "tax.rules.read" : "tax.rules.propose") },
  { match: /\/activities/, resolve: (m) => (m === "GET" ? "tax.profile.read" : "tax.profile.write") },
  { match: /\/adjustments\/(exchange-difference|inflation)/, resolve: () => "bank.reconcile" },
  { match: /\/portal-invitations/, resolve: (m) => (m === "GET" ? "client.read" : "client.manage") },
  { match: /\/document-request-items\/[^/]+\/preview/, resolve: () => "client.read" },
  { match: /\/obligations/, resolve: (m) => (m === "GET" ? "client.read" : "obligation.manage") },
  { match: /\/obligation-instances/, resolve: (m) => (m === "GET" ? "client.read" : "obligation.manage") },
  { match: /\/document-requests/, resolve: (m) => (m === "GET" ? "client.read" : "request.manage") },
  { match: /\/threads/, resolve: (m) => (m === "GET" ? "client.read" : "message.shared") },
  { match: /\/close-cycles/, resolve: (m) => (m === "GET" ? "client.read" : "period.soft_close") },
  { match: /\/report-publications/, resolve: (m) => (m === "GET" ? "client.read" : "report.publish") },
  { match: /\/report-runs/, resolve: (_m, path) => (path.endsWith("/publish") ? "report.publish" : "report.run") },
  { match: /\/report-templates/, resolve: (m) => (m === "GET" ? "client.read" : "report.configure") },
  { match: /\/reports\//, resolve: () => "report.run" },
  { match: /\/assistant\//, resolve: () => "ai.use" },
  { match: /\/bi\//, resolve: () => "bi.use" },
  { match: /\/clients\/[^/]+\/contacts(?:\/[^/]+)?$/, resolve: () => "client.manage" },
  // El tablero del estudio sólo agrega datos de clientes ya accesibles para
  // el miembro. No debe caer en el deny-by-default de las rutas de firma.
  { match: /\/firms\/[^/]+\/dashboard$/, resolve: (m) => (m === "GET" ? "client.read" : null) },
  {
    match: /\/clients\/[^/]+\/(accounts|counterparties|cost-centers|fiscal-years|profile|summary)/,
    resolve: (m) => (m === "GET" ? "client.read" : "client.manage"),
  },
  // Borrado definitivo de un cliente y su preview: capacidad exclusiva OWNER.
  { match: /\/clients\/[^/]+\/deletion-preview$/, resolve: () => "data.delete" },
  { match: /\/clients\/[^/]+$/, resolve: (m) => (m === "DELETE" ? "data.delete" : (m === "GET" ? "client.read" : "client.manage")) },
  { match: /\/clients(?:\/[^/]+)?$/, resolve: (m) => (m === "GET" ? "client.read" : "client.manage") },
];

export function requiredCapability(method: string, path: string): Capability | null {
  for (const rule of ROUTE_POLICY) {
    if (rule.match.test(path)) return rule.resolve(method, path);
  }
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
  app.decorateRequest("mustChangePassword", false);

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

    const account = await withTenantContext(
      { userId: session.userId, firmId: "", actorKind: "USER" },
      (tx) => tx.user.findUnique({ where: { id: session.userId }, select: { mustChangePassword: true } }),
    );
    req.mustChangePassword = account?.mustChangePassword === true;
    if (req.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(path)) {
      throw httpError(403, "PASSWORD_CHANGE_REQUIRED", "Primero cambiá tu contraseña temporal");
    }
    if (path === "/api/v1/auth/password/change") return;

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
        // G0-05 + G5: distinguir Colaborador de Sólo lectura. READONLY no recibe
        // capacidades de upload ni mensajes (PLAN §4.2). Se usan las capacidades
        // dedicadas de portal (portal.*) para que el guard distinga por semántica.
        req.capabilities = portalCapabilities(membership.role as PortalRole);
      }
      return;
    }

    const scoped = pathContext(path);
    if (!scoped.firmId) {
      if (path === "/api/v1/firms" && req.method !== "GET" && !session.isPlatformAdmin) {
        throw httpError(403, "PLATFORM_ADMIN_REQUIRED", "Se requiere administración de plataforma");
      }
      // Catálogos de firma (maestros fiscales /tax/*): se resuelve la primera
      // membresía activa del usuario para dar contexto de firma y capacidades.
      if (path.startsWith("/api/v1/tax/")) {
        const membership = await withTenantContext(
          { userId: session.userId, firmId: "", actorKind: "USER" },
          (tx) => tx.firmMembership.findFirst({
            where: { userId: session.userId, status: "ACTIVE" },
            orderBy: { acceptedAt: "asc" },
          }),
        );
        if (!membership) throw httpError(404, "RESOURCE_NOT_FOUND", "Recurso no encontrado");
        const role = membership.role as FirmRole;
        req.firmId = membership.firmId;
        req.firmRole = role;
        req.capabilities = capabilitiesForRole(role);
        const capability = requiredCapability(req.method, path);
        if (capability && !req.capabilities.has(capability)) {
          throw httpError(403, "CAPABILITY_REQUIRED", `Falta la capacidad ${capability}`);
        }
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
    if (capability === null) {
      // A-7: deny-by-default. Una ruta de negocio con sesión y firma que no
      // declara capability es un escape de permisos → 404 indistinguible.
      throw httpError(404, "RESOURCE_NOT_FOUND", "Recurso no encontrado");
    }
    if (!capabilities.has(capability)) {
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
