import { getDb } from "@/db/client";
import { listLinks, upsertLink } from "@/db/links";
import { verifySecret } from "@/lib/auth";
import { extractDomain, extractIp, logEvent, type LogLevel } from "@/lib/logger";
import {
  parseJsonBody,
  parseLimitParam,
  parseLinkInput,
} from "@/lib/validation";
import { apiError, toApiLink } from "@/types/api";

export const dynamic = "force-dynamic";

const ROUTE = "/api/links";

/**
 * The Tampermonkey script runs in the page context (`@grant none`) and posts
 * cross-origin from arbitrary websites, which triggers a CORS preflight because
 * of the custom `x-secret-key` header.
 *
 * `Access-Control-Allow-Origin: *` is safe here: the endpoint never reads
 * cookies or ambient credentials, and every read/write requires the secret key
 * that only the owner holds. These headers must also be present on error
 * responses, otherwise the browser hides the status code and the script cannot
 * tell "unauthorized" from "network failure".
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-secret-key",
  "access-control-max-age": "86400",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Auth failures are logged at error level so they surface in error dashboards.
 */
function authFailure(request: Request, level: LogLevel = "error"): Response {
  logEvent(
    "api_auth_failed",
    { ip_address: extractIp(request), route: ROUTE },
    level,
  );

  return json(
    apiError("UNAUTHORIZED", "Invalid or missing secret key."),
    401,
  );
}

function internalFailure(error: unknown): Response {
  logEvent(
    "api_error",
    {
      route: ROUTE,
      message: error instanceof Error ? error.message : String(error),
    },
    "error",
  );

  // The real reason is logged, never returned: it can contain connection strings.
  return json(apiError("INTERNAL_ERROR", "Could not complete the request."), 500);
}

export async function POST(request: Request): Promise<Response> {
  if (!verifySecret(request)) {
    return authFailure(request);
  }

  const body = parseJsonBody(await request.text());
  if (!body.ok) {
    logEvent("api_validation_failed", { route: ROUTE, reason: body.message });
    return json(apiError("INVALID_JSON", "Request body is not valid JSON."), 400);
  }

  const input = parseLinkInput(body.data);
  if (!input.ok) {
    logEvent("api_validation_failed", { route: ROUTE, reason: input.message });
    return json(apiError("VALIDATION_ERROR", input.message), 400);
  }

  const startedAt = Date.now();

  try {
    const { link, inserted } = await upsertLink(getDb(), input.data);

    logEvent("api_link_saved", {
      url_domain: extractDomain(link.url),
      latency_ms: Date.now() - startedAt,
      inserted,
    });

    return json({
      ok: true,
      data: { ...toApiLink(link), inserted },
    });
  } catch (error) {
    return internalFailure(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!verifySecret(request)) {
    return authFailure(request);
  }

  const limit = parseLimitParam(new URL(request.url).searchParams.get("limit"));
  if (!limit.ok) {
    logEvent("api_validation_failed", {
      route: ROUTE,
      reason: limit.message,
    });
    return json(apiError("VALIDATION_ERROR", limit.message), 400);
  }

  try {
    const rows = await listLinks(getDb(), { limit: limit.data });

    return json({
      ok: true,
      data: { links: rows.map(toApiLink) },
    });
  } catch (error) {
    return internalFailure(error);
  }
}
