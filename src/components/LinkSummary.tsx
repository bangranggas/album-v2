/**
 * The optional one-line note under a link's title. Renders nothing for a link
 * without one, so cards and rows keep their old height.
 */
export function LinkSummary({ summary }: { summary: string | null }) {
  if (summary === null || summary.trim() === "") return null;

  return (
    <p className="line-clamp-3 text-xs text-slate-500 dark:text-slate-400" title={summary}>
      {summary}
    </p>
  );
}
