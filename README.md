# Instant Link Collector v1

Save any web page to your own cloud database with a single click, from a Tampermonkey
userscript. All metadata extraction (URL, title, `og:image`) happens in the browser, so the
server never scrapes anything and can run entirely on free tiers.

- **Ingestion:** `POST /api/links` — secret-key protected, no scraping, no Puppeteer.
- **Dashboard:** `/` — password-protected grid of link cards (thumbnail, title, open button).
  Sign-in is a dedicated page (`/login`) with a single password field, no username.
- **Read API:** `GET /api/links` — secret-key protected JSON.
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Drizzle ORM · Turso/libSQL.

Planning and design documents live in [`docs/instant-link-collector/`](docs/instant-link-collector),
and the login page / navbar work in [`docs/dashboard-login-navbar/`](docs/dashboard-login-navbar).

---

## 1. Requirements

- Node.js 20.12 or newer (this project is developed on Node 24).
- A Turso database for production (optional for local development).
- Tampermonkey installed in your browser.

> **Windows PowerShell note:** if `npm` is blocked by the execution policy
> (`npm.ps1 cannot be loaded`), use `npm.cmd` instead of `npm` for every command in this
> README.

> **Windows port note:** Hyper-V reserves blocks of local ports, which can make a default
> port fail with `EACCES`. This project defaults to port **4200** (set in `package.json`),
> which avoids those reserved ranges. If you need a different port, check
> `netsh interface ipv4 show excludedportrange protocol=tcp` and override with:
>
> ```powershell
> npm.cmd run dev -- -p 4300
> ```
>
> Then set `CONFIG.API_BASE_URL` in the userscript to the same origin
> (`http://localhost:4200` by default).

---

## 2. Setup

```bash
npm install
```

Create the local environment file and fill in two secrets:

```bash
cp .env.example .env.local
```

Generate values (PowerShell-friendly):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

1. Put the first value in `SECRET_KEY` — shared with the userscript.
2. Put a second, different value (16+ characters) in `DASHBOARD_PASSWORD` — the dashboard
   login password.

Create the database schema:

```bash
npm.cmd run db:push
```

`db:push` creates the current schema in one step, which is all a fresh database needs. If you
already had a database from before the `domain` column was added, apply the migration instead,
because only a migration can also backfill the domains of the links you already saved:

```bash
npm.cmd run db:migrate
```

A database created with `db:push` has no migration history, so `db:migrate` would try to
recreate the tables it already has. For that case run the statements in
`drizzle/0001_*.sql` against it directly — they add the column, index it, and backfill every
existing row.

Start the app:

```bash
npm.cmd run dev
```

Open `http://localhost:4200`. You are redirected to the login page at `/login`, which asks
for a single password — enter the value of `DASHBOARD_PASSWORD`. There is no username
field and no browser popup. The session is kept in a signed, `HttpOnly` cookie for 7 days.

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | `file:./local.db` locally, `libsql://<db>-<org>.turso.io` in production. |
| `TURSO_AUTH_TOKEN` | production | Required for Turso, empty for local files. |
| `SECRET_KEY` | yes | 32+ random characters. Used by the API and the userscript. |
| `DASHBOARD_PASSWORD` | yes | 16+ characters. If unset or shorter, the dashboard returns `503`. |

`.env.local` is gitignored. Never commit real values.

---

## 3. Setting up Turso

The app stores links in a **Turso** (libSQL) database. Local development uses a plain file
(`file:./local.db`), so you only need this section when you want a hosted database — for
example before deploying. It takes about five minutes, and the free tier is enough.

### 3.1 Create the database

1. Go to <https://turso.tech> and sign up (GitHub sign-in works).
2. In the dashboard, click **Create Database**.
3. Give it a name (for example `link-collector`) and pick the region closest to you.
4. Open the new database and use **Connect** / **Copy URL** to reveal the credentials.

### 3.2 Note the two values

| Value | Looks like | Goes into |
| --- | --- | --- |
| Database URL | `libsql://link-collector-yourname.turso.io` | `TURSO_DATABASE_URL` |
| Auth token | a long `eyJhbGciOi...` JWT string | `TURSO_AUTH_TOKEN` |

> The auth token grants full access to the database. Treat it like a password: keep it in
> `.env.local` and in your host's environment settings, never in the repository.

### 3.3 Point the app at it

