import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { albumLinks, albums, links, lockedDomains } from "@/db/schema";
import {
  createTestDatabase,
  readMigrationStatements,
  type TestDatabase,
} from "./helpers/test-db";

/**
 * The migration that gives albums a side is the only dangerous part of the
 * feature: it rewrites a column on rows that already exist. So the test builds the
 * schema as it was *before* that migration, fills it with legacy data, and then
 * applies the migration statement by statement — the same SQL that reaches
 * production.
 */
const BEFORE_SCOPE = { before: "0004" };
const SCOPE_MIGRATION = { from: "0004" };

const LEGACY_LINK_IDS = ["visible-1", "hidden-1", "hidden-2"];
const LEGACY_MEMBERSHIPS = 5;

/**
 * The legacy rows, written as raw SQL on purpose: this is the *old* shape of the
 * tables, which the current Drizzle schema (it knows about `scope`) cannot express.
 */
const LEGACY_ROWS = [
  `INSERT INTO links (id, url, domain, title, thumbnail, is_favorite, created_at, updated_at) VALUES
     ('visible-1', 'https://example.com/visible-1', 'example.com', 'visible-1', NULL, 0, 1700000000000, 1700000000000),
     ('hidden-1', 'https://hidden.example/hidden-1', 'hidden.example', 'hidden-1', NULL, 0, 1700000000000, 1700000000000),
     ('hidden-2', 'https://hidden.example/hidden-2', 'hidden.example', 'hidden-2', NULL, 0, 1700000000000, 1700000000000)`,
  `INSERT INTO locked_domains (domain, created_at) VALUES ('hidden.example', 1700000000000)`,
  `INSERT INTO albums (id, name, name_key, created_at) VALUES
     ('album-hidden', 'Hidden only', 'hidden only', 1),
     ('album-mixed', 'Mixed', 'mixed', 2),
     ('album-empty', 'Empty', 'empty', 3),
     ('album-visible', 'Visible only', 'visible only', 4)`,
  `INSERT INTO album_links (album_id, link_id, created_at) VALUES
     ('album-hidden', 'hidden-1', 1),
     ('album-hidden', 'hidden-2', 2),
     ('album-mixed', 'hidden-1', 3),
     ('album-mixed', 'visible-1', 4),
     ('album-visible', 'visible-1', 5)`,
];

describe("album scope migration", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  /**
   * A pre-scope database holding one of each legacy shape: an album with only
   * hidden links, a mixed one, an empty one, and one with only visible links.
   */
  async function legacyDatabase(): Promise<TestDatabase> {
    const database = await createTestDatabase(BEFORE_SCOPE);

    for (const statement of LEGACY_ROWS) {
      await database.client.execute(statement);
    }

    return database;
  }

  async function applyScopeMigration(database: TestDatabase): Promise<void> {
    for (const statement of readMigrationStatements(SCOPE_MIGRATION)) {
      await database.client.execute(statement);
    }
  }

  async function scopeOf(
    database: TestDatabase,
    id: string,
  ): Promise<string | undefined> {
    const rows = await database.db.all<{ scope: string }>(
      sql`SELECT scope FROM albums WHERE id = ${id}`,
    );

    return rows[0]?.scope;
  }

  it("moves an album that holds only hidden links to the locked side", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    expect(await scopeOf(testDatabase, "album-hidden")).toBe("locked");
  });

  it("leaves a mixed album on the visible side", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    expect(await scopeOf(testDatabase, "album-mixed")).toBe("visible");
  });

  it("leaves an empty album and a visible-only album on the visible side", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    expect(await scopeOf(testDatabase, "album-empty")).toBe("visible");
    expect(await scopeOf(testDatabase, "album-visible")).toBe("visible");
  });

  it("keeps every membership row", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    const rows = await testDatabase.db.select().from(albumLinks);

    expect(rows).toHaveLength(LEGACY_MEMBERSHIPS);
    expect(rows.map((row) => row.linkId).sort()).toEqual([
      "hidden-1",
      "hidden-1",
      "hidden-2",
      "visible-1",
      "visible-1",
    ]);
  });

  it("keeps every link and locked domain row", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    const linkRows = await testDatabase.db.select().from(links);
    const domainRows = await testDatabase.db.select().from(lockedDomains);

    expect(linkRows).toHaveLength(LEGACY_LINK_IDS.length);
    expect(domainRows.map((row) => row.domain)).toEqual(["hidden.example"]);
  });

  it("replaces the global name index with a per-side one", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    const rows = await testDatabase.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'albums'`,
    );
    const names = rows.map((row) => row.name);

    expect(names).toContain("albums_scope_name_key_unique");
    expect(names).not.toContain("albums_name_key_unique");
  });

  it("allows the same name on both sides but not twice on one side", async () => {
    testDatabase = await legacyDatabase();

    await applyScopeMigration(testDatabase);

    // `mixed` now lives on the visible side; the locked side is free.
    await testDatabase.db.insert(albums).values({
      id: "album-locked-twin",
      name: "Mixed",
      nameKey: "mixed",
      scope: "locked",
      createdAt: 6,
    });

    await expect(
      testDatabase.db.insert(albums).values({
        id: "album-duplicate",
        name: "MIXED",
        nameKey: "mixed",
        scope: "visible",
        createdAt: 7,
      }),
    ).rejects.toThrow();
  });
});
