import { constantTimeEqual, hmacHex, sha256Hex } from "./crypto";

export const COOKIE_NAME = "__Host-optkit_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function wantsSecureCookie(): boolean {
  return true;
}

export function sessionCookie(value: string, maxAge: number): string {
  return [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return sessionCookie("", 0);
}

export async function makeSession(secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const body = `owner:${expires}`;
  const signature = await hmacHex(secret, body);
  return `${body}.${signature}`;
}

export async function readSession(secret: string, cookieHeader: string | null): Promise<boolean> {
  if (!secret || !cookieHeader) return false;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return false;
  const token = match.slice(COOKIE_NAME.length + 1);
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = await hmacHex(secret, body);
  if (!constantTimeEqual(signature, expected)) return false;
  const [subject, expiresRaw] = body.split(":");
  if (subject !== "owner") return false;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  return true;
}

export async function checkOwnerPassword(passwordHashHex: string, candidate: string): Promise<boolean> {
  if (!passwordHashHex || !candidate) return false;
  const candidateHash = await sha256Hex(candidate);
  return constantTimeEqual(candidateHash, passwordHashHex);
}

export async function verifyTurnstile(secret: string | undefined, token: string | null): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token }),
  });
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}
