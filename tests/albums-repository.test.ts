import { afterEach, describe, expect, it } from "vitest";

import {
  addLinkToAlbum,
  addLinksToAlbum,
  countAlbums,
  createAlbum,
  deleteAlbum,
  getAlbumById,
  listAlbumIdsByLink,
  listAlbumOptions,
  listAlbums,
  removeLinkFromAlbum,
  renameAlbum,
} from "@/db/albums";
import { deleteLink, listLinks } from "@/db/links";
import { lockDomain } from "@/db/locked-domains";
import { albumLinks, links } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const ANIME = { name: "Anime", nameKey: "anime" };

let testDatabase: TestDatabase | undefined;

afterEach(async () => {
  await testDatabase?.cleanup();
  testDatabase = undefined;
});

async function freshDatabase(): Promise<TestDatabase> {
  testDatabase = await createTestDatabase();
  return testDatabase;
}

/** Inserts a link with an explicit `updatedAt`, so cover ordering is deterministic. */
async function insertLink(
  db: TestDatabase["db"],
  options: {
    id: string;
    url?: string;
    domain?: string;
    title?: string;
    thumbnail?: string | null;
    updatedAt?: number;
  },
): Promise<void> {
  const updatedAt = options.updatedAt ?? Date.now();

  await db.insert(links).values({
    id: options.id,
    url: options.url ?? `https://example.com/${options.id}`,
    domain: options.domain ?? "example.com",
    title: options.title ?? options.id,
    thumbnail: options.thumbnail ?? null,
    createdAt: updatedAt,
    updatedAt,
  });
}

describe("createAlbum", () => {
  it("creates an album with an id and the lowercased key", async () => {
    const { db } = await freshDatabase();

    const result = await createAlbum(db, ANIME);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.album.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.album.name).toBe("Anime");
    expect(result.album.nameKey).toBe("anime");
    expect(result.album.createdAt).toBeGreaterThan(0);
  });

  it("refuses a second album with the same key, whatever its case", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, ANIME);
    const second = await createAlbum(db, { name: "ANIME", nameKey: "anime" });

    expect(second).toEqual({ ok: false, reason: "name-taken" });
    await expect(listAlbums(db)).resolves.toHaveLength(1);
  });

  it("allows two albums with different names", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, ANIME);
    const second = await createAlbum(db, { name: "Movies", nameKey: "movies" });

    expect(second.ok).toBe(true);
    await expect(listAlbums(db)).resolves.toHaveLength(2);
  });
});

describe("renameAlbum", () => {
  it("updates the name and the key, keeping the id and creation time", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    const result = await renameAlbum(db, created.album.id, {
      name: "Animation",
      nameKey: "animation",
    });

    expect(result.ok && result.album.name).toBe("Animation");
    expect(result.ok && result.album.nameKey).toBe("animation");
    expect(result.ok && result.album.id).toBe(created.album.id);
    expect(result.ok && result.album.createdAt).toBe(created.album.createdAt);
  });

  it("reports not-found for an unknown id", async () => {
    const { db } = await freshDatabase();

    await expect(renameAlbum(db, "nope", ANIME)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("refuses a name another album owns and leaves the original intact", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    if (!first.ok) throw new Error("setup failed");
    await createAlbum(db, { name: "Movies", nameKey: "movies" });

    const result = await renameAlbum(db, first.album.id, {
      name: "movies",
      nameKey: "movies",
    });

    expect(result).toEqual({ ok: false, reason: "name-taken" });
    const stored = await getAlbumById(db, first.album.id);
    expect(stored?.name).toBe("Anime");
  });

  it("accepts a change of case on its own name", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    const result = await renameAlbum(db, created.album.id, {
      name: "ANIME",
      nameKey: "anime",
    });

    expect(result.ok && result.album.name).toBe("ANIME");
  });
});

describe("deleteAlbum", () => {
  it("removes the album and its memberships but keeps the links", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, created.album.id, "link-1");

    await expect(deleteAlbum(db, created.album.id)).resolves.toBe(true);

    await expect(listAlbums(db)).resolves.toEqual([]);
    await expect(listLinks(db)).resolves.toHaveLength(1);
    await expect(listAlbumIdsByLink(db, ["link-1"])).resolves.toEqual(new Map());
  });

  it("reports false for an album that is already gone", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    await deleteAlbum(db, created.album.id);

    await expect(deleteAlbum(db, created.album.id)).resolves.toBe(false);
  });

  it("does not touch another album's memberships", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    const second = await createAlbum(db, { name: "Movies", nameKey: "movies" });
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, first.album.id, "link-1");
    await addLinkToAlbum(db, second.album.id, "link-1");

    await deleteAlbum(db, first.album.id);

    const memberships = await listAlbumIdsByLink(db, ["link-1"]);
    expect(memberships.get("link-1")).toEqual([second.album.id]);
  });
});

