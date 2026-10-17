import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MIN_PASSWORD_LENGTH, evaluateDashboardGate } from "@/lib/basic-auth";

const REALM = "Link Collector";

/**
 * Next 16 replaced the `middleware` file convention with `proxy`. Runs on the
 * Node.js runtime (not configurable) before the dashboard route is rendered.
 *
 * Only the dashboard is gated. `/api/*` is deliberately excluded because the
 * Tampermonkey script authenticates with the `x-secret-key` header instead of
 * HTTP Basic; gating it would break link saving.
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  const gate = evaluateDashboardGate(
    request.headers.get("authorization"),
    process.env.DASHBOARD_PASSWORD,
  );

  if (gate.action === "allow") {
    return undefined;
  }

  if (gate.action === "unconfigured") {
    return new NextResponse(
      `Dashboard password is not configured. Set DASHBOARD_PASSWORD to at least ${MIN_PASSWORD_LENGTH} characters in the environment, then reload.`,
      {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: [
    /*
     * Everything except the API (own auth), Next.js internals, and metadata
     * files. A `matcher` is required, otherwise the proxy also runs for static
     * assets and could block CSS and images.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
