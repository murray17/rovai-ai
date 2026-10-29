//! One claim snapshot owns both FIFO sizing and later input assembly.
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BootstrapContents {
    pub session_charter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_guidance: Option<String>,
    pub platform_skills: String,
    pub memory_entrypoint: String,
    pub observed_memory_revisions: Vec<Value>,
    pub authorization_basis_digest: String,
}

impl BootstrapContents {
    pub(super) fn read<R: ContextReadConnection>(
        database: &R,
        data_dir: &std::path::Path,
        snapshot: &RunSnapshot,
    ) -> Result<Self> {
        let connection = database.context_connection();
        let session_charter = build_session_charter(
            snapshot,
            camp_has_active_file_delivery_binding(connection, &snapshot.camp_id)?,
            mission_facts(connection, snapshot)?.is_some(),
        )?;
        let (memory_entrypoint, observed_memory_revisions, authorization_basis_digest) =
            if snapshot.invocation_kind == "single_chat" {
                (
                    String::new(),
                    Vec::new(),
                    canonical_json_digest(&json!({
                        "schemaVersion": 1, "memoryAccess": "none"
                    }))?,
                )
            } else {
                build_memory_entrypoint(database, snapshot)?
            };
        let managed = crate::managed_skills::ManagedSkills::for_data_dir(data_dir)?;
        managed.sync()?;
        let (entries, omitted) = managed.index(crate::managed_skills::PLATFORM_SKILLS);
        anyhow::ensure!(
            omitted.is_empty(),
            "platform Skill source is unavailable: {}",
            omitted.join("; ")
        );
        Ok(Self {
            team_guidance: if snapshot.invocation_kind == "single_chat" {
                None
            } else {
                crate::teams::thread_guidance(connection, &snapshot.camp_id)?
            },
            session_charter,
            platform_skills: format!(
                "[ROVAI_PLATFORM_SKILLS]\n{}\n[/ROVAI_PLATFORM_SKILLS]",
                managed.index_json(&entries)?
            ),
            memory_entrypoint,
            observed_memory_revisions,
            authorization_basis_digest,
        })
    }