describe("addLinkToAlbum", () => {
  it("adds a link and reports it as added", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });

    await expect(addLinkToAlbum(db, created.album.id, "link-1")).resolves.toBe(
      "added",
    );
    const albums = await listAlbums(db);
    expect(albums[0]?.linkCount).toBe(1);
  });

  it("is idempotent: the second call changes nothing", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, created.album.id, "link-1");

    await expect(addLinkToAlbum(db, created.album.id, "link-1")).resolves.toBe(
      "already",
    );
    const memberships = await listAlbumIdsByLink(db, ["link-1"]);
    expect(memberships.get("link-1")).toEqual([created.album.id]);
  });

  it("reports an unknown album", async () => {
    const { db } = await freshDatabase();
    await insertLink(db, { id: "link-1" });

    await expect(addLinkToAlbum(db, "nope", "link-1")).resolves.toBe(
      "album-not-found",
    );
  });

  it("reports an unknown link", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    await expect(addLinkToAlbum(db, created.album.id, "nope")).resolves.toBe(
      "link-not-found",
    );
  });

  it("lets one link live in several albums", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    const second = await createAlbum(db, { name: "Movies", nameKey: "movies" });
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });

    await addLinkToAlbum(db, first.album.id, "link-1");
    await addLinkToAlbum(db, second.album.id, "link-1");

    const memberships = await listAlbumIdsByLink(db, ["link-1"]);
    expect(memberships.get("link-1")?.sort()).toEqual(
      [first.album.id, second.album.id].sort(),
    );
  });
});

describe("addLinksToAlbum", () => {
  it("adds several links in one call", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await insertLink(db, { id: "link-3" });

    await expect(
      addLinksToAlbum(db, created.album.id, ["link-1", "link-2", "link-3"]),
    ).resolves.toEqual({ added: 3, alreadyIn: 0, skipped: 0 });

    const albums = await listAlbums(db);
    expect(albums[0]?.linkCount).toBe(3);
  });

  it("separates new links, links already in the album, and unknown ids", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await insertLink(db, { id: "link-3" });
    await addLinkToAlbum(db, created.album.id, "link-1");

    const result = await addLinksToAlbum(db, created.album.id, [
      "link-1",
      "link-2",
      "link-3",
      "ghost",
    ]);

    expect(result).toEqual({ added: 2, alreadyIn: 1, skipped: 1 });
    const albums = await listAlbums(db);
    expect(albums[0]?.linkCount).toBe(3);
  });

  it("never writes a row for an unknown link id", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });

    const result = await addLinksToAlbum(db, created.album.id, [
      "link-1",
      "ghost",
      "phantom",
    ]);

    expect(result).toEqual({ added: 1, alreadyIn: 0, skipped: 2 });
    // `album_links` has no foreign key, so an unguarded insert would leave rows
    // behind that no page could ever show or delete.
    const rows = await db.select().from(albumLinks);
    expect(rows.map((row) => row.linkId)).toEqual(["link-1"]);
  });

  it("reports an unknown album and writes nothing", async () => {
    const { db } = await freshDatabase();
    await insertLink(db, { id: "link-1" });

    await expect(addLinksToAlbum(db, "nope", ["link-1"])).resolves.toBe(
      "album-not-found",
    );
    await expect(db.select().from(albumLinks)).resolves.toHaveLength(0);
  });

  it("treats an empty list as a no-op", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    await expect(addLinksToAlbum(db, created.album.id, [])).resolves.toEqual({
      added: 0,
      alreadyIn: 0,
      skipped: 0,
    });
  });

  it("still reports an unknown album for an empty list", async () => {
    const { db } = await freshDatabase();

    await expect(addLinksToAlbum(db, "nope", [])).resolves.toBe(
      "album-not-found",
    );
  });

  it("is idempotent: the same list twice adds nothing the second time", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await addLinksToAlbum(db, created.album.id, ["link-1", "link-2"]);

    await expect(
      addLinksToAlbum(db, created.album.id, ["link-1", "link-2"]),
    ).resolves.toEqual({ added: 0, alreadyIn: 2, skipped: 0 });
    await expect(db.select().from(albumLinks)).resolves.toHaveLength(2);
  });

  it("counts a duplicated id once", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });

    await expect(
      addLinksToAlbum(db, created.album.id, ["link-1", "link-1"]),
    ).resolves.toEqual({ added: 1, alreadyIn: 0, skipped: 0 });
  });

  it("accounts for every distinct id it was given", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, created.album.id, "link-1");

    const ids = ["link-1", "ghost", "phantom", "link-1"];
    const result = await addLinksToAlbum(db, created.album.id, ids);
    if (result === "album-not-found") throw new Error("setup failed");

    expect(result.added + result.alreadyIn + result.skipped).toBe(3);
  });

  it("leaves other albums and unselected links alone", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    const second = await createAlbum(db, { name: "Movies", nameKey: "movies" });
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await addLinkToAlbum(db, second.album.id, "link-2");

    await addLinksToAlbum(db, first.album.id, ["link-1", "link-2"]);

    const memberships = await listAlbumIdsByLink(db, ["link-1", "link-2"]);
    expect(memberships.get("link-1")).toEqual([first.album.id]);
    expect(memberships.get("link-2")?.sort()).toEqual(
      [first.album.id, second.album.id].sort(),
    );
  });
});

