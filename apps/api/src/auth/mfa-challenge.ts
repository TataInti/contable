import { createHmac, timingSafeEqual } from "node:crypto";

interface ChallengePayload {
  sub: string;
  exp: number;
  purpose: "mfa";
}

function secret(): string {
  const value = process.env.MFA_CHALLENGE_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MFA_CHALLENGE_SECRET_REQUIRED");
  }
  return "contable-development-mfa-secret-change-me";
}

function signature(encoded: string): string {
  return createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function issueMfaChallenge(userId: string, ttlSeconds = 300): string {
  const payload: ChallengePayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    purpose: "mfa",
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyMfaChallenge(token: string): string | null {
  const [encoded, received] = token.split(".");
  if (!encoded || !received) return null;
  const expected = signature(encoded);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ChallengePayload;
    if (payload.purpose !== "mfa" || !payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