Edit `.env.local`:

```bash
TURSO_DATABASE_URL="libsql://link-collector-yourname.turso.io"
TURSO_AUTH_TOKEN="eyJhbGciOi..."
```

Create the tables in the hosted database, then restart the dev server:

```bash
npm.cmd run db:push
npm.cmd run dev
```

### 3.4 CLI alternative

If you prefer the terminal, the Turso CLI does the same thing:

```bash
# install: https://docs.turso.tech/cli/installation
turso auth login
turso db create link-collector
turso db show link-collector --url        # -> TURSO_DATABASE_URL
turso db tokens create link-collector     # -> TURSO_AUTH_TOKEN
```

### 3.5 Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `TURSO_DATABASE_URL is not set` | No `.env.local` (or the variable is blank). Copy `.env.example` and fill it in. |
| `The link database is not reachable` on the dashboard | The URL/token pair is wrong, or the tables do not exist yet. Re-check both values, then run `npm run db:push`. |
| `authentication error` / `401` from libSQL | `TURSO_AUTH_TOKEN` is wrong, expired, or belongs to a different database. Create a fresh token. |
| Works locally, `500` in production | The environment variables were not added in the host's dashboard. See §8. |

---

## 4. Installing the userscript

1. Open Tampermonkey → **Create a new script**.
2. Replace the template with the contents of
   [`userscript/link-collector.user.js`](userscript/link-collector.user.js).
3. Edit the `CONFIG` block at the top of the file:

   ```js
   API_BASE_URL: "http://localhost:4200",  // or your Vercel URL
   SECRET_KEY: "<the same value as the server's SECRET_KEY>",
   ```

4. Save (Ctrl+S). A bookmark button appears in the bottom-right corner of every page.

> **Keep the secret out of git.** The committed file ships with `SECRET_KEY: ""` on
> purpose. Filling it in is a local, uncommitted edit — check `git diff` before every
> commit so the key is never pushed.

### How the button behaves

| State | What you see |
| --- | --- |
| Idle | Bookmark icon, bottom-right |
| Clicked | Icon becomes a spinner, toast shows `Saving...` |
| Success | Green `Saved successfully!` for 2 seconds |
| Wrong key | Red `Unauthorized. Please update Secret Key.` for 3 seconds |
| Network / server error | Red `Error: Failed to save link` for 3 seconds |

Clicking again while a request is in flight does nothing, so double clicks cannot create
duplicate requests.

### Where the button is *not* injected

`CONFIG.BLACKLIST_HOSTS` and `CONFIG.BLACKLIST_URL_PATTERNS` block localhost, `.local` and
`.internal` hosts, PDF documents, and a list of banking and payment domains (an entry also
covers its subdomains). Extend these lists as needed — no other code has to change.

---

## 5. API reference

### `POST /api/links`

```bash
curl -X POST http://localhost:4200/api/links \
  -H "content-type: application/json" \
  -H "x-secret-key: $SECRET_KEY" \
  -d '{"url":"https://example.com/a","title":"Example","thumbnail":null}'
```

| Status | Error code | Meaning |
| --- | --- | --- |
| 200 | — | Saved. `data.inserted` is `true` for a new URL, `false` when an existing row was updated. |
| 400 | `INVALID_JSON` | Body is not valid JSON. |
| 400 | `VALIDATION_ERROR` | `url` or `title` missing/invalid, or a field too long. |
| 401 | `UNAUTHORIZED` | `x-secret-key` missing or wrong. |
| 500 | `INTERNAL_ERROR` | Database failure. Details are logged, never returned. |

Saving the same URL twice updates `title`/`thumbnail`/`updated_at` instead of creating a
second row (enforced by a unique index on `url`).

### `GET /api/links?limit=100`

Requires `x-secret-key`. Returns `{ ok: true, data: { links: [...] } }`, most recently
saved first. `limit` accepts 1–200 and defaults to 100.

### `GET /api/health`

Open, no auth. Returns `{ ok: true }` and nothing else.

### `POST /api/auth/login`

The dashboard login. Body: `{ "password": "..." }`. There is **no username field** — one
shared password is the entire credential.

