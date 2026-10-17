# Instant Link Collector v1

Save any web page to your own cloud database with a single click, from a Tampermonkey
userscript. All metadata extraction (URL, title, `og:image`) happens in the browser, so the
server never scrapes anything and can run entirely on free tiers.

- **Ingestion:** `POST /api/links` — secret-key protected, no scraping, no Puppeteer.
- **Dashboard:** `/` — password-protected grid of link cards (thumbnail, title, open button).
  Sign-in is a dedicated page (`/login`) with a single password field, no username.
- **Link management:** star a link as a favorite, edit its title/URL/thumbnail, delete it, or
  add one by hand — from the dashboard.
- **Locked area:** `/locked` — a dark, passcode-protected page where domains can be marked as
  hidden. Their links disappear from `/` entirely and live only there.
- **Read API:** `GET /api/links` — secret-key protected JSON.
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Drizzle ORM · Turso/libSQL.

Planning and design documents live in [`docs/instant-link-collector/`](docs/instant-link-collector),
the login page / navbar work in [`docs/dashboard-login-navbar/`](docs/dashboard-login-navbar),
the filter work in [`docs/dashboard-filters/`](docs/dashboard-filters), and the locked area /
link management in [`docs/locked-domains-and-link-management/`](docs/locked-domains-and-link-management).

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

Create the local environment file and fill in the secrets:

```bash
cp .env.example .env.local
```

Generate values (PowerShell-friendly):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

1. Put the first value in `SECRET_KEY` — shared with the userscript.
2. Put a second, different value in `DASHBOARD_PASSWORD` — the dashboard login password.
3. Put a third value in `LOCKED_PASSCODE` — the passcode for the hidden area at `/locked`.
   It can be any string you can retype, for example a passphrase.

`DASHBOARD_PASSWORD` and `LOCKED_PASSCODE` have no minimum length: any non-blank value works.
A long random one is still the safest choice, especially over the public internet.

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
existing row. A database created before favorites and locked domains existed needs the same
treatment for `drizzle/0002_*.sql`, which adds `links.is_favorite` and the `locked_domains`
table.

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
| `DASHBOARD_PASSWORD` | yes | Any non-blank value. If unset or blank, the dashboard returns `503`. |
| `LOCKED_PASSCODE` | for `/locked` | Any non-blank value. If unset or blank, only `/locked` returns `503`; the rest of the dashboard keeps working. |

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
| Same panel, but the URL and token are definitely right | The connection works and the schema is simply older than the code — typically an earlier `db:push` was interrupted, so some objects are missing (the server log says `no such table: locked_domains`). Run `npm run db:push` again: it only adds what is missing and leaves existing rows alone. |
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
| 503 | `UNCONFIGURED` — `DASHBOARD_PASSWORD` is missing or blank. |

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
blank, gated pages answer `503` instead of rendering.

### Filtering and search

The dashboard list can be narrowed by domain, by favorites, and by free text, and the filter
state lives in the URL, so a filtered view can be reloaded, bookmarked, and shared.

| Parameter | Meaning |
| --- | --- |
| `?domain=` | Exact domain match, e.g. `/?domain=www.indoav.com`. Lowercased before it is matched, so `?domain=Example.COM` works. |
| `?q=` | Case-insensitive substring of the **title** or the **url** (which also covers the domain), e.g. `/?q=hotel`. `%` and `_` are matched literally, not as wildcards. |
| `?favorite=1` | Only starred links. `1`, `true`, `on`, and `yes` all switch it on; anything else is off. |

All three can be combined (`/?domain=example.com&q=hotel&favorite=1`) and all are optional; an
empty or whitespace-only value means "no filter". Over-long values are truncated (200
characters for the search, 253 for the domain) rather than ignored.

Filtering and the 100-row cap are one query, so the limit applies to the **filtered** result:
narrowing the view never hides a match behind the cap. The dropdown is always built from
every domain in scope, so an active filter cannot hide the domain you want to switch to, and
each option carries its link count. The count line reads `4 links` unfiltered and
`2 of 5 links` while filtering.

Domains are not parsed out of the URL on every read: `links.domain` is a real column,
derived once during validation and stored. A re-save rewrites it, so a link saved before the
column existed repairs itself the next time it is saved.

### Managing links

Every card has three controls: a star (favorite), a pencil (edit), and a trash can (delete).

- **Favorites** toggle in place. A starred card shows a badge over its thumbnail, and the
  `Favorites` button in the filter bar narrows the grid to starred links.
- **Edit** opens an inline form for the title, URL, and thumbnail. Changing the URL
  recomputes the domain, so a link can move between domains — including into or out of the
  hidden set. A URL that another link already uses is refused (`409`) and nothing changes.
- **Delete** asks for confirmation inside the card (no browser popup) and is permanent.
- **Add link** opens a compact form (URL required, title and thumbnail optional); an empty
  title is derived from the URL, e.g. `example.com/article`. Pasting a URL that is already
  saved updates that row instead of failing.

