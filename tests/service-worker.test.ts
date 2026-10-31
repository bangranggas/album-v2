import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const SW_PATH = fileURLToPath(new URL("../public/sw.js", import.meta.url));

interface ShareHandlerResult {
  status: number;
  location: string | null;
}

interface ServiceWorkerScope {
  pageThumbnail(html: string, pageUrl: string): string | null;
  readMetaContent(html: string, keys: string[]): string | null;
  readAttribute(tag: string, name: string): string | null;
  resolveImageUrl(raw: string | null, base: string): string | null;
  fetchPageThumbnail(url: string): Promise<string | null>;
  /** Runs the share-target handler with one multipart-like form. */
  handleShare(fields: Record<string, string>): Promise<ShareHandlerResult>;
}

/**
 * Loads `sw.js` in an isolated context with the few globals a worker expects.
 *
 * The file is a classic script (not an ES module), so every top-level helper is a
 * property of the vm context — which is how the pure parsing helpers are reached
 * here. `fetch` is injected per test rather than stubbed globally, so the share
 * handler can be driven end to end without a network.
 */
function loadServiceWorker(fetchImpl: typeof fetch): ServiceWorkerScope {
  const code = readFileSync(SW_PATH, "utf8");

  const listeners = new Map<string, (event: unknown) => void>();

  const selfStub = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };

  const context = vm.createContext({
    self: selfStub,
    fetch: fetchImpl,
    Response: {
      redirect: (location: string, status: number) => ({ location, status }),
    },
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  });

  vm.runInContext(code, context);

  const scope = context as unknown as ServiceWorkerScope & {
    readSavedLinkId(payload: unknown): string | null;
  };

  scope.handleShare = async (fields: Record<string, string>) => {
    const fetchListener = listeners.get("fetch");
    if (fetchListener === undefined) {
      throw new Error("the service worker registered no fetch listener");
    }

    const form = new Map<string, string>(Object.entries(fields));

    let responded: unknown;
    const event = {
      request: {
        url: "https://app.test/share-target",
        method: "POST",
        formData: async () => ({
          get: (name: string) => form.get(name) ?? null,
        }),
      },
      respondWith: (value: Promise<unknown>) => {
        responded = value;
      },
    };

    fetchListener(event);

    const response = (await responded) as {
      status: number;
      location?: string;
    };

    return { status: response.status, location: response.location ?? null };
  };

  return scope;
}

/** A fetch stand-in that fails the test if the worker actually calls it. */
const unusedFetch = (() => {
  throw new Error("fetch should not have been called");
}) as unknown as typeof fetch;

describe("service worker attribute parsing", () => {
  const scope = loadServiceWorker(unusedFetch);

  it("reads a double-quoted attribute", () => {
    expect(scope.readAttribute('<meta content="a.jpg">', "content")).toBe(
      "a.jpg",
    );
  });

  it("reads a single-quoted attribute", () => {
    expect(scope.readAttribute("<meta content='a.jpg'>", "content")).toBe(
      "a.jpg",
    );
  });

  it("tolerates whitespace around the equals sign", () => {
    expect(scope.readAttribute('<meta content = "a.jpg">', "content")).toBe(
      "a.jpg",
    );
  });

  it("returns null when the attribute is absent", () => {
    expect(scope.readAttribute("<meta>", "content")).toBeNull();
  });
});

describe("service worker meta lookup", () => {
  const scope = loadServiceWorker(unusedFetch);

  it("finds og:image regardless of attribute order", () => {
    const html = '<meta content="https://cdn.test/a.jpg" property="og:image">';

    expect(scope.readMetaContent(html, ["og:image"])).toBe(
      "https://cdn.test/a.jpg",
    );
  });

  it("matches a name= tag as well as property=", () => {
    const html = '<meta name="twitter:image" content="https://cdn.test/t.jpg">';

    expect(scope.readMetaContent(html, ["twitter:image"])).toBe(
      "https://cdn.test/t.jpg",
    );
  });

  it("returns the first image among the keys that matches", () => {
    const html =
      '<meta property="og:image" content="https://cdn.test/og.jpg">' +
      '<meta name="twitter:image" content="https://cdn.test/tw.jpg">';

    expect(scope.readMetaContent(html, ["og:image", "twitter:image"])).toBe(
      "https://cdn.test/og.jpg",
    );
  });

  it("returns null when nothing matches", () => {
    expect(scope.readMetaContent("<meta content='x'>", ["og:image"])).toBeNull();
  });
});

