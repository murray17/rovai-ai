"""Manual Core/native-session acceptance; scripted loopback provider, no model evaluation."""
import argparse
import asyncio
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shlex
import sqlite3
import subprocess
import sys
import uuid

# Reuse the existing isolated provider and bounded Core RPC fixture.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native-auto-memory/fixtures"))
import probe as p

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--baseline-core", required=True, type=Path)
parser.add_argument("--candidate-core", required=True, type=Path)
parser.add_argument("--codex", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
options = parser.parse_args()
os.umask(0o077)
root = options.out.resolve()
root.mkdir(mode=0o700)  # Never reuse an existing fixture.
project, native, host, data, skills = [root / name for name in ("project", "native", "host", "data", "skills")]
for directory in (project, native, host, data, skills):
    directory.mkdir(mode=0o700)
codex = str(options.codex.resolve(strict=True))
environment = p.BASE | {"HOME": str(host), "CODEX_HOME": str(native)}
p.put(native / "config.toml", f'''model = "gpt-5.4"
model_provider = "fixture"
[model_providers.fixture]
name = "fixture"
base_url = "{p.URL}/v1"
wire_api = "responses"
requires_openai_auth = false
[projects.{json.dumps(str(project))}]
trust_level = "trusted"
''')
p.put(project / ".git/HEAD", "ref: refs/heads/main\n")
old_instruction = "Commands accept exactly one input source:"
new_help = "Input: direct flags, or --input-file <path> with send flags except --body."
requests = []


class ObservedProvider(p.Provider):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        text = body.decode("utf-8")
        requests.append({"oldCharter": old_instruction in text, "newHelp": new_help in text})
        self.rfile = io.BytesIO(body)
        super().do_POST()


p.server.RequestHandlerClass = ObservedProvider
key = "v1-" + hashlib.sha256(b"rovai-runtime-camp-files-instance-v1\0" + str(data).encode()).hexdigest()
core_args = ["--data-dir", str(data), "--skill-library-root", str(skills),
             "--mcp-config-path", str(data / "mcp.json"),
             "--runtime-camp-files-root", str(host / ".rovai/instances" / key / "runtime-files")]


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as binary:
        for chunk in iter(lambda: binary.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


evidence = {
    "platform": platform.platform(), "provider": "scripted loopback; no real model or credentials",
    "codexVersion": subprocess.check_output([codex, "--version"], env=environment, text=True, timeout=15).strip(),
    "binarySha256": {label: digest(path.resolve(strict=True)) for label, path in {
        "baselineCore": options.baseline_core, "candidateCore": options.candidate_core,
        "baselineCli": options.baseline_core.parent / "rovai", "candidateCli": options.candidate_core.parent / "rovai",
        "codex": Path(codex)}.items()},
    "phases": [],
}


async def main():
    rpc = await p.RPC().start([str(options.baseline_core.resolve(strict=True)), *core_args], environment, project, initialize=False)
    try:
        await rpc.call("health.check", {})
        await rpc.call("runtime.startup.save", {"runtimeKind": "codex-cli", "expectedRevision": 0,
            "configuration": {"programPath": codex, "environment": [
                {"name": name, "value": str(value)} for name, value in [("HOME", host), ("CODEX_HOME", native)]]}})
        assert (await rpc.call("runtime.product.check", {"runtimeKind": "codex-cli"}))["ready"]
        member = await rpc.call("members.get", {"agentId": "agent_2"})
        assigned = await rpc.call("members.runtime.set", {"commandId": str(uuid.uuid4()), "command": {
            "agentId": "agent_2", "expectedVersion": member["version"], "adapterKind": "codex-cli",
            "model": {"mode": "runtime_default"}, "permissions": {"adapterKind": "codex-cli", "schemaVersion": 1,
                "values": {"sandbox_mode": "danger-full-access", "approval_policy": "never"}}}})
        assert assigned["status"] == "applied", assigned
        created = await rpc.call("threads.create", {"commandId": str(uuid.uuid4()), "name": "Send file acceptance",
            "workspace": {"projectPath": str(project)}, "memberAgentIds": ["agent_2"],
            "defaultLeadAgentId": "agent_2", "collaborationMode": "peer"})
        assert created["status"] == "applied", created
        thread_id = created["payload"]["threadId"]
        seen, original_binding, original_bootstrap = set(), None, None
        for phase in ("baseline-json", "restored-json-and-new-help", "body-after-help"):
            if phase == "restored-json-and-new-help":
                await rpc.close()
                rpc = await p.RPC().start([str(options.candidate_core.resolve(strict=True)), *core_args], environment, project, initialize=False)
                await rpc.call("health.check", {})
            body = (" 中文 🌸\r\n# Send body file\n\n\"quote\" `code` \\path\nLiteral \\n; real newline follows.\n"
                    if phase == "body-after-help" else "Legacy JSON: " + phase + "\n中文 🌸")
            input_file = root / (phase + ".txt")
            input_file.write_bytes(body.encode("utf-8") if phase == "body-after-help"
                                   else json.dumps({"body": body, "publicOnly": True}).encode("utf-8"))
            args = ["send", "--input-file", str(input_file)]
            if phase == "body-after-help":
                args.insert(1, "--public-only")
            receipt_file = root / (phase + "-receipt.json")
            helper = root / (phase + ".py")
            p.put(helper, f'''import json, os, subprocess
from pathlib import Path
command = [os.environ["ROVAI_AGENT_CLI"]]
sent = subprocess.run(command + {args!r}, capture_output=True, text=True, timeout=10)
assert sent.returncode == 0, (sent.returncode, sent.stdout, sent.stderr)
result = json.loads(sent.stdout)
assert result.get("messageId"), result
assert result["effectiveRecipients"] == [] and result["deliveryIds"] == [], result
Path({str(receipt_file)!r}).write_text(json.dumps(result))
print(sent.stdout)
if {phase == "restored-json-and-new-help"!r}:
    help_text = subprocess.check_output(command + ["send", "--help"], text=True, timeout=10)
    assert {new_help!r} in help_text
    print(help_text)
''')
            p.managed_tool_command = shlex.quote(sys.executable) + " " + shlex.quote(str(helper))
            p.managed_tool_pending = True
            before = len(requests)
            sent = await rpc.call("thread.messages.send", {"commandId": str(uuid.uuid4()), "threadId": thread_id,
                "content": {"version": 2, "segments": [{"kind": "text", "text": "CORE_NATIVE_PROBE " + phase}]},
                "sourceAttachments": [], "quotes": [], "replyToThreadMessageId": None,
                "execution": {"taskId": None, "purpose": "Isolated Send file acceptance", "completionRole": "required"}})
            assert sent.get("commandResult", sent)["status"] == "accepted", sent
            for _ in range(180):
                snapshot = await rpc.call("camps.snapshot", {"threadId": thread_id})
                run = next((value for value in snapshot["agentRuns"] if value["id"] not in seen), None)
                if run and run["status"] in ("succeeded", "failed", "cancelled"):
                    break
                await asyncio.sleep(.5)
            assert run and run["status"] == "succeeded", run
            seen.add(run["id"])
            receipt = json.loads(receipt_file.read_text())
            published = [message for message in snapshot["messages"] if message.get("sourceAgentRunId") in seen]
            matches = [message for message in published if message["id"] == receipt["messageId"]]
            assert len(matches) == 1 and matches[0]["body"] == body, matches
            assert len(published) == len(seen), "Unexpected extra publication"
            with closing(sqlite3.connect(f"file:{data / 'rovai.sqlite'}?mode=ro", uri=True)) as database:
                binding = database.execute("SELECT native_session_id,native_binding_id,native_binding_generation FROM conversation WHERE id=?",
                                           (run["conversationId"],)).fetchone()
                bootstrap = database.execute("SELECT id,session_charter_blob_id,session_charter_digest FROM native_session_bootstrap_evidence WHERE conversation_id=?",
                                             (run["conversationId"],)).fetchall()
            assert binding and all(binding) and len(bootstrap) == 1 and all(bootstrap[0])
            if original_binding is None:
                original_binding, original_bootstrap = binding, bootstrap
            assert binding == original_binding and bootstrap == original_bootstrap
            observed = requests[before:]
            assert observed and all(request["oldCharter"] for request in observed)
            if phase == "body-after-help":
                assert all(request["newHelp"] for request in observed)
            result = {"phase": phase, "status": run["status"], "sameNativeBinding": True, "sameFrozenBootstrap": True,
                "nativeSessionId": binding[0], "nativeBindingId": binding[1], "nativeBindingGeneration": binding[2],
                "bootstrapEvidenceId": bootstrap[0][0], "sessionCharterDigest": bootstrap[0][2],
                "exactBodyReadback": True, "publishedCount": len(published), "receiptMessageId": receipt["messageId"],
                "bodySha256": hashlib.sha256(body.encode()).hexdigest(), "providerRequests": observed}
            evidence["phases"].append(result)
            p.put(root / "evidence.json", json.dumps(evidence, indent=2, ensure_ascii=False))
            print(json.dumps(result, ensure_ascii=False), flush=True)
    finally:
        await rpc.close()
        p.server.shutdown()


asyncio.run(main())
