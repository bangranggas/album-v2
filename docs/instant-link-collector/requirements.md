# Requirements: Instant Link Collector

Status: **Awaiting approval (Phase 1 output)**
Source of truth: `docs/prd-module-1.md` (PRD) + clarification round with the owner.
Slug: `instant-link-collector`

---

## 1. Scope

### In scope

1. A Tampermonkey userscript that injects a Floating Action Button (FAB) on web pages and
   saves the current page to a cloud database in one click.
2. A Next.js Route Handler `POST /api/links` that validates a static secret key and
   upserts link metadata.
3. A protected `GET /api/links` endpoint that returns saved links as JSON.
4. A server-rendered dashboard page that lists saved links as cards
   (thumbnail, title, and an open-link button).
5. Server-side structured logging for the two PRD analytics events.
6. Database schema + migration for a `links` table.

### Out of scope (explicitly)

- Tag / folder / note input at save time.
- Local IndexedDB sync (data is written straight to the cloud DB).
- Full link-management product (search, edit, delete, bulk actions, pagination UI).
- Multi-user accounts, sign-up, sessions, or roles. This is a single-user tool.
- Any server-side scraping. No Puppeteer, no `fetch`-and-parse of the target page.

---

## 2. Confirmed Decisions

| Topic | Decision | Rationale |
| --- | --- | --- |
| Database | Turso (libSQL serverless) | Chosen by owner. Good free tier, no cold-start pain. |
| ORM | Drizzle ORM | Typed schema, works with libSQL, easy `push`/migrate. |
| Local / test DB | libSQL local file (`file:...`) | Lets dev + tests run with zero cloud credentials. |
| Testing | Vitest | Chosen by owner. Fast, native TS/ESM. |
| Framework | Next.js App Router + TypeScript | PRD names Next.js Route Handlers. |
| Auth | Static secret key in `x-secret-key` header, compared to `SECRET_KEY` env | PRD "Secret-Key Auth". Single user. |
| Read access | Protected `GET /api/links` (secret header) + server-rendered dashboard | Owner asked for a cards page for verification. |
| Dashboard auth | **HTTP Basic Auth** enforced by `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`) using `DASHBOARD_PASSWORD` from `.env` | Owner required the dashboard to be locked behind a password. |
| Testing ownership | Test files are delivered as runnable scripts; the owner runs them manually | Owner's request. Tests are still written first (Phase 3) and verified once by the agent so the deliverable is trustworthy. |
| Duplicate URL | Upsert per URL (update `title`/`thumbnail`/`updated_at`) | Chosen by owner. No duplicate rows. |
| Userscript distribution | Single committed `.user.js` file, manual Tampermonkey install | Chosen by owner. |
| Secret in userscript | Edited manually inside the file's `CONFIG` block | Chosen by owner. See accepted risk below. |
| Analytics | Structured JSON logs to stdout (`console.*` via a logger module) | Chosen by owner. Zero cost, readable in Vercel logs. |
| Injection blacklist | Default blocklist enabled, configurable in the userscript | Chosen by owner. |
| Language | All docs and code in English | Chosen by owner. |
| Version control | `git init` in the project root + `.gitignore` | Chosen by owner. |
| Hosting / runtime | Vercel, Node.js serverless functions (Next.js default runtime) | Next 16 deprecates the Edge Runtime, so no `runtime` export is used; the PRD's "Edge Runtime **or** Serverless function" is satisfied by the serverless function. |

### Accepted trade-offs (owner-approved, documented for the record)

1. **Dashboard is protected by a shared password, not per-user accounts.** HTTP Basic Auth
   over HTTPS is adequate for a single-user tool, but if `DASHBOARD_PASSWORD` is weak the
   page is only as strong as that password. `DASHBOARD_PASSWORD` must be at least 16
   characters. The browser sends the password on every request; HTTPS is required in
   production (Vercel provides it).
