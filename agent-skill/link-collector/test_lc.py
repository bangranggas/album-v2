"""Unit tests for lc.py. Run: python -m unittest discover -s agent-skill/link-collector -p "test_lc.py"."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lc  # noqa: E402

ENV = {"LC_BASE_URL": "https://links.example.app", "LC_AGENT_KEY": "k-123"}


class FakeTransport:
    """Records the request and answers with a canned (status, body)."""

    def __init__(self, status=200, payload=None):
        self.status = status
        self.payload = payload if payload is not None else {"ok": True, "data": {}}
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "headers": headers, "body": body})
        return self.status, json.dumps(self.payload)


def run(argv, payload=None, status=200, env=ENV):
    transport = FakeTransport(status, payload)
    out, err = [], []
    code = lc.run(argv, env, transport, out.append, err.append)
    return code, "\n".join(out), "\n".join(err), transport


class FormatRowTests(unittest.TestCase):
    def test_joins_albums_and_truncates_summary_at_80_with_ellipsis(self):
        row = {
            "id": "i1",
            "title": "T",
            "domain": "d.test",
            "albums": ["A", "B"],
            "summary": "x" * 100,
            "fav": False,
        }

        line = lc.format_row(row)

        self.assertEqual(line, "i1 | T | d.test | A,B | " + "x" * 79 + "…")

    def test_empty_albums_and_missing_summary_render_as_dashes_and_collapse_newlines(self):
        row = {"id": "i1", "title": "Two\nlines", "domain": "d", "albums": [], "summary": None, "fav": True}

        self.assertEqual(lc.format_row(row), "i1 | Two lines | d | - | - | *")


class BuildRequestTests(unittest.TestCase):
    def test_search_private_with_passcode_sends_headers_and_query(self):
        code, _, _, transport = run(
            ["search", "hotel", "--private", "--passcode", "pw", "--no-album", "--limit", "5"],
            {"ok": True, "data": {"links": [], "hasMore": False}},
        )

        call = transport.calls[0]
        self.assertEqual(code, 0)
        self.assertEqual(call["method"], "GET")
        self.assertTrue(call["url"].startswith("https://links.example.app/api/agent/links?"))
        for part in ("q=hotel", "space=private", "noAlbum=1", "limit=5"):
            self.assertIn(part, call["url"])
        self.assertEqual(call["headers"]["x-agent-key"], "k-123")
        self.assertEqual(call["headers"]["x-locked-passcode"], "pw")

    def test_private_without_passcode_fails_locally_without_calling_the_server(self):
        code, _, err, transport = run(["search", "--private"])

        self.assertEqual(code, 1)
        self.assertEqual(transport.calls, [])
        self.assertIn("ERROR PASSCODE_REQUIRED", err)

    def test_public_requests_send_no_passcode_header(self):
        _, _, _, transport = run(["search", "x"], {"ok": True, "data": {"links": [], "hasMore": False}})

        self.assertNotIn("x-locked-passcode", transport.calls[0]["headers"])

    def test_add_without_summary_sends_no_summary_key(self):
        _, _, _, transport = run(
            ["add", "https://a.test/1", "--title", "T"],
            {"ok": True, "data": {"inserted": True, "link": {"id": "i", "title": "T", "domain": "a.test", "albums": [], "summary": None, "fav": False}}},
        )

        call = transport.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(json.loads(call["body"]), {"url": "https://a.test/1", "title": "T"})

    def test_edit_only_sends_the_fields_given_and_can_clear_a_summary(self):
        _, _, _, transport = run(
            ["edit", "id-1", "--summary", "", "--fav"],
            {"ok": True, "data": {"link": {"id": "id-1", "title": "T", "domain": "d", "albums": [], "summary": None, "fav": True}}},
        )

        call = transport.calls[0]
        self.assertEqual(call["method"], "PATCH")
        self.assertTrue(call["url"].endswith("/api/agent/links/id-1"))
        self.assertEqual(json.loads(call["body"]), {"summary": "", "isFavorite": True})

    def test_edit_with_nothing_to_change_is_a_local_error(self):
        code, _, err, transport = run(["edit", "id-1"])

        self.assertEqual(code, 1)
        self.assertEqual(transport.calls, [])
        self.assertIn("ERROR", err)

    def test_delete_with_confirm_sends_the_header(self):
        _, out, _, transport = run(["delete", "id-1", "--confirm", "TOKEN"], {"ok": True, "data": {"deleted": True}})

        call = transport.calls[0]
        self.assertEqual(call["method"], "DELETE")
        self.assertEqual(call["headers"]["x-confirm"], "TOKEN")
        self.assertIn("deleted", out.lower())

    def test_file_sends_all_ids(self):
        _, out, _, transport = run(["file", "alb-1", "a", "b"], {"ok": True, "data": {"added": 2, "alreadyIn": 0, "skipped": 0}})

        call = transport.calls[0]
        self.assertTrue(call["url"].endswith("/api/agent/albums/alb-1/links"))
        self.assertEqual(json.loads(call["body"]), {"linkIds": ["a", "b"]})
        self.assertIn("added 2", out)

    def test_album_new_private_needs_the_passcode_and_sends_space(self):
        _, _, _, transport = run(
            ["album-new", "Vault", "--private", "--passcode", "pw"],
            {"ok": True, "data": {"album": {"id": "x", "name": "Vault", "space": "private"}}},
        )

        self.assertEqual(json.loads(transport.calls[0]["body"]), {"name": "Vault", "space": "private"})


class OutputTests(unittest.TestCase):
    def test_search_prints_one_line_per_link_and_a_more_hint(self):
        payload = {
            "ok": True,
            "data": {
                "links": [
                    {"id": "1", "title": "A", "domain": "a.test", "albums": [], "summary": None, "fav": False},
                    {"id": "2", "title": "B", "domain": "b.test", "albums": ["X"], "summary": "s", "fav": False},
                ],
                "hasMore": True,
            },
        }

        code, out, _, _ = run(["search", "--limit", "2"], payload)

        lines = out.splitlines()
        self.assertEqual(code, 0)
        self.assertEqual(lines[0], "1 | A | a.test | - | -")
        self.assertEqual(lines[1], "2 | B | b.test | X | s")
        self.assertIn("--offset 2", lines[2])

    def test_empty_search_says_so(self):
        _, out, _, _ = run(["search", "zzz"], {"ok": True, "data": {"links": [], "hasMore": False}})

        self.assertEqual(out, "no links")

    def test_delete_preview_shows_title_url_token_and_exits_3(self):
        payload = {
            "ok": False,
            "error": {"code": "CONFIRMATION_REQUIRED", "message": "Nothing was deleted."},
            "data": {"title": "Doomed", "url": "https://a.test/1", "space": "public", "confirm": "TOK.EN"},
        }

        code, out, _, _ = run(["delete", "id-1"], payload, status=409)

        self.assertEqual(code, 3)
        for part in ("Doomed", "https://a.test/1", "TOK.EN", "nothing deleted"):
            self.assertIn(part, out)

    def test_server_errors_print_one_error_line_and_never_echo_the_passcode(self):
        payload = {"ok": False, "error": {"code": "PASSCODE_REQUIRED", "message": "The passcode is wrong."}}

        code, out, err, _ = run(["search", "--private", "--passcode", "super-secret"], payload, status=403)

        self.assertEqual(code, 1)
        self.assertEqual(err, "ERROR PASSCODE_REQUIRED: The passcode is wrong.")
        self.assertNotIn("super-secret", out + err)

    def test_missing_configuration_is_reported_before_any_request(self):
        code, _, err, transport = run(["search"], env={})

        self.assertEqual(code, 1)
        self.assertEqual(transport.calls, [])
        self.assertIn("LC_BASE_URL", err)


if __name__ == "__main__":
    unittest.main()
