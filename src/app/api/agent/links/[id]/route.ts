import { NextResponse } from "next/server";

import { listAlbumNamesByLink } from "@/db/albums";
import { getDb } from "@/db/client";
import { resolveLinkForAgent, toAgentDetail } from "@/lib/agent-api";
import { authorizeAgent } from "@/lib/agent-auth";
import { internalError, jsonOk, notFound } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";

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
