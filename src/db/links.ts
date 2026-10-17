import { randomUUID } from "node:crypto";

import { desc, eq, sql } from "drizzle-orm";

import type { LinkInput } from "@/lib/validation";
import type { Database } from "./client";
import { links, type Link } from "./schema";

export interface UpsertResult {
  link: Link;
  /** `true` when a new row was created, `false` when an existing row was updated. */
  inserted: boolean;
}

/**
 * Saves a link, keyed on `url`.
 *
 * Two statements instead of one `ON CONFLICT DO UPDATE` so the caller can tell an
 * insert from an update: the insert uses `DO NOTHING`, which is race-safe (two
 * concurrent saves of a new URL cannot both win), and a no-op insert falls
 * through to the update.
 */
export async function upsertLink(
  db: Database,
  input: LinkInput,
): Promise<UpsertResult> {
  const now = Date.now();

  const insertedRows = await db
    .insert(links)
    .values({
      id: randomUUID(),
      url: input.url,
      title: input.title,
      thumbnail: input.thumbnail,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: links.url })
    .returning();

  const insertedRow = insertedRows[0];
  if (insertedRow) {
    return { link: insertedRow, inserted: true };
  }

  const updatedRows = await db
    .update(links)
    .set({
      title: input.title,
      thumbnail: input.thumbnail,
      updatedAt: now,
    })
    .where(eq(links.url, input.url))
    .returning();

  const updatedRow = updatedRows[0];
  if (!updatedRow) {
    throw new Error(`Failed to upsert link: ${input.url}`);
  }

  return { link: updatedRow, inserted: false };
}

/**
 * Most recently saved first. Ordered by `updatedAt` so re-saving an old link
 * moves it back to the top, matching what the dashboard displays.
 *
 * `rowid` is the tiebreaker: `Date.now()` only has millisecond resolution, so
 * several saves can share a timestamp, and without a tiebreaker their relative
 * order would be undefined.
 */
export async function listLinks(
  db: Database,
  options: { limit?: number } = {},
): Promise<Link[]> {
  const query = db
    .select()
    .from(links)
    .orderBy(desc(links.updatedAt), desc(sql`rowid`));

  if (options.limit === undefined) {
    return query;
  }

  return query.limit(options.limit);
}
