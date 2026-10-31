import { describe, expect, it, vi } from "vitest";

import {
  isFetchableUrl,
  lookupPageThumbnail,
  pageThumbnail,
  readAttribute,
  readMetaContent,
  resolveImageUrl,
} from "@/lib/page-metadata";

describe("isFetchableUrl (SSRF guard)", () => {
  it.each([
    ["a public https url", "https://example.com/post"],
    ["a public http url", "http://example.com/post"],
    ["a public host with a port", "https://example.com:8443/x"],
  ])("allows %s", (_label, url) => {
    expect(isFetchableUrl(new URL(url))).toBe(true);
  });

  it.each([
    ["localhost", "http://localhost/"],
    ["localhost with a port", "http://localhost:4200/api/links"],
    ["a .local name", "http://printer.local/"],
    ["a .internal name", "http://metadata.google.internal/"],
    ["a 127.x address", "http://127.0.0.1/"],
    ["a 10.x address", "http://10.0.0.5/"],
    ["a 192.168.x address", "http://192.168.1.1/"],
    ["a 172.16.x address", "http://172.16.0.1/"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["an ipv6 loopback", "http://[::1]/"],
    ["an ipv6 unique-local", "http://[fd00::1]/"],
    ["an ipv6 link-local", "http://[fe80::1]/"],
    ["an ipv4-mapped loopback", "http://[::ffff:127.0.0.1]/"],
  ])("blocks %s", (_label, url) => {
    expect(isFetchableUrl(new URL(url))).toBe(false);
  });

  it.each([
    ["a file url", "file:///etc/passwd"],
    ["an ftp url", "ftp://example.com/x"],
    ["a data url", "data:text/html,<h1>x</h1>"],
  ])("refuses the scheme of %s", (_label, url) => {
    expect(isFetchableUrl(new URL(url))).toBe(false);
  });
});

describe("readAttribute", () => {
  it("reads a double-quoted value", () => {
    expect(readAttribute('<meta content="a.jpg">', "content")).toBe("a.jpg");
  });

  it("reads a single-quoted value", () => {
    expect(readAttribute("<meta content='a.jpg'>", "content")).toBe("a.jpg");
  });

  it("returns null when absent", () => {
    expect(readAttribute("<meta>", "content")).toBeNull();
  });
});

describe("readMetaContent", () => {
  it("finds og:image regardless of attribute order", () => {
    const html = '<meta content="https://cdn.test/a.jpg" property="og:image">';

    expect(readMetaContent(html, ["og:image"])).toBe("https://cdn.test/a.jpg");
  });

  it("matches a name= tag", () => {
    const html = '<meta name="twitter:image" content="https://cdn.test/t.jpg">';

    expect(readMetaContent(html, ["twitter:image"])).toBe("https://cdn.test/t.jpg");
  });

  it("returns null when nothing matches", () => {
    expect(readMetaContent("<meta content='x'>", ["og:image"])).toBeNull();
  });
});

describe("resolveImageUrl", () => {
  it("keeps an absolute url", () => {
    expect(resolveImageUrl("https://cdn.test/a.jpg", "https://example.com/")).toBe(
      "https://cdn.test/a.jpg",
    );
  });

  it("resolves a relative url", () => {
    expect(resolveImageUrl("/a.jpg", "https://example.com/post")).toBe(
      "https://example.com/a.jpg",
    );
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a data url", "data:image/png;base64,AAAA"],
    ["a javascript url", "javascript:alert(1)"],
  ])("returns null for %s", (_label, raw) => {
    expect(resolveImageUrl(raw, "https://example.com/")).toBeNull();
  });
});

describe("pageThumbnail", () => {
  it("returns the og:image", () => {
    const html = '<meta property="og:image" content="https://cdn.test/og.jpg">';

    expect(pageThumbnail(html, "https://example.com/post")).toBe(
      "https://cdn.test/og.jpg",
    );
  });

  it("falls back to the twitter card", () => {
    const html = '<meta name="twitter:image" content="https://cdn.test/tw.jpg">';

    expect(pageThumbnail(html, "https://example.com/")).toBe(
      "https://cdn.test/tw.jpg",
    );
  });

  it("returns null when no image is advertised", () => {
    expect(pageThumbnail("<html></html>", "https://example.com/")).toBeNull();
  });
});

describe("lookupPageThumbnail", () => {
  function htmlResponse(html: string, url: string): Response {
    return {
      ok: true,
      url,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => html,
    } as unknown as Response;
  }

  it("returns the page's og:image", async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse(
        '<meta property="og:image" content="https://cdn.test/og.jpg">',
        "https://example.com/post",
      ),
    ) as unknown as typeof fetch;

    const result = await lookupPageThumbnail("https://example.com/post", {
      fetchImpl,
    });

    expect(result.thumbnail).toBe("https://cdn.test/og.jpg");
  });

  it("returns null for a non-html response", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        url: "https://example.com/file.pdf",
        headers: new Headers({ "content-type": "application/pdf" }),
        text: async () => "",
      }) as unknown as Response,
    ) as unknown as typeof fetch;

    const result = await lookupPageThumbnail("https://example.com/file.pdf", {
      fetchImpl,
    });

    expect(result.thumbnail).toBeNull();
  });

  it("returns null when the fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const result = await lookupPageThumbnail("https://example.com/post", {
      fetchImpl,
    });

    expect(result.thumbnail).toBeNull();
  });

  it("never fetches a blocked url", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await lookupPageThumbnail("http://169.254.169.254/latest", {
      fetchImpl,
    });

    expect(result.thumbnail).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null for an unparseable url", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await lookupPageThumbnail("not a url", { fetchImpl });

    expect(result.thumbnail).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
