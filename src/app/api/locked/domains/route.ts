import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { lockDomain } from "@/db/locked-domains";
import { requireDashboardSession, requireLockedSession } from "@/lib/api-auth";
import {
  internalError,
  invalidJson,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseJsonBody, parseLockedDomain } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/locked/domains";

/**
 * Hides a domain. Both secrets are required: the dashboard session says who you
 * are, and the passcode says you may decide what stays hidden.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, now);
  if (denied) return denied;

  const lockedDenied = requireLockedSession(request, now);
  if (lockedDenied) return lockedDenied;

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent(
      "locked_domain_lock_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parseLockedDomain(body.data);
  if (!input.ok) {
    logEvent(
      "locked_domain_lock_failed",
      { route: ROUTE, ip_address: ip, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const created = await lockDomain(getDb(), input.data.domain);

    logEvent("locked_domain_locked", {
      route: ROUTE,
      ip_address: ip,
      domain: input.data.domain,
      created,
    });

    return jsonOk({ domain: input.data.domain, created });
  } catch (error) {
    logEvent(
      "locked_domain_lock_failed",
      {
        route: ROUTE,
        ip_address: ip,
        domain: input.data.domain,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}
