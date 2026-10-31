/*
 * Service worker for the link collector.
 *
 * Its one real job is the PWA "share target": Android POSTs the shared link to
 * `/share-target` as multipart/form-data, and a browser cannot render the result
 * of a POST navigation on its own. So the worker intercepts that request, saves
 * the link through the dashboard's own API (which authenticates with the session
 * cookie the browser already holds), and redirects to a normal page that reports
 * the outcome.
 *
 * Android's share sheet only carries `title`, `text`, and `url` — never an image.
 * The thumbnail is therefore looked up afterwards, by fetching the shared page and
 * reading its `og:image`. That fetch is best-effort on purpose: a cross-origin
 * request without CORS permission, a slow host, or a giant page all simply mean
 * "no thumbnail", and the link is saved regardless. The save never waits on it.
 *
 * Everything else is left to the network: there is no offline cache, because a
 * stale dashboard would be worse than an honest failure, and the app is a thin
 * client over a live database.
 *
 * A version bump is what makes an already-installed worker pick up a change to
 * this file.
 */
const VERSION = "link-collector-v2";
const SHARE_PATH = "/share-target";
const SAVE_ENDPOINT = "/api/dashboard/links";
const RESULT_PATH = "/share-target/result";

/** The link edit endpoint, used to attach a thumbnail found after the save. */
const LINK_ENDPOINT = "/api/dashboard/links";

/** How long the page fetch may take before the thumbnail is given up on. */
const THUMBNAIL_TIMEOUT_MS = 5000;

/**
 * Largest HTML body worth reading for a thumbnail. `og:image` lives in `<head>`,
 * so a page over this is not going to be parsed — the cap only stops a runaway
 * download from being held in memory.
 */
const MAX_HTML_BYTES = 1024 * 1024;

self.addEventListener("install", () => {
  // Take over immediately: a share can arrive before the user ever reopens the
  // dashboard, and this worker must be the one that handles it.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Pulls the first http(s) URL out of one share field.
 *
 * Chrome puts a plain URL in `text` when sharing a page's address and a title in
 * `title`; some apps put "Title https://…" in `text`. Whichever field carries the
 * URL, the first match wins, and the title is only trusted when it does not just
 * repeat that URL.
 */
function extractUrl(...fields) {
  for (const field of fields) {
    if (typeof field !== "string") continue;
    const match = field.match(/https?:\/\/[^\s]+/i);
    if (match) return match[0];
  }
  return null;
}

function cleanTitle(title, url) {
  if (typeof title !== "string") return "";
  const trimmed = title.trim();
  if (trimmed === "" || trimmed === url) return "";
  return trimmed;
}

/** Resolves `og:image`'s value (which may be relative) against the page URL. */
function resolveImageUrl(raw, base) {
  if (typeof raw !== "string") return null;

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

/**
 * Reads a `<meta>` tag's `content` for one of the given `property`/`name` keys.
 *
 * A service worker has no `DOMParser`, so this is a small, defensive scan rather
 * than a real HTML parse: it looks for any `<meta …>` whose `property` or `name`
 * matches and returns the first `content`. Attribute order and quoting are both
 * tolerated, because real pages are inconsistent about them.
 */
function readMetaContent(html, keys) {
  const metaTags = html.match(/<meta\b[^>]*>/gi);
  if (!metaTags) return null;

  for (const tag of metaTags) {
    const key =
      readAttribute(tag, "property") ?? readAttribute(tag, "name") ?? "";
    if (!keys.includes(key.toLowerCase())) continue;

    const content = readAttribute(tag, "content");
    if (content !== null && content !== "") return content;
  }

  return null;
}

/** Reads one attribute value out of a tag, single- or double-quoted. */
function readAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = tag.match(pattern);
  if (!match) return null;

  return match[2] ?? match[3] ?? null;
}

/** The thumbnail a page advertises, or `null` when it advertises none. */
function pageThumbnail(html, pageUrl) {
  const keys = [
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ];

  return resolveImageUrl(readMetaContent(html, keys), pageUrl);
}

/**
 * Best-effort lookup of the shared page's `og:image`.
 *
 * Returns `null` — never throws — on every failure mode: a host that forbids
 * cross-origin reads (by far the most common), a timeout, a non-HTML response, or
 * a page with no image. `credentials: "omit"` keeps the user's cookies off a
 * third-party request, and `redirect: "follow"` follows the usual normalisation
 * redirects. The timeout aborts so a hanging host cannot stall the worker.
 */
async function fetchPageThumbnail(pageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);

  try {
    const response = await fetch(pageUrl, {
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("html")) return null;

    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_HTML_BYTES) return null;

    const html = await response.text();
    if (html.length > MAX_HTML_BYTES) return null;

    return pageThumbnail(html, response.url || pageUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attaches a thumbnail to an already-saved link.
 *
 * Failures are swallowed: the link is already saved, and a missing cover is a
 * cosmetic loss the dashboard handles (it shows the domain instead).
 */
async function attachThumbnail(linkId, thumbnail) {
  try {
    await fetch(`${LINK_ENDPOINT}/${encodeURIComponent(linkId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thumbnail }),
    });
  } catch {
    // Ignored on purpose: see the function comment.
  }
}

/** The saved link's id, read defensively from the save response. */
function readSavedLinkId(payload) {
  const link = payload && payload.data && payload.data.link;
  const id = link && link.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Redirects to the result page with a status the page can explain. `303` turns the
 * POST into a GET, which is what lets a page be shown at all.
 */
function redirectToResult(status) {
  return Response.redirect(`${RESULT_PATH}?status=${status}`, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "POST" || url.pathname !== SHARE_PATH) {
    return;
  }

  event.respondWith(
    (async () => {
      let sharedUrl = null;
      let title = "";

      try {
        const formData = await event.request.formData();
        sharedUrl = extractUrl(formData.get("url"), formData.get("text"));
        title = cleanTitle(formData.get("title"), sharedUrl);
      } catch {
        return redirectToResult("invalid");
      }

      if (sharedUrl === null) {
        return redirectToResult("invalid");
      }

      let response;
      try {
        response = await fetch(SAVE_ENDPOINT, {
          method: "POST",
          // The session cookie is same-origin; this keeps it on the request so
          // the dashboard API can authenticate the save.
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: sharedUrl, title }),
        });
      } catch {
        return redirectToResult("offline");
      }

      if (response.status === 401) {
        // Not signed in (or the session lapsed): send them through login, then
        // back to the result page so the outcome is still reported.
        const next = encodeURIComponent(`${RESULT_PATH}?status=unauthorized`);
        return Response.redirect(`/login?next=${next}`, 303);
      }

      if (!response.ok) {
        return redirectToResult("error");
      }

      // The link is saved. Try to give it a cover, but never fail the share over
      // it: the thumbnail lookup runs after the save and only patches the row.
      const payload = await response.json().catch(() => null);
      const linkId = readSavedLinkId(payload);

      if (linkId !== null) {
        const thumbnail = await fetchPageThumbnail(sharedUrl);
        if (thumbnail !== null) {
          await attachThumbnail(linkId, thumbnail);
        }
      }

      return redirectToResult("ok");
    })(),
  );
});
