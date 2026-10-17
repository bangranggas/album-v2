export const MIN_PASSWORD_LENGTH = 16;

export interface BasicCredentials {
  username: string;
  password: string;
}

/**
 * Result of checking a request against the dashboard password. Split from the
 * HTTP response so the decision logic is unit-testable without Next.js.
 */
export type DashboardGate =
  | { action: "allow" }
  | { action: "challenge" }
  | { action: "unconfigured" };

/**
 * Parses `Authorization: Basic base64(user:pass)`. Returns `null` for anything
 * that is not a decodable Basic header.
 */
export function decodeBasicAuth(
  headerValue: string | null,
): BasicCredentials | null {
  if (headerValue === null) return null;

  const separatorIndex = headerValue.indexOf(" ");
  if (separatorIndex === -1) return null;

  const scheme = headerValue.slice(0, separatorIndex);
  if (scheme.toLowerCase() !== "basic") return null;

  const encoded = headerValue.slice(separatorIndex + 1).trim();
  if (encoded === "") return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }

  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) return null;

  return {
    username: decoded.slice(0, colonIndex),
    password: decoded.slice(colonIndex + 1),
  };
}

export function isDashboardPasswordConfigured(
  password: string | undefined,
): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Constant-time comparison, byte-by-byte, over UTF-8 code units.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

/**
 * Fails closed: an unconfigured (or too short) password blocks the dashboard
 * with a configuration error instead of allowing access.
 */
export function evaluateDashboardGate(
  headerValue: string | null,
  configuredPassword: string | undefined,
): DashboardGate {
  if (!isDashboardPasswordConfigured(configuredPassword)) {
    return { action: "unconfigured" };
  }

  const credentials = decodeBasicAuth(headerValue);
  if (!credentials) {
    return { action: "challenge" };
  }

  return constantTimeEqual(credentials.password, configuredPassword)
    ? { action: "allow" }
    : { action: "challenge" };
}
