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

const { GET: searchRoute } = await import("@/app/api/agent/links/route");
const { GET: detailRoute } = await import("@/app/api/agent/links/[id]/route");
const { GET: albumsRoute } = await import("@/app/api/agent/albums/route");
const { addLinkToAlbum, createAlbum } = await import("@/db/albums");
const { updateLink, upsertLink } = await import("@/db/links");
const { lockDomain, unlockDomain } = await import("@/db/locked-domains");

const AGENT_KEY = "agent-key-for-tests";
const PASSCODE = "open sesame";

interface Seed {
  hotel: string;
  cooking: string;
  third: string;
  secret: string;
  travel: string;
  vault: string;
}

let testDatabase: TestDatabase | undefined;
let seed: Seed;

function call(
  handler: (request: Request, context: never) => Promise<Response>,
  path: string,
  options: { headers?: Record<string, string>; id?: string } = {},
): Promise<Response> {
  const headers = { "x-agent-key": AGENT_KEY, ...options.headers };
  const request = new Request(`https://app.test${path}`, { headers });

  return handler(request, { params: Promise.resolve({ id: options.id }) } as never);
}

const withPasscode = { "x-locked-passcode": PASSCODE };

async function data(response: Response) {
  const body = (await response.json()) as { ok: boolean; data?: any; error?: any };
  return body;
}

async function save(url: string, title: string) {
  const domain = new URL(url).host;
  const { link } = await upsertLink(dbState.db, { url, domain, title, thumbnail: "https://img.test/x.jpg" });
  return link;
}

beforeEach(async () => {
  vi.stubEnv("AGENT_API_KEY", AGENT_KEY);
  vi.stubEnv("LOCKED_PASSCODE", PASSCODE);
  vi.stubEnv("AGENT_FAILURE_DELAY_MS", "0");

  testDatabase = await createTestDatabase();
  dbState.db = testDatabase.db;
  await lockDomain(dbState.db, "secret.test");

  const hotel = await save("https://hotel.test/bali", "Hotel Bali");
  const cooking = await save("https://food.test/pasta", "Cooking");
  const third = await save("https://third.test/x", "Third");
  const secret = await save("https://secret.test/hotel", "Secret hotel");

  await updateLink(dbState.db, cooking.id, { summary: "pasta recipes" });
  await updateLink(dbState.db, third.id, { isFavorite: true });

  const travel = await createAlbum(dbState.db, { name: "Travel", nameKey: "travel", scope: "visible" });
  const vault = await createAlbum(dbState.db, { name: "Vault", nameKey: "vault", scope: "locked" });
  if (!travel.ok || !vault.ok) throw new Error("setup failed");
  await addLinkToAlbum(dbState.db, travel.album.id, hotel.id);
  await addLinkToAlbum(dbState.db, vault.album.id, secret.id);

  seed = {
    hotel: hotel.id,
    cooking: cooking.id,
    third: third.id,
    secret: secret.id,
    travel: travel.album.id,
    vault: vault.album.id,
  };
});

afterEach(async () => {
  await testDatabase?.cleanup();
  testDatabase = undefined;
  vi.unstubAllEnvs();
});

