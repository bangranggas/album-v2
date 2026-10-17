import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const USERSCRIPT_PATH = fileURLToPath(
  new URL("../userscript/link-collector.user.js", import.meta.url),
);

interface UserscriptApi {
  isBlacklisted(hostname: string, url: string): boolean;
  currentUrl(): string;
  pageTitle(): string;
  normalizeImageUrl(raw: string | null): string | null;
  pageThumbnail(): string | null;
}

function loadUserscript(options: {
  href: string;
  title?: string;
  metas?: Record<string, string>;
}): UserscriptApi {
  const code = readFileSync(USERSCRIPT_PATH, "utf8");
  const metas = options.metas ?? {};

  const documentStub = {
    title: options.title ?? "",
    // Truthy, so bootstrap skips UI injection and the pure helpers are isolated.
    getElementById: () => ({}),
    querySelector: (selector: string) =>
      selector in metas
        ? { getAttribute: (name: string) => (name === "content" ? metas[selector] : null) }
        : null,
  };

  const context = vm.createContext({
    module: { exports: {} },
    document: documentStub,
    location: new URL(options.href),
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    console,
  });

  vm.runInContext(code, context);

  return (context as unknown as { module: { exports: UserscriptApi } }).module
    .exports;
}

describe("userscript blacklist", () => {
  const api = loadUserscript({ href: "https://example.com/page" });

  it.each([
    ["localhost", "http://localhost:8080/dashboard"],
    ["a loopback ip", "http://127.0.0.1/"],
    ["a .local hostname", "http://printer.local/settings"],
    ["an exact banking domain", "https://bca.co.id/"],
    ["a banking subdomain", "https://ibank.bca.co.id/"],
    ["a nested banking subdomain", "https://a.b.bni.co.id/"],
    ["paypal", "https://www.paypal.com/checkout"],
    ["a pdf document", "https://example.com/paper.pdf"],
    ["a pdf with a query string", "https://example.com/paper.pdf?download=1"],
  ])("blocks %s", (label, url) => {
    expect(api.isBlacklisted(new URL(url).hostname, url)).toBe(true);
  });

  it.each([
    ["a normal site", "https://example.com/article"],
    ["a google page", "https://www.google.com/search?q=links"],
    // Boundary check: the rule must not match a domain that merely looks similar.
    ["a lookalike domain", "https://notbca.co.id/"],
    ["a domain containing a blocked name", "https://bca.co.id.evil.example/"],
    ["an html document", "https://example.com/report.html"],
  ])("allows %s", (label, url) => {
    expect(api.isBlacklisted(new URL(url).hostname, url)).toBe(false);
  });
});

describe("userscript extraction", () => {
  it("drops the hash but keeps the query string", () => {
    const api = loadUserscript({
      href: "https://example.com/article?id=7#section-3",
    });

    expect(api.currentUrl()).toBe("https://example.com/article?id=7");
  });

  it("uses document.title when present", () => {
    const api = loadUserscript({
      href: "https://example.com/",
      title: "  A Real Title  ",
    });

    expect(api.pageTitle()).toBe("A Real Title");
  });

  it("falls back to the hostname when the title is empty", () => {
    const api = loadUserscript({ href: "https://example.com/page", title: "   " });

    expect(api.pageTitle()).toBe("example.com");
  });

  describe("normalizeImageUrl", () => {
    const api = loadUserscript({ href: "https://example.com/a/b" });

    it("returns an absolute http url unchanged", () => {
      expect(api.normalizeImageUrl("https://cdn.example.com/x.jpg")).toBe(
        "https://cdn.example.com/x.jpg",
      );
    });

    it("resolves a protocol-relative url", () => {
      expect(api.normalizeImageUrl("//cdn.example.com/x.jpg")).toBe(
        "https://cdn.example.com/x.jpg",
      );
    });

    it("resolves a relative url against the page origin", () => {
      expect(api.normalizeImageUrl("/og.jpg")).toBe("https://example.com/og.jpg");
    });

    it.each([
      ["an empty string", ""],
      ["whitespace", "   "],
      ["null", null],
      ["a data url", "data:image/png;base64,AAAA"],
      ["a javascript url", "javascript:alert(1)"],
    ])("returns null for %s", (_label, raw) => {
      expect(api.normalizeImageUrl(raw)).toBeNull();
    });
  });

  describe("pageThumbnail", () => {
    it("prefers og:image", () => {
      const api = loadUserscript({
        href: "https://example.com/",
        metas: {
          'meta[property="og:image"]': "https://cdn.example.com/og.jpg",
          'meta[name="twitter:image"]': "https://cdn.example.com/twitter.jpg",
        },
      });

      expect(api.pageThumbnail()).toBe("https://cdn.example.com/og.jpg");
    });

    it("accepts the twitter card as a fallback", () => {
      const api = loadUserscript({
        href: "https://example.com/",
        metas: {
          'meta[property="og:image"]': "",
          'meta[name="twitter:image"]': "https://cdn.example.com/twitter.jpg",
        },
      });

      expect(api.pageThumbnail()).toBe("https://cdn.example.com/twitter.jpg");
    });

    it("returns null when no image metadata exists", () => {
      const api = loadUserscript({ href: "https://example.com/" });

      expect(api.pageThumbnail()).toBeNull();
    });

    it("returns null when the metadata value is not a usable url", () => {
      const api = loadUserscript({
        href: "https://example.com/",
        metas: { 'meta[property="og:image"]': "data:image/png;base64,AAAA" },
      });

      expect(api.pageThumbnail()).toBeNull();
    });
  });
});
