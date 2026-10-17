"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * The locked area has one shared passcode and no username, exactly like the
 * dashboard password. Nothing is stored: the endpoint answers with a signed,
 * one-hour cookie.
 */
export function UnlockForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/locked/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      if (response.ok) {
        // `refresh()` busts the router cache, so the follow-up request reaches the
        // server with the new cookie instead of a cached "locked" render.
        router.replace(nextPath);
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      setError(payload?.error?.message ?? "Something went wrong. Please try again.");
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
      <label
        htmlFor="locked-passcode"
        className="text-xs font-medium text-slate-400"
      >
        Passcode
      </label>
      <input
        id="locked-passcode"
        type="password"
        value={passcode}
        onChange={(event) => setPasscode(event.target.value)}
        autoComplete="current-password"
        autoFocus
        required
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-100 focus:ring-1 focus:ring-slate-100"
      />

      {error === null ? null : (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-300 disabled:opacity-60"
      >
        {busy ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
