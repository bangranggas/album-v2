/** A bare host with an optional port: letters, digits, dots, hyphens, `:port`. */
const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * The address this deployment is reached at, e.g. `https://links.example.app`,
 * read from the request so the Docs page can show a base URL that works as-is.
 *
 * Behind Vercel the public host arrives as `x-forwarded-host`; locally only `host`
 * exists, and a plain-http origin is the right answer for `localhost`. Anything
 * that does not look like a host is ignored rather than echoed into the page.
 */
export function originFromHeaders(headers: Pick<Headers, "get">): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(",")[0]!
    .trim();

  if (host === "" || !HOST_PATTERN.test(host)) return null;

  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/i.test(host);
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : local
        ? "http"
        : "https";

  return `${protocol}://${host}`;
}
