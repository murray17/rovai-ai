"""Launcher/control regressions; --native-skills adds isolated native discovery."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

HOST = Path(__file__).resolve().parents[1] / "crates/rovai-core/src/hermes/host.py"
spec = importlib.util.spec_from_file_location("hermes_controller", HOST)
host = importlib.util.module_from_spec(spec)
# Loading these boundary tests needs no installed Hermes. Native YAML parsing
# and MCP discovery are exercised by the isolated experience smoke.
with patch.dict(sys.modules, {"hermes_yaml": types.ModuleType("hermes_yaml")}):
    spec.loader.exec_module(host)


class DirectAcp(unittest.TestCase):
    def test_official_acp_owns_protocol_pipes_without_observation_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            (home / "gateway.lock").write_text(json.dumps({"pid": 42, "hermes_home": str(home)}))
            runtime = types.SimpleNamespace(
                attachable=lambda found: found is not None,
                discover_gateway_endpoint=Mock(side_effect=[None, types.SimpleNamespace(endpoint=types.SimpleNamespace(supervisor="external"))]))
            gateway = Mock(pid=42)
            gateway.poll.return_value = None
            with patch.dict(sys.modules, {"hermes_cli.gateway_runtime": runtime}), \
                 patch.dict(os.environ, {"ROVAI_HERMES_LAUNCHER": "/native/hermes"}), \
                 patch.object(host, "prepare_home", return_value=home), \
                 patch.object(host.subprocess, "Popen", return_value=gateway) as start, \
                 patch.object(host.runpy, "run_module") as official, patch.object(sys, "argv", []):
                host.serve()
                official.assert_called_once_with("hermes_cli.main", run_name="__main__", alter_sys=True)
                self.assertEqual(sys.argv, ["hermes", "--profile", "default", "acp"])
                self.assertEqual(start.call_count, 1)
                gateway.terminate.assert_called_once()


class OfficialControls(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_recovery_is_exact_explicit_control_without_prompt(self):
        for case in ("inspect", "resolve", "terminal", "no_ack", "wrong_generation", "wrong_session",
                     "queued", "running", "approval", "multiple", "wrong_after"):
            with self.subTest(case=case):
                c = host.Control.__new__(host.Control)
                c.native = AsyncMock()
                receipt = {"ref": {"session_id": "session"}, "admission_id": "admission",
                           "execution_generation": 2, "status": "unknown", "outcome": None}
                snapshot = {"session_id": "session", "pending": [receipt]}
                params = {"sessionId": "session", "admissionId": "admission",
                          "executionGeneration": 2, "acknowledgeEffects": True}
                if case == "inspect": params = {"sessionId": "session"}
                if case == "no_ack": params["acknowledgeEffects"] = False
                if case == "wrong_generation": params["executionGeneration"] = 3
                if case == "wrong_session": receipt["ref"]["session_id"] = "another"
                if case == "queued": receipt["status"] = "queued"
                if case == "running": snapshot["running"] = True
                if case == "approval": snapshot["prompts"] = [{"id": "permission"}]
                if case == "multiple": snapshot["pending"] = [receipt, dict(receipt, admission_id="other")]
                if case == "terminal":
                    receipt.update(status="terminal", outcome="completed")
                    snapshot["pending"] = []
                async def rpc(method, **args):
                    self.assertEqual(args["session_id"], "session")
                    if method == "session.resume": return snapshot
                    if method == "prompt.receipt" and args["admission_id"] == "other": return dict(receipt, admission_id="other")
                    self.assertEqual(args["admission_id"], "admission")
                    if method == "prompt.receipt": return receipt
                    self.assertEqual(method, "prompt.resolve_unknown")
                    self.assertEqual(args["execution_generation"], 2)
                    receipt.update(status="terminal", outcome="interrupted")
                    snapshot["pending"] = []
                    if case == "wrong_after": snapshot["session_id"] = "another"
                    return receipt
                c.rpc = types.SimpleNamespace(rpc=AsyncMock(side_effect=rpc))
                async def read_snapshot(session): return await rpc("session.resume", session_id=session)
                c.read_snapshot = AsyncMock(side_effect=read_snapshot)
                if case in ("inspect", "resolve", "terminal"):
                    result = await c.recover_unknown(params)
                    self.assertEqual(result["sessionId"], "session")
                    if case == "inspect": self.assertEqual(result["receipts"][0]["status"], "unknown")
                    else: self.assertEqual(result["receipt"]["status"], "terminal")
                else:
                    with self.assertRaises(host.Rejected): await c.recover_unknown(params)
                calls = [call.args[0] for call in c.rpc.rpc.call_args_list]
                self.assertEqual(calls.count("prompt.resolve_unknown"), int(case in ("resolve", "wrong_after")))
                c.native.assert_not_called()

                if case in ("queued", "running", "approval", "multiple"):
                    inspected = await c.recover_unknown({"sessionId": "session"})
                    self.assertEqual(inspected["state"], "unknown" if case == "multiple" else case)
                    self.assertTrue(inspected["receipts"])
                    c.native.assert_not_called()


    async def test_restore_state_only_defers_mcp_changes_for_real_native_blockers(self):
        for state, extra in (("idle", {}), ("running", {"running": True}),
                             ("approval", {"prompts": [{"id": "approval"}]}),
                             ("unknown", {"pending": [{"status": "unknown"}]}),
                             ("queued", {"pending": [{"status": "queued"}]})):
            with self.subTest(state=state):
                snapshot = {"session_id": "original", "revision": 1, "execution_generation": 2, **extra}
                rpc = AsyncMock(side_effect=[snapshot, {"mcp_servers": []}])
                c = host.Control(types.SimpleNamespace(rpc=rpc))
                result = await c.prepare_session({"sessionId": "original", "mcpServers": []})
                self.assertEqual(result, {"sessionId": "original", "state": state})
                self.assertEqual([call.args[0] for call in rpc.call_args_list],
                    ["session.resume"] + (["session.mutate"] if state == "idle" else []))
                if state == "idle":
                    self.assertEqual(rpc.call_args.kwargs["payload"], {"mcp_servers": []})
                    self.assertEqual(rpc.call_args.kwargs["expected_revision"], 1)
                    self.assertEqual(rpc.call_args.kwargs["expected_generation"], 2)

        # A normally returned subset is usable; an absent/malformed response or
        # an uncertain revoke is not evidence that the assignment was applied.
        for requested, response, missing in (
                (["good", "broken"], {"mcp_servers": ["good"]}, ["broken"]),
                (["broken"], {"mcp_servers": []}, ["broken"]),
                (["good"], {"mcp_servers": ["good"]}, []),
                ([], {"mcp_servers": []}, []),
                ([], {}, None), ([], {"mcp_servers": ["old"]}, None),
                (["good"], {"mcp_servers": None}, None),
                (["good"], {"mcp_servers": "good"}, None),
                (["good"], {"mcp_servers": [1]}, None),
                (["good"], None, None),
                (["good"], ConnectionError("connection lost"), None),
                ([], RuntimeError("revision_conflict"), None)):
            with self.subTest(requested=requested, response=response):
                snapshot = {"session_id": "original", "revision": 4, "execution_generation": 7}
                rpc = AsyncMock(side_effect=[snapshot, response])
                c = host.Control(types.SimpleNamespace(rpc=rpc))
                servers = [{"name": name} for name in requested]
                if missing is None:
                    with self.assertRaises(type(response) if isinstance(response, Exception) else host.Rejected):
                        await c.prepare_session({"sessionId": "original", "mcpServers": servers})
                else:
                    result = await c.prepare_session({"sessionId": "original", "mcpServers": servers})
                    self.assertEqual(result["sessionId"], "original")
                    self.assertEqual(result["state"], "idle")
                    self.assertEqual(result.get("missingMcpServers", []), missing)
                    self.assertEqual([server["name"] for server in servers], requested)
                self.assertEqual([call.args[0] for call in rpc.call_args_list], ["session.resume", "session.mutate"])
                self.assertEqual(rpc.call_args.kwargs["expected_revision"], 4)
                self.assertEqual(rpc.call_args.kwargs["expected_generation"], 7)

    async def test_steer_targets_native_generation_and_never_retries(self):
        for response in ({"status": "queued", "execution_generation": 7}, {"status": "rejected", "delivered": False}, ConnectionError("lost")):
            rpc = AsyncMock(side_effect=[{"session_id": "original", "running": True, "execution_generation": 7}, response])
            c = host.Control(types.SimpleNamespace(rpc=rpc))
            if isinstance(response, Exception):
                with self.assertRaises(ConnectionError):
                    await c.steer({"sessionId": "original", "text": "supplement"})
            else:
                self.assertEqual((await c.steer({"sessionId": "original", "text": "supplement"}))["accepted"], response.get("status") == "queued")
            self.assertEqual(rpc.call_args.kwargs["execution_generation"], 7)
            self.assertEqual([call.args[0] for call in rpc.call_args_list], ["session.resume", "session.steer"])

    def test_binding_keeps_native_home_when_launch_environment_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            first, second, storage = root / "first", root / "second", root / "storage"
            first.mkdir(); second.mkdir()
            dependencies = root / "dependencies"
            dependencies.mkdir()
            (first / "installs").symlink_to(dependencies, target_is_directory=True)
            (first / "config.yaml").write_text('{"agent":{"system_prompt":"original-profile"}}')
            (second / "config.yaml").write_text('{"agent":{"system_prompt":"different-profile"}}')
            modules = {"dotenv": types.SimpleNamespace(dotenv_values=lambda _: {}),
                       "hermes_cli": types.SimpleNamespace(__file__=str(root / "package/hermes_cli/__init__.py"))}
            with patch.dict(sys.modules, modules), patch.object(host, "yaml", types.SimpleNamespace(safe_load=json.loads, safe_dump=lambda value, **_: json.dumps(value))):
                for source in (first, second, second):
                    with patch.dict(os.environ, {"HERMES_HOME": str(source), "ROVAI_HERMES_STORAGE": str(storage), "ROVAI_HERMES_COMPACTION_HOOK": "owned-observer"}):
                        home = host.prepare_home()
                        self.assertEqual(home, storage / "native-home")
                        self.assertEqual(json.loads((home / "config.yaml").read_text())["hooks"]["post_compaction"], [{"command": "owned-observer", "timeout": 5}])
                        self.assertEqual(json.loads((home / "config.yaml").read_text())["agent"]["system_prompt"], "original-profile")
                        self.assertEqual(json.loads((storage / "native-source.json").read_text()), {"home": str(first), "profile": "default"})
                    # Legacy storage has no marker and can contain a symlink
                    # to a Home whose installs is itself another symlink.
                    (storage / "native-source.json").unlink()
                    (home / "state.db").touch()
                (home / "installs").unlink()
                (home / "auth.json").write_text('{}')
                with patch.dict(os.environ, {"HERMES_HOME": str(second), "ROVAI_HERMES_STORAGE": str(storage)}):
                    home = host.prepare_home()
                    self.assertEqual(json.loads((home / "config.yaml").read_text())["agent"]["system_prompt"], "original-profile")
                    self.assertEqual(json.loads((storage / "native-source.json").read_text())["home"], str(home))
                    self.assertFalse((home / "auth.lock").is_symlink())

    def test_home_preserves_sparse_config_and_normalizes_only_rewritten_sections(self):
        preserved = {
            "agent": {"system_prompt": "${NATIVE_PROMPT}", "disabled_toolsets": ["custom", "clarify"]},
            "hooks": {"post_compaction": [{"command": "user-hook", "future_field": "${KEEP}"},
                                         {"command": "owned-observer", "timeout": 5}],
                      "future_event": {"opaque": None}},
            "memory": {"future_option": False}, "display": {"personality": "native"},
            "unknown_section": {"expression": "${KEEP}", "empty": None},
        }
        cases = [("missing", None, None), ("empty", "", None),
                 ("comment", "# native config\n", None), ("null", "null\n", None),
                 ("preserved", json.dumps(preserved), preserved)]
        for key in ("gateway", "auxiliary", "memory", "agent", "terminal", "skills", "hooks"):
            cases.append((key, json.dumps({key: None}), {key: None}))
        for value in ({"auxiliary": {"title_generation": None, "background_review": None}},
                      {"agent": {"disabled_toolsets": None}}, {"hooks": {"post_compaction": None}},
                      {"agent": {"disabled_toolsets": "custom"}},
                      {"agent": {"disabled_toolsets": '["custom"]'}}):
            cases.append((str(value), json.dumps(value), value))
        for value in (False, 0, [], "scalar", {"gateway": False}, {"auxiliary": {"title_generation": []}}):
            cases.append(("invalid-type", json.dumps(value), value))
        cases += [("invalid-yaml", "agent: [", ValueError("secret source line")),
                  ("hook-disabled", '{"hooks":"native-future-format"}', {"hooks": "native-future-format"})]
        skill_cases = [
            ({"external_dirs": "extra-skills"}, ["extra-skills"], None),
            ({"external_dirs": ["extra-skills"]}, ["extra-skills"], None),
            ({"external_dirs": [" extra-skills ", "", " \t "]}, ["extra-skills"], None),
            ({"external_dirs": [""]}, [], None),
            ({"external_dirs": ' ["one", "two"] '}, ['["one", "two"]'], None),
            ({"external_dirs": [None, 1, False]}, ["None", "1", "False"], None),
            ({"external_dirs": ["~/skill-fixture", "${ROVAI_SKILL_FIXTURE}/extra"]},
             [str(Path.home() / "skill-fixture"), "expanded/extra"], None),
            ({"create_dir": "  created-skills \t"}, None, "created-skills"),
            ({"create_dir": " \t "}, None, " \t "),
            ({"external_dirs": None, "create_dir": None}, None, None),
            ({"external_dirs": {"future": "value"}, "create_dir": False}, {"future": "value"}, False),
        ]
        for index, (skills, _, _) in enumerate(skill_cases):
            value = {"skills": {**skills, "future_option": "${KEEP}"}}
            cases.append((f"skills-{index}", json.dumps(value), value))
        for name, source_text, parsed in cases:
            with self.subTest(case=name, source=source_text), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                source, storage = root / "source", root / "storage"
                source.mkdir()
                (source / "skills").mkdir()
                config_path = source / "config.yaml"
                if source_text is not None:
                    config_path.write_text(source_text)
                load = Mock(side_effect=parsed) if isinstance(parsed, Exception) else Mock(return_value=parsed)
                native_list = Mock(return_value=["custom"])
                modules = {"dotenv": types.SimpleNamespace(dotenv_values=lambda _: {}),
                           "hermes_cli": types.SimpleNamespace(__file__=str(root / "package/hermes_cli/__init__.py")),
                           "agent.skill_utils": types.SimpleNamespace(parse_config_string_list=native_list)}
                yaml = types.SimpleNamespace(safe_load=load, safe_dump=lambda value, **_: json.dumps(value), YAMLError=ValueError)
                env = {"HERMES_HOME": str(source), "ROVAI_HERMES_STORAGE": str(storage),
                       "ROVAI_SKILL_FIXTURE": "expanded",
                       "ROVAI_HERMES_COMPACTION_HOOK": "" if name == "hook-disabled" else "owned-observer"}
                for _ in range(2):
                    with patch.dict(sys.modules, modules), patch.object(host, "yaml", yaml), patch.dict(os.environ, env):
                        if name.startswith("invalid"):
                            with self.assertRaisesRegex(host.Rejected, "configuration") as error:
                                host.prepare_home()
                            self.assertNotIn("secret source line", str(error.exception))
                        else:
                            home = host.prepare_home()
                            result = json.loads((home / "config.yaml").read_text())
                            self.assertEqual(result["gateway"]["auto_resume"], False)
                            self.assertEqual(result["auxiliary"]["background_review"]["enabled"], False)
                            self.assertEqual(result["memory"]["memory_enabled"], False)
                            for toolset in ("clarify", "cronjob"):
                                self.assertEqual(result["agent"]["disabled_toolsets"].count(toolset), 1)
                            if name == "hook-disabled":
                                self.assertEqual(result["hooks"], parsed["hooks"])
                            else:
                                self.assertEqual(sum(h.get("command") == "owned-observer" for h in result["hooks"]["post_compaction"]), 1)
                            if name == "preserved":
                                for key in ("hooks", "display", "unknown_section"):
                                    self.assertEqual(result[key], preserved[key])
                                self.assertEqual(result["agent"]["system_prompt"], "${NATIVE_PROMPT}")
                                self.assertIn("custom", result["agent"]["disabled_toolsets"])
                            if isinstance(parsed, dict) and isinstance((parsed.get("agent") or {}).get("disabled_toolsets"), str):
                                native_list.assert_called_with(parsed["agent"]["disabled_toolsets"])
                                self.assertIn("custom", result["agent"]["disabled_toolsets"])
                            self.assertNotIn("model", result)  # No expanded native defaults.
                            self.assertTrue((home / "skills").is_symlink())
                            self.assertEqual((home / "skills").resolve(), source / "skills")
                            if name.startswith("skills-"):
                                raw, external, create = skill_cases[int(name.split("-")[1])]
                                if isinstance(external, list):
                                    external = [str(source / value) for value in external]
                                if isinstance(create, str) and create.strip():
                                    create = str(source / create)
                                self.assertEqual(result["skills"].get("external_dirs"), external)
                                self.assertEqual(result["skills"].get("create_dir"), create)
                                self.assertEqual(result["skills"]["future_option"], "${KEEP}")
                                for key in ("external_dirs", "create_dir"):
                                    self.assertEqual(key in result["skills"], key in raw)
                                native_list.assert_not_called()
                    self.assertEqual(config_path.read_text() if config_path.exists() else None, source_text)
                    if source_text is None:
                        load.assert_not_called()
                    else:
                        load.assert_called_with(source_text)

def check_native_skills():
    """Run only via the installed Hermes interpreter, using new isolated Homes."""
    import hermes_yaml
    from tools.skills_tool import find_all_skills
    from agent.skill_utils import get_external_skills_dirs, get_skill_create_dir
    host.yaml = hermes_yaml
    cases = [("extra-skills", None, True, False),
             (["extra-skills"], None, True, False),
             ([" extra-skills "], None, True, False),
             ([""], None, False, False),
             (None, " created-skills \t", False, True),
             (None, " \t ", False, False),
             (["${ROVAI_SKILL_FIXTURE}"], None, True, False)]
    with tempfile.TemporaryDirectory(prefix="rovai-hermes-skills-") as directory:
        root = Path(directory).resolve()
        for index, (external, create, has_external, has_create) in enumerate(cases):
            source, storage = root / f"source-{index}", root / f"storage-{index}"
            for parent, name in (("skills", "local-fixture"), ("extra-skills", "external-fixture"),
                                 ("created-skills", "create-fixture"), ("", "home-only-fixture")):
                skill = source / parent / name
                skill.mkdir(parents=True)
                (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Isolated discovery fixture\n---\nUse fixture only.\n")
            original = json.dumps({"skills": {"external_dirs": external, "create_dir": create,
                                               "future_option": "${KEEP}"}})
            (source / "config.yaml").write_text(original)
            with patch.dict(os.environ, {"HERMES_HOME": str(source), "ROVAI_HERMES_STORAGE": str(storage),
                                         "ROVAI_SKILL_FIXTURE": "extra-skills", "ROVAI_HERMES_COMPACTION_HOOK": ""}):
                home = host.prepare_home()
                expected = {"local-fixture"}
                if has_external:
                    expected.add("external-fixture")
                if has_create:
                    expected.add("create-fixture")
                assert {skill["name"] for skill in find_all_skills()} == expected, (index, "native discovery")
                assert get_external_skills_dirs() == ([source / "extra-skills"] if has_external else [])
                assert get_skill_create_dir() == (source / "created-skills" if has_create else None)
                assert (source / "config.yaml").read_text() == original
                assert (home / "skills").is_symlink() and (home / "skills").resolve() == source / "skills"
                # Re-preparation follows the binding's recorded origin, even if
                # the process environment now points to another native Home.
                os.environ["HERMES_HOME"] = str(root / "another-home")
                assert host.prepare_home() == home
                assert {skill["name"] for skill in find_all_skills()} == expected
                assert (source / "config.yaml").read_text() == original
        print(f"Native Skills discovery: {len(cases)} cases passed; source config and links preserved")


if __name__ == "__main__":
    if "--native-skills" in sys.argv:
        check_native_skills()
    else:
        unittest.main()
