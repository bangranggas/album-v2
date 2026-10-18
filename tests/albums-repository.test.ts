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
import type { AlbumCreateInput } from "@/lib/validation";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const ANIME: AlbumCreateInput = {
  name: "Anime",
  nameKey: "anime",
  scope: "visible",
};

/** A new album on the requested side; the light page is the usual one. */
function makeAlbum(
  name: string,
  scope: AlbumCreateInput["scope"] = "visible",
): AlbumCreateInput {
  return { name, nameKey: name.toLowerCase(), scope };
}

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
    const second = await createAlbum(db, makeAlbum("ANIME"));

    expect(second).toEqual({ ok: false, reason: "name-taken" });
    await expect(listAlbums(db)).resolves.toHaveLength(1);
  });

  it("allows two albums with different names", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, ANIME);
    const second = await createAlbum(db, makeAlbum("Movies"));

    expect(second.ok).toBe(true);
    await expect(listAlbums(db)).resolves.toHaveLength(2);
  });

  it("stores the side the album belongs to", async () => {
    const { db } = await freshDatabase();

    const visible = await createAlbum(db, ANIME);
    const locked = await createAlbum(db, makeAlbum("Anime", "locked"));

    expect(visible.ok && visible.album.scope).toBe("visible");
    expect(locked.ok && locked.album.scope).toBe("locked");
  });

  it("lets the same name exist once per side", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, ANIME);
    const twin = await createAlbum(db, makeAlbum("anime", "locked"));

    // The unique index is on (scope, name_key), so the label is free on the other
    // side — which is also what stops a conflict from revealing a locked name.
    expect(twin.ok).toBe(true);
    await expect(listAlbums(db)).resolves.toHaveLength(1);
    await expect(listAlbums(db, { scope: "locked" })).resolves.toHaveLength(1);
  });

  it("still refuses the same name twice on one side", async () => {
    const { db } = await freshDatabase();

    await createAlbum(db, ANIME);
    const second = await createAlbum(db, makeAlbum("ANIME", "locked"));

    expect(second.ok).toBe(true);
    const third = await createAlbum(db, makeAlbum("anime", "locked"));

    expect(third).toEqual({ ok: false, reason: "name-taken" });
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
    await createAlbum(db, makeAlbum("Movies"));

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

  it("only checks the conflict inside the album's own side", async () => {
    const { db } = await freshDatabase();
    const light = await createAlbum(db, ANIME);
    const dark = await createAlbum(db, makeAlbum("Films", "locked"));
    const movies = await createAlbum(db, makeAlbum("Movies"));
    if (!light.ok || !dark.ok || !movies.ok) throw new Error("setup failed");

    // A name the same side already owns is still refused.
    await expect(
      renameAlbum(db, movies.album.id, { name: "anime", nameKey: "anime" }),
    ).resolves.toEqual({ ok: false, reason: "name-taken" });

    // A name that only the *other* side owns is free, and the side never changes.
    const takenFromLight = await renameAlbum(db, dark.album.id, {
      name: "Anime",
      nameKey: "anime",
    });
    expect(takenFromLight.ok && takenFromLight.album.name).toBe("Anime");
    expect(takenFromLight.ok && takenFromLight.album.scope).toBe("locked");

    const takenFromDark = await renameAlbum(db, light.album.id, {
      name: "Films",
      nameKey: "films",
    });
    expect(takenFromDark.ok && takenFromDark.album.name).toBe("Films");
    expect(takenFromDark.ok && takenFromDark.album.scope).toBe("visible");
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
    await expect(listAlbumIdsByLink(db, ["link-1"], "visible")).resolves.toEqual(new Map());
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
    const second = await createAlbum(db, makeAlbum("Movies"));
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await addLinkToAlbum(db, first.album.id, "link-1");
    await addLinkToAlbum(db, second.album.id, "link-1");

    await deleteAlbum(db, first.album.id);

    const memberships = await listAlbumIdsByLink(db, ["link-1"], "visible");
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
    const memberships = await listAlbumIdsByLink(db, ["link-1"], "visible");
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
    const second = await createAlbum(db, makeAlbum("Movies"));
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });

    await addLinkToAlbum(db, first.album.id, "link-1");
    await addLinkToAlbum(db, second.album.id, "link-1");

    const memberships = await listAlbumIdsByLink(db, ["link-1"], "visible");
    expect(memberships.get("link-1")?.sort()).toEqual(
      [first.album.id, second.album.id].sort(),
    );
  });

  it("refuses a visible link for a locked album", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, makeAlbum("Anime", "locked"));
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });

    await expect(addLinkToAlbum(db, created.album.id, "link-1")).resolves.toBe(
      "scope-mismatch",
    );
    await expect(db.select().from(albumLinks)).resolves.toHaveLength(0);
  });

  it("refuses a hidden link for a visible album", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "hidden", domain: "hidden.example" });
    await lockDomain(db, "hidden.example");

    await expect(addLinkToAlbum(db, created.album.id, "hidden")).resolves.toBe(
      "scope-mismatch",
    );
    await expect(db.select().from(albumLinks)).resolves.toHaveLength(0);
  });

  it("accepts a link that is filed before its domain is locked", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "later-hidden", domain: "hidden.example" });

    await expect(
      addLinkToAlbum(db, created.album.id, "later-hidden"),
    ).resolves.toBe("added");

    // Locking the domain afterwards does not rewrite the membership; it only stops
    // the link from showing on this side (the dormant case).
    await lockDomain(db, "hidden.example");
    const rows = await db.select().from(albumLinks);
    expect(rows).toHaveLength(1);
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

  it("counts an id that is on the other side as skipped", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "visible" });
    await insertLink(db, { id: "hidden", domain: "hidden.example" });
    await lockDomain(db, "hidden.example");

    const result = await addLinksToAlbum(db, created.album.id, [
      "visible",
      "hidden",
    ]);

    // The bulk panel only ever offers albums of its own page, so this is
    // unreachable from the UI; the counts still describe every distinct id it got,
    // and `skipped` stays deliberately vague about why.
    expect(result).toEqual({ added: 1, alreadyIn: 0, skipped: 1 });
    const rows = await db.select().from(albumLinks);
    expect(rows.map((row) => row.linkId)).toEqual(["visible"]);
  });

  it("leaves other albums and unselected links alone", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    const second = await createAlbum(db, makeAlbum("Movies"));
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await addLinkToAlbum(db, second.album.id, "link-2");

    await addLinksToAlbum(db, first.album.id, ["link-1", "link-2"]);

    const memberships = await listAlbumIdsByLink(db, ["link-1", "link-2"], "visible");
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

    await createAlbum(db, makeAlbum("banana"));
    await createAlbum(db, makeAlbum("Apple"));
    await createAlbum(db, makeAlbum("cherry"));

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

  it("lists only the requested side's albums", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, makeAlbum("Light"));
    await createAlbum(db, makeAlbum("Dark", "locked"));

    const visible = await listAlbums(db, { scope: "visible" });
    const locked = await listAlbums(db, { scope: "locked" });

    expect(visible.map((album) => album.name)).toEqual(["Light"]);
    expect(locked.map((album) => album.name)).toEqual(["Dark"]);
  });

  it("hides a link that left the album's side after it was filed", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, ANIME);
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, {
      id: "visible",
      thumbnail: "https://example.com/visible.jpg",
    });
    await insertLink(db, {
      id: "will-hide",
      domain: "hidden.example",
      thumbnail: "https://hidden.example/cover.jpg",
      updatedAt: 9_000,
    });
    await addLinkToAlbum(db, created.album.id, "visible");
    await addLinkToAlbum(db, created.album.id, "will-hide");

    // The domain is locked *after* the link was filed, so the membership survives
    // while the link becomes invisible on this side (the dormant case).
    await lockDomain(db, "hidden.example");

    const visible = await listAlbums(db, { scope: "visible" });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.linkCount).toBe(1);
    expect(visible[0]?.covers).toEqual(["https://example.com/visible.jpg"]);
    expect(visible[0]?.firstDomain).toBe("example.com");
    // The album lives on the light side, so the locked list never mentions it: the
    // hidden member is dormant rather than moved.
    await expect(listAlbums(db, { scope: "locked" })).resolves.toEqual([]);
  });

  it("counts and covers only the members on a locked album's own side", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, makeAlbum("Anime", "locked"));
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, {
      id: "hidden",
      domain: "hidden.example",
      thumbnail: "https://hidden.example/cover.jpg",
    });
    await lockDomain(db, "hidden.example");
    await addLinkToAlbum(db, created.album.id, "hidden");

    const locked = await listAlbums(db, { scope: "locked" });

    expect(locked).toHaveLength(1);
    expect(locked[0]?.linkCount).toBe(1);
    expect(locked[0]?.covers).toEqual(["https://hidden.example/cover.jpg"]);
    expect(locked[0]?.firstDomain).toBe("hidden.example");
    await expect(listAlbums(db, { scope: "visible" })).resolves.toEqual([]);
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
    await createAlbum(db, makeAlbum("Movies"));

    const matched = await listAlbums(db, { query: "ani" });
    const unmatched = await listAlbums(db, { query: "zzz" });

    expect(matched.map((album) => album.name)).toEqual(["Anime"]);
    expect(unmatched).toEqual([]);
  });

  it("respects the limit", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, makeAlbum("a"));
    await createAlbum(db, makeAlbum("b"));
    await createAlbum(db, makeAlbum("c"));

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

    await expect(listAlbumOptions(db, "visible")).resolves.toEqual([]);
  });

  it("returns every album's id and name, ordered by name", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, makeAlbum("banana"));
    const apple = await createAlbum(db, makeAlbum("Apple"));
    if (!apple.ok) throw new Error("setup failed");

    await expect(listAlbumOptions(db, "visible")).resolves.toEqual([
      { id: apple.album.id, name: "Apple" },
      { id: expect.any(String), name: "banana" },
    ]);
  });

  it("lists only the requested side's albums", async () => {
    const { db } = await freshDatabase();
    const light = await createAlbum(db, ANIME);
    const dark = await createAlbum(db, makeAlbum("Anime", "locked"));
    if (!light.ok || !dark.ok) throw new Error("setup failed");

    // The same label exists on both sides; each popup only ever offers its own.
    await expect(listAlbumOptions(db, "visible")).resolves.toEqual([
      { id: light.album.id, name: "Anime" },
    ]);
    await expect(listAlbumOptions(db, "locked")).resolves.toEqual([
      { id: dark.album.id, name: "Anime" },
    ]);
  });

  it("never offers a locked album to the light page", async () => {
    const { db } = await freshDatabase();
    const created = await createAlbum(db, makeAlbum("Anime", "locked"));
    if (!created.ok) throw new Error("setup failed");
    await insertLink(db, { id: "hidden", domain: "hidden.example" });
    await addLinkToAlbum(db, created.album.id, "hidden");
    await lockDomain(db, "hidden.example");

    await expect(listAlbumOptions(db, "visible")).resolves.toEqual([]);
  });
});

