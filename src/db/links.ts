import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { LinkInput } from "@/lib/validation";
import type { Database } from "./client";
import { links, lockedDomains, type Link, type NewLink } from "./schema";

export interface UpsertResult {
  link: Link;
  /** `true` when a new row was created, `false` when an existing row was updated. */
  inserted: boolean;
}

/**
 * Which side of the hidden/visible divide a query works on.
 *
 * - `visible` (the default) is the light dashboard: hidden domains are excluded.
 * - `locked` is the passcode-gated page: only hidden domains.
 * - `all` is the explicit opt-out, used by exactly one caller — the secret-key
 *   protected ingestion API, which is a machine interface and must keep seeing
 *   what it saved. Nothing a visitor looks at uses it.
 *
 * The filter lives in the SQL rather than in the callers, so a page cannot forget
 * it and leak a hidden link.
 */
export type LinkScope = "visible" | "locked" | "all";

export interface ScopeOptions {
  scope?: LinkScope;
}

export interface ListLinksOptions extends ScopeOptions {
  limit?: number;
  /** Exact domain match. `""` (or omitted) means "every domain". */
  domain?: string;
  /** Case-insensitive substring of the title or the url. `""` means "no search". */
  query?: string;
  /** `true` keeps only starred links; `false` (the default) applies no filter. */
  favorite?: boolean;
}

/** One entry of the dashboard's domain dropdown. */
export interface DomainOption {
  domain: string;
  count: number;
}

export interface UpdateLinkPatch {
  title?: string;
  url?: string;
  /** The host of the new `url`, derived by the validation layer. */
  domain?: string;
  thumbnail?: string | null;
  isFavorite?: boolean;
}

export type UpdateLinkResult =
  | { ok: true; link: Link }
  | { ok: false; reason: "not-found" | "url-taken" };

/**
 * Escapes the characters `LIKE` would otherwise treat as wildcards, so a search
 * for `100%` means "100%" rather than "100 followed by anything".
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The hidden/visible half of a query, as a subquery against `locked_domains`.
 * `locked_domains.domain` is the primary key, so it can never be NULL and
 * `NOT IN` cannot be tripped up by one. `all` needs no condition at all.
 */
function scopeCondition(scope: LinkScope): SQL | undefined {
  if (scope === "all") return undefined;

  return scope === "locked"
    ? sql`${links.domain} IN (SELECT ${lockedDomains.domain} FROM ${lockedDomains})`
    : sql`${links.domain} NOT IN (SELECT ${lockedDomains.domain} FROM ${lockedDomains})`;
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
  const conditions: SQL[] = [];

  const scope = scopeCondition(options.scope ?? "visible");
  if (scope !== undefined) {
    conditions.push(scope);
  }

  if (options.domain) {
    conditions.push(eq(links.domain, options.domain));
  }

  if (options.favorite === true) {
    conditions.push(eq(links.isFavorite, true));
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
      ) as SQL,
    );
  }

  const statement = db
    .select()
    .from(links)
    .where(and(...conditions))
    .orderBy(desc(links.updatedAt), desc(sql`rowid`));

  if (options.limit === undefined) {
    return statement;
  }

  return statement.limit(options.limit);
}

/**
 * Every domain on one side of the divide, alphabetically, with its link count.
 *
 * Deliberately ignores the other filters: the dropdown must always be able to
 * offer the domain a visitor wants to switch to. A row whose backfilled domain
 * came out empty is skipped, because `""` is not a meaningful choice.
 */
export async function listDomains(
  db: Database,
  options: ScopeOptions = {},
): Promise<DomainOption[]> {
  return db
    .select({ domain: links.domain, count: count() })
    .from(links)
    .where(and(ne(links.domain, ""), scopeCondition(options.scope ?? "visible")))
    .groupBy(links.domain)
    .orderBy(asc(links.domain));
}

/**
 * Every domain, hidden or not, for the locked panel's suggestions. Only reachable
 * from the passcode-gated page, which is the one place allowed to know that a
 * visible domain exists next to the hidden ones.
 */
export async function listAllDomains(db: Database): Promise<DomainOption[]> {
  return db
    .select({ domain: links.domain, count: count() })
    .from(links)
    .where(ne(links.domain, ""))
    .groupBy(links.domain)
    .orderBy(asc(links.domain));
}

/** Number of links on one side of the divide, so the dashboard can say "3 of 12". */
export async function countLinks(
  db: Database,
  options: ScopeOptions = {},
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(links)
    .where(scopeCondition(options.scope ?? "visible"));

  return rows[0]?.value ?? 0;
}

/** Reads one link regardless of scope; the dashboard only knows ids it has seen. */
export async function getLinkById(
  db: Database,
  id: string,
): Promise<Link | undefined> {
  const rows = await db.select().from(links).where(eq(links.id, id)).limit(1);

  return rows[0];
}

/**
 * Applies an edit. Only the fields present in `patch` are written, so a favorite
 * toggle cannot accidentally clear a thumbnail.
 *
 * Toggling a favorite does *not* touch `updatedAt`: the list is ordered by it, and
 * a star should not make the card jump to the top of the grid.
 *
 * A URL that another link already owns is refused, reported as `url-taken`. The
 * check is a query first and the unique index second, so even a race cannot
 * corrupt the table.
 */
export async function updateLink(
  db: Database,
  id: string,
  patch: UpdateLinkPatch,
): Promise<UpdateLinkResult> {
  const existing = await getLinkById(db, id);
  if (existing === undefined) {
    return { ok: false, reason: "not-found" };
  }

  if (patch.url !== undefined && patch.url !== existing.url) {
    const owner = await getLinkByUrl(db, patch.url);
    if (owner !== undefined && owner.id !== id) {
      return { ok: false, reason: "url-taken" };
    }
  }

  const values: Partial<NewLink> = {};

  if (patch.title !== undefined) values.title = patch.title;
  if (patch.url !== undefined) values.url = patch.url;
  if (patch.domain !== undefined) values.domain = patch.domain;
  if (patch.thumbnail !== undefined) values.thumbnail = patch.thumbnail;
  if (patch.isFavorite !== undefined) values.isFavorite = patch.isFavorite;

  const touchesContent =
    values.title !== undefined ||
    values.url !== undefined ||
    values.domain !== undefined ||
    values.thumbnail !== undefined;

  if (touchesContent) {
    values.updatedAt = Date.now();
  }

  try {
    const rows = await db
      .update(links)
      .set(values)
      .where(eq(links.id, id))
      .returning();

    const row = rows[0];
    if (row === undefined) {
      return { ok: false, reason: "not-found" };
    }

    return { ok: true, link: row };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "url-taken" };
    }

    throw error;
  }
}

/** Permanently removes a link. Reports `false` when there was nothing to delete. */
export async function deleteLink(db: Database, id: string): Promise<boolean> {
  const removed = await db.delete(links).where(eq(links.id, id)).returning();

  return removed.length > 0;
}

async function getLinkByUrl(db: Database, url: string): Promise<Link | undefined> {
  const rows = await db.select().from(links).where(eq(links.url, url)).limit(1);

  return rows[0];
}

/** libSQL reports a unique-index clash in the error message, not a stable code. */
function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);

  return /unique constraint/i.test(text);
}
