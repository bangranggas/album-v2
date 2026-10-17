import { afterEach, describe, expect, it } from "vitest";

import { listLinks, upsertLink } from "@/db/links";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const firstSave = {
  url: "https://example.com/article",
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
    const newest = await upsertLink(db, {
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
