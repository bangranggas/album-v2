import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { AlbumNameInput } from "@/lib/validation";
import { COLLAGE_SLOTS } from "@/lib/albums";
import type { BulkAddCounts } from "@/lib/link-selection";
import type { Database } from "./client";
import { scopeCondition, type LinkScope } from "./links";
import { albumLinks, albums, links, type Album } from "./schema";
import { escapeLikePattern, isUniqueViolation } from "./sql-support";

/** One album as the Albums tab needs it: identity, plus this side's statistics. */
export interface AlbumSummary {
  id: string;
  name: string;
  createdAt: number;
  /** Links in this album *on the requested side* of the hidden/visible divide. */
  linkCount: number;
  /** Up to four thumbnail URLs, most recently updated first, in the same scope. */
  covers: string[];
  /**
   * Domain of the album's most recently updated link *in scope*, for the grey
   * placeholder when nothing has a thumbnail. `null` when the album has no links
   * on this side at all.
   */
  firstDomain: string | null;
}

/** Identity of an album, as the checkbox list and the pages' props need it. */
export interface AlbumOption {
  id: string;
  name: string;
}

export interface ListAlbumsOptions {
  scope?: LinkScope;
  /** Case-insensitive substring of the name. `""` means "no search". */
  query?: string;
  limit?: number;
}

export type CreateAlbumResult =
  | { ok: true; album: Album }
  | { ok: false; reason: "name-taken" };

export type AlbumWriteResult =
  | { ok: true; album: Album }
  | { ok: false; reason: "name-taken" | "not-found" };

export type MembershipResult =
  | "added"
  | "already"
  | "album-not-found"
  | "link-not-found";

/** The outcome of a bulk add: what was new, what was there, what was unknown. */
export type BulkAddResult = BulkAddCounts | "album-not-found";

/**
 * Creates an album. `nameKey` is what actually has to be unique, so the unique
 * index — not an application-level check — is what decides a conflict, and a race
 * between two tabs cannot create `Anime` twice.
 */
export async function createAlbum(
  db: Database,
  input: AlbumNameInput,
): Promise<CreateAlbumResult> {
  try {
    const rows = await db
      .insert(albums)
      .values({
        id: randomUUID(),
        name: input.name,
        nameKey: input.nameKey,
        createdAt: Date.now(),
      })
      .returning();

    const album = rows[0];
    if (album === undefined) {
      throw new Error(`Failed to create album: ${input.name}`);
    }

    return { ok: true, album };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "name-taken" };
    }

    throw error;
  }
}

/**
 * Renames an album.
 *
 * Renaming to the same key is deliberately *not* a conflict: that is how the
 * owner changes only the capitalisation (`Anime` → `ANIME`). Anything that would
 * collide with a different album is refused before the update, and the unique
 * index catches the race after it.
 */
export async function renameAlbum(
  db: Database,
  id: string,
  input: AlbumNameInput,
): Promise<AlbumWriteResult> {
  const existing = await getAlbumById(db, id);
  if (existing === undefined) {
    return { ok: false, reason: "not-found" };
  }

  const owner = await getAlbumByNameKey(db, input.nameKey);
  if (owner !== undefined && owner.id !== id) {
    return { ok: false, reason: "name-taken" };
  }

  try {
    const rows = await db
      .update(albums)
      .set({ name: input.name, nameKey: input.nameKey })
      .where(eq(albums.id, id))
      .returning();

    const album = rows[0];
    if (album === undefined) {
      return { ok: false, reason: "not-found" };
    }

    return { ok: true, album };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "name-taken" };
    }

    throw error;
  }
}

/**
 * Deletes an album and its memberships. The links themselves are untouched: an
 * album is a view, not a container.
 */
export async function deleteAlbum(db: Database, id: string): Promise<boolean> {
  const removed = await db.delete(albums).where(eq(albums.id, id)).returning();

  if (removed.length === 0) {
    return false;
  }

  await db.delete(albumLinks).where(eq(albumLinks.albumId, id));

  return true;
}

export async function getAlbumById(
  db: Database,
  id: string,
): Promise<Album | undefined> {
  const rows = await db.select().from(albums).where(eq(albums.id, id)).limit(1);

  return rows[0];
}

/**
 * Every album with its scoped link count and cover collage, ordered by name.
 *
 * The count comes from a LEFT JOIN so an empty album (or one holding only links
 * of the other side) still appears with `0` instead of vanishing — that is what
 * makes the two tabs agree on which albums exist.
 */