2. **The userscript file can leak the secret if committed with a real value.** The
   committed file ships with an empty `CONFIG.SECRET_KEY`. The owner fills it locally and
   must not commit that edit. Mitigation: `.gitignore` cannot help for a tracked file, so
   `README.md` will warn, and reviewers must check `git diff` before committing.
3. **`og:image` may be a relative URL** on some sites. The script resolves it against the
   page origin before sending, and sends `null` when absent.

---

## 3. Data Contract

### `POST /api/links`

Request headers:

```
content-type: application/json
x-secret-key: <secret>
```

Request body:

```json
{
  "url": "https://example.com/article",
  "title": "Example Article",
  "thumbnail": "https://example.com/og.jpg"
}
```

- `url` — required, non-empty string, must parse as an `http(s)` absolute URL, max 2048 chars.
- `title` — required, non-empty after trim, max 512 chars. Falls back to the URL hostname
  **on the client** if `document.title` is empty.
- `thumbnail` — optional. `null` or `""` are both accepted and normalized to `null`.
  Must be an `http(s)` URL when present, max 2048 chars.

Response `200`:

```json
{
  "ok": true,
  "data": {
    "id": "01J...",
    "url": "https://example.com/article",
    "title": "Example Article",
    "thumbnail": "https://example.com/og.jpg",
    "createdAt": "2026-10-17T10:00:00.000Z",
    "updatedAt": "2026-10-17T10:00:00.000Z",
    "inserted": true
  }
}
```

- `inserted` is `true` on first save and `false` when an existing URL was updated.

Error responses:

| Status | Body `error` code | When |
| --- | --- | --- |
| `400` | `INVALID_JSON` | Body is not valid JSON. |
| `400` | `VALIDATION_ERROR` | `url` or `title` missing/invalid, or a field too long. |
| `401` | `UNAUTHORIZED` | `x-secret-key` header missing or not equal to `SECRET_KEY`. |
| `500` | `INTERNAL_ERROR` | Database write failed. Message is never leaked to the client. |

### `GET /api/links`

Request headers: `x-secret-key: <secret>`.

Response `200`:

```json
{ "ok": true, "data": { "links": [ /* same object shape as above, newest first */ ] } }
```

| Status | Body `error` code | When |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | Header missing or wrong. |
| `500` | `INTERNAL_ERROR` | Database read failed. |

Query params: `limit` (optional, integer 1–200, default 100). No pagination UI in this release.

---

## 4. Database Schema

Table `links`:

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | `text` | primary key (UUID v4 generated server-side) |
| `url` | `text` | not null, **unique** (the upsert key) |
| `title` | `text` | not null |
| `thumbnail` | `text` | nullable |
| `created_at` | `integer` | not null, unix epoch **milliseconds** |
| `updated_at` | `integer` | not null, unix epoch milliseconds |

Index: unique index on `url` (drives the upsert and duplicate protection).

Upsert semantics: `INSERT ... ON CONFLICT(url) DO UPDATE SET title, thumbnail, updated_at`.
`created_at` and `id` are preserved on update.

---

### CORS

Because the userscript runs in the page context (`@grant none`) and posts
cross-origin from arbitrary sites, the API handles `OPTIONS` preflight and sends
`access-control-allow-origin: *` on **every** response, including `401`, `400`, and `500`.
Without CORS headers on error responses the browser hides the status code, and the script
would report "Failed to save" instead of "Unauthorized".

`*` is acceptable here: the endpoint reads no cookies or ambient credentials, and every
read and write requires `x-secret-key`, which only the owner holds. It also avoids asking the
user for a `GM_xmlhttpRequest` domain permission.

Allowed headers: `content-type`, `x-secret-key`. Allowed methods: `GET`, `POST`, `OPTIONS`.

---

## 5. Userscript Behaviour

### Injection

- Runs on `*://*/*`, `@run-at document-idle`.
- Skips injection when the host matches the blacklist (see below).
- Injects a single FAB into a closed **Shadow Root** so page CSS cannot distort it and our
  CSS cannot leak into the page.
- FAB: fixed, bottom-right, 48px, high `z-index`, bookmark icon, `role="button"`,
  `aria-label="Save link"`, visible focus ring.

