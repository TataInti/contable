import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { hashPassword, verifyPassword } from "./password.js";
import { createRefreshPair, rotateRefresh, sha256 } from "./sessions.js";
import { generateMfaSecret, regenerateBackupCodes, verifyBackupCode, verifyTotp } from "./totp.js";

describe("password", () => {
  it("hash + verify correcto", async () => {
    const hash = await hashPassword("supersecret123");
    expect(hash).not.toBe("supersecret123");
    expect(await verifyPassword("supersecret123", hash)).toBe(true);
  });

  it("rechaza contraseña incorrecta", async () => {
    const hash = await hashPassword("supersecret123");
    expect(await verifyPassword("incorrecta", hash)).toBe(false);
  });
});

describe("sessions", () => {
  it("crea un par opaco con hash sha256", () => {
    const pair = createRefreshPair();
    expect(pair.refreshToken.length).toBeGreaterThan(30);
    expect(pair.refreshToken).not.toBe(pair.refreshTokenHash);
    expect(sha256(pair.refreshToken)).toBe(pair.refreshTokenHash);
    expect(pair.family.rotationCounter).toBe(0);
  });

  it("rota el refresh y mantiene la familia", () => {
    const pair = createRefreshPair();
    const rotated = rotateRefresh(pair.family);
    expect(rotated.family.familyId).toBe(pair.family.familyId);
    expect(rotated.family.rotationCounter).toBe(1);
    expect(rotated.refreshToken).not.toBe(pair.refreshToken);
  });
});

describe("totp", () => {
  it("genera secreto y códigos de respaldo", () => {
    const setup = generateMfaSecret("user@example.com");
    expect(setup.secretB32).toMatch(/^[A-Z2-7]+=*$/);
    expect(setup.plainBackupCodes).toHaveLength(10);
    expect(setup.backupCodesHashes).toHaveLength(10);
  });

  it("verifica un código de respaldo", () => {
    const setup = generateMfaSecret("user@example.com");
    const idx = verifyBackupCode(setup.plainBackupCodes[0]!, setup.backupCodesHashes);
    expect(idx).toBe(0);
    expect(verifyBackupCode("invalid-code", setup.backupCodesHashes)).toBe(-1);
  });

  it("regenera códigos", () => {
    const regenerated = regenerateBackupCodes();
    expect(regenerated.plain).toHaveLength(10);
    expect(regenerated.hashes).toHaveLength(10);
  });

  it("verifica un TOTP válido", () => {
    const setup = generateMfaSecret("user@example.com");
    const totp = new OTPAuth.TOTP({
      issuer: "Contable",
      label: "user@example.com",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: setup.secretB32,
    });
    const code = totp.generate();
    expect(verifyTotp(setup.secretB32, code)).toBe(true);
  });
});