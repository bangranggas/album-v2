import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AddLinkForm } from "@/components/AddLinkForm";
import { LinkFilters } from "@/components/LinkFilters";
import { LinkGrid } from "@/components/LinkGrid";
import { LockedDomainsPanel } from "@/components/LockedDomainsPanel";
import { LockedHeader } from "@/components/LockedHeader";
import { PasscodeNotConfigured } from "@/components/PasscodeNotConfigured";
import { SetupProblem } from "@/components/SetupProblem";
import { getDb } from "@/db/client";
import {
  countLinks,
  listAllDomains,
  listDomains,
  listLinks,
  type DomainOption,
} from "@/db/links";
import { listLockedDomains, type LockedDomainOption } from "@/db/locked-domains";
import type { Link } from "@/db/schema";
import {
  formatLinkCount,
  hasActiveFilters,
  resolveLinkFilters,
  type LinkFilters as FilterValues,
} from "@/lib/link-filters";
import { evaluateLockedGate, type LockedGate } from "@/lib/locked-auth";
import { LOCKED_COOKIE_NAME } from "@/lib/locked-session";
import { logEvent } from "@/lib/logger";

// Rendered per request: hidden links must never be cached into a static page.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;
const BASE_PATH = "/locked";

interface LockedData {
  links: Link[];
  /** Domains that hold hidden links, for the dropdown. */
  domains: DomainOption[];
  /** The locked list itself, with counts, for the management panel. */
  lockedDomains: LockedDomainOption[];
  /** Every domain with links, as suggestions when locking a new one. */
  suggestions: string[];
  total: number;
}

/**
 * Module-scope helper (not a component) so reading the clock and the cookie jar
 * happens outside the render body.
 */
async function readGate(): Promise<LockedGate> {
  const cookieStore = await cookies();

  return evaluateLockedGate({
    sessionToken: cookieStore.get(LOCKED_COOKIE_NAME)?.value,
    configuredPasscode: process.env.LOCKED_PASSCODE,
    now: Date.now(),
  });
}

async function loadLocked(
  filters: FilterValues,
): Promise<{ data: LockedData; problem?: undefined } | { data?: undefined; problem: string }> {
  try {
    const db = getDb();

    const [links, domains, lockedDomains, allDomains, total] = await Promise.all([
      listLinks(db, {
        limit: PAGE_LIMIT,
        domain: filters.domain,
        query: filters.query,
        favorite: filters.favorite,
        scope: "locked",
      }),
      listDomains(db, { scope: "locked" }),
      listLockedDomains(db),
      listAllDomains(db),
      countLinks(db, { scope: "locked" }),
    ]);

    return {
      data: {
        links,
        domains,
        lockedDomains,
        suggestions: allDomains.map((option) => option.domain),
        total,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("locked_dashboard_load_failed", { message }, "error");

    return { problem: "The hidden list could not read from the database." };
  }
}

/**
 * The hidden dashboard: the same list, the same filters, and the same card
 * actions as `/`, but scoped to locked domains and behind the passcode.
 */
export default async function LockedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await readGate();

  if (gate.action === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl">
        <PasscodeNotConfigured />
      </main>
    );
  }

  if (gate.action === "prompt") {
    redirect(`${BASE_PATH}/unlock?next=%2Flocked`);
  }

  const filters = resolveLinkFilters(await searchParams);
  const filtering = hasActiveFilters(filters);
  const { data, problem } = await loadLocked(filters);

  return (
    <main>
      <LockedHeader />

      {problem !== undefined ? (
        <SetupProblem message={problem} />
      ) : (
        <>
          <LockedDomainsPanel
            domains={data.lockedDomains}
            suggestions={data.suggestions}
          />

          {data.total > 0 ? (
            <p className="mb-4 text-sm text-slate-500">
              {formatLinkCount(data.links.length, data.total, filtering)}
            </p>
          ) : null}

          <AddLinkForm
            lockedDomains={data.lockedDomains.map((entry) => entry.domain)}
          />

          {data.total === 0 && !filtering ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center">
              <h2 className="text-base font-semibold text-slate-100">
                No hidden links yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Lock a domain above and every link saved to it moves here. You can
                also add a link by hand.
              </p>
            </div>
          ) : (
            <>
              <LinkFilters
                domains={data.domains}
                filters={filters}
                basePath={BASE_PATH}
              />
              <LinkGrid
                links={data.links}
                filters={filters}
                basePath={BASE_PATH}
                locked
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
