import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateDashboardGate } from "@/lib/dashboard-auth";
import { SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * Next 16 replaced the `middleware` file convention with `proxy`. Runs on the
 * Node.js runtime (not configurable) before the dashboard route is rendered.
 *
 * Only the dashboard pages are gated. `/api/*` is deliberately excluded because
 * the Tampermonkey script authenticates with the `x-secret-key` header instead of
 * a session, and `/api/auth/*` has to stay reachable to create that session.
 *
 * There is no Basic Auth challenge: an anonymous visitor is redirected to the
 * login page, so the browser never shows its own password popup.
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  const gate = evaluateDashboardGate({
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
    configuredPassword: process.env.DASHBOARD_PASSWORD,
    now: Date.now(),
  });

  if (gate.action === "allow") {
    return undefined;
  }

  if (gate.action === "unconfigured") {
    return new NextResponse(
      `Dashboard password is not configured. Set DASHBOARD_PASSWORD in the environment, then reload.`,
      {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  // `next` is validated again on the login page before it is used, so a crafted
  // value here cannot turn into an open redirect.
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Everything except the API (own auth), the auth endpoints (they create and
     * clear the session), the login page (it would otherwise be unreachable), and
     * Next.js internals and metadata files. A `matcher` is required, otherwise the
     * proxy also runs for static assets and could block CSS and images.
     */
    "/((?!api|login|logout|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