| Status | Meaning |
| --- | --- |
| 200 | Password accepted. Sets the `lc_session` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, 7 days, `Secure` in production. |
| 400 | `INVALID_JSON`, or `VALIDATION_ERROR` when `password` is missing/empty. No cookie is set. |
| 401 | `UNAUTHORIZED` — wrong password. No cookie is set. |
| 503 | `UNCONFIGURED` — `DASHBOARD_PASSWORD` is missing or shorter than 16 characters. |

The cookie holds only an expiry and an HMAC signature (signed with the dashboard password);
the password itself is never stored in it. That also means changing `DASHBOARD_PASSWORD`
invalidates every existing session.

### `POST /api/auth/logout`

Clears the `lc_session` cookie (`Max-Age=0`) and returns `{ ok: true }`. Sessions are
stateless, so there is nothing else to clean up.

### Dashboard pages

Everything except `/login` and `/api/*` requires the `lc_session` cookie. Without it you are
redirected to `/login?next=<the page you asked for>`; `?next=` is sanitised, so it can only
ever point at a path on this site (no open redirect). While `DASHBOARD_PASSWORD` is unset or
too short, gated pages answer `503` instead of rendering.

### Filtering and search

The dashboard list can be narrowed by domain and by free text, and the filter state lives in
the URL, so a filtered view can be reloaded, bookmarked, and shared.

| Parameter | Meaning |
| --- | --- |
| `?domain=` | Exact domain match, e.g. `/?domain=www.indoav.com`. Lowercased before it is matched, so `?domain=Example.COM` works. |
| `?q=` | Case-insensitive substring of the **title** or the **url** (which also covers the domain), e.g. `/?q=hotel`. `%` and `_` are matched literally, not as wildcards. |

Both can be combined (`/?domain=example.com&q=hotel`) and both are optional; an empty or
whitespace-only value means "no filter". Over-long values are truncated (200 characters for
the search, 253 for the domain) rather than ignored.

Filtering and the 100-row cap are one query, so the limit applies to the **filtered** result:
narrowing the view never hides a match behind the cap. The dropdown is always built from the
whole table, so an active filter cannot hide the domain you want to switch to, and each
option carries its link count. The count line reads `4 links` unfiltered and `2 of 5 links`
while filtering.

Domains are not parsed out of the URL on every read: `links.domain` is a real column,
derived once during validation and stored. A re-save rewrites it, so a link saved before the
column existed repairs itself the next time it is saved.

### CORS

The API answers the `OPTIONS` preflight and sends
`access-control-allow-origin: *` on **every** response, including `401`/`400`/`500`. This is
required because the userscript posts cross-origin from arbitrary sites, and the browser
hides the status code of an error response that lacks CORS headers. It is safe here: the
endpoint reads no cookies or ambient credentials, and every operation needs the secret key.

---

## 6. Testing

Tests are plain Vitest scripts and are meant to be run manually:

```bash
npm.cmd test          # one-off run
npm.cmd test:watch    # watch mode
```

Each run uses an isolated **in-memory** libSQL database with the real generated migration
applied, so no cloud credentials and no cleanup are required.

| Test file | Covers |
| --- | --- |
| `tests/validation.test.ts` | Payload parsing, normalisation, length caps, limit parameter, derived domain |
| `tests/login-input.test.ts` | Login payload validation (single password, no username) |
| `tests/auth.test.ts` | Secret-key verification, constant-time comparison, fail-closed behaviour |
| `tests/session.test.ts` | Session token signing/verification, expiry, tampering, fail-closed |
| `tests/dashboard-auth.test.ts` | Gate decisions and the password check |
| `tests/auth-routes.test.ts` | Login/logout handlers, cookie attributes, status codes, no cookie on failure |
| `tests/proxy.test.ts` | Redirect vs. allow vs. `503`, `?next=` handling, matcher exclusions |
| `tests/redirect.test.ts` | `?next=` sanitising (open-redirect protection) |
| `tests/logger.test.ts` | Event shape, domain/IP extraction, serialization safety |
| `tests/link-filters.test.ts` | `?q=` / `?domain=` normalisation and URL building |
| `tests/links-repository.test.ts` | Insert vs update, upsert idempotency, concurrent saves, ordering, domain filter, search (incl. escaped `%`/`_`), domain list, counts |
| `tests/api-links.test.ts` | Full `POST`/`GET`/`OPTIONS` behaviour, status codes, CORS, analytics events |
| `tests/time.test.ts` | Relative-time formatting boundaries |
| `tests/userscript.test.ts` | Blacklist rules and metadata extraction, run in a Node `vm` harness |
| `tests/test-db-helper.test.ts` | Migration application and the unique index on `url` |

