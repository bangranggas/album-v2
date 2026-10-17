import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const dbState = vi.hoisted(() => ({
  db: undefined as unknown as Database,
}));

// Keep the real `createDatabase` so the test helper still works, but route the
// handlers at whichever database the current test owns.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => dbState.db };
});

const { GET, OPTIONS, POST } = await import("@/app/api/links/route");

const SECRET = "test-secret-key";
const validPayload = {
  url: "https://example.com/article",
  title: "Example Article",
  thumbnail: "https://example.com/og.jpg",
};

function postRequest(body: string | object, secret?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret !== undefined) headers["x-secret-key"] = secret;

  return new Request("https://app.test/api/links", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(query = "", secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers["x-secret-key"] = secret;

  return new Request(`https://app.test/api/links${query}`, { headers });
}

function emittedEvents(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => {
    const parsed = JSON.parse(String(call[0]));
    return parsed.event as string;
  });
}

describe("/api/links", () => {
  let testDatabase: TestDatabase | undefined;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubEnv("SECRET_KEY", SECRET);
    testDatabase = await createTestDatabase();
    dbState.db = testDatabase.db;
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  describe("POST", () => {
    it("rejects a request with no secret key", async () => {
      const response = await POST(postRequest(validPayload));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "UNAUTHORIZED" },
      });
      expect(emittedEvents(errorSpy)).toContain("api_auth_failed");
    });

    it("rejects a request with the wrong secret key", async () => {
      const response = await POST(postRequest(validPayload, "nope"));

      expect(response.status).toBe(401);
      expect(emittedEvents(errorSpy)).toContain("api_auth_failed");
    });

    it("logs the client ip when auth fails", async () => {
      const request = new Request("https://app.test/api/links", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
        body: JSON.stringify(validPayload),
      });

      await POST(request);

      const parsed = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(parsed.event).toBe("api_auth_failed");
      expect(parsed.ip_address).toBe("203.0.113.7");
    });

    it("rejects a body that is not valid JSON", async () => {
      const response = await POST(postRequest("{not json", SECRET));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_JSON" },
      });
    });

    it("rejects a payload that fails validation", async () => {
      const response = await POST(
        postRequest({ url: "https://example.com", title: "" }, SECRET),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
      expect(body.error.message).toMatch(/title/i);
      expect(emittedEvents(infoSpy)).toContain("api_validation_failed");
    });

    it("saves a valid payload and returns the stored link", async () => {
      const response = await POST(postRequest(validPayload, SECRET));

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data).toMatchObject({
        url: validPayload.url,
        title: validPayload.title,
        thumbnail: validPayload.thumbnail,
        inserted: true,
      });
      expect(typeof body.data.id).toBe("string");
      expect(Number.isNaN(Date.parse(body.data.createdAt))).toBe(false);
    });

    it("emits api_link_saved with the domain and latency", async () => {
      await POST(postRequest(validPayload, SECRET));

      const parsed = JSON.parse(String(infoSpy.mock.calls[0]?.[0]));
      expect(parsed.event).toBe("api_link_saved");
      expect(parsed.url_domain).toBe("example.com");
      expect(typeof parsed.latency_ms).toBe("number");
      expect(parsed.inserted).toBe(true);
    });

    it("updates instead of duplicating when the same url is saved twice", async () => {
      await POST(postRequest(validPayload, SECRET));
      const response = await POST(
        postRequest({ ...validPayload, title: "Second Title" }, SECRET),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.inserted).toBe(false);
      expect(body.data.title).toBe("Second Title");

      const listResponse = await GET(getRequest("", SECRET));
      const listBody = await listResponse.json();
      expect(listBody.data.links).toHaveLength(1);
    });

    it("accepts a payload without a thumbnail", async () => {
      const response = await POST(
        postRequest({ url: validPayload.url, title: validPayload.title }, SECRET),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.thumbnail).toBeNull();
    });

    it("returns 500 without leaking internals when the database fails", async () => {
      testDatabase?.client.close();

      const response = await POST(postRequest(validPayload, SECRET));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
      expect(JSON.stringify(body)).not.toMatch(/closed|libsql|sqlite/i);
      expect(emittedEvents(errorSpy)).toContain("api_error");
    });
  });

  describe("GET", () => {
    it("rejects a request with no secret key", async () => {
      const response = await GET(getRequest());

      expect(response.status).toBe(401);
    });

    it("returns an empty list when nothing is saved", async () => {
      const response = await GET(getRequest("", SECRET));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        data: { links: [] },
      });
    });

    it("returns saved links, newest first", async () => {
      await POST(
        postRequest({ ...validPayload, url: "https://example.com/1" }, SECRET),
      );
      await POST(
        postRequest({ ...validPayload, url: "https://example.com/2" }, SECRET),
      );

      const response = await GET(getRequest("", SECRET));
      const body = await response.json();

      expect(body.data.links.map((link: { url: string }) => link.url)).toEqual([
        "https://example.com/2",
        "https://example.com/1",
      ]);
    });

    it("honours the limit parameter", async () => {
      await POST(
        postRequest({ ...validPayload, url: "https://example.com/1" }, SECRET),
      );
      await POST(
        postRequest({ ...validPayload, url: "https://example.com/2" }, SECRET),
      );

      const response = await GET(getRequest("?limit=1", SECRET));
      const body = await response.json();

      expect(body.data.links).toHaveLength(1);
    });

    it("rejects an out-of-range limit", async () => {
      const response = await GET(getRequest("?limit=0", SECRET));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
    });

    it("returns 500 without leaking internals when the database fails", async () => {
      testDatabase?.client.close();

      const response = await GET(getRequest("", SECRET));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(body)).not.toMatch(/closed|libsql|sqlite/i);
    });
  });

  describe("CORS", () => {
    it("answers a preflight request with the required headers", async () => {
      const response = await OPTIONS();

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toContain(
        "POST",
      );
      expect(response.headers.get("access-control-allow-headers")).toContain(
        "x-secret-key",
      );
    });

    // Without these on error responses the browser hides the status code and the
    // userscript cannot tell 401 from a network failure.
    it("includes CORS headers on a 401 response", async () => {
      const response = await POST(postRequest(validPayload));

      expect(response.status).toBe(401);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("includes CORS headers on a 400 response", async () => {
      const response = await POST(postRequest("{not json", SECRET));

      expect(response.status).toBe(400);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("includes CORS headers on a 200 response", async () => {
      const response = await POST(postRequest(validPayload, SECRET));

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("includes CORS headers on a 500 response", async () => {
      testDatabase?.client.close();

      const response = await POST(postRequest(validPayload, SECRET));

      expect(response.status).toBe(500);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });
  });
});
