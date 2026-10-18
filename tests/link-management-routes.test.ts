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

const { POST } = await import("@/app/api/dashboard/links/route");
const { DELETE, PATCH } = await import("@/app/api/dashboard/links/[id]/route");
const { listLinks, upsertLink } = await import("@/db/links");
const { addLinkToAlbum, createAlbum, listAlbums } = await import("@/db/albums");
const { lockDomain } = await import("@/db/locked-domains");
const { SESSION_COOKIE_NAME, signSession } = await import("@/lib/session");

const PASSWORD = "correct-horse-battery";
const SESSION = "9999999999999.deadbeef";
const SECRET_KEY = "test-secret-key";

const created = {
  url: "https://example.com/article",
  title: "Example Article",
  thumbnail: "https://example.com/og.jpg",
};

function validSessionCookie(secret = PASSWORD): string {
  return `${SESSION_COOKIE_NAME}=${signSession({ now: Date.now(), secret })}`;
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

function emittedEvents(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => {
    const parsed = JSON.parse(String(call[0]));
    return parsed.event as string;
  });
}

describe("dashboard link routes", () => {
  let testDatabase: TestDatabase | undefined;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);
    vi.stubEnv("SECRET_KEY", SECRET_KEY);
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

  describe("POST /api/dashboard/links", () => {
    it("adds a link for a signed-in visitor", async () => {
      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          body: created,
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: {
          inserted: true,
          link: {
            url: created.url,
            title: created.title,
            domain: "example.com",
            isFavorite: false,
          },
        },
      });
      expect(await listLinks(testDatabase!.db)).toHaveLength(1);
      expect(emittedEvents(infoSpy)).toContain("dashboard_link_created");
    });

    it("derives the title when only a url is given", async () => {
      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          body: { url: "https://example.com/article" },
        }),
      );

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { link: { title: "example.com/article" } },
      });
    });

    it("updates the existing row when the url is already saved", async () => {
      await upsertLink(testDatabase!.db, {
        url: created.url,
        title: "Old title",
        thumbnail: null,
        domain: "example.com",
      });

      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          body: created,
        }),
      );

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { inserted: false, link: { title: created.title } },
      });
      expect(await listLinks(testDatabase!.db)).toHaveLength(1);
    });

    it("can add a link that lands in a locked domain without exposing it", async () => {
      const { db } = testDatabase!;
      await lockDomain(db, "example.com");

      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          body: created,
        }),
      );

      expect(response.status).toBe(200);
      expect(await listLinks(db)).toEqual([]);
      expect(await listLinks(db, { scope: "locked" })).toHaveLength(1);
    });

    it("refuses a visitor without a session", async () => {
      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", { body: created }),
      );

      expect(response.status).toBe(401);
      expect(await listLinks(testDatabase!.db)).toEqual([]);
    });

    it("refuses a forged session cookie", async () => {
      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [`${SESSION_COOKIE_NAME}=${SESSION}`],
          body: created,
        }),
      );

      expect(response.status).toBe(401);
    });

    it("refuses a session signed with another secret", async () => {
      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie("some-other-password")],
          body: created,
        }),
      );

      expect(response.status).toBe(401);
    });

    it("refuses a userscript secret key, which is not a session", async () => {
      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          body: created,
          cookies: [`${SESSION_COOKIE_NAME}=${SECRET_KEY}`],
        }),
      );

      expect(response.status).toBe(401);
    });

    it("reports 503 when the dashboard password is not configured", async () => {
      vi.stubEnv("DASHBOARD_PASSWORD", "");

      const response = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          body: created,
        }),
      );

      expect(response.status).toBe(503);
    });

    it("rejects invalid JSON and invalid payloads", async () => {
      const badJson = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          raw: "not json",
        }),
      );
      expect(badJson.status).toBe(400);

      const invalid = await POST(
        jsonRequest("https://app.test/api/dashboard/links", "POST", {
          cookies: [validSessionCookie()],
          body: { url: "/article", title: "Relative" },
        }),
      );
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
    });
  });

  describe("PATCH /api/dashboard/links/:id", () => {
    async function seededId(): Promise<string> {
      const saved = await upsertLink(testDatabase!.db, {
        url: created.url,
        title: created.title,
        thumbnail: created.thumbnail,
        domain: "example.com",
      });

      return saved.link.id;
    }

    function patchRequest(id: string, body: unknown, cookies = [validSessionCookie()]) {
      return jsonRequest(`https://app.test/api/dashboard/links/${id}`, "PATCH", {
        cookies,
        body,
      });
    }

    it("edits the title", async () => {
      const id = await seededId();

      const response = await PATCH(patchRequest(id, { title: "New title" }), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { link: { id, title: "New title" } },
      });
      expect(emittedEvents(infoSpy)).toContain("dashboard_link_updated");
    });

    it("moves the link when the url changes, deriving the new domain", async () => {
      const id = await seededId();

      const response = await PATCH(
        patchRequest(id, { url: "https://other.example/moved" }),
        { params: Promise.resolve({ id }) },
      );

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { link: { url: "https://other.example/moved", domain: "other.example" } },
      });
    });

    it("toggles the favorite flag", async () => {
      const id = await seededId();

      const response = await PATCH(patchRequest(id, { isFavorite: true }), {
        params: Promise.resolve({ id }),
      });

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { link: { isFavorite: true } },
      });
    });

    it("clears the thumbnail", async () => {
      const id = await seededId();

      const response = await PATCH(patchRequest(id, { thumbnail: null }), {
        params: Promise.resolve({ id }),
      });

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { link: { thumbnail: null } },
      });
    });

    it("ignores a domain the client tries to set", async () => {
      const id = await seededId();

      const response = await PATCH(
        patchRequest(id, { url: "https://good.example/x", domain: "evil.example" }),
        { params: Promise.resolve({ id }) },
      );

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { link: { domain: "good.example" } },
      });
    });

    it("edits a link that lives in a locked domain", async () => {
      const id = await seededId();
      await lockDomain(testDatabase!.db, "example.com");

      const response = await PATCH(patchRequest(id, { title: "Still editable" }), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(200);
    });

    it("reports 404 for an unknown id", async () => {
      const response = await PATCH(patchRequest("missing-id", { title: "x" }), {
        params: Promise.resolve({ id: "missing-id" }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    });

    it("reports 409 when another link already owns the url", async () => {
      const first = await upsertLink(testDatabase!.db, {
        url: "https://example.com/taken",
        title: "First",
        thumbnail: null,
        domain: "example.com",
      });
      const id = await seededId();

      const response = await PATCH(patchRequest(id, { url: first.link.url }), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(emittedEvents(infoSpy)).toContain("dashboard_link_conflict");
    });

    it("rejects a patch that would change nothing", async () => {
      const id = await seededId();

      const response = await PATCH(patchRequest(id, {}), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
    });

    it("refuses a visitor without a session", async () => {
      const id = await seededId();

      const response = await PATCH(patchRequest(id, { title: "Nope" }, []), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(401);
      expect(await listLinks(testDatabase!.db)).toHaveLength(1);
    });
  });

  describe("DELETE /api/dashboard/links/:id", () => {
    it("deletes the link", async () => {
      const saved = await upsertLink(testDatabase!.db, {
        url: created.url,
        title: created.title,
        thumbnail: null,
        domain: "example.com",
      });

      const response = await DELETE(
        jsonRequest(`https://app.test/api/dashboard/links/${saved.link.id}`, "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: saved.link.id }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, data: { deleted: true } });
      expect(await listLinks(testDatabase!.db)).toEqual([]);
      expect(emittedEvents(infoSpy)).toContain("dashboard_link_deleted");
    });

    it("takes the deleted link out of its albums", async () => {
      const saved = await upsertLink(testDatabase!.db, {
        url: created.url,
        title: created.title,
        thumbnail: null,
        domain: "example.com",
      });
      const album = await createAlbum(testDatabase!.db, {
        name: "Anime",
        nameKey: "anime",
      });
      if (!album.ok) throw new Error("setup failed");
      await addLinkToAlbum(testDatabase!.db, album.album.id, saved.link.id);

      await DELETE(
        jsonRequest(`https://app.test/api/dashboard/links/${saved.link.id}`, "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: saved.link.id }) },
      );

      // No orphan membership: the album stops counting and stops showing a cover.
      expect((await listAlbums(testDatabase!.db))[0]?.linkCount).toBe(0);
    });

    it("deletes a link inside a locked domain", async () => {
      const saved = await upsertLink(testDatabase!.db, {
        url: created.url,
        title: created.title,
        thumbnail: null,
        domain: "example.com",
      });
      await lockDomain(testDatabase!.db, "example.com");

      const response = await DELETE(
        jsonRequest(`https://app.test/api/dashboard/links/${saved.link.id}`, "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: saved.link.id }) },
      );

      expect(response.status).toBe(200);
      expect(await listLinks(testDatabase!.db, { scope: "locked" })).toEqual([]);
    });

    it("reports 404 for an unknown id, and for a second delete", async () => {
      const saved = await upsertLink(testDatabase!.db, {
        url: created.url,
        title: created.title,
        thumbnail: null,
        domain: "example.com",
      });
      const request = () =>
        jsonRequest(`https://app.test/api/dashboard/links/${saved.link.id}`, "DELETE", {
          cookies: [validSessionCookie()],
        });

      expect(
        (await DELETE(request(), { params: Promise.resolve({ id: saved.link.id }) })).status,
      ).toBe(200);
      expect(
        (await DELETE(request(), { params: Promise.resolve({ id: saved.link.id }) })).status,
      ).toBe(404);
    });

    it("refuses a visitor without a session", async () => {
      const saved = await upsertLink(testDatabase!.db, {
        url: created.url,
        title: created.title,
        thumbnail: null,
        domain: "example.com",
      });

      const response = await DELETE(
        jsonRequest(`https://app.test/api/dashboard/links/${saved.link.id}`, "DELETE"),
        { params: Promise.resolve({ id: saved.link.id }) },
      );

      expect(response.status).toBe(401);
      expect(await listLinks(testDatabase!.db)).toHaveLength(1);
    });
  });
});
