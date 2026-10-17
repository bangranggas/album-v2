import { describe, expect, it } from "vitest";

import {
  decodeBasicAuth,
  evaluateDashboardGate,
  isDashboardPasswordConfigured,
  MIN_PASSWORD_LENGTH,
} from "@/lib/basic-auth";

function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

const VALID_PASSWORD = "correct-horse-battery";

describe("decodeBasicAuth", () => {
  it("decodes a well-formed header", () => {
    expect(decodeBasicAuth(basicHeader("user", "pass"))).toEqual({
      username: "user",
      password: "pass",
    });
  });

  it("accepts a lowercase scheme", () => {
    const encoded = Buffer.from("user:pass").toString("base64");

    expect(decodeBasicAuth(`basic ${encoded}`)).toEqual({
      username: "user",
      password: "pass",
    });
  });

  it("splits on the first colon only, keeping colons in the password", () => {
    expect(decodeBasicAuth(basicHeader("user", "pa:ss:word"))).toEqual({
      username: "user",
      password: "pa:ss:word",
    });
  });

  it("supports an empty username", () => {
    expect(decodeBasicAuth(basicHeader("", "pass"))).toEqual({
      username: "",
      password: "pass",
    });
  });

  it.each([
    ["a missing header", null],
    ["an empty header", ""],
    ["a non-Basic scheme", "Bearer token"],
    ["a Basic header with no payload", "Basic"],
    ["a header without a colon", `Basic ${Buffer.from("nocolon").toString("base64")}`],
    ["invalid base64", "Basic !!!not-base64!!!"],
  ])("returns null for %s", (_label, header) => {
    expect(decodeBasicAuth(header)).toBeNull();
  });
});

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

describe("evaluateDashboardGate", () => {
  it("reports unconfigured when no password is set", () => {
    expect(evaluateDashboardGate(basicHeader("u", VALID_PASSWORD), undefined)).toEqual(
      { action: "unconfigured" },
    );
  });

  it("reports unconfigured when the password is too short", () => {
    expect(evaluateDashboardGate(basicHeader("u", "short"), "short")).toEqual({
      action: "unconfigured",
    });
  });

  it("allows a matching password", () => {
    expect(
      evaluateDashboardGate(basicHeader("ignored-user", VALID_PASSWORD), VALID_PASSWORD),
    ).toEqual({ action: "allow" });
  });

  it("ignores the username", () => {
    expect(
      evaluateDashboardGate(basicHeader("", VALID_PASSWORD), VALID_PASSWORD),
    ).toEqual({ action: "allow" });
  });

  it("challenges a missing header", () => {
    expect(evaluateDashboardGate(null, VALID_PASSWORD)).toEqual({
      action: "challenge",
    });
  });

  it("challenges a malformed header", () => {
    expect(evaluateDashboardGate("Basic nonsense", VALID_PASSWORD)).toEqual({
      action: "challenge",
    });
  });

  it("challenges a wrong password", () => {
    expect(
      evaluateDashboardGate(basicHeader("u", "wrong-password-x"), VALID_PASSWORD),
    ).toEqual({ action: "challenge" });
  });

  it("challenges a password that only shares a prefix", () => {
    expect(
      evaluateDashboardGate(basicHeader("u", `${VALID_PASSWORD}-extra`), VALID_PASSWORD),
    ).toEqual({ action: "challenge" });
  });

  it("fails closed when the configured password is empty", () => {
    expect(evaluateDashboardGate(basicHeader("u", ""), "")).toEqual({
      action: "unconfigured",
    });
  });
});
