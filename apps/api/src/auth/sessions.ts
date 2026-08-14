import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Sesiones por dispositivo (ADR-006 / plan sección 19.2).
 * - El refresh es opaco, aleatorio y se guarda hasheado (SHA-256).
 * - Rota en cada uso: el cliente recibe un token nuevo por refresh.
 * - Reutilizar un token ya rotado (replay) revoca toda la familia del dispositivo.
 */

export interface SessionFamily {
  familyId: string;
  rotationCounter: number;
}

export interface NewRefreshPair {
  refreshToken: string;
  refreshTokenHash: string;
  family: SessionFamily;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Genera un refresh token opaco y su hash, iniciando una familia. */
export function createRefreshPair(): NewRefreshPair {
  const refreshToken = randomBytes(32).toString("base64url");
  const family: SessionFamily = { familyId: randomUUID(), rotationCounter: 0 };
  return {
    refreshToken,
    refreshTokenHash: sha256(refreshToken),
    family,
  };
}

/**
 * Rota un refresh: dado el token actual (aún sin hashear, recién recibido),
 * genera el siguiente. Devuelve el nuevo token + hash y la familia actualizada.
 */
export function rotateRefresh(
  previousFamily: SessionFamily,
): NewRefreshPair {
  const refreshToken = randomBytes(32).toString("base64url");
  const family: SessionFamily = {
    familyId: previousFamily.familyId,
    rotationCounter: previousFamily.rotationCounter + 1,
  };
  return {
    refreshToken,
    refreshTokenHash: sha256(refreshToken),
    family,
  };
}