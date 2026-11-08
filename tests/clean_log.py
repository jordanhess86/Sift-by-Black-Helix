"""Make a cleaned copy of a Chrome network log, working only on this computer.

Keeps: request method, address shape, status code, and the *structure* of JSON
responses. Drops: all headers, cookies, request bodies and every text value.
Prints only counts, never the file's contents.
"""
import base64
import binascii
import json
import re
import sys
from collections import Counter
from urllib.parse import parse_qsl, urlsplit

UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$")
SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-.]{0,39}$")
SAFE_SEGMENT = re.compile(r"^[a-z][a-z_\-]{0,29}$")
MAX_ITEMS = 2
MAX_DEPTH = 12


def clean_value(value, depth=0):
    if depth > MAX_DEPTH:
        return "<too-deep>"
    if isinstance(value, dict):
        out, hidden = {}, 0
        for key, item in value.items():
            if SAFE_KEY.match(key) and not UUID.match(key):
                out[key] = clean_value(item, depth + 1)
            elif hidden == 0:
                out["<id-or-private-key>"] = clean_value(item, depth + 1)
                hidden = 1
            else:
                hidden += 1
        if hidden > 1:
            out["<more-hidden-keys>"] = hidden - 1
        return out
    if isinstance(value, list):
        out = [clean_value(item, depth + 1) for item in value[:MAX_ITEMS]]
        if len(value) > MAX_ITEMS:
            out.append(f"<{len(value) - MAX_ITEMS} more items>")
        return out
    if isinstance(value, str):
        if UUID.match(value):
            return "<id>"
        if DATE.match(value):
            return "<date>"
        return "<text>"
    if isinstance(value, bool) or value is None:
        return value
    return "<number>"


def clean_url(url):
    parts = urlsplit(url)
    segments = [s if not s or SAFE_SEGMENT.match(s) else "<id-or-name>" for s in parts.path.split("/")]
    params = []
    for key, val in parse_qsl(parts.query, keep_blank_values=True):
        shown = val if re.fullmatch(r"\d{1,6}|true|false", val) else "<text>"
        params.append(f"{key if SAFE_KEY.match(key) else '<key>'}={shown}")
    query = "?" + "&".join(params) if params else ""
    return f"{parts.scheme}://{parts.hostname}{'/'.join(segments)}{query}"


def is_chatgpt(host):
    return host == "chatgpt.com" or host.endswith(".chatgpt.com")


def main(source, target):
    with open(source, "rb") as handle:
        raw = handle.read()
    try:
        har = json.loads(raw.decode("utf-8-sig"))
        entries = har["log"]["entries"]
    except (ValueError, KeyError, TypeError):
        print("NOT_HAR: file is not a HAR network log; nothing was written.")
        print(f"bytes={len(raw)} lines={raw.count(bytes([10])) + 1}")
        return

    rows, skipped_hosts, unreadable = [], 0, 0
    for entry in entries:
        request = entry.get("request", {})
        response = entry.get("response", {})
        url = request.get("url", "")
        if not is_chatgpt(urlsplit(url).hostname or ""):
            skipped_hosts += 1
            continue
        content = response.get("content", {})
        body = content.get("text")
        shape = None
        if body:
            try:
                if content.get("encoding") == "base64":
                    body = base64.b64decode(body).decode("utf-8")
                shape = clean_value(json.loads(body))
            except (ValueError, binascii.Error):
                shape = "<not-json>"
                unreadable += 1
        sent = (request.get("postData") or {}).get("text")
        sent_shape = None
        if sent:
            try:
                sent_shape = clean_value(json.loads(sent))
            except ValueError:
                sent_shape = "<not-json>"
        rows.append({
            "method": request.get("method"),
            "url": clean_url(url),
            "status": response.get("status"),
            "type": content.get("mimeType"),
            "request_shape": sent_shape,
            "response_shape": shape,
        })

    with open(target, "w", encoding="utf-8") as handle:
        json.dump(rows, handle, indent=1)

    print(f"HAR: total={len(entries)} kept={len(rows)} other_sites_dropped={skipped_hosts} non_json_bodies={unreadable}")
    print("status_counts:", dict(Counter(r["status"] for r in rows)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
