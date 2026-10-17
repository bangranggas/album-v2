import { afterEach, describe, expect, it } from "vitest";

import { countLinks, listDomains, listLinks, upsertLink } from "@/db/links";
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