### The locked area

`/locked` is a **dark** page behind a second secret. Click the icon-only lock button at the
right of the filter bar on `/`; without a passcode cookie you land on `/locked/unlock`, which
asks for `LOCKED_PASSCODE`.

- The page lists **only** links whose domain is locked, with the same filter bar, favorites
  filter, card actions, and manual add form as `/`.
- The **Locked domains** panel lists every hidden domain with its link count, and can add or
  remove one. Locking applies to the domain, so links saved to it later are hidden too.
- Access lasts **one hour**; `Lock now` ends it immediately. The cookie (`lc_locked`) is
  `HttpOnly`, `SameSite=Lax`, and signed with the passcode under its own signature context,
  so a dashboard session can never be used as a passcode (even if both secrets are equal).
- A locked domain is invisible on `/`: its links are excluded from the list, the search, the
  dropdown, and the count. Removing it from the panel brings the links straight back.

Unlocking a hidden domain is decided by the passcode, so `LOCKED_PASSCODE` is required for the
whole page — but `/` and the ingestion API keep working if it is not set.

### Dashboard endpoints

These are called by the dashboard itself and are authenticated by the `lc_session` cookie (not
`x-secret-key`), so they are same-origin only and send no CORS headers.

| Endpoint | Body | Notes |
| --- | --- | --- |
| `POST /api/dashboard/links` | `{ url, title?, thumbnail? }` | Adds a link by hand. `title` falls back to `host + path`. |
| `PATCH /api/dashboard/links/:id` | any of `{ title, url, thumbnail, isFavorite }` | Edits a link. `409` when the URL belongs to another link, `404` when the link is gone. |
| `DELETE /api/dashboard/links/:id` | — | Permanent. `404` when there was nothing to delete. |
| `POST /api/locked/unlock` | `{ passcode }` | Sets `lc_locked` for one hour. |
| `POST /api/locked/lock` | — | Clears `lc_locked`. |
| `POST /api/locked/domains` | `{ domain }` | Hides a domain. Accepts a pasted URL and normalises it. |
| `DELETE /api/locked/domains/:domain` | — | Reveals a domain again. |

