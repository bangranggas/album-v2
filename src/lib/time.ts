const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Relative "saved N ago" label for the dashboard cards.
 *
 * `now` is injectable so the output is deterministic in tests.
 */
export function formatRelativeTime(
  timestampMs: number,
  now: number = Date.now(),
): string {
  const elapsed = now - timestampMs;

  if (elapsed < MINUTE) return "just now";

  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }

  if (elapsed < WEEK) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  return new Date(timestampMs).toISOString().slice(0, 10);
}