describe("removeLinkFromAlbum", () => {
  it("removes the membership and reports it", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, created.album.id, "link-1");

    await expect(
      removeLinkFromAlbum(db, created.album.id, "link-1"),
    ).resolves.toBe(true);
    await expect(
      removeLinkFromAlbum(db, created.album.id, "link-1"),
    ).resolves.toBe(false);

    const albums = await listAlbums(db);
    expect(albums[0]?.linkCount).toBe(0);
    await expect(listLinks(db)).resolves.toHaveLength(1);
  });
});

describe("getAlbumById", () => {
  it("returns the album, or undefined when it is gone", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    await expect(getAlbumById(db, created.album.id)).resolves.toEqual(
      created.album,
    );
    await expect(getAlbumById(db, "nope")).resolves.toBeUndefined();
  });
});

describe("listAlbums", () => {
  it("orders by name, ignoring case", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, { name: "banana", nameKey: "banana" });
    await createAlbum(db, { name: "Apple", nameKey: "apple" });
    await createAlbum(db, { name: "cherry", nameKey: "cherry" });

    const names = (await listAlbums(db)).map((album) => album.name);

    expect(names).toEqual(["Apple", "banana", "cherry"]);
  });

  it("keeps an empty album, with a count of zero and no covers", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, ANIME);

    const albums = await listAlbums(db);

    expect(albums).toHaveLength(1);
    expect(albums[0]?.linkCount).toBe(0);
    expect(albums[0]?.covers).toEqual([]);
    expect(albums[0]?.firstDomain).toBeNull();
  });

  it("names the most recent link's domain for the cover placeholder", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, {
      id: "old",
      domain: "old.example",
      updatedAt: 1_000,
    });
    await insertLink(db, {
      id: "recent",
      domain: "recent.example",
      updatedAt: 2_000,
    });
    await addLinkToAlbum(db, created.album.id, "old");
    await addLinkToAlbum(db, created.album.id, "recent");

    const albums = await listAlbums(db);

    // The placeholder follows the same "most recently updated first" order the
    // covers do, and it stands in even when nothing has a thumbnail.
    expect(albums[0]?.covers).toEqual([]);
    expect(albums[0]?.firstDomain).toBe("recent.example");
  });

  it("counts and covers only the links on the requested side of the divide", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, {
      id: "visible",
      thumbnail: "https://example.com/visible.jpg",
    });
    await insertLink(db, {
      id: "hidden",
      domain: "hidden.example",
      thumbnail: "https://hidden.example/cover.jpg",
      updatedAt: 9_000,
    });
    await addLinkToAlbum(db, created.album.id, "visible");
    await addLinkToAlbum(db, created.album.id, "hidden");
    await lockDomain(db, "hidden.example");

    const visible = await listAlbums(db, { scope: "visible" });
    const locked = await listAlbums(db, { scope: "locked" });

    expect(visible[0]?.linkCount).toBe(1);
    expect(visible[0]?.covers).toEqual(["https://example.com/visible.jpg"]);
    expect(visible[0]?.firstDomain).toBe("example.com");
    expect(locked[0]?.linkCount).toBe(1);
    expect(locked[0]?.covers).toEqual(["https://hidden.example/cover.jpg"]);
    expect(locked[0]?.firstDomain).toBe("hidden.example");
  });

  it("costs nothing extra for an album whose links are all hidden", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "hidden", domain: "hidden.example" });
    await addLinkToAlbum(db, created.album.id, "hidden");
    await lockDomain(db, "hidden.example");

    const visible = await listAlbums(db, { scope: "visible" });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.linkCount).toBe(0);
    expect(visible[0]?.covers).toEqual([]);
    expect(visible[0]?.firstDomain).toBeNull();
  });

  it("filters by name, case-insensitively", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, ANIME);
    await createAlbum(db, { name: "Movies", nameKey: "movies" });

    const matched = await listAlbums(db, { query: "ani" });
    const unmatched = await listAlbums(db, { query: "zzz" });

    expect(matched.map((album) => album.name)).toEqual(["Anime"]);
    expect(unmatched).toEqual([]);
  });

  it("respects the limit", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, { name: "a", nameKey: "a" });
    await createAlbum(db, { name: "b", nameKey: "b" });
    await createAlbum(db, { name: "c", nameKey: "c" });

    await expect(listAlbums(db, { limit: 2 })).resolves.toHaveLength(2);
  });

  it("returns up to four covers, most recently updated first", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");

    for (let index = 1; index <= 6; index += 1) {
      await insertLink(db, {
        id: `link-${index}`,
        thumbnail: `https://example.com/${index}.jpg`,
        updatedAt: 1_000 + index,
      });
      await addLinkToAlbum(db, created.album.id, `link-${index}`);
    }

    const albums = await listAlbums(db);

    expect(albums[0]?.covers).toEqual([
      "https://example.com/6.jpg",
      "https://example.com/5.jpg",
      "https://example.com/4.jpg",
      "https://example.com/3.jpg",
    ]);
  });

  it("skips links without a thumbnail", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "no-image", updatedAt: 2_000 });
    await insertLink(db, {
      id: "with-image",
      thumbnail: "https://example.com/cover.jpg",
      updatedAt: 1_000,
    });
    await addLinkToAlbum(db, created.album.id, "no-image");
    await addLinkToAlbum(db, created.album.id, "with-image");

    const albums = await listAlbums(db);

    expect(albums[0]?.linkCount).toBe(2);
    expect(albums[0]?.covers).toEqual(["https://example.com/cover.jpg"]);
  });
});

