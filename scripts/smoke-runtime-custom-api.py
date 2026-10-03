#!/usr/bin/env python3
"""Explicit local native acceptance. Fake key, loopback API, isolated Homes, no project input.

Build: cargo build -p rovai-core --example custom_api_native_fixture
Run: python3 scripts/smoke-runtime-custom-api.py --codex /absolute/codex [--claude ...]
No user endpoint or credential is accepted by this script.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import tempfile
import threading
import time

FAKE_KEY = "rovai-isolated-fake-key"
ROTATED_FAKE_KEY = "rovai-isolated-rotated-key"
REQUESTS = []


class Api(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        authorization = self.headers.get("Authorization", "")
        auth_header = "bearer" if authorization else "x-api-key"
        if not authorization and self.headers.get("x-api-key"):
            authorization = "Bearer " + self.headers["x-api-key"]
        version = 1 if authorization == "Bearer " + FAKE_KEY else 2 if authorization == "Bearer " + ROTATED_FAKE_KEY else 0
        REQUESTS.append({"path": self.path, "model": body.get("model"), "keyMatches": version > 0, "keyVersion": version, "authHeader": auth_header, "nativeHeaderPreserved":self.headers.get("x-rovai-fixture") == "preserved"})
        model = body.get("model", "fixture")
        route = self.path.split("?", 1)[0]
        if route.endswith("/messages"):
            events = [("message_start", {"type": "message_start", "message": {"id": "msg_fixture", "type": "message", "role": "assistant", "model": model, "content": [], "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 0}}}),
                      ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
                      ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "OK"}}),
                      ("content_block_stop", {"type": "content_block_stop", "index": 0}),
                      ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 1}}),
                      ("message_stop", {"type": "message_stop"})]
        elif route.endswith("/chat/completions"):
            events = [(None, {"id": "chat_fixture", "object": "chat.completion.chunk", "created": 1, "model": model, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "OK"}, "finish_reason": None}]}),
                      (None, {"id": "chat_fixture", "object": "chat.completion.chunk", "created": 1, "model": model, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})]
        else:
            item = {"id": "msg_fixture", "type": "message", "status": "completed", "role": "assistant", "content": [{"type": "output_text", "text": "OK", "annotations": []}]}
            response = {"id": "resp_fixture", "object": "response", "created_at": 1, "status": "completed", "model": model, "output": [item], "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2, "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}}}
            events = [("response.created", {"type": "response.created", "response": {**response, "status": "in_progress", "output": []}}),
                      ("response.output_item.added", {"type": "response.output_item.added", "output_index": 0, "item": {**item, "status": "in_progress", "content": []}}),
                      ("response.content_part.added", {"type": "response.content_part.added", "item_id": "msg_fixture", "output_index": 0, "content_index": 0, "part": {"type": "output_text", "text": "", "annotations": []}}),
                      ("response.output_text.delta", {"type": "response.output_text.delta", "item_id": "msg_fixture", "output_index": 0, "content_index": 0, "delta": "OK"}),
                      ("response.output_text.done", {"type": "response.output_text.done", "item_id": "msg_fixture", "output_index": 0, "content_index": 0, "text": "OK"}),
                      ("response.output_item.done", {"type": "response.output_item.done", "output_index": 0, "item": item}),
                      ("response.completed", {"type": "response.completed", "response": response})]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        for sequence, (event, data) in enumerate(events):
            if event and event.startswith("response."):
                data["sequence_number"] = sequence
            self.wfile.write((("event: " + event + "\n" if event else "") + "data: " + json.dumps(data) + "\n\n").encode())
        if route.endswith("/chat/completions"):
            self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


class Native:
    def __init__(self, helper, executable, root, config):
        path = root / "connection.json"
        path.write_text(json.dumps(config))
        (root / ".rovai-custom-api-fixture").touch()
        env = {"PATH": os.environ["PATH"], "HOME": str(root), "USERPROFILE": str(root),
               "GROK_HOME": str(root / "grok"), "LANG": "en_US.UTF-8"}
        self.child = subprocess.Popen([str(helper), str(executable), str(root), str(path)], cwd=root,
                                     env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, start_new_session=True)
        self.frames = queue.Queue()
        self.errors = []
        self.rid = 0
        def read():
            for line in self.child.stdout:
                try:
                    self.frames.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
            self.frames.put({"fixtureExited": True})
        def stderr():
            for line in self.child.stderr:
                self.errors.append(line.replace(FAKE_KEY, "<fake-key>").replace(ROTATED_FAKE_KEY, "<rotated-fake-key>"))
        threading.Thread(target=read, daemon=True).start()
        threading.Thread(target=stderr, daemon=True).start()

    def send(self, frame):
        self.child.stdin.write(json.dumps(frame) + "\n")
        self.child.stdin.flush()

    def wait(self, predicate, timeout=35):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            frame = self.frames.get(timeout=max(.1, end - time.monotonic()))
            if frame.get("fixtureExited"):
                raise AssertionError("Native exited: " + "".join(self.errors)[-1600:])
            if predicate(frame):
                return frame
        raise AssertionError("native protocol timed out")

    def rpc(self, method, params):
        self.rid += 1
        self.send({"jsonrpc": "2.0", "id": self.rid, "method": method, "params": params})
        frame = self.wait(lambda f: f.get("id") == self.rid)
        assert "error" not in frame, str(frame).replace(FAKE_KEY, "<fake-key>").replace(ROTATED_FAKE_KEY, "<rotated-fake-key>")
        return frame.get("result", {})

    def control(self, subtype):
        self.send({"type": "control_request", "request_id": subtype, "request": {"subtype": subtype}})
        frame = self.wait(lambda f: f.get("response", {}).get("request_id") == subtype)
        assert frame["response"]["subtype"] == "success", "native control unavailable: " + subtype
        return frame["response"]["response"]

    def close(self):
        if self.child.poll() is not None:
            return
        try:
            os.killpg(self.child.pid, signal.SIGTERM)
            self.child.wait(timeout=4)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(self.child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.child.wait()


def run(kind, executable, helper, root, base):
    config = {"kind": {"claude": "claude-code-cli", "codex": "codex-cli"}[kind], "mode": "custom_api", "baseUrl": base}
    if kind == "codex":
        (root / "codex").mkdir()
        (root / "codex/config.toml").write_text('model_provider="relay"\n[model_providers.relay]\nname="Fixture relay"\nbase_url="http://127.0.0.1:1/old"\nwire_api="responses"\n[model_providers.relay.http_headers]\nx-rovai-fixture="preserved"\n')
        config.update(models=[{"rowId":"known", "id": "gpt-6.1-sol", "displayName": "Known"}, {"rowId":"unknown", "id": "rovai-unknown", "displayName": "Unknown"}], defaultModel="rovai-unknown", defaultRowId="unknown")
    elif kind == "claude":
        config["models"] = {"model": "rovai-main", "reasoningModel": "rovai-thinking", "haikuModel": "rovai-haiku", "sonnetModel": "rovai-sonnet", "opusModel": "rovai-opus"}
        (root / "claude").mkdir()
        (root / "claude/settings.json").write_text(json.dumps({"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:1/old", "ANTHROPIC_AUTH_TOKEN": "old-fake-key", "ANTHROPIC_MODEL": "old-model", "ANTHROPIC_CUSTOM_HEADERS":"x-rovai-fixture: preserved"}}))
    start = len(REQUESTS)
    native = Native(helper, executable, root, config)
    try:
        if kind == "claude":
            native.control("initialize")
            settings, status = native.control("get_settings"), native.control("get_status")
            assert settings["effective"]["env"]["ANTHROPIC_AUTH_TOKEN"] == FAKE_KEY
            assert settings["effective"]["env"]["ANTHROPIC_REASONING_MODEL"] == "rovai-thinking"
            assert settings["applied"]["model"] == "rovai-main"
            rows = {row["label"]: row["value"] for section in status["sections"] for row in section["rows"]}
            assert rows["Auth token"] == "ANTHROPIC_AUTH_TOKEN" and rows["Anthropic base URL"] == base
            native.send({"type": "user", "session_id": rows["Session ID"], "message": {"role": "user", "content": "Reply OK."}, "parent_tool_use_id": None})
            result = native.wait(lambda f: f.get("type") == "result")
            assert not result.get("is_error"), "Claude native result failed: " + json.dumps(result).replace(FAKE_KEY, "<fake-key>").replace(ROTATED_FAKE_KEY, "<rotated-fake-key>")
        elif kind == "codex":
            native.rpc("initialize", {"clientInfo": {"name": "rovai_fixture", "version": "1"}, "capabilities": {"experimentalApi": True}})
            native.send({"method": "initialized", "params": {}})
            effective = native.rpc("config/read", {"cwd": str(root), "includeLayers": False})["config"]
            provider_id = effective["model_provider"]
            assert provider_id.startswith("rovai_custom_")
            provider = effective["model_providers"][provider_id]
            assert provider["base_url"] == base and provider["env_key"] == "ROVAI_CUSTOM_API_KEY"
            catalog = native.rpc("model/list", {"includeHidden": True, "limit": 100})["data"]
            ids = {m["model"] for m in catalog}
            assert {"gpt-6.1-sol", "rovai-unknown"} <= ids
            sessions = []
            for model in ["gpt-6.1-sol", "rovai-unknown"]:
                session = native.rpc("thread/start", {"cwd": str(root), "model": model, "modelProvider": provider_id, "approvalPolicy": "never", "sandbox": "read-only", "ephemeral": False})
                sessions.append(session["thread"]["id"])
                assert session["modelProvider"] == provider_id and session["model"] == model
                native.rpc("turn/start", {"threadId": session["thread"]["id"], "input": [{"type": "text", "text": "Reply OK."}]})
                result = native.wait(lambda f: f.get("method") == "turn/completed")
                assert result["params"]["turn"]["status"] == "completed", "Codex turn failed"
            # A new process resumes with the new connection; an already-running
            # different thread in the old process keeps its captured credentials.
            (root / "rotate-fixture-key").touch()
            rotated = Native(helper, executable, root, {**config, "baseUrl": base + "/rotated"})
            try:
                rotated.rpc("initialize", {"clientInfo": {"name": "rovai_fixture", "version": "1"}})
                rotated.send({"method": "initialized", "params": {}})
                rotated_provider = rotated.rpc("config/read", {"cwd":str(root),"includeLayers":False})["config"]["model_provider"]
                assert rotated_provider != provider_id
                fresh = rotated.rpc("thread/start", {"cwd":str(root),"model":"rovai-unknown","modelProvider":rotated_provider,"approvalPolicy":"never","sandbox":"read-only","ephemeral":True})
                boundary = len(REQUESTS)
                rotated.rpc("turn/start", {"threadId": fresh["thread"]["id"], "input": [{"type":"text","text":"Reply OK."}]})
                result = rotated.wait(lambda f:f.get("method") == "turn/completed")
                assert result["params"]["turn"]["status"] == "completed"
                assert REQUESTS[boundary:] and all(r["keyVersion"] == 2 and r["path"].startswith("/custom/prefix/rotated/") for r in REQUESTS[boundary:])
                boundary = len(REQUESTS)
                native.rpc("turn/start", {"threadId":sessions[0],"input":[{"type":"text","text":"Reply OK."}]})
                result = native.wait(lambda f:f.get("method") == "turn/completed")
                assert result["params"]["turn"]["status"] == "completed"
                assert REQUESTS[boundary:] and all(r["keyVersion"] == 1 and not r["path"].startswith("/custom/prefix/rotated/") for r in REQUESTS[boundary:])
                native.close()  # release the native writer before resuming its persisted thread
                resumed = rotated.rpc("thread/resume", {"threadId": sessions[-1], "cwd": str(root), "model": "rovai-unknown", "modelProvider": rotated_provider, "approvalPolicy": "never", "sandbox": "read-only"})
                assert resumed["modelProvider"] == rotated_provider and resumed["model"] == "rovai-unknown"
                boundary = len(REQUESTS)
                rotated.rpc("turn/start", {"threadId":sessions[-1],"input":[{"type":"text","text":"Reply OK."}]})
                result = rotated.wait(lambda f:f.get("method") == "turn/completed")
                assert result["params"]["turn"]["status"] == "completed"
                assert REQUESTS[boundary:] and all(r["keyVersion"] == 2 and r["path"].startswith("/custom/prefix/rotated/") for r in REQUESTS[boundary:])
            finally:
                rotated.close()
        native.close()
        if kind == "claude":
            # Reuse a shell-only credential without copying it into native settings.
            path = root / "claude/settings.json"
            data = json.loads(path.read_text())
            data["env"].pop("ANTHROPIC_AUTH_TOKEN")
            path.write_text(json.dumps(data))
            (root / "shell-credential-fixture").touch()
            shell = Native(helper, executable, root, config)
            try:
                shell.control("initialize")
                resolved, status = shell.control("get_settings"), shell.control("get_status")
                assert "ANTHROPIC_AUTH_TOKEN" not in resolved["effective"]["env"]
                rows = {row["label"]: row["value"] for section in status["sections"] for row in section["rows"]}
                assert rows["Auth token"] == "ANTHROPIC_AUTH_TOKEN"
                shell.send({"type":"user","session_id":rows["Session ID"],"message":{"role":"user","content":"Reply OK."},"parent_tool_use_id":None})
                assert not shell.wait(lambda f:f.get("type") == "result").get("is_error")
                assert FAKE_KEY not in path.read_text(), "shell credentials must not be copied into a file"
            finally:
                shell.close()
        # Switching modes selects an official route without rewriting the dormant API key.
        config_path = root / ("claude/settings.json" if kind == "claude" else "codex/config.toml")
        native_before = config_path.read_bytes()
        official = Native(helper, executable, root, {**config, "mode":"official_login"})
        try:
            if kind == "codex":
                official.rpc("initialize", {"clientInfo":{"name":"rovai_fixture","version":"1"}})
                official.send({"method":"initialized","params":{}})
                resolved = official.rpc("config/read", {"cwd":str(root),"includeLayers":False})["config"]
                assert resolved["model_provider"] == "openai"
                assert resolved["openai_base_url"] == "https://chatgpt.com/backend-api/codex"
                assert resolved["model"] != "rovai-unknown"
                account = official.rpc("account/read", {"refreshToken":False})
                assert account["account"] is None, "no native login in the isolated fixture"
            else:
                official.control("initialize")
                settings, status = official.control("get_settings"), official.control("get_status")
                for name in ["ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_API_KEY"]:
                    assert settings["effective"]["env"][name] == ""
                rows = {row["label"]:row["value"] for section in status["sections"] for row in section["rows"]}
                assert "Auth token" not in rows and "API key" not in rows and "Anthropic base URL" not in rows
            assert config_path.read_bytes() == native_before, "mode selection must not erase dormant API configuration"
        finally:
            official.close()
        requests = REQUESTS[start:]
        assert requests and all(r["keyMatches"] and r["path"].startswith("/custom/prefix/") for r in requests), requests
        if kind in ["claude", "codex"]:
            assert all(r["authHeader"] == "bearer" for r in requests)
        expected = {"claude": {"rovai-main"}, "codex": {"gpt-6.1-sol", "rovai-unknown"}}[kind]
        assert expected <= {r["model"] for r in requests}, requests
        assert all(r["nativeHeaderPreserved"] for r in requests)
        return {"runtime": kind, "status": "passed", "requests": requests}
    finally:
        native.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for kind in ["claude", "codex"]:
        parser.add_argument("--" + kind, type=Path)
    parser.add_argument("--helper", type=Path, default=Path("target/debug/examples/custom_api_native_fixture"))
    parser.add_argument("--fixture-root", type=Path, required=True, help="Explicit isolated acceptance directory")
    args = parser.parse_args()
    helper = args.helper.resolve()
    assert helper.is_file(), "build the native fixture helper first"
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Api)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        for kind in ["claude", "codex"]:
            executable = getattr(args, kind)
            if executable is None:
                continue
            directory = args.fixture_root.resolve() / (kind + "-native")
            directory.mkdir(parents=True, exist_ok=False)
            print("Isolated native fixture: " + str(directory), flush=True)
            try:
                result = run(kind, executable.resolve(), helper, directory, "http://127.0.0.1:" + str(server.server_port) + "/custom/prefix")
            except Exception:
                import traceback
                result = {"runtime":kind,"status":"failed","error":traceback.format_exc().replace(FAKE_KEY,"<fake-key>").replace(ROTATED_FAKE_KEY,"<rotated-fake-key>")}
            results.append(result)
            print(json.dumps(result,ensure_ascii=False),flush=True)
    finally:
        server.shutdown()
    assert results and all(result["status"] == "passed" for result in results), "native acceptance failed"


if __name__ == "__main__":
    main()