    fn payload(&self, member_identity: &MemberIdentityBootstrapProjection) -> Result<String> {
        render_session_bootstrap(
            &self.session_charter,
            member_identity,
            self.team_guidance.as_deref(),
            Some(&self.platform_skills),
            &self.memory_entrypoint,
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaimedBatchContext {
    pub(super) bootstrap: BootstrapContents,
    pub(super) member_identity: MemberIdentityBootstrapProjection,
    #[serde(flatten)]
    pub(super) dynamic: input::DynamicInputContext,
    pub(super) run_input: Value,
    bootstrap_reserve: usize,
}

impl ClaimedBatchContext {
    pub(super) fn available_run_input(
        input: &Value,
        links: &[crate::current_input_skill::CurrentInputSkillLink],
    ) -> Value {
        let mut input = input.clone();
        if let Some(messages) = input.get_mut("messages").and_then(Value::as_array_mut) {
            for (index, message) in messages.iter_mut().enumerate() {
                if let Some(skills) = message.get_mut("skills").and_then(Value::as_array_mut) {
                    skills.retain(|skill| {
                        links.iter().any(|link| {
                            // v2 links are deduplicated by source ID. Their index/name
                            // describe the first mention; later messages retain their alias.
                            skill["path"].as_str() == Some(link.path.as_str())
                                && (link.skill_id.is_some()
                                    || (link
                                        .message_index
                                        .is_none_or(|message_index| message_index == index)
                                        && skill["name"].as_str() == Some(link.name.as_str())))
                        })
                    });
                    if skills.is_empty() {
                        message
                            .as_object_mut()
                            .expect("message projection is an object")
                            .remove("skills");
                    }
                }
            }
        }
        input
    }

    pub(crate) fn prepare(
        transaction: &Transaction<'_>,
        request: &DeliveryContextPreview<'_>,
        workspace_fact: Option<&Value>,
    ) -> Result<Self> {
        let snapshot = prospective_delivery_snapshot(transaction, request)?;
        let data_dir = std::path::Path::new(
            transaction
                .path()
                .context("Core database path is unavailable")?,
        )
        .parent()
        .context("Core data directory is unavailable")?;
        let bootstrap = BootstrapContents::read(transaction, data_dir, &snapshot)?;
        let member_identity = load_latest_member_identity(transaction, &snapshot.agent_id)?;
        let adapter = run_snapshot_adapter_kind(&snapshot)?;
        let may_redeliver = crate::compaction::release_default_policy(adapter)
            == crate::compaction::CompactionDetectorPolicy::BestEffort
            || has_pending_bootstrap_redelivery(transaction, &snapshot)?;
        // A resumed Session may need a new Bootstrap or be replaced after claim.
        // Reserve actual frozen bytes, never zero merely because an old digest exists.
        let bootstrap_reserve = if adapter == AdapterKind::HermesCli {
            hermes_rules::envelope("update", &bootstrap.payload(&member_identity)?).len() + 2
        } else if request.charter_delivery_mode == CharterDeliveryMode::FirstPayload
            || may_redeliver
        {
            render_bootstrap_redelivery_overlay(&bootstrap.payload(&member_identity)?).len() + 2
        } else {
            0
        };
        Ok(Self {
            bootstrap,
            member_identity,
            dynamic: input::DynamicInputContext::prepare(transaction, &snapshot, workspace_fact)?,
            run_input: json!({"messages": []}),
            bootstrap_reserve,
        })
    }

    pub(crate) fn with_input(
        &self,
        transaction: &Transaction<'_>,
        request: &DeliveryContextPreview<'_>,
        run_input: Value,
        skills: &SkillSelectionSnapshot,
        previous_boundary: i64,
        additional_messages: bool,
    ) -> Result<Self> {
        let mut selected = self.clone();
        let mut snapshot = prospective_delivery_snapshot(transaction, request)?;
        snapshot.skill_selection_snapshot = skills.clone();
        selected.additional_skills = prepare_additional_skills(
            transaction,
            std::path::Path::new(
                transaction
                    .path()
                    .context("Core database path is unavailable")?,
            )
            .parent()
            .context("Core data directory is unavailable")?,
            &snapshot,
        )?;
        selected.run_input = run_input;
        let mut facts: Value = serde_json::from_str(&selected.run_facts.payload_json)?;
        facts["historyHint"] = json!(public_history_hint(previous_boundary, additional_messages));
        selected.run_facts.payload_json = serde_json::to_string(&facts)?;
        selected.run_facts.references.push(RunFactRef {
            fact: "history_hint".into(),
            task_id: None,
            mission_id: None,
        });
        while selected.payload_len()? > request.max_payload_bytes && !selected.tasks.is_empty() {
            selected.tasks.pop();
            selected.omitted_tasks += 1;
        }
        Ok(selected)
    }

    pub(crate) fn payload_len(&self) -> Result<usize> {
        let tasks = self
            .tasks_enabled
            .then(|| self_active_task_projection(&self.tasks, self.omitted_tasks))
            .flatten();
        let facts = self.run_facts_for_session(true)?;
        let payload = render_payload(RenderPayloadInput {
            collaboration_state: Some(&self.collaboration_state),
            self_active_tasks: tasks.as_ref(),
            shared_conversation: None,
            run_facts: &facts,
            workspace: self.workspace.value.as_ref(),
            additional_skills: Some(&self.additional_skills.section),
            a2a_guidance: None,
            single_chat_guidance: None,
            current_input: None,
            run_input: Some(&self.run_input),
        })?;
        Ok(payload.len().saturating_add(self.bootstrap_reserve))
    }

    pub(crate) fn persist(&self, transaction: &Transaction<'_>, run_id: &str) -> Result<()> {
        transaction.execute(
            "INSERT INTO agent_run_claim_context(agent_run_id, context_json) VALUES (?1, ?2)",
            params![run_id, serde_json::to_string(self)?],
        )?;
        Ok(())
    }
}

pub(super) fn load(connection: &Connection, run_id: &str) -> Result<Option<ClaimedBatchContext>> {
    // Historical inputs retain their original materializer, including databases
    // exercised at intermediate migration boundaries.
    let current: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_run_input WHERE agent_run_id=?1 AND context_manifest_version IN (36, 37, 38, 39, 40, 43))",
        [run_id], |row| row.get(0),
    )?;
    if !current {
        return Ok(None);
    }
    let json: Option<String> = connection
        .query_row(
            "SELECT context_json FROM agent_run_claim_context WHERE agent_run_id=?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()?;
    let json = json.context("Public batch is missing its claimed context")?;
    Ok(Some(
        serde_json::from_str(&json).context("Invalid claimed batch context")?,
    ))
}

impl std::ops::Deref for ClaimedBatchContext {
    type Target = input::DynamicInputContext;
    fn deref(&self) -> &Self::Target {
        &self.dynamic
    }
}
impl std::ops::DerefMut for ClaimedBatchContext {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.dynamic
    }
}
