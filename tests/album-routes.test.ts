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

const { POST: createAlbumRoute } = await import(
  "@/app/api/dashboard/albums/route"
);
const { DELETE: deleteAlbumRoute, PATCH: renameAlbumRoute } = await import(
  "@/app/api/dashboard/albums/[id]/route"
);
const { POST: addMemberRoute } = await import(
  "@/app/api/dashboard/links/[id]/albums/route"
);
const { POST: bulkAddRoute } = await import(
  "@/app/api/dashboard/albums/[id]/links/route"
);
const { DELETE: removeMemberRoute } = await import(
  "@/app/api/dashboard/links/[id]/albums/[albumId]/route"
);
const { addLinkToAlbum, createAlbum, listAlbums } = await import("@/db/albums");
const { upsertLink } = await import("@/db/links");
const { albumLinks } = await import("@/db/schema");
const { SESSION_COOKIE_NAME, signSession } = await import("@/lib/session");

const PASSWORD = "correct-horse-battery";
const SECRET_KEY = "test-secret-key";

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
    body:
      options.raw ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
}

const ALBUM_ID_CONTEXT = { params: Promise.resolve({ id: "album-id" }) };

/** A database holding one link and one album, plus the ids to address them. */
async function seed(): Promise<{ linkId: string; albumId: string }> {
  const db = dbState.db;
  const saved = await upsertLink(db, {
    url: "https://example.com/article",
    title: "Example Article",
    thumbnail: null,
    domain: "example.com",
  });
  const album = await createAlbum(db, { name: "Anime", nameKey: "anime" });
  if (!album.ok) throw new Error("setup failed");

  return { linkId: saved.link.id, albumId: album.album.id };
}

