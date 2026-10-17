"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { callApi } from "@/lib/dashboard-api";

/** The heading of the locked area, with the two ways out of it. */
export function LockedHeader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lockNow(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await callApi("/api/locked/lock", "POST");

    setBusy(false);

    // A 401 means the hour was already up, which is the state we want anyway.
    if (!result.ok && result.status !== 401) {
      setError(result.message);
      return;
    }

    router.push("/locked/unlock");
    router.refresh();
  }

  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Locked area
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
          Hidden links
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          These domains are hidden from All links, search, and filters. Access ends
          after one hour, or when you lock it again.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          All links
        </Link>
        <button
          type="button"
          onClick={lockNow}
          disabled={busy}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Locking…" : "Lock now"}
        </button>
      </div>

      {error === null ? null : (
        <p role="alert" className="w-full text-xs text-red-400">
          {error}
        </p>
      )}
    </header>
  );
}
