import { NextResponse } from "next/server";

import { addLinksToAlbum } from "@/db/albums";
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
import { parseBulkAlbumLinkInput, parseJsonBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/albums/[id]/links";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Files a whole selection of links into one album.
 *
 * One request instead of one per link: the client sends the ids it just rendered,
 * and gets back an honest account of what happened to each of them. A link that is
 * already in the album is a success (`alreadyIn`), not an error, and an id that no
 * longer exists is skipped rather than written as an orphan.
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
      "dashboard_album_links_add_failed",
      { route: ROUTE, ip_address: ip, album_id: id, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parseBulkAlbumLinkInput(body.data);
  if (!input.ok) {
    logEvent(
      "dashboard_album_links_add_failed",
      { route: ROUTE, ip_address: ip, album_id: id, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const result = await addLinksToAlbum(getDb(), id, input.data.linkIds);

    if (result === "album-not-found") {
      logEvent(
        "dashboard_album_links_add_failed",
        {
          route: ROUTE,
          ip_address: ip,
          album_id: id,
          reason: "album_not_found",
        },
        "error",
      );

      return notFound("That album no longer exists.");
    }

    logEvent("dashboard_album_links_added", {
      route: ROUTE,
      ip_address: ip,
      album_id: id,
      added: result.added,
      already_in: result.alreadyIn,
      skipped: result.skipped,
    });

    return jsonOk(result);
  } catch (error) {
    logEvent(
      "dashboard_album_links_add_failed",
      {
        route: ROUTE,
        ip_address: ip,
        album_id: id,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}