describe("dashboard album routes", () => {
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

  describe("POST /api/dashboard/albums", () => {
    it("creates an album for a signed-in visitor", async () => {
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "  Anime  " },
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { album: { name: "Anime" } },
      });
      expect(await listAlbums(testDatabase!.db)).toHaveLength(1);
    });

    it("never exposes the uniqueness key", async () => {
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "Anime" },
        }),
      );

      const body = (await response.json()) as {
        data: { album: Record<string, unknown> };
      };
      expect(body.data.album).not.toHaveProperty("nameKey");
    });

    it("refuses a name another album already has, whatever its case", async () => {
      await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "Anime" },
        }),
      );
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "anime" },
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "CONFLICT" },
      });
      expect(await listAlbums(testDatabase!.db)).toHaveLength(1);
    });

    it.each([
      ["a missing name", {}],
      ["a blank name", { name: "   " }],
    ])("rejects %s with a 400", async (_label, body) => {
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    });

    it("rejects a body that is not JSON", async () => {
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          raw: "not json",
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_JSON" },
      });
    });

    it("refuses a visitor with no session", async () => {
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          body: { name: "Anime" },
        }),
      );

      expect(response.status).toBe(401);
      expect(await listAlbums(testDatabase!.db)).toEqual([]);
    });

    it("refuses a session signed with the wrong secret", async () => {
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie("some-other-password")],
          body: { name: "Anime" },
        }),
      );

      expect(response.status).toBe(401);
    });

    it("answers 503 when the dashboard password is not set", async () => {
      vi.stubEnv("DASHBOARD_PASSWORD", "");
      const response = await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "Anime" },
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "UNCONFIGURED" },
      });
    });
  });

  describe("PATCH /api/dashboard/albums/[id]", () => {
    it("renames an album", async () => {
      const { albumId } = await seed();
      const context = { params: Promise.resolve({ id: albumId }) };

      const response = await renameAlbumRoute(
        jsonRequest(`https://app.test/api/dashboard/albums/${albumId}`, "PATCH", {
          cookies: [validSessionCookie()],
          body: { name: "Animation" },
        }),
        context,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { album: { id: albumId, name: "Animation" } },
      });
    });

    it("accepts a change of case on the album's own name", async () => {
      const { albumId } = await seed();

      const response = await renameAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x", "PATCH", {
          cookies: [validSessionCookie()],
          body: { name: "ANIME" },
        }),
        { params: Promise.resolve({ id: albumId }) },
      );

      expect(response.status).toBe(200);
    });

    it("refuses a name another album owns", async () => {
      const { albumId } = await seed();
      const other = await createAlbum(dbState.db, {
        name: "Movies",
        nameKey: "movies",
      });

      const response = await renameAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x", "PATCH", {
          cookies: [validSessionCookie()],
          body: { name: "movies" },
        }),
        { params: Promise.resolve({ id: albumId }) },
      );

      expect(other.ok).toBe(true);
      expect(response.status).toBe(409);
    });

    it("answers 404 for an album that is gone", async () => {
      const response = await renameAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/gone", "PATCH", {
          cookies: [validSessionCookie()],
          body: { name: "Anime" },
        }),
        { params: Promise.resolve({ id: "gone" }) },
      );

      expect(response.status).toBe(404);
    });

    it("rejects a blank name", async () => {
      const { albumId } = await seed();

      const response = await renameAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x", "PATCH", {
          cookies: [validSessionCookie()],
          body: { name: "  " },
        }),
        { params: Promise.resolve({ id: albumId }) },
      );

      expect(response.status).toBe(400);
    });

    it("refuses a visitor with no session", async () => {
      const { albumId } = await seed();

      const response = await renameAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x", "PATCH", {
          body: { name: "Animation" },
        }),
        { params: Promise.resolve({ id: albumId }) },
      );

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/dashboard/albums/[id]", () => {
    it("deletes the album without deleting its links", async () => {
      const { linkId, albumId } = await seed();
      await addLinkToAlbum(dbState.db, albumId, linkId);

      const response = await deleteAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x", "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: albumId }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { deleted: true },
      });
      expect(await listAlbums(dbState.db)).toEqual([]);
      expect(await listAlbums(dbState.db, { scope: "all" })).toEqual([]);
    });

    it("answers 404 for an album that is already gone", async () => {
      const response = await deleteAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/gone", "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: "gone" }) },
      );

      expect(response.status).toBe(404);
    });

    it("refuses a visitor with no session", async () => {
      const response = await deleteAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x", "DELETE", {}),
        ALBUM_ID_CONTEXT,
      );

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/dashboard/links/[id]/albums", () => {
    it("adds the link to the album", async () => {
      const { linkId, albumId } = await seed();

      const response = await addMemberRoute(
        jsonRequest(`https://app.test/api/dashboard/links/${linkId}/albums`, "POST", {
          cookies: [validSessionCookie()],
          body: { albumId },
        }),
        { params: Promise.resolve({ id: linkId }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { added: true },
      });
      const albums = await listAlbums(dbState.db);
      expect(albums[0]?.linkCount).toBe(1);
    });

    it("reports a repeat as not added, without failing", async () => {
      const { linkId, albumId } = await seed();
      await addLinkToAlbum(dbState.db, albumId, linkId);

      const response = await addMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { albumId },
        }),
        { params: Promise.resolve({ id: linkId }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { added: false },
      });
    });

    it("answers 404 for an unknown album", async () => {
      const { linkId } = await seed();

      const response = await addMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { albumId: "gone" },
        }),
        { params: Promise.resolve({ id: linkId }) },
      );

      expect(response.status).toBe(404);
    });

    it("answers 404 for an unknown link", async () => {
      const { albumId } = await seed();

      const response = await addMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/gone/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { albumId },
        }),
        { params: Promise.resolve({ id: "gone" }) },
      );

      expect(response.status).toBe(404);
    });

    it("rejects a body without an album id", async () => {
      const { linkId } = await seed();

      const response = await addMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums", "POST", {
          cookies: [validSessionCookie()],
          body: {},
        }),
        { params: Promise.resolve({ id: linkId }) },
      );

      expect(response.status).toBe(400);
    });

    it("refuses a visitor with no session", async () => {
      const { linkId, albumId } = await seed();

      const response = await addMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums", "POST", {
          body: { albumId },
        }),
        { params: Promise.resolve({ id: linkId }) },
      );

      expect(response.status).toBe(401);
      expect((await listAlbums(dbState.db))[0]?.linkCount).toBe(0);
    });
  });

  describe("DELETE /api/dashboard/links/[id]/albums/[albumId]", () => {
    it("removes the membership but keeps the link", async () => {
      const { linkId, albumId } = await seed();
      await addLinkToAlbum(dbState.db, albumId, linkId);

      const response = await removeMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums/y", "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: linkId, albumId }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { removed: true },
      });
      expect((await listAlbums(dbState.db))[0]?.linkCount).toBe(0);
    });

    it("answers 404 when the pair never existed", async () => {
      const { linkId, albumId } = await seed();

      const response = await removeMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums/y", "DELETE", {
          cookies: [validSessionCookie()],
        }),
        { params: Promise.resolve({ id: linkId, albumId }) },
      );

      expect(response.status).toBe(404);
    });

    it("refuses a visitor with no session", async () => {
      const { linkId, albumId } = await seed();
      await addLinkToAlbum(dbState.db, albumId, linkId);

      const response = await removeMemberRoute(
        jsonRequest("https://app.test/api/dashboard/links/x/albums/y", "DELETE", {}),
        { params: Promise.resolve({ id: linkId, albumId }) },
      );

      expect(response.status).toBe(401);
      expect((await listAlbums(dbState.db))[0]?.linkCount).toBe(1);
    });
  });

  describe("POST /api/dashboard/albums/[id]/links", () => {
    const context = (id: string) => ({ params: Promise.resolve({ id }) });

    /** Saves `count` links and returns their ids, in insertion order. */
    async function seedLinks(count: number): Promise<string[]> {
      const ids: string[] = [];

      for (let index = 0; index < count; index += 1) {
        const saved = await upsertLink(dbState.db, {
          url: `https://example.com/article-${index}`,
          title: `Article ${index}`,
          thumbnail: null,
          domain: "example.com",
        });
        ids.push(saved.link.id);
      }

      return ids;
    }

    it("files every selected link in one request", async () => {
      const { albumId } = await seed();
      const ids = await seedLinks(3);

      const response = await bulkAddRoute(
        jsonRequest(`https://app.test/api/dashboard/albums/${albumId}/links`, "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: ids },
        }),
        context(albumId),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { added: 3, alreadyIn: 0, skipped: 0 },
      });
      expect((await listAlbums(dbState.db))[0]?.linkCount).toBe(3);
    });

    it("reports the links that were already in the album", async () => {
      const { albumId } = await seed();
      const ids = await seedLinks(2);
      await addLinkToAlbum(dbState.db, albumId, ids[0]!);

      const response = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: ids },
        }),
        context(albumId),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { added: 1, alreadyIn: 1, skipped: 0 },
      });
    });

    it("is idempotent across two requests", async () => {
      const { albumId } = await seed();
      const ids = await seedLinks(2);
      const body = { linkIds: ids };

      await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body,
        }),
        context(albumId),
      );
      const second = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body,
        }),
        context(albumId),
      );

      expect(second.status).toBe(200);
      await expect(second.json()).resolves.toMatchObject({
        data: { added: 0, alreadyIn: 2, skipped: 0 },
      });
    });

    it("skips ids that no longer exist and writes no row for them", async () => {
      const { albumId } = await seed();
      const ids = await seedLinks(1);

      const response = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: [...ids, "ghost"] },
        }),
        context(albumId),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { added: 1, alreadyIn: 0, skipped: 1 },
      });
      await expect(dbState.db.select().from(albumLinks)).resolves.toHaveLength(1);
    });

    it("answers 404 for an unknown album", async () => {
      const ids = await seedLinks(1);

      const response = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/gone/links", "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: ids },
        }),
        context("gone"),
      );

      expect(response.status).toBe(404);
      await expect(dbState.db.select().from(albumLinks)).resolves.toHaveLength(0);
    });

    it.each([
      ["a missing field", { body: {} }],
      ["an empty list", { body: { linkIds: [] } }],
      ["a string instead of an array", { body: { linkIds: "abc" } }],
      ["a blank entry", { body: { linkIds: [""] } }],
      [
        "more ids than the cap",
        { body: { linkIds: Array.from({ length: 201 }, (_, i) => `id-${i}`) } },
      ],
      ["a body that is not JSON", { raw: "{" }],
    ])("rejects %s", async (_label, payload) => {
      const { albumId } = await seed();

      const response = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          ...payload,
        }),
        context(albumId),
      );

      expect(response.status).toBe(400);
      await expect(dbState.db.select().from(albumLinks)).resolves.toHaveLength(0);
    });

    it("refuses a visitor with no session", async () => {
      const { albumId } = await seed();
      const ids = await seedLinks(2);

      const response = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          body: { linkIds: ids },
        }),
        context(albumId),
      );

      expect(response.status).toBe(401);
      await expect(dbState.db.select().from(albumLinks)).resolves.toHaveLength(0);
    });

    it("answers 503 when the dashboard password is not set", async () => {
      vi.stubEnv("DASHBOARD_PASSWORD", "");
      const { albumId } = await seed();
      const ids = await seedLinks(1);

      const response = await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: ids },
        }),
        context(albumId),
      );

      expect(response.status).toBe(503);
    });

    it("logs the add under its own event name", async () => {
      const { albumId } = await seed();
      const ids = await seedLinks(2);

      await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: ids },
        }),
        context(albumId),
      );

      const events = infoSpy.mock.calls.map((call: unknown[]) =>
        JSON.parse(String(call[0])).event,
      );
      expect(events).toContain("dashboard_album_links_added");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs a refused add as an error", async () => {
      const { albumId } = await seed();

      await bulkAddRoute(
        jsonRequest("https://app.test/api/dashboard/albums/x/links", "POST", {
          cookies: [validSessionCookie()],
          body: { linkIds: [] },
        }),
        context(albumId),
      );

      const events = errorSpy.mock.calls.map((call: unknown[]) =>
        JSON.parse(String(call[0])).event,
      );
      expect(events).toContain("dashboard_album_links_add_failed");
    });
  });

  describe("logging", () => {
    const emittedEvents = (spy: { mock: { calls: unknown[][] } }): string[] =>
      spy.mock.calls.map((call) => {
        const parsed = JSON.parse(String(call[0]));
        return parsed.event as string;
      });

    it("logs a successful creation under its own event name", async () => {
      await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "Anime" },
        }),
      );

      expect(emittedEvents(infoSpy)).toContain("dashboard_album_created");
      expect(emittedEvents(errorSpy)).toEqual([]);
    });

    it("logs a refused creation as an error", async () => {
      await createAlbumRoute(
        jsonRequest("https://app.test/api/dashboard/albums", "POST", {
          cookies: [validSessionCookie()],
          body: { name: "   " },
        }),
      );

      expect(emittedEvents(errorSpy)).toContain("dashboard_album_create_failed");
    });
  });
});
