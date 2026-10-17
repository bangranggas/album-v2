/** Where the login page sends a visitor when no usable destination was given. */
export const DEFAULT_NEXT_PATH = "/";

/** Control characters, which have no business in a path. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Redirect targets that would loop, per flow. */
const DEFAULT_BLOCKED_PREFIXES: readonly string[] = ["/login"];

function matchesPrefix(value: string, prefix: string): boolean {
  return (
    value === prefix ||
    value.startsWith(`${prefix}?`) ||
    value.startsWith(`${prefix}/`)
  );
}

/**
 * Sanitises the `?next=` query parameter before it is used as a redirect target.
 *
 * Only a site-relative, single-slash path is accepted. Absolute URLs,
 * protocol-relative URLs (`//host`), backslash tricks (`/\host`), control
 * characters, and links back to the login page all fall back to the dashboard,
 * so a crafted link cannot turn the login page into an open redirect or a loop.
 *
 * `blockedPrefixes` lets a flow refuse additional destinations that would loop
 * back into it — the locked area blocks its own passcode page.
 */
export function resolveNextPath(
  raw: string | string[] | undefined,
  options: { blockedPrefixes?: readonly string[] } = {},
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string" || value === "") {
    return DEFAULT_NEXT_PATH;
  }

  if (!value.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (value.startsWith("//")) return DEFAULT_NEXT_PATH;
  if (value.includes("\\")) return DEFAULT_NEXT_PATH;
  if (CONTROL_CHARACTERS.test(value)) return DEFAULT_NEXT_PATH;

  const blocked = options.blockedPrefixes ?? DEFAULT_BLOCKED_PREFIXES;
  if (blocked.some((prefix) => matchesPrefix(value, prefix))) {
    return DEFAULT_NEXT_PATH;
  }

  return value;
}