export async function listAlbums(
  db: Database,
  options: ListAlbumsOptions = {},
): Promise<AlbumSummary[]> {
  const scope = options.scope ?? "visible";
  const conditions: SQL[] = [];

  const query = options.query?.trim() ?? "";
  if (query !== "") {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(
      sql`${albums.name} LIKE ${pattern} ESCAPE '\\'`,
    );
  }

  const albumQuery = db
    .select({
      id: albums.id,
      name: albums.name,
      createdAt: albums.createdAt,
      linkCount: count(links.id),
    })
    .from(albums)
    .leftJoin(albumLinks, eq(albumLinks.albumId, albums.id))
    .leftJoin(links, and(eq(links.id, albumLinks.linkId), scopeCondition(scope)))
    .where(and(...conditions))
    .groupBy(albums.id, albums.name, albums.createdAt)
    // `lower(name)` so the order ignores case; `createdAt` breaks the tie.
    .orderBy(sql`lower(${albums.name})`, asc(albums.createdAt));

  const previewQuery = readPreviews(db, scope);

  const [rows, previews] = await Promise.all([
    options.limit === undefined ? albumQuery : albumQuery.limit(options.limit),
    previewQuery,
  ]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    linkCount: row.linkCount,
    covers: previews.get(row.id)?.covers ?? [],
    firstDomain: previews.get(row.id)?.firstDomain ?? null,
  }));
}

/**
 * Total number of albums, for the `"2 of 5 albums"` line.
 *
 * Deliberately not scoped: an album's *name* is a label the owner chose, and the
 * requirements treat it as non-secret, so both pages agree on how many albums exist
 * even when an album holds only links of the other side.
 */
export async function countAlbums(db: Database): Promise<number> {
  const rows = await db.select({ value: count() }).from(albums);

  return rows[0]?.value ?? 0;
}

/**
 * Just the identity of every album, for the per-card "add to album" popup: the
 * checkbox list needs names, not scoped counts and covers.
 *
 * Returned for both pages, in the same order as the Albums tab, because a name is
 * a label rather than link data — filing a visible link under an album that
 * currently only holds hidden links must stay possible.
 */
export async function listAlbumOptions(db: Database): Promise<AlbumOption[]> {
  const rows = await db
    .select({ id: albums.id, name: albums.name })
    .from(albums)
    .orderBy(sql`lower(${albums.name})`, asc(albums.createdAt));

  return rows;
}

interface AlbumPreview {
  covers: string[];
  firstDomain: string | null;
}

/**
 * Every album's cover collage and placeholder domain, in one query.
 *
 * A window function is what makes this correct *and* bounded: the alternative —
 * reading every (album, link) pair and slicing in JavaScript — would either scan
 * an unbounded number of rows or silently give later albums no cover at all. Two
 * rankings are computed over the same pass, so the collage (the newest four links
 * that *have* a thumbnail) and the placeholder (the single newest link, thumbnail
 * or not) can never disagree about which link is the most recent.
 *
 * The scope condition is the shared `scopeCondition` fragment, so a hidden link's
 * thumbnail or domain cannot reach the light dashboard through a cover.
 */
async function readPreviews(
  db: Database,
  scope: LinkScope,
): Promise<Map<string, AlbumPreview>> {
  const condition = scopeCondition(scope);
  const scoped = condition === undefined ? sql`` : sql` WHERE ${condition}`;

  const rows = await db.all<{
    album_id: string;
    domain: string;
    thumbnail: string | null;
    recency: number;
  }>(sql`
    SELECT album_id, domain, thumbnail, recency
    FROM (
      SELECT
        al.album_id AS album_id,
        links.domain AS domain,
        links.thumbnail AS thumbnail,
        ROW_NUMBER() OVER (
          PARTITION BY al.album_id
          ORDER BY links.updated_at DESC, links.rowid DESC
        ) AS recency,
        ROW_NUMBER() OVER (
          PARTITION BY al.album_id, (links.thumbnail IS NOT NULL)
          ORDER BY links.updated_at DESC, links.rowid DESC
        ) AS cover_rank
      FROM album_links al
      INNER JOIN links ON links.id = al.link_id${scoped}
    )
    WHERE recency = 1 OR (thumbnail IS NOT NULL AND cover_rank <= ${COLLAGE_SLOTS})
    ORDER BY album_id, recency
  `);

  const previews = new Map<string, AlbumPreview>();

  for (const row of rows) {
    const preview = previews.get(row.album_id) ?? {
      covers: [],
      firstDomain: null,
    };

    if (row.recency === 1) {
      preview.firstDomain = row.domain;
    }

    if (
      typeof row.thumbnail === "string" &&
      preview.covers.length < COLLAGE_SLOTS
    ) {
      preview.covers.push(row.thumbnail);
    }

    previews.set(row.album_id, preview);
  }

  return previews;
}

