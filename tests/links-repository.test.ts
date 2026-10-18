import { afterEach, describe, expect, it } from "vitest";

import {
  countLinks,
  deleteLink,
  getLinkById,
  listAllDomains,
  listDomains,
  listLinks,
  updateLink,
  upsertLink,
} from "@/db/links";
import { addLinkToAlbum, createAlbum } from "@/db/albums";
import { lockDomain, unlockDomain } from "@/db/locked-domains";
import { links } from "@/db/schema";
import type { LinkInput } from "@/lib/validation";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const firstSave: LinkInput = {
  url: "https://example.com/article",
  domain: "example.com",
  title: "Example Article",
  thumbnail: "https://example.com/og.jpg",
};

describe("upsertLink", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("inserts a new link and reports it as inserted", async () => {
    testDatabase = await createTestDatabase();

    const result = await upsertLink(testDatabase.db, firstSave);

    expect(result.inserted).toBe(true);
    expect(result.link.url).toBe(firstSave.url);
    expect(result.link.title).toBe(firstSave.title);
    expect(result.link.thumbnail).toBe("https://example.com/og.jpg");
    expect(result.link.id).toMatch(/[0-9a-f-]{36}/);
    expect(result.link.createdAt).toBe(result.link.updatedAt);
  });

  it("stores the derived domain", async () => {
    testDatabase = await createTestDatabase();

    const result = await upsertLink(testDatabase.db, firstSave);

    expect(result.link.domain).toBe("example.com");
  });

  it("stores a null thumbnail when none is provided", async () => {
    testDatabase = await createTestDatabase();

    const result = await upsertLink(testDatabase.db, {
      ...firstSave,
      thumbnail: null,
    });

    expect(result.link.thumbnail).toBeNull();
  });

  it("updates the existing row when the same url is saved again", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    const first = await upsertLink(db, firstSave);
    const second = await upsertLink(db, {
      url: firstSave.url,
      domain: firstSave.domain,
      title: "Updated Title",
      thumbnail: null,
    });

    expect(second.inserted).toBe(false);
    expect(second.link.id).toBe(first.link.id);
    expect(second.link.createdAt).toBe(first.link.createdAt);
    expect(second.link.title).toBe("Updated Title");
    expect(second.link.thumbnail).toBeNull();
    expect(second.link.updatedAt).toBeGreaterThanOrEqual(first.link.updatedAt);
  });

  it("repairs the domain of a legacy row that was saved before the column existed", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await db.insert(links).values({
      id: "legacy",
      url: firstSave.url,
      domain: "",
      title: "Legacy",
      thumbnail: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await upsertLink(db, firstSave);

    expect(result.inserted).toBe(false);
    expect(result.link.domain).toBe("example.com");
  });

  it("keeps exactly one row per url", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await upsertLink(db, firstSave);
    await upsertLink(db, { ...firstSave, title: "Second" });

    const rows = await listLinks(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Second");
  });

  it("treats concurrent saves of the same url as one row", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    const results = await Promise.all([
      upsertLink(db, firstSave),
      upsertLink(db, { ...firstSave, title: "Racer" }),
      upsertLink(db, { ...firstSave, title: "Racer" }),
    ]);

    const rows = await listLinks(db);

    expect(rows).toHaveLength(1);
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
  });
});

describe("listLinks", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("returns an empty array for an empty database", async () => {
    testDatabase = await createTestDatabase();

    expect(await listLinks(testDatabase.db)).toEqual([]);
  });

  it("returns the most recently saved link first", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await upsertLink(db, { ...firstSave, url: "https://example.com/1" });
    await upsertLink(db, { ...firstSave, url: "https://example.com/2" });
    await upsertLink(db, {
      ...firstSave,
      url: "https://example.com/3",
    });

    const rows = await listLinks(db);

    expect(rows.map((row) => row.url)).toEqual([
      "https://example.com/3",
      "https://example.com/2",
      "https://example.com/1",
    ]);
  });

  it("respects the limit", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await upsertLink(db, { ...firstSave, url: "https://example.com/1" });
    await upsertLink(db, { ...firstSave, url: "https://example.com/2" });
    await upsertLink(db, { ...firstSave, url: "https://example.com/3" });

    const rows = await listLinks(db, { limit: 2 });

    expect(rows).toHaveLength(2);
  });
});

