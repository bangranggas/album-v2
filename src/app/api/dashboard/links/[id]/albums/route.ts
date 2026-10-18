import { NextResponse } from "next/server";

import { addLinkToAlbum } from "@/db/albums";
import { getDb } from "@/db/client";
import { requireDashboardSession } from "@/lib/api-auth";
import {
  internalError,
  invalidJson,
  jsonOk,
  notFound,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseAlbumLinkInput, parseJsonBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/links/[id]/albums";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Puts a link into an album.
 *
 * Idempotent by design: the popup's checkbox state and the database can disagree
 * for a moment (a second tab, a stale page), and "already there" is a success with
 * `added: false` rather than an error the user cannot act on.
 */
export async function POST(
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
      "dashboard_album_member_add_failed",
      { route: ROUTE, ip_address: ip, link_id: id, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parseAlbumLinkInput(body.data);
  if (!input.ok) {
    logEvent(
      "dashboard_album_member_add_failed",
      { route: ROUTE, ip_address: ip, link_id: id, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const result = await addLinkToAlbum(getDb(), input.data.albumId, id);

    if (result === "album-not-found") {
      logEvent(
        "dashboard_album_member_add_failed",
        {
          route: ROUTE,
          ip_address: ip,
          link_id: id,
          album_id: input.data.albumId,
          reason: "album_not_found",
        },
        "error",
      );

      return notFound("That album no longer exists.");
    }

    if (result === "link-not-found") {
      logEvent(
        "dashboard_album_member_add_failed",
        { route: ROUTE, ip_address: ip, link_id: id, reason: "link_not_found" },
        "error",
      );

      return notFound("That link no longer exists.");
    }

    logEvent("dashboard_album_member_added", {
      route: ROUTE,
      ip_address: ip,
      link_id: id,
      album_id: input.data.albumId,
      added: result === "added",
    });

    return jsonOk({ added: result === "added" });
  } catch (error) {
    logEvent(
      "dashboard_album_member_add_failed",
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
