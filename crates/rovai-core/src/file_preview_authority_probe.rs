// Extends the existing exact-evidence/worktree test with the actual upgraded view.
use super::super::{
    LEGACY_FILE_ACTIVITY_SQL, RUN_FILE_EVIDENCE_SQL, RUN_FILE_OPERATION_SQL,
    legacy_file_activity_key_sql,
};
use super::*;
use crate::execution_evidence::with_operation_storage_for_test;
use rusqlite::{
    Connection,
    hooks::{AuthAction, AuthContext, Authorization},
};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::Instant,
};

const BEFORE_SQL: &str = include_str!("file_preview_authority_before_probe.sql");
fn plan(c: &Connection, sql: &str, values: &[&dyn rusqlite::ToSql]) -> Value {
    let eqp: Vec<String> = c
        .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
        .unwrap()
        .query_map(values, |r| r.get(3))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let vm: Vec<Value> = c
        .prepare(&format!("EXPLAIN {sql}"))
        .unwrap()
        .query_map(values, |r| {
            Ok(json!([
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<String>>(5)?
            ]))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<Value>>>()
        .unwrap()
        .into_iter()
        .filter(|op| {
            matches!(
                op[0].as_str(),
                Some(
                    "Column"
                        | "OpenRead"
                        | "OpenEphemeral"
                        | "SorterOpen"
                        | "SorterInsert"
                        | "DeferredSeek"
                )
            )
        })
        .collect();
    json!({"queryPlan":eqp,"readOpcodes":vm})
}
fn resolve_samples(
    database: &Database,
    data: &Path,
    id: &str,
    path: &str,
) -> (Vec<f64>, BTreeSet<(String, String)>) {
    let columns = Arc::new(Mutex::new(BTreeSet::new()));
    let captured = Arc::clone(&columns);
    database
        .connection()
        .authorizer(Some(move |ctx: AuthContext<'_>| {
            if let AuthAction::Read {
                table_name,
                column_name,
            } = ctx.action
            {
                captured
                    .lock()
                    .unwrap()
                    .insert((table_name.to_string(), column_name.to_string()));
            }
            assert_ne!(
                ctx.accessor,
                Some("execution_activity"),
                "single-file authorization cannot enter the compatibility view"
            );
            Authorization::Allow
        }))
        .unwrap();
    let samples = (0..7)
        .map(|_| {
            let now = Instant::now();
            let source =
                resolve_run_activity_file(database, data, "preview-run", 1, id, path).unwrap();
            let elapsed = now.elapsed().as_secs_f64() * 1000.;
            let ResolvedFilePreviewSource::FileTarget {
                root_path,
                raw_reference,
                ..
            } = source
            else {
                panic!("expected file")
            };
            assert_eq!(
                std::fs::read_to_string(Path::new(&root_path).join(raw_reference)).unwrap(),
                "selected file\n"
            );
            elapsed
        })
        .collect();
    database
        .connection()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    let read = columns.lock().unwrap().clone();
    assert!(!read.iter().any(|(table, _)| table == "managed_blob"));
    (samples, read)
}
fn measure(database: &Database, data: &Path, id: &str, path: &str) -> Value {
    let c = database.connection();
    let versions = [
        crate::canonical_activity::CLASSIFIER_VERSION,
        crate::canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
        crate::canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
        crate::canonical_activity::LEGACY_CLASSIFIER_VERSION,
    ];
    let before_params: [&dyn rusqlite::ToSql; 8] = [
        &id,
        &"preview-run",
        &1,
        &"preview-camp",
        &versions[0],
        &versions[1],
        &versions[2],
        &versions[3],
    ];
    let before_plan = plan(c, BEFORE_SQL, &before_params);
    let before: Vec<f64> = (0..7)
        .map(|_| {
            let now = Instant::now();
            let len = c
                .query_row(BEFORE_SQL, before_params, |r| r.get::<_, Option<String>>(0))
                .unwrap()
                .unwrap()
                .len();
            assert!(len > 0);
            now.elapsed().as_secs_f64() * 1000.
        })
        .collect();
    let operation: Option<String> = c
        .query_row(
            "SELECT operation_id FROM agent_run_execution_evidence WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    let key_sql = legacy_file_activity_key_sql(operation.is_some());
    let key_params: [&dyn rusqlite::ToSql; 9] = [
        &"preview-run",
        &1,
        &versions[0],
        &crate::canonical_activity::V4_CLASSIFIER_VERSION,
        &versions[1],
        &versions[2],
        &versions[3],
        &operation,
        &id,
    ];
    let (after, columns) = resolve_samples(database, data, id, path);
    let version: i64 = c
        .query_row(
            "SELECT storage_version FROM agent_run_execution_evidence WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    if version >= 3 {
        assert!(
            !columns
                .iter()
                .any(|(table, column)| table == "canonical_runtime_activity"
                    || column == "payload_preview_json"
                    || column == "input_preview_json"
                    || column == "result_preview_json")
        );
    }
    json!({"storageVersion":version,"operationIdPresent":operation.is_some(),"beforeAuthorizationSqlMs":before,"afterActualCoreFileEntryMs":after,"columnsRequestedByActualEntry":columns,
        "plans":{"before":before_plan,"selectedEvidence":plan(c,RUN_FILE_EVIDENCE_SQL,&[&id,&"preview-run",&1,&"preview-camp"]),"legacyKey":plan(c,&key_sql,&key_params),"legacySelectedDiff":plan(c,LEGACY_FILE_ACTIVITY_SQL,&[&"preview-run",&1,&operation,&versions[0]]),"selectedPathOnly":plan(c,RUN_FILE_OPERATION_SQL,&[&id])}})
}

pub(super) fn verify_upgraded_file_reads() {
    let (mut database, data, root, execution_root) = run_workspace_fixture();
    database
        .connection()
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    database
        .connection()
        .pragma_update(None, "synchronous", "NORMAL")
        .unwrap();
    crate::test_support::assert_production_database_configuration(&database);
    let mut old = Vec::new();
    let mut new = Vec::new();
    let mut previous = Vec::new();
    let mut report = json!({});
    for (version, count, ids) in [(1, 512, &mut old), (3, 128, &mut previous), (4, 128, &mut new)] {
        for n in 0..count {
            let path = format!("src/probe-{version}-{n}.ts");
            let event = format!("probe-{version}-{n}");
            let evidence = with_operation_storage_for_test(version, || {
                ExecutionEvidenceService.record_runtime_event(&mut database,&ManagedBlobStore::new(&data),"preview-run",1,"runtime.action",&json!({"eventId":event,"toolCallId":event,"kind":"edit","status":"completed","runtimeDiff":{"adapterKind":"opencode-cli","protocolFamily":"acp-v1","sourceEventKind":"session/update.tool_call_update.completed","semanticKind":"complete_before_after","entries":[{"path":execution_root.join(&path),"oldText":"before\n","newText":"after\n".repeat(11000)}]}})).unwrap().unwrap().id.clone()
            });
            if n < 2 {
                std::fs::create_dir_all(execution_root.join("src")).unwrap();
                std::fs::write(execution_root.join(&path), "selected file\n").unwrap();
            }
            ids.push((evidence, path));
        }
        if version == 1 {
            // An append-only pre-lifecycle record is a separate legacy case.
            database
                .connection()
                .execute(
                    "UPDATE agent_run_execution_evidence SET operation_id=NULL WHERE id=?1",
                    [&ids[1].0],
                )
                .unwrap();
            crate::db::assert_unified_activity_upgrade(&mut database);
            export_old_app_fixture(&database, &data, &ids[0].0, &ids[0].1);
        }
        if version == 1 {
            let all_old = measure(&database, &data, &ids[0].0, &ids[0].1);
            let append_only = measure(&database, &data, &ids[1].0, &ids[1].1);
            report = json!({"allOld":all_old,"appendOnlyOld":append_only});
        }
        if version == 3 {
            // The last released schema, with real unified rows and large old bodies.
            crate::db::assert_compact_storage_upgrade(&mut database);
        }
    }
    let mixed_old = measure(&database, &data, &old[0].0, &old[0].1);
    let mixed_new = measure(&database, &data, &new[0].0, &new[0].1);
    let view: String = database
        .connection()
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='execution_activity'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(view.contains("UNION ALL") && view.contains("storage_version IN (3,4)"));
    report["sqlite"] = json!(
        database
            .connection()
            .query_row("SELECT sqlite_version()", [], |r| r.get::<_, String>(0))
            .unwrap()
    );
    report["mixedOld"] = mixed_old;
    report["mixedNew"] = mixed_new;
    report["mixedFormat3"] = measure(&database,&data,&previous[0].0,&previous[0].1);
    report["viewSql"] = json!(view);
    report["sampleCount"] = json!(7);
    report["oldDiffRows"] = json!(512);
    report["newDiffRows"] = json!(256);
    report["format3DiffRows"] = json!(128);
    report["format4DiffRows"] = json!(128);
    report["patchTextBytesPerEvent"] = json!(66007);
    let objects:Vec<Value>=database.connection().prepare("SELECT name,rootpage,sql FROM sqlite_master WHERE tbl_name IN ('agent_run_execution_evidence','canonical_runtime_activity','agent_run','camp_turn','camp') AND type IN ('table','index')").unwrap().query_map([],|r|Ok(json!([r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,Option<String>>(2)?]))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    report["schemaObjects"] = json!(objects);
    report["measurementBoundary"] = json!(
        "before: previous PR authorization SQL against the actual upgraded UNION view; after: production resolve_file_preview_source including scope/root checks. File bytes read outside measured interval. No view substitution, no Blob/full detail read for authorization. Old selected diff remains read, new diff authorization only reads selected small metadata. Small warmed samples, not a stable speedup or P95 claim."
    );
    if let Ok(path) = std::env::var("ROVAI_FILE_AUTHORITY_PROBE_OUTPUT") {
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
    for kind in ["allOld", "appendOnlyOld", "mixedOld", "mixedNew"] {
        println!(
            "file_authority_probe {kind}: before={} after={}",
            report[kind]["beforeAuthorizationSqlMs"], report[kind]["afterActualCoreFileEntryMs"]
        );
    }
    clean_run_workspace_fixture(database, data, root);
}
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target)
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}
fn export_old_app_fixture(database: &Database, data: &Path, evidence: &str, path: &str) {
    let Ok(destination) = std::env::var("ROVAI_STORAGE_UPGRADE_FIXTURE") else {
        return;
    };
    let root = Path::new(&destination);
    assert!(root.is_absolute());
    let user_data = root.join("user-data");
    std::fs::create_dir_all(&user_data).unwrap();
    let target = user_data.join("rovai.sqlite");
    assert!(!target.exists());
    crate::db::export_legacy_storage_fixture(database, &target);
    let c = Connection::open(&target).unwrap();
    let project = root.join("project");
    let worktree = root.join("mission-worktree");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(worktree.join("src")).unwrap();
    std::fs::write(worktree.join(path), "selected file\n").unwrap();
    c.execute("UPDATE camp SET project_path=?1,title='Storage upgrade history',default_lead_agent_id='agent_1' WHERE id='preview-camp'",[project.to_string_lossy().as_ref()]).unwrap();
    c.execute("INSERT INTO camp_member(camp_id,agent_id,status,capability_overrides_json,version,joined_at) VALUES('preview-camp','agent_1','active','{}',1,'2026-10-01')",[]).unwrap();
    c.execute("UPDATE agent_run SET status='succeeded',ended_at=updated_at,workspace_json=?1 WHERE id='preview-run'",[json!({"executionRoot":worktree,"access":"write","isolation":"shared"}).to_string()]).unwrap();
    c.execute(
        "UPDATE camp_turn SET status='completed',ended_at=updated_at,execution_budget_schema_version=1,execution_budget_accepted_at=created_at,execution_budget_max_agent_run_responsibilities=32,execution_budget_max_accepted_a2a=16,execution_budget_root_agent_run_responsibilities=1 WHERE id='preview-turn'",
        [],
    )
    .unwrap();
    for n in 0..60 {
        let id = format!("upgrade-message-{n}");
        c.execute("INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,structured_content_json,content_digest,address_mode,addressed_agent_ids_json,version,created_at,updated_at) VALUES(?1,'preview-camp',?2,'user','local_user',?3,json_array(json_object('kind','text','text',?3)),'fixture','default','[]',1,'2026-10-01','2026-10-01')",params![id,n+1,format!("Old message {n}")]).unwrap();
        c.execute("INSERT INTO event_log(event_type,camp_id,entity_type,entity_id,payload_json,created_at) VALUES('camp_message.sent','preview-camp','camp_message',?1,'{}','2026-10-01')",[id]).unwrap();
    }
    c.execute(
        "UPDATE camp SET last_message_sequence=60 WHERE id='preview-camp'",
        [],
    )
    .unwrap();
    c.execute_batch("BEGIN; PRAGMA defer_foreign_keys=ON;")
        .unwrap();
    let camp_id = crate::camp_id::ThreadId::new().to_string();
    let tables: Vec<String> = c
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    for table in tables {
        let escaped = table.replace('"', "\"\"");
        let has_camp: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name='camp_id')",
                [&table],
                |r| r.get(0),
            )
            .unwrap();
        if has_camp {
            c.execute(
                &format!("UPDATE \"{escaped}\" SET camp_id=?1 WHERE camp_id='preview-camp'"),
                [&camp_id],
            )
            .unwrap();
        }
    }
    c.execute("UPDATE camp SET id=?1 WHERE id='preview-camp'", [&camp_id])
        .unwrap();
    // This synthetic Camp has no attachments. Its test-only empty legacy View
    // receipt belongs to the source fixture filesystem; do not export that receipt
    // after relocating the fixture into a different App instance.
    assert_eq!(
        c.query_row("SELECT count(*) FROM message_attachment", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM camp_attachment_view_entry", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    c.execute(
        "DELETE FROM camp_attachment_view WHERE entry_count=0 AND aggregate_bytes=0",
        [],
    )
    .unwrap();
    c.execute_batch("COMMIT;").unwrap();
    drop(c);
    copy_tree(
        &data.join("managed-blobs"),
        &user_data.join("managed-blobs"),
    );
    std::fs::write(root.join("fixture.json"),json!({"schema":149,"campId":camp_id,"runId":"preview-run","evidenceId":evidence,"filePath":path,"project":project,"executionRoot":worktree}).to_string()).unwrap();
}