The locked endpoints need the session **and** the passcode cookie; the link endpoints need
only the session. `/api/links` (the userscript API) is unchanged by all of this: it still
returns every link, hidden or not, because it is already behind `SECRET_KEY` and is a machine
interface rather than the screen you look at.

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
| `tests/link-management-validation.test.ts` | Manual-add payloads (derived title), link patches (≥1 field, no client domain), locked-domain normalisation, passcode payloads |
| `tests/login-input.test.ts` | Login payload validation (single password, no username) |
| `tests/auth.test.ts` | Secret-key verification, constant-time comparison, fail-closed behaviour |
| `tests/signed-token.test.ts` | The shared HMAC token: signing/verification, expiry, tampering, fail-closed |
| `tests/session.test.ts` | The dashboard token: 7-day expiry, and the cookies the login route sets |
| `tests/locked-session.test.ts` | The passcode token: 1-hour expiry, and that neither token can be replayed in the other's context |
| `tests/dashboard-auth.test.ts` | Gate decisions and the password check |
| `tests/locked-auth.test.ts` | The passcode check (blank ⇒ unconfigured) and the locked gate decisions |
| `tests/auth-routes.test.ts` | Login/logout handlers, cookie attributes, status codes, no cookie on failure |
| `tests/link-management-routes.test.ts` | Manual add / edit / delete handlers: session gating, derived domain, `404`/`409`, locked links still editable |
| `tests/locked-routes.test.ts` | Unlock / lock / lock-domain handlers: both cookies required, cookie attributes, idempotency |
| `tests/proxy.test.ts` | Redirect vs. allow vs. `503`, `?next=` handling, matcher exclusions |
| `tests/redirect.test.ts` | `?next=` sanitising (open-redirect protection), including the blocked prefixes |
| `tests/logger.test.ts` | Event shape, domain/IP extraction, serialization safety |
| `tests/link-filters.test.ts` | `?q=` / `?domain=` / `?favorite=` normalisation, URL building, count formatting |
| `tests/links-repository.test.ts` | Insert vs update, upsert idempotency, concurrent saves, ordering, scope (visible vs. locked), domain filter, favorite filter, search (incl. escaped `%`/`_`), domain list, counts |
| `tests/locked-domains-repository.test.ts` | Locking, unlocking, idempotency, and that a locked domain hides its links |
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
3. Under **Settings → Environment Variables**, add all five:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SECRET_KEY`, `DASHBOARD_PASSWORD`,
   and `LOCKED_PASSCODE` if you use `/locked`.
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
  only as strong as `DASHBOARD_PASSWORD`. There is no minimum length, so use a long random
  value anyway, and always serve over HTTPS (Vercel does).
- **The session cookie is stateless and signed**, not encrypted, and contains no password —
  only an expiry and an HMAC of it. Forging one requires the dashboard password, and
  changing `DASHBOARD_PASSWORD` logs every session out immediately.
- **Login attempts are logged** as structured JSON (`dashboard_login_succeeded`,
  `dashboard_login_failed` with a reason and the client IP), so repeated failures are visible
  in the host's logs. Passcode attempts use the same shape (`locked_unlock_succeeded`,
  `locked_unlock_failed`), so the two are distinguishable in the logs.
- **The locked area is a second secret**, not a second account. `LOCKED_PASSCODE` is checked
  the same way as the dashboard password, and its cookie is signed under a separate signature
  context — so even if both secrets are set to the same value, a dashboard session cannot be
  replayed as a passcode, and vice versa.
- **Hidden means hidden by query, not by the interface.** Locked domains are excluded inside
  the repository SQL, so a locked link cannot leak through the list, the search, the domain
  dropdown, or the count — there is no code path that forgets to filter.
- **Link mutations need the dashboard session.** Editing, deleting, and adding links go
  through session-gated endpoints; changing what is hidden needs the session *and* the
  passcode. Ids are UUIDs, so they cannot be guessed from outside.
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
      page.tsx              dashboard: visible links only (password protected, force-dynamic)
    login/
      page.tsx              login page: single password field, no username
      login-form.tsx        client form (POST /api/auth/login)
    locked/
      layout.tsx            dark shell for the hidden area (adds the `dark` class)
      page.tsx              hidden links + locked-domain panel (passcode required)
      unlock/
        page.tsx            passcode prompt (redirects straight through when unlocked)
        unlock-form.tsx     client form (POST /api/locked/unlock)
    api/
      auth/login/route.ts             creates the session cookie
      auth/logout/route.ts            clears the session cookie
      dashboard/links/route.ts        POST: add a link by hand (session auth)
      dashboard/links/[id]/route.ts   PATCH / DELETE: edit, favorite, delete
      health/route.ts                 liveness probe (no auth, no data)
      links/route.ts                  POST + GET + OPTIONS (userscript, secret key)
      locked/unlock/route.ts          POST: exchange the passcode for a 1-hour cookie
      locked/lock/route.ts            POST: clear the passcode cookie
      locked/domains/route.ts         POST: hide a domain
      locked/domains/[domain]/route.ts  DELETE: reveal a domain
    globals.css             Tailwind entry + the class-based `dark` variant
    layout.tsx              root layout
  components/
    AddLinkForm.tsx         manual "add link" form
    EmptyState.tsx          onboarding copy when there are no links
    LinkActions.tsx         star / inline edit / two-step delete
    LinkCard.tsx            thumbnail / title / domain / open button
    LinkFilters.tsx         search + domain + favorites, drives the URL
    LinkGrid.tsx            the card grid and its "no matches" state
    LockedDomainsPanel.tsx  list, add, and unlock hidden domains
    LockedHeader.tsx        locked page heading + "Lock now"
    LogoutButton.tsx        navbar log out control
    Navbar.tsx              top navigation
    NavLinks.tsx            active-aware nav links
    NoMatches.tsx           shown when links exist but none match the filters
    PasscodeNotConfigured.tsx  shown when LOCKED_PASSCODE is unset or blank
    SetupProblem.tsx        shown when the database is unreachable
  db/
    client.ts               lazy libSQL client + drizzle instance, cached per URL
    links.ts                upsertLink + listLinks/listDomains/countLinks/updateLink/deleteLink (the only SQL)
    locked-domains.ts       listLockedDomains + lockDomain/unlockDomain
    schema.ts               links + locked_domains tables
  lib/
    api-auth.ts             session/passcode guards shared by the dashboard endpoints
    api-response.ts         JSON response builders (ok / 4xx / 5xx)
    auth.ts                 x-secret-key verification (userscript API)
    dashboard-api.ts        client-side fetch helper for the dashboard endpoints
    dashboard-auth.ts       dashboard password check + gate decision
    link-filters.ts         ?q= / ?domain= / ?favorite= normalisation + URL building
    locked-auth.ts          passcode check + locked gate decision
    locked-session.ts       the `lc_locked` token (1 hour)
    logger.ts               structured JSON events
    nav.ts                  navbar items (add a module here)
    redirect.ts             ?next= sanitising (open-redirect protection)
    session.ts              the `lc_session` token (7 days)
    signed-token.ts         the HMAC token both cookies are built on
    time.ts                 relative time formatting
    validation.ts           payload + query validation
  proxy.ts                  session gate for the dashboard pages
  types/api.ts              wire format + error codes
drizzle/                    generated SQL migrations (applied by tests too)
tests/                      Vitest suites and helpers
userscript/
  link-collector.user.js    the Tampermonkey script
```
