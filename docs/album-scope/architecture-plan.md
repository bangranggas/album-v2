# Per-side albums (album scope) — Architecture Plan

Phase 2 output for `docs/album-scope/`. Requirements: `docs/album-scope/requirements.md`.
**Needs the owner's approval before any code is written.**

## 1. Approach in one paragraph

An album gets a `scope` column that says which page it belongs to. Every read that lists albums or
feeds the "add to album" UI is filtered by that column, so the light page and the locked page stop
sharing a list. The link `scopeCondition` that already filters counts, covers, and contents stays
exactly as it is, because the album's side and the page's side are now the same string — which
means a legacy membership that no longer matches its album's side simply stays dark instead of
leaking. Uniqueness moves from `name_key` to `(scope, name_key)`, so a name may exist once per side
and a conflict message can no longer reveal a locked album's name. Existing albums are placed by a
one-time `UPDATE` inside migration `0004`, using the rule the owner chose: hidden-only → locked,
everything else → visible.

## 2. Files

### Created

| File | Purpose |
| --- | --- |
| `docs/album-scope/requirements.md` | Phase 1 output (done). |
| `docs/album-scope/architecture-plan.md` | This plan. |
| `drizzle/0004_<generated-name>.sql` | Add `scope`, backfill the sides (hand-written statement), swap the unique index. Plus the matching `drizzle/meta/0004_snapshot.json` and journal entry from `db:generate`. |
| `tests/album-scope-migration.test.ts` | Applies migrations `0000`–`0003`, inserts legacy albums/links/memberships, applies `0004`, and asserts the backfill rule, the untouched memberships, and the new index. This is the test for the risky part. |

