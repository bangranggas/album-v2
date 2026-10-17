import { NextResponse } from "next/server";

import {
  isDashboardPasswordConfigured,
  MIN_PASSWORD_LENGTH,
  verifyDashboardPassword,
} from "@/lib/dashboard-auth";
import { extractIp, logEvent } from "@/lib/logger";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, signSession } from "@/lib/session";
import { parseJsonBody, parseLoginInput } from "@/lib/validation";
import { apiError } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/auth/login";
const COOKIE_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

/**
 * Creates the dashboard session. The password is the only credential — there is
 * no username — and it is never echoed back or stored in the cookie: the cookie
 * holds only an expiry and an HMAC signature.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  const ip = extractIp(request);

  if (!isDashboardPasswordConfigured(configuredPassword)) {
    logEvent(
      "dashboard_login_failed",
      { route: ROUTE, ip_address: ip, reason: "unconfigured" },
      "error",
    );

    return NextResponse.json(
      apiError(
        "UNCONFIGURED",
        `Set DASHBOARD_PASSWORD to at least ${MIN_PASSWORD_LENGTH} characters, then restart the server.`,
      ),
      { status: 503 },
    );
  }

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent(
      "dashboard_login_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_json" },
      "error",
    );

    return NextResponse.json(
      apiError("INVALID_JSON", "Request body is not valid JSON."),
      { status: 400 },
    );
  }

  const input = parseLoginInput(body.data);
  if (!input.ok) {
    logEvent(
      "dashboard_login_failed",
      { route: ROUTE, ip_address: ip, reason: "validation" },
      "error",
    );

    return NextResponse.json(apiError("VALIDATION_ERROR", input.message), {
      status: 400,
    });
  }

  if (!verifyDashboardPassword(input.data.password, configuredPassword)) {
    logEvent(
      "dashboard_login_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_password" },
      "error",
    );

    return NextResponse.json(apiError("UNAUTHORIZED", "Incorrect password."), {
      status: 401,
    });
  }

  logEvent("dashboard_login_succeeded", { route: ROUTE, ip_address: ip });

  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: signSession({ now: Date.now(), secret: configuredPassword }),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
