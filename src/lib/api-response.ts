import { NextResponse } from "next/server";

import { apiError, type ApiErrorCode } from "@/types/api";

/**
 * Response builders shared by the dashboard endpoints.
 *
 * These routes are same-origin only (the dashboard's own `fetch` calls), so
 * unlike `/api/links` they add no CORS headers — the browser never sends a
 * preflight, and a third-party page has no session cookie to offer anyway.
 */
export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(apiError(code, message), { status });
}

export function unauthorized(message = "Sign in to the dashboard first."): NextResponse {
  return jsonError("UNAUTHORIZED", message, 401);
}

export function passcodeRequired(): NextResponse {
  return jsonError("UNAUTHORIZED", "Enter the passcode to open the locked area.", 401);
}

export function invalidJson(): NextResponse {
  return jsonError("INVALID_JSON", "Request body is not valid JSON.", 400);
}

export function validationError(message: string): NextResponse {
  return jsonError("VALIDATION_ERROR", message, 400);
}

export function notFound(message = "Not found."): NextResponse {
  return jsonError("NOT_FOUND", message, 404);
}

export function conflict(message: string): NextResponse {
  return jsonError("CONFLICT", message, 409);
}

export function internalError(): NextResponse {
  return jsonError("INTERNAL_ERROR", "Something went wrong. Please try again.", 500);
}
