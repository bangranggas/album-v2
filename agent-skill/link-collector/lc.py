#!/usr/bin/env python3
"""lc.py - a tiny CLI for the Link Collector agent API (standard library only).

Config comes from the environment: LC_BASE_URL (e.g. https://links.example.app) and
LC_AGENT_KEY. The private-space passcode is never stored: it is passed with
--passcode on the single call that needs it.

Output is compact text, not JSON, to keep the agent's token use low.
Exit codes: 0 ok, 1 error (one `ERROR <code>: <message>` line on stderr),
3 a delete is waiting for the owner's confirmation.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SUMMARY_LIMIT = 80
EXIT_OK, EXIT_ERROR, EXIT_CONFIRM = 0, 1, 3


class LocalError(Exception):
    """A problem found before (or instead of) talking to the server."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise LocalError("USAGE", message)


# ---------------------------------------------------------------- formatting

def _one_line(value):
    return " ".join(str(value).split())


def format_row(row):
    """`id | title | domain | albums | summary`, plus ` | *` for a favorite."""
    summary = row.get("summary")
    if summary:
        summary = _one_line(summary)
        if len(summary) > SUMMARY_LIMIT:
            summary = summary[: SUMMARY_LIMIT - 1] + "…"
    else:
        summary = "-"

    albums = ",".join(row.get("albums") or []) or "-"
    line = " | ".join([row["id"], _one_line(row["title"]), row["domain"], albums, summary])

    return line + " | *" if row.get("fav") else line


# ------------------------------------------------------------------- parsing

def _passcode_parent():
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--passcode", help="private-space passcode, for this call only")
    return parent


def build_parser():
    parser = _Parser(prog="lc.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True, parser_class=_Parser)
    pc = _passcode_parent()

    s = sub.add_parser("search", parents=[pc])
    s.add_argument("q", nargs="?", default="")
    s.add_argument("--domain")
    s.add_argument("--album", help="album id (see `albums`)")
    s.add_argument("--no-album", action="store_true", help="only links in no album")
    s.add_argument("--fav", action="store_true")
    s.add_argument("--private", action="store_true")
    s.add_argument("--limit", type=int)
    s.add_argument("--offset", type=int)

    sub.add_parser("show", parents=[pc]).add_argument("id")

    a = sub.add_parser("add", parents=[pc])
    a.add_argument("url")
    a.add_argument("--title")
    a.add_argument("--thumb")
    a.add_argument("--summary")

    e = sub.add_parser("edit", parents=[pc])
    e.add_argument("id")
    e.add_argument("--title")
    e.add_argument("--url")
    e.add_argument("--thumb")
    e.add_argument("--summary", help='use "" to clear')
    fav = e.add_mutually_exclusive_group()
    fav.add_argument("--fav", action="store_true")
    fav.add_argument("--unfav", action="store_true")

    d = sub.add_parser("delete", parents=[pc])
    d.add_argument("id")
    d.add_argument("--confirm", help="token from the preview, sent only after the owner said yes")

    al = sub.add_parser("albums", parents=[pc])
    al.add_argument("--private", action="store_true")

    an = sub.add_parser("album-new", parents=[pc])
    an.add_argument("name")
    an.add_argument("--private", action="store_true")

    f = sub.add_parser("file", parents=[pc])
    f.add_argument("album_id")
    f.add_argument("ids", nargs="+")

    return parser


# ------------------------------------------------------------------- request

def _query(**params):
    return urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "", False)})


def build_request(args):
    """Returns (method, path, body-or-None) for the parsed arguments."""
    c = args.cmd

    if c == "search":
        qs = _query(
            q=args.q,
            domain=args.domain,
            album=args.album,
            noAlbum="1" if args.no_album else None,
            favorite="1" if args.fav else None,
            space="private" if args.private else None,
            limit=args.limit,
            offset=args.offset,
        )
        return "GET", "/api/agent/links" + ("?" + qs if qs else ""), None

    if c == "show":
        return "GET", "/api/agent/links/" + urllib.parse.quote(args.id), None

    if c == "add":
        body = {"url": args.url}
        for key, value in (("title", args.title), ("thumbnail", args.thumb), ("summary", args.summary)):
            if value is not None:
                body[key] = value
        return "POST", "/api/agent/links", body

    if c == "edit":
        body = {}
        for key, value in (
            ("title", args.title),
            ("url", args.url),
            ("thumbnail", args.thumb),
            ("summary", args.summary),
        ):
            if value is not None:
                body[key] = value
        if args.fav:
            body["isFavorite"] = True
        if args.unfav:
            body["isFavorite"] = False
        if not body:
            raise LocalError("USAGE", "edit: give at least one field to change")
        return "PATCH", "/api/agent/links/" + urllib.parse.quote(args.id), body

    if c == "delete":
        return "DELETE", "/api/agent/links/" + urllib.parse.quote(args.id), None

    if c == "albums":
        return "GET", "/api/agent/albums" + ("?space=private" if args.private else ""), None

    if c == "album-new":
        body = {"name": args.name}
        if args.private:
            body["space"] = "private"
        return "POST", "/api/agent/albums", body

    if c == "file":
        return "POST", "/api/agent/albums/" + urllib.parse.quote(args.album_id) + "/links", {"linkIds": args.ids}

    raise LocalError("USAGE", "unknown command")


