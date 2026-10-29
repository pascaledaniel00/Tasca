import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import export_supabase_users as exporter


def response(payload):
    return io.BytesIO(json.dumps(payload).encode("utf-8"))


def http_error(status):
    return HTTPError("https://example.test/storage/v1/bucket", status, "error", {}, None)


class EnsurePrivateBucketTests(unittest.TestCase):
    def test_existing_private_bucket_is_reused_without_create_request(self):
        with patch.object(exporter.urllib.request, "urlopen", return_value=response({"public": False})) as urlopen:
            exporter.ensure_private_bucket("https://example.test", "secret")

        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(urlopen.call_args.args[0].method, "GET")

    def test_existing_public_bucket_stops_export_before_create(self):
        with patch.object(exporter.urllib.request, "urlopen", return_value=response({"public": True})) as urlopen:
            with self.assertRaises(SystemExit):
                exporter.ensure_private_bucket("https://example.test", "secret")

        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(urlopen.call_args.args[0].method, "GET")

    def test_missing_bucket_is_created_as_private(self):
        with patch.object(
            exporter.urllib.request,
            "urlopen",
            side_effect=[http_error(404), response({"name": "admin-exports", "public": False})],
        ) as urlopen:
            exporter.ensure_private_bucket("https://example.test", "secret")

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(urlopen.call_args_list[0].args[0].method, "GET")
        self.assertEqual(urlopen.call_args_list[1].args[0].method, "POST")
        self.assertIn(b'"public": false', urlopen.call_args_list[1].args[0].data)

    def test_bucket_created_by_concurrent_run_is_verified(self):
        for status in (400, 409):
            with self.subTest(status=status):
                with patch.object(
                    exporter.urllib.request,
                    "urlopen",
                    side_effect=[http_error(404), http_error(status), response({"public": False})],
                ) as urlopen:
                    exporter.ensure_private_bucket("https://example.test", "secret")

                self.assertEqual(urlopen.call_count, 3)
                self.assertEqual(urlopen.call_args_list[2].args[0].method, "GET")


if __name__ == "__main__":
    unittest.main()
