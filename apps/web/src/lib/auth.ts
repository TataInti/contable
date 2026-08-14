import { api, type MeContext } from "./api";

export type LoginResult =
  | { status: "OK" }
  | { status: "MFA_REQUIRED"; mfaSessionToken: string };

export async function fetchMe(): Promise<MeContext> {
  return api.get<MeContext>("/me/contexts");
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return api.post<LoginResult>("/auth/login", { email, password });
}

export async function verifyMfa(mfaSessionToken: string, code: string): Promise<void> {
  await api.post("/auth/mfa/verify", { mfaSessionToken, code });
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}
