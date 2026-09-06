"""Pure grouping boundary matrix; all persistence/integrity checks also run on each offline copy."""
import importlib.util
from pathlib import Path
import sys
import unittest
import tempfile
import sqlite3

spec = importlib.util.spec_from_file_location("aggregate_execution_text", Path(__file__).with_name("aggregate-execution-text.py"))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Boundaries(unittest.TestCase):
    def test_in_place_lock_refuses_live_core_and_can_be_reacquired(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "rovai.sqlite"
            with module.offline_core_lock(database):
                with self.assertRaises(BlockingIOError):
                    with module.offline_core_lock(database):
                        self.fail("must not acquire a live Core lock")
            with module.offline_core_lock(database):
                self.assertTrue(database.with_name(".rovai-core-instance.lock").is_file())

    def test_backup_is_readable_while_source_retains_exclusive_sqlite_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.sqlite"
            source = sqlite3.connect(source_path)
            backup = sqlite3.connect(Path(directory) / "backup.sqlite")
            source.execute("CREATE TABLE example(value)")
            source.execute("INSERT INTO example VALUES(7)")
            source.commit()
            source.execute("PRAGMA locking_mode=EXCLUSIVE")
            source.execute("BEGIN EXCLUSIVE")
            source.commit()
            source.backup(backup)
            self.assertEqual(backup.execute("SELECT value FROM example").fetchone()[0], 7)
            outsider = sqlite3.connect(source_path, timeout=0)
            with self.assertRaises(sqlite3.OperationalError):
                outsider.execute("INSERT INTO example VALUES(8)")
            outsider.close()
            backup.close()
            source.close()

    def test_native_items_and_anonymous_segments_never_mix_or_lose_intermediate_text(self):
        rows = [
            {"event_type": "agent.text.delta", "payload": {"itemId": "A", "delta": "A partial"}},
            {"event_type": "runtime.action", "payload": {"toolCallId": "tool"}},
            {"event_type": "agent.text.delta", "payload": {"itemId": "B", "delta": "B partial"}},
            {"event_type": "activity.completed", "payload": {"item": {"type": "agentMessage", "id": "A", "text": "A complete"}}},
            {"event_type": "activity.completed", "payload": {"item": {"type": "agentMessage", "id": "B", "text": "B complete"}}},
            {"event_type": "agent.thought.delta", "payload": {"delta": "thought"}},
            {"event_type": "agent.text.delta", "payload": {"delta": "C partial"}},
            {"event_type": "activity.completed", "payload": {"item": {"type": "reasoning", "id": "R", "summary": ["summary one", "summary two"]}}},
        ]
        blocks = module.blocks_for_run(rows, "failed")
        self.assertEqual([b.text() for b in blocks], ["A complete", "B complete", "thought", "summary one\nsummary two", "C partial"])
        self.assertEqual(blocks[-1].status, "interrupted")
        self.assertIs(blocks[0].rows[0], rows[0])
        self.assertIs(blocks[1].rows[0], rows[2])
        self.assertFalse(any(rows[1] is r for b in blocks for r in b.rows))
        acp_rows = [{"event_type": "agent.text.delta", "payload": {
            "itemId": None, "messageId": identity, "delta": text}}
            for identity, text in [("A", "A1"), ("B", "B1"), ("A", "A2")]]
        acp = module.blocks_for_run(acp_rows, "failed")
        self.assertEqual([(b.native, b.text(), b.status) for b in acp],
            [("A", "A1A2", "interrupted"), ("B", "B1", "interrupted")])
        self.assertEqual(module.native_identity({"itemId": None, "toolCallId": "R"}, "reasoning_summary"), "R")


if __name__ == "__main__":
    unittest.main()
