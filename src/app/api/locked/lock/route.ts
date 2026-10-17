import { NextResponse } from "next/server";

import { requireDashboardSession, requireLockedSession } from "@/lib/api-auth";
import { jsonOk } from "@/lib/api-response";
import { LOCKED_COOKIE_NAME } from "@/lib/locked-session";
import { extractIp, logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ROUTE = "/api/locked/lock";

/**
 * "Lock now": ends the passcode session immediately instead of waiting out the
 * hour. Requires the locked cookie to begin with, so a stale tab cannot clear a
 * session it no longer owns.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();

  const denied = requireDashboardSession(request, now);
  if (denied) return denied;

  const lockedDenied = requireLockedSession(request, now);
  if (lockedDenied) return lockedDenied;

  logEvent("locked_area_locked", { route: ROUTE, ip_address: extractIp(request) });

  const response = jsonOk({ locked: true });

  response.cookies.set({
    name: LOCKED_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });

  return response;
}
