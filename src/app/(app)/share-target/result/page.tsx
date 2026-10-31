import type { Metadata } from "next";
import Link from "next/link";

import { describeShareResult } from "@/lib/share-result";

export const metadata: Metadata = {
  title: "Share · Link Collector",
};

/**
 * Where the share-target flow lands after the service worker has tried to save the
 * link. It lives inside the `(app)` group, so it is gated by the session and shows
 * the navbar like any other authenticated page.
 *
 * The outcome arrives as `?status=`; the copy and colours are resolved by a plain
 * function so every branch is unit-tested without rendering.
 */
export default async function ShareResultPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const params = await searchParams;
  const { copy } = describeShareResult(params.status);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
      <div
        role="status"
        className={`rounded-xl border p-6 ${
          copy.success
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy.body}</p>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
