import { constantTimeEqual } from "@/lib/auth";
import { verifySession } from "@/lib/session";

/**
 * Outcome of checking a request against the dashboard session. Split from the
 * HTTP response so the decision logic is unit-testable without Next.js.
 *
 * `redirect` means "not authenticated" — the caller sends the visitor to the
 * login page. There is deliberately no challenge action: the browser's native
 * Basic Auth popup is gone.
 */
export type DashboardGate =
  | { action: "allow" }
  | { action: "redirect" }
  | { action: "unconfigured" };

/**
 * Any non-blank value counts as configured — there is no minimum length, so a
 * short password you can retype is fine. A missing or whitespace-only value still
 * counts as unconfigured and fails closed, so a blank variable can never protect
 * (or unlock) the dashboard.
 */
export function isDashboardPasswordConfigured(
  password: string | undefined,
): password is string {
  return typeof password === "string" && password.trim() !== "";
}

/**
 * Correctness check for a submitted login password. Constant-time so the compare
 * does not leak where the first difference is, and fail-closed when unconfigured.
 */
export function verifyDashboardPassword(
  provided: string,
  configured: string | undefined,
): boolean {
  if (!isDashboardPasswordConfigured(configured)) return false;

  return constantTimeEqual(provided, configured);
}

/**
 * Decides whether a request may see the dashboard.
 *
 * The session cookie doubles as proof of the password: it is signed with
 * HMAC(DASHBOARD_PASSWORD), so rotating the password invalidates every existing
 * session without any extra bookkeeping.
 */
export function evaluateDashboardGate(options: {
  sessionToken: string | null | undefined;
  configuredPassword: string | undefined;
  now: number;
}): DashboardGate {
  if (!isDashboardPasswordConfigured(options.configuredPassword)) {
    return { action: "unconfigured" };
  }

  const session = verifySession(options.sessionToken, {
    now: options.now,
    secret: options.configuredPassword,
  });

  return session.valid ? { action: "allow" } : { action: "redirect" };
}
