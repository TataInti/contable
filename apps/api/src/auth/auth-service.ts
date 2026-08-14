import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "./password.js";
import { decryptMfaSecret, verifyTotp } from "./totp.js";
import { SessionRepository } from "./session-repository.js";
import { issueMfaChallenge, verifyMfaChallenge } from "./mfa-challenge.js";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_SUSPENDED"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "SESSION_REVOKED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthServiceDeps {
  sessions: SessionRepository;
}

export class AuthService {
  constructor(private deps: AuthServiceDeps) {}

  /**
   * Login.
   * - Sin MFA: abre sesión y devuelve `OK` con refresh token.
   * - Con MFA: devuelve `MFA_REQUIRED` y un `mfaSessionToken` efímero (userId firmado).
   */
  async login(email: string, password: string) {
    const users = await prisma.$queryRaw<{
      id: string;
      emailNormalized: string;
      passwordHash: string;
      status: string;
      mfaEnabled: boolean;
      mfaSecretEncrypted: string | null;
    }[]>`SELECT * FROM app_find_login_user(${email})`;
    const user = users[0];
    if (!user) throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");

    if (user.status === "SUSPENDED" || user.status === "DISABLED") {
      throw new AuthError("ACCOUNT_SUSPENDED", "Cuenta suspendida");
    }

    if (user.mfaEnabled && user.mfaSecretEncrypted) {
      return { status: "MFA_REQUIRED" as const, mfaSessionToken: issueMfaChallenge(user.id) };
    }

    const session = await this.deps.sessions.create(user.id, REFRESH_TOKEN_TTL_MS);
    return { status: "OK" as const, refreshToken: session.refreshToken };
  }

  /**
   * Verifica MFA y abre sesión.
   * `mfaSessionUserId` es el userId obtenido en el paso MFA_REQUIRED.
   */
  async verifyMfaAndCreateSession(mfaSessionToken: string, code: string) {
    const userId = verifyMfaChallenge(mfaSessionToken);
    if (!userId) throw new AuthError("MFA_INVALID", "El desafío MFA es inválido o expiró");
    const users = await prisma.$queryRaw<{ id: string; status: string; mfaSecretEncrypted: string | null }[]>`
      SELECT * FROM app_find_mfa_user(${userId})
    `;
    const user = users[0];
    if (!user || !user.mfaSecretEncrypted) {
      throw new AuthError("MFA_INVALID", "MFA no configurado");
    }
    if (!verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted), code)) {
      throw new AuthError("MFA_INVALID", "Código inválido");
    }
    const session = await this.deps.sessions.create(user.id, REFRESH_TOKEN_TTL_MS);
    return session;
  }

  /** Abre sesión directa. */
  async createSession(userId: string) {
    return this.deps.sessions.create(userId, REFRESH_TOKEN_TTL_MS);
  }

  /** Rota el refresh token. */
  async rotateSession(refreshToken: string) {
    const rotated = await this.deps.sessions.rotate(refreshToken, REFRESH_TOKEN_TTL_MS);
    if (!rotated) throw new AuthError("SESSION_REVOKED", "Sesión revocada o expirada");
    return rotated;
  }

  /** Obtiene el contexto de un refresh token. */
  async contextForRefresh(refreshToken: string) {
    return this.deps.sessions.contextForRefresh(refreshToken);
  }
}