def default_transport(method, url, headers, body):
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except urllib.error.URLError as error:
        raise LocalError("NETWORK", str(error.reason))


# -------------------------------------------------------------------- output

def render(args, data):
    """Turns a successful response body into the lines to print."""
    c = args.cmd

    if c == "search":
        rows = data["links"]
        if not rows:
            return ["no links"]
        lines = [format_row(row) for row in rows]
        if data.get("hasMore"):
            lines.append("more: --offset %d" % ((args.offset or 0) + len(rows)))
        return lines

    if c == "show":
        link = data
        return [
            "id: " + link["id"],
            "title: " + _one_line(link["title"]),
            "url: " + link["url"],
            "domain: " + link["domain"],
            "space: " + link["space"],
            "albums: " + (",".join(link["albums"]) or "-"),
            "favorite: " + ("yes" if link["fav"] else "no"),
            "thumbnail: " + (link.get("thumbnail") or "-"),
            "summary: " + (_one_line(link["summary"]) if link.get("summary") else "-"),
        ]

    if c == "add":
        return [("added " if data["inserted"] else "updated ") + format_row(data["link"])]

    if c == "edit":
        return ["updated " + format_row(data["link"])]

    if c == "delete":
        return ["deleted"]

    if c == "albums":
        rows = data["albums"]
        return ["%s | %s | %d" % (r["id"], _one_line(r["name"]), r["count"]) for r in rows] or ["no albums"]

    if c == "album-new":
        album = data["album"]
        return ["created %s | %s | %s" % (album["id"], _one_line(album["name"]), album["space"])]

    if c == "file":
        return ["added %d, already %d, skipped %d" % (data["added"], data["alreadyIn"], data["skipped"])]

    return []


def render_confirmation(data):
    return [
        "CONFIRMATION REQUIRED - nothing deleted",
        "title: " + _one_line(data["title"]),
        "url: " + data["url"],
        "space: " + data.get("space", "public"),
        "token: " + data["confirm"],
        "Show the title and URL to the owner. Only after an explicit yes, repeat the same",
        "command with: --confirm <token>   (the token expires in 5 minutes)",
    ]


# ---------------------------------------------------------------------- main

def run(argv, env, transport, out, err):
    """Runs one command. `out`/`err` are line printers; returns the exit code."""
    try:
        args = build_parser().parse_args(argv)

        base = (env.get("LC_BASE_URL") or "").rstrip("/")
        key = env.get("LC_AGENT_KEY") or ""
        if not base or not key:
            raise LocalError("CONFIG", "set LC_BASE_URL and LC_AGENT_KEY in the environment")

        if getattr(args, "private", False) and not args.passcode:
            raise LocalError("PASSCODE_REQUIRED", "ask the owner for the passcode, then pass it with --passcode")

        method, path, body = build_request(args)

        headers = {"x-agent-key": key, "accept": "application/json", "user-agent": "lc-cli/1"}
        if args.passcode:
            headers["x-locked-passcode"] = args.passcode
        if args.cmd == "delete" and args.confirm:
            headers["x-confirm"] = args.confirm
        payload = None
        if body is not None:
            headers["content-type"] = "application/json"
            payload = json.dumps(body).encode("utf-8")

        status, text = transport(method, base + path, headers, payload)

        try:
            parsed = json.loads(text)
        except ValueError:
            raise LocalError("HTTP_%d" % status, "the server did not answer with JSON")

        if status < 400 and parsed.get("ok"):
            for line in render(args, parsed["data"]):
                out(line)
            return EXIT_OK

        error = parsed.get("error") or {}
        if error.get("code") == "CONFIRMATION_REQUIRED" and "data" in parsed:
            for line in render_confirmation(parsed["data"]):
                out(line)
            return EXIT_CONFIRM

        raise LocalError(error.get("code", "HTTP_%d" % status), error.get("message", "request failed"))

    except LocalError as problem:
        err("ERROR %s: %s" % (problem.code, problem.message))
        return EXIT_ERROR


def main():
    # Titles are arbitrary Unicode; a legacy console codepage must not crash the CLI.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    sys.exit(run(sys.argv[1:], os.environ, default_transport, print, lambda line: print(line, file=sys.stderr)))


if __name__ == "__main__":
    main()
