import Link from "next/link";

import { buildTabHref, type DashboardTab } from "@/lib/link-filters";

const TAB_BASE =
  "inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:focus-visible:outline-slate-100";

const ACTIVE = "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100";
const INACTIVE =
  "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100";

const TABS: readonly { id: DashboardTab; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "albums", label: "Albums" },
];

export interface DashboardTabsProps {
  active: DashboardTab;
  /** `/` on the light dashboard, `/locked` in the hidden area. */
  basePath?: string;
}

/**
 * The `Links` / `Albums` switch.
 *
 * Plain links, not client state: the active tab lives in the URL, so a refresh,
 * a bookmark, and the back button all reopen the view the visitor was looking at.
 * It is rendered on both pages even when the list is empty, because with two views
 * "there is nothing here" must not hide the way to the other one.
 *
 * Switching drops the other tab's filters on purpose (see `buildTabHref`).
 */
export function DashboardTabs({ active, basePath = "/" }: DashboardTabsProps) {
  return (
    <nav
      aria-label="Views"
      className="mb-6 inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={buildTabHref(tab.id, basePath)}
          aria-current={tab.id === active ? "page" : undefined}
          className={`${TAB_BASE} ${tab.id === active ? ACTIVE : INACTIVE}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
