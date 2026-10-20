import { afterEach, describe, expect, it } from "vitest";

import { links } from "@/db/schema";
import {
  createTestDatabase,
  readMigrationStatements,
  type TestDatabase,
} from "./helpers/test-db";

describe("test database helper", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("applies the generated migration and accepts reads and writes", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await db.insert(links).values({
      id: "link-1",
      url: "https://example.com/a",
      domain: "example.com",
      title: "Example",
      thumbnail: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const rows = await db.select().from(links);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe("https://example.com/a");
    expect(rows[0]?.thumbnail).toBeNull();
  });

  it("enforces the unique index on url", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    const row = {
      id: "link-1",
      url: "https://example.com/duplicate",
      domain: "example.com",
      title: "First",
      thumbnail: null,
      createdAt: 1,
      updatedAt: 1,
    };

    await db.insert(links).values(row);

    await expect(
      db.insert(links).values({ ...row, id: "link-2" }),
    ).rejects.toThrow();
  });

  it("can stop at an older migration, so a later one can be replayed on real data", async () => {
    const all = readMigrationStatements();
    const beforeLatest = readMigrationStatements({ before: "0004" });
    const latest = readMigrationStatements({ from: "0004" });

    // Every statement is in exactly one of the two halves, in order — that is what
    // lets a test build the old schema, fill it, and then migrate it forward.
    expect(beforeLatest.length + latest.length).toBe(all.length);
    expect(all.slice(0, beforeLatest.length)).toEqual(beforeLatest);
    expect(all.slice(beforeLatest.length)).toEqual(latest);
    expect(latest.length).toBeGreaterThan(0);
  });
});
