---
name: link-collector
description: Search, add, edit, summarise, file into albums and (with confirmation) delete the owner's saved links in their Link Collector web app. Use when the owner asks about their saved links, wants to save one, or wants links organised.
---

# Link Collector

Run `python lc.py <command>` from this folder. Needs env `LC_BASE_URL` and `LC_AGENT_KEY`.
Output is one compact line per item; errors are one `ERROR <code>: <message>` line.

| Command | Does |
| --- | --- |
| `search [text] [--domain D] [--album ID] [--no-album] [--fav] [--limit N] [--offset N]` | Rows: `id \| title \| domain \| albums \| summary` (`\| *` = favorite). Matches title, URL, summary. Default 20 rows; `more: --offset N` means there are more. |
| `show ID` | Full detail of one link (URL, thumbnail, summary). |
| `add URL [--title T] [--thumb U] [--summary S]` | Saves a link, or updates it if the URL exists. Only the fields you pass change. |
| `edit ID [--title] [--url] [--thumb] [--summary] [--fav\|--unfav]` | Edits a link. `--summary ""` clears the summary. |
| `delete ID` | **Deletes nothing.** Prints a preview and a token (see below). |
| `delete ID --confirm TOKEN` | Performs the deletion. |
| `albums` / `album-new NAME` | List albums with counts / create one. |
| `file ALBUM_ID ID [ID...]` | Put many links into one album. |

## Rules

1. **Public by default.** Never use the private space on your own initiative.
2. **Private space = `--private` plus `--passcode`.** To read or change anything private, ask
   the owner for the passcode in that same turn, pass it with `--passcode` for that one
   command, and ask again next time. Never store it, repeat it back, write it into notes or
   memory, or reuse one you saw earlier. If a command says `PASSCODE_REQUIRED`, stop and ask.
   Commands on a private link or album (`show`, `edit`, `delete`, `file`, `add` to a private
   domain) also need `--passcode`.
3. **Deleting is two steps and needs a clear yes.** Run `delete ID`, show the owner the
   title and URL, wait for an explicit yes, then run `delete ID --confirm TOKEN`. A token
   expires in 5 minutes and stops working if the link is edited. Never confirm on your own.
4. **Summaries**: write one only from what you actually know about the page (the title, a
   page you read, or what the owner told you). Keep it to a sentence or two (max 500 chars).
5. **Organising links**: `search --no-album --limit 50`, group by topic, propose album names
   to the owner, create with `album-new`, then `file` in batches (up to 200 ids). Check
   `albums` first so you do not create a duplicate.
