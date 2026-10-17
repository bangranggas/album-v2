# Architecture Plan: Instant Link Collector

Status: **Awaiting approval (Phase 2 output)**
Depends on: `docs/instant-link-collector/requirements.md`
Slug: `instant-link-collector`

---

## 1. Stack

| Layer | Choice | Version policy |
| --- | --- | --- |
| Framework | Next.js (App Router) | latest stable at install time |
| Language | TypeScript | strict mode |
| Styling | Tailwind CSS | latest stable, v4 style config |
| DB driver | `@libsql/client` | latest |
| ORM | `drizzle-orm` + `drizzle-kit` | latest |
| Validation | `zod` | latest |
| Test runner | `vitest` | latest |
| Lint | `eslint` + `eslint-config-next` | latest |
| Runtime | Node.js serverless function (Next.js default) | Next 16 deprecates the Edge Runtime, so **no** `runtime` export is emitted. See requirements §2. |

No scraping package is installed at any point (`puppeteer`, `playwright`, `cheerio`,
`jsdom`-as-scraper are all excluded by design).

---

## 2. Data Flow

### Save (write path)

```
Web page
  └─ Tampermonkey FAB click
       ├─ extract href (hash-stripped), document.title, og:image (absolutised)
       ├─ POST /api/links  { url, title, thumbnail }  + header x-secret-key
       └─ toast: Saving... → Saved / Error / Unauthorized
                    │
                    ▼
        Next.js Route Handler  src/app/api/links/route.ts
          ├─ verifySecret(request)        -> 401 + log api_auth_failed
          ├─ parseJson + linkInputSchema  -> 400 + log api_validation_failed
          ├─ repository.upsertLink(input) -> Turso / file:local.db
          ├─ log api_link_saved { url_domain, latency_ms, inserted }
          └─ 200 { ok: true, data: link }
```

### Read path

```
Browser -> GET /            -> src/app/page.tsx (Server Component, runtime nodejs)
                                 └─ repository.listLinks() -> DB -> cards grid

Client  -> GET /api/links   -> route handler -> verifySecret -> listLinks -> JSON
```

The dashboard never calls `/api/links`; it reads through the repository directly on the
server, so the secret stays out of the browser (owner decision).

---

## 3. Module Boundaries

| Module | Responsibility | Must not |
| --- | --- | --- |
| `src/db/schema.ts` | Drizzle table definition + inferred types | contain queries |
| `src/db/client.ts` | Lazy libSQL client + Drizzle instance from env; `createDb()` factory for tests | import Next.js APIs |
| `src/db/links.ts` | `upsertLink`, `listLinks` (the only SQL in the app) | validate input, log, or touch HTTP |
| `src/lib/validation.ts` | Zod schema + normalisation (`thumbnail` `""` → `null`, URL checks) | touch DB |
| `src/lib/auth.ts` | `verifySecret(request)` — constant-time compare | touch DB |
| `src/lib/logger.ts` | `logEvent(name, props)` JSON-to-stdout | throw on failure |
| `src/app/api/links/route.ts` | HTTP orchestration: auth → validate → repository → log → response | contain SQL or Zod definitions inline |
| `src/app/page.tsx` | Server-rendered dashboard | call the public API over HTTP |
| `src/components/LinkCard.tsx` | Presentational card | fetch data |
| `userscript/link-collector.user.js` | Client-side extraction + FAB + toast + POST | run on blacklisted hosts |

Dependency direction: `route.ts` → `{auth, validation, db/links, logger}` →
`db/client` → `db/schema`. No cycles.

---

## 4. Files To Create

### Config / root

