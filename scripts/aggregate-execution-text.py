#!/usr/bin/env python3
"""Offline, opt-in Evidence text compaction. Never opens Core or touches event_log.

Default operation creates a new private copy, leaving the input and all old blobs intact.
Only closed Runs and understood text records are eligible; referenced Evidence is retained.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
from contextlib import contextmanager
from dataclasses import dataclass, field

DELTAS = {
    "agent.text.delta": "narration",
    "agent.thought.delta": "thought",
    "agent.reasoning.summary.delta": "reasoning_summary",
}
EVENTS = {k: e.replace(".delta", ".block") for e, k in DELTAS.items()}
BOUNDARIES = {"runtime.action", "activity.started", "activity.completed", "runtime.plan", "runtime.compaction.display", *EVENTS.values()}
LIMIT = 8 * 1024 * 1024


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def native_identity(payload, kind):
    fields = ["itemId", "messageId"] + (["toolCallId"] if kind != "narration" else [])
    return next((payload[field] for field in fields
        if isinstance(payload.get(field), str) and payload[field].strip()), None)


@dataclass
class Block:
    kind: str
    native: str | None
    rows: list = field(default_factory=list)
    chunks: list = field(default_factory=list)
    complete: str | None = None
    status: str = "interrupted"

    def text(self):
        return self.complete if self.complete is not None else "".join(self.chunks)


def blocks_for_run(rows, status):
    """Same boundaries as execution_text: native item identity, otherwise contiguous text."""
    active, finished, starts = {}, [], {}

    def close_anonymous(except_kind=None):
        for key in list(active):
            if key[1] is None and key[0] != except_kind:
                block = active.pop(key)
                block.status = "completed"
                finished.append(block)

    for row in rows:
        p, event = row["payload"], row["event_type"]
        item = p.get("item") or {}
        native_kind = {"agentMessage": "narration", "reasoning": "reasoning_summary"}.get(item.get("type"))
        if event == "activity.started" and native_kind:
            starts.setdefault((native_kind, item.get("id")), []).append(row)
            continue
        if event in DELTAS:
            kind = DELTAS[event]
            native = native_identity(p, kind)
            close_anonymous(kind if native is None else None)
            key = (kind, native)
            text = p.get("delta")
            if not isinstance(text, str):
                text = p.get("text", (p.get("content") or {}).get("text", ""))
            if not isinstance(text, str) or not text:
                continue
            block = active.setdefault(key, Block(kind, native))
            block.rows.append(row)
            block.chunks.append(text)
        elif event == "activity.completed" and native_kind:
            key = (native_kind, item.get("id"))
            block = active.pop(key, Block(*key))
            block.rows.append(row)
            text = item.get("text")
            if not isinstance(text, str) and isinstance(item.get("summary"), list):
                text = "\n".join(v if isinstance(v, str) else v.get("text", "") for v in item["summary"])
            if isinstance(text, str) and text:
                block.complete = text
            block.status = "interrupted" if item.get("status") in {"failed", "interrupted", "cancelled", "aborted", "error"} else "completed"
            block.rows.extend(starts.pop(key, []))
            finished.append(block)
        elif event in BOUNDARIES:
            close_anonymous()
    for key, block in active.items():
        block.status = "completed" if status == "succeeded" else "interrupted"
        block.rows.extend(starts.pop(key, []))
        finished.append(block)
    return finished


def blob_payload(db, blob_root, row):
    if not row["content_blob_id"]:
        return json.loads(row["payload_preview_json"])
    blob = db.execute("SELECT sha256,byte_size,storage_relative_path FROM managed_blob WHERE id=?", (row["content_blob_id"],)).fetchone()
    if not blob:
        raise ValueError("missing Blob metadata")
    path = (blob_root / blob[2]).resolve(strict=True)
    if not path.is_relative_to(blob_root.resolve(strict=True)):
        raise ValueError("Blob path escapes source root")
    data = path.read_bytes()
    if len(data) != blob[1] or digest(data) != blob[0]:
        raise ValueError("Blob integrity mismatch")
    return json.loads(data)


def table_digest(db, table):
    result = hashlib.sha256()
    for row in db.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
        result.update(encoded(list(row)))
        result.update(b"\n")
    return result.hexdigest()


def compact(db, blob_root):
    db.row_factory = sqlite3.Row
    protected = set()
    for table in ("canonical_runtime_activity", "agent_run_file_change_projection"):
        for row in db.execute(f"SELECT source_evidence_ids_json FROM {table}"):
            protected.update(json.loads(row[0]))
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for table in tables:
        for fk in db.execute(f'PRAGMA foreign_key_list("{table}")'):
            if fk[2] == "agent_run_execution_evidence":
                protected.update(r[0] for r in db.execute(f'SELECT "{fk[3]}" FROM "{table}" WHERE "{fk[3]}" IS NOT NULL'))
    # Immutable tool projections and sealed channel snapshots must stay byte-for-byte identical.
    invariants = {table: table_digest(db, table) for table in (
        "event_log", "canonical_runtime_activity", "agent_run_file_change_projection", "channel_execution_console",
    )}
    before = db.execute("SELECT count(*),sum(content_byte_count) FROM agent_run_execution_evidence").fetchone()
    tools_before = hashlib.sha256()
    removed, saved, skipped, byte_saved = 0, 0, 0, 0
    proofs = []
    db.execute("BEGIN IMMEDIATE")
    try:
        runs = db.execute("SELECT id,status FROM agent_run WHERE status IN ('succeeded','failed','cancelled') ORDER BY id").fetchall()
        for run in runs:
            epochs = db.execute("SELECT DISTINCT execution_epoch FROM agent_run_execution_evidence WHERE agent_run_id=? ORDER BY execution_epoch", (run[0],)).fetchall()
            for epoch in epochs:
                rows = []
                for raw in db.execute("SELECT * FROM agent_run_execution_evidence WHERE agent_run_id=? AND execution_epoch=? ORDER BY sequence", (run[0], epoch[0])):
                    row = dict(raw)
                    # Unknown records stay untouched. Any unreadable eligible Blob aborts this copy.
                    if row["event_type"] in DELTAS or row["event_type"] in ("activity.started", "activity.completed"):
                        row["payload"] = blob_payload(db, blob_root, row)
                    else:
                        row["payload"] = {}
                    rows.append(row)
                eligible = set()
                for block in blocks_for_run(rows, run[1]):
                    text = block.text()
                    if not text or len(text.encode()) > LIMIT or any(r["id"] in protected for r in block.rows):
                        skipped += 1
                        continue
                    # Native starts are removed only with their actual text block. Position is the
                    # first delta (or completion-only result), exactly as new streaming ingress.
                    first = min((r for r in block.rows if r["event_type"] != "activity.started"), key=lambda r: r["sequence"])
                    payload = {"blockId": first["id"], "itemId": first["id"], "nativeItemId": block.native,
                        "text": text, "status": block.status, "textLength": len(text.encode("utf-16-le")) // 2,
                        "blockStartedAt": first["occurred_at"]}
                    full = encoded(payload)
                    if len(full) > 64 * 1024 * 1024:
                        skipped += 1
                        continue
                    blob_id = None
                    preview = dict(payload)
                    if len(full) > 16384:
                        sha = digest(full)
                        relative = f"sha256/{sha[:2]}/{sha}"
                        path = blob_root / relative
                        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                        if path.exists():
                            if digest(path.read_bytes()) != sha:
                                raise ValueError("existing output Blob corrupt")
                        else:
                            with path.open("xb") as output:
                                os.chmod(path, 0o600)
                                output.write(full)
                                output.flush()
                                os.fsync(output.fileno())
                        blob_id = f"blob-sha256-{sha}"
                        db.execute("INSERT OR IGNORE INTO managed_blob(id,sha256,byte_size,media_type,storage_relative_path,state,sensitivity,created_at,verified_at,updated_at) VALUES(?,?,?,'application/json',?,'present','sensitive',?,?,?)", (blob_id, sha, len(full), relative, first["occurred_at"], first["occurred_at"], first["occurred_at"]))
                        preview["text"] = text[:4000]
                    for row in block.rows:
                        eligible.add(row["id"])
                        if row["id"] != first["id"]:
                            db.execute("DELETE FROM agent_run_execution_evidence WHERE id=?", (row["id"],))
                            removed += 1
                    native_key = "text-block:" + json.dumps(["", epoch[0], block.kind, block.native], ensure_ascii=False, separators=(",", ":")) if block.native else None
                    db.execute("UPDATE agent_run_execution_evidence SET event_type=?,kind=?,phase=?,source_event_key=?,payload_preview_json=?,content_blob_id=?,content_byte_count=?,is_truncated=? WHERE id=?", (EVENTS[block.kind], "reasoning_summary" if block.kind == "thought" else block.kind, "completed" if block.status == "completed" else "failed", native_key, encoded(preview).decode(), blob_id, len(full), int(blob_id is not None), first["id"]))
                    proofs.append((first["id"], first["sequence"], digest(text.encode()), block.status))
                    saved += 1
                    byte_saved += sum(r["content_byte_count"] for r in block.rows) - len(full)
                # Check every non-eligible row, including real tools, against the frozen input.
                for row in rows:
                    if row["id"] in eligible:
                        continue
                    after = db.execute("SELECT * FROM agent_run_execution_evidence WHERE id=?", (row["id"],)).fetchone()
                    original = {k: v for k, v in row.items() if k != "payload"}
                    if after is None or dict(after) != original:
                        raise ValueError("non-text Evidence changed")
                    tools_before.update(encoded(original))
        for evidence_id, sequence, sha, status in proofs:
            row = dict(db.execute("SELECT * FROM agent_run_execution_evidence WHERE id=?", (evidence_id,)).fetchone())
            p = blob_payload(db, blob_root, row)
            if row["sequence"] != sequence or digest(p["text"].encode()) != sha or p["status"] != status:
                raise ValueError("text/sequence/status verification failed")
        for table, sha in invariants.items():
            if table_digest(db, table) != sha:
                raise ValueError(f"protected table changed: {table}")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("foreign key check failed")
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return {"beforeRows": before[0], "afterRows": before[0] - removed, "blocksSaved": saved,
        "removedRows": removed, "skippedBlocks": skipped, "logicalBytesSaved": byte_saved,
        "preservedRowsDigest": tools_before.hexdigest(), "protectedTables": invariants,
        "verifiedTextBlocks": len(proofs)}


@contextmanager
def offline_core_lock(source_db):
    """Use the exact same advisory flock as Core; never remove/replace the lock inode."""
    if os.name != "posix":
        raise ValueError("in-place mode currently requires a POSIX Core instance lock")
    import fcntl
    lock = source_db.parent / ".rovai-core-instance.lock"
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Core lock is not a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def copy_blobs(source, target):
    # Do not follow an unexpected symlink into unrelated private files during backup.
    for directory, dirs, files in os.walk(source, followlinks=False):
        if any((Path(directory) / name).is_symlink() for name in dirs + files):
            raise ValueError("Blob tree contains a symlink; manual inspection required")
    shutil.copytree(source, target, symlinks=True)


def run(args):
    args.output_dir.mkdir(mode=0o700)
    output_db = args.output_dir / "rovai.sqlite"
    source = sqlite3.connect(args.source_db.as_uri() + ("?mode=rw" if args.apply_in_place else "?mode=ro"), timeout=0)
    target = sqlite3.connect(output_db)
    try:
        if args.apply_in_place:
            # Block non-Core SQLite writers too, including between backup and compaction.
            source.execute("PRAGMA locking_mode=EXCLUSIVE")
            source.execute("BEGIN EXCLUSIVE")
            source.commit()
        source.backup(target)
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("backup integrity check failed; source not compacted")
        copy_blobs(args.source_blobs, args.output_dir / "managed-blobs")
        selected_db = args.source_db if args.apply_in_place else output_db
        selected_blobs = args.source_blobs if args.apply_in_place else args.output_dir / "managed-blobs"
        selected = source if args.apply_in_place else target
        before_bytes = selected_db.stat().st_size
        report = compact(selected, selected_blobs)
        selected.execute("VACUUM")
        if selected.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("post-compaction integrity check failed; restore from retained backup")
        report.update({"beforeFileBytes": before_bytes, "afterFileBytes": selected_db.stat().st_size,
            "outputDatabase": str(selected_db), "sourceUntouched": not args.apply_in_place,
            "backupDatabase": str(output_db) if args.apply_in_place else None})
        (args.output_dir / "report.json").write_bytes(encoded(report))
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        target.close()
        source.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-db", type=Path, required=True)
    p.add_argument("--source-blobs", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--apply-in-place", action="store_true", help="explicitly compact the source; output-dir becomes a full recovery backup")
    p.add_argument("--confirm-compatible-app", action="store_true", help="operator confirms a text-block-compatible daily App is already installed")
    args = p.parse_args()
    if not all(path.is_absolute() for path in (args.source_db, args.source_blobs, args.output_dir)):
        p.error("all paths must be absolute")
    if args.output_dir.exists():
        p.error("output directory must not exist; original backup is never reused")
    if not args.source_db.is_file() or not args.source_blobs.is_dir():
        p.error("source database and Blob directory must already exist")
    if args.source_db.resolve() != args.source_db or args.source_blobs.resolve() != args.source_blobs:
        p.error("source paths must be canonical, not symlinks")
    if args.output_dir.is_relative_to(args.source_blobs) or args.output_dir == args.source_db.parent:
        p.error("output directory must be separate from the source database and Blob tree")
    if args.apply_in_place and not args.confirm_compatible_app:
        p.error("in-place mode requires --confirm-compatible-app after isolated acceptance and installation")
    os.umask(0o077)
    if args.apply_in_place:
        with offline_core_lock(args.source_db):
            run(args)
    else:
        run(args)


if __name__ == "__main__":
    main()
