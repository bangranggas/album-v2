import { EmptyState } from "@/components/EmptyState";
import { LinkCard } from "@/components/LinkCard";
import { SetupProblem } from "@/components/SetupProblem";
import { getDb } from "@/db/client";
import { listLinks } from "@/db/links";
import type { Link } from "@/db/schema";
import { logEvent } from "@/lib/logger";

// Rendered per request: the list must never be served stale from the build cache.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;

async function loadLinks(): Promise<
  { links: Link[]; problem?: undefined } | { links: Link[]; problem: string }
> {
  try {
    return { links: await listLinks(getDb(), { limit: PAGE_LIMIT }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("dashboard_load_failed", { message }, "error");

    // Shown to the operator (already behind the dashboard password); a raw stack
    // trace would be worse than a short, actionable message.
    return {
      links: [],
      problem: "The dashboard could not read from the database.",
    };
  }
}

export default async function HomePage() {
  const { links, problem } = await loadLinks();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Links
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Saved from the browser with the Tampermonkey save button.
          </p>
        </div>
        {problem === undefined && links.length > 0 ? (
          <p className="text-sm text-slate-500">
            {links.length === 1 ? "1 link" : `${links.length} links`}
          </p>
        ) : null}
      </header>

      {problem !== undefined ? (
        <SetupProblem message={problem} />
      ) : links.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {links.map((link) => (
            <li key={link.id}>
              <LinkCard link={link} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
