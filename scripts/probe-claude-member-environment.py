"""Opt-in real CLI compatibility probe; loopback endpoints and synthetic credentials only."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--claude", required=True, type=Path, help="Absolute path to the installed Claude CLI")
args = parser.parse_args()
assert args.claude.is_absolute() and args.claude.is_file()
requests = []


class Endpoint(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or "{}")
        member = self.server.member
        matched = (
            self.headers.get("x-api-key") == ("fixture-key-a" if member == 0 else None)
            and self.headers.get("authorization") == (None if member == 0 else "Bearer fixture-token-b")
            and payload.get("model") == f"fixture-model-{member}"
        )
        requests.append({"member": member, "path": self.path, "credentialsAndModelMatched": matched})
        message = {"id": "msg_fixture", "type": "message", "role": "assistant", "content": [],
                   "model": payload.get("model"), "stop_reason": None, "stop_sequence": None,
                   "usage": {"input_tokens": 8, "output_tokens": 2}}
        content_type = "application/json"
        if "count_tokens" in self.path:
            body = json.dumps({"input_tokens": 8}).encode()
        elif payload.get("stream"):
            events = [
                ("message_start", {"type": "message_start", "message": message}),
                ("content_block_start", {"type": "content_block_start", "index": 0,
                                         "content_block": {"type": "text", "text": ""}}),
                ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                         "delta": {"type": "text_delta", "text": "fixture-ok"}}),
                ("content_block_stop", {"type": "content_block_stop", "index": 0}),
                ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                                   "usage": {"output_tokens": 2}}),
                ("message_stop", {"type": "message_stop"}),
            ]
            body = "".join(f"event: {event}\ndata: {json.dumps(value)}\n\n" for event, value in events).encode()
            content_type = "text/event-stream"
        else:
            message.update(content=[{"type": "text", "text": "fixture-ok"}], stop_reason="end_turn")
            body = json.dumps(message).encode()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


with tempfile.TemporaryDirectory(prefix="rovai-claude-member-environment-") as directory:
    root = Path(directory).resolve()
    shared, home, workspace = [root / name for name in ("claude", "home", "workspace")]
    for path in (shared, home, workspace):
        path.mkdir(mode=0o700)
    settings = shared / "settings.json"
    settings.write_text(json.dumps({"apiKeyHelper": "printf fixture-wrong-helper-key", "env": {
        "ANTHROPIC_BASE_URL": "http://127.0.0.1:1", "ANTHROPIC_AUTH_TOKEN": "fixture-wrong-native-token",
        "ANTHROPIC_MODEL": "wrong-native-model", "CLAUDE_CODE_USE_VERTEX": "1"}}))
    settings.chmod(0o600)
    base = {"HOME": str(home), "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SHELL": "/bin/sh",
            "TMPDIR": str(root), "CLAUDE_CONFIG_DIR": str(shared), "NO_PROXY": "127.0.0.1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_TELEMETRY": "1",
            "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST": "1"}
    version = subprocess.check_output([str(args.claude), "--version"], env=base, cwd=workspace, text=True, timeout=15).strip()
    servers = [ThreadingHTTPServer(("127.0.0.1", 0), Endpoint) for _ in range(2)]
    for member, server in enumerate(servers):
        server.member = member
        threading.Thread(target=server.serve_forever, daemon=True).start()

    def run(member):
        overlay = {"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{servers[member].server_port}",
                   "ANTHROPIC_MODEL": f"fixture-model-{member}"}
        overlay.update({"ANTHROPIC_API_KEY": "fixture-key-a"} if member == 0 else {"ANTHROPIC_AUTH_TOKEN": "fixture-token-b"})
        inline = root / f"member-{member}.json"
        inline.write_text(json.dumps({"env": {**overlay, "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}}))
        inline.chmod(0o600)
        child = subprocess.run([str(args.claude), "-p", "Reply briefly", "--output-format", "json", "--settings", str(inline)],
                               env={**base, **overlay}, cwd=workspace, capture_output=True, text=True, timeout=55)
        return {"member": member, "exit": child.returncode, "replyMatched": child.returncode == 0 and json.loads(child.stdout).get("result") == "fixture-ok"}

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, range(2)))
        passed = (all(result["replyMatched"] for result in results)
                  and {request["member"] for request in requests} == {0, 1}
                  and all(request["credentialsAndModelMatched"] for request in requests))
        print(json.dumps({"cliVersion": version, "routingPassed": passed, "results": results, "requests": requests}, indent=2))
        assert passed, "The installed CLI did not preserve both member routes"
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