---

## 7. Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build and server |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:generate` | Generate a new SQL migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply the migrations in `drizzle/` in order (data backfills included) |
| `npm run db:push` | Apply the schema to the database in `.env.local` |
| `npm run db:studio` | Drizzle Studio |

---

## 8. Deploying

Setting up the hosted database is covered in [§3](#3-setting-up-turso); this section is the
rest of the deployment.

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project** and import the repository.
3. Under **Settings → Environment Variables**, add all four:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SECRET_KEY`, and `DASHBOARD_PASSWORD`
   (16+ characters).
4. Apply the schema to the hosted database once, from your machine:
   `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:push` (or `db:migrate` if the
   database already exists and you want the data backfills too).
5. Deploy, open the deployment, and log in at `/login`.
6. Point `CONFIG.API_BASE_URL` in your local userscript copy at the deployment URL.

Always serve over HTTPS: the login sends the password over the wire, and the session cookie
is only marked `Secure` in production.

The app uses Node.js serverless functions. Next.js 16 deprecates the Edge Runtime, so no
`runtime` export is set, and the PRD's "Edge Runtime **or** Serverless function" requirement
is met by the serverless function.

---

## 9. Security notes

- **The dashboard password is a shared secret**, not user accounts. Anything it protects is
  only as strong as `DASHBOARD_PASSWORD`. Use 16+ random characters and always serve over
  HTTPS (Vercel does).
- **The session cookie is stateless and signed**, not encrypted, and contains no password —
  only an expiry and an HMAC of it. Forging one requires the dashboard password, and
  changing `DASHBOARD_PASSWORD` logs every session out immediately.
- **Login attempts are logged** as structured JSON (`dashboard_login_succeeded`,
  `dashboard_login_failed` with a reason and the client IP), so repeated failures are visible
  in the host's logs.
- **Rotating `SECRET_KEY`** immediately invalidates the userscript; update `CONFIG.SECRET_KEY`
  after rotating. It is separate from the dashboard login, which keeps working.
- **No scraping.** The dependency tree contains no browser automation or HTML parsing
  library; the browser supplies all metadata.
- Server-side error details are logged in structured JSON (Vercel captures them) and never
  returned to clients.

---

## 10. Project layout

```
src/
  app/
    (app)/                  authenticated pages: navbar layout + dashboard
      layout.tsx            renders the navbar
      page.tsx              dashboard (password protected, force-dynamic)
    login/
      page.tsx              login page: single password field, no username
      login-form.tsx        client form (POST /api/auth/login)
    api/
      auth/login/route.ts   creates the session cookie
      auth/logout/route.ts  clears the session cookie
      health/route.ts       liveness probe (no auth, no data)
      links/route.ts        POST + GET + OPTIONS
    globals.css             Tailwind entry
    layout.tsx              root layout
  components/
    EmptyState.tsx          onboarding copy when there are no links
    LinkCard.tsx            thumbnail / title / domain / open button
    LinkFilters.tsx         domain dropdown + search box, drives the URL
    LogoutButton.tsx        navbar log out control
    Navbar.tsx              top navigation
    NavLinks.tsx            active-aware nav links
    NoMatches.tsx           shown when links exist but none match the filters
    SetupProblem.tsx        shown when the database is unreachable
  db/
    client.ts               lazy libSQL client + drizzle instance, cached per URL
    links.ts                upsertLink + listLinks/listDomains/countLinks (the only SQL)
    schema.ts               links table
  lib/
    auth.ts                 x-secret-key verification (userscript API)
    dashboard-auth.ts       dashboard password check + gate decision
    link-filters.ts         ?q= / ?domain= normalisation + URL building
    logger.ts               structured JSON events
    nav.ts                  navbar items (add a module here)
    redirect.ts             ?next= sanitising (open-redirect protection)
    session.ts              signed session token: sign + verify
    time.ts                 relative time formatting
    validation.ts           payload + query validation
  proxy.ts                  session gate for the dashboard pages
  types/api.ts              wire format + error codes
drizzle/                    generated SQL migrations (applied by tests too)
tests/                      Vitest suites and helpers
userscript/
  link-collector.user.js    the Tampermonkey script
```
