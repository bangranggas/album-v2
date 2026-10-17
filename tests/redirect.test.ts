import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT_PATH, resolveNextPath } from "@/lib/redirect";

describe("resolveNextPath", () => {
  it.each([
    ["a normal path", "/links", "/links"],
    ["a path with a query string", "/links?page=2", "/links?page=2"],
    ["the dashboard root", "/", "/"],
    ["a deeper path", "/links/42", "/links/42"],
    ["a path that merely starts like login", "/loginish", "/loginish"],
  ])("keeps %s", (_label, input, expected) => {
    expect(resolveNextPath(input)).toBe(expected);
  });

  it.each([
    ["an undefined value", undefined],
    ["an empty string", ""],
    ["an absolute URL", "https://evil.example/steal"],
    ["a protocol-relative URL", "//evil.example/steal"],
    ["a backslash trick", "/\\evil.example"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a value without a leading slash", "links"],
    ["a whitespace-padded path", " /links"],
    ["a login path", "/login"],
    ["a login path with a query", "/login?next=/links"],
    ["a login subpath", "/login/anything"],
    ["a control character", "/links\nX-Injected: 1"],
  ])("falls back to the dashboard for %s", (_label, input) => {
    expect(resolveNextPath(input)).toBe(DEFAULT_NEXT_PATH);
  });

  it("uses the first value when the query parameter repeats", () => {
    expect(resolveNextPath(["/links", "/settings"])).toBe("/links");
  });

  it("falls back when a repeated parameter starts with an invalid value", () => {
    expect(resolveNextPath(["//evil.example", "/links"])).toBe(
      DEFAULT_NEXT_PATH,
    );
  });

  describe("blocked prefixes", () => {
    it("still refuses the login page by default", () => {
      expect(resolveNextPath("/login")).toBe(DEFAULT_NEXT_PATH);
    });

    it("accepts the locked area when no extra prefix is blocked", () => {
      expect(resolveNextPath("/locked")).toBe("/locked");
    });

    it("refuses whichever prefixes the caller blocks", () => {
      const options = { blockedPrefixes: ["/login", "/locked/unlock"] };

      expect(resolveNextPath("/locked/unlock", options)).toBe(DEFAULT_NEXT_PATH);
      expect(
        resolveNextPath("/locked/unlock?next=/locked", options),
      ).toBe(DEFAULT_NEXT_PATH);
      expect(resolveNextPath("/locked/unlock/extra", options)).toBe(
        DEFAULT_NEXT_PATH,
      );
    });

    it("still accepts a path that merely starts like a blocked prefix", () => {
      expect(
        resolveNextPath("/locked/unlocked", {
          blockedPrefixes: ["/login", "/locked/unlock"],
        }),
      ).toBe("/locked/unlocked");
    });

    it("keeps the locked list reachable while blocking the passcode page", () => {
      expect(
        resolveNextPath("/locked?q=hotel", {
          blockedPrefixes: ["/login", "/locked/unlock"],
        }),
      ).toBe("/locked?q=hotel");
    });
  });
});
