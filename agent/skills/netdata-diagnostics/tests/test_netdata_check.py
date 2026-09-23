#!/usr/bin/env python3

import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "netdata_check.py"
SPEC = importlib.util.spec_from_file_location("netdata_check", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class NetdataCheckTests(unittest.TestCase):
    def test_normalize_default(self):
        self.assertEqual(MODULE.normalize_target(None), "http://127.0.0.1:19999")

    def test_normalize_tailscale_hostname(self):
        self.assertEqual(
            MODULE.normalize_target("debian13-rs1000-vie"),
            "http://debian13-rs1000-vie:19999",
        )

    def test_normalize_full_url_and_path(self):
        self.assertEqual(
            MODULE.normalize_target("https://netdata.example.com/agent/"),
            "https://netdata.example.com/agent",
        )

    def test_preserve_explicit_port(self):
        self.assertEqual(
            MODULE.normalize_target("https://netdata.example.com:443"),
            "https://netdata.example.com:443",
        )

    def test_normalize_bare_ipv6(self):
        self.assertEqual(
            MODULE.normalize_target("2001:db8::1"),
            "http://[2001:db8::1]:19999",
        )

    def test_reject_url_credentials(self):
        with self.assertRaises(ValueError):
            MODULE.normalize_target("https://user:secret@example.com")

    def test_reject_unsafe_url_parts(self):
        for target in ("ftp://example.com", "https://example.com?token=secret", "https://example.com/#fragment"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                MODULE.normalize_target(target)

    def test_parse_duration(self):
        self.assertEqual(MODULE.parse_duration("15m"), 900)
        self.assertEqual(MODULE.parse_duration("24h"), 86400)
        self.assertEqual(MODULE.parse_duration("7d"), 604800)

    def test_percentile_and_summary(self):
        summary = MODULE.summarize([1, 2, 3, 4, 5])
        self.assertEqual(summary["current"], 1)
        self.assertEqual(summary["average"], 3)
        self.assertEqual(summary["p95"], 4.8)
        self.assertEqual(summary["max"], 5)
        self.assertEqual(summary["min"], 1)

    def test_series_combines_dimensions(self):
        data = {"labels": ["time", "a", "b"], "data": [[1, 2, 3], [0, 4, 5]]}
        self.assertEqual(MODULE.sum_dimensions(data), [5, 9])


if __name__ == "__main__":
    unittest.main()
