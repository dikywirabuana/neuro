#!/usr/bin/env python3
"""Local engine HTTP — bind 127.0.0.1:8091. UI talks via /api/engine proxy."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bot import ENGINE  # noqa: E402

HOST = "127.0.0.1"
PORT = 8091


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[engine] " + (fmt % args) + "\n")

    def _send(self, code: int, obj: dict) -> None:
        raw = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/"):
            self._send(200, {"ok": True, "engine": "python", "running": ENGINE.running})
            return
        if path == "/state":
            self._send(200, ENGINE.snapshot())
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            self._send(400, {"ok": False, "error": "invalid json"})
            return
        if path not in ("/command", "/"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        action = str(body.get("action") or "")
        if action == "start":
            if isinstance(body.get("settings"), dict):
                ENGINE.apply_settings(body["settings"])
            self._send(200, ENGINE.start())
            return
        if action == "stop":
            self._send(200, ENGINE.stop())
            return
        if action == "settings":
            ENGINE.apply_settings(body.get("settings") or body)
            self._send(200, {"ok": True})
            return
        if action == "sell":
            self._send(200, ENGINE.sell_pair(str(body.get("pair") or "")))
            return
        if action == "sell_all":
            self._send(200, ENGINE.sell_all())
            return
        self._send(400, {"ok": False, "error": f"unknown action {action}"})


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"NeuroTrend python engine {HOST}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
