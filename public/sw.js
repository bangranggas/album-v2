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
 * Everything else is left to the network: there is no offline cache, because a
 * stale dashboard would be worse than an honest failure, and the app is a thin
 * client over a live database.
 *
 * A version bump is what makes an already-installed worker pick up a change to
 * this file.
 */
const VERSION = "link-collector-v1";
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
      let url = null;
      let title = "";

      try {
        const formData = await event.request.formData();
        url = extractUrl(formData.get("url"), formData.get("text"));
        title = cleanTitle(formData.get("title"), url);
      } catch {
        return redirectToResult("invalid");
      }

      if (url === null) {
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
          body: JSON.stringify({ url, title }),
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

      return redirectToResult("ok");
    })(),
  );
});
