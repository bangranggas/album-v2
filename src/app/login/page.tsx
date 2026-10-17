import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";
import { isDashboardPasswordConfigured } from "@/lib/dashboard-auth";
import { resolveNextPath } from "@/lib/redirect";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";

// Reads the session cookie and the environment on every request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in · Link Collector",
};

/**
 * Module-scope helper (not a component) so reading the clock and the cookie jar
 * happens outside the render body.
 */
async function hasActiveSession(): Promise<boolean> {
  const cookieStore = await cookies();

  const session = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value, {
    now: Date.now(),
    secret: process.env.DASHBOARD_PASSWORD,
  });

  return session.valid;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = resolveNextPath(params.next);

  // Already signed in: never show the form twice.
  if (await hasActiveSession()) {
    redirect(nextPath);
  }

  const configured = isDashboardPasswordConfigured(
    process.env.DASHBOARD_PASSWORD,
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Link Collector
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter the dashboard password to continue.
        </p>
      </header>

      {configured ? (
        <LoginForm nextPath={nextPath} />
      ) : (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
        >
          <h2 className="text-base font-semibold text-red-900">
            The dashboard password is not configured
          </h2>
          <p className="mt-2">
            Set{" "}
            <code className="rounded bg-white/60 px-1 py-0.5 text-xs">
              DASHBOARD_PASSWORD
            </code>{" "}
            in{" "}
            <code className="rounded bg-white/60 px-1 py-0.5 text-xs">
              .env.local
            </code>
            , then restart the server with{" "}
            <code className="rounded bg-white/60 px-1 py-0.5 text-xs">
              npm run dev
            </code>
            .
          </p>
        </div>
      )}
    </main>
  );
}
