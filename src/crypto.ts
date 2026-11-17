export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export async function hmacHex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
}

export function randomToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export type SignedToken = {
  body: string;
  signature: string;
};

export async function signToken(secret: string, body: string): Promise<string> {
  const signature = await hmacHex(secret, body);
  return `${body}.${signature}`;
}

export async function verifyToken(secret: string, token: string): Promise<string | null> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = await hmacHex(secret, body);
  if (!constantTimeEqual(signature, expected)) return null;
  return body;
}

export function makeConfirmToken(secret: string): Promise<string> {
  const body = `${randomToken(16)}:${Date.now().toString(36)}`;
  return signToken(secret, body);
}

export function makeUnsubscribeToken(secret: string, subscriberId: string): Promise<string> {
  return signToken(secret, `unsub:${subscriberId}`);
}
