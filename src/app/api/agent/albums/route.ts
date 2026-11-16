import { NextResponse } from "next/server";

import { listAlbumCounts } from "@/db/albums";
import { getDb } from "@/db/client";
import { parseSpace, spaceToScope } from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
import { internalError, jsonError, jsonOk, validationError } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";

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
