#!/usr/bin/env python3
"""Simple local dev server with read/write access to ./data/vault_*.csv.

Why this exists:
- Static servers (VS Code Live Server, python -m http.server) can't write files.
- Browsers also can't edit files on disk without user prompts.

This server:
- Serves the front-end files
- Exposes a tiny JSON API to append/update records in two CSV files

Run:
  python server.py
Then open:
  http://localhost:5500
"""

from __future__ import annotations

import csv
import json
import os
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
PLAIN_PATH = DATA_DIR / "vault_plain.csv"
ENC_PATH = DATA_DIR / "vault_encrypted.csv"

PLAIN_HEADER = [
    "website",
    "username",
    "password",
    "cardNumber",
    "cardName",
    "cardExp",
    "cardCvc",
    "cardZip",
    "cardType",
    "createdAt",
    "projectStrength",
    "avastStrength",
]
ENC_HEADER = ["website", "username", "encPassword", "ivPassword", "encCard", "ivCard", "createdAt"]


def _ensure_files() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PLAIN_PATH.exists():
        with PLAIN_PATH.open("w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(PLAIN_HEADER)
    if not ENC_PATH.exists():
        with ENC_PATH.open("w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(ENC_HEADER)


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def _key(website: str | None, username: str | None) -> str:
    return f"{_norm(website)}||{_norm(username)}"


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [dict(r) for r in reader]


def _write_csv(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        for r in rows:
            # ensure all columns exist
            out = {k: (r.get(k, "") if r.get(k, "") is not None else "") for k in header}
            writer.writerow(out)


class Handler(SimpleHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _text(self, code: int, text: str, content_type: str) -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        _ensure_files()
        parsed = urlparse(self.path)
        if parsed.path == "/api/vault/plain":
            body = PLAIN_PATH.read_text(encoding="utf-8").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="vault_plain.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/vault/encrypted":
            body = ENC_PATH.read_text(encoding="utf-8").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="vault_encrypted.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        # default: static file
        return super().do_GET()

    def do_POST(self):
        _ensure_files()
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON"})
            return

        if parsed.path == "/api/vault/save":
            self._handle_save(data)
            return

        if parsed.path == "/api/vault/update":
            self._handle_update(data)
            return

        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Unknown endpoint"})

    def _handle_save(self, data: dict) -> None:
        website = (data.get("website") or "").strip()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        if not password:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "No password provided"})
            return

        # Plain row
        plain_rows = _read_csv(PLAIN_PATH)
        k = _key(website, username)
        if any(_key(r.get("website"), r.get("username")) == k for r in plain_rows):
            self._json(HTTPStatus.CONFLICT, {"ok": False, "error": "Duplicate: website + username already exists"})
            return

        created_at = (data.get("createdAt") or "").strip() or datetime.utcnow().isoformat() + "Z"

        new_plain = {
            "website": website,
            "username": username,
            "password": password,
            "cardNumber": (data.get("cardNumber") or "").strip(),
            "cardName":   (data.get("cardName")   or "").strip(),
            "cardExp":    (data.get("cardExp")     or "").strip(),
            "cardCvc": (data.get("cardCvc") or "").strip(),
            "cardZip": (data.get("cardZip") or "").strip(),
            "cardType": (data.get("cardType") or "").strip(),
            "createdAt": created_at,
            "projectStrength": (data.get("projectStrength") or "").strip(),
            "avastStrength": (data.get("avastStrength") or "").strip(),
        }
        plain_rows.append(new_plain)
        _write_csv(PLAIN_PATH, PLAIN_HEADER, plain_rows)

        # Encrypted row — password and card encrypted separately
        enc_rows = _read_csv(ENC_PATH)
        enc_rows.append(
            {
                "website": website,
                "username": username,
                "encPassword": (data.get("encPassword") or "").strip(),
                "ivPassword": (data.get("ivPassword") or "").strip(),
                "encCard": (data.get("encCard") or "").strip(),
                "ivCard": (data.get("ivCard") or "").strip(),
                "createdAt": created_at,
            }
        )
        _write_csv(ENC_PATH, ENC_HEADER, enc_rows)

        self._json(200, {"ok": True})

    def _handle_update(self, data: dict) -> None:
        original_key = (data.get("originalKey") or "").strip()
        if not original_key:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing originalKey"})
            return

        website = (data.get("website") or "").strip()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        if not password:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Password cannot be empty"})
            return

        plain_rows = _read_csv(PLAIN_PATH)
        idx = next((i for i, r in enumerate(plain_rows) if _key(r.get("website"), r.get("username")) == original_key), -1)
        if idx < 0:
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Record not found"})
            return

        new_key = _key(website, username)
        if new_key != original_key:
            if any(i != idx and _key(r.get("website"), r.get("username")) == new_key for i, r in enumerate(plain_rows)):
                self._json(HTTPStatus.CONFLICT, {"ok": False, "error": "Conflict: another record has that website + username"})
                return

        prev = plain_rows[idx]
        created_at = (prev.get("createdAt") or "").strip() or datetime.utcnow().isoformat() + "Z"

        # update plain
        plain_rows[idx] = {
            **prev,
            "website": website,
            "username": username,
            "password": password,
            "cardNumber": (data.get("cardNumber") or "").strip(),
            "cardName":   (data.get("cardName")   or prev.get("cardName") or "").strip(),
            "cardExp":    (data.get("cardExp")     or prev.get("cardExp")  or "").strip(),
            "cardCvc": (data.get("cardCvc") or prev.get("cardCvc") or "").strip(),
            "cardZip": (data.get("cardZip") or prev.get("cardZip") or "").strip(),
            "cardType": (data.get("cardType") or prev.get("cardType") or "").strip(),
            "createdAt": created_at,
            "projectStrength": (data.get("projectStrength") or prev.get("projectStrength") or "").strip(),
            "avastStrength": (data.get("avastStrength") or prev.get("avastStrength") or "").strip(),
        }
        _write_csv(PLAIN_PATH, PLAIN_HEADER, plain_rows)

        # update encrypted row
        enc_rows = _read_csv(ENC_PATH)
        enc_idx = next((i for i, r in enumerate(enc_rows) if _key(r.get("website"), r.get("username")) == original_key), -1)
        enc_row = {
            "website": website,
            "username": username,
            "encPassword": (data.get("encPassword") or "").strip(),
            "ivPassword": (data.get("ivPassword") or "").strip(),
            "encCard": (data.get("encCard") or "").strip(),
            "ivCard": (data.get("ivCard") or "").strip(),
            "createdAt": created_at,
        }
        if enc_idx >= 0:
            enc_rows[enc_idx] = enc_row
        else:
            enc_rows.append(enc_row)
        _write_csv(ENC_PATH, ENC_HEADER, enc_rows)

        self._json(200, {"ok": True})


def main() -> None:
    os.chdir(BASE_DIR)
    port = int(os.environ.get("PORT", "5500"))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on http://localhost:{port}")
    print("Vault CSVs:")
    print(f"  {PLAIN_PATH}")
    print(f"  {ENC_PATH}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
