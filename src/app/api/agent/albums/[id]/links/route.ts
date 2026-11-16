import { NextResponse } from "next/server";

import { addLinksToAlbum } from "@/db/albums";
import { getDb } from "@/db/client";
import { resolveAlbumForAgent } from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
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

const ROUTE = "/api/agent/albums/[id]/links";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Files many links into one album in a single request (the repository's bulk add,
 * so its rules apply: ids that do not exist, or that sit on the other side of the
 * public/private line, are skipped rather than stored).
 *
 * The album is resolved *before* anything is written, because `addLinksToAlbum`
 * knows nothing about the passcode: a private album without it must be a 404.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  const body = parseJsonBody(await request.text());
  if (!body.ok) return invalidJson();

  const input = parseBulkAlbumLinkInput(body.data);
  if (!input.ok) return validationError(input.message);

  try {
    const db = getDb();

    const resolved = await resolveAlbumForAgent(db, id, access);
    if (resolved === undefined) return notFound("Album not found.");

    const result = await addLinksToAlbum(db, id, input.data.linkIds);
    if (result === "album-not-found") return notFound("Album not found.");

    logEvent("agent_album_links_added", {
      route: ROUTE,
      ip_address: extractIp(request),
      album_id: id,
      space: resolved.space,
      added: result.added,
      already_in: result.alreadyIn,
      skipped: result.skipped,
    });

    return jsonOk(result);
  } catch (error) {
    logEvent(
      "agent_request_failed",
      { route: ROUTE, reason: error instanceof Error ? error.message : String(error) },
      "error",
    );

    return internalError();
  }
}
