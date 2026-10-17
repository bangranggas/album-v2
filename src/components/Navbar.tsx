import { LogoutButton } from "@/components/LogoutButton";
import { NavLinks } from "@/components/NavLinks";
import { NAV_ITEMS } from "@/lib/nav";

/**
 * Top navigation for every authenticated page. Future modules only need a new
 * entry in `NAV_ITEMS`.
 */
export function Navbar() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        <p className="text-sm font-bold tracking-tight text-slate-900">
          Link Collector
        </p>

        <div className="flex items-center gap-1">
          <NavLinks items={NAV_ITEMS} />
          <span aria-hidden="true" className="text-slate-300">
            |
          </span>
          <LogoutButton />
        </div>
      </nav>
    </header>
  );
}
