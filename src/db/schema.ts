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
 */
export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title").notNull(),
    thumbnail: text("thumbnail"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("links_url_unique").on(table.url),
    index("links_domain_idx").on(table.domain),
  ],
);

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