/**
 * Album ids per link, for a whole page of cards in one query: the card popup
 * needs "which albums is this link already in?", and asking per card would be an
 * N+1.
 *
 * A link that belongs to nothing is simply absent from the map.
 */
export async function listAlbumIdsByLink(
  db: Database,
  linkIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (linkIds.length === 0) return new Map();

  const placeholders = sql.join(
    linkIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const rows = await db.all<{ album_id: string; link_id: string }>(sql`
    SELECT album_id, link_id
    FROM album_links
    WHERE link_id IN (${placeholders})
    ORDER BY album_id
  `);

  const memberships = new Map<string, string[]>();

  for (const row of rows) {
    const collected = memberships.get(row.link_id) ?? [];
    collected.push(row.album_id);
    memberships.set(row.link_id, collected);
  }

  return memberships;
}

/**
 * Adds a link to an album. Idempotent: the composite primary key makes a repeat a
 * no-op, reported as `already`, so a double click can never create a duplicate or
 * an error.
 */
export async function addLinkToAlbum(
  db: Database,
  albumId: string,
  linkId: string,
): Promise<MembershipResult> {
  const album = await getAlbumById(db, albumId);
  if (album === undefined) return "album-not-found";

  const link = await db
    .select({ id: links.id })
    .from(links)
    .where(eq(links.id, linkId))
    .limit(1);
  if (link[0] === undefined) return "link-not-found";

  const inserted = await db
    .insert(albumLinks)
    .values({ albumId, linkId, createdAt: Date.now() })
    .onConflictDoNothing({ target: [albumLinks.albumId, albumLinks.linkId] })
    .returning();

  return inserted.length > 0 ? "added" : "already";
}

/**
 * Adds many links to one album in a single request.
 *
 * Idempotent, like `addLinkToAlbum`, and honest about the three outcomes: ids
 * that were new (`added`), ids that were already in the album (`alreadyIn`), and
 * ids that no longer exist (`skipped`).
 *
 * Unknown ids are filtered out *before* the insert because `album_links` has no
 * foreign key: an unguarded insert would leave a row that no page could ever show
 * or clean up. The checks and the insert share one transaction, so the reported
 * counts describe the same instant the write saw.
 */
export async function addLinksToAlbum(
  db: Database,
  albumId: string,
  linkIds: readonly string[],
): Promise<BulkAddResult> {
  const ids = [...new Set(linkIds)];

  return db.transaction(async (tx) => {
    const album = await tx
      .select({ id: albums.id })
      .from(albums)
      .where(eq(albums.id, albumId))
      .limit(1);
    if (album[0] === undefined) return "album-not-found";
    if (ids.length === 0) return { added: 0, alreadyIn: 0, skipped: 0 };

    const existing = await tx
      .select({ id: links.id })
      .from(links)
      .where(inArray(links.id, ids));
    const insertable = ids.filter((id) =>
      existing.some((row) => row.id === id),
    );

    // One lookup for the whole selection: asking per link would be an N+1.
    const members =
      insertable.length === 0
        ? []
        : await tx
            .select({ linkId: albumLinks.linkId })
            .from(albumLinks)
            .where(
              and(
                eq(albumLinks.albumId, albumId),
                inArray(albumLinks.linkId, insertable),
              ),
            );
    const fresh = insertable.filter(
      (id) => !members.some((row) => row.linkId === id),
    );

    const createdAt = Date.now();
    const inserted =
      fresh.length === 0
        ? []
        : await tx
            .insert(albumLinks)
            .values(fresh.map((linkId) => ({ albumId, linkId, createdAt })))
            .onConflictDoNothing({
              target: [albumLinks.albumId, albumLinks.linkId],
            })
            .returning({ linkId: albumLinks.linkId });

    return {
      added: inserted.length,
      alreadyIn: insertable.length - inserted.length,
      skipped: ids.length - insertable.length,
    };
  });
}

/**
 * Removes a link from an album. Reports `false` when the pair did not exist,
 * which lets the caller answer `404` for a card that is already out of date.
 */
export async function removeLinkFromAlbum(
  db: Database,
  albumId: string,
  linkId: string,
): Promise<boolean> {
  const removed = await db
    .delete(albumLinks)
    .where(and(eq(albumLinks.albumId, albumId), eq(albumLinks.linkId, linkId)))
    .returning();

  return removed.length > 0;
}

async function getAlbumByNameKey(
  db: Database,
  nameKey: string,
): Promise<Album | undefined> {
  const rows = await db
    .select()
    .from(albums)
    .where(eq(albums.nameKey, nameKey))
    .limit(1);

  return rows[0];
}
