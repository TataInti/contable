import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDITED_REJECTIONS,
  isAuditedRejection,
  lifecycleHttpError,
} from "./member-lifecycle.js";
import { requiredCapability } from "../auth/guard.js";

/**
 * Tests focalizados del corte F2 (administración de usuarios):
 *   * permisos: toda ruta nueva exige firm.users.manage (guard deny-by-default),
 *   * última cuenta: el guard de último administrador está presente en SQL
 *     para suspensión y cambio de rol que degrada, bajo advisory lock,
 *   * sesiones: la suspensión y la degradación revocan device_sessions,
 *   * datos: sin hard-delete (ningún DELETE sobre users/firm_memberships),
 *   * auditoría: eventos por acción e intentos rechazados sensibles.
 */

const thisDir = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(thisDir, "../../prisma/migrations/20261105000000_user_lifecycle_administration/migration.sql"),
  "utf8",
);

describe("permisos: el guard exige firm.users.manage en las rutas del ciclo de vida", () => {
  it.each([
    ["POST", "/api/v1/firms/f1/members/u1/suspend"],
    ["POST", "/api/v1/firms/f1/members/u1/reactivate"],
    ["PATCH", "/api/v1/firms/f1/members/u1"],
    ["POST", "/api/v1/firms/f1/users"],
    ["GET", "/api/v1/firms/f1/members"],
  ])("%s %s -> firm.users.manage", (method, path) => {
    expect(requiredCapability(method, path)).toBe("firm.users.manage");
  });

  it("una ruta no declarada sigue denegándose (deny-by-default)", () => {
    // La política de /members es método-agnóstica; deny-by-default se prueba
    // con una ruta que no matchea ninguna regla declarada.
    expect(requiredCapability("POST", "/api/v1/firms/f1/ruta-inexistente")).toBeNull();
  });
});

describe("mapeo de errores SQL del ciclo de vida", () => {
  it("mapea cada código a su estado HTTP", () => {
    const cases: Array<[string, number, string]> = [
      ["LAST_ADMIN_REQUIRED", 409, "LAST_ADMIN_REQUIRED"],
      ["OWNER_PROTECTED", 403, "OWNER_PROTECTED"],
      ["MEMBER_SELF_TARGET", 403, "MEMBER_SELF_TARGET"],
      ["MEMBER_ACTOR_REQUIRED", 403, "MEMBER_ACTOR_REQUIRED"],
      ["MEMBER_NOT_FOUND", 404, "MEMBER_NOT_FOUND"],
      ["MEMBER_NOT_SUSPENDIBLE", 409, "MEMBER_NOT_SUSPENDIBLE"],
      ["MEMBER_NOT_SUSPENDED", 409, "MEMBER_NOT_SUSPENDED"],
    ];
    for (const [sqlError, statusCode, code] of cases) {
      const mapped = lifecycleHttpError(sqlError);
      expect(mapped, sqlError).not.toBeNull();
      expect(mapped!.statusCode).toBe(statusCode);
      expect(mapped!.code).toBe(code);
    }
  });

  it("devuelve null para errores ajenos al ciclo de vida (se re-propagan)", () => {
    expect(lifecycleHttpError("connection refused")).toBeNull();
    expect(lifecycleHttpError("UserSession expired")).toBeNull();
  });

  it("audita sólo los rechazos sensibles", () => {
    expect(isAuditedRejection("LAST_ADMIN_REQUIRED")).toBe(true);
    expect(isAuditedRejection("OWNER_PROTECTED")).toBe(true);
    expect(isAuditedRejection("MEMBER_SELF_TARGET")).toBe(true);
    expect(isAuditedRejection("MEMBER_NOT_FOUND")).toBe(false);
    expect(Object.keys(AUDITED_REJECTIONS)).toHaveLength(3);
  });
});

