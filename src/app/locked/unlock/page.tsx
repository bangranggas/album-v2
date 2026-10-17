import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PasscodeNotConfigured } from "@/components/PasscodeNotConfigured";
import { evaluateLockedGate, type LockedGate } from "@/lib/locked-auth";
import { LOCKED_COOKIE_NAME } from "@/lib/locked-session";
import { resolveNextPath } from "@/lib/redirect";

import { UnlockForm } from "./unlock-form";

// Reads the cookie and the passcode on every request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Passcode · Link Collector",
};

const BASE_PATH = "/locked";

/** Destinations that would loop back into the passcode prompt. */
const BLOCKED_PREFIXES = ["/login", `${BASE_PATH}/unlock`];

/** Module-scope helper so the clock and cookie jar are read outside the render. */
async function readGate(): Promise<LockedGate> {
  const cookieStore = await cookies();

  return evaluateLockedGate({
    sessionToken: cookieStore.get(LOCKED_COOKIE_NAME)?.value,
    configuredPasscode: process.env.LOCKED_PASSCODE,
    now: Date.now(),
  });
}

/** Defaults to the locked list, and never to the page that would ask again. */
function resolveTarget(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return resolveNextPath(value === undefined || value === "" ? BASE_PATH : value, {
    blockedPrefixes: BLOCKED_PREFIXES,
  });
}

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const gate = await readGate();

  if (gate.action === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl">
        <PasscodeNotConfigured />
      </main>
    );
  }

  const nextPath = resolveTarget((await searchParams).next);

  // Already unlocked: no reason to show the form again.
  if (gate.action === "allow") {
    redirect(nextPath);
  }

  return (
    <main className="mx-auto max-w-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Locked area
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
        Enter the passcode
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        Hidden links stay out of the light dashboard until the passcode is entered.
        Access lasts one hour, or until you lock it again.
      </p>

      <UnlockForm nextPath={nextPath} />

      <p className="mt-6 text-sm">
        <Link
          href="/"
          className="font-medium text-slate-400 transition hover:text-slate-100"
        >
          ← Back to All links
        </Link>
      </p>
    </main>
  );
}
