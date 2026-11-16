import { NextResponse } from "next/server";

import { listAlbumNamesByLink } from "@/db/albums";
import { getDb } from "@/db/client";
import { deleteLink, updateLink } from "@/db/links";
import { isDomainLocked } from "@/db/locked-domains";
import { resolveLinkForAgent, spaceToScope, toAgentDetail } from "@/lib/agent-api";
import {
  authorizeAgent,
  CONFIRM_HEADER,
  signDeleteConfirm,
  verifyDeleteConfirm,
} from "@/lib/agent-auth";
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

    const names = await listAlbumNamesByLink(db, [resolved.link.id], spaceToScope(resolved.space));

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

    const names = await listAlbumNamesByLink(db, [id], spaceToScope(resolved.space));

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

/**
 * Deletes a link, but only on the second call.
 *
 * The first call (no valid `x-confirm`) deletes nothing: it answers `409
 * CONFIRMATION_REQUIRED` with the title, the URL and a short-lived token bound to
 * this exact link as last updated. The agent must show that to the owner and, after
 * an explicit yes, send the token back. The rule lives here rather than in the
 * agent's instructions, so a forgetful agent cannot skip it.
 *
 * Private links are resolved with the same passcode rule as everything else, so
 * *both* steps need the passcode, and a token minted earlier is useless without it.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const access = await authorizeAgent(request);
  if (!access.ok) return access.response;

  try {
    const db = getDb();
    const resolved = await resolveLinkForAgent(db, id, access);
    if (resolved === undefined) return notFound("Link not found.");

    const { link } = resolved;
    const now = Date.now();

    if (!verifyDeleteConfirm(request.headers.get(CONFIRM_HEADER), link, now)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "CONFIRMATION_REQUIRED",
            message:
              "Nothing was deleted. Show the title and URL to the owner and, only after an explicit yes, repeat the request with the confirm token.",
          },
          data: {
            title: link.title,
            url: link.url,
            space: resolved.space,
            confirm: signDeleteConfirm(link, now),
          },
        },
        { status: 409 },
      );
    }

    const deleted = await deleteLink(db, id);
    if (!deleted) return notFound("Link not found.");

    logEvent("agent_link_deleted", {
      route: ROUTE,
      ip_address: extractIp(request),
      link_id: id,
      space: resolved.space,
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    logEvent(
      "agent_request_failed",
      { route: ROUTE, reason: error instanceof Error ? error.message : String(error) },
      "error",
    );

    return internalError();
  }
}
