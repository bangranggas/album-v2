import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Fallback for a browser that reaches `/share-target` directly.
 *
 * The real share flow is a POST that the service worker turns into a save and a
 * redirect (see `public/sw.js`). This GET handler only exists for the case where
 * the worker is missing or not yet active — a tap on the shared app before it has
 * installed, or a user who typed the path. Instead of a bare 405 it explains what
 * happened and points at the dashboard.
 */
export function GET(request: Request): NextResponse {
  const target = new URL("/share-target/result", request.url);
  target.searchParams.set("status", "noop");

  return NextResponse.redirect(target, 303);
}
