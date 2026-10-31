/**
 * Server-side lookup of a page's `og:image`.
 *
 * This is the one place the project fetches a third-party page, and it exists for
 * a single reason: a service worker cannot read another origin's HTML (CORS), so a
 * link shared from Android's share sheet would otherwise never get a cover. The
 * fetch is deliberately narrow — HTML only, small, time-boxed, one hop — and it is
 * guarded against SSRF, because the URL comes from a user.
 *
 * Nothing here throws: every failure mode (a blocked host, a timeout, a non-HTML
 * response, a page with no image) is reported as `null`, which the caller treats
 * as "no thumbnail".
 */

/** How long the page fetch may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 5000;

/** Largest HTML body worth reading; `og:image` lives in `<head>`. */
const MAX_HTML_BYTES = 1024 * 1024;

/** The redirect chain is followed by hand so each hop can be re-validated. */
const MAX_REDIRECTS = 3;

/**
 * Hostnames that must never be fetched: loopback, cloud metadata, and the common
 * "this network" names. `localhost` covers the app's own internal endpoints.
 */
const BLOCKED_EXACT_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

/** Suffixes that are always internal and never a public page. */
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/**
 * Whether an IPv4 literal points inside a private, loopback, link-local, or
 * otherwise non-public range. Cloud metadata (169.254.169.254) is link-local.
 */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  const [a = 0, b = 0] = octets;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast / reserved / broadcast

  return false;
}

/** Whether an IPv6 literal is loopback, unique-local, or link-local. */
function isBlockedIpv6(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();

  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fe80:")) return true; // link-local
  if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique-local

  // IPv4-mapped, in either dotted (::ffff:127.0.0.1) or the hex form a URL
  // parser normalises it to (::ffff:7f00:1).
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (mapped.includes(".")) return isBlockedIpv4(mapped);

    const hex = mapped.split(":");
    if (hex.length === 2) {
      const high = Number.parseInt(hex[0] ?? "", 16);
      const low = Number.parseInt(hex[1] ?? "", 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        const dotted = [
          (high >> 8) & 0xff,
          high & 0xff,
          (low >> 8) & 0xff,
          low & 0xff,
        ].join(".");
        return isBlockedIpv4(dotted);
      }
    }

    // An unrecognised mapped form is treated as unsafe.
    return true;
  }

  return false;
}

/**
 * Whether a parsed URL is safe to fetch: an http(s) URL whose host is not a
 * private, loopback, link-local, or cloud-metadata address.
 *
 * Public hostnames are allowed through: resolving a name to a private IP would
 * need a DNS lookup, which is out of scope here. IP literals — the actual SSRF
 * vector — are checked directly.
 */
export function isFetchableUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  if (host === "") return false;
  if (BLOCKED_EXACT_HOSTS.has(host)) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  // A bare IP literal: brackets are stripped for IPv6.
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.includes(":")) return !isBlockedIpv6(bare);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return !isBlockedIpv4(bare);

  return true;
}

/** Reads one attribute value out of a tag, single- or double-quoted. */
export function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = tag.match(pattern);
  if (!match) return null;

  return match[2] ?? match[3] ?? null;
}

/**
 * Reads the `content` of the first `<meta>` whose `property`/`name` is one of
 * `keys`.
 *
 * This is a scan, not an HTML parse: pulling in a full parser for one tag would be
 * a dependency the project does not otherwise need. Attribute order and quoting
 * are both tolerated, and nothing is executed.
 */
export function readMetaContent(html: string, keys: readonly string[]): string | null {
  const wanted = keys.map((key) => key.toLowerCase());
  const metaTags = html.match(/<meta\b[^>]*>/gi);
  if (!metaTags) return null;

  for (const tag of metaTags) {
    const key = (readAttribute(tag, "property") ?? readAttribute(tag, "name") ?? "")
      .toLowerCase();
    if (!wanted.includes(key)) continue;

    const content = readAttribute(tag, "content");
    if (content !== null && content.trim() !== "") return content;
  }

  return null;
}

/** Resolves an `og:image` value (which may be relative) against the page URL. */
export function resolveImageUrl(raw: string | null, base: string): string | null {
  if (raw === null) return null;

  const value = raw.trim();
  if (value === "") return null;

  try {
    const resolved = new URL(value, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

/** The thumbnail a page advertises, or `null` when it advertises none. */
export function pageThumbnail(html: string, pageUrl: string): string | null {
  const keys = [
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
  ];

  return resolveImageUrl(readMetaContent(html, keys), pageUrl);
}

/**
 * Follows redirects by hand, re-validating every hop, so a public URL cannot
 * bounce the server onto `localhost` or a cloud metadata endpoint.
 */
async function fetchFollowingSafeRedirects(
  startUrl: URL,
  signal: AbortSignal,
): Promise<Response | null> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isFetchableUrl(current)) return null;

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal,
      credentials: "omit",
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) return null;

      try {
        current = new URL(location, current);
      } catch {
        return null;
      }

      continue;
    }

    return response;
  }

  // Too many hops.
  return null;
}

export interface ThumbnailLookupResult {
  thumbnail: string | null;
}

/**
 * Fetches `pageUrl` and returns its `og:image`, or `null`.
 *
 * Never throws: this is called from a request that must always succeed, and the
 * thumbnail is a cosmetic detail. `credentials: "omit"` keeps any server cookie
 * off the third-party request.
 */
export async function lookupPageThumbnail(
  pageUrl: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<ThumbnailLookupResult> {
  let start: URL;
  try {
    start = new URL(pageUrl);
  } catch {
    return { thumbnail: null };
  }

  if (!isFetchableUrl(start)) return { thumbnail: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetchImpl = deps.fetchImpl;
    const response = fetchImpl
      ? await withFetchImpl(fetchImpl, start, controller.signal)
      : await fetchFollowingSafeRedirects(start, controller.signal);

    if (response === null || !response.ok) return { thumbnail: null };

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("html")) return { thumbnail: null };

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
      return { thumbnail: null };
    }

    const html = await response.text();
    if (html.length > MAX_HTML_BYTES) return { thumbnail: null };

    return { thumbnail: pageThumbnail(html, response.url || pageUrl) };
  } catch {
    return { thumbnail: null };
  } finally {
    clearTimeout(timer);
  }
}

/** One-shot fetch used only when a test injects its own `fetch`. */
async function withFetchImpl(
  fetchImpl: typeof fetch,
  url: URL,
  signal: AbortSignal,
): Promise<Response> {
  return fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    signal,
    credentials: "omit",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
}
