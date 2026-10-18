import { NextResponse } from "next/server";

import { removeLinkFromAlbum } from "@/db/albums";
import { getDb } from "@/db/client";
import { requireDashboardSession } from "@/lib/api-auth";
import { internalError, jsonOk, notFound } from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/links/[id]/albums/[albumId]";

type RouteContext = { params: Promise<{ id: string; albumId: string }> };

/**
 * Takes a link out of an album. Only the membership goes: the link itself, and its
 * other albums, are untouched.
 */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id, albumId } = await context.params;
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  try {
    const removed = await removeLinkFromAlbum(getDb(), albumId, id);

    if (!removed) {
      logEvent(
        "dashboard_album_member_remove_failed",
        {
          route: ROUTE,
          ip_address: ip,
          link_id: id,
          album_id: albumId,
          reason: "not_a_member",
        },
        "error",
      );

      return notFound("That link is not in this album.");
    }

    logEvent("dashboard_album_member_removed", {
      route: ROUTE,
      ip_address: ip,
      link_id: id,
      album_id: albumId,
    });

    return jsonOk({ removed: true });
  } catch (error) {
    logEvent(
      "dashboard_album_member_remove_failed",
      {
        route: ROUTE,
        ip_address: ip,
        link_id: id,
        album_id: albumId,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}
