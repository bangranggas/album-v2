import { describe, expect, it } from "vitest";

import {
  evaluateLockedGate,
  isLockedPasscodeConfigured,
  MIN_PASSCODE_LENGTH,
  verifyLockedPasscode,
} from "@/lib/locked-auth";
import { signLockedSession } from "@/lib/locked-session";
import { signSession } from "@/lib/session";

const PASSCODE = "correct-horse-battery-staple";
const NOW = Date.parse("2026-10-18T00:00:00.000Z");

describe("isLockedPasscodeConfigured", () => {
  it("requires the same minimum length as the dashboard password", () => {
    expect(MIN_PASSCODE_LENGTH).toBe(16);
  });

  it("rejects an unset, empty, or too-short passcode", () => {
    expect(isLockedPasscodeConfigured(undefined)).toBe(false);
    expect(isLockedPasscodeConfigured("")).toBe(false);
    expect(isLockedPasscodeConfigured("a".repeat(MIN_PASSCODE_LENGTH - 1))).toBe(
      false,
    );
  });

  it("accepts one at exactly the minimum length", () => {
    expect(isLockedPasscodeConfigured("a".repeat(MIN_PASSCODE_LENGTH))).toBe(true);
  });
});

describe("verifyLockedPasscode", () => {
  it("accepts the configured passcode", () => {
    expect(verifyLockedPasscode(PASSCODE, PASSCODE)).toBe(true);
  });

  it("rejects a wrong passcode", () => {
    expect(verifyLockedPasscode(`${PASSCODE}x`, PASSCODE)).toBe(false);
    expect(verifyLockedPasscode("", PASSCODE)).toBe(false);
  });

  it("fails closed when nothing is configured", () => {
    expect(verifyLockedPasscode(PASSCODE, undefined)).toBe(false);
    expect(verifyLockedPasscode("", undefined)).toBe(false);
  });
});

describe("evaluateLockedGate", () => {
  it("asks for the passcode when it is not configured at all", () => {
    expect(
      evaluateLockedGate({
        sessionToken: undefined,
        configuredPasscode: undefined,
        now: NOW,
      }),
    ).toEqual({ action: "unconfigured" });
  });

  it("allows a visit that carries a valid locked token", () => {
    const token = signLockedSession({ now: NOW, secret: PASSCODE });

    expect(
      evaluateLockedGate({
        sessionToken: token,
        configuredPasscode: PASSCODE,
        now: NOW,
      }),
    ).toEqual({ action: "allow" });
  });

  it("prompts when the cookie is missing", () => {
    expect(
      evaluateLockedGate({
        sessionToken: undefined,
        configuredPasscode: PASSCODE,
        now: NOW,
      }),
    ).toEqual({ action: "prompt" });
  });

  it("prompts on a forged token", () => {
    const token = signLockedSession({ now: NOW, secret: `${PASSCODE}-other` });

    expect(
      evaluateLockedGate({
        sessionToken: token,
        configuredPasscode: PASSCODE,
        now: NOW,
      }),
    ).toEqual({ action: "prompt" });
  });

  it("prompts once the hour is up", () => {
    const token = signLockedSession({ now: NOW, secret: PASSCODE });

    expect(
      evaluateLockedGate({
        sessionToken: token,
        configuredPasscode: PASSCODE,
        now: NOW + 60 * 60 * 1000,
      }),
    ).toEqual({ action: "prompt" });
  });

  it("prompts when the visitor only has a dashboard session", () => {
    const sessionToken = signSession({ now: NOW, secret: PASSCODE, ttlMs: 1000 });

    expect(
      evaluateLockedGate({
        sessionToken,
        configuredPasscode: PASSCODE,
        now: NOW,
      }),
    ).toEqual({ action: "prompt" });
  });
});
