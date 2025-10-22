import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(_scrypt);

export type UserRole = "superadmin" | "kasir";

export type SessionPayload = {
  id: string;
  username: string;
  role: UserRole;
  iat: number;
  exp: number; // epoch millis
};

export const SESSION_COOKIE = "session";

function getSecret(): string {
  return process.env.AUTH_SECRET || "dev-secret";
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(norm, "base64");
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ saltHex: string; hashHex: string }> {
  const salt = saltHex || randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 32)) as Buffer;
  return { saltHex: salt, hashHex: key.toString("hex") };
}

export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const { hashHex: computed } = await hashPassword(password, saltHex);
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hashHex, "hex");
  try {
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function createSessionToken(payload: SessionPayload): string {
  const secret = getSecret();
  const json = Buffer.from(JSON.stringify(payload));
  const payloadB64 = toBase64Url(json);
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = toBase64Url(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const secret = getSecret();
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;
    const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
    const actualSig = fromBase64Url(sigB64);
    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) return null;
    const payloadBuf = fromBase64Url(payloadB64);
    const parsed = JSON.parse(payloadBuf.toString("utf8")) as SessionPayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildSessionPayload(id: string, username: string, role: UserRole, maxAgeDays = 7): SessionPayload {
  const now = Date.now();
  const exp = now + maxAgeDays * 24 * 60 * 60 * 1000;
  return { id, username, role, iat: now, exp };
}