import { NextResponse } from "next/server";

import { createAlbum, listAlbumCounts } from "@/db/albums";
import { getDb } from "@/db/client";
import { parseSpace, spaceToScope } from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
import {
  conflict,
  internalError,
  invalidJson,
  jsonError,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseAlbumName, parseJsonBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/agent/albums";

/** The albums of one space with their link counts (no covers: the agent cannot see them). */
export async function GET(request: Request): Promise<NextResponse> {
  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  const space = parseSpace(new URL(request.url).searchParams.get("space"));
  if (!space.ok) return validationError(space.message);

  if (space.data === "private" && !access.privateOpen) {
    return jsonError("PASSCODE_REQUIRED", "Ask the owner for the passcode to read private albums.", 403);
  }

  try {
    const rows = await listAlbumCounts(getDb(), spaceToScope(space.data));

    return jsonOk({
      albums: rows.map((row) => ({ id: row.id, name: row.name, count: row.linkCount })),
    });
  } catch (error) {
    logEvent(
      "agent_request_failed",
      { route: ROUTE, reason: error instanceof Error ? error.message : String(error) },
      "error",
    );

    return internalError();
  }
}

/**
 * Creates an album on the public (default) or private side. The name rules and the
 * per-side uniqueness are the dashboard's own: the database index decides a clash.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  const body = parseJsonBody(await request.text());
  if (!body.ok) return invalidJson();

  const name = parseAlbumName(body.data);
  if (!name.ok) return validationError(name.message);

  const rawSpace =
    typeof body.data === "object" && body.data !== null && "space" in body.data
      ? (body.data as { space: unknown }).space
      : undefined;
  const space = parseSpace(typeof rawSpace === "string" ? rawSpace : rawSpace === undefined ? null : "?");
  if (!space.ok) return validationError(space.message);

  if (space.data === "private" && !access.privateOpen) {
    return jsonError("PASSCODE_REQUIRED", "Ask the owner for the passcode to create a private album.", 403);
  }

  try {
    const result = await createAlbum(getDb(), { ...name.data, scope: spaceToScope(space.data) });

    if (!result.ok) {
      return conflict("An album with that name already exists on this side.");
    }

    logEvent("agent_album_created", {
      route: ROUTE,
      ip_address: extractIp(request),
      album_id: result.album.id,
      space: space.data,
    });

    return jsonOk(
      { album: { id: result.album.id, name: result.album.name, space: space.data } },
      201,
    );
  } catch (error) {
    logEvent(
      "agent_request_failed",
      { route: ROUTE, reason: error instanceof Error ? error.message : String(error) },
      "error",
    );

    return internalError();
  }
}
