import { describe, expect, it } from "vitest";

import {
  evaluateDashboardGate,
  isDashboardPasswordConfigured,
  MIN_PASSWORD_LENGTH,
  verifyDashboardPassword,
} from "@/lib/dashboard-auth";
import { SESSION_TTL_MS, signSession } from "@/lib/session";

const PASSWORD = "correct-horse-battery";
const NOW = Date.parse("2026-10-17T00:00:00.000Z");

function validToken(password = PASSWORD, now = NOW): string {
  return signSession({ now, secret: password });
}

describe("isDashboardPasswordConfigured", () => {
  it("rejects an undefined password", () => {
    expect(isDashboardPasswordConfigured(undefined)).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(isDashboardPasswordConfigured("")).toBe(false);
  });

  it("rejects a password shorter than the minimum", () => {
    expect(
      isDashboardPasswordConfigured("a".repeat(MIN_PASSWORD_LENGTH - 1)),
    ).toBe(false);
  });

  it("accepts a password at the minimum length", () => {
    expect(
      isDashboardPasswordConfigured("a".repeat(MIN_PASSWORD_LENGTH)),
    ).toBe(true);
  });
});

describe("verifyDashboardPassword", () => {
  it("accepts the configured password", () => {
    expect(verifyDashboardPassword(PASSWORD, PASSWORD)).toBe(true);
  });

  it("rejects a wrong password of the same length", () => {
    expect(verifyDashboardPassword("correct-horse-batteryX", PASSWORD)).toBe(false);
  });

  it("rejects a password that only shares a prefix", () => {
    expect(verifyDashboardPassword(PASSWORD.slice(0, 5), PASSWORD)).toBe(false);
    expect(verifyDashboardPassword(`${PASSWORD}-extra`, PASSWORD)).toBe(false);
  });

  it("treats whitespace as significant", () => {
    expect(verifyDashboardPassword(` ${PASSWORD} `, PASSWORD)).toBe(false);
    expect(verifyDashboardPassword(PASSWORD, ` ${PASSWORD} `)).toBe(false);
  });

  it("supports passwords that contain spaces", () => {
    const withSpaces = "correct horse battery";
    expect(verifyDashboardPassword(withSpaces, withSpaces)).toBe(true);
  });

  it("fails closed when the configured password is missing or too short", () => {
    expect(verifyDashboardPassword("anything", undefined)).toBe(false);
    expect(verifyDashboardPassword("", "")).toBe(false);
    expect(verifyDashboardPassword("short", "short")).toBe(false);
  });
});

describe("evaluateDashboardGate", () => {
  it("allows a request carrying a valid session cookie", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: validToken(),
        configuredPassword: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ action: "allow" });
  });

  it("redirects a visitor with no cookie at all", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: null,
        configuredPassword: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ action: "redirect" });
  });

  it("redirects a visitor with an empty cookie", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: "",
        configuredPassword: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ action: "redirect" });
  });

  it("redirects a tampered cookie", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: `${validToken()}0`,
        configuredPassword: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ action: "redirect" });
  });

  it("redirects an expired cookie", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: validToken(),
        configuredPassword: PASSWORD,
        now: NOW + SESSION_TTL_MS,
      }),
    ).toEqual({ action: "redirect" });
  });

  it("redirects a cookie signed with a different password", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: validToken("some-other-password"),
        configuredPassword: PASSWORD,
        now: NOW,
      }),
    ).toEqual({ action: "redirect" });
  });

  it("redirects when the password was rotated after the cookie was issued", () => {
    const issuedWithOldPassword = validToken("old-password-value");

    expect(
      evaluateDashboardGate({
        sessionToken: issuedWithOldPassword,
        configuredPassword: "new-password-value",
        now: NOW,
      }),
    ).toEqual({ action: "redirect" });
  });

  it("reports unconfigured when no password is set, even with a token", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: validToken(),
        configuredPassword: undefined,
        now: NOW,
      }),
    ).toEqual({ action: "unconfigured" });
  });

  it("reports unconfigured when the configured password is too short", () => {
    expect(
      evaluateDashboardGate({
        sessionToken: validToken("short"),
        configuredPassword: "short",
        now: NOW,
      }),
    ).toEqual({ action: "unconfigured" });
  });
});
