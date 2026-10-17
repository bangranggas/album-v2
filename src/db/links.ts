import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, ne, or, sql } from "drizzle-orm";

import type { LinkInput } from "@/lib/validation";
import type { Database } from "./client";
import { links, type Link } from "./schema";

export interface UpsertResult {
  link: Link;
  /** `true` when a new row was created, `false` when an existing row was updated. */
  inserted: boolean;
}

export interface ListLinksOptions {
  limit?: number;
  /** Exact domain match. `""` (or omitted) means "every domain". */
  domain?: string;
  /** Case-insensitive substring of the title or the url. `""` means "no search". */
  query?: string;
}

/** One entry of the dashboard's domain dropdown. */
export interface DomainOption {
  domain: string;
  count: number;
}

/**
 * Escapes the characters `LIKE` would otherwise treat as wildcards, so a search
 * for `100%` means "100%" rather than "100 followed by anything".
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Saves a link, keyed on `url`.
 *
 * Two statements instead of one `ON CONFLICT DO UPDATE` so the caller can tell an
 * insert from an update: the insert uses `DO NOTHING`, which is race-safe (two
 * concurrent saves of a new URL cannot both win), and a no-op insert falls
 * through to the update.
 *
 * The update also rewrites `domain`, which repairs a row saved before the column
 * existed (its value would still be the migration's placeholder).
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
      domain: input.domain,
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
      domain: input.domain,
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
 *
 * Filters are applied in SQL, and `limit` therefore caps the *filtered* set, so
 * narrowing the view can never lose matches to the cap.
 */
export async function listLinks(
  db: Database,
  options: ListLinksOptions = {},
): Promise<Link[]> {
  const conditions = [];

  if (options.domain) {
    conditions.push(eq(links.domain, options.domain));
  }

  const query = options.query?.trim() ?? "";
  if (query !== "") {
    const pattern = `%${escapeLikePattern(query)}%`;

    // `ESCAPE '\'` makes the escaping above effective; without it SQLite would
    // keep interpreting the backslashes as ordinary characters.
    conditions.push(
      or(
        sql`${links.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${links.url} LIKE ${pattern} ESCAPE '\\'`,
      ),
    );
  }

  const statement = db
    .select()
    .from(links)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(links.updatedAt), desc(sql`rowid`));

  if (options.limit === undefined) {
    return statement;
  }

  return statement.limit(options.limit);
}

/**
 * Every domain that has at least one link, alphabetically, with its link count.
 *
 * Deliberately ignores the dashboard's filters: the dropdown must always be able
 * to offer the domain a visitor wants to switch to. A row whose backfilled domain
 * came out empty is skipped, because "" is not a meaningful choice.
 */
export async function listDomains(db: Database): Promise<DomainOption[]> {
  return db
    .select({ domain: links.domain, count: count() })
    .from(links)
    .where(ne(links.domain, ""))
    .groupBy(links.domain)
    .orderBy(asc(links.domain));
}

/** Total number of saved links, so the dashboard can say "3 of 12 links". */
export async function countLinks(db: Database): Promise<number> {
  const rows = await db.select({ value: count() }).from(links);

  return rows[0]?.value ?? 0;
}
