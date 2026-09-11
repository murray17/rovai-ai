"""Isolated official BYOK context qualification; never stores request bodies or keys in evidence."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError

mode = sys.argv[1]
assert mode in ("auto", "reactive")
source = Path.home() / ".zcode/cli/config.json"
config = json.loads(source.read_text())
provider_id, model_id = config["model"]["main"].split("/", 1)
provider = config["provider"][provider_id]
assert provider["kind"] == "anthropic", "This controlled overflow fixture requires an Anthropic-compatible BYOK provider"
upstream = urlsplit(provider["options"]["baseURL"])
assert upstream.scheme == "https"
fixture = Path(tempfile.mkdtemp(prefix="rovai-zcode-context-home-"))
home = fixture / "home"
config_path = home / ".zcode/cli/config.json"
config_path.parent.mkdir(parents=True, mode=0o700)
config["storage"] = {"dir": str(home / ".zcode"), "sessionDbPath": str(home / ".zcode/cli/db/db.sqlite")}
config["mcp"] = {"servers": {}}
config["memory"] = {"use": False}
provider["models"][model_id].setdefault("limit", {})["context"] = 36000 if mode == "auto" else 1000000
provider["models"][model_id].pop("contextWindow", None)
counts = {"providerRequests": 0, "injectedOverflowCount": 0, "redeliveryRequests": 0}

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *args):
        pass
    def do_POST(self):
        try:
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            value = json.loads(body)
            last_user = next((m for m in reversed(value.get("messages", [])) if m.get("role") == "user"), {})
            content = json.dumps(last_user.get("content", []))
            counts["providerRequests"] += 1
            if "[ROVAI_BOOTSTRAP_REDELIVERY" in content:
                counts["redeliveryRequests"] += 1
            if mode == "reactive" and counts["injectedOverflowCount"] == 0 and "TRIGGER_OVERFLOW_FIXTURE" in content:
                counts["injectedOverflowCount"] += 1
                fault = json.dumps({"type": "error", "error": {"type": "invalid_request_error", "message": "Controlled context_length_exceeded: prompt is too long: 200000 tokens > 160000 maximum"}}).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(fault)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(fault)
                self.close_connection = True
                return
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection", "content-length", "accept-encoding")}
            headers["Accept-Encoding"] = "identity"
            request = Request(upstream.scheme + "://" + upstream.netloc + self.path, data=body, headers=headers, method="POST")
            try:
                response = urlopen(request, timeout=120)
            except HTTPError as error:
                response = error
            with response:
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Connection", "close")
                self.end_headers()
                while chunk := response.read1(8192):
                    self.wfile.write(chunk)
                    self.wfile.flush()
            self.close_connection = True
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            # Exception text/HTTP objects can contain provider credentials.
            self.close_connection = True

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
provider["options"]["baseURL"] = f"http://127.0.0.1:{server.server_port}" + upstream.path
try:
    with os.fdopen(os.open(config_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        json.dump(config, stream)
    env = os.environ.copy()
    env.update(HOME=str(home), USERPROFILE=str(home), ROVAI_ZCODE_CONTEXT_CASE=mode)
    result = subprocess.run([shutil.which("node"), "scripts/smoke-zcode-context.mjs"], env=env, timeout=1200)
    print(json.dumps({"mode": mode, **counts, "childExitCode": result.returncode}), flush=True)
    assert result.returncode == 0
    assert counts["redeliveryRequests"] > 0
    assert counts["injectedOverflowCount"] == (1 if mode == "reactive" else 0)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
    config_path.unlink(missing_ok=True)
    print("Context native fixture retained without BYOK config: " + str(fixture), flush=True)
