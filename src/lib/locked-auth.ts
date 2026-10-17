import { constantTimeEqual } from "@/lib/auth";
import { verifyLockedSession } from "@/lib/locked-session";

/**
 * A passcode shorter than this is treated as unconfigured, matching the rule for
 * the dashboard password: a placeholder like `1234` can never accidentally
 * protect (or unlock) the hidden area.
 */
export const MIN_PASSCODE_LENGTH = 16;

/**
 * Outcome of checking a request against the locked-area session. Split from the
 * HTTP response so the decision is unit-testable without Next.js.
 *
 * `prompt` means "no valid passcode cookie" — the caller sends the visitor to the
 * passcode page. There is no challenge response: the locked area is a page, not
 * a browser popup.
 */
export type LockedGate =
  | { action: "allow" }
  | { action: "prompt" }
  | { action: "unconfigured" };

export function isLockedPasscodeConfigured(
  passcode: string | undefined,
): passcode is string {
  return typeof passcode === "string" && passcode.length >= MIN_PASSCODE_LENGTH;
}

/**
 * Correctness check for a submitted passcode. Constant-time so a compare does not
 * leak where the first difference is, and fail-closed when unconfigured.
 */
export function verifyLockedPasscode(
  provided: string,
  configured: string | undefined,
): boolean {
  if (!isLockedPasscodeConfigured(configured)) return false;

  return constantTimeEqual(provided, configured);
}

/**
 * Decides whether a request may see the locked area. A dashboard session is a
 * separate gate checked by the proxy; this one only answers the passcode
 * question, so both are required for the page as a whole.
 */
export function evaluateLockedGate(options: {
  sessionToken: string | null | undefined;
  configuredPasscode: string | undefined;
  now: number;
}): LockedGate {
  if (!isLockedPasscodeConfigured(options.configuredPasscode)) {
    return { action: "unconfigured" };
  }

  const session = verifyLockedSession(options.sessionToken, {
    now: options.now,
    secret: options.configuredPasscode,
  });

  return session.valid ? { action: "allow" } : { action: "prompt" };
}
