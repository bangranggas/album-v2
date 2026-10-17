import { describe, expect, it } from "vitest";

import {
  MAX_DOMAIN_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  parseLinkPatch,
  parseLockedDomain,
  parseManualLinkInput,
  parsePasscodeInput,
} from "@/lib/validation";

describe("parseManualLinkInput", () => {
  it("keeps a title the user typed", () => {
    const result = parseManualLinkInput({
      url: "https://example.com/article",
      title: "  My title  ",
    });

    expect(result.ok && result.data.title).toBe("My title");
  });

  it("derives host and path when the title is empty", () => {
    const result = parseManualLinkInput({
      url: "https://example.com/article",
      title: "   ",
    });

    expect(result.ok && result.data.title).toBe("example.com/article");
  });

  it("derives the title when the field is missing entirely", () => {
    const result = parseManualLinkInput({ url: "https://example.com/article" });

    expect(result.ok && result.data.title).toBe("example.com/article");
  });

  it.each([
    ["the bare host", "https://example.com", "example.com"],
    ["a root path", "https://example.com/", "example.com"],
    ["a nested path", "https://example.com/a/b/", "example.com/a/b"],
    ["a path with a query, which is dropped", "https://example.com/a?b=c", "example.com/a"],
    ["a subdomain", "https://sub.example.com/x", "sub.example.com/x"],
    ["a port", "https://example.com:8443/x", "example.com:8443/x"],
  ])("derives %s", (_label, url, expected) => {
    const result = parseManualLinkInput({ url });

    expect(result.ok && result.data.title).toBe(expected);
  });

  it("caps a very long derived title", () => {
    const url = `https://example.com/${"a".repeat(MAX_URL_LENGTH - 30)}`;

    const result = parseManualLinkInput({ url });

    expect(result.ok && result.data.title.length).toBeLessThanOrEqual(
      MAX_TITLE_LENGTH,
    );
  });

  it("derives the domain, exactly like the userscript path", () => {
    const result = parseManualLinkInput({ url: "https://Example.COM/x" });

    expect(result.ok && result.data.domain).toBe("example.com");
  });

  it("normalises an empty thumbnail to null and keeps a real one", () => {
    expect(
      parseManualLinkInput({ url: "https://example.com/a", thumbnail: "  " }),
    ).toEqual(expect.objectContaining({ ok: true }));

    const withImage = parseManualLinkInput({
      url: "https://example.com/a",
      thumbnail: "https://example.com/og.jpg",
    });
    expect(withImage.ok && withImage.data.thumbnail).toBe(
      "https://example.com/og.jpg",
    );
  });

  it.each([
    ["a missing url", {}],
    ["a relative url", { url: "/article" }],
    ["a non-http protocol", { url: "ftp://example.com/x" }],
    ["an over-long url", { url: `https://example.com/${"a".repeat(MAX_URL_LENGTH)}` }],
    ["a non-string title", { url: "https://example.com/a", title: 42 }],
    ["an over-long title", { url: "https://example.com/a", title: "x".repeat(MAX_TITLE_LENGTH + 1) }],
    ["a relative thumbnail", { url: "https://example.com/a", thumbnail: "/og.jpg" }],
  ])("rejects %s", (_label, payload) => {
    expect(parseManualLinkInput(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseManualLinkInput(null).ok).toBe(false);
    expect(parseManualLinkInput("https://example.com").ok).toBe(false);
    expect(parseManualLinkInput([]).ok).toBe(false);
  });
});

describe("parseLinkPatch", () => {
  it("accepts a title-only edit", () => {
    const result = parseLinkPatch({ title: "New title" });

    expect(result.ok && result.data).toEqual({ title: "New title" });
  });

  it("derives the domain from a new url", () => {
    const result = parseLinkPatch({ url: "https://other.example/moved" });

    expect(result.ok && result.data).toEqual({
      url: "https://other.example/moved",
      domain: "other.example",
    });
  });

  it("ignores a client-supplied domain, which is always derived", () => {
    const result = parseLinkPatch({
      url: "https://good.example/x",
      domain: "evil.example",
    });

    expect(result.ok && result.data.domain).toBe("good.example");
  });

  it("accepts a favorite toggle", () => {
    expect(parseLinkPatch({ isFavorite: true })).toEqual({
      ok: true,
      data: { isFavorite: true },
    });
    expect(parseLinkPatch({ isFavorite: false })).toEqual({
      ok: true,
      data: { isFavorite: false },
    });
  });

  it("clears the thumbnail with null or an empty string", () => {
    expect(parseLinkPatch({ thumbnail: null })).toEqual({
      ok: true,
      data: { thumbnail: null },
    });
    expect(parseLinkPatch({ thumbnail: "  " })).toEqual({
      ok: true,
      data: { thumbnail: null },
    });
  });

  it("keeps a replacement thumbnail", () => {
    const result = parseLinkPatch({ thumbnail: "https://example.com/new.jpg" });

    expect(result.ok && result.data.thumbnail).toBe("https://example.com/new.jpg");
  });

  it("accepts several fields at once", () => {
    const result = parseLinkPatch({
      title: "T",
      url: "https://example.com/x",
      isFavorite: true,
    });

    expect(result.ok && result.data).toEqual({
      title: "T",
      url: "https://example.com/x",
      domain: "example.com",
      isFavorite: true,
    });
  });

  it.each([
    ["an empty patch", {}],
    ["only unknown fields", { id: "abc" }],
    ["only the derived field", { domain: "example.com" }],
  ])("rejects %s, because nothing would change", (_label, payload) => {
    const result = parseLinkPatch(payload);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/no fields/i);
  });

  it.each([
    ["a bad url", { url: "not-a-url" }],
    ["an over-long title", { title: "x".repeat(MAX_TITLE_LENGTH + 1) }],
    ["an empty title", { title: "   " }],
    ["a non-string title", { title: 5 }],
    ["a non-boolean favorite", { isFavorite: "yes" }],
    ["a relative thumbnail", { thumbnail: "/og.jpg" }],
    ["an over-long thumbnail", { thumbnail: `https://example.com/${"a".repeat(MAX_URL_LENGTH)}` }],
  ])("rejects %s", (_label, payload) => {
    expect(parseLinkPatch(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseLinkPatch(null).ok).toBe(false);
    expect(parseLinkPatch([]).ok).toBe(false);
  });
});

describe("parseLockedDomain", () => {
  it.each([
    ["a bare domain", "example.com", "example.com"],
    ["a padded, uppercase domain", "  Example.COM  ", "example.com"],
    ["a subdomain", "www.example.com", "www.example.com"],
    ["a single-label host", "localhost", "localhost"],
    ["a host with a port", "example.com:8443", "example.com:8443"],
    ["a pasted https url", "https://example.com/some/path?q=1", "example.com"],
    ["a pasted http url with a port", "http://example.com:8080/x", "example.com:8080"],
    ["a scheme-less url with a path", "example.com/x", "example.com"],
    ["a numeric host", "192.168.1.10", "192.168.1.10"],
    ["a trailing dot", "example.com.", "example.com"],
    ["a trailing slash", "example.com/", "example.com"],
    ["a domain with hyphens", "my-site.example.com", "my-site.example.com"],
  ])("normalises %s", (_label, input, expected) => {
    const result = parseLockedDomain({ domain: input });

    expect(result.ok && result.data.domain).toBe(expected);
  });

  it.each([
    ["a missing field", {}],
    ["an empty string", { domain: "" }],
    ["whitespace only", { domain: "   " }],
    ["a non-string", { domain: 42 }],
    ["an internal space", { domain: "not a domain" }],
    ["a leading hyphen label", { domain: "-bad.example" }],
    ["an empty label", { domain: "bad..example" }],
    ["a bad port", { domain: "example.com:port" }],
    ["an out-of-range port", { domain: "example.com:70000" }],
    ["a scheme only", { domain: "https://" }],
    ["a javascript url", { domain: "javascript:alert(1)" }],
    ["a wildly long value", { domain: `${"a".repeat(MAX_DOMAIN_LENGTH + 1)}.example` }],
  ])("rejects %s", (_label, payload) => {
    expect(parseLockedDomain(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseLockedDomain(null).ok).toBe(false);
    expect(parseLockedDomain("example.com").ok).toBe(false);
  });
});

describe("parsePasscodeInput", () => {
  it("keeps the passcode exactly as typed", () => {
    expect(parsePasscodeInput({ passcode: "open sesame now" })).toEqual({
      ok: true,
      data: { passcode: "open sesame now" },
    });
  });

  it.each([
    ["a missing passcode", {}],
    ["an empty passcode", { passcode: "" }],
    ["a non-string passcode", { passcode: 1234 }],
    ["the dashboard field name", { password: "wrong-field" }],
  ])("rejects %s", (_label, payload) => {
    expect(parsePasscodeInput(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parsePasscodeInput(null).ok).toBe(false);
    expect(parsePasscodeInput([]).ok).toBe(false);
  });
});
