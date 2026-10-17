import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Saved links. One row per unique URL; re-saving a URL updates the existing row.
 *
 * Timestamps are stored as unix epoch milliseconds (integer) so ordering and
 * "inserted vs updated" logic stay deterministic across runtimes.
 */
export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    thumbnail: text("thumbnail"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("links_url_unique").on(table.url)],
);

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
