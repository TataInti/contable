import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { requiredCapability } from "./guard.js";

/**
 * Auditoría deny-by-default (A-7 / F0.8): toda ruta de negocio registrada en
 * la API debe declarar su capability en el ROUTE_POLICY. Una ruta sin mapeo es
 * un escape de permisos porque el guard la deniega con 404, pero se quiere
 * detección temprana (el guard sólo conoce rutas cuando la request llega).
 *
 * Las únicas excepciones son rutas con manejo propio ANTES del policy check:
 * auth, ping, me/*, portal/contexts, portal summary, SSE y POST /firms.
 */
describe("cobertura total del ROUTE_POLICY (deny-by-default)", () => {
  it("todas las rutas de negocio tienen capability (menos whitelist)", () => {
    const out = execSync(
      `grep -rhoE "app\\.(get|post|put|patch|delete)\\(\\"/api/v1/[^\\"]+\\"" src --include='*.ts' | grep -v test | sort -u`,
    ).toString();
    const routes = out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/app\.(get|post|put|patch|delete)\("(\/api\/v1\/[^"]+)"/);
        return m ? { method: (m[1] ?? "").toUpperCase(), path: (m[2] ?? "").replace(/\/:[^/]+/g, "/:p") } : null;
      })
      .filter((r): r is { method: string; path: string } => r !== null);

    // Excepciones legítimas (manejadas antes del policy check en guard.ts)
    const allowedNull = new Set([
      "GET /api/v1/events", // SSE: requiere sesión pero no capability de negocio
      "GET /api/v1/me/contexts", // rutas de sesión (no matchean firmId)
      "GET /api/v1/me/invitations",
      "GET /api/v1/ping", // PUBLIC_PATHS
      "POST /api/v1/auth/login", // PUBLIC_PATHS
      "POST /api/v1/auth/logout",
      "POST /api/v1/auth/mfa/verify",
      "POST /api/v1/auth/refresh",
      "POST /api/v1/firms", // PLATFORM_ADMIN handling antes del policy check
      "GET /api/v1/portal/contexts", // manejo propio del portal
      "GET /api/v1/portal/clients/:p/summary", // portal (capabilities propias)
    ]);

    const missing: string[] = [];
    for (const r of routes) {
      const cap = requiredCapability(r.method, r.path);
      if (cap === null && !allowedNull.has(`${r.method} ${r.path}`)) {
        missing.push(`${r.method} ${r.path}`);
      }
    }
    expect(missing).toEqual([]);
  });
});