import { describe, expect, it } from "vitest";

import {
  parseJsonBody,
  parseLimitParam,
  parseLinkInput,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
} from "@/lib/validation";

const validPayload = {
  url: "https://example.com/article",
  title: "Example Article",
  thumbnail: "https://example.com/og.jpg",
};

describe("parseJsonBody", () => {
  it("parses a valid JSON object", () => {
    const result = parseJsonBody('{"url":"https://example.com"}');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ url: "https://example.com" });
    }
  });

  it("reports malformed JSON instead of throwing", () => {
    const result = parseJsonBody("{not json");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/json/i);
    }
  });

  it("rejects an empty body", () => {
    expect(parseJsonBody("").ok).toBe(false);
  });
});

describe("parseLinkInput", () => {
  it("accepts a complete payload", () => {
    const result = parseLinkInput(validPayload);

    expect(result).toEqual({
      ok: true,
      data: { ...validPayload, domain: "example.com" },
    });
  });

  it("normalizes an empty thumbnail to null", () => {
    const result = parseLinkInput({ ...validPayload, thumbnail: "" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.thumbnail).toBeNull();
    }
  });

  it("normalizes an explicit null thumbnail to null", () => {
    const result = parseLinkInput({ ...validPayload, thumbnail: null });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.thumbnail).toBeNull();
    }
  });

  it("treats a missing thumbnail as null", () => {
    const result = parseLinkInput({
      url: validPayload.url,
      title: validPayload.title,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.thumbnail).toBeNull();
    }
  });

  it("trims surrounding whitespace from url and title", () => {
    const result = parseLinkInput({
      url: "  https://example.com/article  ",
      title: "  Padded title  ",
      thumbnail: "  ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe("https://example.com/article");
      expect(result.data.title).toBe("Padded title");
      expect(result.data.thumbnail).toBeNull();
    }
  });

  it.each([
    ["a bare hostname", "example.com"],
    ["a relative path", "/article"],
    ["a non-http scheme", "ftp://example.com/file"],
    ["a javascript: url", "javascript:alert(1)"],
    ["an empty string", "   "],
  ])("rejects %s as a url", (_label, url) => {
    const result = parseLinkInput({ ...validPayload, url });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/url/i);
    }
  });

  it("rejects an empty title", () => {
    const result = parseLinkInput({ ...validPayload, title: "   " });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/title/i);
    }
  });

  it("rejects a title longer than the cap", () => {
    const result = parseLinkInput({
      ...validPayload,
      title: "a".repeat(MAX_TITLE_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a title exactly at the cap", () => {
    const result = parseLinkInput({
      ...validPayload,
      title: "a".repeat(MAX_TITLE_LENGTH),
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a url longer than the cap", () => {
    const result = parseLinkInput({
      ...validPayload,
      url: `https://example.com/${"a".repeat(MAX_URL_LENGTH)}`,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a non-http thumbnail", () => {
    const result = parseLinkInput({ ...validPayload, thumbnail: "/og.jpg" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/thumbnail/i);
    }
  });

  it.each([
    ["null", null],
    ["a string", "https://example.com"],
    ["an array", [validPayload]],
    ["a number", 42],
  ])("rejects %s as the payload", (_label, payload) => {
    expect(parseLinkInput(payload).ok).toBe(false);
  });

  it("rejects unknown extra fields without failing the valid ones", () => {
    const result = parseLinkInput({ ...validPayload, injected: "value" });

    expect(result.ok).toBe(true);
  });

  describe("derived domain", () => {
    function domainOf(url: string): string | undefined {
      const result = parseLinkInput({ ...validPayload, url });

      return result.ok ? result.data.domain : undefined;
    }

    it.each([
      ["a plain host", "https://example.com/article", "example.com"],
      ["an http url", "http://example.com/article", "example.com"],
      ["a url with no path", "https://example.com", "example.com"],
      ["a lowercase result", "https://WWW.Example.COM/Path", "www.example.com"],
      ["a host with a port", "https://example.com:8443/x", "example.com:8443"],
      ["dropped credentials", "https://user:pass@example.com/x", "example.com"],
      ["an ip address", "http://127.0.0.1:4200/x", "127.0.0.1:4200"],
      ["a punycode unicode host", "https://münchen.de/x", "xn--mnchen-3ya.de"],
      ["a subdomain chain", "https://a.b.example.com/x", "a.b.example.com"],
    ])("derives %s", (_label, url, expected) => {
      expect(domainOf(url)).toBe(expected);
    });

    it("is never returned for a rejected url", () => {
      expect(domainOf("not-a-url")).toBeUndefined();
    });
  });
});

describe("parseLimitParam", () => {
  it("defaults when the parameter is absent", () => {
    expect(parseLimitParam(null)).toEqual({ ok: true, data: DEFAULT_LIMIT });
  });

  it("accepts an in-range integer", () => {
    expect(parseLimitParam("25")).toEqual({ ok: true, data: 25 });
  });

  it("accepts the maximum", () => {
    expect(parseLimitParam(String(MAX_LIMIT))).toEqual({
      ok: true,
      data: MAX_LIMIT,
    });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-5"],
    ["above the maximum", String(MAX_LIMIT + 1)],
    ["a fraction", "1.5"],
    ["a word", "abc"],
    ["an empty string", ""],
  ])("rejects %s", (_label, raw) => {
    expect(parseLimitParam(raw).ok).toBe(false);
  });
});
