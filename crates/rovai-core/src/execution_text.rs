//! Execution text has one durable position per message, not one row per transport frame.
//! The Database owner serializes ingress, reads and terminal settlement. Only accepted bytes
//! live here; terminal flush is therefore allowed after cancellation without admitting late input.
use crate::{
    db::Database,
    execution_evidence::{AgentRunExecutionEvidence, RecordedExecutionEvidence},
    managed_blob::ManagedBlobStore,
    read_model::AgentRunExecutionEvidenceView,
};
use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
};
use uuid::Uuid;

const MEMORY_BYTES: usize = 64 * 1024;
// JSON escaping can expand every byte sixfold; remain below the existing 64 MiB Blob limit.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_OPEN_BLOCKS: usize = 128;

#[derive(Default)]
pub(crate) struct ExecutionTextBuffer {
    blocks: BTreeMap<String, TextBlock>,
}

struct TextBlock {
    id: String,
    run: String,
    epoch: i64,
    native_id: Option<String>,
    kind: String,
    sequence: i64,
    started_at: String,
    body: Body,
    utf16_len: usize,
}

#[derive(Default)]
struct Body {
    memory: String,
    spool: Option<(File, PathBuf)>,
    bytes: usize,
    truncated: bool,
}

impl Body {
    fn append(&mut self, root: &std::path::Path, text: &str) -> Result<()> {
        let (text, truncated) = bounded_text(text, MAX_BODY_BYTES.saturating_sub(self.bytes));
        self.truncated |= truncated;
        if self.spool.is_none() && self.bytes + text.len() > MEMORY_BYTES {
            let directory = root.join("managed-blobs/tmp");
            std::fs::create_dir_all(&directory)?;
            let path = directory.join(format!("execution-text-{}", Uuid::new_v4()));
            let mut options = OpenOptions::new();
            options.create_new(true).read(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&path)?;
            if let Err(error) = file.write_all(self.memory.as_bytes()) {
                drop(file);
                let _ = std::fs::remove_file(path);
                return Err(error.into());
            }
            self.memory.clear();
            self.memory.shrink_to_fit();
            self.spool = Some((file, path));
        }
        if let Some((file, _)) = &mut self.spool {
            file.seek(SeekFrom::End(0))?;
            if let Err(error) = file.write_all(text.as_bytes()) {
                // Do not let a partially written UTF-8 frame corrupt all previously accepted text.
                file.set_len(self.bytes as u64)?;
                self.truncated = true;
                return Err(error.into());
            }
        } else {
            self.memory.push_str(text);
        }
        self.bytes += text.len();
        Ok(())
    }
    fn text(&self) -> Result<String> {
        if let Some((file, _)) = &self.spool {
            let mut reader = file.try_clone()?;
            reader.seek(SeekFrom::Start(0))?;
            let mut text = String::with_capacity(self.bytes);
            reader
                .take(MAX_BODY_BYTES as u64 + 1)
                .read_to_string(&mut text)?;
            Ok(text)
        } else {
            Ok(self.memory.clone())
        }
    }
}

fn bounded_text(text: &str, maximum: usize) -> (&str, bool) {
    if text.len() <= maximum {
        return (text, false);
    }
    let mut end = maximum;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}
