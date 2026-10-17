import { signToken, verifyToken, type TokenRejection } from "@/lib/signed-token";

/** Name of the cookie that carries the locked-area session. */
export const LOCKED_COOKIE_NAME = "lc_locked";

/**
 * How long the passcode keeps the locked area open. Deliberately much shorter
 * than the dashboard login: this is the sensitive area.
 */
export const LOCKED_TTL_MS = 60 * 60 * 1000;

/**
 * A different context from the dashboard session, so the two cookies can never be
 * exchanged for one another — even when both secrets hold the same value.
 */
const SIGNATURE_CONTEXT = "link-collector/locked-session";

export type LockedSessionRejection = TokenRejection;

export type LockedSessionVerification =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: LockedSessionRejection };

export function signLockedSession(options: {
  now: number;
  secret: string;
  ttlMs?: number;
}): string {
  return signToken({
    now: options.now,
    secret: options.secret,
    context: SIGNATURE_CONTEXT,
    ttlMs: options.ttlMs ?? LOCKED_TTL_MS,
  });
}

export function verifyLockedSession(
  token: string | null | undefined,
  options: { now: number; secret: string | undefined },
): LockedSessionVerification {
  return verifyToken(token, {
    now: options.now,
    secret: options.secret,
    context: SIGNATURE_CONTEXT,
  });
}