/** A small collection spread over two domains, used by the filter suites. */
async function seed(db: TestDatabase["db"]): Promise<void> {
  const rows: LinkInput[] = [
    {
      url: "https://www.indoav.com/video/hotel-room",
      domain: "www.indoav.com",
      title: "Indonesian Couple In A Hotel Room",
      thumbnail: null,
    },
    {
      url: "https://www.indoav.com/video/pacar-jilbabku",
      domain: "www.indoav.com",
      title: "Maen Di Hotel Ama Pacar Jilbabku",
      thumbnail: null,
    },
    {
      url: "https://example.com/100%-off",
      domain: "example.com",
      title: "100% off everything",
      thumbnail: null,
    },
    {
      url: "https://example.com/foo_bar",
      domain: "example.com",
      title: "foo_bar naming",
      thumbnail: null,
    },
  ];

  for (const row of rows) {
    await upsertLink(db, row);
  }
}

describe("listLinks domain filter", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("returns only the requested domain", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { domain: "www.indoav.com" });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.domain === "www.indoav.com")).toBe(true);
  });

  it("returns nothing for an unknown domain", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(
      await listLinks(testDatabase.db, { domain: "nope.example" }),
    ).toEqual([]);
  });

  it("ignores an empty domain filter", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db, { domain: "" })).toHaveLength(4);
  });

  it("keeps the newest-first order within the filtered domain", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { domain: "www.indoav.com" });

    expect(rows.map((row) => row.title)).toEqual([
      "Maen Di Hotel Ama Pacar Jilbabku",
      "Indonesian Couple In A Hotel Room",
    ]);
  });

  it("applies the limit to the filtered set, not to the whole table", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, {
      domain: "www.indoav.com",
      limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe("www.indoav.com");
  });
});

describe("listLinks query filter", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("matches a title substring", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { query: "hotel" });

    expect(rows.map((row) => row.title)).toEqual([
      "Maen Di Hotel Ama Pacar Jilbabku",
      "Indonesian Couple In A Hotel Room",
    ]);
  });

  it("is case-insensitive", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { query: "HOTEL" });

    expect(rows).toHaveLength(2);
  });

  it("matches the url, so searching a domain works", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { query: "indoav" });

    expect(rows).toHaveLength(2);
  });

  it("matches text that only appears in the url", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { query: "pacar-jilbabku" });

    expect(rows).toHaveLength(1);
  });

  it("treats a percent sign literally", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { query: "100%" });

    expect(rows.map((row) => row.title)).toEqual(["100% off everything"]);
  });

  it("treats an underscore literally", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, { query: "foo_bar" });

    expect(rows).toHaveLength(1);
  });

  it("does not treat an underscore as a single-character wildcard", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await upsertLink(db, {
      url: "https://example.com/x",
      domain: "example.com",
      title: "fooXbar",
      thumbnail: null,
    });

    expect(await listLinks(db, { query: "foo_bar" })).toEqual([]);
  });

  it("escapes a backslash instead of treating it as the escape character", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db, { query: "\\" })).toEqual([]);
  });

  it("ignores an empty query", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db, { query: "" })).toHaveLength(4);
  });

  it("returns nothing when nothing matches", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db, { query: "zzzz" })).toEqual([]);
  });
});

describe("listLinks combined filters", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("narrows by domain and query together", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, {
      domain: "www.indoav.com",
      query: "hotel",
    });

    expect(rows).toHaveLength(2);
  });

  it("returns nothing when the query matches but the domain does not", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    const rows = await listLinks(testDatabase.db, {
      domain: "example.com",
      query: "hotel",
    });

    expect(rows).toEqual([]);
  });
});

