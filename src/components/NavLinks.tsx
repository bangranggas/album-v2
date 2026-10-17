"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/lib/nav";

/**
 * Client-side only so it can read the current path and highlight the active item.
 * The item list itself is plain data, passed in by the server-rendered navbar.
 */
export function NavLinks({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="flex items-center gap-1">
      {items.map((item) => {
        const active = pathname === item.href;

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              }
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
