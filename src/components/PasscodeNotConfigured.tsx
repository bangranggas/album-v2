/**
 * Shown instead of the passcode form when `LOCKED_PASSCODE` is missing or blank.
 * The light dashboard keeps working; only the hidden area is closed.
 */
export function PasscodeNotConfigured() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <h2 className="text-base font-semibold">The locked area is not set up</h2>
      <p className="mt-2">
        Set{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">
          LOCKED_PASSCODE
        </code>{" "}
        in <code>.env.local</code>, then restart the server.
      </p>
      <p className="mt-2">
        Generate a strong one with{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">
          node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(24).toString(&apos;base64url&apos;))&quot;
        </code>
        .
      </p>
    </div>
  );
}
