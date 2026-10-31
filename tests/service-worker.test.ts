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
  readSavedLinkId(payload: unknown): string | null;
  /** Runs the share-target handler with one multipart-like form. */
  handleShare(fields: Record<string, string>): Promise<ShareHandlerResult>;
}

/**
 * Loads `sw.js` in an isolated context with the few globals a worker expects.
 *
 * The file is a classic script (not an ES module), so its top-level helpers and the
 * `fetch` listener become properties of the vm context. `fetch` is injected per
 * test so the share flow can be driven end to end without a network.
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

  const scope = context as unknown as ServiceWorkerScope;

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

describe("service worker readSavedLinkId", () => {
  const scope = loadServiceWorker((() => {
    throw new Error("unused");
  }) as unknown as typeof fetch);

  it("reads the id out of a save response", () => {
    expect(scope.readSavedLinkId({ data: { link: { id: "abc" } } })).toBe("abc");
  });

  it("returns null for a malformed payload", () => {
    expect(scope.readSavedLinkId(null)).toBeNull();
    expect(scope.readSavedLinkId({})).toBeNull();
    expect(scope.readSavedLinkId({ data: { link: {} } })).toBeNull();
  });
});

describe("service worker share handler", () => {
  /** A fetch stub that records calls and answers save + thumbnail endpoints. */
  function recordingFetch(options: { saveOk?: boolean } = {}) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const saveOk = options.saveOk ?? true;

    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: input,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (input === "/api/dashboard/links") {
        return {
          ok: saveOk,
          status: saveOk ? 200 : 500,
          json: async () => ({ data: { link: { id: "link-1" } } }),
        } as unknown as Response;
      }

      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    return { fetchImpl, calls };
  }

  it("saves the link, asks for a thumbnail, and reports success", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const scope = loadServiceWorker(fetchImpl);

    const result = await scope.handleShare({
      url: "https://example.com/post",
      title: "A Post",
    });

    expect(result).toEqual({ status: 303, location: "/share-target/result?status=ok" });

    expect(calls[0]).toMatchObject({ url: "/api/dashboard/links", method: "POST" });
    expect(calls[0]?.body).toContain("https://example.com/post");

    const thumbnailCall = calls.find((call) => call.url.endsWith("/thumbnail"));
    expect(thumbnailCall).toBeDefined();
    expect(thumbnailCall?.method).toBe("POST");
    expect(thumbnailCall?.url).toBe("/api/dashboard/links/link-1/thumbnail");
  });

  it("still reports success when the thumbnail request fails", async () => {
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

  it("does not ask for a thumbnail when the save failed", async () => {
    const { fetchImpl, calls } = recordingFetch({ saveOk: false });
    const scope = loadServiceWorker(fetchImpl);

    const result = await scope.handleShare({ url: "https://example.com/post" });

    expect(result.location).toBe("/share-target/result?status=error");
    expect(calls.some((call) => call.url.endsWith("/thumbnail"))).toBe(false);
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
    const scope = loadServiceWorker((() => {
      throw new Error("fetch should not have been called");
    }) as unknown as typeof fetch);

    const result = await scope.handleShare({ text: "no link here" });

    expect(result.location).toBe("/share-target/result?status=invalid");
  });

  it("extracts the url out of a mixed text field", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const scope = loadServiceWorker(fetchImpl);

    await scope.handleShare({ text: "Read this https://example.com/article" });

    expect(calls[0]?.body).toContain("https://example.com/article");
  });
});
