import { serialize } from "cookie";

/**
 * Cookies seguras (plan sección 19.2).
 * HttpOnly, Secure (producción), SameSite=Lax, path limitado.
 */

export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
  path?: string;
}

export interface AuthCookies {
  accessToken: string;
  refreshToken: string;
}

export function accessCookieOptions(opts: CookieOptions): string {
  return serialize("access_token", "", {
    httpOnly: true,
    secure: opts.secure,
    sameSite: "lax",
    path: opts.path ?? "/",
    maxAge: opts.maxAgeSeconds,
  });
}

export function refreshCookieOptions(opts: CookieOptions): string {
  return serialize("refresh_token", "", {
    httpOnly: true,
    secure: opts.secure,
    sameSite: "lax",
    path: opts.path ?? "/api/v1/auth",
    maxAge: opts.maxAgeSeconds,
  });
}

/** Serializa la cookie de sesión con el token dado. */
export function sessionCookie(
  name: "access_token" | "refresh_token",
  token: string,
  opts: CookieOptions,
): string {
  return serialize(name, token, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: "lax",
    path: name === "refresh_token" ? "/api/v1/auth" : "/",
    maxAge: opts.maxAgeSeconds,
  });
}

/** Cookie de limpieza (logout). */
export function clearCookie(name: "access_token" | "refresh_token", secure: boolean): string {
  return serialize(name, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: name === "refresh_token" ? "/api/v1/auth" : "/",
    maxAge: 0,
  });
}