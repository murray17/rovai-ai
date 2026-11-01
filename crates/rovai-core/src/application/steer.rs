use super::*;

enum ActiveInputRuntime {
    Codex(Arc<codex::CodexRuntime>, String),
    Claude(Arc<crate::claude_control::ClaudeControl>),
    Pi(Arc<pi::PiRuntime>),
    Acp(Arc<acp::AcpRuntime>, String),
}

impl ActiveInputRuntime {
    async fn submit(
        &self,
        input_id: &str,
        payload: &str,
        images: &[PiPromptImage],
    ) -> Result<String> {
        match self {
            Self::Codex(runtime, turn) => runtime.steer(turn, payload).await,
            Self::Claude(runtime) => runtime.steer(input_id, payload).await,
            Self::Pi(runtime) => runtime.steer(payload, images).await,
            Self::Acp(runtime, prompt) => runtime.steer(prompt, input_id, payload).await,
        }
    }
}

impl Core {
    pub(super) async fn dispatch_active_input(
        &self,
        pending: rovai_core::steer::PendingInput,
    ) -> bool {
        let result = self.deliver_active_input(&pending).await;
        if let Err(error) = result {
            // Preparation errors belong to this source, never to the ongoing Run.
            let mut database = self.database.lock().await;
            let recorded = (|| -> Result<()> {
                let tx = database.connection_mut().transaction()?;
                rovai_core::steer::fail_preparation(&tx, &pending.delivery_id)?;
                tx.commit()?;
                Ok(())
            })();
            if let Err(failure) = recorded {
                eprintln!("failed to record input preparation failure: {failure:#}");
            }
            eprintln!("active input preparation failed: {error:#}");
        }
        let database = self.database.lock().await;
        let camp: Option<String> = database
            .connection()
            .query_row(
                "SELECT camp_id FROM camp_message_delivery WHERE id=?1",
                [&pending.delivery_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if let Some(camp) = camp {
            emit_navigation_invalidated(&self.output, "delivery.input_changed", Some(&camp));
        }
        true
    }

    async fn deliver_active_input(&self, pending: &rovai_core::steer::PendingInput) -> Result<()> {
        let execution = {
            let database = self.database.lock().await;
            let availability = rovai_core::steer::active_input_availability(
                database.connection(),
                &pending.agent_run_id,
                pending.execution_epoch,
            )?;
            if !availability.can_steer {
                drop(database);
                return self.queue_unsubmitted_input(&pending.delivery_id).await;
            }
            if !availability.ready {
                return Ok(());
            }
            ExecutionRuntimeService::default().load_agent_run_execution(
                &database,
                &pending.agent_run_id,
                pending.execution_epoch,
            )?
        };
        let Some(execution) = execution else {
            return self.queue_unsubmitted_input(&pending.delivery_id).await;
        };
        let runtime = match execution.runtime.adapter_kind {
            AdapterKind::CodexCli => {
                if let Some(runtime) = self
                    .codex_cli
                    .get_agent_run(&pending.agent_run_id, pending.execution_epoch)
                    .await
                {
                    runtime
                        .turn_id()
                        .await
                        .map(|turn| ActiveInputRuntime::Codex(runtime, turn))
                } else {
                    None
                }
            }
            AdapterKind::ClaudeCodeCli => self
                .claude_code_cli
                .get_agent_run(&pending.agent_run_id, pending.execution_epoch)
                .map(ActiveInputRuntime::Claude),
            AdapterKind::Pi => self
                .pi
                .get_agent_run(&pending.agent_run_id, pending.execution_epoch)
                .await
                .map(ActiveInputRuntime::Pi),
            kind => {
                if let Some(adapter) = self.acp_adapter(kind)
                    && let Some(runtime) = adapter
                        .get_agent_run(&pending.agent_run_id, pending.execution_epoch)
                        .await
                {
                    runtime
                        .prompt_id()
                        .await
                        .map(|prompt| ActiveInputRuntime::Acp(runtime, prompt))
                } else {
                    None
                }
            }
        };
        let Some(runtime) = runtime else {
            return self.queue_unsubmitted_input(&pending.delivery_id).await;
        };
        let sources = {
            let database = self.database.lock().await;
            let json: String = database.connection().query_row(
                "SELECT m.source_attachments_json FROM camp_message m JOIN camp_message_delivery d ON d.message_id=m.id WHERE d.id=?1",
                [&pending.delivery_id], |r|r.get(0))?;
            rovai_core::local_attachment_source::parse_source_attachments(&json)?
        };
        let paths =
            tokio::task::spawn_blocking(move || resolve_source_attachments_for_run(&sources))
                .await
                .context("Source Attachment input resolver task failed")??;
        let mut reads = rovai_core::context::LegacyAttachmentReads::new();
        let (context, input) = loop {
            let attempt: Result<_> = async {
                let mut database = self.database.lock().await;
                if !rovai_core::steer::active_input_availability(
                    database.connection(),
                    &pending.agent_run_id,
                    pending.execution_epoch,
                )?
                .ready
                    || ExecutionRuntimeService::default()
                        .load_agent_run_execution(
                            &database,
                            &pending.agent_run_id,
                            pending.execution_epoch,
                        )?
                        .is_none()
                {
                    let tx = database.connection_mut().transaction()?;
                    rovai_core::steer::return_to_queue(
                        &tx,
                        &pending.delivery_id,
                        &chrono::Utc::now().to_rfc3339(),
                    )?;
                    tx.commit()?;
                    return Ok(None);
                }
                let context = ContextService.materialize_with_attachment_reads(
                    &mut database,
                    &ManagedBlobStore::new(&self.data_dir),
                    None,
                    None,
                    &paths,
                    &MaterializeContextRequest {
                        agent_run_id: &pending.agent_run_id,
                        execution_epoch: pending.execution_epoch,
                        charter_delivery_mode:
                            rovai_core::context::charter_delivery_mode_for_adapter(
                                execution.runtime.adapter_kind,
                            ),
                        max_payload_bytes: runtime_max_context_payload_bytes(&execution.runtime),
                    },
                    Some(&pending.delivery_id),
                    &reads,
                )?;
                let ContextMaterialization::Ready(context) = context else {
                    return Ok(None);
                };
                let input = ContextService.prepare_input_delivery_for_context(
                    &mut database,
                    &pending.agent_run_id,
                    pending.execution_epoch,
                    &context,
                )?;
                if input.status != "prepared" {
                    return Ok(None);
                }
                Ok(Some((context, input)))
            }
            .await;
            match attempt {
                Ok(Some(prepared)) => break prepared,
                Ok(None) => return Ok(()),
                Err(error) => {
                    self.resolve_pending_legacy_attachment_reads(error, &mut reads)
                        .await?
                }
            }
        };
        let images = if let ActiveInputRuntime::Pi(pi) = &runtime {
            self.prepare_pi_input_images(&input.id, &context.rendered_payload, pi)
                .await?
        } else {
            Vec::new()
        };
        {
            let mut database = self.database.lock().await;
            if !ContextService.begin_runtime_input_dispatch(
                &mut database,
                &input.id,
                &pending.agent_run_id,
                pending.execution_epoch,
            )? {
                return Ok(());
            }
        }
        emit_navigation_invalidated(
            &self.output,
            "delivery.input_changed",
            Some(&execution.camp_id),
        );
        match runtime
            .submit(&input.id, &context.runtime_payload, &images)
            .await
        {
            Ok(native_id) => {
                let mut database = self.database.lock().await;
                ContextService.acknowledge_input_delivery(&mut database, &input.id, &native_id)?;
            }
            Err(error)
                if error
                    .downcast_ref::<rovai_core::steer::ActiveInputNotAccepted>()
                    .is_some()
                    || error
                        .downcast_ref::<codex::CodexResponseError>()
                        .is_some_and(codex::CodexResponseError::input_was_not_accepted) =>
            {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_not_accepted(
                    &mut database,
                    &input.id,
                    &error.to_string(),
                )?;
                let tx = database.connection_mut().transaction()?;
                rovai_core::steer::return_to_queue(
                    &tx,
                    &pending.delivery_id,
                    &chrono::Utc::now().to_rfc3339(),
                )?;
                tx.commit()?;
            }
            Err(error) => {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &input.id,
                    &error.to_string(),
                )?;
            }
        }
        Ok(())
    }

    pub(super) async fn reconcile_active_input(&self, delivery_id: &str) -> Result<Value> {
        let evidence = {
            let database = self.database.lock().await;
            let row = database.connection().query_row(
                "SELECT i.id,i.agent_run_id,i.execution_epoch,i.status,initial.native_input_id,m.rendered_payload_blob_id
                 FROM camp_message_delivery d JOIN camp_message msg ON msg.id=d.message_id
                 JOIN context_manifest m ON m.source_delivery_id=d.id
                 JOIN runtime_input_delivery i ON i.context_manifest_id=m.id
                 JOIN runtime_input_delivery initial ON initial.agent_run_id=i.agent_run_id AND initial.execution_epoch=i.execution_epoch AND initial.input_kind='start'
                 WHERE d.id=?1 AND msg.author_type='user' AND d.requested_mode='steer'",
                [delivery_id], |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,String>(5)?))).optional()?;
            let Some(row) = row else {
                return Ok(json!({"status":"unavailable"}));
            };
            if row.3 != "delivery_unknown" {
                return Ok(json!({"status":row.3}));
            }
            let payload = ManagedBlobStore::new(&self.data_dir).read_text(&database, &row.5)?;
            (row, payload)
        };
        let ((id, run, epoch, _, turn, _), payload) = evidence;
        if let (Some(turn), Some(runtime)) = (turn, self.codex_cli.get_agent_run(&run, epoch).await)
        {
            if runtime.contains_steered_input(&turn, &payload).await? {
                let mut database = self.database.lock().await;
                ContextService.acknowledge_input_delivery(&mut database, &id, &turn)?;
                return Ok(json!({"status":"accepted"}));
            }
        }
        Ok(json!({"status":"delivery_unknown"}))
    }

    async fn queue_unsubmitted_input(&self, delivery_id: &str) -> Result<()> {
        let mut database = self.database.lock().await;
        let tx = database.connection_mut().transaction()?;
        rovai_core::steer::return_to_queue(&tx, delivery_id, &chrono::Utc::now().to_rfc3339())?;
        tx.commit()?;
        Ok(())
    }
}
