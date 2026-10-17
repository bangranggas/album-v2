import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  signSession,
  verifySession,
} from "@/lib/session";

const SECRET = "correct-horse-battery-staple";
const NOW = Date.parse("2026-10-17T00:00:00.000Z");

describe("session constants", () => {
  it("exposes the cookie name the proxy and login route share", () => {
    expect(SESSION_COOKIE_NAME).toBe("lc_session");
  });

  it("defaults to a seven day lifetime", () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("signSession", () => {
  it("embeds the expiry and a signature", () => {
    const token = signSession({ now: NOW, secret: SECRET });

    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(token.startsWith(`${NOW + SESSION_TTL_MS}.`)).toBe(true);
  });

  it("honours a custom lifetime", () => {
    const token = signSession({ now: NOW, secret: SECRET, ttlMs: 1000 });

    expect(token.startsWith(`${NOW + 1000}.`)).toBe(true);
  });

  it("produces a different signature for a different secret", () => {
    const a = signSession({ now: NOW, secret: SECRET });
    const b = signSession({ now: NOW, secret: `${SECRET}-other` });

    expect(a).not.toBe(b);
  });
});

describe("verifySession", () => {
  it("accepts a freshly signed token and returns its expiry", () => {
    const token = signSession({ now: NOW, secret: SECRET });

    expect(verifySession(token, { now: NOW, secret: SECRET })).toEqual({
      valid: true,
      expiresAt: NOW + SESSION_TTL_MS,
    });
  });

  it("accepts a token up to the second before expiry", () => {
    const token = signSession({ now: NOW, secret: SECRET });

    expect(
      verifySession(token, { now: NOW + SESSION_TTL_MS - 1, secret: SECRET }).valid,
    ).toBe(true);
  });

  it("rejects a token exactly at its expiry", () => {
    const token = signSession({ now: NOW, secret: SECRET });

    expect(verifySession(token, { now: NOW + SESSION_TTL_MS, secret: SECRET })).toEqual(
      { valid: false, reason: "expired" },
    );
  });

  it("rejects a token past its expiry", () => {
    const token = signSession({ now: NOW, secret: SECRET, ttlMs: 10 });

    expect(verifySession(token, { now: NOW + 11, secret: SECRET })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("rejects a tampered expiry, because the signature no longer matches", () => {
    const token = signSession({ now: NOW, secret: SECRET });
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${NOW + SESSION_TTL_MS * 10}.${signature}`;

    expect(verifySession(forged, { now: NOW, secret: SECRET })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects a tampered signature", () => {
    const token = signSession({ now: NOW, secret: SECRET });
    const forged = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    expect(verifySession(forged, { now: NOW, secret: SECRET })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession({ now: NOW, secret: `${SECRET}-other` });

    expect(verifySession(token, { now: NOW, secret: SECRET })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("fails closed when no secret is configured", () => {
    const token = signSession({ now: NOW, secret: SECRET });

    expect(verifySession(token, { now: NOW, secret: undefined })).toEqual({
      valid: false,
      reason: "unconfigured",
    });
    expect(verifySession(token, { now: NOW, secret: "" })).toEqual({
      valid: false,
      reason: "unconfigured",
    });
  });

  it.each([
    ["a null token", null],
    ["an undefined token", undefined],
    ["an empty token", ""],
    ["a token without a separator", "12345"],
    ["a token with an empty expiry", ".abcdef"],
    ["a token with an empty signature", "12345."],
    ["a non-numeric expiry", "soon.abcdef"],
    ["a negative expiry", "-5.abcdef"],
    ["a fractional expiry", "1.5.abcdef"],
    ["an expiry beyond the safe integer range", "99999999999999999999.abcdef"],
    ["an arbitrary string", "not-a-session"],
  ])("reports %s as malformed", (_label, token) => {
    expect(verifySession(token, { now: NOW, secret: SECRET })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("treats an unauthenticated visitor with no cookie as malformed, not a crash", () => {
    expect(verifySession(null, { now: NOW, secret: SECRET }).valid).toBe(false);
  });
});
