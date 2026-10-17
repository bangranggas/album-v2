/**
 * Open liveness probe. Used by the Tampermonkey script's setup check.
 *
 * Intentionally returns nothing but a boolean: no data, no configuration, no
 * version details.
 */
export function GET(): Response {
  return Response.json({ ok: true });
}
