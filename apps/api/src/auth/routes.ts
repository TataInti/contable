import type { FastifyInstance, FastifyReply } from "fastify";
import { loginSchema, mfaVerifySchema } from "@contable/contracts";
import { AuthService, AuthError } from "./auth-service.js";
import { SessionRepository } from "./session-repository.js";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { withTenantContext } from "./tenant.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "./password.js";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(12).max(200),
}).strict();

// Canje de un enlace de recuperación de acceso emitido por un administrador
// al miembro interno. La contraseña nueva la define el propio usuario: el
// gestor nunca la ve. El token viaja en claro por HTTPS y en la base sólo
// existe su hash SHA-256 (patrón portal_invitations).
const accessRecoveryRedeemSchema = z.object({
  token: z.string().min(32).max(300),
  newPassword: z.string().min(12).max(200),
}).strict();

const SECURE = process.env.NODE_ENV === "production";

const setSessionCookies = (reply: FastifyReply, refreshToken: string) => {
  const csrfToken = randomBytes(32).toString("base64url");
  reply.setCookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  reply.setCookie("csrf_token", csrfToken, {
    httpOnly: false,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
};

function hasValidCsrf(req: { cookies: Record<string, unknown>; headers: Record<string, unknown> }): boolean {
  const cookie = req.cookies.csrf_token;
  const header = req.headers["x-csrf-token"];
  return typeof cookie === "string" && typeof header === "string" && cookie.length >= 32 && cookie === header;
}

export function authPlugin(app: FastifyInstance) {
  const sessions = new SessionRepository();
  const auth = new AuthService({ sessions });

  app.post("/api/v1/auth/password/change", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Sin sesión" } });
    const body = changePasswordSchema.parse(req.body);
    const account = await withTenantContext(
      { userId, firmId: "", actorKind: "USER" },
      (tx) => tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    );
    if (!account || !(await verifyPassword(body.currentPassword, account.passwordHash))) {
      return reply.status(400).send({ error: { code: "INVALID_CREDENTIALS", message: "La contraseña actual es incorrecta" } });
    }
    if (await verifyPassword(body.newPassword, account.passwordHash)) {
      return reply.status(400).send({ error: { code: "PASSWORD_REUSED", message: "Elegí una contraseña distinta" } });
    }
    const passwordHash = await hashPassword(body.newPassword);
    await withTenantContext(
      { userId, firmId: "", actorKind: "USER" },
      (tx) => tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
    );
    return reply.send({ data: { status: "OK" } });
  });

  // El límite de login es configurable: la suite E2E hace ~16 logins por
  // corrida desde la misma IP y el límite fijo de 10/min la hace fallar de
  // forma intermitente. En producción se mantiene el default estricto.
  const loginRateLimitMax = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);
  app.post("/api/v1/auth/login", { config: { rateLimit: { max: loginRateLimitMax, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    try {
      const result = await auth.login(body.email, body.password);
      if (result.status === "MFA_REQUIRED") {
        return reply.send({ data: { status: "MFA_REQUIRED", mfaSessionToken: result.mfaSessionToken } });
      }
      setSessionCookies(reply, result.refreshToken);
      return reply.send({ data: { status: "OK" } });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(401).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // Canje del enlace de recuperación: ruta pública (la credencial es el
  // token), rate-limit estricto. La validación de un solo uso, caducidad,
  // revocación y usuario activo es atómica en SQL
  // (app_redeem_member_access_recovery); el fallo es genérico RECOVERY_INVALID
  // para no dar un oráculo de estados. Nunca se loguea el token ni la
  // contraseña.
  app.post("/api/v1/auth/access-recovery/redeem", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const body = accessRecoveryRedeemSchema.parse(req.body);
    const tokenHash = createHash("sha256").update(body.token).digest("hex");
    const passwordHash = await hashPassword(body.newPassword);
    try {
      const rows = await prisma.$queryRaw<{ userId: string; status: string }[]>`
        SELECT * FROM app_redeem_member_access_recovery(${tokenHash}, ${passwordHash})
      `;
      if (!rows[0]) {
        return reply.status(400).send({
          error: { code: "RECOVERY_INVALID", message: "El enlace de recuperación es inválido, expiró o ya fue usado" },
        });
      }
      return reply.send({ data: { status: "OK" } });
    } catch (err) {
      // Fallo genérico e indistinguible: no se revela cuál fue la causa.
      if (String(err).includes("RECOVERY_INVALID")) {
        return reply.status(400).send({
          error: { code: "RECOVERY_INVALID", message: "El enlace de recuperación es inválido, expiró o ya fue usado" },
        });
      }
      throw err;
    }
  });

  app.post("/api/v1/auth/mfa/verify", { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const body = mfaVerifySchema.parse(req.body);
    try {
      const session = await auth.verifyMfaAndCreateSession(body.mfaSessionToken, body.code);
      setSessionCookies(reply, session.refreshToken);
      return reply.send({ data: { status: "OK" } });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(401).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  app.post("/api/v1/auth/refresh", async (req, reply) => {
    const refreshToken = req.cookies.refresh_token as string | undefined;
    if (!refreshToken) {
      return reply.status(401).send({ error: { code: "SESSION_REVOKED", message: "Sin sesión" } });
    }
    if (!hasValidCsrf(req)) {
      return reply.status(403).send({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido" } });
    }
    try {
      const rotated = await auth.rotateSession(refreshToken);
      setSessionCookies(reply, rotated.refreshToken);
      return reply.send({ data: { status: "OK" } });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(401).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    const refreshToken = req.cookies.refresh_token as string | undefined;
    if (refreshToken && !hasValidCsrf(req)) {
      return reply.status(403).send({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido" } });
    }
    if (refreshToken) {
      // Revocación real de la sesión en DB
      await sessions.revokeByToken(refreshToken).catch(() => {});
    }
    reply.setCookie("refresh_token", "", {
      httpOnly: true,
      secure: SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    reply.setCookie("csrf_token", "", {
      httpOnly: false,
      secure: SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return reply.send({ data: { status: "OK" } });
  });
}
