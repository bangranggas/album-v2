import type { Metadata } from "next";
import { headers } from "next/headers";

import { HermesGuide } from "@/components/HermesGuide";
import { originFromHeaders } from "@/lib/request-origin";

export const metadata: Metadata = {
  title: "Docs · Link Collector",
};

// The address shown in the setup commands comes from the request, so it must not be cached.
export const dynamic = "force-dynamic";

/**
 * Documentation for connecting Hermes Agent. It lives in the `(app)` group, so the
 * proxy gates it behind the dashboard session like every other page. The guide itself
 * is a pure component; this page only supplies this deployment's address.
 */
export default async function DocsPage() {
  const origin = originFromHeaders(await headers()) ?? "https://<your-app>.vercel.app";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Use it from Hermes Agent
      </h1>
      <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">
        Let your AI agent search, add, summarise, organise and delete links for you.
      </p>

      <HermesGuide baseUrl={origin} />
    </main>
  );
}
