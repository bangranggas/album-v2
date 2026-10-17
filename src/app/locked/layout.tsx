import type { ReactNode } from "react";

export const metadata = {
  title: "Locked links · Link Collector",
};

/**
 * The dark shell for the hidden area.
 *
 * The `dark` class is what activates every `dark:` utility in the shared
 * components, so the locked pages look different from the light dashboard without
 * a second set of components.
 */
export default function LockedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">{children}</div>
    </div>
  );
}
