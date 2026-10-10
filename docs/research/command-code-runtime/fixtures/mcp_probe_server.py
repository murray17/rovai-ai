#!/usr/bin/env python3
"""Minimal stdio MCP server for the isolated Command Code protocol probe."""

import json
import os
import sys
from pathlib import Path


def respond(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


log_path = Path(os.environ["MCP_PROBE_LOG"])
for line in sys.stdin:
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        continue
    method = request.get("method")
    if method:
        with log_path.open("a") as log:
            log.write(method + "\n")
    if "id" not in request:
        continue
    if method == "initialize":
        result = {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "rovai-probe", "version": "1.0.0"},
        }
    elif method == "tools/list":
        result = {
            "tools": [
                {
                    "name": "ping",
                    "description": "Return a fixed test marker.",
                    "inputSchema": {"type": "object", "properties": {}},
                }
            ]
        }
    elif method == "tools/call":
        result = {"content": [{"type": "text", "text": "ROVAI_MCP_PROBE_OK"}]}
    else:
        respond({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": "Unknown method"}})
        continue
    respond({"jsonrpc": "2.0", "id": request["id"], "result": result})
