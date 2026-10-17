import type { ReactNode } from "react";

import { Navbar } from "@/components/Navbar";

/**
 * Layout for authenticated pages. The login page lives outside this route group,
 * so it never shows the navbar (and the group adds no URL segment, keeping the
 * dashboard at `/`).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
