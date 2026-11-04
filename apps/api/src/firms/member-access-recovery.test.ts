import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredCapability } from "../auth/guard.js";

/**
 * Tests focalizados de la recuperación de acceso para miembros internos
 * (renovación de claves iniciada por el admin desde la UI):
 *   * permisos: emisión y revocación exigen firm.users.manage (deny-by-default);
 *     el canje es ruta pública cuya credencial es el token,
 *   * un solo uso: reclamo atómico (UPDATE con usedAt IS NULL) y fallo
 *     genérico RECOVERY_INVALID sin oráculo de estados,
 *   * caducidad: expiresAt se valida en la misma sentencia del canje,
 *   * sesiones: la emisión y el canje revocan device_sessions,
 *   * secretos: sólo hash del token en la base, sin token ni contraseña en
 *     logs ni auditoría; el gestor nunca ve ni define la contraseña.
 *
 * Las pruebas de uso reales (emisión, canje, replay, expiración, revocación)
 * corren como integración contra una base desechable:
 * apps/api/src/firms/member-access-recovery.integration.test.ts
 */

const thisDir = dirname(fileURLToPath(import.meta.url));
const recoverySql = readFileSync(
  join(thisDir, "../../prisma/migrations/20261107000000_member_access_recovery/migration.sql"),
  "utf8",
);
const firmsRoutes = readFileSync(join(thisDir, "routes.ts"), "utf8");
const authRoutes = readFileSync(join(thisDir, "../auth/routes.ts"), "utf8");
const guardSource = readFileSync(join(thisDir, "../auth/guard.ts"), "utf8");
const adminUi = readFileSync(join(thisDir, "../../../web/src/study/StudyAdministracion.tsx"), "utf8");
const recoverUi = readFileSync(join(thisDir, "../../../web/src/auth/RecoverAccessPage.tsx"), "utf8");

const createBody = recoverySql.slice(
  recoverySql.indexOf("app_create_member_access_recovery("),
  recoverySql.indexOf("app_revoke_member_access_recovery("),
);
const revokeBody = recoverySql.slice(
  recoverySql.indexOf("app_revoke_member_access_recovery("),
  recoverySql.indexOf("app_redeem_member_access_recovery("),
);
const redeemBody = recoverySql.slice(
  recoverySql.indexOf("app_redeem_member_access_recovery("),
  recoverySql.indexOf("REVOKE ALL ON FUNCTION app_redeem_member_access_recovery"),
);

describe("permisos: emisión y revocación exigen firm.users.manage", () => {
  it.each([
    ["POST", "/api/v1/firms/f1/members/u1/access-recovery"],
    ["POST", "/api/v1/firms/f1/members/u1/access-recovery/r1/revoke"],
  ])("%s %s -> firm.users.manage", (method, path) => {
    expect(requiredCapability(method, path)).toBe("firm.users.manage");
  });

  it("el canje es ruta pública: sin capability declarada y en PUBLIC_PATHS", () => {
    // Ruta pública: la credencial es el token, no la sesión. La prueba de
    // cobertura (policy-coverage) la lista como excepción legítima.
    expect(requiredCapability("POST", "/api/v1/auth/access-recovery/redeem")).toBeNull();
    expect(guardSource).toContain('"/api/v1/auth/access-recovery/redeem"');
  });
});

describe("un solo uso: reclamo atómico y fallo genérico sin oráculo", () => {
  it("el canje reclama el token con usedAt IS NULL en la misma sentencia", () => {
    expect(redeemBody).toMatch(/UPDATE member_access_recoveries SET "usedAt"/);
    expect(redeemBody).toMatch(/member_access_recoveries\."usedAt" IS NULL/);
    // El UPDATE de reclamo va antes del cambio de contraseña: el canje es
    // atómico (si algo falla, la transacción entera revierte el reclamo).
    expect(redeemBody.indexOf("UPDATE member_access_recoveries SET \"usedAt\""))
      .toBeLessThan(redeemBody.indexOf("UPDATE users"));
  });

  it("un token usado, revocado o expirado falla con el mismo código genérico", () => {
    // Un único código de error para todo estado inválido: sin oráculo.
    const raises = redeemBody.match(/RAISE EXCEPTION '([^']+)'/g) ?? [];
    expect(raises.length).toBeGreaterThan(0);
    for (const raise of raises) {
      expect(raise).toBe("RAISE EXCEPTION 'RECOVERY_INVALID'");
    }
    expect(redeemBody).not.toContain("RECOVERY_USED");
    expect(redeemBody).not.toContain("RECOVERY_EXPIRED");
  });

  it("el canje rechaza un usuario no activo con el mismo código genérico", () => {
    expect(redeemBody).toMatch(/user_status IS DISTINCT FROM 'ACTIVE'/);
  });
});

describe("caducidad: la vigencia se valida en el canje y limita la emisión", () => {
  it("el reclamo exige expiresAt mayor a ahora", () => {
    expect(redeemBody).toMatch(/member_access_recoveries\."expiresAt" > CURRENT_TIMESTAMP/);
  });

  it("la emisión valida el TTL (5 min .. 24 h)", () => {
    expect(createBody).toMatch(/target_ttl_minutes < 5 OR target_ttl_minutes > 1440/);
  });

  it("la vigencia por defecto de la ruta es de 30 minutos", () => {
    expect(firmsRoutes).toContain("${body.ttlMinutes ?? 30}");
  });
});