### Modified

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `albums.scope` (`text`, not null, default `'visible'`); unique index `albums_scope_name_key_unique` on `(scope, name_key)` replaces `albums_name_key_unique`; comment explains the side and why uniqueness is per side. |
| `src/lib/albums.ts` | `AlbumScope` type, `ALBUM_SCOPES`, `isAlbumScope`, and `albumScopeForPage(locked)` — the one place the page → side mapping lives. |
| `src/lib/validation.ts` | `AlbumCreateInput` (`AlbumNameInput` + `scope`) and `parseAlbumCreateInput(raw)`; `parseAlbumName` stays for rename. |
| `src/db/albums.ts` | `createAlbum` writes `scope`; `renameAlbum` checks the conflict inside the album's own scope; `listAlbums` / `countAlbums` / `listAlbumOptions` / `listAlbumIdsByLink` take the side; `addLinkToAlbum` gains `scope-mismatch`; `addLinksToAlbum` filters off-side ids into `skipped`. |
| `src/app/api/dashboard/albums/route.ts` | Parses `{ name, scope }` (`400` for a missing/unknown scope), keeps `409` for a duplicate inside the same side. |
| `src/app/api/dashboard/links/[id]/albums/route.ts` | Maps `scope-mismatch` to `409` with a message that does not name the other side's contents. |
| `src/types/api.ts` | `toApiAlbum` also returns `scope` (the authenticated client may need to know where its album landed). |
| `src/app/(app)/page.tsx` | Album reads with `scope: "visible"`. |
| `src/app/locked/page.tsx` | Album reads with `scope: "locked"`. |
| `src/app/(app)/albums/[id]/page.tsx` | `404` unless the album's scope is `visible`; scoped options/memberships. |
| `src/app/locked/albums/[id]/page.tsx` | `404` unless the album's scope is `locked`; scoped options/memberships. |
| `src/components/AlbumCreateForm.tsx` | Sends `scope: albumScopeForPage(locked)` on create. |
| `src/components/AddToAlbumMenu.tsx` | Same, for the popup's inline "new album". |
| `src/components/SelectionBar.tsx` | Same, for the bulk panel's inline "new album". |
| `tests/albums-repository.test.ts`, `tests/album-validation.test.ts`, `tests/album-routes.test.ts`, `tests/albums-lib.test.ts`, `tests/test-db-helper.test.ts` | New/extended coverage (see §5). |
| `tests/helpers/test-db.ts` | `readMigrationStatements({ before })` and `createTestDatabase({ before })` so a test can stop at `0003` and replay `0004` on prepared data. Optional parameter — existing callers are untouched. |
| `docs/albums/requirements.md` | Note that D3/D6 are amended by this feature and that D7's uniqueness is now per side. |
| `README.md` | Albums bullet (per-side), endpoint table (`POST /api/dashboard/albums` body), security note (a locked album's name stays in the locked area), tests table. |

### Deleted

Nothing. No component changes shape: `LinkGrid`, `LinkCard`, `AlbumGrid`, `AlbumSearch`, and
`DashboardTabs` keep their props, because the pages now hand them an already-sided album list.

## 3. Data and interface changes

### 3.1 Schema

```ts
export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** `visible` on the light dashboard, `locked` in the passcode-gated area. */
    scope: text("scope").notNull().default("visible"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("albums_scope_name_key_unique").on(table.scope, table.nameKey),
  ],
);
```

### 3.2 Migration `0004` (hand-checked after `db:generate`)

```sql
ALTER TABLE `albums` ADD `scope` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
UPDATE `albums` SET `scope` = 'locked'
WHERE EXISTS (
    SELECT 1 FROM `album_links` `al`
    JOIN `links` `l` ON `l`.`id` = `al`.`link_id`
    WHERE `al`.`album_id` = `albums`.`id`
      AND `l`.`domain` IN (SELECT `domain` FROM `locked_domains`)
  )
  AND NOT EXISTS (
    SELECT 1 FROM `album_links` `al`
    JOIN `links` `l` ON `l`.`id` = `al`.`link_id`
    WHERE `al`.`album_id` = `albums`.`id`
      AND `l`.`domain` NOT IN (SELECT `domain` FROM `locked_domains`)
  );--> statement-breakpoint
DROP INDEX `albums_name_key_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `albums_scope_name_key_unique` ON `albums` (`scope`,`name_key`);
```

The `UPDATE` is inserted by hand: `db:generate` does not know about data backfills, and the test
helper replays the file statement by statement, so a test-covered `UPDATE` is exactly what local,
test, and hosted databases get.

### 3.3 Repository signatures

```ts
export async function createAlbum(db, input: AlbumCreateInput): Promise<CreateAlbumResult>;
export async function listAlbums(db, options: { scope?: AlbumScope; query?: string; limit?: number }): Promise<AlbumSummary[]>;
export async function countAlbums(db, scope: AlbumScope): Promise<number>;
export async function listAlbumOptions(db, scope: AlbumScope): Promise<AlbumOption[]>;
export async function listAlbumIdsByLink(db, linkIds: readonly string[], scope: AlbumScope): Promise<Map<string, string[]>>;
export type MembershipResult = "added" | "already" | "album-not-found" | "link-not-found" | "scope-mismatch";
```

`addLinksToAlbum` keeps its signature; only the internal link lookup gains
`and(inArray(links.id, ids), scopeCondition(album.scope))`, so an off-side id lands in `skipped`.

### 3.4 HTTP contract

| Route | Body | Answers |
| --- | --- | --- |
| `POST /api/dashboard/albums` | `{ name, scope }` | `201 { album }` (album now carries `scope`), `400` (name or scope invalid, nothing written), `409` (name taken **on that side**) |
| `PATCH /api/dashboard/albums/:id` | `{ name }` | unchanged; the collision check is inside the album's own scope, `scope` in the body is ignored |
| `POST /api/dashboard/links/:id/albums` | `{ albumId }` | `200 { added }`, `404` (album/link gone), `409` (album and link are on different sides — nothing written) |
| `POST /api/dashboard/albums/:id/links` | `{ linkIds }` | unchanged; off-side ids are counted as `skipped` |

### 3.5 Page wiring

```
/                     listAlbums(scope:"visible")   countAlbums("visible")   listAlbumOptions("visible")   listAlbumIdsByLink(ids,"visible")
/locked               listAlbums(scope:"locked")    countAlbums("locked")    listAlbumOptions("locked")    listAlbumIdsByLink(ids,"locked")
/albums/[id]          album.scope must be "visible" (else notFound)
/locked/albums/[id]   album.scope must be "locked"  (else notFound)
```

Client components derive the side for their create calls from the `locked` prop the pages already
pass (`albumScopeForPage(locked)`), so no new prop is threaded through the component tree.

## 4. Step-by-step execution

Each step ends with the tests for that step green and a pause before the next one (Phase 5
checkpointing).

1. **Schema, migration, migration test.** Add `scope` + the new index to `schema.ts`; run
   `npm.cmd run db:generate`; verify the generated SQL; insert the backfill `UPDATE`; extend the
   test helper with the `before` option; write `tests/album-scope-migration.test.ts` (red first:
   `scope` does not exist yet / the backfill is missing), then make it pass.
2. **Pure types and validation.** `AlbumScope`, `ALBUM_SCOPES`, `isAlbumScope`,
   `albumScopeForPage` in `src/lib/albums.ts`; `AlbumCreateInput` + `parseAlbumCreateInput` in
   `validation.ts`. Tests: `tests/albums-lib.test.ts`, `tests/album-validation.test.ts`.
3. **Repository.** All of §3.3. Tests in `tests/albums-repository.test.ts`: per-side listing and
   counting, per-side option list, scoped membership map, per-scope rename conflict, locked/visible
   duplicate names coexisting, `scope-mismatch`, bulk `skipped` for off-side ids, dormant membership
   still filtered out of counts/covers.
4. **Routes.** §3.4. Tests in `tests/album-routes.test.ts`: `400` for a missing/unknown scope,
   `201` with `scope`, `409` only inside the same side, `409` for a cross-side membership, and the
   existing album route suites still passing.
5. **Pages and components.** §3.5 plus `albumScopeForPage` in the three create callers. Checkpoint:
   `npm.cmd run build` green, and a browser-free probe of the rendered HTML on both pages.
6. **Local database.** `npm.cmd run db:push` (adds the column and swaps the index on `local.db`;
   the file database has no migrations table — it was created with `push`), then run the backfill
   `UPDATE` once against `local.db` with a throwaway script, and verify `test`/`test2` became locked
   albums while the 4 links, 3 locked domains, and all memberships are intact. Delete the script.
7. **Docs and probes.** Amend `docs/albums/requirements.md`; update `README.md`; update the
   `e2e-*` probes in the temp folder for the new create payload and add
   `e2e-album-scope.mjs` (light/dark listing, `404` on the wrong detail route, `409` membership,
   bulk skip, cleanup). Run the probes against a fresh production server on port 4300.
8. **Final review.** `npm.cmd run test`, `npm.cmd run lint`, `npm.cmd run build`; confirm no
   debugging leftovers and a clean `git status`; report the summary.

## 5. Test plan

| File | Cases |
| --- | --- |
| `tests/album-scope-migration.test.ts` (new) | hidden-only album → `locked`; mixed album → `visible`; empty album → `visible`; no album becomes `locked` without a hidden member; `album_links` row count unchanged; the same `name_key` is accepted on both sides after `0004` (and rejected twice on one side); the old index is gone. |
| `tests/albums-lib.test.ts` | `albumScopeForPage(true/false)`, `isAlbumScope` accepting both sides and rejecting `"all"`, `""`, `"Visible"`. |
| `tests/album-validation.test.ts` | `parseAlbumCreateInput` returns `{ name, nameKey, scope }`; missing/unknown/`"all"` scope → `400` message; name rules unchanged; `parseAlbumName` unchanged for rename. |
| `tests/albums-repository.test.ts` | `listAlbums` returns only the requested side and counts only same-side members; `countAlbums` per side; `listAlbumOptions` per side; `listAlbumIdsByLink` ignores the other side's albums; `createAlbum` writes the side; identical names on both sides; duplicate inside a side → `name-taken`; `renameAlbum` conflicts only inside its own scope; `addLinkToAlbum` → `scope-mismatch` both directions; `addLinksToAlbum` counts an off-side id as `skipped` and still files the rest; a membership whose link left the side no longer shows in count/covers/contents. |
| `tests/album-routes.test.ts` | create: `400` missing/unknown scope, `201` with `scope` echoed, `409` same side only; membership: `409` for both mismatch directions with the album and link left untouched; bulk route unchanged green. |
| `tests/test-db-helper.test.ts` | the `before` option applies only earlier migrations (so an old schema can be replayed forward). |
| Live probes (temp folder) | `e2e-album-scope.mjs`: a locked album is absent from `/?tab=albums` and present on `/locked?tab=albums`; the reverse for a visible album; `/albums/<locked>` → `404`; `/locked/albums/<visible>` → `404`; cross-side membership → `409`; bulk off-side ids → `skipped > 0`; the same name accepted on both sides; cleanup leaves the owner's rows alone. Existing `e2e-albums.mjs`, `e2e-bulk.mjs`, `e2e-flows.mjs` re-run after their create payloads gain `scope`. |

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `db:generate` may prompt about the index swap (drop + create in one migration) | Inspect the generated file; if a prompt or a missing statement appears, hand-write `0004` and keep the journal entry consistent. The SQL is fully specified in §3.2 either way. |
| `db:push` may prompt before dropping the old index | Re-run with the flag it suggests (or `--force`); verify the resulting `sqlite_master` matches the schema afterwards. |
| The backfill could mislabel a legacy album | The rule is asserted by `tests/album-scope-migration.test.ts` with mixed, all-hidden, and empty albums; the owner's own rows are verified by hand before/after (§4 step 6). |
| `push` cannot run the backfill on a database that has data | Documented one-time step in §4 step 6 for `local.db`; the same statement is in `0004` for anyone who migrates (and the owner is told what to run on the hosted database). |
| Hidden data leaking through the new listing | Every album read is side-filtered, the membership map is side-filtered, the detail routes `404` on the wrong side, and the probe asserts the string-level absence of a locked album's name on `/`. |
| A stale client sending a locked album id from a light page | `409` from the repository's side check; nothing is written. |

## 7. Out of scope (restated)

No move-side action, no cross-side contents or counts, no `album_links` rewrite, no changes to the
link lock rule, the userscript, authentication, or the locked gate. The hosted Turso database still
needs its own `db:push` plus the §3.2 `UPDATE` when the owner decides to deploy — the local
database is what this feature is verified on.