describe("listAlbumOptions", () => {
  it("is empty before anything is created", async () => {
    const { db } = await freshDatabase();

    await expect(listAlbumOptions(db)).resolves.toEqual([]);
  });

  it("returns every album's id and name, ordered by name", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, { name: "banana", nameKey: "banana" });
    const apple = await createAlbum(db, { name: "Apple", nameKey: "apple" });
    if (!apple.ok) throw new Error("setup failed");

    await expect(listAlbumOptions(db)).resolves.toEqual([
      { id: apple.album.id, name: "Apple" },
      { id: expect.any(String), name: "banana" },
    ]);
  });

  it("lists an album whose links are all hidden too, because names are not secret", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "hidden", domain: "hidden.example" });
    await addLinkToAlbum(db, created.album.id, "hidden");
    await lockDomain(db, "hidden.example");

    await expect(listAlbumOptions(db)).resolves.toEqual([
      { id: created.album.id, name: "Anime" },
    ]);
  });
});

describe("countAlbums", () => {
  it("is zero before anything is created", async () => {
    const { db } = await freshDatabase();

    await expect(countAlbums(db)).resolves.toBe(0);
  });

  it("counts every album, whichever side its links are on", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await createAlbum(db, { name: "Movies", nameKey: "movies" });
    await insertLink(db, { id: "hidden", domain: "hidden.example" });
    await addLinkToAlbum(db, created.album.id, "hidden");
    await lockDomain(db, "hidden.example");

    // Album names are not secret, so the total is the same on both pages.
    await expect(countAlbums(db)).resolves.toBe(2);
  });
});

describe("listAlbumIdsByLink", () => {
  it("maps each link to the album ids it belongs to", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    const second = await createAlbum(db, { name: "Movies", nameKey: "movies" });
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await addLinkToAlbum(db, first.album.id, "link-1");
    await addLinkToAlbum(db, second.album.id, "link-1");
    await addLinkToAlbum(db, first.album.id, "link-2");

    const memberships = await listAlbumIdsByLink(db, ["link-1", "link-2"]);

    expect(memberships.get("link-1")?.sort()).toEqual(
      [first.album.id, second.album.id].sort(),
    );
    expect(memberships.get("link-2")).toEqual([first.album.id]);
  });

  it("omits a link that is in no album", async () => {
    const { db } = await freshDatabase();
    await insertLink(db, { id: "link-1" });

    const memberships = await listAlbumIdsByLink(db, ["link-1"]);

    expect(memberships.get("link-1")).toBeUndefined();
  });

  it("accepts an empty list without querying", async () => {
    const { db } = await freshDatabase();

    await expect(listAlbumIdsByLink(db, [])).resolves.toEqual(new Map());
  });
});

describe("deleting a link", () => {
  it("removes the link from every album", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, created.album.id, "link-1");

    await deleteLink(db, "link-1");

    const albums = await listAlbums(db);
    expect(albums[0]?.linkCount).toBe(0);
    await expect(listAlbumIdsByLink(db, ["link-1"])).resolves.toEqual(new Map());
  });
});
