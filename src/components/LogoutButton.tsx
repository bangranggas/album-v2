"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Clears the session and returns to the login page. `refresh()` drops the cached
 * dashboard from the router cache, so a later navigation cannot show it without
 * a fresh (and therefore gated) request.
 */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails the cookie is cleared on the next successful
      // call; navigating away is still the right move so the gate decides.
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
