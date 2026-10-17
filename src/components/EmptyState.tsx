export function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        No links yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
        Install <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">userscript/link-collector.user.js</code>{" "}
        in Tampermonkey, set the API base URL and secret key in its{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">CONFIG</code>{" "}
        block, then click the floating save button on any page.
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
        You can also add one by hand above, and hide a whole domain with the lock
        button in the filter bar.
      </p>
    </div>
  );
}
