import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import export_supabase_users as exporter


class EnsurePrivateBucketTests(unittest.TestCase):
    def _check_existing_bucket(self, status, is_private):
        response = io.BytesIO(json.dumps({"public": not is_private}).encode("utf-8"))
        with patch.object(
            exporter.urllib.request,
            "urlopen",
            side_effect=[HTTPError("https://example.test/storage/v1/bucket", status, "exists", {}, None), response],
        ) as urlopen:
            if is_private:
                exporter.ensure_private_bucket("https://example.test", "secret")
            else:
                with self.assertRaises(SystemExit):
                    exporter.ensure_private_bucket("https://example.test", "secret")

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(urlopen.call_args_list[1].args[0].method, "GET")

    def test_existing_private_bucket_accepts_legacy_http_400(self):
        self._check_existing_bucket(400, True)

    def test_existing_private_bucket_accepts_http_409(self):
        self._check_existing_bucket(409, True)

    def test_existing_public_bucket_stops_export(self):
        self._check_existing_bucket(400, False)


if __name__ == "__main__":
    unittest.main()
