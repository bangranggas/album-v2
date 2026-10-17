import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { unlockDomain } from "@/db/locked-domains";
import { requireDashboardSession, requireLockedSession } from "@/lib/api-auth";
import {
  internalError,
  notFound,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseLockedDomain } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/locked/domains/[domain]";

type RouteContext = { params: Promise<{ domain: string }> };

/** Path segments arrive percent-encoded; a malformed escape is passed through. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Reveals a domain again, which brings its links back to the normal dashboard.
 * The stored value is normalised the same way as when locking, so `Example.COM/`
 * and `example.com` address the same row.
 */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { domain: rawDomain } = await context.params;
  const now = Date.now();
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, now);
  if (denied) return denied;

  const lockedDenied = requireLockedSession(request, now);
  if (lockedDenied) return lockedDenied;

  const input = parseLockedDomain({ domain: decodeSegment(rawDomain) });
  if (!input.ok) {
    logEvent(
      "locked_domain_unlock_failed",
      { route: ROUTE, ip_address: ip, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const removed = await unlockDomain(getDb(), input.data.domain);

    if (!removed) {
      logEvent(
        "locked_domain_unlock_failed",
        {
          route: ROUTE,
          ip_address: ip,
          domain: input.data.domain,
          reason: "not_locked",
        },
        "error",
      );

      return notFound("That domain is not locked.");
    }

    logEvent("locked_domain_unlocked", {
      route: ROUTE,
      ip_address: ip,
      domain: input.data.domain,
    });

    return jsonOk({ removed: true });
  } catch (error) {
    logEvent(
      "locked_domain_unlock_failed",
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
