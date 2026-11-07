#!/usr/bin/env node
/**
 * Seeds the dashboard with dummy links, albums, and locked domains.
 *
 * Plain CommonJS + raw SQL on purpose: it needs no TypeScript loader, no path
 * aliases, and no build step, so `node scripts/seed-dummy.cjs` always works.
 *
 * Idempotent by default. Every seeded row has a fixed id (`seed-…`) and a fixed
 * URL, and the inserts are `INSERT OR IGNORE`, so running it twice adds nothing.
 * Album ids are resolved by (scope, name_key) after insertion, which keeps the
 * memberships correct even when an album with the same name already exists with
 * a different id.
 *
 * Usage:
 *   node scripts/seed-dummy.cjs              # add the dummy data
 *   node scripts/seed-dummy.cjs --reset      # remove only the seeded rows
 *   node scripts/seed-dummy.cjs --dry-run    # report without writing
 *   node scripts/seed-dummy.cjs --db=file:./seed.db
 */

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { createClient } = require("@libsql/client");

const seed = require("./seed-dummy.json");

const SEED_PREFIX = "seed-";
const DAY_MS = 24 * 60 * 60 * 1000;

function loadEnvironment() {
  if (process.env.TURSO_DATABASE_URL) return;

  const envPath = join(__dirname, "..", ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function parseArgs(argv) {
  const options = { reset: false, dryRun: false, url: null, help: false };

  for (const arg of argv) {
    if (arg === "--reset") options.reset = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--db=")) options.url = arg.slice("--db=".length);
    else {
      console.error(`Unknown argument: ${arg}\n`);
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Seed the dashboard with dummy data.

Usage:
  node scripts/seed-dummy.cjs [options]

Options:
  --reset        Delete only the seeded rows (ids and domains starting with "seed-")
  --dry-run      Report what would happen, write nothing
  --db=<url>     Target another database (default: TURSO_DATABASE_URL)
  -h, --help     Show this message`);
}

function domainOf(url) {
  return new URL(url).host.toLowerCase();
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function assertSchema(client) {
  const required = ["links", "albums", "album_links", "locked_domains"];
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders(required.length)})`,
    required,
  );
  const found = new Set(result.rows.map((row) => row.name));
  const missing = required.filter((name) => !found.has(name));

  if (missing.length > 0) {
    throw new Error(
      `The database is missing ${missing.join(", ")}. Run \`npm run db:push\` first.`,
    );
  }
}

/** Deletes only rows this script created, leaving real data untouched. */
async function reset(client, options) {
  const linkIds = seed.links.map((link) => link.id);
  const albumIds = seed.albums.map((album) => album.id);

  const statements = [
    {
      label: "album memberships",
      countSql: `SELECT COUNT(*) AS total FROM album_links WHERE link_id IN (${placeholders(linkIds.length)}) OR album_id IN (${placeholders(albumIds.length)})`,
      sql: `DELETE FROM album_links WHERE link_id IN (${placeholders(linkIds.length)}) OR album_id IN (${placeholders(albumIds.length)})`,
      args: [...linkIds, ...albumIds],
    },
    {
      label: "links",
      countSql: "SELECT COUNT(*) AS total FROM links WHERE id LIKE ?",
      sql: "DELETE FROM links WHERE id LIKE ?",
      args: [`${SEED_PREFIX}%`],
    },
    {
      label: "albums",
      countSql: "SELECT COUNT(*) AS total FROM albums WHERE id LIKE ?",
      sql: "DELETE FROM albums WHERE id LIKE ?",
      args: [`${SEED_PREFIX}%`],
    },
    {
      label: "locked domains",
      countSql: `SELECT COUNT(*) AS total FROM locked_domains WHERE domain IN (${placeholders(seed.lockedDomains.length)})`,
      sql: `DELETE FROM locked_domains WHERE domain IN (${placeholders(seed.lockedDomains.length)})`,
      args: [...seed.lockedDomains],
    },
  ];

  const removed = {};

  for (const statement of statements) {
    if (options.dryRun) {
      const counted = await client.execute({
        sql: statement.countSql,
        args: statement.args,
      });
      removed[statement.label] = Number(counted.rows[0]?.total ?? 0);
      continue;
    }

    const result = await client.execute({ sql: statement.sql, args: statement.args });
    removed[statement.label] = result.rowsAffected;
  }

  return removed;
}

/** True when the query finds at least one row. Used by the dry run. */
async function exists(client, sql, args) {
  const result = await client.execute({ sql, args });

  return Number(result.rows[0]?.total ?? 0) > 0;
}

async function seedData(client, options) {
  const now = Date.now();
  const inserted = {
    albums: 0,
    links: 0,
    memberships: 0,
    lockedDomains: 0,
  };

  // 1. Albums. Resolve the real id afterwards, because `INSERT OR IGNORE` also
  //    ignores a row whose (scope, name_key) already exists under another id.
  const albumIdBySeedId = new Map();

  for (const album of seed.albums) {
    if (options.dryRun) {
      const present = await exists(
        client,
        "SELECT COUNT(*) AS total FROM albums WHERE scope = ? AND name_key = ?",
        [album.scope, album.name.toLowerCase()],
      );
      if (!present) inserted.albums += 1;
    } else {
      const result = await client.execute({
        sql: `INSERT OR IGNORE INTO albums (id, name, name_key, scope, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [album.id, album.name, album.name.toLowerCase(), album.scope, now],
      });
      inserted.albums += result.rowsAffected;
    }

    const resolved = await client.execute({
      sql: "SELECT id FROM albums WHERE scope = ? AND name_key = ? LIMIT 1",
      args: [album.scope, album.name.toLowerCase()],
    });

    albumIdBySeedId.set(album.id, resolved.rows[0]?.id ?? album.id);
  }

  // 2. Locked domains. These make their links invisible on `/` and visible on
  //    `/locked`, which is what exercises the side-scoped album filters.
  for (const domain of seed.lockedDomains) {
    if (options.dryRun) {
      const present = await exists(
        client,
        "SELECT COUNT(*) AS total FROM locked_domains WHERE domain = ?",
        [domain],
      );
      if (!present) inserted.lockedDomains += 1;
      continue;
    }

    const result = await client.execute({
      sql: "INSERT OR IGNORE INTO locked_domains (domain, created_at) VALUES (?, ?)",
      args: [domain, now],
    });
    inserted.lockedDomains += result.rowsAffected;
  }

  // 3. Links, with staggered timestamps so the default "newest first" order is
  //    visible instead of 23 rows sharing one millisecond.
  const linkIdBySeedId = new Map();

  for (const [index, link] of seed.links.entries()) {
    const updatedAt = now - link.daysAgo * DAY_MS - index * 1000;

    if (options.dryRun) {
      const present = await exists(
        client,
        "SELECT COUNT(*) AS total FROM links WHERE url = ?",
        [link.url],
      );
      if (!present) inserted.links += 1;
    } else {
      const result = await client.execute({
        sql: `INSERT OR IGNORE INTO links
                (id, url, domain, title, thumbnail, is_favorite, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          link.id,
          link.url,
          domainOf(link.url),
          link.title,
          link.thumbnail ?? null,
          link.favorite ? 1 : 0,
          updatedAt,
          updatedAt,
        ],
      });
      inserted.links += result.rowsAffected;
    }

    const resolved = await client.execute({
      sql: "SELECT id FROM links WHERE url = ? LIMIT 1",
      args: [link.url],
    });
    linkIdBySeedId.set(link.id, resolved.rows[0]?.id ?? link.id);
  }

  // 4. Memberships, using the resolved ids on both sides.
  for (const link of seed.links) {
    for (const albumSeedId of link.albumIds) {
      const albumId = albumIdBySeedId.get(albumSeedId);
      const linkId = linkIdBySeedId.get(link.id);

      if (albumId === undefined || linkId === undefined) {
        throw new Error(
          `Unknown album "${albumSeedId}" referenced by link "${link.id}".`,
        );
      }

      if (options.dryRun) {
        const present = await exists(
          client,
          "SELECT COUNT(*) AS total FROM album_links WHERE album_id = ? AND link_id = ?",
          [albumId, linkId],
        );
        if (!present) inserted.memberships += 1;
        continue;
      }

      const result = await client.execute({
        sql: `INSERT OR IGNORE INTO album_links (album_id, link_id, created_at)
              VALUES (?, ?, ?)`,
        args: [albumId, linkId, now],
      });
      inserted.memberships += result.rowsAffected;
    }
  }

  return inserted;
}

async function summarise(client) {
  const links = await client.execute(
    "SELECT COUNT(*) AS total FROM links WHERE id LIKE ?",
    [`${SEED_PREFIX}%`],
  );
  const albums = await client.execute(
    "SELECT COUNT(*) AS total FROM albums WHERE id LIKE ?",
    [`${SEED_PREFIX}%`],
  );
  const memberships = await client.execute(
    `SELECT COUNT(*) AS total FROM album_links
     WHERE link_id LIKE ? OR album_id LIKE ?`,
    [`${SEED_PREFIX}%`, `${SEED_PREFIX}%`],
  );
  const locked = await client.execute(
    `SELECT COUNT(*) AS total FROM locked_domains
     WHERE domain IN (${placeholders(seed.lockedDomains.length)})`,
    [...seed.lockedDomains],
  );
  const bySide = await client.execute(
    `SELECT CASE
       WHEN domain IN (SELECT domain FROM locked_domains) THEN 'locked'
       ELSE 'visible'
     END AS side, COUNT(*) AS total
     FROM links WHERE id LIKE ? GROUP BY side`,
    [`${SEED_PREFIX}%`],
  );
  const sideCounts = Object.fromEntries(
    bySide.rows.map((row) => [row.side, Number(row.total)]),
  );

  return {
    links: Number(links.rows[0]?.total ?? 0),
    albums: Number(albums.rows[0]?.total ?? 0),
    memberships: Number(memberships.rows[0]?.total ?? 0),
    lockedDomains: Number(locked.rows[0]?.total ?? 0),
    visibleLinks: sideCounts.visible ?? 0,
    lockedLinks: sideCounts.locked ?? 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  loadEnvironment();

  const url = options.url ?? process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Copy .env.example to .env.local, or pass --db=<url>.",
    );
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  try {
    await assertSchema(client);

    console.log(`Target: ${url}${options.dryRun ? " (dry run)" : ""}`);

    if (options.reset) {
      const removed = await reset(client, options);
      console.log("Removed seeded rows:");
      for (const [label, count] of Object.entries(removed)) {
        console.log(`  ${label}: ${count}`);
      }
      if (options.dryRun) return;
      console.log("\nSeeded rows removed. Run again without --reset to re-seed.");
      return;
    }

    const inserted = await seedData(client, options);
    console.log(options.dryRun ? "Would insert:" : "Inserted:");
    for (const [label, count] of Object.entries(inserted)) {
      console.log(`  ${label}: ${count}`);
    }

    if (options.dryRun) {
      console.log("\nDry run: nothing was written.");
      return;
    }

    const totals = await summarise(client);
    console.log("\nSeeded data now in the database:");
    console.log(`  ${totals.links} links (${totals.visibleLinks} on /, ${totals.lockedLinks} on /locked)`);
    console.log(`  ${totals.albums} albums`);
    console.log(`  ${totals.memberships} memberships`);
    console.log(`  ${totals.lockedDomains} locked domains`);
    if (totals.visibleLinks === 0) {
      console.log(
        "\nWarning: every seeded link landed on the hidden side. A domain you locked earlier covers them; run `npm run db:seed:reset` and pick different domains.",
      );
    }
    console.log(
      "\nOpen http://localhost:4200/ — the visible rows are on `/`, the hidden ones on `/locked`.",
    );
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nSeed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seed, SEED_PREFIX, domainOf };
