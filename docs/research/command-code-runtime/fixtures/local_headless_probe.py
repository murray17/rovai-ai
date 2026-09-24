#!/usr/bin/env python3
"""Exercise a Command Code CLI against a local model fixture and isolated HOME.

This checks native wire behavior only. The dummy account key is confined to the
subprocess with CMD_LOCAL_ONLY=1; it is not a real login or admission evidence.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class FixtureServer(ThreadingHTTPServer):
    scenario = "text"
    prompt_guidance_requests = []
    mcp_request_tool_names = []
    mcp_tool_result_has_probe = []
    mcp_tool_result_has_marker = []
    mcp_call_attempted = False


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
        if self.server.scenario == "mcp":
            tools = request.get("tools", [])
            tool_messages = [message for message in request.get("messages", []) if message.get("role") == "tool"]
            tool_results = json.dumps(tool_messages[-1]) if tool_messages else ""
            self.server.mcp_request_tool_names.append(
                [tool.get("function", {}).get("name", "") for tool in tools]
            )
            self.server.mcp_tool_result_has_probe.append(
                "mcp__rovai-probe__ping" in tool_results
            )
            self.server.mcp_tool_result_has_marker.append(
                "ROVAI_MCP_PROBE_OK" in tool_results
            )
        if self.server.scenario == "prompt_guidance":
            messages = request.get("messages", [])
            user_messages = [message for message in messages if message.get("role") == "user"]
            latest_user = json.dumps(user_messages[-1]) if user_messages else ""
            history = json.dumps(messages)
            self.server.prompt_guidance_requests.append(
                {
                    "messageCount": len(messages),
                    "userCount": len(user_messages),
                    "latestUserHasBootstrap": "BOOTSTRAP_MARKER" in latest_user,
                    "latestUserHasFirstInput": "DYNAMIC_MARKER_ONE" in latest_user,
                    "latestUserHasSecondInput": "DYNAMIC_MARKER_TWO" in latest_user,
                    "historyHasBootstrap": "BOOTSTRAP_MARKER" in history,
                    "systemHasBootstrap": "BOOTSTRAP_MARKER"
                    in json.dumps([message for message in messages if message.get("role") == "system"]),
                }
            )
        if self.server.scenario == "bootstrap":
            system_messages = [
                message for message in request.get("messages", []) if message.get("role") == "system"
            ]
            marker_seen = "BOOTSTRAP_MARKER" in json.dumps(system_messages)
            response_text = "BOOTSTRAP_SEEN" if marker_seen else "BOOTSTRAP_MISSING"
        else:
            response_text = "PROBE_OK"
        if (
            self.server.scenario == "mcp"
            and "mcp__rovai-probe__ping" in tool_results
            and "ROVAI_MCP_PROBE_OK" not in tool_results
            and not self.server.mcp_call_attempted
        ):
            self.server.mcp_call_attempted = True
            chunks = [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "fixture-mcp-1",
                                "type": "function",
                                "function": {"name": "mcp__rovai-probe__ping", "arguments": "{}"},
                            }
                        ],
                    },
                    "finish_reason": None,
                },
                {"index": 0, "delta": {}, "finish_reason": "tool_calls"},
            ]
        elif self.server.scenario in ("text", "bootstrap") or "tool" in roles:
            chunks = [
                {"index": 0, "delta": {"role": "assistant", "content": response_text}, "finish_reason": None},
                {"index": 0, "delta": {}, "finish_reason": "stop"},
            ]
        elif self.server.scenario == "mcp":
            chunks = [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "fixture-search-1",
                                "type": "function",
                                "function": {
                                    "name": "search_tools",
                                    "arguments": json.dumps({"query": "rovai-probe ping"}),
                                },
                            }
                        ],
                    },
                    "finish_reason": None,
                },
                {"index": 0, "delta": {}, "finish_reason": "tool_calls"},
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


def invoke(
    cli, home, workspace, *, auth, resume=None, yolo=False, mod=None,
    prompt="Reply PROBE_OK only", max_turns=3, permission_mode="dont-ask",
):
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
        prompt,
        "--output-format",
        "json",
        "--model",
        "probe/fixture",
        "--no-auto-update",
        "--permission-mode",
        permission_mode,
        "--trust",
        "--skip-onboarding",
        "--max-turns",
        str(max_turns),
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
            server.scenario = "prompt_guidance"
            first_guidance = invoke(
                cli,
                home,
                workspace,
                auth=True,
                prompt="[SESSION_CHARTER]\nBOOTSTRAP_MARKER\n[/SESSION_CHARTER]\n\nDYNAMIC_MARKER_ONE",
            )
            assert first_guidance[0] == 0 and first_guidance[1]["subtype"] == "success"
            first_guidance_requests = list(server.prompt_guidance_requests)
            second_guidance = invoke(
                cli,
                home,
                workspace,
                auth=True,
                resume=first_guidance[1]["sessionId"],
                prompt="DYNAMIC_MARKER_TWO",
            )
            assert second_guidance[0] == 0 and second_guidance[1]["subtype"] == "success"
            assert second_guidance[1]["sessionId"] == first_guidance[1]["sessionId"]
            second_guidance_requests = server.prompt_guidance_requests[len(first_guidance_requests):]
            assert first_guidance_requests and second_guidance_requests
            assert all(
                request["latestUserHasBootstrap"]
                and request["latestUserHasFirstInput"]
                and not request["systemHasBootstrap"]
                for request in first_guidance_requests
            )
            assert all(
                request["latestUserHasSecondInput"]
                and not request["latestUserHasBootstrap"]
                and request["historyHasBootstrap"]
                and not request["systemHasBootstrap"]
                for request in second_guidance_requests
            )
            other_home = root / "other-home"
            other_config = other_home / ".commandcode"
            other_config.mkdir(parents=True)
            (other_config / "providers.json").write_text((config / "providers.json").read_text())
            (other_config / "settings.json").write_text((config / "settings.json").read_text())
            cross_home_resume = invoke(
                cli,
                other_home,
                workspace,
                auth=True,
                resume=first_guidance[1]["sessionId"],
                prompt="DYNAMIC_MARKER_TWO",
            )
            assert cross_home_resume[0] == 1 and cross_home_resume[1]["subtype"] == "error"
            assert not cross_home_resume[2]
            independent_home = invoke(cli, other_home, workspace, auth=True)
            assert independent_home[0] == 0
            assert independent_home[1]["sessionId"] != first_guidance[1]["sessionId"]
            mcp_log = root / "mcp-probe.log"
            (config / "mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "rovai-probe": {
                                "transport": "stdio",
                                "command": sys.executable,
                                "args": [str(Path(__file__).with_name("mcp_probe_server.py"))],
                                "env": {"MCP_PROBE_LOG": str(mcp_log)},
                            }
                        }
                    }
                )
            )
            server.scenario = "mcp"
            server.mcp_call_attempted = False
            mcp_denied = invoke(
                cli, home, workspace, auth=True,
                prompt="List tools, then reply PROBE_OK", max_turns=8,
            )
            denied_mcp_events = [event["type"] for event in mcp_denied[2]]
            assert mcp_denied[0] == 0 and "tool_denied" in denied_mcp_events, (
                mcp_denied[0], mcp_denied[1].get("subtype"), denied_mcp_events,
            )
            assert "tools/call" not in mcp_log.read_text().splitlines()
            server.mcp_request_tool_names.clear()
            server.mcp_tool_result_has_probe.clear()
            server.mcp_tool_result_has_marker.clear()
            server.mcp_call_attempted = False
            mcp_home_a = invoke(
                cli, home, workspace, auth=True, yolo=True, permission_mode="yolo",
                prompt="List tools, then reply PROBE_OK", max_turns=8
            )
            assert mcp_home_a[0] == 0, (
                mcp_home_a[0], mcp_home_a[1].get("subtype"),
                [event["type"] for event in mcp_home_a[2]],
            )
            home_a_tools = list(server.mcp_request_tool_names)
            home_a_probe_results = list(server.mcp_tool_result_has_probe)
            home_a_marker_results = list(server.mcp_tool_result_has_marker)
            server.mcp_call_attempted = False
            mcp_home_b = invoke(
                cli, other_home, workspace, auth=True, prompt="List tools, then reply PROBE_OK", max_turns=8
            )
            assert mcp_home_b[0] == 0
            home_b_tools = server.mcp_request_tool_names[len(home_a_tools):]
            home_b_probe_results = server.mcp_tool_result_has_probe[len(home_a_probe_results):]
            home_b_marker_results = server.mcp_tool_result_has_marker[len(home_a_marker_results):]
            mcp_methods = mcp_log.read_text().splitlines() if mcp_log.exists() else []
            assert "tools/list" in mcp_methods and "tools/call" in mcp_methods
            assert (
                any(home_a_probe_results)
                and any(home_a_marker_results)
                and not any(home_b_probe_results)
                and not any(home_b_marker_results)
            ), json.dumps(
                {
                    "homeAToolNames": home_a_tools,
                    "homeBToolNames": home_b_tools,
                    "homeAProbeResults": home_a_probe_results,
                    "homeBProbeResults": home_b_probe_results,
                    "homeAMarkerResults": home_a_marker_results,
                    "homeBMarkerResults": home_b_marker_results,
                    "mcpMethods": mcp_methods,
                }
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
                        "firstPayloadGuidance": {
                            "firstInputRequests": first_guidance_requests,
                            "resumedInputRequests": second_guidance_requests,
                        },
                        "crossHomeResumeRejected": True,
                        "otherHomeNewSessionDistinct": True,
                        "privateHomeMcp": {
                            "dontAskDeniedWithoutCall": True,
                            "homeAProbeResults": home_a_probe_results,
                            "homeBProbeResults": home_b_probe_results,
                            "homeAMarkerResults": home_a_marker_results,
                            "homeBMarkerResults": home_b_marker_results,
                            "methods": mcp_methods,
                        },
                    },
                    ensure_ascii=False,
                )
            )


if __name__ == "__main__":
    main()
