import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  client: Client;
}

/**
 * Builds a database handle for an explicit connection target.
 * Kept separate from `getDb()` so tests can create isolated databases.
 */
export function createDatabase(options: {
  url: string;
  authToken?: string;
}): DatabaseHandle {
  const client = createClient({
    url: options.url,
    authToken: options.authToken,
  });

  return {
    db: drizzle(client, { schema }),
    client,
  };
}

/**
 * Handles are cached per connection URL. In production there is exactly one URL,
 * so this behaves as a singleton; in tests each temp-file URL gets its own handle
 * without any test-only reset hook.
 */
const handles = new Map<string, DatabaseHandle>();

export function getDatabaseHandle(): DatabaseHandle {
  const url = process.env.TURSO_DATABASE_URL;

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  let handle = handles.get(url);
  if (!handle) {
    handle = createDatabase({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    handles.set(url, handle);
  }

  return handle;
}

/** Convenience accessor for the default connection. */
export function getDb(): Database {
  return getDatabaseHandle().db;
}
