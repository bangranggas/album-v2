import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Client } from "@libsql/client";

import { createDatabase, type Database } from "@/db/client";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Which migration files to read. `before` stops just before a prefix (so a test
 * can build the schema as it was, insert legacy rows, and then migrate them), and
 * `from` starts at one (so the same test can replay that migration on its own).
 */
export interface MigrationFilter {
  before?: string;
  from?: string;
}

/**
 * Reads the real Drizzle migrations so tests exercise the same DDL that ships to
 * production, instead of a hand-written copy that can silently drift.
 */
export function readMigrationStatements(
  filter: MigrationFilter = {},
): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter(
      (file) =>
        (filter.before === undefined || file < filter.before) &&
        (filter.from === undefined || file >= filter.from),
    )
    .flatMap((file) =>
      readFileSync(join(MIGRATIONS_DIR, file), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0),
    );
}

export interface TestDatabase {
  db: Database;
  client: Client;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated database with the production schema applied.
 *
 * Uses an in-memory libSQL database: every client gets its own private database,
 * so tests cannot leak state into each other and nothing has to be written to
 * (or deleted from) disk.
 *
 * `filter` narrows the migrations that are applied, which is what lets a test
 * rebuild an older schema on purpose.
 */
export async function createTestDatabase(
  filter: MigrationFilter = {},
): Promise<TestDatabase> {
  const { db, client } = createDatabase({ url: ":memory:" });

  for (const statement of readMigrationStatements(filter)) {
    await client.execute(statement);
  }

  return {
    db,
    client,
    async cleanup() {
      client.close();
    },
  };
}