describe("sesiones: la emisión y el canje revocan device_sessions", () => {
  it("la emisión revoca todas las sesiones activas del usuario", () => {
    expect(createBody).toMatch(/UPDATE device_sessions SET "revokedAt" = CURRENT_TIMESTAMP/);
    expect(createBody).toMatch(/device_sessions\."userId" = target_user_id/);
  });

  it("el canje vuelve a revocar por defensa en profundidad", () => {
    expect(redeemBody).toMatch(/UPDATE device_sessions SET "revokedAt" = CURRENT_TIMESTAMP/);
  });

  it("la emisión invalida los tokens pendientes anteriores (sólo vale el último)", () => {
    expect(createBody).toMatch(
      /UPDATE member_access_recoveries SET "revokedAt" = CURRENT_TIMESTAMP/,
    );
    expect(createBody.indexOf("UPDATE member_access_recoveries SET \"revokedAt\""))
      .toBeLessThan(createBody.indexOf("INSERT INTO member_access_recoveries"));
  });
});

describe("secretos: hash del token, sin secretos en logs ni auditoría", () => {
  it("la tabla no tiene columna de token en claro (sólo tokenHash)", () => {
    expect(recoverySql).toMatch(/CREATE TABLE "member_access_recoveries"/);
    expect(recoverySql).toContain('"tokenHash" TEXT NOT NULL');
    expect(recoverySql).not.toMatch(/"token(?!Hash)"/);
  });

  it("la auditoría registra la acción sin el token ni su hash", () => {
    for (const body of [createBody, revokeBody, redeemBody]) {
      const auditInserts = body.match(/INSERT INTO audit_events[\s\S]*?\);/g) ?? [];
      expect(auditInserts.length).toBeGreaterThan(0);
      for (const insert of auditInserts) {
        expect(insert).not.toContain("target_token_hash");
        expect(insert).not.toContain("password");
      }
    }
  });

  it("las rutas no loguean el token ni la contraseña", () => {
    const recoveryRoute = firmsRoutes.slice(
      firmsRoutes.indexOf("/api/v1/firms/:firmId/members/:userId/access-recovery"),
      firmsRoutes.indexOf("Asignar cliente a usuario"),
    );
    const redeemRoute = authRoutes.slice(
      authRoutes.indexOf("/api/v1/auth/access-recovery/redeem"),
      authRoutes.indexOf("/api/v1/auth/mfa/verify"),
    );
    for (const source of [recoveryRoute, redeemRoute]) {
      expect(source).not.toMatch(/req\.log/);
      expect(source).not.toMatch(/console\./);
    }
  });

  it("el canje fija la contraseña hasheada por la capa de aplicación (Argon2id)", () => {
    expect(redeemBody).toMatch(/"passwordHash" = target_password_hash/);
    expect(authRoutes).toMatch(/const passwordHash = await hashPassword\(body\.newPassword\)/);
  });

  it("el token se genera con 32 bytes aleatorios y se persiste hasheado", () => {
    expect(firmsRoutes).toContain('randomBytes(32).toString("base64url")');
    expect(firmsRoutes).toContain('createHash("sha256").update(recoveryToken).digest("hex")');
  });

  it("el token de recuperación viaja sólo en el fragmento de URL, no en el query HTTP", () => {
    expect(adminUi).toContain("/recuperar-acceso#token=");
    expect(adminUi).not.toContain("/recuperar-acceso?token=");
    expect(recoverUi).toContain("new URLSearchParams(location.hash.slice(1))");
    expect(recoverUi).not.toContain("useSearchParams");
  });

  it("las funciones restringen search_path y fijan pg_temp al final", () => {
    expect(recoverySql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(recoverySql).not.toContain("SET search_path = public");
  });
});

describe("permisos en SQL: OWNER-protegido y auto-objetivo", () => {
  it("reutiliza el guard de actor/objetivo del ciclo de vida", () => {
    expect(createBody).toContain("app_assert_member_target(target_actor_id, target_firm_id, target_user_id)");
  });

  it("un ADMIN no emite recuperación para un OWNER; serializa con advisory lock", () => {
    expect(createBody).toMatch(/target_role = 'OWNER'/);
    expect(createBody).toMatch(/app_actor_is_admin_only/);
    expect(createBody.indexOf("pg_advisory_xact_lock")).toBeLessThan(createBody.indexOf("app_assert_member_target"));
  });

  it("el objetivo debe estar activo para emitirle recuperación", () => {
    expect(createBody).toMatch(/RECOVERY_TARGET_NOT_ACTIVE/);
  });
});

describe("revocación explícita del enlace pendiente", () => {
  it("sólo revoca tokens pendientes y audita el motivo truncado", () => {
    expect(revokeBody).toMatch(/"usedAt" IS NULL/);
    expect(revokeBody).toMatch(/"revokedAt" IS NULL/);
    expect(revokeBody).toMatch(/"expiresAt" > CURRENT_TIMESTAMP/);
    expect(revokeBody).toMatch(/left\(COALESCE\(target_reason, ''\), 500\)/);
  });
});
