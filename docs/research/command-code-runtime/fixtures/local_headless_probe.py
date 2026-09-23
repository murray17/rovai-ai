#!/usr/bin/env python3
"""Exercise a Command Code CLI against a local model fixture and isolated HOME.

This checks native wire behavior only. The dummy account key is confined to the
subprocess with CMD_LOCAL_ONLY=1; it is not a real login or admission evidence.
"""

import argparse
import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class FixtureServer(ThreadingHTTPServer):
    scenario = "text"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        size = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(size))
        roles = [message.get("role") for message in request.get("messages", [])]
        if self.server.scenario == "bootstrap":
            system_messages = [
                message for message in request.get("messages", []) if message.get("role") == "system"
            ]
            marker_seen = "BOOTSTRAP_MARKER" in json.dumps(system_messages)
            response_text = "BOOTSTRAP_SEEN" if marker_seen else "BOOTSTRAP_MISSING"
        else:
            response_text = "PROBE_OK"
        if self.server.scenario in ("text", "bootstrap") or "tool" in roles:
            chunks = [
                {"index": 0, "delta": {"role": "assistant", "content": response_text}, "finish_reason": None},
                {"index": 0, "delta": {}, "finish_reason": "stop"},
            ]
        else:
            names = [tool.get("function", {}).get("name") for tool in request.get("tools", [])]
            if "shell_command" not in names:
                self.send_error(400, "shell_command unavailable")
                return
            command = (
                "touch ./mutation-probe"
                if self.server.scenario == "mutation"
                else "printf COMMAND_CODE_TOOL_MARKER"
            )
            chunks = [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "fixture-tool-1",
                                "type": "function",
                                "function": {
                                    "name": "shell_command",
                                    "arguments": json.dumps({"command": command}),
                                },
                            }
                        ],
                    },
                    "finish_reason": None,
                },
                {"index": 0, "delta": {}, "finish_reason": "tool_calls"},
            ]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for choice in chunks:
            frame = {
                "id": "fixture-1",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "fixture",
                "choices": [choice],
            }
            self.wfile.write(b"data: " + json.dumps(frame).encode() + b"\n\n")
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")


