import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Saved links. One row per unique URL; re-saving a URL updates the existing row.
 *
 * Timestamps are stored as unix epoch milliseconds (integer) so ordering and
 * "inserted vs updated" logic stay deterministic across runtimes.
 *
 * `domain` is the lowercased host of `url`, derived once during validation. It is
 * stored (rather than parsed from `url` on every read) so the dashboard can group
 * and filter on a plain, indexed equality.
 *
 * `isFavorite` keeps a starred link in the same table: it is a property of the
 * link, not a separate collection, and it is filtered in SQL like any other.
 */
export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title").notNull(),
    thumbnail: text("thumbnail"),
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("links_url_unique").on(table.url),
    index("links_domain_idx").on(table.domain),
  ],
);

/**
 * Domains whose links are hidden from the normal dashboard.
 *
 * Locking is a property of the *domain*, so a link saved later to a locked domain
 * is hidden too, and hiding is expressed as a subquery in every read
 * (`domain IN (...)`) rather than a flag on each row that a write could forget.
 */
export const lockedDomains = sqliteTable("locked_domains", {
  domain: text("domain").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type LockedDomain = typeof lockedDomains.$inferSelect;
export type NewLockedDomain = typeof lockedDomains.$inferInsert;

/**
 * User-created collections. An album is a *view* over links that also live on the
 * main list — nothing is copied, so favorite/edit/delete and the hidden-domain
 * rules keep applying to the original row.
 *
 * `name` is what the owner sees; `nameKey` is `name.toLowerCase()` and is the only
 * uniqueness key, so `Anime` and `anime` cannot both exist. Storing it as a plain
 * column keeps the constraint a portable unique index instead of an expression
 * index, and makes the conflict check a simple equality.
 */
export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("albums_name_key_unique").on(table.nameKey)],
);

/**
 * The many-to-many membership between albums and links.
 *
 * The composite primary key makes a duplicate pair impossible, so "add the same
 * link twice" is a no-op at the database level rather than a rule the callers have
 * to remember. There is no foreign key: the project never enables
 * `PRAGMA foreign_keys`, so cascade would only be decorative — the repository
 * deletes memberships explicitly (deleting a link, deleting an album) instead.
 */
export const albumLinks = sqliteTable(
  "album_links",
  {
    albumId: text("album_id").notNull(),
    linkId: text("link_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.albumId, table.linkId] }),
    // Answers "which albums is this link in?" for a whole page of cards at once.
    index("album_links_link_idx").on(table.linkId),
  ],
);

export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type AlbumLink = typeof albumLinks.$inferSelect;
export type NewAlbumLink = typeof albumLinks.$inferInsert;