describe("listDomains", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("returns an empty array for an empty database", async () => {
    testDatabase = await createTestDatabase();

    expect(await listDomains(testDatabase.db)).toEqual([]);
  });

  it("returns each domain once, with its link count", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listDomains(testDatabase.db)).toEqual([
      { domain: "example.com", count: 2 },
      { domain: "www.indoav.com", count: 2 },
    ]);
  });

  it("sorts alphabetically", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    for (const domain of ["zeta.com", "alpha.com", "mid.com"]) {
      await upsertLink(db, {
        url: `https://${domain}/x`,
        domain,
        title: domain,
        thumbnail: null,
      });
    }

    expect((await listDomains(db)).map((option) => option.domain)).toEqual([
      "alpha.com",
      "mid.com",
      "zeta.com",
    ]);
  });

  it("excludes a legacy row whose domain could not be backfilled", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await db.insert(links).values({
      id: "legacy",
      url: "weird://not-a-host",
      domain: "",
      title: "Legacy",
      thumbnail: null,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(await listDomains(db)).toEqual([]);
  });

  it("ignores the dashboard filters, so the dropdown always offers every domain", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listDomains(testDatabase.db)).toHaveLength(2);
  });
});

describe("countLinks", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("is zero for an empty database", async () => {
    testDatabase = await createTestDatabase();

    expect(await countLinks(testDatabase.db)).toBe(0);
  });

  it("counts every saved link", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await countLinks(testDatabase.db)).toBe(4);
  });
});

describe("favorite filter", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  async function star(db: TestDatabase["db"], url: string): Promise<void> {
    const row = (await listLinks(db)).find((link) => link.url === url);
    if (row === undefined) throw new Error(`no seeded link for ${url}`);

    const result = await updateLink(db, row.id, { isFavorite: true });
    if (!result.ok) throw new Error(`could not star ${url}`);
  }

  it("returns everything when the filter is off", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db, { favorite: false })).toHaveLength(4);
  });

  it("returns only starred links when it is on", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await star(db, "https://example.com/100%-off");

    const rows = await listLinks(db, { favorite: true });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe("https://example.com/100%-off");
    expect(rows[0]?.isFavorite).toBe(true);
  });

  it("returns nothing when nothing is starred", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db, { favorite: true })).toEqual([]);
  });

  it("combines with the other filters", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await star(db, "https://www.indoav.com/video/hotel-room");

    expect(await listLinks(db, { favorite: true, query: "hotel" })).toHaveLength(1);
    expect(await listLinks(db, { favorite: true, domain: "example.com" })).toEqual([]);
  });
});

describe("link scope", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("defaults to the visible scope, so nothing is hidden until a domain is locked", async () => {
    testDatabase = await createTestDatabase();
    await seed(testDatabase.db);

    expect(await listLinks(testDatabase.db)).toHaveLength(4);
  });

  it("drops the links of a locked domain from the visible scope", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    const rows = await listLinks(db);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.domain === "example.com")).toBe(true);
  });

  it("returns only the locked domains' links in the locked scope", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    const rows = await listLinks(db, { scope: "locked" });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.domain === "www.indoav.com")).toBe(true);
  });

  it("returns both sides when the scope is explicitly 'all'", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    // The ingestion API asks for "all": hiding a link from the userscript would
    // make saving it look broken. The dashboard never asks for it.
    expect(await listLinks(db, { scope: "all" })).toHaveLength(4);
    expect(await countLinks(db, { scope: "all" })).toBe(4);
  });

  it("keeps the filters working in the 'all' scope", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    expect(await listLinks(db, { query: "hotel", scope: "all" })).toHaveLength(2);
    expect(await listLinks(db, { domain: "example.com", scope: "all" })).toHaveLength(2);
  });

  it("keeps a locked domain's links out of search results", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    expect(await listLinks(db, { query: "hotel" })).toEqual([]);
    expect(await listLinks(db, { query: "hotel", scope: "locked" })).toHaveLength(2);
  });

  it("keeps a locked domain out of reach of the domain filter", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    expect(await listLinks(db, { domain: "www.indoav.com" })).toEqual([]);
    expect(await listLinks(db, { domain: "www.indoav.com", scope: "locked" })).toHaveLength(2);
  });

  it("applies the limit inside the scope", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    const rows = await listLinks(db, { limit: 1 });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe("example.com");
  });

  it("combines the scope with the favorites filter", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    const indoav = (await listLinks(db)).find((row) => row.domain === "www.indoav.com");
    if (indoav === undefined) throw new Error("seed is missing an indoav link");
    await updateLink(db, indoav.id, { isFavorite: true });
    await lockDomain(db, "www.indoav.com");

    expect(await listLinks(db, { favorite: true })).toEqual([]);
    expect(await listLinks(db, { favorite: true, scope: "locked" })).toHaveLength(1);
  });

  it("brings the links back when the domain is unlocked", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");
    await unlockDomain(db, "www.indoav.com");

    expect(await listLinks(db)).toHaveLength(4);
  });

  it("scopes the domain dropdown", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    expect(await listDomains(db)).toEqual([{ domain: "example.com", count: 2 }]);
    expect(await listDomains(db, { scope: "locked" })).toEqual([
      { domain: "www.indoav.com", count: 2 },
    ]);
  });

  it("can list every domain, ignoring the scope, for the lock panel's suggestions", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    expect(await listAllDomains(db)).toEqual([
      { domain: "example.com", count: 2 },
      { domain: "www.indoav.com", count: 2 },
    ]);
  });

  it("scopes the count used by the 'N of M' line", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seed(db);
    await lockDomain(db, "www.indoav.com");

    expect(await countLinks(db)).toBe(2);
    expect(await countLinks(db, { scope: "locked" })).toBe(2);
  });
});