impl Drop for Body {
    fn drop(&mut self) {
        if let Some((file, path)) = self.spool.take() {
            drop(file);
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(crate) fn is_text_delta(event: &str) -> bool {
    matches!(
        event,
        "agent.text.delta" | "agent.thought.delta" | "agent.reasoning.summary.delta"
    )
}
fn event_kind(event: &str) -> &str {
    if event.starts_with("agent.text") {
        "narration"
    } else if event.starts_with("agent.thought") {
        "thought"
    } else {
        "reasoning_summary"
    }
}
fn block_event(kind: &str) -> &'static str {
    match kind {
        "narration" => "agent.text.block",
        "thought" => "agent.thought.block",
        _ => "agent.reasoning.summary.block",
    }
}
fn key(run: &str, epoch: i64, kind: &str, native: Option<&str>) -> String {
    serde_json::to_string(&(run, epoch, kind, native)).expect("string tuple")
}
fn source_key(epoch: i64, kind: &str, native: &str) -> String {
    format!("text-block:{}", key("", epoch, kind, Some(native)))
}

fn admitted(database: &Database, run: &str, epoch: i64) -> Result<bool> {
    Ok(database.connection().query_row("SELECT EXISTS(SELECT 1 FROM agent_run WHERE id=?1 AND execution_epoch=?2 AND status IN ('running','waiting') AND cancel_requested_at IS NULL)", params![run, epoch], |r| r.get(0))?)
}

impl TextBlock {
    fn payload(&self, text: String, status: &str) -> Value {
        json!({"blockId":self.id,"itemId":self.id,"nativeItemId":self.native_id,
            "text":text,"status":status,"textLength":self.utf16_len,"blockStartedAt":self.started_at,
            "contentLimitExceeded":self.body.truncated})
    }
    fn event(&self, payload: Value, phase: &str) -> AgentRunExecutionEvidence {
        AgentRunExecutionEvidence {
            id: self.id.clone(),
            agent_run_id: self.run.clone(),
            execution_epoch: self.epoch,
            sequence: self.sequence,
            event_type: block_event(&self.kind).into(),
            kind: if self.kind == "thought" {
                "reasoning_summary".into()
            } else {
                self.kind.clone()
            },
            phase: phase.into(),
            content_byte_count: payload.to_string().len() as i64,
            payload,
            content_blob_id: None,
            is_truncated: false,
            occurred_at: self.started_at.clone(),
            canonical: None,
        }
    }
}

// Some(None) means a handled, non-public native boundary; None means ordinary tool Evidence.
pub(crate) fn observe(
    database: &mut Database,
    store: &ManagedBlobStore,
    run: &str,
    epoch: i64,
    event: &str,
    payload: &Value,
) -> Result<Option<Option<RecordedExecutionEvidence>>> {
    let native_type = payload.pointer("/item/type").and_then(Value::as_str);
    let native_text = matches!(native_type, Some("agentMessage" | "reasoning"));
    let completion =
        event == "agent.text.completed" || (event == "activity.completed" && native_text);
    let boundary = event == "agent.text.boundary";
    if !admitted(database, run, epoch)? {
        return Ok(
            if is_text_delta(event) || native_text || completion || boundary {
                Some(None)
            } else {
                None
            },
        );
    }
    let mut buffer = std::mem::take(&mut database.execution_text);
    let result = (|| {
        if is_text_delta(event) {
            let kind = event_kind(event);
            let native = payload
                .get("itemId")
                .or_else(|| {
                    (kind != "narration")
                        .then(|| payload.get("toolCallId"))
                        .flatten()
                })
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty());
            // Anonymous protocol output is segmented at changes of text kind and semantic boundaries.
            let close: Vec<_> = buffer
                .blocks
                .iter()
                .filter(|(_, b)| {
                    b.run == run
                        && b.epoch == epoch
                        && b.native_id.is_none()
                        && (native.is_some() || b.kind != kind)
                })
                .map(|(k, _)| k.clone())
                .collect();
            for k in close {
                finish(database, store, &mut buffer, &k, None, "completed")?;
            }
            let text = payload
                .get("delta")
                .and_then(Value::as_str)
                .or_else(|| payload.get("text").and_then(Value::as_str))
                .or_else(|| payload.pointer("/content/text").and_then(Value::as_str))
                .unwrap_or("");
            if text.is_empty() {
                return Ok(Some(None));
            }
            let k = key(run, epoch, kind, native);
            if !buffer.blocks.contains_key(&k) {
                anyhow::ensure!(
                    buffer.blocks.len() < MAX_OPEN_BLOCKS,
                    "Too many unfinished Execution text items (limit 128)"
                );
                if let Some(native) = native {
                    let exists: bool = database.connection().query_row("SELECT EXISTS(SELECT 1 FROM agent_run_execution_evidence WHERE agent_run_id=?1 AND execution_epoch=?2 AND source_event_key=?3)", params![run,epoch,source_key(epoch,kind,native)], |r|r.get(0))?;
                    if exists {
                        return Ok(Some(None));
                    }
                }
                let block = start(database, run, epoch, kind, native)?;
                buffer.blocks.insert(k.clone(), block);
            }
            let block = buffer.blocks.get_mut(&k).expect("created block");
            let offset = block.utf16_len;
            block.body.append(
                database.path().parent().context("database directory")?,
                text,
            )?;
            block.utf16_len += text.encode_utf16().count();
            let mut live = block.event(
                json!({"itemId":block.id,"blockId":block.id,"delta":text,
                "textOffset":offset,"blockStartedAt":block.started_at}),
                "updated",
            );
            live.id = format!("{}:delta:{offset}", block.id);
            live.event_type = event.into();
            return Ok(Some(Some(RecordedExecutionEvidence {
                evidence: live,
                inserted: false,
            })));
        }
        if completion {
            let kind = if native_type == Some("reasoning") {
                "reasoning_summary"
            } else {
                "narration"
            };
            let native = payload
                .pointer("/item/id")
                .or_else(|| payload.get("itemId"))
                .and_then(Value::as_str);
            let k = key(run, epoch, kind, native);
            let complete_text = payload
                .pointer("/item/text")
                .or_else(|| payload.get("text"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    payload
                        .pointer("/item/summary")
                        .and_then(Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|v| {
                                    v.as_str().or_else(|| v.get("text").and_then(Value::as_str))
                                })
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                })
                .filter(|text| !text.is_empty());
            if !buffer.blocks.contains_key(&k) {
                anyhow::ensure!(
                    buffer.blocks.len() < MAX_OPEN_BLOCKS,
                    "Too many unfinished Execution text items (limit 128)"
                );
                if complete_text.as_ref().is_none_or(|s| s.is_empty()) {
                    return Ok(Some(None));
                }
                if let Some(native) = native {
                    let exists: bool = database.connection().query_row("SELECT EXISTS(SELECT 1 FROM agent_run_execution_evidence WHERE agent_run_id=?1 AND execution_epoch=?2 AND source_event_key=?3)", params![run,epoch,source_key(epoch,kind,native)], |r|r.get(0))?;
                    if exists {
                        return Ok(Some(None));
                    }
                }
                buffer
                    .blocks
                    .insert(k.clone(), start(database, run, epoch, kind, native)?);
            }
            let status = match payload
                .pointer("/item/status")
                .or_else(|| payload.get("status"))
                .and_then(Value::as_str)
            {
                Some("failed" | "interrupted" | "cancelled" | "aborted" | "error") => "interrupted",
                _ => "completed",
            };
            return Ok(Some(finish(
                database,
                store,
                &mut buffer,
                &k,
                complete_text.as_deref(),
                status,
            )?));
        }
        if event == "activity.started" && native_text {
            return Ok(Some(None));
        }
        if boundary
            || matches!(
                event,
                "runtime.action"
                    | "activity.started"
                    | "activity.completed"
                    | "runtime.plan"
                    | "runtime.compaction.display"
            )
        {
            let keys: Vec<_> = buffer
                .blocks
                .iter()
                .filter(|(_, b)| b.run == run && b.epoch == epoch && b.native_id.is_none())
                .map(|(k, _)| k.clone())
                .collect();
            for k in keys {
                finish(database, store, &mut buffer, &k, None, "completed")?;
            }
        }
        Ok(if boundary { Some(None) } else { None })
    })();
    database.execution_text = buffer;
    result
}

fn start(
    database: &Database,
    run: &str,
    epoch: i64,
    kind: &str,
    native: Option<&str>,
) -> Result<TextBlock> {
    let sequence = database.connection().query_row("SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_execution_evidence WHERE agent_run_id=?1",[run],|r|r.get(0))?;
    let block = TextBlock {
        id: Uuid::new_v4().to_string(),
        run: run.into(),
        epoch,
        native_id: native.map(str::to_owned),
        kind: kind.into(),
        sequence,
        started_at: chrono::Utc::now().to_rfc3339(),
        body: Body::default(),
        utf16_len: 0,
    };
    let payload = block.payload(String::new(), "streaming").to_string();
    database.connection().execute("INSERT INTO agent_run_execution_evidence(id,agent_run_id,execution_epoch,sequence,event_type,kind,phase,source_event_key,payload_preview_json,content_blob_id,content_byte_count,is_truncated,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,'updated',?7,?8,NULL,?9,0,?10)",
        params![block.id,run,epoch,sequence,block_event(kind),if kind=="thought" {"reasoning_summary"} else {kind},native.map(|n|source_key(epoch,kind,n)),payload,payload.len() as i64,block.started_at])?;
    Ok(block)
}

fn finish(
    database: &mut Database,
    store: &ManagedBlobStore,
    buffer: &mut ExecutionTextBuffer,
    k: &str,
    authoritative: Option<&str>,
    status: &str,
) -> Result<Option<RecordedExecutionEvidence>> {
    let Some(block) = buffer.blocks.get(k) else {
        return Ok(None);
    };
    let text = match authoritative {
        Some(text) => text.to_owned(),
        None => block.body.text()?,
    };
    let (text, truncated) = bounded_text(&text, MAX_BODY_BYTES);
    let incomplete = truncated || (authoritative.is_none() && block.body.truncated);
    let status = if incomplete { "interrupted" } else { status };
    let mut payload = block.payload(text.to_owned(), status);
    payload["contentLimitExceeded"] = json!(incomplete);
    payload["textLength"] = json!(text.encode_utf16().count());
    let encoded = serde_json::to_vec(&payload)?;
    let blob = if encoded.len() > 16 * 1024 {
        Some(
            store
                .put_bytes(database, &encoded, "application/json", "sensitive")?
                .id,
        )
    } else {
        None
    };
    let mut preview = payload.clone();
    if blob.is_some() {
        preview["text"] = json!(text.chars().take(4000).collect::<String>());
    }
    let phase = if status == "completed" {
        "completed"
    } else {
        "failed"
    };
    database.connection().execute("UPDATE agent_run_execution_evidence SET phase=?2,payload_preview_json=?3,content_blob_id=?4,content_byte_count=?5,is_truncated=?6 WHERE id=?1",
        params![block.id,phase,preview.to_string(),blob,encoded.len() as i64,blob.is_some()])?;
    let mut evidence = block.event(payload, phase);
    evidence.content_blob_id = blob;
    // Live terminal output is complete; persisted previews remain lazy Blob-backed.
    evidence.content_byte_count = encoded.len() as i64;
    buffer.blocks.remove(k);
    Ok(Some(RecordedExecutionEvidence {
        evidence,
        inserted: false,
    }))
}

pub(crate) fn flush_settled(database: &mut Database) -> Result<()> {
    if database.execution_text.blocks.is_empty() {
        return Ok(());
    }
    let mut buffer = std::mem::take(&mut database.execution_text);
    let result = (|| {
        let store = ManagedBlobStore::new(database.path().parent().context("database directory")?);
        let mut close = Vec::new();
        for (k, b) in &buffer.blocks {
            let state = database
                .connection()
                .query_row(
                    "SELECT status,execution_epoch,cancel_requested_at FROM agent_run WHERE id=?1",
                    [&b.run],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            match state {
                Some((state, epoch, cancel)) if epoch == b.epoch => {
                    if cancel.is_some()
                        || matches!(state.as_str(), "succeeded" | "failed" | "cancelled")
                    {
                        close.push((
                            k.clone(),
                            if state == "succeeded" && cancel.is_none() {
                                "completed"
                            } else {
                                "interrupted"
                            },
                        ));
                    }
                }
                _ => {
                    close.push((k.clone(), "interrupted"));
                }
            }
        }
        for (k, status) in close {
            finish(database, &store, &mut buffer, &k, None, status)?;
        }
        Ok(())
    })();
    database.execution_text = buffer;
    result
}

pub(crate) fn overlay(
    database: &Database,
    evidence: &mut [AgentRunExecutionEvidenceView],
) -> Result<()> {
    if database.execution_text.blocks.is_empty() {
        return Ok(());
    }
    for view in evidence {
        if let Some(block) = database
            .execution_text
            .blocks
            .values()
            .find(|b| b.id == view.id)
        {
            view.payload = block.payload(block.body.text()?, "streaming");
            view.content_byte_count = view.payload.to_string().len() as i64;
        }
    }
    Ok(())
}

pub(crate) fn live_payload(database: &Database, id: &str) -> Result<Option<Value>> {
    database
        .execution_text
        .blocks
        .values()
        .find(|b| b.id == id)
        .map(|b| Ok(b.payload(b.body.text()?, "streaming")))
        .transpose()
}

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
    use super::*;
    use crate::{
        collaboration::{
            CollaborationService, ProjectBindingKind, TestCampConversationCommand,
            TestCampMessageAddress,
        },
        command::{ActorRef, CommandEnvelope},
        execution_evidence::ExecutionEvidenceService,
        read_model::ReadModelService,
        runtime::ExecutionRuntimeService,
    };

    // This owns the cross-module ingress/read/shutdown boundary; the raw Evidence test
    // cannot prove that a transient stream survives navigation and cancel-all together.
    #[test]
    fn text_blocks_preserve_interleaving_live_reads_and_shutdown_without_fragment_writes() {
        let mut database = crate::test_support::seeded_runtime_database_fast_owned();
        let root = database.directory().to_path_buf();
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let created = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &CommandEnvelope {
                    command_id: "block-fixture".into(),
                    actor: ActorRef::User {
                        user_id: "local_user".into(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: TestCampConversationCommand {
                        project_binding_kind: ProjectBindingKind::Directory,
                        project_path: workspace.to_string_lossy().into(),
                        body: "检查流式正文".into(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_1".into()],
                        },
                        purpose: "text block verification".into(),
                    },
                },
            )
            .unwrap();
        let camp = created.result.payload["campId"].as_str().unwrap();
        let run = created.result.payload["agentRunIds"][0].as_str().unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='running',execution_epoch=1 WHERE id=?1",
                [run],
            )
            .unwrap();
        let store = ManagedBlobStore::new(&root);
        let write = |db: &mut Database, event: &str, payload: Value| {
            ExecutionEvidenceService
                .record_runtime_event(db, &store, run, 1, event, &payload)
                .unwrap()
        };
        let delta = "正文🙂".repeat(16);
        let first = write(
            &mut database,
            "agent.text.delta",
            json!({"itemId":"A","delta":delta}),
        )
        .unwrap();
        let baseline = database.connection().total_changes();
        // Cardinality is the property: 1,000 fragments of one native message must produce zero further SQLite writes.
        for _ in 1..1000 {
            write(
                &mut database,
                "agent.text.delta",
                json!({"itemId":"A","delta":delta}),
            );
        }
        assert_eq!(database.connection().total_changes(), baseline);
        assert!(
            database
                .execution_text
                .blocks
                .values()
                .next()
                .unwrap()
                .body
                .spool
                .is_some()
        );
        let live = ReadModelService
            .camp_open_projection(&mut database, camp)
            .unwrap();
        assert_eq!(
            live.execution_evidence[0].payload["text"],
            delta.repeat(1000)
        );
        write(
            &mut database,
            "activity.started",
            json!({"item":{"type":"commandExecution","id":"tool-1","command":"pwd"}}),
        );
        let complete=write(&mut database,"activity.completed",json!({"item":{"type":"agentMessage","id":"A","text":format!("{}终态",delta.repeat(1000))}})).unwrap();
        assert_eq!(first.sequence, complete.sequence);
        assert!(complete.content_blob_id.is_some());
        let full = ExecutionEvidenceService
            .read_full_payload(&database, &store, camp, &complete.id)
            .unwrap();
        assert_eq!(full["text"], format!("{}终态", delta.repeat(1000)));
        assert!(
            write(
                &mut database,
                "activity.completed",
                json!({"item":{"type":"agentMessage","id":"A","text":full["text"]}})
            )
            .is_none()
        );
        write(&mut database, "agent.text.delta", json!({"delta":"正文B"}));
        write(
            &mut database,
            "agent.thought.delta",
            json!({"delta":"保留的说明"}),
        );
        write(
            &mut database,
            "runtime.action",
            json!({"toolCallId":"tool-2","title":"Read","status":"completed"}),
        );
        let tail = write(
            &mut database,
            "agent.text.delta",
            json!({"delta":"正文C尚未完成"}),
        )
        .unwrap();
        let runtime = ExecutionRuntimeService::default();
        runtime
            .record_controlled_shutdown_cycle(&mut database, "block-shutdown", 3)
            .unwrap();
        runtime
            .settle_controlled_shutdown_runs(&mut database, "block-shutdown", true, (0, 0))
            .unwrap();
        assert!(database.execution_text.blocks.is_empty());
        let tail_id = tail.payload["blockId"].as_str().unwrap();
        let interrupted = ExecutionEvidenceService
            .read_full_payload(&database, &store, camp, tail_id)
            .unwrap();
        assert_eq!(interrupted["text"], "正文C尚未完成");
        assert_eq!(interrupted["status"], "interrupted");
        assert!(
            write(
                &mut database,
                "agent.text.delta",
                json!({"delta":"迟到内容"})
            )
            .is_none()
        );
        let page = ReadModelService
            .agent_run_execution_evidence_page(&mut database, camp, run, 0, 100)
            .unwrap();
        let types = page
            .evidence
            .iter()
            .map(|e| e.event_type.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            types,
            vec![
                "agent.text.block",
                "activity.started",
                "agent.text.block",
                "agent.thought.block",
                "runtime.action",
                "agent.text.block"
            ]
        );
        assert_eq!(page.evidence.last().unwrap().phase, "failed");
        assert_eq!(
            page.evidence
                .iter()
                .filter(|e| e.event_type == "agent.text.block")
                .count(),
            3
        );
        // Reopen a terminal history without the in-memory owner, including its interrupted tail.
        let mut reopened = Database::open_read_only_measurement(database.path()).unwrap();
        let history = ReadModelService
            .agent_run_execution_evidence_page(&mut reopened, camp, run, 0, 100)
            .unwrap();
        assert_eq!(history.evidence.len(), page.evidence.len());
        assert_eq!(history.evidence.last().unwrap().payload, interrupted);
        assert_eq!(
            ExecutionEvidenceService
                .read_full_payload(&reopened, &store, camp, &complete.id)
                .unwrap(),
            full
        );

        // A new epoch must not alias an already finalized native item with the same ID.
        database.connection().execute("UPDATE agent_run SET status='running',execution_epoch=2,cancel_requested_at=NULL,cancel_reason_code=NULL,ended_at=NULL,terminal_resolution_source=NULL,terminal_reason_code=NULL WHERE id=?1", [run]).unwrap();
        ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &store,
                run,
                2,
                "agent.reasoning.summary.delta",
                &json!({"itemId":"A","delta":"received summary"}),
            )
            .unwrap();
        let summary = ExecutionEvidenceService.record_runtime_event(&mut database, &store, run, 2, "activity.completed", &json!({"item":{"type":"reasoning","id":"A","summary":["full summary","second part"]}})).unwrap().unwrap();
        assert_eq!(summary.payload["text"], "full summary\nsecond part");
        let failed_tail = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &store,
                run,
                2,
                "agent.text.delta",
                &json!({"itemId":"A","delta":"failed run partial"}),
            )
            .unwrap()
            .unwrap();
        let version = database
            .connection()
            .query_row("SELECT version FROM agent_run WHERE id=?1", [run], |r| {
                r.get(0)
            })
            .unwrap();
        let command = CommandEnvelope {
            command_id: "block-failure".into(),
            actor: ActorRef::System {
                component_id: "runtime-adapter:test".into(),
            },
            camp_id: Some(camp.into()),
            expected_versions: vec![],
            execution_epoch: None,
            payload: crate::runtime::FailAgentRunCommand {
                agent_run_id: run.into(),
                expected_version: version,
                execution_epoch: 2,
                error_code: "test_failure".into(),
                error_detail: None,
                failure: None,
                manual_retry_allowed: false,
                ending_git_observation: None,
            },
        };
        let failed = runtime.fail_agent_run(&mut database, &command).unwrap();
        assert_eq!(
            failed.result.status,
            crate::command::CommandResultStatus::Applied
        );
        let payload = ExecutionEvidenceService
            .read_full_payload(
                &database,
                &store,
                camp,
                failed_tail.payload["blockId"].as_str().unwrap(),
            )
            .unwrap();
        assert_eq!(payload["text"], "failed run partial");
        assert_eq!(payload["status"], "interrupted");
        let writes = database.connection().total_changes();
        assert_eq!(
            runtime
                .fail_agent_run(&mut database, &command)
                .unwrap()
                .result
                .code,
            failed.result.code
        );
        assert_eq!(database.connection().total_changes(), writes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_limit_preserves_a_complete_utf8_prefix() {
        for (input, maximum, expected, truncated) in [
            ("正文🙂", 10, "正文🙂", false),
            ("正文🙂", 8, "正文", true),
            ("正文🙂", 2, "", true),
            ("", 0, "", false),
        ] {
            assert_eq!(bounded_text(input, maximum), (expected, truncated));
        }
    }
}
