import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { getLinkById, updateLink } from "@/db/links";
import { requireDashboardSession } from "@/lib/api-auth";
import { internalError, jsonOk, notFound } from "@/lib/api-response";
import { extractDomain, extractIp, logEvent } from "@/lib/logger";
import { lookupPageThumbnail } from "@/lib/page-metadata";
import { toApiLink } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/dashboard/links/[id]/thumbnail";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fills in a saved link's thumbnail by fetching the page's `og:image` server-side.
 *
 * This exists because a service worker cannot read another origin's HTML: a link
 * shared from Android has no image, and the worker's own attempt is blocked by
 * CORS. The dashboard can trigger this for a row it already owns, and the worker
 * can call it right after saving.
 *
 * A page with no `og:image` (or a host that cannot be reached) is not an error:
 * the link is returned unchanged with `thumbnail: null`, so the caller can simply
 * say "no cover found". The fetch itself is SSRF-guarded inside `lookupPageThumbnail`.
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const ip = extractIp(request);

  const denied = requireDashboardSession(request, Date.now());
  if (denied) return denied;

  try {
    const db = getDb();
    const link = await getLinkById(db, id);

    if (link === undefined) {
      return notFound("That link no longer exists.");
    }

    const { thumbnail } = await lookupPageThumbnail(link.url);

    if (thumbnail === null) {
      logEvent("dashboard_thumbnail_missing", {
        route: ROUTE,
        ip_address: ip,
        link_id: link.id,
        domain: link.domain,
      });

      return jsonOk({ link: toApiLink(link), found: false });
    }

    const result = await updateLink(db, id, { thumbnail });

    if (!result.ok) {
      // The row vanished between the read and the write; report it like a 404.
      return notFound("That link no longer exists.");
    }

    logEvent("dashboard_thumbnail_set", {
      route: ROUTE,
      ip_address: ip,
      link_id: result.link.id,
      domain: extractDomain(result.link.url),
    });

    return jsonOk({ link: toApiLink(result.link), found: true });
  } catch (error) {
    logEvent(
      "dashboard_thumbnail_failed",
      {
        route: ROUTE,
        ip_address: ip,
        link_id: id,
        reason: error instanceof Error ? error.message : String(error),
      },
      "error",
    );

    return internalError();
  }
}