describe("getLinkById", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("returns the stored row", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    const row = await getLinkById(db, saved.link.id);

    expect(row?.url).toBe(firstSave.url);
    expect(row?.isFavorite).toBe(false);
  });

  it("returns undefined for an unknown id", async () => {
    testDatabase = await createTestDatabase();

    expect(await getLinkById(testDatabase.db, "nope")).toBeUndefined();
  });

  it("finds a link that lives in a locked domain", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);
    await lockDomain(db, "example.com");

    expect((await getLinkById(db, saved.link.id))?.id).toBe(saved.link.id);
  });
});

describe("updateLink", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("updates the title, keeps createdAt, and touches updatedAt", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    const result = await updateLink(db, saved.link.id, { title: "New title" });

    expect(result).toEqual({
      ok: true,
      link: expect.objectContaining({
        id: saved.link.id,
        title: "New title",
        createdAt: saved.link.createdAt,
      }),
    });
    if (result.ok) {
      expect(result.link.updatedAt).toBeGreaterThanOrEqual(saved.link.updatedAt);
    }
  });

  it("recomputes the domain when the url changes", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    const result = await updateLink(db, saved.link.id, {
      url: "https://other.example/moved",
      domain: "other.example",
    });

    expect(result.ok && result.link.domain).toBe("other.example");
    expect(result.ok && result.link.url).toBe("https://other.example/moved");
  });

  it("toggles favorites on and off", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    const starred = await updateLink(db, saved.link.id, { isFavorite: true });
    expect(starred.ok && starred.link.isFavorite).toBe(true);

    const unstarred = await updateLink(db, saved.link.id, { isFavorite: false });
    expect(unstarred.ok && unstarred.link.isFavorite).toBe(false);
  });

  it("clears the thumbnail with an explicit null", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    const result = await updateLink(db, saved.link.id, { thumbnail: null });

    expect(result.ok && result.link.thumbnail).toBeNull();
  });

  it("reports an unknown id instead of creating a row", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    expect(await updateLink(db, "nope", { title: "x" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await listLinks(db)).toEqual([]);
  });

  it("refuses a url that another link already owns, and changes nothing", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const first = await upsertLink(db, firstSave);
    const second = await upsertLink(db, { ...firstSave, url: "https://example.com/second" });

    const result = await updateLink(db, second.link.id, {
      url: firstSave.url,
      domain: "example.com",
    });

    expect(result).toEqual({ ok: false, reason: "url-taken" });
    expect((await getLinkById(db, second.link.id))?.url).toBe("https://example.com/second");
  });

  it("allows saving a url that the same link already has", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    const result = await updateLink(db, saved.link.id, {
      url: firstSave.url,
      domain: "example.com",
      title: "Retitled",
    });

    expect(result.ok).toBe(true);
  });

  it("lets a link move into a locked domain, where it leaves the visible scope", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);
    await lockDomain(db, "example.com");

    const result = await updateLink(db, saved.link.id, {
      url: "https://visible.example/here",
      domain: "visible.example",
    });

    expect(result.ok).toBe(true);
    expect(await listLinks(db)).toHaveLength(1);
    expect(await listLinks(db, { scope: "locked" })).toEqual([]);
  });
});

