import { NextResponse } from "next/server";

import { listAlbumNamesByLink } from "@/db/albums";
import { getDb } from "@/db/client";
import { listLinks } from "@/db/links";
import {
  parseAgentSearch,
  resolveAlbumForAgent,
  spaceToScope,
  toAgentRow,
} from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
import {
  internalError,
  jsonError,
  jsonOk,
  notFound,
  validationError,
} from "@/lib/api-response";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ROUTE = "/api/agent/links";

/**
 * Compact search over one space. Fetches one row more than asked for so `hasMore`
 * is exact without a second COUNT query.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  const search = parseAgentSearch(new URL(request.url).searchParams);
  if (!search.ok) return validationError(search.message);

  const { data: params } = search;

  if (params.space === "private" && !access.privateOpen) {
    return jsonError("PASSCODE_REQUIRED", "Ask the owner for the passcode to read private links.", 403);
  }

  try {
    const db = getDb();

    if (params.albumId !== undefined) {
      // A private album asked for on the public side (or the reverse) is "not found",
      // not an empty list, so the answer cannot confirm that the id exists.
      const resolved = await resolveAlbumForAgent(db, params.albumId, access);
      if (resolved === undefined || resolved.space !== params.space) {
        return notFound("Album not found.");
      }
    }

    const rows = await listLinks(db, {
      scope: spaceToScope(params.space),
      query: params.q,
      domain: params.domain,
      favorite: params.favorite,
      albums:
        params.albumId === undefined ? undefined : { include: [params.albumId], exclude: [] },
      albumMembership: params.noAlbum ? "none" : undefined,
      limit: params.limit + 1,
      offset: params.offset,
    });

    const page = rows.slice(0, params.limit);
    const names = await listAlbumNamesByLink(
      db,
      page.map((link) => link.id),
    );

    return jsonOk({
      links: page.map((link) => toAgentRow(link, names.get(link.id) ?? [])),
      hasMore: rows.length > params.limit,
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
