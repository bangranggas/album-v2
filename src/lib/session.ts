import { signToken, verifyToken, type TokenRejection } from "@/lib/signed-token";

/** Name of the cookie that carries the dashboard session. */
export const SESSION_COOKIE_NAME = "lc_session";

/** How long a login lasts before the password is required again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Binds the signature to this one purpose, so the dashboard password is never
 * used directly as an HMAC key and a token cannot be replayed elsewhere — in
 * particular not as a locked-area token.
 */
const SIGNATURE_CONTEXT = "link-collector/dashboard-session";

export type SessionRejection = TokenRejection;

export type SessionVerification =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: SessionRejection };

/**
 * Produces a stateless session token: `"<expiresAtMs>.<hmac>"`.
 * Nothing is stored server-side, so there is no session table to clean up.
 */
export function signSession(options: {
  now: number;
  secret: string;
  ttlMs?: number;
}): string {
  return signToken({
    now: options.now,
    secret: options.secret,
    context: SIGNATURE_CONTEXT,
    ttlMs: options.ttlMs ?? SESSION_TTL_MS,
  });
}

/**
 * Fails closed: a missing secret, a malformed token, a forged signature, and an
 * expired token are all reported the same way to the caller — as not valid.
 */
export function verifySession(
  token: string | null | undefined,
  options: { now: number; secret: string | undefined },
): SessionVerification {
  return verifyToken(token, {
    now: options.now,
    secret: options.secret,
    context: SIGNATURE_CONTEXT,
  });
}
