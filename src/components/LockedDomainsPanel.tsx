"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { callApi } from "@/lib/dashboard-api";

export interface LockedDomainsPanelProps {
  domains: readonly { domain: string; count: number }[];
  /** Every domain that has links, so the owner can pick one instead of typing it. */
  suggestions: readonly string[];
}

/**
 * Where the hidden list is managed. Adding or removing a domain changes what the
 * light dashboard shows, which is why the API requires the passcode as well as
 * the session.
 */
export function LockedDomainsPanel({ domains, suggestions }: LockedDomainsPanelProps) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = new Set(domains.map((entry) => entry.domain));
  const unusedSuggestions = suggestions.filter((option) => !locked.has(option));

  function handleFailure(status: number, message: string): void {
    if (status === 401) {
      router.push("/locked/unlock");
      return;
    }

    setError(message);
  }

  async function lock(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy !== null) return;

    setBusy("add");
    setError(null);
    setNotice(null);

    const result = await callApi("/api/locked/domains", "POST", { domain });

    setBusy(null);

    if (!result.ok) {
      handleFailure(result.status, result.message);
      return;
    }

    setDomain("");
    setNotice("Domain locked. Its links are hidden from All links.");
    router.refresh();
  }

  async function unlock(target: string): Promise<void> {
    if (busy !== null) return;

    setBusy(target);
    setError(null);
    setNotice(null);

    const result = await callApi(
      `/api/locked/domains/${encodeURIComponent(target)}`,
      "DELETE",
    );

    setBusy(null);

    if (!result.ok && result.status !== 404) {
      handleFailure(result.status, result.message);
      return;
    }

    setNotice(`${target} unlocked. Its links are back on All links.`);
    router.refresh();
  }

  return (
    <section
      aria-labelledby="locked-domains-heading"
      className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4"
    >
      <h2
        id="locked-domains-heading"
        className="text-sm font-semibold text-slate-100"
      >
        Locked domains
      </h2>
      <p className="mt-1 text-xs text-slate-400">
        Links on these domains are hidden from All links, search, and filters. A
        domain locked here stays hidden for every link saved to it later.
      </p>

      {domains.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-400">
          No locked domains yet. Lock one below and its links move here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {domains.map((entry) => (
            <li
              key={entry.domain}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
            >
              <span className="font-medium">{entry.domain}</span>
              <span className="text-slate-500">
                {entry.count === 1 ? "1 link" : `${entry.count} links`}
              </span>
              <button
                type="button"
                onClick={() => unlock(entry.domain)}
                disabled={busy !== null}
                aria-label={`Unlock ${entry.domain}`}
                className="rounded-md px-1.5 py-0.5 font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
              >
                {busy === entry.domain ? "…" : "Unlock"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={lock} className="mt-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="locked-domain-input">
          Domain to lock
        </label>
        <input
          id="locked-domain-input"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          list="locked-domain-suggestions"
          placeholder="example.com"
          required
          className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-100 focus:ring-1 focus:ring-slate-100"
        />
        <datalist id="locked-domain-suggestions">
          {unusedSuggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-300 disabled:opacity-60"
        >
          {busy === "add" ? "Locking…" : "Lock domain"}
        </button>
      </form>

      {error === null ? null : (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p className="mt-2 text-xs text-slate-400">{notice}</p>
      )}
    </section>
  );
}
