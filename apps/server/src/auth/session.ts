import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppConfig } from "../config.js";
import { authEnabled } from "../config.js";

const COOKIE_NAME = "erolib_session";

export interface AuthSession {
  username: string;
  exp: number;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  secret: string,
  username: string,
  ttlSeconds = 60 * 60 * 24 * 14,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(
    JSON.stringify({ username, exp } satisfies AuthSession),
    "utf8",
  ).toString("base64url");
  const sig = sign(secret, body);
  return `${body}.${sig}`;
}

export function verifySessionToken(
  secret: string,
  token: string,
): AuthSession | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = sign(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json: unknown = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );
    if (
      !json ||
      typeof json !== "object" ||
      !("username" in json) ||
      !("exp" in json)
    ) {
      return null;
    }
    const username = json.username;
    const exp = json.exp;
    if (typeof username !== "string" || typeof exp !== "number") return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;
    return { username, exp };
  } catch {
    return null;
  }
}

export function checkPassword(
  config: AppConfig,
  username: string,
  password: string,
): boolean {
  if (!authEnabled(config)) return true;
  const uOk = username === config.authUsername;
  const pA = Buffer.from(password);
  const pB = Buffer.from(config.authPassword ?? "");
  const pOk =
    pA.length === pB.length && pA.length > 0 && timingSafeEqual(pA, pB);
  return uOk && pOk;
}

export function authMiddleware(config: AppConfig): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (!authEnabled(config)) {
      await next();
      return;
    }

    const path = c.req.path;
    if (
      path === "/api/health" ||
      path === "/api/auth/login" ||
      path === "/api/auth/status"
    ) {
      await next();
      return;
    }

    if (!path.startsWith("/api/")) {
      await next();
      return;
    }

    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = verifySessionToken(config.credentialsSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("authUser", session.username);
    await next();
  };
}

export function setSessionCookie(
  c: Context,
  config: AppConfig,
  username: string,
): void {
  const token = createSessionToken(config.credentialsSecret, username);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export function randomToken(): string {
  return randomBytes(16).toString("hex");
}