describe("última cuenta: guard de último administrador en SQL", () => {
  it("suspensión y cambio de rol usan el mismo guard bajo advisory lock", () => {
    const suspendBody = migrationSql.slice(
      migrationSql.indexOf("app_suspend_internal_member"),
      migrationSql.indexOf("app_reactivate_internal_member"),
    );
    const changeBody = migrationSql.slice(
      migrationSql.indexOf("app_change_internal_member_role"),
      migrationSql.indexOf("REVOKE ALL ON FUNCTION app_change_internal_member_role"),
    );
    for (const [name, body] of [["suspend", suspendBody], ["change-role", changeBody]] as const) {
      expect(body, name).toContain("pg_advisory_xact_lock");
      expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("app_active_admin_count"));
      expect(body, name).toContain("LAST_ADMIN_REQUIRED");
    }
  });

  it("el guard de último admin excluye al objetivo y exige otro administrador activo", () => {
    expect(migrationSql).toContain("excluded_user_id");
    expect(migrationSql).toMatch(/role IN \('OWNER', 'ADMIN'\)/);
    expect(migrationSql).toMatch(/u\.status = 'ACTIVE'/);
  });
});

describe("sesiones: suspensión y degradación revocan todas las sesiones activas", () => {
  it("la suspensión revoca device_sessions", () => {
    const suspendBody = migrationSql.slice(
      migrationSql.indexOf("app_suspend_internal_member"),
      migrationSql.indexOf("app_reactivate_internal_member"),
    );
    expect(suspendBody).toMatch(/UPDATE device_sessions SET "revokedAt" = now\(\)/);
  });

  it("el cambio de rol que degrada revoca device_sessions", () => {
    const changeBody = migrationSql.slice(
      migrationSql.indexOf("app_change_internal_member_role"),
      migrationSql.indexOf("REVOKE ALL ON FUNCTION app_change_internal_member_role"),
    );
    expect(changeBody).toMatch(/UPDATE device_sessions SET "revokedAt" = now\(\)/);
  });

  it("la reactivación no re-crea sesiones (login nuevo)", () => {
    const reactivateBody = migrationSql.slice(
      migrationSql.indexOf("app_reactivate_internal_member"),
      migrationSql.indexOf("app_change_internal_member_role"),
    );
    expect(reactivateBody.length).toBeGreaterThan(0);
    expect(reactivateBody).not.toContain("device_sessions");
  });
});

describe("datos: sin hard-delete, el estado es la baja", () => {
  it("la migración no borra filas de users ni firm_memberships", () => {
    expect(migrationSql).not.toMatch(/DELETE FROM users\b/);
    expect(migrationSql).not.toMatch(/DELETE FROM firm_memberships\b/);
    expect(migrationSql).not.toMatch(/TRUNCATE/i);
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
  });

  it("la baja es un estado: suspend escribe SUSPENDED y reactivate vuelve a ACTIVE", () => {
    const suspendBody = migrationSql.slice(
      migrationSql.indexOf("app_suspend_internal_member"),
      migrationSql.indexOf("app_reactivate_internal_member"),
    );
    const reactivateBody = migrationSql.slice(
      migrationSql.indexOf("app_reactivate_internal_member"),
      migrationSql.indexOf("app_change_internal_member_role"),
    );
    expect(suspendBody).toMatch(/status = 'SUSPENDED'/);
    expect(reactivateBody).toMatch(/status = 'ACTIVE'/);
  });
});

