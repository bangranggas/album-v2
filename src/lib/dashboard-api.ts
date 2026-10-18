import type { BulkAddCounts } from "@/lib/link-selection";

/**
 * The dashboard's client-side view of its own JSON endpoints.
 *
 * Every mutation follows the same shape: call the endpoint, then let the caller
 * `router.refresh()` so the server components re-render from the database. There
 * is no client-side cache to keep in sync; the payload is handed back only for the
 * flows that genuinely need it ("create an album, then add this link to it", and
 * the bulk add's counts), and every other caller can keep ignoring it.
 */
export type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; message: string };

const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

export async function callApi(
  path: string,
  method: string,
  body?: unknown,
): Promise<ApiResult> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.ok) {
      // A 204 (or any body-less success) is fine: the payload is optional.
      const payload = (await response.json().catch(() => null)) as {
        data?: unknown;
      } | null;

      return { ok: true, data: payload?.data };
    }

    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;

    return {
      ok: false,
      status: response.status,
      message: payload?.error?.message ?? FALLBACK_MESSAGE,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      message: "The request could not be sent. Check your connection and try again.",
    };
  }
}

/**
 * The new album's id, read defensively out of a create response.
 *
 * Both "create an album, then file something into it" flows run in the browser, so
 * the payload is `unknown` until it has been checked. `null` means "the album may
 * exist, but its id cannot be trusted", which the callers report as a partial
 * success rather than retrying blindly.
 */
export function readCreatedAlbumId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;

  const album = (data as { album?: unknown }).album;
  if (typeof album !== "object" || album === null) return null;

  const id = (album as { id?: unknown }).id;

  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * The three counts a bulk add reports, read defensively for the same reason.
 *
 * `null` means "the request succeeded, but the numbers cannot be trusted", which
 * the bar answers with a plain confirmation instead of inventing a count.
 */
export function readBulkAddCounts(data: unknown): BulkAddCounts | null {
  if (typeof data !== "object" || data === null) return null;

  const { added, alreadyIn, skipped } = data as Record<string, unknown>;

  if (
    typeof added !== "number" ||
    typeof alreadyIn !== "number" ||
    typeof skipped !== "number" ||
    added < 0 ||
    alreadyIn < 0 ||
    skipped < 0
  ) {
    return null;
  }

  return { added, alreadyIn, skipped };
}
