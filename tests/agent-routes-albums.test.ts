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

const { GET: listRoute, POST: createRoute } = await import("@/app/api/agent/albums/route");
const { POST: fileRoute } = await import("@/app/api/agent/albums/[id]/links/route");
const { createAlbum, listAlbumCounts } = await import("@/db/albums");
const { upsertLink } = await import("@/db/links");
const { lockDomain } = await import("@/db/locked-domains");
const { albumLinks } = await import("@/db/schema");

const AGENT_KEY = "agent-key-for-tests";
const PASSCODE = "open sesame";
const withPasscode = { "x-locked-passcode": PASSCODE };

let testDatabase: TestDatabase | undefined;

function post(
  handler: (request: Request, context: never) => Promise<Response>,
  path: string,
  body: unknown,
  options: { headers?: Record<string, string>; id?: string } = {},
): Promise<Response> {
  return handler(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-key": AGENT_KEY, ...options.headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: options.id }) } as never,
  );
}

const create = (body: unknown, headers?: Record<string, string>) =>
  post(createRoute, "/api/agent/albums", body, { headers });

const file = (albumId: string, body: unknown, headers?: Record<string, string>) =>
  post(fileRoute, `/api/agent/albums/${albumId}/links`, body, { id: albumId, headers });

async function json(response: Response) {
  return (await response.json()) as { ok: boolean; data?: any; error?: any };
}

async function seed(url: string) {
  const { link } = await upsertLink(dbState.db, {
    url,
    domain: new URL(url).host,
    title: url,
    thumbnail: null,
  });
  return link;
}

beforeEach(async () => {
  vi.stubEnv("AGENT_API_KEY", AGENT_KEY);
  vi.stubEnv("LOCKED_PASSCODE", PASSCODE);
  vi.stubEnv("AGENT_FAILURE_DELAY_MS", "0");

  testDatabase = await createTestDatabase();
  dbState.db = testDatabase.db;
  await lockDomain(dbState.db, "secret.test");
});

afterEach(async () => {
  await testDatabase?.cleanup();
  testDatabase = undefined;
  vi.unstubAllEnvs();
});

describe("POST /api/agent/albums", () => {
  it("creates a public album by default and lists it", async () => {
    const response = await create({ name: "  Travel " });
    const result = await json(response);

    expect(response.status).toBe(201);
    expect(result.data.album).toMatchObject({ name: "Travel", space: "public" });

    const listed = await json(
      await listRoute(new Request("https://app.test/api/agent/albums", { headers: { "x-agent-key": AGENT_KEY } })),
    );
    expect(listed.data.albums).toEqual([{ id: result.data.album.id, name: "Travel", count: 0 }]);
  });

  it("answers 409 for a duplicate name on the same side, ignoring case", async () => {
    await create({ name: "Travel" });

    const response = await create({ name: "travel" });

    expect(response.status).toBe(409);
  });

  it("allows the same name on the other side", async () => {
    await create({ name: "Travel" });

    const response = await create({ name: "Travel", space: "private" }, withPasscode);

    expect(response.status).toBe(201);
  });

  it("answers 403 for a private album without the passcode, and creates it with the passcode out of the public list", async () => {
    const denied = await create({ name: "Vault", space: "private" });
    const allowed = await create({ name: "Vault", space: "private" }, withPasscode);

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(201);
    expect(await listAlbumCounts(dbState.db, "visible")).toEqual([]);
    expect(await listAlbumCounts(dbState.db, "locked")).toHaveLength(1);
  });

  it("answers 400 for a blank name, an unknown space and invalid JSON", async () => {
    expect((await create({ name: "  " })).status).toBe(400);
    expect((await create({ name: "x", space: "elsewhere" })).status).toBe(400);
    expect((await create("{nope")).status).toBe(400);
  });

  it("answers 401 without the agent key", async () => {
    const response = await createRoute(
      new Request("https://app.test/api/agent/albums", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(401);
  });
});

describe("POST /api/agent/albums/:id/links", () => {
  async function publicAlbum(name = "Travel") {
    const created = await createAlbum(dbState.db, { name, nameKey: name.toLowerCase(), scope: "visible" });
    if (!created.ok) throw new Error("setup failed");
    return created.album;
  }

  async function privateAlbum(name = "Vault") {
    const created = await createAlbum(dbState.db, { name, nameKey: name.toLowerCase(), scope: "locked" });
    if (!created.ok) throw new Error("setup failed");
    return created.album;
  }

  it("files several links, then reports them as already in on a repeat", async () => {
    const album = await publicAlbum();
    const links = [await seed("https://a.test/1"), await seed("https://a.test/2"), await seed("https://a.test/3")];
    const linkIds = links.map((link) => link.id);

    const first = await json(await file(album.id, { linkIds }));
    const second = await json(await file(album.id, { linkIds }));

    expect(first.data).toEqual({ added: 3, alreadyIn: 0, skipped: 0 });
    expect(second.data).toEqual({ added: 0, alreadyIn: 3, skipped: 0 });
  });

  it("counts an unknown id as skipped and stores nothing for it", async () => {
    const album = await publicAlbum();
    const link = await seed("https://a.test/1");

    const result = await json(await file(album.id, { linkIds: [link.id, "ghost"] }));

    expect(result.data).toEqual({ added: 1, alreadyIn: 0, skipped: 1 });
    expect(await dbState.db.select().from(albumLinks)).toHaveLength(1);
  });

  it("answers 404 for an unknown album and 400 for an empty list or more than 200 ids", async () => {
    const album = await publicAlbum();

    expect((await file("nope", { linkIds: ["x"] })).status).toBe(404);
    expect((await file(album.id, { linkIds: [] })).status).toBe(400);
    expect(
      (await file(album.id, { linkIds: Array.from({ length: 201 }, (_, index) => `id-${index}`) })).status,
    ).toBe(400);
  });

  it("answers 404 for a private album without the passcode and writes nothing", async () => {
    const album = await privateAlbum();
    const link = await seed("https://secret.test/1");

    const response = await file(album.id, { linkIds: [link.id] });

    expect(response.status).toBe(404);
    expect(await dbState.db.select().from(albumLinks)).toHaveLength(0);
  });

  it("files a private link into a private album with the passcode", async () => {
    const album = await privateAlbum();
    const link = await seed("https://secret.test/1");

    const result = await json(await file(album.id, { linkIds: [link.id] }, withPasscode));

    expect(result.data).toEqual({ added: 1, alreadyIn: 0, skipped: 0 });
  });

  it("skips a public link offered to a private album instead of storing it", async () => {
    const album = await privateAlbum();
    const link = await seed("https://a.test/1");

    const result = await json(await file(album.id, { linkIds: [link.id] }, withPasscode));

    expect(result.data).toEqual({ added: 0, alreadyIn: 0, skipped: 1 });
    expect(await dbState.db.select().from(albumLinks)).toHaveLength(0);
  });
});