describe("auditoría: eventos de actor/acción en el ciclo de vida", () => {
  it.each([
    "internal_member.suspended",
    "internal_member.reactivated",
    "internal_member.role_changed",
  ])("registra el evento %s con actor y entidad", (action) => {
    // La acción se registra como literal en la llamada al helper SQL.
    expect(migrationSql).toContain(`'${action}'`);
  });

  it("los eventos se escriben en audit_events con actor, entidad y before/after", () => {
    expect(migrationSql).toMatch(/INSERT INTO audit_events/);
    expect(migrationSql).toMatch(/'FirmMembership', target_membership_id/);
    expect(migrationSql).toMatch(/target_before, target_after/);
  });

  it("los eventos incluyen motivo truncado a 500", () => {
    expect(migrationSql.match(/left\(COALESCE\(target_reason, ''\), 500\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("bugfix de ambigüedad PL/pgSQL en el ciclo de vida F2", () => {
  // Verificado empíricamente: con RETURNS TABLE("userId", ...) el UPDATE sin
  // calificar fallaba con `column reference "userId" is ambiguous`. La
  // suspensión fallaba siempre y el cambio de rol fallaba justo en la rama
  // que revoca sesiones.
  const bugfixSql = readFileSync(
    join(thisDir, "../../prisma/migrations/20261106000000_fix_lifecycle_plpgsql_ambiguity/migration.sql"),
    "utf8",
  );

  it("los UPDATE de suspensión/reactivación/degradación califican las columnas", () => {
    for (const fn of [
      "app_suspend_internal_member",
      "app_reactivate_internal_member",
      "app_change_internal_member_role",
    ]) {
      const start = bugfixSql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
      expect(start, fn).toBeGreaterThan(-1);
      const body = bugfixSql.slice(start, bugfixSql.indexOf("CREATE OR REPLACE FUNCTION", start + 10));
      for (const update of body.match(/UPDATE (users|firm_memberships|device_sessions)[\s\S]*?;/g) ?? []) {
        expect(update, `${fn}: ${update.slice(0, 80)}`).toMatch(
          /WHERE (users|firm_memberships|device_sessions)\./,
        );
      }
    }
  });

  it("la revocación de sesiones sigue presente en suspensión y degradación", () => {
    expect(bugfixSql.split('UPDATE device_sessions SET "revokedAt" = now()').length - 1).toBe(2);
  });

  it("the replacement function retains the OWNER privilege boundary", () => {
    const start = bugfixSql.indexOf("CREATE OR REPLACE FUNCTION app_change_internal_member_role(");
    expect(start).toBeGreaterThan(-1);
    const body = bugfixSql.slice(start);
    expect(body).toMatch(/target_role = 'OWNER' OR target_new_role = 'OWNER'/);
    expect(body).toContain("app_actor_is_admin_only(target_actor_id, target_firm_id)");
    expect(body).toContain("RAISE EXCEPTION 'OWNER_PROTECTED'");
  });

  it("the security-definer search path fixes pg_temp after trusted schemas", () => {
    for (const sql of [migrationSql, bugfixSql]) {
      expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
      expect(sql).not.toContain("SET search_path = public");
    }
  });
});

describe("OWNER protegido en SQL", () => {
  it("nadie suspende a un OWNER; un ADMIN no lo modifica ni lo reactiva", () => {
    const suspendBody = migrationSql.slice(
      migrationSql.indexOf("app_suspend_internal_member"),
      migrationSql.indexOf("app_reactivate_internal_member"),
    );
    expect(suspendBody).toMatch(/IF target_role = 'OWNER' THEN/);
    const reactivateBody = migrationSql.slice(
      migrationSql.indexOf("app_reactivate_internal_member"),
      migrationSql.indexOf("app_change_internal_member_role"),
    );
    expect(reactivateBody).toMatch(/'OWNER'\s+AND\s+app_actor_is_admin_only/);
    const changeBody = migrationSql.slice(
      migrationSql.indexOf("app_change_internal_member_role"),
      migrationSql.indexOf("REVOKE ALL ON FUNCTION app_change_internal_member_role"),
    );
    expect(changeBody).toMatch(/target_role = 'OWNER' OR target_new_role = 'OWNER'/);
    expect(changeBody).toContain("app_actor_is_admin_only(target_actor_id, target_firm_id)");
    expect(changeBody).toContain("RAISE EXCEPTION 'OWNER_PROTECTED'");
  });
});
