import { describe, expect, it } from "vitest";

import {
  LOCKED_COOKIE_NAME,
  LOCKED_TTL_MS,
  signLockedSession,
  verifyLockedSession,
} from "@/lib/locked-session";
import { signSession } from "@/lib/session";

const SECRET = "correct-horse-battery-staple";
const NOW = Date.parse("2026-10-18T00:00:00.000Z");

describe("locked session constants", () => {
  it("uses its own cookie, separate from the dashboard session", () => {
    expect(LOCKED_COOKIE_NAME).toBe("lc_locked");
    expect(LOCKED_COOKIE_NAME).not.toBe("lc_session");
  });

  it("lasts one hour", () => {
    expect(LOCKED_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe("signLockedSession", () => {
  it("embeds the expiry and a signature", () => {
    const token = signLockedSession({ now: NOW, secret: SECRET });

    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(token.startsWith(`${NOW + LOCKED_TTL_MS}.`)).toBe(true);
  });

  it("honours a custom lifetime", () => {
    expect(
      signLockedSession({ now: NOW, secret: SECRET, ttlMs: 1000 }).startsWith(
        `${NOW + 1000}.`,
      ),
    ).toBe(true);
  });
});

describe("verifyLockedSession", () => {
  it("accepts a freshly signed token and returns its expiry", () => {
    const token = signLockedSession({ now: NOW, secret: SECRET });

    expect(verifyLockedSession(token, { now: NOW, secret: SECRET })).toEqual({
      valid: true,
      expiresAt: NOW + LOCKED_TTL_MS,
    });
  });

  it("rejects a token exactly at its expiry", () => {
    const token = signLockedSession({ now: NOW, secret: SECRET });

    expect(
      verifyLockedSession(token, { now: NOW + LOCKED_TTL_MS, secret: SECRET }),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a tampered signature", () => {
    const token = signLockedSession({ now: NOW, secret: SECRET });
    const forged = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    expect(verifyLockedSession(forged, { now: NOW, secret: SECRET })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("fails closed when the passcode is not configured", () => {
    const token = signLockedSession({ now: NOW, secret: SECRET });

    expect(verifyLockedSession(token, { now: NOW, secret: undefined }).valid).toBe(
      false,
    );
  });

  /**
   * The whole point of a separate signature context: even an owner who sets both
   * secrets to the same value cannot use a dashboard login as a locked passcode.
   */
  it("refuses a dashboard session token, even with an identical secret", () => {
    const sessionToken = signSession({ now: NOW, secret: SECRET, ttlMs: 1000 });

    expect(
      verifyLockedSession(sessionToken, { now: NOW, secret: SECRET }),
    ).toEqual({ valid: false, reason: "bad-signature" });
  });
});