describe("countAlbums", () => {
  it("is zero before anything is created", async () => {
    const { db } = await freshDatabase();

    await expect(countAlbums(db, "visible")).resolves.toBe(0);
    await expect(countAlbums(db, "locked")).resolves.toBe(0);
  });

  it("counts only the albums on the requested side", async () => {
    const { db } = await freshDatabase();
    await createAlbum(db, ANIME);
    await createAlbum(db, makeAlbum("Movies"));
    await createAlbum(db, makeAlbum("Anime", "locked"));

    // The count line above the grid describes that page's own list.
    await expect(countAlbums(db, "visible")).resolves.toBe(2);
    await expect(countAlbums(db, "locked")).resolves.toBe(1);
  });
});

describe("listAlbumIdsByLink", () => {
  it("maps each link to the album ids it belongs to", async () => {
    const { db } = await freshDatabase();
    const first = await createAlbum(db, ANIME);
    const second = await createAlbum(db, makeAlbum("Movies"));
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await insertLink(db, { id: "link-1" });
    await insertLink(db, { id: "link-2" });
    await addLinkToAlbum(db, first.album.id, "link-1");
    await addLinkToAlbum(db, second.album.id, "link-1");
    await addLinkToAlbum(db, first.album.id, "link-2");

    const memberships = await listAlbumIdsByLink(db, ["link-1", "link-2"], "visible");

    expect(memberships.get("link-1")?.sort()).toEqual(
      [first.album.id, second.album.id].sort(),
    );
    expect(memberships.get("link-2")).toEqual([first.album.id]);
  });

  it("ignores the other side's albums, so their ids never reach the wrong page", async () => {
    const { db } = await freshDatabase();
    const light = await createAlbum(db, ANIME);
    const dark = await createAlbum(db, makeAlbum("Anime", "locked"));
    if (!light.ok || !dark.ok) throw new Error("setup failed");
    await insertLink(db, { id: "visible-1" });
    await insertLink(db, { id: "hidden-1", domain: "hidden.example" });
    await lockDomain(db, "hidden.example");
    await addLinkToAlbum(db, light.album.id, "visible-1");
    await addLinkToAlbum(db, dark.album.id, "hidden-1");

    const visible = await listAlbumIdsByLink(db, ["visible-1"], "visible");
    const locked = await listAlbumIdsByLink(db, ["hidden-1"], "locked");

    expect(visible.get("visible-1")).toEqual([light.album.id]);
    expect(locked.get("hidden-1")).toEqual([dark.album.id]);
    // Neither side's map mentions the other side's album.
    await expect(
      listAlbumIdsByLink(db, ["visible-1"], "locked"),
    ).resolves.toEqual(new Map());
    await expect(
      listAlbumIdsByLink(db, ["hidden-1"], "visible"),
    ).resolves.toEqual(new Map());
  });

  it("omits a link that is in no album", async () => {
    const { db } = await freshDatabase();
    await insertLink(db, { id: "link-1" });

    const memberships = await listAlbumIdsByLink(db, ["link-1"], "visible");

    expect(memberships.get("link-1")).toBeUndefined();
  });

  it("accepts an empty list without querying", async () => {
    const { db } = await freshDatabase();

    await expect(listAlbumIdsByLink(db, [], "visible")).resolves.toEqual(new Map());
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
    await expect(listAlbumIdsByLink(db, ["link-1"], "visible")).resolves.toEqual(new Map());
  });
});
