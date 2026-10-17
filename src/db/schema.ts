import {
  index,
  integer,
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
