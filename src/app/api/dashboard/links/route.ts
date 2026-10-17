import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { upsertLink } from "@/db/links";
import { requireDashboardSession } from "@/lib/api-auth";
import {
  internalError,
  invalidJson,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseJsonBody, parseManualLinkInput } from "@/lib/validation";
import { toApiLink } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/links";

/**
 * The dashboard's own "add a link" endpoint.
 *
 * It is authenticated by the session cookie, not by `x-secret-key`: this is the
 * human interface, and the browser already holds the session. The payload is the
 * same shape the userscript posts, except that the title may be omitted.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent(
      "dashboard_link_create_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parseManualLinkInput(body.data);
  if (!input.ok) {
    logEvent(
      "dashboard_link_create_failed",
      { route: ROUTE, ip_address: ip, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const { link, inserted } = await upsertLink(getDb(), input.data);

    logEvent("dashboard_link_created", {
      route: ROUTE,
      ip_address: ip,
      link_id: link.id,
      domain: link.domain,
      inserted,
    });

    return jsonOk({ link: toApiLink(link), inserted });
  } catch (error) {
    logEvent(
      "dashboard_link_create_failed",
      {
        route: ROUTE,
        ip_address: ip,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}
