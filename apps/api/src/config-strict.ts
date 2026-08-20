/**
 * F2.5: validación estricta de configuración y secretos.
 *
 * En producción, la API exige que los secretos críticos estén configurados y
 * no sean placeholders. Si falta un secreto o usa un valor por defecto
 * inseguro, el arranque falla (fail-fast) en lugar de operar con credenciales
 * débiles.
 */

export interface StrictConfig {
  env: string;
  databaseUrl: string;
  redisUrl: string;
  aiServiceUrl: string;
  aiServiceSecret: string;
  mfaChallengeSecret: string;
  mfaEncryptionKey: string;
  minioAccessKey: string;
  minioSecretKey: string;
}

const PLACEHOLDER_PATTERNS = [
  /your-[a-z0-9-]+/i,
  /changeme/i,
  /<[^>]+>/,
  /^secret$/i,
  /^password$/i,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function isDefaultSecret(value: string, defaultValues: string[]): boolean {
  return defaultValues.includes(value);
}

/**
 * Valida la configuración. En producción lanza si falta un secreto crítico o
 * usa un placeholder. En desarrollo/test sólo advierte (para no romper el
 * entorno local).
 */
export function validateStrictConfig(env: string): StrictConfig {
  const config: StrictConfig = {
    env,
    databaseUrl: process.env.DATABASE_URL ?? "",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
    aiServiceSecret: process.env.AI_SERVICE_SECRET ?? "",
    mfaChallengeSecret: process.env.MFA_CHALLENGE_SECRET ?? "",
    mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY ?? "",
    minioAccessKey: process.env.MINIO_ACCESS_KEY ?? "contable",
    minioSecretKey: process.env.MINIO_SECRET_KEY ?? "contable-minio",
  };

  const isProd = env === "production";
  const problems: string[] = [];

  if (isProd) {
    if (!config.databaseUrl) problems.push("DATABASE_URL");
    if (!config.aiServiceSecret) problems.push("AI_SERVICE_SECRET");
    if (!config.mfaChallengeSecret) problems.push("MFA_CHALLENGE_SECRET");
    if (!config.mfaEncryptionKey) problems.push("MFA_ENCRYPTION_KEY");
    if (isPlaceholder(config.aiServiceSecret)) problems.push("AI_SERVICE_SECRET (placeholder)");
    if (isPlaceholder(config.mfaChallengeSecret)) problems.push("MFA_CHALLENGE_SECRET (placeholder)");
    if (isPlaceholder(config.mfaEncryptionKey)) problems.push("MFA_ENCRYPTION_KEY (placeholder)");
    if (isDefaultSecret(config.minioAccessKey, ["contable"])) problems.push("MINIO_ACCESS_KEY (default)");
    if (isDefaultSecret(config.minioSecretKey, ["contable-minio"])) problems.push("MINIO_SECRET_KEY (default)");
  }

  if (problems.length > 0) {
    const message = `Configuración inválida en ${env}: ${problems.join(", ")}`;
    if (isProd) {
      throw new Error(message);
    }
    console.warn(`[config] ${message} (sólo advertencia en ${env})`);
  }

  return config;
}

export const strictConfig = validateStrictConfig(process.env.NODE_ENV ?? "development");