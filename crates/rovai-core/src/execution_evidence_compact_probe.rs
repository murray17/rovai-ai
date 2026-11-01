//! Extends the existing lifecycle/upgrade fixture: no separate Runtime or database setup.
use super::*;
use serde_json::json;

pub(super) fn assert_storage(
    db: &mut Database,
    store: &ManagedBlobStore,
    camp: &str,
    run: &str,
    epoch: i64,
    workspace: &Path,
) {
    db.connection()
        .execute(
            "UPDATE agent_run SET runtime_adapter_kind='codex-cli',workspace_json=?2 WHERE id=?1",
            params![
                run,
                json!({"executionRoot":workspace,"access":"write","isolation":"runtime_managed"})
                    .to_string()
            ],
        )
        .unwrap();
    // Existing v4 operations must keep their classifier across the atomic v5
    // marker upgrade, including formats which store canonical facts on the row.
    let mut frozen = Vec::new();
    for format in [3, 4] {
        let input = json!({"toolCallId":format!("frozen-agent-{format}"),"toolName":"delegate_task",
            "kind":"execute","status":"started","input":{"task":"Read the fixture"}});
        let started = with_operation_storage_for_test(format, || {
            ExecutionEvidenceService
                .record_runtime_event(db, store, run, epoch, "runtime.action", &input)
                .unwrap()
                .unwrap()
        });
        db.connection().execute("UPDATE agent_run_execution_evidence SET activity_meta_json=json_set(activity_meta_json,'$.classifierVersion','activity-v4') WHERE id=?1",[&started.id]).unwrap();
        frozen.push((format, started));
    }
    crate::db::assert_subagent_classifier_upgrade(db);
    for (format, started) in frozen {
        let report = json!({"toolCallId":format!("frozen-agent-{format}"),"toolName":"delegate_task",
            "runtimeToolType":"agent","kind":"execute","status":"completed","output":"Actual child report"});
        let terminal = ExecutionEvidenceService
            .record_runtime_event(db, store, run, epoch, "runtime.action", &report)
            .unwrap()
            .unwrap();
        assert_eq!(terminal.id, started.id);
        assert_eq!(terminal.sequence, started.sequence);
        assert_eq!(
            terminal.canonical.as_ref().unwrap().classifier_version,
            "activity-v4"
        );
        assert_eq!(
            terminal
                .canonical
                .as_ref()
                .unwrap()
                .semantic_kind
                .as_deref(),
            Some("shell.execute")
        );
        assert_eq!(terminal.payload["output"], "Actual child report");
        let mut fresh = report;
        fresh["toolCallId"] = json!(format!("new-agent-{format}"));
        let fresh = ExecutionEvidenceService
            .record_runtime_event(db, store, run, epoch, "runtime.action", &fresh)
            .unwrap()
            .unwrap();
        assert_eq!(
            fresh.canonical.as_ref().unwrap().classifier_version,
            "activity-v5"
        );
        assert_eq!(
            fresh.canonical.as_ref().unwrap().semantic_kind.as_deref(),
            Some("tool.agent")
        );
        assert_eq!(fresh.canonical.as_ref().unwrap().outcome, "succeeded");
        let history =
            crate::execution_window::read_page(db, camp, run, Some(started.sequence + 1), 1)
                .unwrap();
        assert_eq!(history.evidence[0].id, started.id);
        assert_eq!(
            history.evidence[0]
                .canonical
                .as_ref()
                .unwrap()
                .classifier_version,
            "activity-v4"
        );
    }
    let fields = (0..24)
        .map(|i| (format!("field_{i:02}"), json!("界🙂\n".repeat(1000))))
        .collect::<Map<_, _>>();
    let diff = format!(
        "@@ -1 +1 @@\n-{}\n+{}\n",
        "o".repeat(18000),
        "n".repeat(18000)
    );
    let mut measurements = Vec::new();
    for format in [3, 4] {
        let input = json!({"toolCallId":format!("compact-input-{format}"),"kind":"execute","toolName":"fixture","status":"started","input":fields});
        let saved = with_operation_storage_for_test(format, || {
            ExecutionEvidenceService
                .record_runtime_event(db, store, run, epoch, "runtime.action", &input)
                .unwrap()
                .unwrap()
        });
        let (preview, blob):(String,String) = db.connection().query_row(
            "SELECT input_preview_json,input_blob_id FROM agent_run_execution_evidence WHERE id=?1",[&saved.id],
            |r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let full = ExecutionEvidenceService
            .read_full_payload(db, store, camp, &saved.id)
            .unwrap();
        assert_eq!(full["input"], input["input"]);
        if format == 4 {
            assert!(preview.len() <= compact_storage::PREVIEW_BYTES);
        } else {
            assert!(preview.len() > compact_storage::PREVIEW_BYTES);
        }
        let input_preview_bytes = preview.len();
        let input_blob_bytes = store.read_bytes(db, &blob).unwrap().len();

        // Real protocol shape through the production normalizer and storage admission.
        let (event, payload) = crate::codex::normalize_event(
            "item/completed",
            &json!({"item":{
            "id":format!("compact-file-{format}"),"type":"fileChange","status":"completed",
            "changes":[{"path":"compact.rs","kind":{"type":"update"},"diff":diff,"nativeExtra":"retain"}]}}),
        );
        let saved = with_operation_storage_for_test(format, || {
            ExecutionEvidenceService
                .record_runtime_event(db, store, run, epoch, event, &payload)
                .unwrap()
                .unwrap()
        });
        let full = ExecutionEvidenceService
            .read_full_payload(db, store, camp, &saved.id)
            .unwrap();
        assert_eq!(
            full.pointer("/runtimeDiff/entries/0/diff")
                .and_then(Value::as_str),
            Some(diff.as_str())
        );
        assert_eq!(full["item"]["changes"][0]["nativeExtra"], "retain");
        if format == 4 {
            assert!(full.pointer("/item/changes/0/diff").is_none());
        } else {
            assert_eq!(full["item"]["changes"][0]["diff"], diff);
        }
        let rendered = crate::execution_window::content_canonical(db, &saved.id, &full)
            .unwrap()
            .unwrap();
        assert_eq!(
            rendered.diff_projection.unwrap().entries.unwrap()[0].diff,
            diff
        );
        let (preview_bytes,blob_bytes):(i64,i64)=db.connection().query_row("SELECT length(CAST(result_preview_json AS BLOB)),result_byte_count FROM agent_run_execution_evidence WHERE id=?1",[&saved.id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();

        // A frozen old operation must still finish under the old reducer after upgrade.
        db.connection().execute_batch("CREATE TEMP TABLE compact_updates(total INTEGER,body INTEGER,metadata INTEGER);
            INSERT INTO compact_updates VALUES(0,0,0);
            CREATE TEMP TRIGGER compact_total AFTER UPDATE ON agent_run_execution_evidence
                BEGIN UPDATE compact_updates SET total=total+1; END;
            CREATE TEMP TRIGGER compact_body AFTER UPDATE OF input_preview_json,result_preview_json,input_blob_id,result_blob_id ON agent_run_execution_evidence
                BEGIN UPDATE compact_updates SET body=body+1; END;
            CREATE TEMP TRIGGER compact_metadata AFTER UPDATE OF activity_meta_json ON agent_run_execution_evidence
                BEGIN UPDATE compact_updates SET metadata=metadata+1; END;").unwrap();
        let mut revisions = std::collections::BTreeSet::new();
        let mut last = None;
        for step in 0..128 {
            let payload = json!({"toolCallId":format!("compact-progress-{format}"),"kind":"execute","status":"in_progress",
                "output":format!("{}NEVER_PERSIST_COMPACT_{step}","界".repeat(2560))});
            let record = || {
                ExecutionEvidenceService
                    .record_runtime_event(db, store, run, epoch, "runtime.action", &payload)
                    .unwrap()
                    .unwrap()
            };
            let saved = if step == 0 {
                with_operation_storage_for_test(format, record)
            } else {
                let mut record = record;
                record()
            };
            assert_eq!(saved.payload["output"].as_str().unwrap().len(), 7680);
            assert_eq!(saved.output_truncated, Some(true));
            assert!(saved.payload["resultDigest"].as_str().is_some());
            revisions.insert(saved.revision);
            last = Some(saved);
        }
        let last = last.unwrap();
        let updates: (i64, i64, i64) = db
            .connection()
            .query_row("SELECT total,body,metadata FROM compact_updates", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(revisions.len(), if format == 4 { 1 } else { 128 });
        assert_eq!(updates.1, if format == 4 { 0 } else { 127 });
        assert_eq!(updates.2, if format == 4 { 1 } else { 128 });
        let persisted_preview:String=db.connection().query_row("SELECT rovai_execution_preview(storage_version,payload_preview_json,input_preview_json,result_preview_json,result_digest) FROM agent_run_execution_evidence WHERE id=?1",[&last.id],|r|r.get(0)).unwrap();
        let persisted_preview: Value = serde_json::from_str(&persisted_preview).unwrap();
        assert_eq!(
            persisted_preview["resultDigest"],
            last.payload["resultDigest"]
        );
        let latest_digest = last.payload["resultDigest"].clone();
        // Reopen the persisted fixture and finish with a metadata-only terminal event.
        let mut restarted = Database::open(db.path().parent().unwrap()).unwrap();
        let completed=ExecutionEvidenceService.record_runtime_event(&mut restarted,store,run,epoch,"runtime.action",
            &json!({"toolCallId":format!("compact-progress-{format}"),"kind":"execute","status":"completed"})).unwrap().unwrap();
        assert_eq!(completed.payload["resultDigest"], latest_digest);
        assert_eq!(completed.payload["output"], last.payload["output"]);
        assert!(completed.revision > last.revision);
        assert_eq!(completed.canonical.as_ref().unwrap().outcome, "succeeded");
        let changed_terminal=ExecutionEvidenceService.record_runtime_event(&mut restarted,store,run,epoch,"runtime.action",
            &json!({"toolCallId":format!("compact-progress-{format}"),"kind":"execute","status":"completed",
                "output":format!("{}NEVER_PERSIST_COMPACT_NEW_TERMINAL","界".repeat(2560))})).unwrap().unwrap();
        assert!(
            changed_terminal.revision > completed.revision,
            "a new terminal proof must refresh associations"
        );
        assert_ne!(changed_terminal.payload["resultDigest"], latest_digest);
        assert_eq!(changed_terminal.payload["output"], last.payload["output"]);
        let replaced=ExecutionEvidenceService.record_runtime_event(&mut restarted,store,run,epoch,"runtime.action",
            &json!({"toolCallId":format!("compact-progress-{format}"),"kind":"execute","status":"completed","output":"replacement"})).unwrap().unwrap();
        assert_eq!(replaced.payload["output"], "replacement");
        assert_eq!(replaced.output_truncated, Some(false));
        for status in ["started", "failed"] {
            let late=ExecutionEvidenceService.record_runtime_event(&mut restarted,store,run,epoch,"runtime.action",
                &json!({"toolCallId":format!("compact-progress-{format}"),"kind":"execute","status":status,"output":"late, conflicting proof"})).unwrap().unwrap();
            assert_eq!(
                late.payload["resultDigest"], replaced.payload["resultDigest"],
                "late start/conflict must preserve the accepted result proof"
            );
            assert_eq!(late.payload["output"], "replacement");
            if status == "failed" {
                assert_eq!(late.canonical.as_ref().unwrap().outcome, "unsettled");
            }
        }
        let retained_format: i64 = restarted
            .connection()
            .query_row(
                "SELECT storage_version FROM agent_run_execution_evidence WHERE id=?1",
                [&last.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(retained_format, format);
        drop(restarted);
        db.connection().execute_batch("DROP TRIGGER compact_total; DROP TRIGGER compact_body; DROP TRIGGER compact_metadata; DROP TABLE compact_updates;").unwrap();
        measurements.push(json!({"format":format,"inputPreviewBytes":input_preview_bytes,"inputBlobBytes":input_blob_bytes,
            "singleDiffBytes":diff.len(),"resultPreviewBytes":preview_bytes,"resultBodyBytes":blob_bytes,
            "progressEvents":128,"progressVisibleRevisions":revisions.len(),"progressSqlUpdates":updates.0,
            "progressBodyUpdates":updates.1,"progressMetadataUpdates":updates.2}));
    }
    // Exact CLI/Core association must survive clipping and the new scalar digest in
    // both page summaries and the lightweight block index (no full output fallback).
    for format in [3, 4] {
        let count = |db: &mut Database| {
            crate::execution_window::read_block_page(db, camp, run, None, None, 100)
                .unwrap()
                .blocks
                .iter()
                .map(|b| b.tool_count)
                .sum::<usize>()
        };
        let before = count(db);
        let carrier_id = format!("compact-carrier-{format}");
        let shell = with_operation_storage_for_test(format, || {
            ExecutionEvidenceService.record_runtime_event(db,store,run,epoch,"activity.started",
            &json!({"item":{"id":carrier_id,"type":"commandExecution","command":"rovai task get --task-id fixture-task --json","status":"inProgress"}})).unwrap().unwrap()
        });
        let envelope=BuiltinToolInvocationEnvelope::success("team.get_task","7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({"taskId":"fixture-task","title":format!("fixture-{format}"),"description":"d".repeat(10000),"status":"in_progress","assigneeAgentId":"agent_1"})).unwrap();
        let output = project_envelope(envelope.clone()).unwrap();
        let core = with_operation_storage_for_test(format, || {
            ExecutionEvidenceService.record_builtin_tool_result(db,store,run,epoch,
            &json!({"toolCallId":format!("compact-core-{format}"),"status":"completed","kind":"builtin_tool_invocation",
                "sourceAuthority":"core","canonicalTool":"team.get_task","coreEnvelope":envelope})).unwrap().unwrap()
        });
        let terminal=ExecutionEvidenceService.record_runtime_event(db,store,run,epoch,"activity.completed",
            &json!({"item":{"id":carrier_id,"type":"commandExecution","status":"completed","aggregatedOutput":output.to_string()}})).unwrap().unwrap();
        assert_eq!(
            terminal.payload["resultDigest"], core.payload["agentOutputDigest"],
            "format {format} result proof"
        );
        assert_eq!(
            terminal.canonical.as_ref().unwrap().activity_domain,
            "shell"
        );
        assert_eq!(terminal.canonical.as_ref().unwrap().outcome, "succeeded");
        assert_eq!(
            core.canonical.as_ref().unwrap().credibility,
            "core_verified"
        );
        let page =
            crate::execution_window::read_page(db, camp, run, Some(core.sequence), 1).unwrap();
        assert_eq!(page.evidence[0].id, shell.id);
        assert_eq!(
            page.evidence[0].payload["executionWindowBuiltinOperation"], "team.get_task",
            "format {format} page association"
        );
        assert_eq!(
            count(db),
            before + 1,
            "the CLI carrier must fold with its exactly proven Core operation"
        );
    }
    let leaked:bool=db.connection().query_row("SELECT EXISTS(SELECT 1 FROM agent_run_execution_evidence WHERE instr(input_preview_json,'NEVER_PERSIST_COMPACT_')>0 OR instr(result_preview_json,'NEVER_PERSIST_COMPACT_')>0 OR instr(activity_meta_json,'NEVER_PERSIST_COMPACT_')>0) OR EXISTS(SELECT 1 FROM event_log WHERE instr(payload_json,'NEVER_PERSIST_COMPACT_')>0)",[],|r|r.get(0)).unwrap();
    assert!(!leaked);
    let ids: Vec<String> = db
        .connection()
        .prepare("SELECT id FROM managed_blob")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    for id in ids {
        assert!(
            !String::from_utf8_lossy(&store.read_bytes(db, &id).unwrap())
                .contains("NEVER_PERSIST_COMPACT_")
        );
    }
    eprintln!("compact_storage_cases {}", json!(measurements));
}
