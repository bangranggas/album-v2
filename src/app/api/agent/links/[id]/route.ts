import { NextResponse } from "next/server";

import { listAlbumNamesByLink } from "@/db/albums";
import { getDb } from "@/db/client";
import { updateLink } from "@/db/links";
import { isDomainLocked } from "@/db/locked-domains";
import { resolveLinkForAgent, toAgentDetail } from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
import {
  conflict,
  internalError,
  invalidJson,
  jsonOk,
  notFound,
  validationError,
} from "@/lib/api-response";
import { extractIp, logEvent } from "@/lib/logger";
import { parseJsonBody, parseLinkPatch } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/agent/links/[id]";

type RouteContext = { params: Promise<{ id: string }> };

/** One link in full. A private link without the passcode is simply "not found". */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  try {
    const db = getDb();
    const resolved = await resolveLinkForAgent(db, id, access);
    if (resolved === undefined) return notFound("Link not found.");

    const names = await listAlbumNamesByLink(db, [resolved.link.id]);

    return jsonOk(toAgentDetail(resolved.link, names.get(resolved.link.id) ?? [], resolved.space));
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
 * Edits any of title, url, thumbnail, summary and the favorite flag.
 *
 * The order matters for privacy: the link is resolved first (a private link without
 * the passcode is a 404), and the boundary check runs *before* the repository's
 * duplicate-URL check, so a conflict can never reveal that a private link owns a URL.
 * A URL change that would move the link across the public/private line is refused.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  const body = parseJsonBody(await request.text());
  if (!body.ok) return invalidJson();

  try {
    const db = getDb();
    const resolved = await resolveLinkForAgent(db, id, access);
    if (resolved === undefined) return notFound("Link not found.");

    const patch = parseLinkPatch(body.data);
    if (!patch.ok) return validationError(patch.message);

    if (patch.data.domain !== undefined) {
      const landsInPrivate = await isDomainLocked(db, patch.data.domain);

      if (landsInPrivate !== (resolved.space === "private")) {
        return conflict("That URL would move the link across the public/private boundary.");
      }
    }

    const result = await updateLink(db, id, patch.data);

    if (!result.ok && result.reason === "url-taken") {
      return conflict("That URL is already saved on another link.");
    }

    if (!result.ok) return notFound("Link not found.");

    logEvent("agent_link_updated", {
      route: ROUTE,
      ip_address: extractIp(request),
      link_id: id,
      space: resolved.space,
      fields: Object.keys(patch.data),
    });

    const names = await listAlbumNamesByLink(db, [id]);

    return jsonOk({ link: toAgentDetail(result.link, names.get(id) ?? [], resolved.space) });
  } catch (error) {
    logEvent(
      "agent_request_failed",
      { route: ROUTE, reason: error instanceof Error ? error.message : String(error) },
      "error",
    );

    return internalError();
  }
}
