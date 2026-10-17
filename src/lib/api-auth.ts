import type { NextResponse } from "next/server";

import { LOCKED_COOKIE_NAME, verifyLockedSession } from "@/lib/locked-session";
import { isDashboardPasswordConfigured } from "@/lib/dashboard-auth";
import { isLockedPasscodeConfigured } from "@/lib/locked-auth";
import { jsonError, passcodeRequired, unauthorized } from "@/lib/api-response";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";

/**
 * Reading a cookie inside a route handler.
 *
 * The handlers receive a plain `Request` (which is what makes them callable from
 * a unit test), so the `Cookie` header is parsed here rather than reached for via
 * `next/headers`.
 */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      // Malformed percent-encoding: hand it to the verifier as-is, which will
      // reject it as a malformed token.
      return value;
    }
  }

  return undefined;
}

/** `false` also covers "the dashboard password is not configured". */
export function hasDashboardSession(
  request: Request,
  options: { now: number },
): boolean {
  return verifySession(readCookie(request, SESSION_COOKIE_NAME), {
    now: options.now,
    secret: process.env.DASHBOARD_PASSWORD,
  }).valid;
}

/** `false` also covers "the passcode is not configured". */
export function hasLockedSession(request: Request, options: { now: number }): boolean {
  return verifyLockedSession(readCookie(request, LOCKED_COOKIE_NAME), {
    now: options.now,
    secret: process.env.LOCKED_PASSCODE,
  }).valid;
}

export function isDashboardConfigured(): boolean {
  return isDashboardPasswordConfigured(process.env.DASHBOARD_PASSWORD);
}

export function isLockedConfigured(): boolean {
  return isLockedPasscodeConfigured(process.env.LOCKED_PASSCODE);
}

/**
 * The guard every dashboard endpoint runs first: `undefined` means "carry on",
 * any other value is the response to send back.
 *
 * Unconfigured comes before unauthenticated, so a half-set-up deployment says so
 * instead of pretending the visitor's password is wrong.
 */
export function requireDashboardSession(
  request: Request,
  now: number,
): NextResponse | undefined {
  if (!isDashboardConfigured()) {
    return jsonError(
      "UNCONFIGURED",
      `Set DASHBOARD_PASSWORD, then restart the server.`,
      503,
    );
  }

  if (!hasDashboardSession(request, { now })) {
    return unauthorized();
  }

  return undefined;
}

/** The second gate, on top of the dashboard session, for the locked area. */
export function requireLockedSession(
  request: Request,
  now: number,
): NextResponse | undefined {
  if (!isLockedConfigured()) {
    return jsonError(
      "UNCONFIGURED",
      `Set LOCKED_PASSCODE, then restart the server.`,
      503,
    );
  }

  if (!hasLockedSession(request, { now })) {
    return passcodeRequired();
  }

  return undefined;
}
