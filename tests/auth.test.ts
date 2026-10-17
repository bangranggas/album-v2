import { afterEach, describe, expect, it, vi } from "vitest";

import { constantTimeEqual, SECRET_HEADER, verifySecret } from "@/lib/auth";

function requestWithSecret(value?: string): Request {
  return new Request("https://app.test/api/links", {
    headers: value === undefined ? {} : { [SECRET_HEADER]: value },
  });
}

describe("verifySecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the configured secret", () => {
    vi.stubEnv("SECRET_KEY", "correct-horse-battery-staple");

    expect(verifySecret(requestWithSecret("correct-horse-battery-staple"))).toBe(
      true,
    );
  });

  it("rejects a request with no header", () => {
    vi.stubEnv("SECRET_KEY", "correct-horse-battery-staple");

    expect(verifySecret(requestWithSecret())).toBe(false);
  });

  it("rejects a wrong secret", () => {
    vi.stubEnv("SECRET_KEY", "correct-horse-battery-staple");

    expect(verifySecret(requestWithSecret("wrong"))).toBe(false);
  });

  it("rejects a secret of a different length", () => {
    vi.stubEnv("SECRET_KEY", "correct-horse-battery-staple");

    expect(verifySecret(requestWithSecret("correct"))).toBe(false);
  });

  it("fails closed when SECRET_KEY is not configured", () => {
    vi.stubEnv("SECRET_KEY", "");

    expect(verifySecret(requestWithSecret(""))).toBe(false);
    expect(verifySecret(requestWithSecret("anything"))).toBe(false);
  });

  it("matches a padded header value, because the transport trims header values", () => {
    vi.stubEnv("SECRET_KEY", "padded-secret");

    // The Headers implementation strips surrounding whitespace from header
    // values, so a padded secret legitimately arrives trimmed and matches.
    expect(verifySecret(requestWithSecret(" padded-secret "))).toBe(true);
  });

  it("treats whitespace in the configured secret as significant", () => {
    vi.stubEnv("SECRET_KEY", " padded-secret ");

    expect(verifySecret(requestWithSecret("padded-secret"))).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("does not trim its inputs", () => {
    expect(constantTimeEqual("abc ", "abc")).toBe(false);
    expect(constantTimeEqual(" abc", "abc")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("returns false when only one string is empty", () => {
    expect(constantTimeEqual("", "a")).toBe(false);
  });
});
