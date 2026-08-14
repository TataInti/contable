import argon2 from "argon2";

/** Parámetros Argon2id. En test se reduce para velocidad; producción usa 64MiB. */
const isTest = process.env.NODE_ENV === "test";
const ARGON_MEMORY = isTest ? 16384 : 65536; // 16 MiB test, 64 MiB prod
const ARGON_TIME = isTest ? 2 : 3;

/** Hashea una contraseña con Argon2id (parámetros calibrados para producción). */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: ARGON_MEMORY,
    timeCost: ARGON_TIME,
    parallelism: 1,
  });
}

/** Verifica una contraseña contra su hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}