import { MAX_SUMMARY_WORDS, countWords } from "@/lib/validation";

/** "3/20 words" under the summary box; turns red once the limit is passed. */
export function SummaryWordCount({ value }: { value: string }) {
  const words = countWords(value);
  const over = words > MAX_SUMMARY_WORDS;

  return (
    <span
      className={`text-[11px] font-normal ${
        over ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"
      }`}
    >
      {words}/{MAX_SUMMARY_WORDS} words
    </span>
  );
}
