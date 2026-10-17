# Instant Link Collector

Save any web page to your own cloud database with a single click, from a Tampermonkey
userscript. All metadata extraction (URL, title, `og:image`) happens in the browser, so the
server never scrapes anything and can run entirely on free tiers.

- **Ingestion:** `POST /api/links` — secret-key protected, no scraping, no Puppeteer.
- **Dashboard:** `/` — password-protected grid of link cards (thumbnail, title, open button).
- **Read API:** `GET /api/links` — secret-key protected JSON.
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Drizzle ORM · Turso/libSQL.

Planning and design documents live in [`docs/instant-link-collector/`](docs/instant-link-collector).

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

Start the app:

```bash
npm.cmd run dev
```

Open `http://localhost:4200` and log in with `DASHBOARD_PASSWORD`. The browser's native
password prompt appears; the username is ignored.

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | `file:./local.db` locally, `libsql://<db>-<org>.turso.io` in production. |
| `TURSO_AUTH_TOKEN` | production | Required for Turso, empty for local files. |
| `SECRET_KEY` | yes | 32+ random characters. Used by the API and the userscript. |
| `DASHBOARD_PASSWORD` | yes | 16+ characters. If unset or shorter, the dashboard returns `503`. |

`.env.local` is gitignored. Never commit real values.

---

## 3. Installing the userscript

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

## 4. API reference

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

### CORS

The API answers the `OPTIONS` preflight and sends
`access-control-allow-origin: *` on **every** response, including `401`/`400`/`500`. This is
required because the userscript posts cross-origin from arbitrary sites, and the browser
hides the status code of an error response that lacks CORS headers. It is safe here: the
endpoint reads no cookies or ambient credentials, and every operation needs the secret key.

---

## 5. Testing

Tests are plain Vitest scripts and are meant to be run manually:

```bash
npm.cmd test          # one-off run
npm.cmd test:watch    # watch mode
```

Each run uses an isolated **in-memory** libSQL database with the real generated migration
applied, so no cloud credentials and no cleanup are required.

| Test file | Covers |
| --- | --- |
| `tests/validation.test.ts` | Payload parsing, normalisation, length caps, limit parameter |
| `tests/auth.test.ts` | Secret-key verification, constant-time comparison, fail-closed behaviour |
| `tests/logger.test.ts` | Event shape, domain/IP extraction, serialization safety |
| `tests/links-repository.test.ts` | Insert vs update, upsert idempotency, concurrent saves, ordering |
| `tests/api-links.test.ts` | Full `POST`/`GET`/`OPTIONS` behaviour, status codes, CORS, analytics events |
| `tests/basic-auth.test.ts` | Basic-auth parsing and the dashboard gate decision |
| `tests/time.test.ts` | Relative-time formatting boundaries |
| `tests/userscript.test.ts` | Blacklist rules and metadata extraction, run in a Node `vm` harness |
| `tests/test-db-helper.test.ts` | Migration application and the unique index on `url` |

---

## 6. Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build and server |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:generate` | Generate a new SQL migration from `src/db/schema.ts` |
| `npm run db:push` | Apply the schema to the database in `.env.local` |
| `npm run db:studio` | Drizzle Studio |

---

## 7. Deploying

1. Create a Turso database and copy its URL and auth token.
2. Push the schema:
   `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:push`
3. Import the repository into Vercel and set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
   `SECRET_KEY`, and `DASHBOARD_PASSWORD` as environment variables.
4. Update `CONFIG.API_BASE_URL` in your local userscript copy to the Vercel URL.

The app uses Node.js serverless functions. Next.js 16 deprecates the Edge Runtime, so no
`runtime` export is set, and the PRD's "Edge Runtime **or** Serverless function" requirement
is met by the serverless function.

---

## 8. Security notes

- **The dashboard password is a shared secret**, not user accounts. Anything it protects is
  only as strong as `DASHBOARD_PASSWORD`. Use 16+ random characters and always serve over
  HTTPS (Vercel does).
- **Rotating `SECRET_KEY`** immediately invalidates the userscript; update `CONFIG.SECRET_KEY`
  after rotating.
- **No scraping.** The dependency tree contains no browser automation or HTML parsing
  library; the browser supplies all metadata.
- Server-side error details are logged in structured JSON (Vercel captures them) and never
  returned to clients.

---

## 9. Project layout

```
src/
  app/
    api/health/route.ts     liveness probe (no auth, no data)
    api/links/route.ts      POST + GET + OPTIONS
    globals.css             Tailwind entry
    layout.tsx              root layout
    page.tsx                dashboard (password protected, force-dynamic)
  components/
    EmptyState.tsx          onboarding copy when there are no links
    LinkCard.tsx            thumbnail / title / host / open button
    SetupProblem.tsx        shown when the database is unreachable
  db/
    client.ts               lazy libSQL client + drizzle instance, cached per URL
    links.ts                upsertLink + listLinks (the only SQL in the app)
    schema.ts               links table
  lib/
    auth.ts                 x-secret-key verification
    basic-auth.ts           dashboard password gate decision
    logger.ts               structured JSON events
    time.ts                 relative time formatting
    validation.ts           payload + query validation
  proxy.ts                  HTTP Basic Auth gate for the dashboard
  types/api.ts              wire format + error codes
drizzle/                    generated SQL migrations (applied by tests too)
tests/                      Vitest suites and helpers
userscript/
  link-collector.user.js    the Tampermonkey script
```
