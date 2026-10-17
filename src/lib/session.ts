import { createHmac } from "node:crypto";

import { constantTimeEqual } from "@/lib/auth";

/** Name of the cookie that carries the dashboard session. */
export const SESSION_COOKIE_NAME = "lc_session";

/** How long a login lasts before the password is required again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Binds the signature to this one purpose, so the dashboard password is never
 * used directly as an HMAC key and a token cannot be replayed elsewhere.
 */
const SIGNATURE_CONTEXT = "link-collector/dashboard-session";

/** A SHA-256 HMAC rendered as lowercase hex, so it is always 64 characters. */
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

export type SessionRejection =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "unconfigured";

export type SessionVerification =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: SessionRejection };

function signatureFor(expiresAt: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_CONTEXT}:${expiresAt}`)
    .digest("hex");
}

/**
 * Produces a stateless session token: `"<expiresAtMs>.<hmac>"`.
 * Nothing is stored server-side, so there is no session table to clean up.
 */
export function signSession(options: {
  now: number;
  secret: string;
  ttlMs?: number;
}): string {
  const expiresAt = options.now + (options.ttlMs ?? SESSION_TTL_MS);

  return `${expiresAt}.${signatureFor(expiresAt, options.secret)}`;
}

/**
 * Fails closed: a missing secret, a malformed token, a forged signature, and an
 * expired token are all reported the same way to the caller — as not valid.
 */
export function verifySession(
  token: string | null | undefined,
  options: { now: number; secret: string | undefined },
): SessionVerification {
  const secret = options.secret;
  if (typeof secret !== "string" || secret === "") {
    return { valid: false, reason: "unconfigured" };
  }

  if (typeof token !== "string" || token === "") {
    return { valid: false, reason: "malformed" };
  }

  const separatorIndex = token.indexOf(".");
  if (separatorIndex === -1) {
    return { valid: false, reason: "malformed" };
  }

  const rawExpiry = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);

  if (!/^\d+$/.test(rawExpiry)) {
    return { valid: false, reason: "malformed" };
  }

  const expiresAt = Number(rawExpiry);
  if (!Number.isSafeInteger(expiresAt)) {
    return { valid: false, reason: "malformed" };
  }

  if (!SIGNATURE_PATTERN.test(providedSignature)) {
    return { valid: false, reason: "malformed" };
  }

  // Signature is checked before expiry so a forged token never reaches the
  // clock comparison, regardless of which part was tampered with.
  if (!constantTimeEqual(providedSignature, signatureFor(expiresAt, secret))) {
    return { valid: false, reason: "bad-signature" };
  }

  if (expiresAt <= options.now) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, expiresAt };
}