| File | Purpose |
| --- | --- |
| `package.json` | scripts: `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `db:push`, `db:generate` |
| `tsconfig.json` | strict TS, `@/*` path alias to `src/*` |
| `next.config.ts` | minimal Next config |
| `postcss.config.mjs` | Tailwind v4 PostCSS plugin |
| `eslint.config.mjs` | flat config extending `next/core-web-vitals` |
| `vitest.config.mts` | `.mts` so Vite loads it as ESM; `environment: "node"`, `@` alias mirror, `tests/**/*.test.ts` |
| `drizzle.config.ts` | dialect `sqlite`/turso, schema path, `out: ./drizzle` |
| `.env.example` | the four env vars from requirements §10 |
| `.env.local` | created by the owner, gitignored |
| `.gitignore` | `node_modules`, `.next`, `.env*`, `local.db*`, `coverage`, `drizzle/meta` kept |
| `README.md` | setup, install userscript, run tests, deploy |

### Source

| File | Purpose |
| --- | --- |
| `src/app/layout.tsx` | root layout, metadata, font, `globals.css` import |
| `src/app/globals.css` | Tailwind entry + a few base styles |
| `src/app/page.tsx` | dashboard: `listLinks()` → grid of `<LinkCard>` or `<EmptyState>`, `force-dynamic` |
| `src/app/api/links/route.ts` | `POST` + `GET` + `OPTIONS` (CORS preflight). Not cached by default in Next 16. |
| `src/app/api/health/route.ts` | tiny `200 { ok: true }` probe so the userscript can be tested end-to-end |
| `src/proxy.ts` | HTTP Basic Auth gate for the dashboard. **Next 16 renamed `middleware` to `proxy`**; matcher excludes `/api/*` and static assets. Runtime is Node.js and cannot be configured. |
| `src/lib/basic-auth.ts` | `isBasicAuthValid(headerValue, expectedPassword)` + constant-time compare (pure JS, no Node built-ins) |
| `src/components/LinkCard.tsx` | thumbnail / placeholder, clamped title, host, relative time, open button |
| `src/components/EmptyState.tsx` | onboarding copy for zero rows |
| `src/components/SetupProblem.tsx` | shown when the database is unreachable (no stack traces) |
| `src/db/schema.ts` | `links` table + `Link` / `NewLink` types |
| `src/db/client.ts` | `getDb()`, `createDb({ url, authToken })`, `getRawClient()` |
| `src/db/links.ts` | `upsertLink(db, input)`, `listLinks(db, { limit })` |
| `src/lib/auth.ts` | `verifySecret(request)` |
| `src/lib/logger.ts` | `logEvent`, `extractDomain`, `extractIp` |
| `src/lib/validation.ts` | `linkInputSchema`, `linkQuerySchema`, `parseJsonBody` |
| `src/lib/time.ts` | `formatRelativeTime` for the card (pure, unit-testable) |
| `src/types/api.ts` | `ApiSuccess`/`ApiError` response shapes + error codes |

### Userscript

| File | Purpose |
| --- | --- |
| `userscript/link-collector.user.js` | the deliverable, manually installed |

### Tests (written before implementation — Phase 3)

| File | Covers |
| --- | --- |
| `tests/helpers/test-db.ts` | creates an isolated in-memory libSQL DB and applies the real generated migration SQL |
| `tests/validation.test.ts` | happy path, `""` thumbnail → `null`, relative/invalid URL rejected, title trim + length caps, bad JSON |
| `tests/auth.test.ts` | missing header, wrong header, correct header, timing-safe compare, `SECRET_KEY` unset |
| `tests/logger.test.ts` | event shape, `extractDomain`, `extractIp` (`x-forwarded-for` first hop, fallback) |
| `tests/links-repository.test.ts` | insert returns `inserted: true`; second upsert same URL returns `inserted: false`, updates title/thumbnail, preserves `id`/`createdAt`; `listLinks` ordering + `limit` cap |
| `tests/api-links.test.ts` | integration through the real `POST`/`GET` handlers: 401, 400 invalid JSON, 400 validation, 200 insert, 200 upsert, 500 on forced DB failure |
| `tests/basic-auth.test.ts` | valid/invalid/malformed Basic header, wrong password, constant-time compare, unconfigured password ⇒ `unconfigured` |
| `tests/userscript.test.ts` | blacklist boundary rules and metadata extraction, in a Node `vm` harness with stubbed DOM globals |
| `tests/time.test.ts` | relative-time formatting boundaries |

Approach: call the exported route handlers directly with a `Request` object (no HTTP
server needed). `vi.mock("@/db/client")` (with `vi.hoisted` state) points `getDb()` at the
caller's in-memory test database, so each test is isolated and fast. Repository tests call
`createDatabase({ url: ":memory:" })` directly.

**Testing ownership:** the test files are a deliverable the owner runs manually
(`npm.cmd test`). The agent still writes them before the implementation and runs them once
per step to prove the red → green transition, per RULES Phase 3.

---

## 5. Execution Checklist (Phase 5, sequential)

Each step ends in a checkpoint: run the relevant test file before moving on.

1. **Scaffold** — `git init`, `package.json`, install deps, tsconfig/next/eslint/postcss,
   `.gitignore`, `.env.example`. Checkpoint: `npm.cmd run build` is not yet expected to
   pass (no app), but `npm.cmd ls` shows deps resolved and `git status` is clean.
2. **Schema + client** — `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`.
   Checkpoint: `tests/helpers/test-db.ts` can create the table and select from it.
3. **Logging + validation + auth (red → green)** — write `tests/logger.test.ts`,
   `tests/validation.test.ts`, `tests/auth.test.ts` first; they fail; then implement
   `src/lib/logger.ts`, `src/lib/validation.ts`, `src/lib/auth.ts`.
   Checkpoint: three test files green.
4. **Repository (red → green)** — `tests/links-repository.test.ts` first, then
   `src/db/links.ts`. Checkpoint: green, including the upsert-preserves-`createdAt` case.
5. **API route (red → green)** — `tests/api-links.test.ts` first, then
   `src/app/api/links/route.ts` (+ `src/types/api.ts`). Checkpoint: green across
   401/400/200/upsert/500 paths.
6. **Dashboard UI + password gate** — `tests/basic-auth.test.ts` + `tests/time.test.ts`
   first, then `src/lib/basic-auth.ts`, `src/middleware.ts`, `src/lib/time.ts`,
   `src/components/LinkCard.tsx`, `src/components/EmptyState.tsx`, `src/app/layout.tsx`,
   `src/app/globals.css`, `src/app/page.tsx`. Checkpoint: `npm.cmd run build` succeeds and
   `npm.cmd run dev` shows the browser password prompt before the cards render.
7. **Userscript** — `userscript/link-collector.user.js` with `CONFIG`, blacklist, Shadow DOM
   FAB, toast states, timeout, spam guard. Checkpoint: manual smoke test on a real page
   against a locally running app (`/api/health` then `/api/links`).
8. **Migration + docs** — run `npm.cmd run db:push` against a scratch local file to prove
   the migration works, generate SQL into `./drizzle`, write `README.md`.
   Checkpoint: a fresh `file:./local.db` is created from the generated migration.
9. **Phase 6 review** — remove debug output that is not part of the logger, check for
   hardcoded secrets, confirm no scraping deps, re-run `test` + `lint` + `build`, and
   summarise.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `@libsql/client` file URLs differ from `libsql://` in production | All DB access goes through `createDb()`, and prod config is exercised by the same code path; `db:push` verifies the schema against both. |
| Route handler hard to unit test because the DB client is a singleton | `vi.mock("@/db/client")` + per-test temp DB keeps handlers pure and isolated. |
| Upsert race on unique `url` between two fast clicks | Client-side spam guard + `ON CONFLICT(url)` makes the operation idempotent server-side, so a race resolves to one row. |
| Tailwind v4 config differences | If the v4 PostCSS plugin causes build friction, fall back to the v3 `tailwind.config.ts` + `@tailwind` directives; noted, not pre-built. |
| Secret accidentally committed with the userscript | Committed file ships `SECRET_KEY: ""`; README step 4 warns; `git diff` check before commit. |
| `document.title` empty on some pages | Client falls back to the hostname so `title` is never empty and never trips a `400`. |

---

## 8. Implementation Deltas (what changed while building)

Discoveries made during implementation that differ from the original plan. Each is reflected
in the code and in `requirements.md`.

| # | Change | Why |
| --- | --- | --- |
| 1 | `src/middleware.ts` → **`src/proxy.ts`** | Next 16 deprecated and renamed the `middleware` file convention to `proxy`; the `runtime` option is not allowed there and it defaults to Node.js. |
| 2 | No `export const runtime` anywhere | Next 16 deprecated the Edge Runtime; Node.js is the default. |
| 3 | Tests use an **in-memory** libSQL database instead of a temp `file:` database | Windows kept a lock on the temp file, so `rmSync` failed with `EPERM` even after `client.close()` and retries. In-memory databases are isolated per client and need no cleanup. |
| 4 | Added `OPTIONS` + CORS headers on **all** `/api/links` responses | The userscript posts cross-origin from arbitrary pages. Without CORS on error responses the browser hides the status code and the script cannot distinguish `401` from a network failure. |
| 5 | `listLinks` orders by `updatedAt DESC, rowid DESC` | `Date.now()` has millisecond resolution, so saves in the same millisecond produced a non-deterministic order (caught as a flaky test). |
| 6 | `drizzle.config.ts` loads `.env.local` and coerces an empty `TURSO_AUTH_TOKEN` to `undefined` | drizzle-kit only auto-loads `.env`, so `db:push` silently targeted the fallback file; and an empty-string token failed drizzle-kit's parameter validation. Both verified with a scratch-database probe. |
| 7 | `normalizeImageUrl` rejects empty/whitespace content explicitly | `new URL("", origin)` resolves to the page URL, which would have stored the page as its own thumbnail. |
| 8 | `next.config.ts` pins `turbopack.root` | A stray lockfile in the parent directory made Turbopack guess the wrong project root. |
| 9 | `vitest.config.ts` → `vitest.config.mts` | Vite warned that the TS config was loaded as CommonJS. |
| 10 | `eslint.config.mjs` imports `eslint-config-next` directly | `eslint-config-next` v16 ships flat config arrays; the `FlatCompat` wrapper threw a circular-structure error. `@eslint/eslintrc` was removed. |
| 11 | Userscript gained a guarded CommonJS test hook, and `twitter:image` as a documented `og:image` fallback | The hook makes the blacklist and extraction logic testable; the fallback covers pages that only ship a Twitter card (the PRD allows a fallback when `og:image` is absent). |
| 12 | `NEXT_PUBLIC_APP_URL` was dropped | The dashboard never needed it, so it was unused configuration. |

---

## 9. Approval

Waiting for the owner's go-ahead before Phase 3 (writing the first failing tests).

- [ ] Approve this plan as-is.
- [ ] Request changes (list them in the reply, and this file will be updated before any code).
