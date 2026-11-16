# Agent Bridge — requirements and design

## Intent

The owner runs an AI agent on Hermes Agent and wants it to manage the saved links through
conversation: search, add, edit, file into albums, summarise, and (with confirmation) delete.
It must be **cheap** on three fronts: tokens in the agent's context, Vercel invocations, and
Turso reads. The private space must stay private until the owner hands the agent the passcode
in chat, and the agent must not remember it.

## Goals

1. Agent lists/searches links in the **public** space by default; the **private** space only
   when the owner supplies `LOCKED_PASSCODE` for that request.
2. Agent adds links and edits every field (title, url, thumbnail, summary, favorite).
3. Agent deletes a link only after a server-enforced confirmation step.
4. Agent creates albums and files links into them, including finding links that are in no album.
5. New optional `summary` field on a link, writable by the agent and the dashboard.
6. Agent queries links by free text, domain, album, "no album", favorite.

## Non-goals

- No MCP server (can wrap the same API later).
- No change to `GET /api/links`, `POST /api/links`, `userscript/`, `public/sw.js`,
  `manifest.ts`, or `/share-target`. The installed PWA and the userscript must keep working.
- Closing the private-link leak in `GET /api/links` (it uses `scope: "all"` behind
  `SECRET_KEY` only) is a **separate follow-up task**.
- No album delete/rename and no bulk link delete for the agent.
- The agent never receives thumbnails in list results.

## Anti-goals (failure even if it "works")

- Agent can read or touch private data without the passcode in that same request.
- A delete happens without a prior confirmation round-trip.
- Passcode/agent key stored in the agent's memory, skill files, or server-side session.
- Any existing client (PWA, userscript, dashboard) breaks, or `summary` becomes required.

## Constraints

- Vercel serverless + Turso: stateless, no new infra, no new tables.
- Next.js 16 here has breaking changes: read `node_modules/next/dist/docs/` before coding.
- Project workflow: TDD, tests in `tests/`, docs in `docs/<slug>/`.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Skill (`SKILL.md`) + tiny CLI script + new `/api/agent/*` routes | Lowest tokens (skill loaded on demand, compact output); one route per action; needs the script on the Hermes host |
| B | MCP server | Tool schemas sit in context every turn; extra route/protocol to maintain; portable |
| C | Skill with raw `curl` only | Fastest to write; agent builds JSON each time, more tokens, more errors |

Private-space handling: owner chose "passcode given in chat each time, never stored".
Delete: owner chose confirmation (no password). Existing-endpoint behaviour: owner chose
**option A**, i.e. leave current behaviour untouched, make the new agent path safe from day one.

## Design

### Auth (new, separate from `SECRET_KEY`)
- `x-agent-key` header, compared in constant time with env `AGENT_API_KEY`. Missing env → `503`.
- Private space: `x-locked-passcode` header checked against `LOCKED_PASSCODE` **on every
  request**. No cookie, no token, no session. Failures are logged.
- Any id-based operation on a private resource without a valid passcode answers `404`
  (indistinguishable from "not found"), so existence is not leaked.
- Responses carry no CORS headers (server-to-server only).

### Endpoints (`/api/agent/*`)
| Endpoint | Purpose |
|---|---|
| `GET /links?q=&domain=&album=&noAlbum=1&favorite=1&space=public\|private&limit=&offset=` | Compact search. Default limit 20, max 50. Row: `id, title, domain, summary, albums, fav`. `q` matches title, url, summary. |
| `GET /links/:id` | One link in full (url, thumbnail, summary, albums). |
| `POST /links` `{url, title?, thumbnail?, summary?}` | Add or update-by-url. If the URL's domain is locked and no passcode is sent → `403 PASSCODE_REQUIRED` (my call: leaks "this domain is locked" only to the key holder). |
| `PATCH /links/:id` | Any of `title, url, thumbnail, summary, isFavorite`. |
| `DELETE /links/:id` | Without `?confirm=`: deletes nothing, returns `409 CONFIRMATION_REQUIRED` with title, url and a `confirm` token. With a valid token: deletes. |
| `GET /albums?space=` | `id, name, count`. |
| `POST /albums` `{name, space}` | Create on that side (`private` needs passcode). |
| `POST /albums/:id/links` `{linkIds}` | File several links (reuses the existing bulk repository function and its side rules). |

