"""Unit tests for the YouTube Music bridge helpers (no network).

    python3 -m unittest discover -s tests/ytmusic
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src", "main", "ytmusic"))
import bridge  # noqa: E402

FIREFOX = """POST /youtubei/v1/browse?prettyPrint=false HTTP/2
Host: music.youtube.com
Accept: */*
Cookie: SAPISID=abc/def; HSID=x=y; __Secure-3PAPISID=zz
X-Goog-AuthUser: 0
Authorization: SAPISIDHASH 123_abc"""

CHROME_LINES = """:authority:
music.youtube.com
:method:
POST
:path:
/youtubei/v1/browse?prettyPrint=false
cookie:
SAPISID=abc; HSID=1
x-goog-authuser:
0
user-agent:
Mozilla/5.0 (Mac) Chrome/140"""


class HeadersTest(unittest.TestCase):
    def test_firefox_raw(self):
        h = bridge.parse_headers(FIREFOX)
        self.assertEqual(h["cookie"], "SAPISID=abc/def; HSID=x=y; __Secure-3PAPISID=zz")
        self.assertEqual(h["x-goog-authuser"], "0")
        self.assertNotIn("post", h)

    def test_chrome_one_per_line(self):
        h = bridge.parse_headers(CHROME_LINES)
        self.assertEqual(h["cookie"], "SAPISID=abc; HSID=1")
        self.assertEqual(h["x-goog-authuser"], "0")
        self.assertEqual(h["user-agent"], "Mozilla/5.0 (Mac) Chrome/140")
        self.assertEqual(set(h), {"cookie", "x-goog-authuser", "user-agent"})

    def test_chrome_crlf_copy(self):
        h = bridge.parse_headers("cookie: A=1; B=2\r\nx-goog-authuser: 1\r\n")
        self.assertEqual(h, {"cookie": "A=1; B=2", "x-goog-authuser": "1"})


class CookieJarTest(unittest.TestCase):
    def test_netscape_format(self):
        txt = bridge.cookie_jar_text("SAPISID=abc/def; HSID=x=y; broken; =nope")
        rows = [l.split("\t") for l in txt.splitlines() if l and not l.startswith("#")]
        self.assertEqual([(r[5], r[6]) for r in rows], [("SAPISID", "abc/def"), ("HSID", "x=y")])
        self.assertTrue(all(len(r) == 7 and r[0] == ".youtube.com" for r in rows))
        self.assertTrue(txt.startswith("# Netscape HTTP Cookie File"))


class TrackTest(unittest.TestCase):
    def test_normalise(self):
        t = bridge.norm_track({
            "videoId": "v1", "title": "T", "artists": [{"name": "A"}, {"name": "B"}], "album": {"name": "Al"},
            "duration": "1:03:05", "thumbnails": [{"url": "https://lh3.googleusercontent.com/x=w60-h60-l90-rj", "width": 60, "height": 60}],
        })
        self.assertEqual(t["artists"], "A, B")
        self.assertEqual(t["album"], "Al")
        self.assertEqual(t["duration"], 3785)
        self.assertTrue(t["thumbnail"].endswith("=w544-h544-l90-rj"))
        self.assertTrue(t["available"])

    def test_without_video_id(self):
        self.assertIsNone(bridge.norm_track({"title": "episode"}))

    def test_unavailable(self):
        self.assertFalse(bridge.norm_track({"videoId": "x", "isAvailable": False})["available"])


class FriendlyErrorsTest(unittest.TestCase):
    def test_messages(self):
        self.assertIn("reconnectez", bridge.friendly(Exception("ERROR: [youtube] x: Sign in to confirm you're not a bot")))
        self.assertIn("indisponible", bridge.friendly(Exception("ERROR: Video unavailable")))
        self.assertIn("Mettez yt-dlp à jour", bridge.friendly(Exception("HTTP Error 403: Forbidden")))


if __name__ == "__main__":
    unittest.main()