### Blacklist (default)

| Rule | Example |
| --- | --- |
| Localhost and loopback | `localhost`, `127.0.0.1`, `::1`, `[::1]` |
| Local-only suffixes | `.local`, `.internal`, `.test` |
| Browser-internal schemes | `chrome:`, `about:`, `edge:`, `brave:`, `file:` (already excluded by `@match`) |
| Banking | `bca.co.id`, `klikbca.com`, `bni.co.id`, `mandiri.co.id`, `bri.co.id`, `btn.co.id`, `cimbniaga.co.id`, `permata.me`, `ocbc.id`, `maybank.co.id`, `danamon.co.id`, `panin.co.id`, `jenius.com` |
| Payments | `paypal.com`, `paypal.me`, `wise.com`, `stripe.com` |
| Documents | any URL ending in `.pdf` (with or without a query string or hash) |

Matching is suffix-aware but boundary-safe: `bca.co.id` blocks `bca.co.id` and
`ibank.bca.co.id`, and does **not** block `notbca.co.id` or `bca.co.id.evil.example`.

The lists live in `CONFIG.BLACKLIST_HOSTS` / `CONFIG.BLACKLIST_URL_PATTERNS` so the owner can
extend them without touching logic.

### Save flow

1. Click FAB → set state `loading`: FAB shows spinner, button disabled
   (spam guard: a second click while loading is ignored).
2. Toast appears with `Saving...`.
3. Extract the page metadata, entirely client-side:
   - `url` — current `origin + pathname + search`, with the `#hash` stripped (a hash is a
     scroll position, not part of the resource identity).
   - `title` — `document.title`, trimmed; falls back to `location.hostname` when empty so
     the field can never trip server-side validation.
   - `thumbnail` — `og:image` first, then `og:image:url`, then `twitter:image` as a
     fallback. Relative and protocol-relative values are resolved against
     `location.origin`. Empty/whitespace content, non-`http(s)` schemes, and parse failures
     all yield `null`.
4. `fetch(`${CONFIG.API_BASE_URL}/api/links`)`, method `POST`, JSON body, header
   `x-secret-key`, `signal: AbortSignal.timeout(CONFIG.TIMEOUT_MS)` (default 8000ms).
5. On `2xx` → toast `Saved successfully!` (green), auto-dismiss after 2000ms.
6. On `401` → toast `Unauthorized. Please update Secret Key.` (red), dismiss after 3000ms.
7. On any other non-`2xx`, network error, or timeout → toast
   `Error: Failed to save link` (red), dismiss after 3000ms.
8. Always return FAB to `default` state.

Toast is rendered inside the same shadow root, positioned above the FAB, and replaced
(never stacked) so repeated clicks cannot pile up notifications.

### Tampermonkey header

Includes `@match *://*/*`, `@run-at document-idle`, `@grant none`, `@version`, and a
`@noframes` directive so the FAB is injected once (top frame only).

`@grant none` means the request uses the page's own `fetch`, so no `GM_xmlhttpRequest`
permission is needed — see the CORS section in §4.

The file ends with a guarded CommonJS test hook
(`if (typeof module === "object" && module.exports)`). It is unreachable in Tampermonkey and
exists so `tests/userscript.test.ts` can exercise the blacklist and extraction logic in a
Node `vm` harness with stubbed DOM globals.

---

## 6. Dashboard Page

- Route `/`, React Server Component, queries the DB directly (no HTTP hop, no secret in
  the browser).
- **Locked behind HTTP Basic Auth** (see §6.1).
- Layout: responsive grid of cards, 1 column on mobile, up to 4 on wide screens.
- Card: 16:9 thumbnail area (placeholder box with the link host when `thumbnail` is
  `null`), title clamped to 2 lines, host name, relative saved time, and an
  **Open link** button/`<a>` that opens the URL in a new tab with
  `rel="noopener noreferrer"`.
- Sorted newest first. Empty state: a short message explaining how to install the
  userscript.
