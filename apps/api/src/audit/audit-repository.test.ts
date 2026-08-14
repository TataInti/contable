import { describe, expect, it } from "vitest";
import { redact } from "./audit-repository.js";

describe("audit redaction", () => {
  it("redacta campos sensibles", () => {
    const input = {
      name: "Juan Pérez",
      cuit: "20123456789",
      emailNormalized: "juan@example.com",
      passwordHash: "hash-secreto",
      role: "PREPARER",
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.cuit).toBe("[REDACTED]");
    expect(out.emailNormalized).toBe("[REDACTED]");
    expect(out.passwordHash).toBe("[REDACTED]");
    expect(out.name).toBe("Juan Pérez");
    expect(out.role).toBe("PREPARER");
  });

  it("redacta sensibles anidados", () => {
    const input = { user: { cuit: "20123456789", name: "Ana" }, meta: { x: 1 } };
    const out = redact(input) as { user: Record<string, unknown> };
    expect(out.user.cuit).toBe("[REDACTED]");
    expect(out.user.name).toBe("Ana");
  });

  it("no rompe con null/undefined/arrays", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact([{ cuit: "20123456789" }])).toEqual([{ cuit: "[REDACTED]" }]);
  });
});