def invoke(cli, home, workspace, *, auth, resume=None, yolo=False, mod=None):
    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "CMD_LOCAL_ONLY": "1",
            "DO_NOT_TRACK": "1",
            "COMMANDCODE_SKIP_UPDATES": "1",
        }
    )
    env.pop("COMMAND_CODE_API_KEY", None)
    if auth:
        env["COMMAND_CODE_API_KEY"] = "local-fixture"
    args = [
        str(cli),
        "-p",
        "Reply PROBE_OK only",
        "--output-format",
        "json",
        "--model",
        "probe/fixture",
        "--no-auto-update",
        "--permission-mode",
        "dont-ask",
        "--trust",
        "--skip-onboarding",
        "--max-turns",
        "3",
    ]
    if yolo:
        args.append("--yolo")
    if resume:
        args.extend(["--resume", resume])
    if mod:
        args.extend(["--mod", str(mod)])
    process = subprocess.run(
        args,
        cwd=workspace,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    frames = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
    results = [frame for frame in frames if frame.get("type") == "result"]
    assert len(results) == 1, "expected exactly one native result frame"
    events = [frame["event"] for frame in frames if frame.get("type") == "event"]
    return process.returncode, results[0], events


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True, type=Path, help="absolute Command Code bin path")
    args = parser.parse_args()
    cli = args.cli.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="rovai-command-code-probe-") as temporary:
        root = Path(temporary)
        home = root / "home"
        workspace = root / "workspace"
        config = home / ".commandcode"
        config.mkdir(parents=True)
        workspace.mkdir()
        with FixtureServer(("127.0.0.1", 0), Handler) as server:
            server_thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            (config / "providers.json").write_text(
                json.dumps(
                    {
                        "provider": {
                            "probe": {
                                "baseURL": f"http://127.0.0.1:{server.server_port}/v1",
                                "apiKey": False,
                                "models": {"fixture": {"contextWindow": 128000}},
                            }
                        }
                    }
                )
            )
            (config / "settings.json").write_text(
                json.dumps({"tasteLearning": False, "permissions": {"defaultMode": "dont-ask"}})
            )

            unauthorized = invoke(cli, home, workspace, auth=False)
            assert unauthorized[0] == 3 and unauthorized[1]["subtype"] == "error"
            assert "sessionId" not in unauthorized[1]

            first = invoke(cli, home, workspace, auth=True)
            assert first[0] == 0 and first[1]["subtype"] == "success"
            session_id = first[1]["sessionId"]
            resumed = invoke(cli, home, workspace, auth=True, resume=session_id)
            assert resumed[0] == 0 and resumed[1]["sessionId"] == session_id
            wrong = invoke(
                cli, home, workspace, auth=True, resume="00000000-0000-4000-8000-000000000001"
            )
            assert wrong[0] == 1 and wrong[1]["subtype"] == "error" and not wrong[2]

            server.scenario = "shell"
            blocked = invoke(cli, home, workspace, auth=True)
            blocked_tools = [event["type"] for event in blocked[2] if event["type"].startswith("tool_")]
            assert blocked_tools == ["tool_queued", "tool_hook_blocked"]
            allowed = invoke(cli, home, workspace, auth=True, yolo=True)
            allowed_tools = [event["type"] for event in allowed[2] if event["type"].startswith("tool_")]
            assert allowed_tools == ["tool_queued", "tool_running", "tool_update", "tool_completed"]
            assert "COMMAND_CODE_TOOL_MARKER" in json.dumps(allowed[2])

            server.scenario = "mutation"
            denied = invoke(cli, home, workspace, auth=True, yolo=True)
            denied_tools = [event["type"] for event in denied[2] if event["type"].startswith("tool_")]
            assert denied_tools == ["tool_queued", "tool_denied"]
            assert not (workspace / "mutation-probe").exists()

            server.scenario = "bootstrap"
            valid_mod = root / "bootstrap.mjs"
            valid_mod.write_text(
                'export default function (cmd) { cmd.hooks({ appendSystemPrompt: () => "BOOTSTRAP_MARKER" }); }\n'
            )
            bootstrap = invoke(cli, home, workspace, auth=True, mod=valid_mod)
            assert bootstrap[0] == 0 and bootstrap[1]["finalText"] == "BOOTSTRAP_SEEN"
            resumed_bootstrap = invoke(
                cli, home, workspace, auth=True, resume=bootstrap[1]["sessionId"], mod=valid_mod
            )
            assert resumed_bootstrap[0] == 0
            assert resumed_bootstrap[1]["finalText"] == "BOOTSTRAP_SEEN"
            failing_mod = root / "failing-bootstrap.mjs"
            failing_mod.write_text(
                'export default function (cmd) { cmd.hooks({ appendSystemPrompt: () => { throw new Error("fixture hook failure"); } }); }\n'
            )
            failed_bootstrap = invoke(cli, home, workspace, auth=True, mod=failing_mod)
            missing_mod = invoke(cli, home, workspace, auth=True, mod=root / "missing-bootstrap.mjs")

            memory_file = config / "AGENTS.md"
            memory_file.write_text("BOOTSTRAP_MARKER\n")
            memory_bootstrap = invoke(cli, home, workspace, auth=True)
            assert memory_bootstrap[1]["finalText"] == "BOOTSTRAP_SEEN"
            memory_resume = invoke(
                cli, home, workspace, auth=True, resume=memory_bootstrap[1]["sessionId"]
            )
            assert memory_resume[1]["finalText"] == "BOOTSTRAP_SEEN"
            memory_file.unlink()
            missing_memory_resume = invoke(
                cli, home, workspace, auth=True, resume=memory_bootstrap[1]["sessionId"]
            )
            server.shutdown()
            server_thread.join(timeout=5)
            print(
                json.dumps(
                    {
                        "unauthorizedExit": unauthorized[0],
                        "firstEventTypes": [event["type"] for event in first[2]],
                        "exactResume": resumed[1]["sessionId"] == session_id,
                        "unknownResumeExit": wrong[0],
                        "blockedToolEvents": blocked_tools,
                        "allowedToolEvents": allowed_tools,
                        "deniedToolEvents": denied_tools,
                        "deniedMutationLeftNoFile": True,
                        "bootstrapLoaded": bootstrap[1]["finalText"],
                        "bootstrapAfterResume": resumed_bootstrap[1]["finalText"],
                        "failingMod": {
                            "exit": failed_bootstrap[0],
                            "finalText": failed_bootstrap[1].get("finalText"),
                            "eventTypes": [event["type"] for event in failed_bootstrap[2]],
                        },
                        "missingMod": {
                            "exit": missing_mod[0],
                            "finalText": missing_mod[1].get("finalText"),
                            "eventTypes": [event["type"] for event in missing_mod[2]],
                        },
                        "privateHomeMemory": memory_bootstrap[1]["finalText"],
                        "privateHomeMemoryAfterResume": memory_resume[1]["finalText"],
                        "privateHomeMemoryAfterDelete": missing_memory_resume[1]["finalText"],
                    },
                    ensure_ascii=False,
                )
            )


if __name__ == "__main__":
    main()