describe("GET /api/agent/links", () => {
  it("answers 401 without the agent key", async () => {
    const response = await searchRoute(new Request("https://app.test/api/agent/links"));

    expect(response.status).toBe(401);
  });

  it("returns only public links and never a locked-domain link", async () => {
    const body = await data(await call(searchRoute, "/api/agent/links"));

    const titles = body.data.links.map((row: { title: string }) => row.title).sort();
    expect(titles).toEqual(["Cooking", "Hotel Bali", "Third"]);
    expect(JSON.stringify(body)).not.toContain("secret.test");
    expect(JSON.stringify(body)).not.toContain("Vault");
  });

  it("returns compact rows without url or thumbnail, with album names", async () => {
    const body = await data(await call(searchRoute, "/api/agent/links?q=hotel"));

    expect(body.data.links).toEqual([
      {
        id: seed.hotel,
        title: "Hotel Bali",
        domain: "hotel.test",
        summary: null,
        albums: ["Travel"],
        fav: false,
      },
    ]);
  });

  it("matches the query against title, url and summary", async () => {
    const byTitle = await data(await call(searchRoute, "/api/agent/links?q=cooking"));
    const byUrl = await data(await call(searchRoute, "/api/agent/links?q=food.test"));
    const bySummary = await data(await call(searchRoute, "/api/agent/links?q=recipes"));

    for (const body of [byTitle, byUrl, bySummary]) {
      expect(body.data.links.map((row: { id: string }) => row.id)).toEqual([seed.cooking]);
    }
  });

  it("treats % in the query literally", async () => {
    const body = await data(await call(searchRoute, "/api/agent/links?q=%25"));

    expect(body.data.links).toEqual([]);
  });

  it("noAlbum=1 returns only public links that are in no album", async () => {
    const body = await data(await call(searchRoute, "/api/agent/links?noAlbum=1"));

    const ids = body.data.links.map((row: { id: string }) => row.id).sort();
    expect(ids).toEqual([seed.cooking, seed.third].sort());
  });

  it("filters by album id", async () => {
    const body = await data(await call(searchRoute, `/api/agent/links?album=${seed.travel}`));

    expect(body.data.links.map((row: { id: string }) => row.id)).toEqual([seed.hotel]);
  });

  it("rejects album together with noAlbum", async () => {
    const response = await call(searchRoute, `/api/agent/links?album=${seed.travel}&noAlbum=1`);

    expect(response.status).toBe(400);
  });

  it("answers 404 for a private album id on a public search", async () => {
    const response = await call(searchRoute, `/api/agent/links?album=${seed.vault}`);

    expect(response.status).toBe(404);
  });

  it("filters by favorite and by domain", async () => {
    const fav = await data(await call(searchRoute, "/api/agent/links?favorite=1"));
    const domain = await data(await call(searchRoute, "/api/agent/links?domain=food.test"));

    expect(fav.data.links.map((row: { id: string }) => row.id)).toEqual([seed.third]);
    expect(domain.data.links.map((row: { id: string }) => row.id)).toEqual([seed.cooking]);
  });

  it("reports hasMore and honours limit and offset", async () => {
    const first = await data(await call(searchRoute, "/api/agent/links?limit=2"));
    const second = await data(await call(searchRoute, "/api/agent/links?limit=2&offset=2"));

    expect(first.data.links).toHaveLength(2);
    expect(first.data.hasMore).toBe(true);
    expect(second.data.links).toHaveLength(1);
    expect(second.data.hasMore).toBe(false);
  });

  it.each(["limit=0", "limit=999", "limit=abc", "offset=-1", "offset=1.5", "space=weird"])(
    "answers 400 for %s",
    async (query) => {
      const response = await call(searchRoute, `/api/agent/links?${query}`);

      expect(response.status).toBe(400);
      expect((await data(response)).error.code).toBe("VALIDATION_ERROR");
    },
  );

  it("answers 403 PASSCODE_REQUIRED for space=private without a passcode", async () => {
    const response = await call(searchRoute, "/api/agent/links?space=private");

    expect(response.status).toBe(403);
    expect((await data(response)).error.code).toBe("PASSCODE_REQUIRED");
  });

  it("returns only locked links for space=private with the passcode", async () => {
    const response = await call(searchRoute, "/api/agent/links?space=private", {
      headers: withPasscode,
    });
    const body = await data(response);

    expect(response.status).toBe(200);
    expect(body.data.links.map((row: { id: string }) => row.id)).toEqual([seed.secret]);
    expect(body.data.links[0].albums).toEqual(["Vault"]);
  });

  it("filters by a private album id when the passcode is sent", async () => {
    const body = await data(
      await call(searchRoute, `/api/agent/links?space=private&album=${seed.vault}`, {
        headers: withPasscode,
      }),
    );

    expect(body.data.links.map((row: { id: string }) => row.id)).toEqual([seed.secret]);
  });
});

describe("private album names after a domain is revealed", () => {
  it("never reach a no-passcode caller through search or detail", async () => {
    // secret.test is locked and its link sits in the locked album "Vault";
    // revealing the domain moves the link to the public side but leaves the membership row.
    await unlockDomain(dbState.db, "secret.test");

    const search = await data(await call(searchRoute, "/api/agent/links?q=secret"));
    const detail = await data(
      await call(detailRoute, `/api/agent/links/${seed.secret}`, { id: seed.secret }),
    );

    expect(search.data.links[0].albums).toEqual([]);
    expect(detail.data.albums).toEqual([]);
    expect(JSON.stringify([search, detail])).not.toContain("Vault");
  });
});

describe("GET /api/agent/links/:id", () => {
  it("returns the full detail of a public link, thumbnail included", async () => {
    const response = await call(detailRoute, `/api/agent/links/${seed.hotel}`, { id: seed.hotel });
    const body = await data(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: seed.hotel,
      url: "https://hotel.test/bali",
      thumbnail: "https://img.test/x.jpg",
      albums: ["Travel"],
      space: "public",
    });
  });

  it("answers 404 for a private link without the passcode, same as an unknown id", async () => {
    const priv = await call(detailRoute, `/api/agent/links/${seed.secret}`, { id: seed.secret });
    const missing = await call(detailRoute, "/api/agent/links/nope", { id: "nope" });

    expect(priv.status).toBe(404);
    expect(await priv.json()).toEqual(await missing.json());
  });

  it("returns a private link when the passcode is sent", async () => {
    const response = await call(detailRoute, `/api/agent/links/${seed.secret}`, {
      id: seed.secret,
      headers: withPasscode,
    });
    const body = await data(response);

    expect(response.status).toBe(200);
    expect(body.data.space).toBe("private");
  });
});

describe("GET /api/agent/albums", () => {
  it("lists public albums with counts and hides private ones", async () => {
    const body = await data(await call(albumsRoute, "/api/agent/albums"));

    expect(body.data.albums).toEqual([{ id: seed.travel, name: "Travel", count: 1 }]);
  });

  it("answers 403 for space=private without the passcode, and lists them with it", async () => {
    const denied = await call(albumsRoute, "/api/agent/albums?space=private");
    const allowed = await data(
      await call(albumsRoute, "/api/agent/albums?space=private", { headers: withPasscode }),
    );

    expect(denied.status).toBe(403);
    expect(allowed.data.albums).toEqual([{ id: seed.vault, name: "Vault", count: 1 }]);
  });
});
