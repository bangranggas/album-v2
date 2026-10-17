/** Where the login page sends a visitor when no usable destination was given. */
export const DEFAULT_NEXT_PATH = "/";

/** Control characters, which have no business in a path. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isLoginPath(value: string): boolean {
  return (
    value === "/login" ||
    value.startsWith("/login?") ||
    value.startsWith("/login/")
  );
}

/**
 * Sanitises the `?next=` query parameter before it is used as a redirect target.
 *
 * Only a site-relative, single-slash path is accepted. Absolute URLs,
 * protocol-relative URLs (`//host`), backslash tricks (`/\host`), control
 * characters, and links back to the login page all fall back to the dashboard,
 * so a crafted link cannot turn the login page into an open redirect or a loop.
 */
export function resolveNextPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string" || value === "") {
    return DEFAULT_NEXT_PATH;
  }

  if (!value.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (value.startsWith("//")) return DEFAULT_NEXT_PATH;
  if (value.includes("\\")) return DEFAULT_NEXT_PATH;
  if (CONTROL_CHARACTERS.test(value)) return DEFAULT_NEXT_PATH;
  if (isLoginPath(value)) return DEFAULT_NEXT_PATH;

  return value;
}
