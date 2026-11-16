# Agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Hermes agent search, add, edit, file, summarise and (confirmed) delete links through a token-cheap skill + CLI backed by new `/api/agent/*` routes, with the private space opened only per request by a passcode.

**Architecture:** One additive migration (`links.summary`), a few repository helpers, a header-based agent auth module, eight stateless route handlers under `src/app/api/agent/`, and a stdlib-Python CLI (`lc.py`) with a short `SKILL.md`. Existing routes, the userscript and the PWA are not modified (except the dashboard's optional `summary` field).

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before writing route code), Drizzle + libSQL, Zod 4, Vitest (in-memory DB with real migrations), Python 3 stdlib.

**Spec:** `docs/agent-bridge/requirements.md` (read it first, including "Resolutions after builder review").

## Global Constraints

- **Do not modify:** `public/sw.js`, `src/app/manifest.ts`, `src/app/share-target/**`, `src/app/api/links/route.ts`, `userscript/**`. `GET/POST /api/links` output and behaviour stay identical (`ApiLink`/`toApiLink` gets **no** `summary`).
- `summary`: nullable text, max **500** characters, optional everywhere; blank string on PATCH/forms clears it to `null`.
- Env: new `AGENT_API_KEY` (missing → `503 UNCONFIGURED`). Headers: `x-agent-key`, `x-locked-passcode`, `x-confirm`. Agent routes send **no CORS headers**.
- Private space needs a valid `x-locked-passcode` **on that request**; no cookie/session/token. A *wrong* passcode → `403 PASSCODE_REQUIRED` after a delay (default 1000 ms, env `AGENT_FAILURE_DELAY_MS` overrides; tests set `0`). Passcode and agent key are never logged.
- Id-based access to a private link/album without a valid passcode → `404 NOT_FOUND`, indistinguishable from missing.
- Search: default `limit` 20, max 50, `offset` ≥ 0; responses carry no thumbnails except `GET /links/:id`.
- Delete confirm token: valid 5 minutes, bound to `{linkId, updatedAt}`, signed with a key derived from `AGENT_API_KEY`, sent in header `x-confirm`; private deletes need the passcode again.
- Tests: Vitest, DB from `tests/helpers/test-db.ts`; run with `npx vitest run <file>` (on Windows PowerShell use `npx.cmd`).
- **Commits:** the steps below name a commit per task; only run them once the owner has said commits are wanted. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Re-adding an existing URL via the agent without `thumbnail`/`title` must keep the stored values (Task 4).
- `q` containing `%`, `_` or `\` matches literally, now also against `summary` (Task 1).
- `PATCH` whose new URL equals a *private* link's URL, sent without passcode, must not answer `url-taken` (Task 6).
- A delete token for link A is rejected for link B, after A is edited, after 5 minutes, and for a private link without passcode (Task 7).
- `limit=0`, `limit=999`, `offset=-1`, `limit=abc` → `400 VALIDATION_ERROR` (not a crash, not a silent huge page) (Task 5).

---

### Task 1: `summary` column and data layer

**Files:**
- Modify: `src/db/schema.ts` (add `summary: text("summary")` to `links`), `src/db/links.ts`, `src/lib/validation.ts` (`LinkInput.summary?: string | null`)
- Create: `drizzle/0005_*.sql` (generate with `npm run db:generate`; commit the SQL and `drizzle/meta/*`)
- Test: `tests/links-repository.test.ts` (extend)

**Interfaces:**
- Produces: `Link.summary: string | null`; `UpdateLinkPatch.summary?: string | null`; `ListLinksOptions.offset?: number`; `listLinks` `query` also matches `summary`; `upsertLink` writes `summary` only when `input.summary !== undefined` (insert default `null`).

- [ ] **Step 1: Failing tests** in `tests/links-repository.test.ts`:
  - `"upsertLink stores summary and leaves it alone when a later save omits it"`: save with `summary:"a"`, re-save same url without summary → row `summary === "a"`.
  - `"updateLink sets and clears summary"`: patch `{summary:"x"}` → `"x"`; patch `{summary:null}` → `null`.
  - `"listLinks query matches summary, escaping % and _"`: link with summary `"100% legit"`; query `"100%"` finds it, query `"1_0"` does not.
  - `"listLinks offset skips rows in the same order"`: 3 links, `limit:1, offset:1` returns the 2nd newest.
- [ ] **Step 2:** `npx vitest run tests/links-repository.test.ts` → FAIL (no `summary`).
- [ ] **Step 3:** Add the column, run `npm run db:generate`, confirm the SQL is a single `ALTER TABLE links ADD summary text;`. Implement `summary` in `upsertLink` (insert + conditional update), `UpdateLinkPatch`/`updateLink` (counts as content change for `updatedAt`), third `LIKE … ESCAPE '\\'` clause on `summary`, and `.offset(options.offset)` (SQLite needs a `limit`; use `limit ?? -1` when only offset is given).
- [ ] **Step 4:** `npx vitest run tests/links-repository.test.ts tests/api-links.test.ts tests/test-db-helper.test.ts` → PASS (the `api-links` suite proves `/api/links` is unchanged).
- [ ] **Step 5:** Commit `feat: optional link summary column`.

### Task 2: Dashboard accepts and shows `summary` (optional)

**Files:**
- Modify: `src/lib/validation.ts` (`LinkPatch.summary?: string | null`, `parseLinkPatch` and `parseManualLinkInput` accept it: trimmed, ≤500, blank → `null`), `src/app/api/dashboard/links/route.ts` and `[id]/route.ts` (pass it through; if they already spread parsed data, no change), `src/components/AddLinkForm.tsx`, `src/components/LinkActions.tsx` (edit form field "Summary", optional), `src/components/LinkCard.tsx`, `src/components/LinkList.tsx` (muted line / column when `summary` present)
- Test: `tests/link-management-validation.test.ts`, `tests/link-management-routes.test.ts`, `tests/link-card-affordances.test.ts` (extend; read how each already tests)

**Interfaces:**
- Consumes: Task 1 `Link.summary`, `UpdateLinkPatch.summary`.

- [ ] **Step 1: Failing tests:** `parseLinkPatch({summary:"  hi "})` → `{summary:"hi"}`; `{summary:""}` → `{summary:null}`; 501 chars → `ok:false`; patch with only `summary` is a valid non-empty patch; `parseManualLinkInput({url})` still valid without summary; route test: PATCH `{summary:"s"}` returns 200 and persists; render test: `LinkCard` with `summary:"about x"` contains `about x`, and without summary renders no empty element.
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement. `toApiLink` stays untouched; the dashboard reads `summary` from the `Link` row it already receives server-side (pass the row's `summary` to the card/list props). The client edit/add forms send `summary` only when the user typed one.
- [ ] **Step 4:** `npx vitest run` (whole suite) → PASS; `npm run lint`.
- [ ] **Step 5:** Commit `feat: optional summary in dashboard forms and cards`.

### Task 3: Agent auth and confirm token

**Files:**
- Create: `src/lib/agent-auth.ts`
- Modify: `src/types/api.ts` (add `"PASSCODE_REQUIRED" | "CONFIRMATION_REQUIRED"` to `ApiErrorCode`)
- Test: `tests/agent-auth.test.ts`

**Interfaces:**
- Produces:
  - `export const AGENT_KEY_HEADER = "x-agent-key"`, `PASSCODE_HEADER = "x-locked-passcode"`, `CONFIRM_HEADER = "x-confirm"`
  - `export type AgentAccess = { ok: true; privateOpen: boolean } | { ok: false; response: NextResponse }`
  - `export async function authorizeAgent(request: Request): Promise<AgentAccess>` — no/unset key config → 503 `UNCONFIGURED`; missing/wrong key → 401 `UNAUTHORIZED`; passcode header present: `LOCKED_PASSCODE` unset → 503, wrong → 403 `PASSCODE_REQUIRED`, right → `privateOpen:true`; absent → `privateOpen:false`. Failures `await` the configured delay and `logEvent` (without secrets).
  - `export function signDeleteConfirm(link: {id: string; updatedAt: number}, now: number): string`
  - `export function verifyDeleteConfirm(token: string | null | undefined, link: {id: string; updatedAt: number}, now: number): boolean`

- [ ] **Step 1: Failing tests** (`AGENT_FAILURE_DELAY_MS="0"`): missing env → 503; no header → 401; wrong key → 401; right key, no passcode → `{ok:true, privateOpen:false}`; right key + right passcode → `privateOpen:true`; wrong passcode → 403 with code `PASSCODE_REQUIRED`; `x-secret-key` (userscript key) alone → 401; token roundtrip true; false for other id, other `updatedAt`, `now + 5*60_000 + 1`, garbage, `null`; token signed under key A fails under key B; log output of a wrong-passcode attempt does not contain the supplied value (spy on `console`).
- [ ] **Step 2:** `npx vitest run tests/agent-auth.test.ts` → FAIL.
- [ ] **Step 3:** Implement with `constantTimeEqual` and `verifyLockedPasscode` (existing). Confirm token: `signToken`/`verifyToken` from `src/lib/signed-token.ts`, `secret = createHmac("sha256", AGENT_API_KEY).update("agent-delete-confirm").digest("hex")`, `context = \`agent-delete:${id}:${updatedAt}\``, `ttlMs = 300_000`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat: agent auth and delete confirmation token`.

### Task 4: Repository helpers for the agent

**Files:**
- Modify: `src/db/locked-domains.ts`, `src/db/albums.ts`, `src/db/links.ts`, `src/lib/validation.ts` (export `deriveTitleFromUrl` if not already; it is exported)
- Test: `tests/locked-domains-repository.test.ts`, `tests/albums-repository.test.ts`, `tests/links-repository.test.ts` (extend)

**Interfaces:**
- Produces:
  - `isDomainLocked(db: Database, domain: string): Promise<boolean>`
  - `listAlbumNamesByLink(db: Database, linkIds: readonly string[]): Promise<Map<string, string[]>>` (names sorted case-insensitively; one query)
  - `listAlbumCounts(db: Database, scope: AlbumScope): Promise<{ id: string; name: string; linkCount: number }[]>` (same scoped count rule as `listAlbums`, no covers query, ordered by name)
  - `interface AgentLinkInput { url: string; domain: string; title?: string; thumbnail?: string | null; summary?: string | null }`
  - `saveLinkForAgent(db: Database, input: AgentLinkInput): Promise<UpsertResult>` — new URL: insert (title defaults to `deriveTitleFromUrl(url)`); existing URL: update **only provided fields**.

- [ ] **Step 1: Failing tests:** `isDomainLocked` true/false; `listAlbumNamesByLink` returns names for a link in two albums, `[]`/absent for none, empty input → empty map; `listAlbumCounts` counts only same-side links and includes an empty album with 0; `saveLinkForAgent` — existing link with thumbnail `T`, re-save with only `{url, domain, summary:"s"}` → thumbnail still `T`, title unchanged, `inserted:false`; new URL without title → title equals `deriveTitleFromUrl(url)`, `inserted:true`.
- [ ] **Step 2:** Run the three files → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: repository helpers for the agent`.

### Task 5: Read routes — search, detail, albums

**Files:**
- Create: `src/lib/agent-api.ts`, `src/app/api/agent/links/route.ts` (GET here, POST in Task 6), `src/app/api/agent/links/[id]/route.ts` (GET here; PATCH/DELETE later), `src/app/api/agent/albums/route.ts` (GET here, POST in Task 8)
- Test: `tests/agent-routes-read.test.ts` (mock `@/db/client` `getDb` exactly like `tests/album-routes.test.ts`)

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces (`src/lib/agent-api.ts`):
  - `type Space = "public" | "private"`; `spaceToScope(space: Space): LinkScope` (`public→"visible"`, `private→"locked"`)
  - `interface AgentSearch { q: string; domain: string; albumId?: string; noAlbum: boolean; favorite: boolean; space: Space; limit: number; offset: number }`; `parseAgentSearch(params: URLSearchParams): ParseResult<AgentSearch>` (defaults: `space=public`, `limit=20` max 50, `offset=0`; invalid numbers → `ok:false`)
  - `toAgentRow(link: Link, albumNames: string[]): { id; title; domain; summary: string | null; albums: string[]; fav: boolean }`
  - `toAgentDetail(link: Link, albumNames: string[], space: Space)` = row + `url`, `thumbnail`, `space`
  - `resolveLinkForAgent(db: Database, id: string, access: {privateOpen: boolean}): Promise<{ link: Link; space: Space } | undefined>` — `undefined` when missing **or** private without `privateOpen`
  - `resolveAlbumForAgent(db: Database, id: string, access: {privateOpen: boolean}): Promise<Album | undefined>` (same rule via `album.scope`)
- Response shapes: `GET /links` → `{ links: row[], hasMore: boolean }` (fetch `limit+1`); `GET /links/:id` → detail; `GET /albums?space=` → `{ albums: {id,name,count}[] }`.

- [ ] **Step 1: Failing tests:** no key → 401; public search returns only public links and **never** a locked-domain link; `space=private` without passcode → 403 `PASSCODE_REQUIRED`; with passcode returns only locked links; `q` matches title, url and summary; `noAlbum=1` returns only unfiled public links; `album=<id>` filters; `album=<private album id>` on `space=public` → 404; `favorite=1`; `limit=3` + 4 matching → `hasMore:true`, 3 rows; rows have no `thumbnail`/`url` keys; each row's `albums` holds names; `limit=0|999|abc`, `offset=-1` → 400; `GET /links/:id` for a private link without passcode → 404 (same body as unknown id), with passcode → detail incl. `thumbnail`; `GET /albums` lists public albums with counts, `space=private` gated.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; every handler starts with `authorizeAgent`; use `listLinks` (`scope`, `albums:{include:[id],exclude:[]}`, `albumMembership`, `offset`) and one `listAlbumNamesByLink` call per page. Set `export const dynamic = "force-dynamic"`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat: agent read endpoints`.

### Task 6: Add and edit links

**Files:**
- Modify: `src/app/api/agent/links/route.ts` (POST), `src/app/api/agent/links/[id]/route.ts` (PATCH), `src/lib/validation.ts` (`parseAgentLinkInput(raw: unknown): ParseResult<AgentLinkInput>`: `url` required http(s), `title?`, `thumbnail?`, `summary?`, domain derived)
- Test: `tests/agent-routes-links.test.ts`, extend `tests/link-management-validation.test.ts`

**Interfaces:**
- Consumes: `saveLinkForAgent`, `isDomainLocked`, `updateLink`, `parseLinkPatch` (Task 2), `resolveLinkForAgent`.
- Produces: `POST /links` → `{ link: detail, inserted: boolean }` (`201` if inserted, else `200`); `PATCH /links/:id` → `{ link: detail }`.

- [ ] **Step 1: Failing tests:** POST new public URL → 201, appears in public search; POST re-add existing URL with only `summary` keeps its title/thumbnail; POST URL on a locked domain without passcode → 403 `PASSCODE_REQUIRED` and nothing written; with passcode → saved and invisible to public search; invalid URL → 400; PATCH each of `title,url,thumbnail,summary,isFavorite`; PATCH `{summary:""}` clears; PATCH private link without passcode → 404; PATCH `url` to another public link's URL → 409; **PATCH public link's `url` to the URL of a private link, no passcode → 409 with the boundary message, never "already saved"**; PATCH `url` onto a locked domain → 409 even with passcode; PATCH unknown id → 404.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. In PATCH: resolve link first (404), parse patch, then if `patch.domain` is set and `isDomainLocked(patch.domain) !== (space === "private")` → 409, only then `updateLink`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat: agent add and edit link`.

### Task 7: Delete with confirmation

**Files:**
- Modify: `src/app/api/agent/links/[id]/route.ts` (DELETE)
- Test: `tests/agent-routes-delete.test.ts`

**Interfaces:**
- Consumes: `signDeleteConfirm`, `verifyDeleteConfirm`, `CONFIRM_HEADER`, `deleteLink`, `resolveLinkForAgent`.
- Produces: no `x-confirm` → `409` `CONFIRMATION_REQUIRED` whose body carries `{ title, url, confirm }`; valid `x-confirm` → `{ deleted: true }`; bad token → `409 CONFIRMATION_REQUIRED` (fresh preview + new token), never a delete.

- [ ] **Step 1: Failing tests:** first call deletes nothing (row still exists) and returns preview + token; second call with the token deletes the row and its album memberships; token from link A on link B → not deleted; token after the link is PATCHed (changed `updatedAt`) → not deleted; token older than 5 min (use `vi.setSystemTime`) → not deleted; unknown id → 404; private link: preview without passcode → 404, confirm without passcode (token minted earlier with passcode) → 404 and row survives; with passcode both steps work.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: agent delete with server-enforced confirmation`.

### Task 8: Albums — create and file links

**Files:**
- Modify: `src/app/api/agent/albums/route.ts` (POST), create `src/app/api/agent/albums/[id]/links/route.ts`
- Test: `tests/agent-routes-albums.test.ts`

**Interfaces:**
- Consumes: `createAlbum`, `addLinksToAlbum`, `parseAlbumName`, `parseBulkAlbumLinkInput`, `resolveAlbumForAgent`.
- Produces: `POST /albums {name, space?: "public"|"private"}` → `201 { album: {id, name, space} }`, `409` on duplicate name per side; `POST /albums/:id/links {linkIds}` → `{ added, alreadyIn, skipped }`.

- [ ] **Step 1: Failing tests:** create public album (default space) → 201 and listed by `GET /albums`; duplicate name on the same side → 409; `space:"private"` without passcode → 403, with passcode → created and absent from the public album list; file 3 public links → `added:3`; repeat → `alreadyIn:3`; mix in a nonexistent id → counted in `skipped`; filing into a private album id without passcode → 404 and no `album_links` row written; filing a public link into a private album (with passcode) → counted `skipped`, not stored; > 200 ids → 400.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`resolveAlbumForAgent` before `addLinksToAlbum`). **Step 4:** Run → PASS. **Step 5:** Commit `feat: agent album create and filing`.

### Task 9: Agent kit — `lc.py` and `SKILL.md`

**Files:**
- Create: `agent-skill/link-collector/lc.py`, `agent-skill/link-collector/SKILL.md`, `agent-skill/link-collector/test_lc.py`

**Interfaces:**
- Consumes: the HTTP contract of Tasks 5–8.
- Produces CLI (`python lc.py <cmd>`; env `LC_BASE_URL`, `LC_AGENT_KEY`; optional `--passcode` per call only):
  - `search [q] [--domain D] [--album ID] [--no-album] [--fav] [--private] [--limit N] [--offset N]`
  - `show ID`, `add URL [--title T] [--thumb U] [--summary S] [--private]`, `edit ID [--title] [--url] [--thumb] [--summary] [--fav|--unfav]`
  - `delete ID` (prints the preview and the token; `delete ID --confirm TOKEN` performs it)
  - `albums [--private]`, `album-new NAME [--private]`, `file ALBUM_ID ID [ID…]`
  - Output: one line per link `id | title | domain | albums | summary(truncated 80)`; errors as one line `ERROR <code>: <message>`, exit code ≠ 0. `--private` without `--passcode` makes the CLI print `ERROR PASSCODE_REQUIRED: ask the owner for the passcode` **without calling the server**.
  - Pure functions `format_row(row: dict) -> str`, `build_request(args) -> (method, path, headers, body)` for testing.
- `SKILL.md` (≤ 60 lines): when to use; command table; rules: public by default; **ask the owner for the passcode every time a private action is needed, never store/repeat it, never put it in notes or memory**; delete = run `delete ID`, show title+url to the owner, send `--confirm` only after an explicit yes; organising = `search --no-album`, propose album names, `album-new`, then `file`; add summaries only from content actually known.

- [ ] **Step 1: Failing tests** (`python -m unittest agent-skill/link-collector/test_lc.py`, `python -m unittest` needs Python 3 on the machine; verify with `python --version`): `format_row` truncates summary at 80 chars with `…` and joins albums with `,`; `build_request` for `search "hotel" --private --passcode x` → `GET /api/agent/links?q=hotel&space=private`, headers include `x-agent-key` and `x-locked-passcode: x`; `--private` without passcode returns the local error and no request; `delete ID --confirm T` → `DELETE` with `x-confirm: T`; `add` without summary sends no `summary` key.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement using `urllib.request` only; also run one manual smoke test against `npm run dev` with a seeded DB (`npm run db:seed`) and report the output. **Step 4:** Run → PASS. **Step 5:** Commit `feat: Hermes agent skill and CLI`.

### Task 10: Docs, env and final verification

**Files:**
- Modify: `.env.example` (`AGENT_API_KEY=`), `README.md` (new "Agent API" section: headers, endpoints, space rules, delete confirmation, kit install on the Hermes host; add the new test files to the §6 table; list the new files in §10)
- Verify only: everything else

- [ ] **Step 1:** Document; note in README that `GET /api/links` still returns private links (known follow-up, out of scope).
- [ ] **Step 2:** Run `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run build` → all green.
- [ ] **Step 3:** `git diff --stat main -- public/sw.js src/app/manifest.ts src/app/share-target src/app/api/links userscript` → **empty output** (proves the PWA/userscript/ingestion path is untouched).
- [ ] **Step 4:** Deployment note for the owner: add `AGENT_API_KEY` in Vercel, run `npm run db:migrate` (or apply `drizzle/0005_*.sql`) against Turso **before** deploying code that reads `summary`.
- [ ] **Step 5:** Commit `docs: agent bridge`.

---

## Self-review

- **Spec coverage:** goals 1–6 → Tasks 5, 6, 7, 8, 1–2, 5; passcode-per-request, no CORS, `404` for private ids → Tasks 3, 5–8; confirm token binding → 3, 7; PWA/userscript untouched → Task 10 step 3; kit → Task 9; cross-boundary PATCH and `url-taken` ordering → Task 6.
- **Deviation from spec (my call):** no separate "lean projection" query. Rows are mapped to compact JSON in the route, so the agent's token cost is unaffected; the extra thumbnail bytes read from Turso are tiny URLs. Revisit only if reads become a measured cost.
- **Types:** `Space`, `AgentAccess`, `AgentLinkInput`, `resolveLinkForAgent` / `resolveAlbumForAgent` are defined once (Tasks 3–5) and reused unchanged in 6–8.
