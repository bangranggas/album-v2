import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const dbState = vi.hoisted(() => ({
  db: undefined as unknown as Database,
}));

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => dbState.db };
});

const { POST: unlock } = await import("@/app/api/locked/unlock/route");
const { POST: lock } = await import("@/app/api/locked/lock/route");
const { POST: lockDomainRoute } = await import("@/app/api/locked/domains/route");
const { DELETE: unlockDomainRoute } = await import(
  "@/app/api/locked/domains/[domain]/route"
);
const { listLinks, upsertLink } = await import("@/db/links");
const { listLockedDomains } = await import("@/db/locked-domains");
const {
  LOCKED_COOKIE_NAME,
  LOCKED_TTL_MS,
  signLockedSession,
  verifyLockedSession,
} = await import("@/lib/locked-session");
const { SESSION_COOKIE_NAME, signSession, verifySession } = await import(
  "@/lib/session"
);

const PASSWORD = "correct-horse-battery";
const PASSCODE = "open-sesame-please-now";
const SHORT_PASSCODE = "short";

function sessionCookie(secret = PASSWORD): string {
  return `${SESSION_COOKIE_NAME}=${signSession({ now: Date.now(), secret })}`;
}

function lockedCookie(secret = PASSCODE): string {
  return `${LOCKED_COOKIE_NAME}=${signLockedSession({ now: Date.now(), secret })}`;
}

function jsonRequest(
  url: string,
  method: string,
  options: { cookies?: string[]; body?: unknown; raw?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookies !== undefined && options.cookies.length > 0) {
    headers.cookie = options.cookies.join("; ");
  }

  return new Request(url, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
}

function cookieValue(response: Response, name: string): string | null {
  const header = response.headers.get("set-cookie");
  if (header === null) return null;

  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header);
  return match ? (match[1] ?? null) : null;
}

function emittedEvents(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => {
    const parsed = JSON.parse(String(call[0]));
    return parsed.event as string;
  });
}