describe("deleteLink", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("deletes the row and reports success", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);

    expect(await deleteLink(db, saved.link.id)).toBe(true);
    expect(await listLinks(db)).toEqual([]);
  });

  it("reports an unknown id without touching the others", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await upsertLink(db, firstSave);

    expect(await deleteLink(db, "nope")).toBe(false);
    expect(await listLinks(db)).toHaveLength(1);
  });

  it("deletes a link inside a locked domain", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const saved = await upsertLink(db, firstSave);
    await lockDomain(db, "example.com");

    expect(await deleteLink(db, saved.link.id)).toBe(true);
    expect(await countLinks(db, { scope: "locked" })).toBe(0);
  });
});

describe("album filter", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  /** Two albums over four links, two of which live on a hidden domain. */
  async function seedAlbum(db: TestDatabase["db"]): Promise<string> {
    const created = await createAlbum(db, {
      name: "Anime",
      nameKey: "anime",
      scope: "visible",
    });
    if (!created.ok) throw new Error("setup failed");

    const entries: LinkInput[] = [
      {
        url: "https://example.com/one",
        domain: "example.com",
        title: "One",
        thumbnail: null,
      },
      {
        url: "https://example.com/two",
        domain: "example.com",
        title: "Two",
        thumbnail: null,
      },
      {
        url: "https://hidden.example/three",
        domain: "hidden.example",
        title: "Three",
        thumbnail: null,
      },
    ];

    for (const entry of entries) {
      const saved = await upsertLink(db, entry);
      await addLinkToAlbum(db, created.album.id, saved.link.id);
    }

    await upsertLink(db, {
      url: "https://example.com/loose",
      domain: "example.com",
      title: "Loose",
      thumbnail: null,
    });

    return created.album.id;
  }

  it("keeps only the links that belong to the album", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const albumId = await seedAlbum(db);

    const rows = await listLinks(db, { albumId });

    expect(rows.map((row) => row.title).sort()).toEqual(["One", "Three", "Two"]);
  });

  it("counts the album, not the whole list", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const albumId = await seedAlbum(db);

    expect(await countLinks(db, { albumId })).toBe(3);
    expect(await countLinks(db)).toBe(4);
  });

  it("counts the album on one side of the divide only", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const albumId = await seedAlbum(db);
    await lockDomain(db, "hidden.example");

    expect(await countLinks(db, { albumId })).toBe(2);
    expect(await countLinks(db, { albumId, scope: "locked" })).toBe(1);
  });

  it("offers only the domains that appear inside the album", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const albumId = await seedAlbum(db);

    expect(await listDomains(db, { albumId })).toEqual([
      { domain: "example.com", count: 2 },
      { domain: "hidden.example", count: 1 },
    ]);
    await lockDomain(db, "hidden.example");
    expect(await listDomains(db, { albumId })).toEqual([
      { domain: "example.com", count: 2 },
    ]);
  });

  it("never returns the other side's links, even inside an album", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const albumId = await seedAlbum(db);
    await lockDomain(db, "hidden.example");

    const visible = await listLinks(db, { albumId });
    const locked = await listLinks(db, { albumId, scope: "locked" });

    expect(visible.map((row) => row.title).sort()).toEqual(["One", "Two"]);
    expect(locked.map((row) => row.title)).toEqual(["Three"]);
  });

  it("combines an album with the search and favorite filters", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    const albumId = await seedAlbum(db);

    expect(await listLinks(db, { albumId, query: "tw" })).toHaveLength(1);

    const saved = await listLinks(db, { albumId, query: "Tw" });
    const titleOnly = saved[0];
    if (titleOnly === undefined) throw new Error("setup failed");
    await updateLink(db, titleOnly.id, { isFavorite: true });

    expect(await listLinks(db, { albumId, favorite: true })).toHaveLength(1);
  });

  it("returns nothing for an unknown album", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await seedAlbum(db);

    expect(await listLinks(db, { albumId: "nope" })).toEqual([]);
    expect(await countLinks(db, { albumId: "nope" })).toBe(0);
  });
});
