//! Dynamic public input construction is independent of the Runtime delivery operation.
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DynamicInputContext {
    pub(super) collaboration_state: Value,
    #[serde(default = "legacy_tasks_enabled")]
    pub(super) tasks_enabled: bool,
    pub(super) tasks: Vec<SelectedSelfActiveTask>,
    pub(super) omitted_tasks: usize,
    pub(super) run_facts: RenderedRunFacts,
    pub(super) mission_details_version: Option<i64>,
    pub(super) workspace: PreparedWorkspaceFact,
    pub(super) additional_skills: PreparedAdditionalSkills,
    had_native_session: bool,
}

// Missing only in historical frozen claim DTOs; new preparations always set it.
fn legacy_tasks_enabled() -> bool {
    true
}

impl DynamicInputContext {
    pub(super) fn prepare<R: ContextReadConnection>(
        database: &R,
        snapshot: &RunSnapshot,
        workspace: Option<&Value>,
    ) -> Result<Self> {
        let connection = database.context_connection();
        let data_dir = std::path::Path::new(
            connection
                .path()
                .context("Core database path is unavailable")?,
        )
        .parent()
        .context("Core data directory is unavailable")?;
        let members = load_collaboration_projection_members(database, &snapshot.camp_id)?;
        let tasks_enabled = snapshot.invocation_kind != "single_chat"
            && crate::task_capability::enabled(connection)?;
        let (tasks, omitted_tasks) = if tasks_enabled {
            load_self_active_tasks(
                database,
                snapshot,
                current_public_camp_batch_context_delivery_profile()?.max_self_active_tasks,
            )?
        } else {
            (Vec::new(), 0)
        };
        let (facts, mission_details_version) = build_run_facts(database, snapshot, false, 0)?;
        Ok(Self {
            collaboration_state: build_collaboration_state(&members, &snapshot.agent_id),
            tasks_enabled,
            tasks,
            omitted_tasks,
            run_facts: render_run_facts(&facts)?,
            mission_details_version,
            workspace: match workspace {
                Some(value) => PreparedWorkspaceFact {
                    value: Some(value.clone()),
                    digest: Some(canonical_json_digest(value)?),
                    included: true,
                },
                None => prepare_workspace_fact(database, snapshot, false, false)?,
            },
            additional_skills: prepare_additional_skills(connection, data_dir, snapshot)?,
            had_native_session: snapshot.native_session_id.is_some(),
        })
    }

    pub(super) fn run_facts_for_session(&self, new_session: bool) -> Result<RenderedRunFacts> {
        let mut facts = self.run_facts.clone();
        if new_session && self.had_native_session {
            let mut value: Value = serde_json::from_str(&facts.payload_json)?;
            value["sessionContinuity"] =
                json!({"state":"lost", "requiredAction":"recheck_private_session_assumptions"});
            facts.payload_json = serde_json::to_string(&value)?;
            facts.references.push(RunFactRef {
                fact: "session_continuity".into(),
                task_id: None,
                mission_id: None,
            });
        }
        Ok(facts)
    }
}

pub(super) fn select_delivery(
    database: &mut Database,
    snapshot: &mut RunSnapshot,
    delivery_id: &str,
) -> Result<BatchModelContext> {
    let tx = database.connection_mut().transaction()?;
    let (message_id, content, boundary): (String, Option<String>, i64) = tx.query_row(
        "SELECT m.id,m.structured_content_json,c.last_message_sequence FROM camp_message_delivery d
         JOIN camp_message m ON m.id=d.message_id JOIN camp c ON c.id=d.camp_id
         WHERE d.id=?1 AND d.claimed_agent_run_id=?2 AND d.recipient_agent_id=?3
           AND d.target_execution_epoch=?4 AND d.status='claimed' AND d.requested_mode='steer' AND m.author_type='user'
           AND m.tombstoned_at IS NULL AND m.recall_state<>'withdrawn'",
        params![delivery_id,snapshot.agent_run_id,snapshot.agent_id,snapshot.execution_epoch], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let content: Vec<crate::camp_content::StructuredThreadMessageSegment> = content
        .map(|value| serde_json::from_str(&value))
        .transpose()?
        .unwrap_or_default();
    snapshot.skill_selection_snapshot =
        crate::current_input_skill::freeze_skill_selection_with_messages(
            &tx,
            &content,
            &vec![0; content.len()],
            run_snapshot_adapter_kind(snapshot)?,
        )?;
    snapshot.skill_selection_snapshot_digest =
        snapshot.skill_selection_snapshot.canonical_digest()?;
    snapshot.camp_message_boundary_sequence = boundary;
    snapshot.trigger_camp_message_id = Some(message_id.clone());
    snapshot.claim_previous_public_boundary_sequence =
        Some(snapshot.last_accepted_public_boundary_sequence);
    snapshot.claim_has_additional_public_messages =
        Some(crate::delivery_queue::has_additional_public_messages(
            &tx,
            &snapshot.camp_id,
            &snapshot.agent_id,
            snapshot.last_accepted_public_boundary_sequence,
            boundary,
            &[message_id.clone()],
        )?);
    let messages = project_public_input_messages(
        &tx,
        &snapshot.camp_id,
        boundary,
        &[message_id],
        &mut SenderNames::default(),
    )?;
    tx.commit()?;
    Ok(messages)
}
