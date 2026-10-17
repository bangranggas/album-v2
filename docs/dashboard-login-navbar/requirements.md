# Requirements — Dashboard Login Page, Navbar, and Turso Setup Guide

**Slug:** `dashboard-login-navbar`
**Status:** Awaiting approval (Phase 2)
**Depends on:** `docs/instant-link-collector/requirements.md` (Module 1)

---

## 1. Goal

Replace the browser's native HTTP Basic Auth popup with a **dedicated login page**
that has a **single password field (no username)**, add a **navbar** that can host
future modules, and document **how to set up Turso** in the README.

---

## 2. Scope (in)

### 2.1 Dedicated login page, password-only
- A real page at `/login` rendered by the app, not a browser prompt.
- Exactly **one input**: password. **No username field** anywhere.
- Wrong password → inline error message on the same page; the password field is
  cleared, and the user can retry immediately.
- Correct password → redirect to the originally requested page (`?next=...`),
  defaulting to `/`.
- Visiting `/login` while already authenticated redirects to `/` (no double login).
- Logout clears the session and returns to `/login`.
- The old `www-authenticate` Basic challenge is removed; the browser must never
  show its own popup.

### 2.2 Session mechanics
- Session is stored in a **signed, `httpOnly` cookie** — no password is ever stored
  in the cookie, only an expiry timestamp plus an HMAC signature.
- **Lifetime: 7 days** (decided with the owner).
- Cookie attributes: `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production,
  `Max-Age` = 7 days.
- The signing key is **derived from `DASHBOARD_PASSWORD`**, so changing the password
  immediately invalidates all existing sessions. No new environment variable.
- Fails closed: missing/invalid/expired/tampered cookie → treated as logged out.

### 2.3 Navbar
- Persistent top navigation on all authenticated pages.
- Contains: the brand ("Link Collector"), the current module link(s), and a logout
  control.
- Built from a **single declarative list of items** so a future module only needs one
  new entry (this is the point of the navbar).
- Highlights the active section.
- Not shown on the login page.

### 2.4 Turso setup guide (README only)
A new README section explaining, step by step:
1. Creating a Turso database (via the Turso web dashboard / CLI).
2. Obtaining the database URL and auth token.
3. Wiring them into `.env.local` for local development.
4. Applying the schema.
5. Setting the same values as environment variables when deploying to Vercel.

Decision: **no in-app documentation page** — the guidance lives in `README.md`.

---

## 3. Out of scope

- User accounts, roles, or a user database (this stays a single shared password).
- "Remember me" toggle, password reset, rate limiting, or 2FA.
- Any new module behind the navbar (navbar only prepares for them).
- Replacing `SECRET_KEY`-based API auth used by the userscript — unchanged.
- Public pages: everything except `/login` and `/api/*` stays behind the session.

---

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Stateless signed cookie, not a server-side session table | Keeps the "zero infrastructure cost" property from Module 1; no DB round-trip on every page view. |
| D2 | Signing key derived from `DASHBOARD_PASSWORD` | No extra env var; rotating the password logs everyone out for free. |
| D3 | Session lifetime 7 days | Confirmed by the owner. |
| D4 | Login/logout implemented as route handlers under `/api/auth/*` | `/api` is already excluded from the gate, and the logic stays unit-testable as plain functions. |
| D5 | Route group `(app)` holds the navbar layout | Keeps `/login` free of the navbar without runtime path checks. |
| D6 | Turso guide lives in the README only | Confirmed by the owner. |
| D7 | `MIN_PASSWORD_LENGTH` stays 16; unconfigured password still fails closed | Preserves Module 1's fail-closed posture. |

---

## 5. Data flow

```
Browser  ──GET /────────────▶ proxy.ts
                              ├─ no/invalid session cookie ──▶ 302 /login?next=/
                              ├─ DASHBOARD_PASSWORD unset ───▶ 503 + instructions
                              └─ valid session ─────────────▶ (app) layout ─▶ dashboard

Browser  ──POST /api/auth/login {password}──▶ route handler
                              ├─ password wrong ──▶ 401 { ok:false }  (logged)
                              └─ password ok   ──▶ 200 + Set-Cookie: lc_session=<exp>.<hmac>

Browser  ──POST /api/auth/logout────────────▶ 200 + Set-Cookie: lc_session=; Max-Age=0
```

Route protection matrix:

| Path | Protected? |
| --- | --- |
| `/` | yes — session cookie |
| `/login` | no (own page; redirects away when already logged in) |
| `/api/auth/login`, `/api/auth/logout` | no (they create/destroy the session) |
| `/api/links`, `/api/health` | no — `x-secret-key` (userscript), unchanged |
| `/_next/*`, `favicon.ico`, `robots.txt`, `sitemap.xml` | no |

---

## 6. Acceptance criteria

1. `npm run dev` → visiting `/` redirects to `/login`; the browser shows **no** native
   popup at any point.
2. `/login` renders exactly one input (`type=password`) and one submit button; no
   username field exists in the markup.
3. Wrong password → stays on `/login`, shows an error, does not set a cookie.
4. Correct password → lands on the requested page; a `lc_session` cookie exists and is
   `HttpOnly`.
5. Reloading `/` while logged in does not redirect to `/login`.
6. Logout returns to `/login` and the subsequent `/` visit is gated again.
7. Editing the cookie's expiry or signature by hand → gated again (fail closed).
8. A session older than 7 days → gated again.
9. Changing `DASHBOARD_PASSWORD` in `.env.local` and restarting → all sessions invalid.
10. Every authenticated page shows the navbar with the brand, the module link, and
    logout.
11. The navbar's module list is a single data structure; adding one entry adds one
    nav link without touching layout code.
12. README contains a Turso setup walkthrough (create DB → get URL/token → `.env.local`
    → push schema → Vercel env vars).
13. `DASHBOARD_PASSWORD` missing or shorter than 16 chars → gated routes return `503`
    with clear instructions instead of allowing access.
14. All existing Module 1 behaviour still passes (userscript save, API, CORS, upsert,
    analytics events); the full test suite is green and `lint` is clean.

---

## 7. Edge cases to handle

- `?next=` pointing off-site or protocol-relative (`//evil.example`) → ignored, fall
  back to `/` (no open redirect).
- `?next=` pointing back at `/login` → ignored, fall back to `/`.
- Password with leading/trailing whitespace → the submitted value is used as typed
  (no trimming) so a password may legitimately contain spaces.
- Empty password submitted → validated client-side and server-side; no cookie.
- Non-JSON or missing body on login → `400`, no cookie.
- Already-authenticated visit to `/login` → redirect to `/`.
- Cookie present but `DASHBOARD_PASSWORD` now unset → `503`, fail closed.
- Session cookie for a different deployment (signed with another password) → invalid.
