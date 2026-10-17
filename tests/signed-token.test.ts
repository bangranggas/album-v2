import { describe, expect, it } from "vitest";

import { signToken, verifyToken } from "@/lib/signed-token";

const SECRET = "correct-horse-battery-staple";
const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const TTL = 60 * 60 * 1000;

const CONTEXT = "link-collector/test";

function sign(overrides: Partial<Parameters<typeof signToken>[0]> = {}) {
  return signToken({
    now: NOW,
    secret: SECRET,
    context: CONTEXT,
    ttlMs: TTL,
    ...overrides,
  });
}

function verify(
  token: string | null | undefined,
  overrides: Partial<Parameters<typeof verifyToken>[1]> = {},
) {
  return verifyToken(token, {
    now: NOW,
    secret: SECRET,
    context: CONTEXT,
    ...overrides,
  });
}

describe("signToken", () => {
  it("embeds the expiry and a signature", () => {
    const token = sign();

    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(token.startsWith(`${NOW + TTL}.`)).toBe(true);
  });

  it("honours a custom lifetime", () => {
    expect(sign({ ttlMs: 1000 }).startsWith(`${NOW + 1000}.`)).toBe(true);
  });

  it("produces a different signature for a different secret", () => {
    expect(sign()).not.toBe(sign({ secret: `${SECRET}-other` }));
  });

  it("produces a different signature for a different context", () => {
    expect(sign()).not.toBe(sign({ context: "link-collector/other" }));
  });
});

describe("verifyToken", () => {
  it("accepts a freshly signed token and returns its expiry", () => {
    expect(verify(sign())).toEqual({ valid: true, expiresAt: NOW + TTL });
  });

  it("accepts a token up to the second before expiry", () => {
    expect(verify(sign(), { now: NOW + TTL - 1 }).valid).toBe(true);
  });

  it("rejects a token exactly at its expiry", () => {
    expect(verify(sign(), { now: NOW + TTL })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("rejects a token signed with a different secret", () => {
    expect(verify(sign({ secret: `${SECRET}-other` }))).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects a token signed in a different context", () => {
    expect(verify(sign({ context: "link-collector/other" }))).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects a token whose expiry was tampered with, not reports it as expired", () => {
    const token = sign();
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${NOW + TTL * 10}.${signature}`;

    expect(verify(forged)).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects a tampered signature", () => {
    const token = sign();
    const forged = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    expect(verify(forged)).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("fails closed when no secret is configured", () => {
    const token = sign();

    expect(verify(token, { secret: undefined })).toEqual({
      valid: false,
      reason: "unconfigured",
    });
    expect(verify(token, { secret: "" })).toEqual({
      valid: false,
      reason: "unconfigured",
    });
  });

  it("fails closed when the context is empty", () => {
    expect(verify(sign(), { context: "" }).valid).toBe(false);
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
    ["an uppercase signature", `12345.${"A".repeat(64)}`],
    ["a short signature", "12345.abcdef"],
    ["an arbitrary string", "not-a-session"],
  ])("reports %s as malformed", (_label, token) => {
    expect(verify(token)).toEqual({ valid: false, reason: "malformed" });
  });

  it("does not crash on a token that is only separators", () => {
    expect(verify("..").valid).toBe(false);
  });
});
