import { NextResponse } from "next/server";

import { listAlbumNamesByLink } from "@/db/albums";
import { getDb } from "@/db/client";
import { listLinks, saveLinkForAgent } from "@/db/links";
import { isDomainLocked } from "@/db/locked-domains";
import {
  parseAgentSearch,
  resolveAlbumForAgent,
  spaceToScope,
  toAgentDetail,
  toAgentRow,
  type Space,
} from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
import {
  internalError,
  invalidJson,
  jsonError,
  jsonOk,
  notFound,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseAgentLinkInput, parseJsonBody } from "@/lib/validation";

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
      spaceToScope(params.space),
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

/**
 * Adds a link, or updates the one already saved under that URL. Only the fields
 * that were sent are written, so re-adding a URL with a summary cannot erase its
 * title or cover.
 *
 * Which space a URL lands in is decided by its domain, so a URL on a locked domain
 * needs the passcode: without it nothing is written.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  const body = parseJsonBody(await request.text());
  if (!body.ok) return invalidJson();

  const input = parseAgentLinkInput(body.data);
  if (!input.ok) return validationError(input.message);

  try {
    const db = getDb();

    const space: Space = (await isDomainLocked(db, input.data.domain)) ? "private" : "public";
    if (space === "private" && !access.privateOpen) {
      return jsonError(
        "PASSCODE_REQUIRED",
        "That URL belongs to the private space. Ask the owner for the passcode.",
        403,
      );
    }

    const { link, inserted } = await saveLinkForAgent(db, input.data);
    const names = await listAlbumNamesByLink(db, [link.id], spaceToScope(space));

    logEvent("agent_link_saved", {
      route: ROUTE,
      ip_address: extractIp(request),
      link_id: link.id,
      space,
      inserted,
    });

    return jsonOk({ link: toAgentDetail(link, names.get(link.id) ?? [], space), inserted }, inserted ? 201 : 200);
  } catch (error) {
    logEvent(
      "agent_request_failed",
      { route: ROUTE, reason: error instanceof Error ? error.message : String(error) },
      "error",
    );

    return internalError();
  }
}
