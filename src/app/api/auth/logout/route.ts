import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Drops the session cookie. Nothing else to clean up: sessions are stateless, so
 * an empty cookie is indistinguishable from never having logged in.
 */
export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });

  return response;
}
