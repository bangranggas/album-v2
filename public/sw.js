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
 * After saving, the worker asks the server to fill in the cover
 * (`POST /api/dashboard/links/:id/thumbnail`), which fetches the page's `og:image`.
 * That lookup is best-effort and never fails the share: the link is saved first,
 * and a missing cover is a cosmetic loss.
 *
 * Everything else is left to the network: there is no offline cache, because a
 * stale dashboard would be worse than an honest failure, and the app is a thin
 * client over a live database.
 *
 * A version bump is what makes an already-installed worker pick up a change to
 * this file.
 */
const VERSION = "link-collector-v3";
const SHARE_PATH = "/share-target";
const SAVE_ENDPOINT = "/api/dashboard/links";
const RESULT_PATH = "/share-target/result";

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

/** The saved link's id, read defensively from the save response. */
function readSavedLinkId(payload) {
  const link = payload && payload.data && payload.data.link;
  const id = link && link.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Asks the server to fill in the link's thumbnail.
 *
 * The server fetches the page (it is not bound by the browser's CORS rules), so
 * this succeeds for far more sites than a worker-side fetch would. Failures are
 * swallowed: the link is already saved.
 */
async function fillThumbnail(linkId) {
  try {
    await fetch(
      `${SAVE_ENDPOINT}/${encodeURIComponent(linkId)}/thumbnail`,
      {
        method: "POST",
        credentials: "same-origin",
      },
    );
  } catch {
    // Ignored on purpose: a missing cover must not fail the share.
  }
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

      // The link is saved. Ask the server for a cover, but never fail the share
      // over it: a missing thumbnail is cosmetic.
      const payload = await response.json().catch(() => null);
      const linkId = readSavedLinkId(payload);

      if (linkId !== null) {
        await fillThumbnail(linkId);
      }

      return redirectToResult("ok");
    })(),
  );
});
