/** Driver-level SQL helpers shared by the repositories. */
const MAX_CAUSE_DEPTH = 5;

/**
 * The message and driver code of an error *and its `cause` chain*, joined.
 *
 * Drizzle wraps a driver failure in its own error (`DrizzleQueryError`), so the
 * text that matters — "UNIQUE constraint failed" and libSQL's
 * `SQLITE_CONSTRAINT_UNIQUE` code — lives one or two levels down in `cause`.
 * Reading only the top-level message would silently miss every conflict.
 */
function describeErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) break;

    parts.push(current.message);

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") parts.push(code);

    current = (current as { cause?: unknown }).cause;
  }

  return parts.join(" | ");
}

/**
 * Escapes the characters `LIKE` would otherwise treat as wildcards, so a search
 * for `100%` means "100%" rather than "100 followed by anything".
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * `true` for a unique-index clash, however deeply the driver buried it. libSQL
 * reports it in the message (and in a code) rather than through a stable,
 * documented error class, so both are checked.
 */
export function isUniqueViolation(error: unknown): boolean {
  const text = describeErrorChain(error);

  return /unique constraint/i.test(text) || /CONSTRAINT_UNIQUE/.test(text);
}