Confirm token: stateless HMAC (key `AGENT_API_KEY`) over `{linkId, expiry}`, valid ~5 minutes,
bound to that one link. No storage.

### `summary`
- New nullable `links.summary` text column, max 500 characters, one additive migration.
- Optional everywhere: `POST /api/links`, the userscript and the share target are unchanged.
  `PATCH /api/dashboard/links/:id` and the manual add/edit forms accept it optionally.
- Dashboard card/list shows it as a muted line when present. `/api/links` output is left as is.
- Search over title/url/summary extends the existing escaped LIKE query.

### Agent-side kit (`agent-skill/link-collector/`)
- `SKILL.md`: short. Rules for the agent: public by default; **ask the owner for the passcode
  every time private is needed and never save it**; show the delete preview and wait for an
  explicit "yes" before sending the confirm token; to organise, search `noAlbum=1`, propose
  albums, create, then file.
- `lc.py`: Python standard library only (Hermes is Python-based; my call). Config via env
  `LC_BASE_URL` and `LC_AGENT_KEY`; passcode only as a per-call `--passcode` flag. Output is
  compact text lines, not JSON.

### Cost notes
Search returns ≤20 narrow rows with no thumbnails; one query per call; the existing indexed
`domain` column and the membership subquery are reused; `GET /links/:id` is the only
full-detail call.

## Resolutions after builder review (my calls, marked for the owner to check)

Code work implied by the design (not yet present): `summary` in schema, `LinkInput`,
`LinkPatch`, `updateLink`, `upsertLink`; summary clause in `listLinks` LIKE search; `offset`
and a lean column projection (no thumbnail) for agent search; a header-based passcode check
(the cookie helpers in `api-auth.ts` are not reusable); new error codes `PASSCODE_REQUIRED`,
`CONFIRMATION_REQUIRED`; a "is this domain locked" lookup; a lean album list (no covers).

- **Re-adding a URL via the agent preserves omitted fields.** Only fields the agent sends
  are overwritten (the existing `upsertLink` used by `/api/links` is left untouched).
- **Search rows:** `albums` holds album **names**; `album=` filters by **album id**
  (taken from `GET /albums`).
- **Scope check everywhere:** every id-based agent route resolves the link/album side
  itself (`getLinkById` ignores scope). Private without a valid passcode → `404`, including
  `album=<private id>` filters, album filing, and PATCH/DELETE. The side check runs
  **before** any `url-taken` conflict check, so a conflict cannot reveal a private link.
- **PATCH `url` may not cross the lock boundary** (to or from a locked domain): `409`.
- **Bulk filing** returns `added`, `alreadyIn`, `skipped` counts only (same as the dashboard).
- **Confirm token:** sent in the request body/header (`x-confirm`), never in the URL.
  Binds `{linkId, updatedAt, expiry}` so an edited link invalidates it; signed with a key
  derived from `AGENT_API_KEY` (not the raw key). The confirm call must **re-send the
  passcode** for private links.
- **Passcode handling:** compared in constant time; never logged. Failed attempts add a
  fixed ~1 s delay as a cheap brake. `--passcode` as a CLI flag is accepted (single-user
  host). Limit to know about: the passcode sits in the chat transcript and the model
  provider's logs, so "not remembered" is enforced by the skill's instructions, not by the
  server.

## Left to the builder
Exact output line format of `lc.py`; names of new env vars in `.env.example`; whether to add
an index on `summary` (probably not); where shared helpers live in `src/lib/`.

## Open risk (flagged, not solved here)
The passcode has no rate limit on `/api/agent/*` beyond logging; a leaked agent key plus
guessing is the exposure. Consider a follow-up if the passcode is short.