describe("locked area routes", () => {
  let testDatabase: TestDatabase | undefined;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);
    vi.stubEnv("LOCKED_PASSCODE", PASSCODE);
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

  describe("POST /api/locked/unlock", () => {
    function request(body: unknown, cookies = [sessionCookie()]) {
      return jsonRequest("https://app.test/api/locked/unlock", "POST", {
        cookies,
        body,
      });
    }

    it("issues a one hour locked cookie for the right passcode", async () => {
      const response = await unlock(request({ passcode: PASSCODE }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        data: { unlocked: true },
      });

      const token = cookieValue(response, LOCKED_COOKIE_NAME);
      expect(token).not.toBeNull();
      expect(
        verifyLockedSession(token, { now: Date.now(), secret: PASSCODE }).valid,
      ).toBe(true);

      const header = response.headers.get("set-cookie") ?? "";
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Path=\//i);
      expect(header).toMatch(
        new RegExp(`Max-Age=${Math.floor(LOCKED_TTL_MS / 1000)}`, "i"),
      );

      expect(emittedEvents(infoSpy)).toContain("locked_unlock_succeeded");
    });

    it("does not hand out a dashboard session", async () => {
      const response = await unlock(request({ passcode: PASSCODE }));
      const token = cookieValue(response, LOCKED_COOKIE_NAME);

      expect(verifySession(token, { now: Date.now(), secret: PASSCODE }).valid).toBe(
        false,
      );
    });

    it("rejects a wrong passcode without a cookie", async () => {
      const response = await unlock(request({ passcode: "wrong-passcode-here" }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "UNAUTHORIZED" },
      });
      expect(cookieValue(response, LOCKED_COOKIE_NAME)).toBeNull();
      expect(emittedEvents(errorSpy)).toContain("locked_unlock_failed");
    });

    it("rejects a missing passcode as a validation error", async () => {
      const response = await unlock(request({}));

      expect(response.status).toBe(400);
      expect(cookieValue(response, LOCKED_COOKIE_NAME)).toBeNull();
    });

    it("rejects a body that is not valid JSON", async () => {
      const response = await unlock(
        jsonRequest("https://app.test/api/locked/unlock", "POST", {
          cookies: [sessionCookie()],
          raw: "nope",
        }),
      );

      expect(response.status).toBe(400);
    });

    it("requires the dashboard session as well", async () => {
      const response = await unlock(request({ passcode: PASSCODE }, []));

      expect(response.status).toBe(401);
      expect(cookieValue(response, LOCKED_COOKIE_NAME)).toBeNull();
    });

    it("reports 503 when no passcode is configured", async () => {
      vi.stubEnv("LOCKED_PASSCODE", "");

      const response = await unlock(request({ passcode: PASSCODE }));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "UNCONFIGURED" },
      });
    });

    it("accepts a short configured passcode", async () => {
      vi.stubEnv("LOCKED_PASSCODE", SHORT_PASSCODE);

      const response = await unlock(request({ passcode: SHORT_PASSCODE }));

      expect(response.status).toBe(200);
      expect(cookieValue(response, LOCKED_COOKIE_NAME)).not.toBeNull();
    });
  });

  describe("POST /api/locked/lock", () => {
    it("clears the locked cookie", async () => {
      const response = await lock(
        jsonRequest("https://app.test/api/locked/lock", "POST", {
          cookies: [sessionCookie(), lockedCookie()],
        }),
      );

      expect(response.status).toBe(200);
      expect(cookieValue(response, LOCKED_COOKIE_NAME)).toBe("");

      const header = response.headers.get("set-cookie") ?? "";
      expect(header).toMatch(/Max-Age=0/i);
      expect(header).toMatch(/HttpOnly/i);
    });

    it("refuses a visitor without the locked cookie", async () => {
      const response = await lock(
        jsonRequest("https://app.test/api/locked/lock", "POST", {
          cookies: [sessionCookie()],
        }),
      );

      expect(response.status).toBe(401);
    });

    it("refuses a visitor without a session", async () => {
      const response = await lock(
        jsonRequest("https://app.test/api/locked/lock", "POST", {
          cookies: [lockedCookie()],
        }),
      );

      expect(response.status).toBe(401);
    });

    it("refuses a locked cookie signed with another secret", async () => {
      const response = await lock(
        jsonRequest("https://app.test/api/locked/lock", "POST", {
          cookies: [sessionCookie(), lockedCookie("another-passcode-here")],
        }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/locked/domains", () => {
    function request(body: unknown, cookies = [sessionCookie(), lockedCookie()]) {
      return jsonRequest("https://app.test/api/locked/domains", "POST", {
        cookies,
        body,
      });
    }

    it("locks a domain and hides its links", async () => {
      await upsertLink(testDatabase!.db, {
        url: "https://example.com/a",
        title: "A",
        thumbnail: null,
        domain: "example.com",
      });

      const response = await lockDomainRoute(request({ domain: "example.com" }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        data: { domain: "example.com", created: true },
      });
      expect(await listLinks(testDatabase!.db)).toEqual([]);
      expect(emittedEvents(infoSpy)).toContain("locked_domain_locked");
    });

    it("normalises whatever was typed", async () => {
      const response = await lockDomainRoute(
        request({ domain: "  HTTPS://Example.COM/some/path  " }),
      );

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { domain: "example.com" },
      });
    });

    it("is idempotent", async () => {
      await lockDomainRoute(request({ domain: "example.com" }));
      const second = await lockDomainRoute(request({ domain: "example.com" }));

      await expect(second.json()).resolves.toEqual({
        ok: true,
        data: { domain: "example.com", created: false },
      });
      expect(await listLockedDomains(testDatabase!.db)).toHaveLength(1);
    });

    it("rejects a value that is not a domain", async () => {
      const response = await lockDomainRoute(request({ domain: "not a domain" }));

      expect(response.status).toBe(400);
      expect(await listLockedDomains(testDatabase!.db)).toEqual([]);
    });

    it("requires the locked cookie, not just the dashboard session", async () => {
      const response = await lockDomainRoute(
        request({ domain: "example.com" }, [sessionCookie()]),
      );

      expect(response.status).toBe(401);
      expect(await listLockedDomains(testDatabase!.db)).toEqual([]);
    });

    it("requires a dashboard session", async () => {
      const response = await lockDomainRoute(
        request({ domain: "example.com" }, [lockedCookie()]),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/locked/domains/:domain", () => {
    function request(domain: string, cookies = [sessionCookie(), lockedCookie()]) {
      return jsonRequest(
        `https://app.test/api/locked/domains/${domain}`,
        "DELETE",
        { cookies },
      );
    }

    it("unlocks a domain, bringing its links back", async () => {
      const { db } = testDatabase!;
      await upsertLink(db, {
        url: "https://example.com/a",
        title: "A",
        thumbnail: null,
        domain: "example.com",
      });
      await lockDomainRoute(
        jsonRequest("https://app.test/api/locked/domains", "POST", {
          cookies: [sessionCookie(), lockedCookie()],
          body: { domain: "example.com" },
        }),
      );

      const response = await unlockDomainRoute(request("example.com"), {
        params: Promise.resolve({ domain: "example.com" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        data: { removed: true },
      });
      expect(await listLinks(db)).toHaveLength(1);
      expect(emittedEvents(infoSpy)).toContain("locked_domain_unlocked");
    });

    it("decodes an escaped path segment", async () => {
      const { db } = testDatabase!;
      await lockDomainRoute(
        jsonRequest("https://app.test/api/locked/domains", "POST", {
          cookies: [sessionCookie(), lockedCookie()],
          body: { domain: "example.com:8443" },
        }),
      );

      const response = await unlockDomainRoute(request("example.com%3A8443"), {
        params: Promise.resolve({ domain: "example.com%3A8443" }),
      });

      expect(response.status).toBe(200);
      expect(await listLockedDomains(db)).toEqual([]);
    });

    it("reports 404 for a domain that is not locked", async () => {
      const response = await unlockDomainRoute(request("example.com"), {
        params: Promise.resolve({ domain: "example.com" }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    });

    it("requires the locked cookie", async () => {
      const response = await unlockDomainRoute(
        request("example.com", [sessionCookie()]),
        { params: Promise.resolve({ domain: "example.com" }) },
      );

      expect(response.status).toBe(401);
    });
  });
});
