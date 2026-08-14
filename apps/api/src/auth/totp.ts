import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";

/**
 * MFA TOTP (plan sección 19.2).
 * - Secreto TOTP cifrado en reposo con AES-256-GCM.
 * - Códigos de recuperación hasheados, de un solo uso y regenerables.
 */

export interface MfaSetup {
  secretB32: string;
  otpauthUrl: string;
  backupCodesHashes: string[];
  plainBackupCodes: string[];
}

const ISSUER = "Contable";

function encryptionKey(): Buffer {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY debe contener 32 bytes en base64");
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("MFA_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update("contable-development-mfa-encryption-key").digest();
}

export function encryptMfaSecret(secretB32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secretB32, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptMfaSecret(encrypted: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    if (process.env.NODE_ENV === "production") throw new Error("MFA_SECRET_NOT_ENCRYPTED");
    return encrypted;
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

/** Genera un secreto TOTP y códigos de respaldo. */
export function generateMfaSecret(userEmail: string): MfaSetup {
  const secret = new OTPAuth.Secret({ size: 20 });
  const secretB32 = secret.base32;
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: userEmail,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secretB32,
  });
  const otpauthUrl = totp.toString();

  const plainBackupCodes: string[] = [];
  const backupCodesHashes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = generateBackupCode();
    plainBackupCodes.push(code);
    backupCodesHashes.push(sha256(code));
  }

  return { secretB32, otpauthUrl, backupCodesHashes, plainBackupCodes };
}

function generateBackupCode(): string {
  const raw = randomBytes(6).toString("hex");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Verifica un código TOTP contra el secreto. */
export function verifyTotp(secretB32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secretB32,
  });
  // delta 1 permite 30s de holgura
  return totp.validate({ token: code, window: 1 }) !== null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Verifica un código de respaldo contra la lista hasheada; devuelve el índice usado. */
export function verifyBackupCode(
  code: string,
  backupCodesHashes: string[],
): number {
  const hash = sha256(code);
  return backupCodesHashes.findIndex((h) => h === hash);
}

/** Regenera los códigos de respaldo (el viejo queda invalidado). */
export function regenerateBackupCodes(): { hashes: string[]; plain: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = generateBackupCode();
    plain.push(code);
    hashes.push(sha256(code));
  }
  return { hashes, plain };
}
