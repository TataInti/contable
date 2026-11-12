import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { capabilitiesForRole } from "@contable/permissions";
import { requiredCapability } from "../auth/guard.js";

const thisDir = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(thisDir, "../../prisma/migrations/20261112144800_c5a_user_administration_functions/migration.sql"),
  "utf8",
);

const managedPaths = [
  ["GET", "/api/v1/firms/f1/profile"],
  ["PATCH", "/api/v1/firms/f1/profile"],
  ["PATCH", "/api/v1/firms/f1/users/u1"],
  ["PATCH", "/api/v1/firms/f1/members/u1"],
  ["POST", "/api/v1/firms/f1/members/u1/suspend"],
  ["POST", "/api/v1/firms/f1/members/u1/reactivate"],
  ["GET", "/api/v1/firms/f1/clients/c1/assignments"],
  ["POST", "/api/v1/firms/f1/clients/c1/assignments"],
  ["DELETE", "/api/v1/firms/f1/clients/c1/assignments/u1"],
  ["GET", "/api/v1/firms/f1/clients/c1/portal-memberships"],
  ["PATCH", "/api/v1/firms/f1/clients/c1/portal-memberships/m1"],
  ["POST", "/api/v1/firms/f1/clients/c1/portal-memberships/m1/revoke"],
  ["POST", "/api/v1/firms/f1/clients/c1/portal-memberships/m1/reactivate"],
] as const;

describe("autorización del corte C5a", () => {
  it.each(managedPaths.map(([method, path]) => [method, path]))(
    "%s %s requiere firm.users.manage",
    (method, path) => expect(requiredCapability(method, path)).toBe("firm.users.manage"),
  );

  it("OWNER y ADMIN tienen la capacidad; los demás roles reciben 403", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(capabilitiesForRole(role).has("firm.users.manage")).toBe(true);
    }
    for (const role of ["PREPARER", "REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(capabilitiesForRole(role).has("firm.users.manage")).toBe(false);
    }
  });
});

describe("migración C5a aditiva y acotada", () => {
  it("crea cinco funciones SECURITY DEFINER y no ejecuta DDL/DML fuera de ellas", () => {
    const names = [
      "app_c5a_update_member_identity",
      "app_c5a_update_firm_profile",
      "app_c5a_change_internal_member_role",
      "app_c5a_set_internal_member_status",
      "app_c5a_update_portal_membership",
    ];
    for (const name of names) {
      expect(migrationSql).toContain(`CREATE FUNCTION ${name}(`);
    }
    expect(migrationSql.match(/CREATE FUNCTION app_c5a_/g)).toHaveLength(names.length);
    expect(migrationSql.match(/SECURITY DEFINER/g)).toHaveLength(names.length);

    const outsideFunctions = migrationSql.replace(/AS \$\$[\s\S]*?\$\$/g, "AS $$ $$");
    expect(outsideFunctions).not.toMatch(/\b(DROP|ALTER TABLE|UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
  });

  it("revoca EXECUTE a PUBLIC/worker y lo concede sólo a contable_runtime", () => {
    expect(migrationSql.match(/REVOKE ALL ON FUNCTION app_c5a_/g)).toHaveLength(5);
    expect(migrationSql.match(/GRANT EXECUTE ON FUNCTION app_c5a_[^\n]+ TO contable_runtime;/g)).toHaveLength(5);
    expect(migrationSql).not.toMatch(/GRANT EXECUTE ON FUNCTION app_c5a_[^\n]+ TO (PUBLIC|contable_worker)/);
  });

  it("conserva aislamiento por contexto, el guard del último admin y la revocación inmediata", () => {
    expect(migrationSql.match(/current_setting\('app\.user_id', true\) IS DISTINCT FROM p_actor_id/g)).toHaveLength(5);
    expect(migrationSql).toContain("app_active_admin_count(p_firm_id, p_user_id) < 1");
    expect(migrationSql).toContain("UPDATE public.device_sessions AS session");
    expect(migrationSql).toContain("'LAST_ADMIN_REQUIRED'");
  });

  it("audita identidad y redacciona correo antes y después", () => {
    expect(migrationSql).toContain("'internal_user.identity_updated'");
    expect(migrationSql).toMatch(/jsonb_build_object\('name', old_name, 'emailNormalized', '\[REDACTED\]'\)/);
    expect(migrationSql).toMatch(/jsonb_build_object\('name', new_name, 'emailNormalized', '\[REDACTED\]'\)/);
    expect(migrationSql).toContain("'USER_EMAIL_CONFLICT'");
  });
});