describe("service worker thumbnail extraction", () => {
  const scope = loadServiceWorker(unusedFetch);

  it("returns an absolute og:image", () => {
    const html =
      '<meta property="og:image" content="https://cdn.test/og.jpg">';

    expect(scope.pageThumbnail(html, "https://example.com/post")).toBe(
      "https://cdn.test/og.jpg",
    );
  });

  it("resolves a relative image against the page url", () => {
    const html = '<meta property="og:image" content="/img/og.jpg">';

    expect(scope.pageThumbnail(html, "https://example.com/post")).toBe(
      "https://example.com/img/og.jpg",
    );
  });

  it("falls back to the twitter card", () => {
    const html =
      '<meta name="twitter:image" content="https://cdn.test/tw.jpg">';

    expect(scope.pageThumbnail(html, "https://example.com/")).toBe(
      "https://cdn.test/tw.jpg",
    );
  });

  it("returns null for a page with no image metadata", () => {
    expect(scope.pageThumbnail("<html></html>", "https://example.com/")).toBeNull();
  });

  it("refuses a data url", () => {
    const html =
      '<meta property="og:image" content="data:image/png;base64,AAAA">';

    expect(scope.pageThumbnail(html, "https://example.com/")).toBeNull();
  });
});

describe("service worker page fetch", () => {
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
    const scope = loadServiceWorker(fetchImpl);

    await expect(
      scope.fetchPageThumbnail("https://example.com/post"),
    ).resolves.toBe("https://cdn.test/og.jpg");
  });

  it("returns null when the fetch rejects (the common CORS case)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const scope = loadServiceWorker(fetchImpl);

    await expect(
      scope.fetchPageThumbnail("https://example.com/post"),
    ).resolves.toBeNull();
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
    const scope = loadServiceWorker(fetchImpl);

    await expect(
      scope.fetchPageThumbnail("https://example.com/file.pdf"),
    ).resolves.toBeNull();
  });

  it("requests the page without credentials", async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse("<html></html>", "https://example.com/"),
    ) as unknown as typeof fetch;
    const scope = loadServiceWorker(fetchImpl);

    await scope.fetchPageThumbnail("https://example.com/");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ credentials: "omit" }),
    );
  });
});

describe("service worker share handler", () => {
  it("saves the link, patches its thumbnail, and reports success", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];

    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: input,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (input === "/api/dashboard/links") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { link: { id: "link-1" } } }),
        } as unknown as Response;
      }

      if (input.startsWith("/api/dashboard/links/link-1")) {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }

      // The shared page itself.
      return {
        ok: true,
        status: 200,
        url: "https://example.com/post",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () =>
          '<meta property="og:image" content="https://cdn.test/og.jpg">',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const scope = loadServiceWorker(fetchImpl);

    const result = await scope.handleShare({
      url: "https://example.com/post",
      title: "A Post",
    });

    expect(result).toEqual({ status: 303, location: "/share-target/result?status=ok" });

    expect(calls[0]).toMatchObject({ url: "/api/dashboard/links", method: "POST" });
    expect(calls[0]?.body).toContain("https://example.com/post");

    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch?.body).toContain("https://cdn.test/og.jpg");
  });

  it("still reports success when the thumbnail lookup fails", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === "/api/dashboard/links") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { link: { id: "link-2" } } }),
        } as unknown as Response;
      }

      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const scope = loadServiceWorker(fetchImpl);

    const result = await scope.handleShare({
      url: "https://example.com/post",
      title: "A Post",
    });

    expect(result).toEqual({ status: 303, location: "/share-target/result?status=ok" });
  });

  it("redirects to login on a 401 from the save endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
    })) as unknown as typeof fetch;

    const scope = loadServiceWorker(fetchImpl);

    const result = await scope.handleShare({ url: "https://example.com/post" });

    expect(result.status).toBe(303);
    expect(result.location).toContain("/login?next=");
  });

  it("reports an invalid share when no url is present", async () => {
    const scope = loadServiceWorker(unusedFetch);

    const result = await scope.handleShare({ text: "no link here" });

    expect(result.location).toBe("/share-target/result?status=invalid");
  });

  it("extracts the url out of a mixed text field", async () => {
    const saved: string[] = [];

    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dashboard/links") {
        saved.push(String(init?.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { link: { id: "link-3" } } }),
        } as unknown as Response;
      }
      throw new TypeError("no thumbnail");
    }) as unknown as typeof fetch;

    const scope = loadServiceWorker(fetchImpl);

    await scope.handleShare({ text: "Read this https://example.com/article" });

    expect(saved[0]).toContain("https://example.com/article");
  });
});
