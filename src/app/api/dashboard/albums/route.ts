import { NextResponse } from "next/server";

import { createAlbum } from "@/db/albums";
import { getDb } from "@/db/client";
import { requireDashboardSession } from "@/lib/api-auth";
import {
  conflict,
  internalError,
  invalidJson,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseAlbumName, parseJsonBody } from "@/lib/validation";
import { toApiAlbum } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/albums";

/**
 * Creates an album. The name is the whole payload: an album holds no links of its
 * own, so there is nothing else to save at this point.
 *
 * Uniqueness is decided by the database's unique index on `name_key` rather than by
 * a read-then-write in this handler, so two tabs creating `Anime` at the same moment
 * cannot both succeed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent(
      "dashboard_album_create_failed",
      { route: ROUTE, ip_address: ip, reason: "invalid_json" },
      "error",
    );

    return invalidJson();
  }

  const input = parseAlbumName(body.data);
  if (!input.ok) {
    logEvent(
      "dashboard_album_create_failed",
      { route: ROUTE, ip_address: ip, reason: input.message },
      "error",
    );

    return validationError(input.message);
  }

  try {
    const result = await createAlbum(getDb(), input.data);

    if (!result.ok) {
      logEvent("dashboard_album_conflict", {
        route: ROUTE,
        ip_address: ip,
        reason: "name_taken",
      });

      return conflict("An album with that name already exists.");
    }

    logEvent("dashboard_album_created", {
      route: ROUTE,
      ip_address: ip,
      album_id: result.album.id,
    });

    return jsonOk({ album: toApiAlbum(result.album) }, 201);
  } catch (error) {
    logEvent(
      "dashboard_album_create_failed",
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
