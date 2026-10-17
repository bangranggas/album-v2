import { NextResponse } from "next/server";

import { requireDashboardSession } from "@/lib/api-auth";
import {
  invalidJson,
  jsonError,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import {
  isLockedPasscodeConfigured,
  verifyLockedPasscode,
} from "@/lib/locked-auth";
import {
  LOCKED_COOKIE_NAME,
  LOCKED_TTL_MS,
  signLockedSession,
} from "@/lib/locked-session";
import { extractIp, logEvent } from "@/lib/logger";
import { parseJsonBody, parsePasscodeInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/locked/unlock";
const COOKIE_MAX_AGE_SECONDS = Math.floor(LOCKED_TTL_MS / 1000);

/**
 * Opens the locked area for an hour.
 *
 * Two gates: the dashboard session (already required by the page) and the
 * passcode. The passcode itself is never stored — the cookie carries only an
 * expiry and an HMAC signature keyed on it, under its own signature context, so
 * this token can never be replayed as a dashboard session.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  const configuredPasscode = process.env.LOCKED_PASSCODE;
  if (!isLockedPasscodeConfigured(configuredPasscode)) {
    logEvent(
      "locked_unlock_failed",
      { route: ROUTE, ip_address: ip, reason: "unconfigured" },
      "error",
    );

    return jsonError(
      "UNCONFIGURED",
      `Set LOCKED_PASSCODE, then restart the server.`,
      503,
    );
  }

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent(
      "locked_unlock_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parsePasscodeInput(body.data);
  if (!input.ok) {
    logEvent(
      "locked_unlock_failed",
      { route: ROUTE, ip_address: ip, reason: "validation" },
      "error",
    );

    return validationError(input.message);
  }

  if (!verifyLockedPasscode(input.data.passcode, configuredPasscode)) {
    logEvent(
      "locked_unlock_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_passcode" },
      "error",
    );

    return jsonError("UNAUTHORIZED", "Incorrect passcode.", 401);
  }

  logEvent("locked_unlock_succeeded", { route: ROUTE, ip_address: ip });

  const response = jsonOk({ unlocked: true });

  response.cookies.set({
    name: LOCKED_COOKIE_NAME,
    value: signLockedSession({ now: Date.now(), secret: configuredPasscode }),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
