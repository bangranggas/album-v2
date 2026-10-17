/**
 * The dashboard's client-side view of its own JSON endpoints.
 *
 * Every mutation follows the same shape: call the endpoint, then let the caller
 * `router.refresh()` so the server components re-render from the database. There
 * is no client-side cache to keep in sync, which is why this helper returns only
 * success and an error message rather than the payload.
 */
export type ApiResult = { ok: true } | { ok: false; status: number; message: string };

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

    if (response.ok) return { ok: true };

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
