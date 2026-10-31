import type { MetadataRoute } from "next";

/**
 * The PWA manifest, served at `/manifest.webmanifest`.
 *
 * `share_target` is what makes the app appear in Android's share sheet: a link
 * shared from any browser is POSTed as `multipart/form-data` to `/share-target`,
 * which only the service worker can answer (the browser will not render the POST
 * response itself). Everything else here exists to make the app installable —
 * without an install, Android never offers it as a share destination.
 *
 * `display: "standalone"` keeps the share flow out of a browser chrome, so a save
 * feels like an app action rather than a page load.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Link Collector",
    short_name: "Link Collector",
    description:
      "Collect links shared from the browser into one dashboard.",
    /*
     * Must be a URL that answers 200 *without* a session, because Chrome fetches
     * `start_url` anonymously to test installability and refuses to offer an
     * install when it is a redirect. The dashboard (`/`) is gated and 307s to
     * `/login` for a visitor, so the login page is the honest entry point: it
     * renders the sign-in form, and once a session exists the page itself
     * forwards to the dashboard.
     */
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
  };
}
