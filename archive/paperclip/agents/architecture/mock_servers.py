"""
In-process HTTP mocks for the FORA arch-publisher smoke test.

These mocks mimic the exact wire format of the production
`mcp-servers/confluence` and `mcp-servers/slack` servers so the smoke
test exercises the publisher against the same shape of HTTP the
production code path sees.

Why Python instead of node? The publisher code path is the same either
way; booting Python mocks keeps the smoke test self-contained (no node
dependency, no separate `mock-confluence.mjs` to coordinate). The
node-based mocks under `mcp-servers/*/test/` stay authoritative for the
MCP server behaviour; this file is only for the publisher smoke.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse


# --- Confluence mock -------------------------------------------------------


class _ConfluenceState:
    def __init__(self, space_id: str) -> None:
        self.space_id = space_id
        self.pages: Dict[str, Dict[str, Any]] = {}
        self.comments: List[Dict[str, Any]] = []
        self.call_log: List[Dict[str, Any]] = []
        # seed with two pages so list_pages is non-trivial
        self.pages["10001"] = {
            "id": "10001",
            "title": "SDLC architecture overview",
            "spaceId": space_id,
            "parentId": None,
            "status": "current",
            "version": {"number": 4, "createdAt": "2026-06-10T10:00:00Z"},
            "body": {
                "representation": "storage",
                "value": "<h1>SDLC architecture overview</h1>",
            },
            "_links": {"webui": "/wiki/spaces/ENG/pages/10001"},
        }
        self.pages["10002"] = {
            "id": "10002",
            "title": "Runbook: spinning up a new MCP server",
            "spaceId": space_id,
            "parentId": "10001",
            "status": "current",
            "version": {"number": 1, "createdAt": "2026-06-12T10:00:00Z"},
            "body": {
                "representation": "storage",
                "value": "<h1>Runbook</h1>",
            },
            "_links": {"webui": "/wiki/spaces/ENG/pages/10002"},
        }
        self._id_counter = 20000

    def next_id(self) -> str:
        self._id_counter += 1
        return str(self._id_counter)


def start_confluence_mock(space_id: str = "9001") -> Tuple[str, "_ConfluenceState", ThreadingHTTPServer]:
    state = _ConfluenceState(space_id)
    captured: Dict[str, Any] = {}

    class Handler(BaseHTTPRequestHandler):
        # silence the default access-log spam
        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: D401
            return

        def _record(self, method: str, path: str) -> None:
            state.call_log.append({"method": method, "path": path, "body": None})

        def _send_json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> Optional[Dict[str, Any]]:
            length = int(self.headers.get("content-length") or 0)
            if length == 0:
                return None
            raw = self.rfile.read(length)
            try:
                return json.loads(raw)
            except Exception:  # noqa: BLE001
                return None

        def do_GET(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            self._record("GET", u.path)
            # GET /api/v2/spaces?keys=ENG
            if u.path == "/api/v2/spaces":
                qs = parse_qs(u.query)
                keys = qs.get("keys", [])
                if not keys or "ENG" in keys:
                    return self._send_json(200, {"results": [{"id": state.space_id, "key": "ENG"}]})
                return self._send_json(200, {"results": []})
            # GET /api/v2/spaces/{id}/pages
            list_prefix = f"/api/v2/spaces/{state.space_id}/pages"
            if u.path == list_prefix or u.path.startswith(list_prefix + "?"):
                qs = parse_qs(u.query)
                title_filter = (qs.get("title") or [None])[0]
                out = []
                for p in state.pages.values():
                    if title_filter and p["title"] != title_filter:
                        continue
                    slim = {k: v for k, v in p.items() if k != "body"}
                    out.append(slim)
                return self._send_json(200, {"results": out})
            # GET /api/v2/pages/{id}
            m_id = None
            if u.path.startswith("/api/v2/pages/"):
                rest = u.path[len("/api/v2/pages/"):]
                # strip query
                rest = rest.split("?")[0]
                m_id = rest
            if m_id and m_id in state.pages:
                return self._send_json(200, state.pages[m_id])
            return self._send_json(404, {"message": f"Not Found: GET {u.path}"})

        def do_POST(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            self._record("POST", u.path)
            body = self._read_json()
            # POST /api/v2/pages
            if u.path == "/api/v2/pages":
                pid = state.next_id()
                page = {
                    "id": pid,
                    "title": (body or {}).get("title", "(untitled)"),
                    "spaceId": (body or {}).get("spaceId", state.space_id),
                    "parentId": (body or {}).get("parentId"),
                    "status": (body or {}).get("status", "current"),
                    "version": {"number": 1, "createdAt": "2026-06-17T00:00:00Z"},
                    "body": (body or {}).get(
                        "body", {"representation": "storage", "value": ""}
                    ),
                    "_links": {"webui": f"/wiki/spaces/ENG/pages/{pid}"},
                }
                state.pages[pid] = page
                return self._send_json(201, page)
            # POST /api/v2/footer-comments
            if u.path == "/api/v2/footer-comments":
                cid = str(30000 + len(state.comments) + 1)
                comment = {
                    "id": cid,
                    "pageId": (body or {}).get("pageId"),
                    "body": (body or {}).get("body", {"representation": "storage", "value": ""}),
                    "version": {"number": 1, "createdAt": "2026-06-17T00:00:00Z"},
                    "createdAt": "2026-06-17T00:00:00Z",
                }
                state.comments.append(comment)
                return self._send_json(201, comment)
            return self._send_json(404, {"message": f"Not Found: POST {u.path}"})

        def do_PATCH(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            self._record("PATCH", u.path)
            body = self._read_json()
            # PATCH /api/v2/pages/{id}
            if u.path.startswith("/api/v2/pages/"):
                pid = u.path[len("/api/v2/pages/"):].split("?")[0]
                p = state.pages.get(pid)
                if not p:
                    return self._send_json(404, {"message": "Not Found"})
                if body:
                    p["title"] = body.get("title", p["title"])
                    p["body"] = body.get("body", p["body"])
                    p["version"] = {
                        "number": (body.get("version", {}).get("number", p["version"]["number"])),
                        "createdAt": "2026-06-17T00:00:01Z",
                    }
                return self._send_json(200, p)
            return self._send_json(404, {"message": f"Not Found: PATCH {u.path}"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    def serve() -> None:
        server.serve_forever()

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    # Tiny grace period so the server is ready before any HTTP call.
    time.sleep(0.05)
    captured["server"] = server
    return base_url, state, server


# --- Slack mock ------------------------------------------------------------


class _SlackState:
    def __init__(self, team_id: str) -> None:
        self.team_id = team_id
        self.channels: List[Dict[str, Any]] = [
            {
                "id": "C001",
                "name": "general",
                "is_private": False,
                "is_archived": False,
                "num_members": 42,
                "team": team_id,
                "topic": {"value": "Company-wide announcements"},
                "purpose": {"value": "General chatter."},
            },
            {
                "id": "C002",
                "name": "forge",
                "is_private": True,
                "is_archived": False,
                "num_members": 7,
                "team": team_id,
                "topic": {"value": "FORA engineering"},
                "purpose": {"value": "Engineering coordination."},
            },
        ]
        self.history: Dict[str, List[Dict[str, Any]]] = {
            "C002": [
                {
                    "ts": "1700001000.000100",
                    "user": "U010",
                    "text": "Forge thread root",
                    "reply_count": 0,
                },
            ],
        }
        self.posted: List[Dict[str, Any]] = []
        self.call_log: List[Dict[str, Any]] = []


def start_slack_mock(team_id: str = "T0123MOCK") -> Tuple[str, _SlackState, ThreadingHTTPServer]:
    state = _SlackState(team_id)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: D401
            return

        def _record(self, method: str, path: str, body: Any) -> None:
            state.call_log.append({"method": method, "path": path, "body": body})

        def _send(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else ""
            ctype = self.headers.get("content-type") or ""
            if "application/x-www-form-urlencoded" in ctype:
                from urllib.parse import parse_qs as _p

                form = {k: v[0] for k, v in _p(raw, keep_blank_values=True).items()}
            else:
                try:
                    form = json.loads(raw) if raw else {}
                except Exception:  # noqa: BLE001
                    form = {}
            self._record("POST", u.path, form)
            if u.path == "/api/auth.test":
                return self._send(200, {"ok": True, "team": "Acme", "team_id": state.team_id})
            if u.path == "/api/chat.postMessage":
                channel = form.get("channel", "")
                text = form.get("text", "")
                ts = f"1700002000.{len(state.posted) + 700:06d}"
                posted = {"ts": ts, "user": "U_BOT", "text": text}
                if "thread_ts" in form:
                    posted["thread_ts"] = form["thread_ts"]
                state.posted.append(posted)
                return self._send(
                    200,
                    {
                        "ok": True,
                        "channel": channel,
                        "ts": ts,
                        "message": posted,
                    },
                )
            if u.path == "/api/chat.update":
                channel = form.get("channel", "")
                ts = form.get("ts", "")
                text = form.get("text", "")
                return self._send(
                    200,
                    {
                        "ok": True,
                        "channel": channel,
                        "ts": ts,
                        "message": {"ts": ts, "user": "U_BOT", "text": text},
                    },
                )
            if u.path == "/api/reactions.add":
                return self._send(200, {"ok": True})
            return self._send(200, {"ok": False, "error": f"unknown POST {u.path}"})

        def do_GET(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            qs = parse_qs(u.query)
            self._record("GET", u.path, dict(qs))
            if u.path == "/api/auth.test":
                return self._send(200, {"ok": True, "team": "Acme", "team_id": state.team_id})
            if u.path == "/api/conversations.list":
                return self._send(
                    200, {"ok": True, "channels": state.channels, "response_metadata": {}}
                )
            if u.path == "/api/conversations.info":
                ch = (qs.get("channel") or [""])[0]
                found = next((c for c in state.channels if c["id"] == ch), None)
                if not found:
                    return self._send(200, {"ok": False, "error": "channel_not_found"})
                return self._send(200, {"ok": True, "channel": found})
            if u.path == "/api/conversations.history":
                ch = (qs.get("channel") or [""])[0]
                return self._send(
                    200,
                    {
                        "ok": True,
                        "messages": state.history.get(ch, []),
                        "has_more": False,
                    },
                )
            if u.path == "/api/search.messages":
                query = (qs.get("query") or [""])[0].lower()
                all_msgs = []
                for ch_id, msgs in state.history.items():
                    for m in msgs:
                        if query in m["text"].lower():
                            all_msgs.append(
                                {
                                    "type": "message",
                                    "channel": {"id": ch_id, "name": "forge"},
                                    "ts": m["ts"],
                                    "user": m["user"],
                                    "text": m["text"],
                                    "permalink": f"https://acme.slack.com/archives/{ch_id}/p",
                                }
                            )
                # Also include the bot's own posted messages so the
                # search-then-update idempotency path can find prior posts.
                for m in state.posted:
                    if query in (m.get("text") or "").lower():
                        all_msgs.append(
                            {
                                "type": "message",
                                "channel": {"id": "C002", "name": "forge"},
                                "ts": m["ts"],
                                "user": "U_BOT",
                                "text": m["text"],
                                "permalink": "https://acme.slack.com/archives/C002/p",
                            }
                        )
                return self._send(
                    200,
                    {"ok": True, "messages": {"total": len(all_msgs), "matches": all_msgs}, "total": len(all_msgs), "hits": all_msgs},
                )
            return self._send(200, {"ok": False, "error": f"unknown GET {u.path}"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    def serve() -> None:
        server.serve_forever()

    threading.Thread(target=serve, daemon=True).start()
    time.sleep(0.05)
    return base_url, state, server
