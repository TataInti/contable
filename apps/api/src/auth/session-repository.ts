import { prisma } from "../lib/prisma.js";
import { randomUUID } from "node:crypto";
import { createRefreshPair, rotateRefresh, sha256 } from "./sessions.js";

export interface SessionContext {
  userId: string;
  firmId: string | null;
  clientId: string | null;
}

/**
 * Repositorio de sesiones por dispositivo (plan sección 19.2).
 * - Reutilizar un refresh ya rotado (replay) revoca toda la familia.
 * - El cliente recibe un token nuevo por refresh.
 */

export class SessionRepository {
  /** Crea una sesión nueva para un dispositivo. */
  async create(userId: string, ttlMs: number): Promise<{ refreshToken: string; sessionId: string }> {
    const pair = createRefreshPair();
    const expiresAt = new Date(Date.now() + ttlMs);
    const id = randomUUID();
    await prisma.$queryRaw`SELECT app_create_session(${id}, ${userId}, ${pair.refreshTokenHash}, ${pair.family.familyId}, ${expiresAt})`;
    return { refreshToken: pair.refreshToken, sessionId: id };
  }

  /**
   * Rota un refresh token. Devuelve null si el token no existe o está revocado.
   * Si el token corresponde a una versión anterior de la familia, se detecta replay
   * y se revoca toda la familia.
   */
  async rotate(refreshToken: string, ttlMs: number): Promise<{ refreshToken: string; sessionId: string } | null> {
    const hash = sha256(refreshToken);
    const pair = rotateRefresh({ familyId: "rotated-server-side", rotationCounter: 0 });
    const rows = await prisma.$queryRaw<{ sessionId: string; outcome: string }[]>`
      SELECT * FROM app_rotate_session(${hash}, ${pair.refreshTokenHash}, ${new Date(Date.now() + ttlMs)})
    `;
    const result = rows[0];
    if (!result || result.outcome !== "ROTATED") return null;
    return { refreshToken: pair.refreshToken, sessionId: result.sessionId };
  }

  /** Revoca una sesión concreta. */
  async revoke(sessionId: string): Promise<void> {
    await prisma.$queryRaw`SELECT app_revoke_session_by_id(${sessionId})`;
  }

  /** Revoca toda una familia (detección de replay). */
  async revokeFamily(familyId: string): Promise<void> {
    await prisma.deviceSession.updateMany({
      where: { familyId },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoca la sesión asociada a un refresh token concreto. */
  async revokeByToken(refreshToken: string): Promise<void> {
    const hash = sha256(refreshToken);
    await prisma.$queryRaw`SELECT app_revoke_session_by_token(${hash})`;
  }

  /** Devuelve el contexto de un refresh token válido. */
  async contextForRefresh(refreshToken: string): Promise<SessionContext | null> {
    const hash = sha256(refreshToken);
    const session = await prisma.deviceSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

    // El usuario debe estar activo
    if (session.user.status !== "ACTIVE") return null;

    return { userId: session.userId, firmId: null, clientId: null };
  }
}
