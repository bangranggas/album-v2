export function SetupProblem({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <h2 className="text-base font-semibold text-red-900 dark:text-red-100">
        The link database is not reachable
      </h2>
      <p className="mt-2">{message}</p>
      <p className="mt-2 text-red-700 dark:text-red-300">
        Check <code className="text-xs">TURSO_DATABASE_URL</code> and{" "}
        <code className="text-xs">TURSO_AUTH_TOKEN</code>, then run{" "}
        <code className="text-xs">npm run db:push</code>.
      </p>
    </div>
  );
}