- `export const dynamic = "force-dynamic"` so the list is never served stale from cache.

### 6.1 Dashboard Password Gate

Implemented in `src/proxy.ts` (Next 16 file convention; runs before the page renders, Node.js
runtime by default).

- Reads `DASHBOARD_PASSWORD` from the environment. **If it is unset or shorter than 16
  characters, every gated request returns `503` with a message telling the operator to
  configure it.** Fail closed, never fail open.
- Expects `Authorization: Basic base64(<anything>:<password>)`. The username is ignored;
  only the password is compared, using a constant-time comparison.
- On mismatch or missing header: `401` with `WWW-Authenticate: Basic realm="Link Collector",
  charset="UTF-8"`, so the browser shows its native password prompt.
- On match: the request continues to the page.

Matcher scope — **the API is deliberately excluded** so the Tampermonkey script keeps
working with `x-secret-key` only:

```
matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
```

| Path | Guard |
| --- | --- |
| `/` | Basic Auth (`DASHBOARD_PASSWORD`) |
| `/api/links` | `x-secret-key` header (`SECRET_KEY`) |
| `/api/health` | none (returns only `{ ok: true }`) |
| `/_next/*`, `/favicon.ico` | none (static assets) |

`/api/health` is intentionally open and must never return data or configuration, only a
liveness boolean.

---

## 7. Analytics / Observability

Logger module emits one JSON line per event to stdout. These are intentional operational
logs, not debug leftovers, and are exempt from the Phase 6 "remove console.log" rule.

| Event | Trigger | Properties |
| --- | --- | --- |
| `api_link_saved` | Successful upsert | `url_domain`, `latency_ms`, `inserted` |
| `api_auth_failed` | Request rejected for a bad/missing secret | `ip_address`, `route` |
| `api_validation_failed` | Body failed validation | `route`, `reason` |
| `api_error` | Unexpected DB/unknown failure | `route`, `message` |

`ip_address` is read from the `x-forwarded-for` first hop, falling back to `"unknown"`.
`url_domain` is the parsed hostname; parsing failures yield `"invalid"`.

---

## 8. Acceptance Criteria (mapped to PRD)

### Userscript

- [ ] FAB appears automatically on blacklist-compliant pages.
- [ ] URL and title extracted correctly for the tested pages.
- [ ] `og:image` detected when present; `null` sent when absent.
- [ ] Loading / success / error feedback via auto-dismissing toasts.
- [ ] Double-click while loading does not send a second request.

### API

- [ ] Requests without a valid secret key get `401`.
- [ ] Valid JSON payload is persisted to Turso/Supabase in < 100ms (local/dev measure).
- [ ] No `puppeteer`/scraping dependency exists anywhere in the dependency tree.
- [ ] Same URL saved twice produces one row and returns `200`.

### Dashboard

- [ ] Saved links render as cards with thumbnail, title, and an open-link button.
- [ ] Empty state is shown when there is no data.

### Quality gate

- [ ] `npm.cmd test` passes.
- [ ] `npm.cmd run lint` passes.
- [ ] `npm.cmd run build` succeeds.
- [ ] `git grep` finds no real secret committed.

---

## 9. Open Questions Inherited From the PRD

| Question | Owner | Status | Resolution |
| --- | --- | --- | --- |
| Which sites to blacklist? | Jeremia | Open | Default blocklist implemented (section 5). Owner can extend `CONFIG.BLACKLIST_*` at any time. Not blocking. |

---

## 10. Environment Variables

| Name | Required | Example | Notes |
| --- | --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | `libsql://my-db.turso.io` / `file:./local.db` | Local file is used for dev + tests. |
| `TURSO_AUTH_TOKEN` | prod only | `eyJ...` | Omitted for `file:` URLs. |
| `SECRET_KEY` | yes | 32+ random chars | Shared by the API and the userscript `CONFIG`. |
| `DASHBOARD_PASSWORD` | yes | 16+ chars | Basic Auth password for the `/` dashboard. Unset/short ⇒ `503`. |
