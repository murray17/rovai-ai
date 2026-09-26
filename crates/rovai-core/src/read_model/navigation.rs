//! Navigation reads saved Camp facts. Historical events are used only by migration v175.
use super::*;

const GROUP_KEY: &str = "CASE WHEN camp.project_binding_kind = 'directory' THEN 'directory:' || camp.project_path ELSE 'quick-chat' END";
const VISIBLE: &str = r#"
    camp.deletion_operation_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM mission WHERE mission.camp_id = camp.id)
    AND (camp.activation_state = 'active'
      OR EXISTS(SELECT 1 FROM camp_composer_draft d WHERE d.camp_id = camp.id AND d.client_id = ?1
                AND (length(trim(d.body)) > 0 OR d.source_attachments_json <> '[]'))
      OR EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = camp.id AND client_id = ?1))
"#;
const ORDER: &str = "COALESCE(camp.navigation_activity_at, camp.created_at) DESC, camp.navigation_activity_sequence DESC, camp.id";

fn load_rows(
    tx: &Transaction<'_>,
    client: &crate::draft_client::DraftClient,
    predicate: &str,
    selection: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<NavigationCampItem>> {
    let sql = format!(
        r#"
        SELECT camp.id, camp.title, camp.project_binding_kind, camp.project_path,
            lead.id, lead.display_name, camp.navigation_activity_sequence,
            COALESCE(camp.navigation_activity_at, camp.created_at), camp.navigation_completion_sequence,
            COALESCE(v.last_seen_global_sequence, 0),
            (EXISTS(SELECT 1 FROM agent_run r WHERE r.camp_id = camp.id AND r.status IN ('queued', 'running', 'waiting'))
             OR EXISTS(SELECT 1 FROM camp_turn t JOIN agent_run r ON r.camp_turn_id = t.id
                       WHERE t.camp_id = camp.id AND r.camp_id IS NULL AND r.status IN ('queued', 'running', 'waiting'))),
            camp.version, camp.activation_state, channel.provider, channel.conversation_kind
        FROM camp
        LEFT JOIN agent_profile lead ON lead.id = camp.default_lead_agent_id
        LEFT JOIN camp_view_state v ON v.camp_id = camp.id
        LEFT JOIN channel_conversation_binding binding ON binding.camp_id = camp.id
        LEFT JOIN channel_conversation channel ON channel.id = binding.channel_conversation_id
        WHERE {predicate} AND {VISIBLE}
        ORDER BY {ORDER} LIMIT ?3 OFFSET ?4
    "#
    );
    let mut statement = tx.prepare(&sql)?;
    let rows = statement.query_map(
        params![
            client.id(),
            selection,
            limit.min(i64::MAX as usize) as i64,
            offset.min(i64::MAX as usize) as i64
        ],
        |row| {
            let lead_id: Option<String> = row.get(4)?;
            let completion: i64 = row.get(8)?;
            let seen: i64 = row.get(9)?;
            let loading: bool = row.get(10)?;
            Ok(NavigationCampItem {
                id: row.get(0)?,
                title: row.get(1)?,
                channel_source: camp_channel_source_from_row(row, 13)?,
                activation_state: row.get(12)?,
                project_binding_kind: row.get(2)?,
                project_path: row.get(3)?,
                default_lead: lead_id.map(|agent_id| NavigationLeadSummary {
                    agent_id,
                    display_name: row
                        .get::<_, Option<String>>(5)
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                }),
                marker: if loading {
                    "loading"
                } else if completion > seen {
                    "unread_completed"
                } else {
                    "none"
                }
                .into(),
                last_activity_at: row.get(7)?,
                last_activity_global_sequence: row.get(6)?,
                latest_completion_global_sequence: completion,
                last_seen_global_sequence: seen,
                version: row.get(11)?,
            })
        },
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(super) fn load_navigation_rows(
    tx: &Transaction<'_>,
    client: &crate::draft_client::DraftClient,
    ids: &[String],
) -> Result<Vec<NavigationCampItem>> {
    load_rows(
        tx,
        client,
        "camp.id IN (SELECT value FROM json_each(?2))",
        &serde_json::to_string(ids)?,
        0,
        ids.len(),
    )
}

pub(super) fn navigation_group_count(
    tx: &Transaction<'_>,
    client: &crate::draft_client::DraftClient,
    key: &str,
) -> Result<usize> {
    Ok(tx.query_row(
        &format!("SELECT COUNT(*) FROM camp WHERE {GROUP_KEY} = ?2 AND {VISIBLE}"),
        params![client.id(), key],
        |row| row.get::<_, i64>(0),
    )? as usize)
}

pub(super) fn load_navigation_group(
    tx: &Transaction<'_>,
    client: &crate::draft_client::DraftClient,
    key: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<NavigationCampItem>> {
    load_rows(tx, client, &format!("{GROUP_KEY} = ?2"), key, offset, limit)
}

pub(super) fn load_navigation_groups(
    tx: &Transaction<'_>,
    client: &crate::draft_client::DraftClient,
    limits: &BTreeMap<String, usize>,
    keys: Option<&[String]>,
) -> Result<(NavigationCampGroup, Vec<ProjectNavigationGroup>)> {
    // Only directory/count metadata spans the requested groups. Full Camp rows, run
    // markers and channel/lead details are read for each indexed prefix, never all rows.
    let filter = if keys.is_some() {
        format!("{GROUP_KEY} IN (SELECT value FROM json_each(?2))")
    } else {
        "?2 IS NULL".into()
    };
    let mut statement = tx.prepare(&format!(
        "SELECT {GROUP_KEY}, COUNT(*) FROM camp WHERE {filter} AND {VISIBLE} GROUP BY {GROUP_KEY}"
    ))?;
    let groups = statement
        .query_map(
            params![client.id(), keys.map(serde_json::to_string).transpose()?],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut quick_chat = NavigationCampGroup {
        total_count: 0,
        recent_camps: vec![],
    };
    let mut projects = vec![];
    for (key, total_count) in groups {
        let limit = limits
            .get(&key)
            .copied()
            .unwrap_or(NAVIGATION_RECENT_CAMP_LIMIT)
            .max(NAVIGATION_RECENT_CAMP_LIMIT);
        let camps = load_navigation_group(tx, client, &key, 0, limit)?;
        if key == "quick-chat" {
            quick_chat = NavigationCampGroup {
                total_count,
                recent_camps: camps,
            };
        } else if let Some(first) = camps.first() {
            projects.push(ProjectNavigationGroup {
                project_key: key,
                name: project_display_name(&first.project_path),
                project_path: first.project_path.clone(),
                last_activity_at: first.last_activity_at.clone(),
                last_activity_global_sequence: first.last_activity_global_sequence,
                total_count,
                recent_camps: camps,
            });
        }
    }
    projects.sort_by(|a, b| {
        b.last_activity_at
            .cmp(&a.last_activity_at)
            .then_with(|| {
                b.last_activity_global_sequence
                    .cmp(&a.last_activity_global_sequence)
            })
            .then_with(|| a.project_key.cmp(&b.project_key))
    });
    Ok((quick_chat, projects))
}

pub(super) fn navigation_camp_group_keys(
    tx: &Transaction<'_>,
    ids: &[String],
) -> Result<Vec<String>> {
    let mut statement = tx.prepare(&format!(
        "SELECT DISTINCT {GROUP_KEY} FROM camp WHERE camp.id IN (SELECT value FROM json_each(?1))"
    ))?;
    Ok(statement
        .query_map([serde_json::to_string(ids)?], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    fn metered(database: &mut Database, row_only: bool) -> usize {
        database
            .connection()
            .authorizer(Some(|context: AuthContext<'_>| match context.action {
                AuthAction::Read {
                    table_name: "event_log",
                    ..
                } => Authorization::Deny,
                _ => Authorization::Allow,
            }))
            .unwrap();
        let steps = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&steps);
        database
            .connection()
            .progress_handler(
                1,
                Some(move || {
                    counter.fetch_add(1, Ordering::Relaxed);
                    false
                }),
            )
            .unwrap();
        if row_only {
            let rows = ReadModelService
                .navigation_camps(
                    database,
                    &["local-1".into()],
                    &crate::draft_client::DraftClient::default(),
                )
                .unwrap();
            assert_eq!(rows.camps.len(), 1);
        } else {
            let window = ReadModelService
                .navigation_snapshot_for_groups(
                    database,
                    &BTreeMap::new(),
                    Some(&["directory:/local".into()]),
                    &crate::draft_client::DraftClient::default(),
                )
                .unwrap();
            assert_eq!(window.projects.len(), 1);
            assert_eq!(window.projects[0].total_count, 20);
            assert_eq!(window.projects[0].recent_camps.len(), 5);
            assert_eq!(window.quick_chat.total_count, 0);
        }
        database
            .connection()
            .progress_handler(0, None::<fn() -> bool>)
            .unwrap();
        database
            .connection()
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
            .unwrap();
        steps.load(Ordering::Relaxed)
    }

    // The new read scopes own this cost boundary: CampOpen's volume test cannot
    // detect accidentally materializing other groups or re-aggregating navigation.
    #[test]
    fn navigation_reads_no_history_and_scoped_work_does_not_grow_with_other_groups() {
        let directory =
            std::env::temp_dir().join(format!("rovai-navigation-volume-{}", uuid::Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
        database
            .connection()
            .execute_batch(
                "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<20)
            INSERT INTO camp(id,title,project_binding_kind,project_path,created_at,updated_at)
            SELECT 'local-'||i,'local','directory','/local','2026-01-01','2026-01-01' FROM n;",
            )
            .unwrap();
        let baseline = [metered(&mut database, true), metered(&mut database, false)];
        database
            .connection()
            .execute_batch(
                "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2000)
            INSERT INTO camp(id,title,project_binding_kind,project_path,created_at,updated_at)
            SELECT 'other-'||i,'other','directory','/other','2026-01-01','2026-01-01' FROM n;
            WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50000)
            INSERT INTO event_log(event_type,camp_id,payload_json,created_at)
            SELECT 'agent_run.succeeded','other-1','{}','2026-02-01' FROM n;",
            )
            .unwrap();
        let scaled = [metered(&mut database, true), metered(&mut database, false)];
        assert_eq!(baseline[0], scaled[0]);
        // With a following index group, terminating the range needs one extra
        // comparison; work must remain constant rather than visit its 2,000 rows.
        assert!(
            scaled[1] <= baseline[1] + 1,
            "scoped work grew: {baseline:?} -> {scaled:?}"
        );
        eprintln!(
            "navigation_scope_scale rows=2020 events=50000 row_vm_steps={} group_vm_steps={}",
            scaled[0], scaled[1]
        );
        database
            .connection()
            .authorizer(Some(|context: AuthContext<'_>| match context.action {
                AuthAction::Read {
                    table_name: "event_log",
                    ..
                } => Authorization::Deny,
                _ => Authorization::Allow,
            }))
            .unwrap();
        let snapshot = ReadModelService.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.projects.len(), 2);
        let page = ReadModelService
            .navigation_group_camps(&mut database, Some("/local"), 5, 10)
            .unwrap();
        assert_eq!(page.camps.len(), 10);
        let acknowledgement = ReadModelService
            .acknowledge_camp_viewed(&mut database, "local-1", snapshot.through_global_sequence)
            .unwrap();
        assert!(acknowledgement.changed);
        let repeat = ReadModelService
            .acknowledge_camp_viewed(&mut database, "local-1", snapshot.through_global_sequence)
            .unwrap();
        assert!(!repeat.changed);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
