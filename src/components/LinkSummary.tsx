/**
 * The optional one-line note under a link's title. Renders nothing for a link
 * without one, so cards and rows keep their old height.
 */
export function LinkSummary({ summary }: { summary: string | null }) {
  if (summary === null || summary.trim() === "") return null;

  return (
    <p
      className="line-clamp-3 border-l-2 border-slate-200 pl-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300"
      title={summary}
    >
      {summary}
    </p>
  );
}
