export type LogLevel = "info" | "error";

/**
 * Emits one JSON line per event to stdout/stderr.
 *
 * These are intentional operational logs (Vercel captures them), not debugging
 * leftovers, so they are deliberately exempt from the "no console output" rule.
 */
export function logEvent(
  event: string,
  properties: Record<string, unknown> = {},
  level: LogLevel = "info",
): void {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...properties,
  };

  const line = serialize(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  console.info(line);
}

/**
 * `JSON.stringify` throws on circular structures and returns `undefined` for
 * non-serializable roots. Logging must never break a request, so fall back to a
 * minimal record.
 */
function serialize(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload) ?? fallbackLine();
  } catch {
    return fallbackLine();
  }
}

function fallbackLine(): string {
  return JSON.stringify({
    level: "error",
    event: "log_serialization_failed",
    timestamp: new Date().toISOString(),
  });
}

/** Hostname of a URL, lowercased, or `"invalid"` when it cannot be parsed. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "invalid";
  }
}

/**
 * Best-effort client IP: first hop of `x-forwarded-for`, then `x-real-ip`.
 * Vercel always sets `x-forwarded-for`.
 */
export function extractIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstHop = forwarded?.split(",")[0]?.trim();
  if (firstHop) return firstHop;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}
