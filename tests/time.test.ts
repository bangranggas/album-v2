import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "@/lib/time";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

function ago(elapsedMs: number): string {
  return formatRelativeTime(NOW - elapsedMs, NOW);
}

describe("formatRelativeTime", () => {
  it("treats anything under a minute as 'just now'", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59 * SECOND)).toBe("just now");
  });

  it("formats minutes", () => {
    expect(ago(MINUTE)).toBe("1 minute ago");
    expect(ago(5 * MINUTE)).toBe("5 minutes ago");
    expect(ago(59 * MINUTE)).toBe("59 minutes ago");
  });

  it("formats hours", () => {
    expect(ago(HOUR)).toBe("1 hour ago");
    expect(ago(5 * HOUR)).toBe("5 hours ago");
    expect(ago(23 * HOUR)).toBe("23 hours ago");
  });

  it("formats day-level ages", () => {
    expect(ago(DAY)).toBe("yesterday");
    expect(ago(2 * DAY)).toBe("2 days ago");
    expect(ago(6 * DAY + 23 * HOUR)).toBe("6 days ago");
  });

  it("falls back to an ISO date after a week", () => {
    expect(ago(7 * DAY)).toBe("2026-10-10");
    expect(ago(400 * DAY)).toBe("2025-09-12");
  });

  it("handles a future timestamp without negative output", () => {
    expect(ago(-5 * MINUTE)).toBe("just now");
  });

  it("is deterministic when the current time is injected", () => {
    const timestamp = NOW - 3 * HOUR;

    expect(formatRelativeTime(timestamp, NOW)).toBe(
      formatRelativeTime(timestamp, NOW),
    );
  });
});
