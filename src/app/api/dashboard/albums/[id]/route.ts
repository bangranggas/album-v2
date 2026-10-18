import { NextResponse } from "next/server";

import { deleteAlbum, renameAlbum } from "@/db/albums";
import { getDb } from "@/db/client";
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
import { parseAlbumName, parseJsonBody } from "@/lib/validation";
import { toApiAlbum } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/albums/[id]";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Renames an album. Renaming to the name it already has (or to the same name with
 * different capitalisation) succeeds, which is what makes the inline rename field
 * safe to save without checking first.
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
      "dashboard_album_rename_failed",
      { route: ROUTE, ip_address: ip, album_id: id, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parseAlbumName(body.data);
  if (!input.ok) {
    logEvent(
      "dashboard_album_rename_failed",
      { route: ROUTE, ip_address: ip, album_id: id, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const result = await renameAlbum(getDb(), id, input.data);

    if (!result.ok && result.reason === "name-taken") {
      logEvent("dashboard_album_conflict", {
        route: ROUTE,
        ip_address: ip,
        album_id: id,
        reason: "name_taken",
      });

      return conflict("An album with that name already exists.");
    }

    if (!result.ok) {
      logEvent(
        "dashboard_album_rename_failed",
        { route: ROUTE, ip_address: ip, album_id: id, reason: "not_found" },
        "error",
      );

      return notFound("That album no longer exists.");
    }

    logEvent("dashboard_album_renamed", {
      route: ROUTE,
      ip_address: ip,
      album_id: result.album.id,
    });

    return jsonOk({ album: toApiAlbum(result.album) });
  } catch (error) {
    logEvent(
      "dashboard_album_rename_failed",
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

/**
 * Deletes an album, and only the album: the links it grouped are untouched, and a
 * stale tile gets a 404 instead of a silent no-op.
 */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  try {
    const deleted = await deleteAlbum(getDb(), id);

    if (!deleted) {
      logEvent(
        "dashboard_album_delete_failed",
        { route: ROUTE, ip_address: ip, album_id: id, reason: "not_found" },
        "error",
      );

      return notFound("That album no longer exists.");
    }

    logEvent("dashboard_album_deleted", {
      route: ROUTE,
      ip_address: ip,
      album_id: id,
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    logEvent(
      "dashboard_album_delete_failed",
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
