import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { deleteLink, updateLink } from "@/db/links";
import { requireDashboardSession } from "@/lib/api-auth";
import {
  conflict,
  internalError,
  invalidJson,
  jsonOk,
  notFound,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseJsonBody, parseLinkPatch } from "@/lib/validation";
import { toApiLink } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/links/[id]";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Edits a stored link: any combination of title, URL, thumbnail, and the favorite
 * flag. The domain is never taken from the request — `parseLinkPatch` derives it
 * from a new URL, so a link can never claim a domain it does not have.
 *
 * Reachable from both the dashboard and the locked page. The passcode protects
 * *seeing* hidden links; ids are UUIDs that can only be learned after unlocking.
 */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent(
      "dashboard_link_update_failed",
      { route: ROUTE, ip_address: ip, link_id: id, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const patch = parseLinkPatch(body.data);
  if (!patch.ok) {
    logEvent(
      "dashboard_link_update_failed",
      { route: ROUTE, ip_address: ip, link_id: id, reason: patch.message },
      "error",
    );

    return validationError(patch.message);
  }

  try {
    const result = await updateLink(getDb(), id, patch.data);

    if (!result.ok && result.reason === "url-taken") {
      logEvent("dashboard_link_conflict", {
        route: ROUTE,
        ip_address: ip,
        link_id: id,
        reason: "url_taken",
      });

      return conflict("That URL is already saved on another link.");
    }

    if (!result.ok) {
      logEvent(
        "dashboard_link_update_failed",
        { route: ROUTE, ip_address: ip, link_id: id, reason: "not_found" },
        "error",
      );

      return notFound("That link no longer exists.");
    }

    logEvent("dashboard_link_updated", {
      route: ROUTE,
      ip_address: ip,
      link_id: result.link.id,
      domain: result.link.domain,
      fields: Object.keys(patch.data),
    });

    return jsonOk({ link: toApiLink(result.link) });
  } catch (error) {
    logEvent(
      "dashboard_link_update_failed",
      {
        route: ROUTE,
        ip_address: ip,
        link_id: id,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}

/** Deletes a link permanently. A stale card gets a 404 rather than a silent no-op. */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  try {
    const deleted = await deleteLink(getDb(), id);

    if (!deleted) {
      logEvent(
        "dashboard_link_delete_failed",
        { route: ROUTE, ip_address: ip, link_id: id, reason: "not_found" },
        "error",
      );

      return notFound("That link no longer exists.");
    }

    logEvent("dashboard_link_deleted", {
      route: ROUTE,
      ip_address: ip,
      link_id: id,
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    logEvent(
      "dashboard_link_delete_failed",
      {
        route: ROUTE,
        ip_address: ip,
        link_id: id,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}
