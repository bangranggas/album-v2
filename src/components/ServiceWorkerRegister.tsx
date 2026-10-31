"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that powers the PWA share target.
 *
 * It is mounted by the root layout so the worker is installed on the first visit
 * to any page, including the login page: Android only offers an app as a share
 * destination once it is installed *and* has an active worker, and a user can
 * share a link before ever signing in.
 *
 * Failure is silent — the dashboard works without it, only the share sheet entry
 * is missing — but it is logged so a broken registration can be spotted in the
 * console.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Service worker registration failed.", error);
    });
  }, []);

  return null;
}
