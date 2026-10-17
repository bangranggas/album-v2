import { createHmac } from "node:crypto";

import { constantTimeEqual } from "@/lib/auth";

/**
 * One stateless signed-token implementation shared by every cookie in the app.
 *
 * The *context* is what makes the cookies non-interchangeable: it is mixed into
 * the HMAC input, so a token minted for one purpose never verifies for another,
 * even if the owner happens to configure the same secret for both.
 */
export type TokenRejection =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "unconfigured";

export type TokenVerification =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: TokenRejection };

/** A SHA-256 HMAC rendered as lowercase hex, so it is always 64 characters. */
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

function signatureFor(
  expiresAt: number,
  secret: string,
  context: string,
): string {
  return createHmac("sha256", secret)
    .update(`${context}:${expiresAt}`)
    .digest("hex");
}

/**
 * Produces `"<expiresAtMs>.<hmac>"`. Nothing is stored server-side, so there is
 * no session table to clean up and no way for a token to outlive a rotated secret.
 */
export function signToken(options: {
  now: number;
  secret: string;
  context: string;
  ttlMs: number;
}): string {
  const expiresAt = options.now + options.ttlMs;

  return `${expiresAt}.${signatureFor(expiresAt, options.secret, options.context)}`;
}

/**
 * Fails closed: a missing secret, an empty context, a malformed token, a forged
 * signature, and an expired token are all reported as not valid.
 */
export function verifyToken(
  token: string | null | undefined,
  options: { now: number; secret: string | undefined; context: string },
): TokenVerification {
  const secret = options.secret;
  if (typeof secret !== "string" || secret === "") {
    return { valid: false, reason: "unconfigured" };
  }

  if (typeof options.context !== "string" || options.context === "") {
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
  if (
    !constantTimeEqual(
      providedSignature,
      signatureFor(expiresAt, secret, options.context),
    )
  ) {
    return { valid: false, reason: "bad-signature" };
  }

  if (expiresAt <= options.now) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, expiresAt };
}
