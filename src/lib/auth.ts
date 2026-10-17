export const SECRET_HEADER = "x-secret-key";

/**
 * Compares two strings without short-circuiting on the first differing
 * character. Length is compared first, which leaks the length only — acceptable
 * for a high-entropy static token, and it keeps this module free of Node
 * built-ins so it can run in any runtime.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

/**
 * Fails closed: if `SECRET_KEY` is missing or empty, no request is authorized.
 */
export function verifySecret(request: Request): boolean {
  const expected = process.env.SECRET_KEY;
  if (!expected) return false;

  const provided = request.headers.get(SECRET_HEADER);
  if (provided === null) return false;

  return constantTimeEqual(provided, expected);
}
