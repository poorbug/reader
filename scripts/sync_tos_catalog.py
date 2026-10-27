#!/usr/bin/env python3
"""Build the public Paper Reader catalog from the TOS books/ prefix.

No API keys are ever written into the JSON output. If anonymous listing is
disabled, configure the GitHub Actions TOS_ACCESS_KEY/TOS_SECRET_KEY secrets
with a minimal read-only tos:ListBucket policy scoped to books/.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BUCKET = "reader-ebook"
REGION = "cn-beijing"
HOST = f"{BUCKET}.tos-{REGION}.volces.com"
BASE = f"https://{HOST}"
PREFIX = "books/"
OUTPUT = Path("catalog/books.json")
FORMATS = {".epub": "epub", ".mobi": "mobi", ".pdf": "pdf"}
MAX_PAGES = 1000
LAST_GOOD_URL = "https://poorbug.github.io/reader/catalog/books.json"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def anonymous_objects():
    """List the public TOS bucket using the native JSON ListObjectsV2 API."""
    token = None
    seen_tokens = set()
    for page in range(MAX_PAGES):
        query = {"list-type": "2", "prefix": PREFIX, "max-keys": "1000", "encoding-type": "url"}
        if token:
            query["continuation-token"] = token
        uri = BASE + "/?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(uri, headers={"User-Agent": "PaperReaderCatalog/1.1"})
        with urllib.request.urlopen(request, timeout=35) as response:
            # TOS returns JSON, unlike the XML result used by AWS S3.
            # A successful 200 response must still be validated before publishing.
            result = json.load(response)
        if not isinstance(result, dict) or not isinstance(result.get("Contents", []), list) or "IsTruncated" not in result:
            raise ValueError("Unexpected TOS ListObjectsV2 response structure")
        encoded = result.get("EncodingType") == "url"
        for entry in result.get("Contents") or []:
            if not isinstance(entry, dict):
                raise ValueError("Invalid TOS object entry")
            key = entry.get("Key", "")
            if encoded:
                # TOS specifies application/x-www-form-urlencoded for encoding-type=url.
                key = urllib.parse.unquote_plus(key)
            yield {
                "key": key,
                "size": int(entry.get("Size", 0)),
                "updatedAt": entry.get("LastModified", ""),
            }
        truncated = result["IsTruncated"]
        if not isinstance(truncated, bool):
            raise ValueError("Invalid IsTruncated value in TOS listing")
        if not truncated:
            return
        token = result.get("NextContinuationToken")
        if not token or token in seen_tokens:
            raise RuntimeError("TOS returned a repeated/missing continuation token")
        seen_tokens.add(token)
    raise RuntimeError("Catalog exceeded the maximum number of TOS pages")


def authenticated_objects():
    import tos
    client = tos.TosClientV2(
        os.environ["TOS_ACCESS_KEY"],
        os.environ["TOS_SECRET_KEY"],
        f"tos-{REGION}.volces.com",
        REGION,
    )
    token = None
    seen_tokens = set()
    for page in range(MAX_PAGES):
        result = client.list_objects_type2(
            BUCKET, prefix=PREFIX, continuation_token=token or "", max_keys=1000
        )
        for entry in result.contents or []:
            yield {
                "key": entry.key,
                "size": entry.size,
                "updatedAt": str(entry.last_modified or ""),
            }
        if not result.is_truncated:
            return
        token = result.next_continuation_token
        if not token or token in seen_tokens:
            raise RuntimeError("TOS returned a repeated/missing continuation token")
        seen_tokens.add(token)
    raise RuntimeError("Catalog exceeded the maximum number of TOS pages")


def build(entries):
    books = {}
    for entry in entries:
        key = str(entry["key"])
        if not key.startswith(PREFIX) or key.endswith("/"):
            continue
        filename = key.rsplit("/", 1)[-1]
        ext = Path(filename).suffix.lower()
        if ext not in FORMATS:
            continue
        title = filename[: -len(ext)]
        size = int(entry["size"] or 0)
        if not title.strip() or size <= 0:
            continue
        books[key] = {
            "key": key,
            "name": filename,
            "title": title,
            "format": FORMATS[ext],
            "size": size,
            "updatedAt": str(entry.get("updatedAt") or ""),
            "url": BASE + "/" + urllib.parse.quote(key, safe="/"),
        }
    sorted_books = sorted(books.values(), key=lambda book: book["title"].casefold())
    return {
        "status": "ok",
        "source": "TOS",
        "bucket": BUCKET,
        "prefix": PREFIX,
        "generatedAt": now(),
        "count": len(sorted_books),
        "books": sorted_books,
    }


def previous_catalog():
    request = urllib.request.Request(
        LAST_GOOD_URL + "?_=" + urllib.parse.quote(now()),
        headers={"Cache-Control": "no-cache", "User-Agent": "PaperReaderCatalog/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            previous = json.load(response)
        if previous.get("status") in ("ok", "stale") and isinstance(previous.get("books"), list):
            previous["status"] = "stale"
            previous["warning"] = "同步暂时失败，当前展示上一次成功获取的目录"
            return previous
    except Exception:
        pass
    return {
        "status": "unavailable",
        "source": "TOS",
        "bucket": BUCKET,
        "prefix": PREFIX,
        "generatedAt": now(),
        "count": 0,
        "books": [],
        "warning": "无法列举 TOS 对象。请授予只读 ListBucket 权限，或设置 GitHub Actions TOS_ACCESS_KEY/TOS_SECRET_KEY。",
    }


def main():
    authenticated = bool(os.environ.get("TOS_ACCESS_KEY") and os.environ.get("TOS_SECRET_KEY"))
    try:
        entries = authenticated_objects() if authenticated else anonymous_objects()
        catalog = build(entries)
        print(f"Discovered {catalog['count']} ebooks using {'authenticated' if authenticated else 'anonymous'} TOS listing")
    except Exception as error:
        print(f"::warning::TOS catalog sync failed: {type(error).__name__}: {error}", file=sys.stderr)
        catalog = previous_catalog()
        print(f"Publishing status={catalog['status']}, books={len(catalog['books'])}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
