// ==UserScript==
// @name         Instant Link Collector
// @namespace    album-av.link-collector
// @version      1.0.0
// @description  Save the current page to your Link Collector database with one click.
// @author       Jeremia
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/**
 * Instant Link Collector
 * ----------------------
 * Injects a floating save button into every page and posts the page metadata to
 * the Next.js API. All extraction happens in the browser, so the server never
 * scrapes anything.
 *
 * SETUP
 * 1. Set API_BASE_URL and SECRET_KEY in the CONFIG block below. SECRET_KEY must
 *    match the SECRET_KEY environment variable of the deployed app.
 * 2. Paste this file into a new Tampermonkey script.
 * 3. Keep CONFIG.SECRET_KEY out of version control: this file ships with an
 *    empty value on purpose.
 *
 * The script runs with @grant none (page context), so the request is a normal
 * cross-origin fetch. The API answers the CORS preflight for the x-secret-key
 * header, which is why no GM_xmlhttpRequest permission is needed.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const CONFIG = {
    /** Base URL of the deployed app, without a trailing slash. */
    API_BASE_URL: "http://localhost:3000",

    /** Must equal the server's SECRET_KEY. Fill this in locally. */
    SECRET_KEY: "",

    /** Give up on a request after this long (milliseconds). */
    TIMEOUT_MS: 8000,

    /** How long the success / error toast stays visible. */
    TOAST_SUCCESS_MS: 2000,
    TOAST_ERROR_MS: 3000,

    /**
     * Hosts where the button is not injected. An entry also blocks its
     * subdomains, so "bca.co.id" covers "ibank.bca.co.id".
     */
    BLACKLIST_HOSTS: [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
      ".local",
      ".internal",
      ".test",
      // Banking and payments: never post these URLs anywhere.
      "bca.co.id",
      "klikbca.com",
      "bni.co.id",
      "mandiri.co.id",
      "bri.co.id",
      "btn.co.id",
      "cimbniaga.co.id",
      "permata.me",
      "ocbc.id",
      "maybank.co.id",
      "danamon.co.id",
      "panin.co.id",
      "jenius.com",
      "paypal.com",
      "paypal.me",
      "wise.com",
      "stripe.com",
    ],

    /** Regular expressions matched against the full URL. */
    BLACKLIST_URL_PATTERNS: [/\.pdf(\?|#|$)/i],
  };

  const TOAST_MESSAGES = {
    loading: "Saving...",
    success: "Saved successfully!",
    error: "Error: Failed to save link",
    unauthorized: "Unauthorized. Please update Secret Key.",
    missingKey: "Set SECRET_KEY in the userscript CONFIG block first.",
  };

  const ROOT_ELEMENT_ID = "instant-link-collector-root";

  // ---------------------------------------------------------------------------
  // Blacklist
  // ---------------------------------------------------------------------------

  function isBlacklisted(hostname, url) {
    const host = hostname.toLowerCase();

    const hostBlocked = CONFIG.BLACKLIST_HOSTS.some((entry) => {
      const rule = entry.toLowerCase();
      if (rule.startsWith(".")) {
        // Suffix rule: ".local" blocks "printer.local" and "a.b.local".
        return host === rule.slice(1) || host.endsWith(rule);
      }
      return host === rule || host.endsWith(`.${rule}`);
    });

    if (hostBlocked) return true;

    return CONFIG.BLACKLIST_URL_PATTERNS.some((pattern) => pattern.test(url));
  }

  // ---------------------------------------------------------------------------
  // Extraction (client-side only: the server never fetches the page)
  // ---------------------------------------------------------------------------

  /** The hash is a scroll position, not part of the resource identity. */
  function currentUrl() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function pageTitle() {
    const title = (document.title || "").trim();
    return title || location.hostname;
  }

  function normalizeImageUrl(raw) {
    if (!raw) return null;

    // Whitespace-only content would otherwise resolve to the page URL itself,
    // storing the page as its own thumbnail.
    const value = raw.trim();
    if (value === "") return null;

    try {
      // og:image may be relative or protocol-relative.
      const url = new URL(value, location.origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function pageThumbnail() {
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[property="og:image:url"]',
      // Fallbacks for pages that only ship a Twitter card.
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const resolved = normalizeImageUrl(element && element.getAttribute("content"));
      if (resolved) return resolved;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Injected UI (closed shadow root, so page CSS cannot reach it)
  // ---------------------------------------------------------------------------

  const STYLES = `
    :host { all: initial; }
    .ilc-wrap {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      pointer-events: none;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.4;
    }
    .ilc-wrap *, .ilc-wrap *::before, .ilc-wrap *::after { box-sizing: border-box; }

    .ilc-toast {
      max-width: 260px;
      padding: 8px 12px;
      border-radius: 8px;
      background: #1e293b;
      color: #f8fafc;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.3);
      pointer-events: auto;
      word-break: break-word;
    }
    .ilc-toast[data-kind="success"] { background: #15803d; }
    .ilc-toast[data-kind="error"] { background: #b91c1c; }
    .ilc-toast[hidden] { display: none; }

    .ilc-fab {
      width: 48px;
      height: 48px;
      padding: 0;
      border: 0;
      border-radius: 9999px;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.35);
      transition: transform 120ms ease, background-color 120ms ease;
    }
    .ilc-fab:hover { background: #1e293b; transform: translateY(-1px); }
    .ilc-fab:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
    .ilc-fab:disabled { cursor: progress; opacity: 0.85; transform: none; }

    .ilc-fab[data-state="idle"] .ilc-spinner { display: none; }
    .ilc-fab[data-state="loading"] .ilc-bookmark { display: none; }

    .ilc-spinner {
      animation: ilc-spin 700ms linear infinite;
      transform-origin: 12px 12px;
    }
    @keyframes ilc-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .ilc-spinner { animation-duration: 2000ms; }
      .ilc-fab { transition: none; }
    }
  `;

  const BOOKMARK_ICON = `
    <svg class="ilc-bookmark" width="24" height="24" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" focusable="false">
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z"></path>
    </svg>
  `;

  const SPINNER_ICON = `
    <svg class="ilc-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none"
         aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"></circle>
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
  `;

  const state = { busy: false, toastTimer: null, toast: null, fab: null };

  function hideToast() {
    if (state.toastTimer !== null) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    if (state.toast) state.toast.hidden = true;
  }

  /** Replaces the current toast; messages never stack. `durationMs: 0` keeps it. */
  function showToast(kind, message, durationMs) {
    if (!state.toast) return;

    hideToast();

    state.toast.dataset.kind = kind;
    state.toast.textContent = message;
    state.toast.hidden = false;

    if (durationMs > 0) {
      state.toastTimer = setTimeout(hideToast, durationMs);
    }
  }

  function setBusy(busy) {
    if (!state.fab) return;

    state.fab.disabled = busy;
    state.fab.dataset.state = busy ? "loading" : "idle";
    state.fab.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function buildUi() {
    const host = document.createElement("div");
    host.id = ROOT_ELEMENT_ID;
    // The host is transparent to clicks; only the button and toast opt in.
    host.style.cssText = [
      "position: fixed",
      "right: 20px",
      "bottom: 20px",
      "z-index: 2147483647",
      "pointer-events: none",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = STYLES;

    const wrap = document.createElement("div");
    wrap.className = "ilc-wrap";

    const toast = document.createElement("div");
    toast.className = "ilc-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.hidden = true;

    const fab = document.createElement("button");
    fab.className = "ilc-fab";
    fab.type = "button";
    fab.dataset.state = "idle";
    fab.title = "Save this page to Link Collector";
    fab.setAttribute("aria-label", "Save this page to Link Collector");
    fab.setAttribute("aria-busy", "false");
    fab.innerHTML = `${BOOKMARK_ICON}${SPINNER_ICON}`;

    wrap.append(toast, fab);
    shadow.append(style, wrap);
    document.documentElement.appendChild(host);

    state.toast = toast;
    state.fab = fab;

    fab.addEventListener("click", () => {
      void save();
    });
  }

  // ---------------------------------------------------------------------------
  // Save flow
  // ---------------------------------------------------------------------------

  async function save() {
    // Spam guard: a second click while a request is in flight is ignored.
    if (state.busy) return;

    if (!CONFIG.SECRET_KEY) {
      showToast("error", TOAST_MESSAGES.missingKey, CONFIG.TOAST_ERROR_MS);
      return;
    }

    state.busy = true;
    setBusy(true);
    showToast("loading", TOAST_MESSAGES.loading, 0);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
    const endpoint = `${CONFIG.API_BASE_URL.replace(/\/+$/, "")}/api/links`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-secret-key": CONFIG.SECRET_KEY,
        },
        body: JSON.stringify({
          url: currentUrl(),
          title: pageTitle(),
          thumbnail: pageThumbnail(),
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        showToast("success", TOAST_MESSAGES.success, CONFIG.TOAST_SUCCESS_MS);
        return;
      }

      if (response.status === 401) {
        showToast(
          "error",
          TOAST_MESSAGES.unauthorized,
          CONFIG.TOAST_ERROR_MS,
        );
        return;
      }

      // Details go in the tooltip so the visible message stays exactly as specified.
      reportFailure(`HTTP ${response.status}`);
    } catch (error) {
      reportFailure(error && error.name === "AbortError" ? "Request timed out" : "Network error");
    } finally {
      clearTimeout(timeout);
      state.busy = false;
      setBusy(false);
    }
  }

  function reportFailure(detail) {
    showToast("error", TOAST_MESSAGES.error, CONFIG.TOAST_ERROR_MS);
    if (state.toast) state.toast.title = detail;
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  if (!isBlacklisted(location.hostname, location.href)) {
    // Idempotent: some pages re-run scripts, and we never inject twice.
    if (!document.getElementById(ROOT_ELEMENT_ID)) {
      buildUi();
    }
  }

  // ---------------------------------------------------------------------------
  // Test hook
  // ---------------------------------------------------------------------------

  // Only reachable from a CommonJS/VM harness (see tests/userscript.test.ts).
  // In a browser `module` is undefined, so Tampermonkey never sees this.
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = {
      isBlacklisted,
      currentUrl,
      pageTitle,
      normalizeImageUrl,
      pageThumbnail,
    };
  }
})();
