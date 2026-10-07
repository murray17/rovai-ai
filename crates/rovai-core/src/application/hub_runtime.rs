use super::*;

/// Native transports share domain settlement, never each other's wire dialect.
pub(super) trait NativePromptCompletion {
    fn kind(&self) -> AdapterKind;
    fn boundary(&self) -> MissingSendRecoveryBoundary;
    fn terminal(&self) -> impl Future<Output = (Option<String>, Option<String>)> + Send;
    fn delivery_id(&self) -> &str;
    fn prompt_id(&self) -> &str;
    fn session_id(&self) -> &str;
    fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig>;
}

macro_rules! native_completion {
    ($runtime:ty, $kind:ident, $boundary:ident) => {
        impl NativePromptCompletion for $runtime {
            fn kind(&self) -> AdapterKind {
                AdapterKind::$kind
            }
            fn boundary(&self) -> MissingSendRecoveryBoundary {
                MissingSendRecoveryBoundary::$boundary
            }
            async fn terminal(&self) -> (Option<String>, Option<String>) {
                <$runtime>::terminal(self).await
            }
            fn delivery_id(&self) -> &str {
                <$runtime>::delivery_id(self)
            }
            fn prompt_id(&self) -> &str {
                <$runtime>::prompt_id(self)
            }
            fn session_id(&self) -> &str {
                <$runtime>::session_id(self)
            }
            fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
                <$runtime>::builtin_tool_process_config(self)
            }
        }
    };
}
native_completion!(PiRuntime, Pi, PiAgentSettled);
native_completion!(ClineHubRuntime, ClineCli, ClineHubRunResult);

impl Core {
    pub(super) async fn finish_native_run(
        &self,
        kind: AdapterKind,
        run: &str,
        epoch: i64,
        reusable: bool,
    ) {
        match (kind, reusable) {
            (AdapterKind::Pi, true) => self.pi.complete_agent_run(run, epoch).await,
            (AdapterKind::Pi, false) => self.pi.forget_agent_run(run, epoch).await,
            (AdapterKind::ClineCli, true) => self.cline_hub.complete_agent_run(run, epoch).await,
            (AdapterKind::ClineCli, false) => self.cline_hub.forget_agent_run(run, epoch).await,
            _ => unreachable!("unsupported native prompt settlement"),
        }
    }

    pub(super) async fn launch_cline_hub_agent_run(
        &self,
        launch: PreparedRuntimeLaunch<'_>,
    ) -> Result<()> {
        let PreparedRuntimeLaunch {
            execution,
            resume_disposition,
            skill_exposure,
            mcp_projection,
            attachment_admission,
            attachment_authorization,
            output,
            launch_permit,
        } = launch;
        ThreadAttachmentRunAccess {
            admission: attachment_admission,
            authorization: attachment_authorization,
        }
        .prove(execution)?;
        launch_permit.check_cancelled()?;
        let binding = self
            .prepare_initial_builtin_tool_binding(execution, resume_disposition)
            .await?;
        let bootstrap = {
            let mut database = self.database.lock().await;
            ContextService.prepare_session_bootstrap(
                &mut database,
                &ManagedBlobStore::new(&self.data_dir),
                &execution.agent_run_id,
                execution.execution_epoch,
                CharterDeliveryMode::ManagedSystemPrompt,
            )?
        };
        if bootstrap.native_binding_id != binding.native_binding_id
            || bootstrap.native_binding_generation != binding.native_binding_generation
        {
            anyhow::bail!("Cline Hub Bootstrap does not match its Native Binding");
        }
        // Full frozen config/projection digests contain Run-local audit fields.
        // Fleet compatibility must describe only the actual Host inputs.
        let digest = canonical_json_digest(&json!({"protocol":crate::cline_hub::PROTOCOL,
            "hostConfig":execution.runtime.host_config_digest,"model":execution.runtime.model,
            "nativePermissions":execution.runtime.permissions,"workspace":execution.workspace,
            "permissions":execution.permission_semantics,
            "mcp":mcp_projection.servers,"attachmentRoot":attachment_authorization.output_root,
            "builtinContract":rovai_core::builtin_tool_transport::BUILTIN_TOOL_RUNTIME_CAPABILITY,
            "bootstrap":canonical_json_digest(&json!(bootstrap.payload))?,
            "native":crate::cline_hub::native_configuration_digest()?}))?;
        self.persist_runtime_compatibility_digest(execution, &digest)
            .await?;
        let delivery_id = uuid::Uuid::new_v4().to_string();
        let prompt = format!("cline-hub:{}", uuid::Uuid::new_v4());
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        let runtime = self
            .cline_hub
            .ensure(HubRuntimeRequest {
                run: &execution.agent_run_id,
                epoch: execution.execution_epoch,
                camp: &execution.camp_id,
                agent: &execution.agent_id,
                auto_approve: execution.permission_semantics
                    == PermissionSemantics::RuntimeManagedV2
                    && execution.runtime.permissions.values["auto_approve"] == "true",
                cwd: Path::new(&execution.workspace.execution_root),
                runtime: &execution.runtime,
                digest: &digest,
                native_session: binding.native_session_id.as_deref(),
                delivery: &delivery_id,
                prompt: &prompt,
                bootstrap: &bootstrap,
                builtin_tools: &builtin_tools,
                servers: &mcp_projection.servers,
            })
            .await?;
        self.bind_builtin_tool_runtime(
            runtime
                .builtin_tool_process_config()
                .context("Cline Hub tool lease missing")?,
            execution,
            &binding,
        )
        .await?;
        self.bind_prepared_native_session(execution, &binding, runtime.session_id())
            .await?;
        let prepared = self
            .materialize_and_prepare_agent_run_input(
                execution,
                ThreadAttachmentRunAccess {
                    admission: attachment_admission,
                    authorization: attachment_authorization,
                },
                skill_exposure,
                Some(mcp_projection),
                RuntimeInputPreparationRequest {
                    charter_delivery_mode: CharterDeliveryMode::ManagedSystemPrompt,
                    proposed_delivery_id: Some(&delivery_id),
                },
                output,
            )
            .await?;
        let Some((context, delivery)) = prepared else {
            self.cline_hub
                .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                .await;
            return Ok(());
        };
        if delivery.id != delivery_id || delivery.status != "prepared" {
            anyhow::bail!(
                "Cline Hub input is not a new prepared delivery; automatic replay is forbidden"
            );
        }
        self.begin_agent_run_input_dispatch(execution, &delivery.id, launch_permit)
            .await?;
        if let Err(error) = runtime.start_prompt(&context.rendered_payload).await {
            let mut database = self.database.lock().await;
            ContextService.mark_input_delivery_unknown(
                &mut database,
                &delivery.id,
                "Cline Hub input acceptance is unknown",
            )?;
            return Err(error);
        }
        self.complete_active_runtime_route_handoff(
            execution,
            RuntimeRouteBinding {
                route_identity: runtime.host_instance_id().into(),
                adapter_turn_correlation: prompt,
                provider_turn_id: None,
            },
            launch_permit,
        )
        .await?;
        Ok(())
    }
}

pub(super) async fn process_hub_events(
    core: Arc<Core>,
    mut receiver: mpsc::UnboundedReceiver<HubIncoming>,
    output: mpsc::UnboundedSender<String>,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        let incoming = tokio::select! { value = receiver.recv() => match value {Some(v)=>v,None=>break}, _=&mut shutdown=>break };
        if let HubIncoming::Flushed(tx) = incoming {
            let _ = tx.send(());
            continue;
        }
        let Some(mut route) = core.planned_shutdown.enter_runtime_route().await else {
            break;
        };
        match incoming {
            HubIncoming::Event {
                runtime,
                sequence,
                event,
                payload,
            } => {
                if core
                    .cline_hub
                    .get_agent_run_on_host(
                        runtime.host_instance_id(),
                        runtime.run_id(),
                        runtime.epoch(),
                    )
                    .await
                    .is_none()
                {
                    continue;
                }
                if let Err(error) = process_hub_event(
                    &core, &output, &runtime, sequence, &event, &payload, &mut route,
                )
                .await
                {
                    eprintln!("Cline Hub ingress failed: {error:#}");
                    process_hub_exit(
                        &core,
                        &output,
                        runtime.host_instance_id(),
                        runtime.run_id(),
                        runtime.epoch(),
                    )
                    .await;
                }
            }
            HubIncoming::Exited { host, run, epoch } => {
                process_hub_exit(&core, &output, &host, &run, epoch).await
            }
            HubIncoming::Flushed(_) => unreachable!(),
        }
    }
}

async fn process_hub_event(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    runtime: &ClineHubRuntime,
    sequence: u64,
    event: &str,
    payload: &Value,
    route: &mut rovai_core::planned_shutdown::RuntimeRoutePermit,
) -> Result<()> {
    let run = runtime.run_id();
    let epoch = runtime.epoch();
    if event == "accepted" {
        let native_run = payload["runId"]
            .as_str()
            .context("Cline Hub acceptance missing native Run ID")?;
        if let Some(execution) = core
            .acknowledge_native_agent_start(run, epoch, runtime.delivery_id(), native_run)
            .await?
        {
            core.complete_network_recovery_after_input_acceptance(run, epoch)
                .await;
            emit(
                output,
                "agent_run.started",
                json!({"threadId":execution.camp_id,"threadTurnId":execution.camp_turn_id,
                "agentRunId":run,"agentId":execution.agent_id,"executionEpoch":epoch,"adapterKind":AdapterKind::ClineCli,
                "adapterInstallationId":execution.runtime.installation_id,"runtimeVersion":execution.runtime.reported_version,
                "modelId":execution.runtime.model.model_id,"hostInstanceId":runtime.host_instance_id(),
                "nativeThreadId":runtime.session_id(),"nativeTurnId":runtime.prompt_id(),"nativeRunId":native_run}),
            );
            emit_navigation_invalidated(output, "agent_run.started", Some(&execution.camp_id));
        }
    } else if event == "model.metrics" {
        let execution = {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default().load_agent_run_execution(&database, run, epoch)?
        };
        if let Some(execution) = execution
            && runtime_model_observation_admitted(&execution.runtime.model.source)
            && let Some(model) = payload["modelId"].as_str()
        {
            record_runtime_model_observation(
                core,
                output,
                AdapterKind::ClineCli,
                &execution.camp_id,
                run,
                epoch,
                model,
            )
            .await?;
        }
        let mut usage = crate::cline::parse_observations(payload);
        for item in &mut usage {
            item.dialect_id = "cline-native-hub-model-v1".into();
        }
        buffer_runtime_usage(
            core,
            run,
            epoch,
            &format!(
                "cline-hub:{}:{}:{sequence}",
                runtime.host_instance_id(),
                runtime.prompt_id()
            ),
            &usage,
        )
        .await?;
    } else if event == "approval.requested" {
        prepare_hub_approval(core, output, runtime, payload).await?;
    } else if event == "settled" {
        if let Err(error) = flush_runtime_monitoring_run(core, run, epoch, "terminal_flush").await {
            eprintln!("Cline Hub terminal metrics flush failed: {error:#}");
        }
        persist_native_prompt_completion(
            core,
            output,
            runtime,
            runtime.host_instance_id(),
            run,
            epoch,
            route,
        )
        .await?;
    } else {
        let (event, completion) = runtime.normalize(event, payload).await?;
        if let Some((event_type, payload)) = event {
            let evidence = persist_runtime_evidence(
                core,
                run,
                epoch,
                runtime
                    .builtin_tool_process_config()
                    .map(BuiltinToolProcessConfig::run_tmp),
                event_type,
                &payload,
            )
            .await?;
            if !ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type)
                || evidence.is_some()
            {
                emit(
                    output,
                    event_type,
                    json!({"agentRunId":run,"executionEpoch":epoch,"adapterKind":AdapterKind::ClineCli,
                    "nativeMethod":event_type,"evidenceId":evidence.as_ref().map(|e|&e.id),
                    "revision":evidence.as_ref().and_then(|e|e.revision),"changeSequence":evidence.as_ref().and_then(|e|e.change_sequence),
                    "payload":evidence.as_ref().map(|e|&e.payload).unwrap_or(&payload),"canonical":evidence.as_ref().and_then(|e|e.canonical.as_ref())}),
                );
            }
        }
        if let Some(completion) = completion {
            record_acp_action_completion(
                core,
                output,
                AdapterKind::ClineCli,
                run,
                epoch,
                completion,
            )
            .await?;
        }
    }
    Ok(())
}

async fn prepare_hub_approval(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    runtime: &ClineHubRuntime,
    payload: &Value,
) -> Result<()> {
    let execution = {
        let database = core.database.lock().await;
        ExecutionRuntimeService::default().load_agent_run_execution(
            &database,
            runtime.run_id(),
            runtime.epoch(),
        )?
    };
    let Some(execution) = execution else {
        return runtime
            .respond(payload["approvalId"].clone(), json!({"approved":false}))
            .await;
    };
    if execution.permission_semantics == PermissionSemantics::CoreEnforcedV1
        && execution.workspace.access == "read_only"
        && !matches!(
            payload["toolName"].as_str(),
            Some("read_files" | "search_codebase" | "skills")
        )
    {
        return runtime
            .respond(payload["approvalId"].clone(), json!({"approved":false}))
            .await;
    }
    let (id, input, request) = runtime.approval(payload, &execution.workspace.execution_root)?;
    let result = {
        let mut database = core.database.lock().await;
        ActionSafetyService::default().prepare_action(
            &mut database,
            &CommandEnvelope {
                command_id: format!("runtime-action-prepare:{id}"),
                actor: ActorRef::Agent {
                    agent_id: execution.agent_id.clone(),
                    source_agent_run_id: runtime.run_id().into(),
                },
                camp_id: Some(execution.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: Some(runtime.epoch()),
                payload: PrepareActionCommand {
                    action_id: id,
                    input,
                    control_mode: ActionControlMode::Intercepted,
                    native_action_id: Some(request.native_item_id.clone()),
                    runtime_request: Some(request),
                    reason: payload["toolName"].as_str().map(str::to_owned),
                    execute_before: None,
                    requested_for_user_id: CURRENT_USER_ID.into(),
                },
            },
        )
    };
    match result {
        Ok(result) if result.result.status != CommandResultStatus::Rejected => {
            emit(
                output,
                "action.prepared",
                json!({"agentRunId":runtime.run_id(),"executionEpoch":runtime.epoch(),"nativeMethod":crate::cline_hub::APPROVAL_METHOD,"result":result.result,"replayed":result.replayed}),
            );
            Ok(())
        }
        other => {
            runtime
                .respond(payload["approvalId"].clone(), json!({"approved":false}))
                .await?;
            other.map(|_| ())
        }
    }
}

async fn process_hub_exit(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    host: &str,
    run: &str,
    epoch: i64,
) {
    if core.planned_shutdown.shutdown_started()
        || core
            .cline_hub
            .get_agent_run_on_host(host, run, epoch)
            .await
            .is_none()
    {
        return;
    }
    let _ = flush_runtime_monitoring_run(core, run, epoch, "host_exit_flush").await;
    // A socket close provides no native terminal and is never prompt acceptance
    // or a safe retry boundary. The common loss reconciler owns Unknown actions.
    let result = async {
        let mut database = core.database.lock().await;
        let Some(execution) = ExecutionRuntimeService::default().load_agent_run_execution(&database,run,epoch)? else { return Ok::<_,anyhow::Error>(()); };
        let recovery = ActionSafetyService::default().reconcile_runtime_loss(&mut database,&CommandEnvelope {
            command_id:uuid::Uuid::new_v4().to_string(),actor:ActorRef::System { component_id:"runtime-recovery-coordinator".into() },camp_id:Some(execution.camp_id.clone()),expected_versions:Vec::new(),execution_epoch:None,
            payload:ReconcileRuntimeLossCommand {agent_run_id:run.into(),expected_version:execution.version,execution_epoch:epoch,reason:"cline_hub_transport_lost".into()} })?;
        emit_agent_run_terminal(output,Some(&execution.camp_id),json!({"agentRunId":run,"executionEpoch":epoch,"adapterKind":AdapterKind::ClineCli,"result":recovery.result}));
        Ok(())
    }.await;
    if let Err(error) = result {
        eprintln!("Cline Hub loss reconciliation failed: {error:#}");
    }
    core.cline_hub.forget_agent_run(run, epoch).await;
    core.planned_shutdown
        .remove_active(&ActiveExecutionKey::new(run, epoch))
        .await;
    core.agent_run_cancellation_notify.notify_one();
    core.delivery_batch_scheduler_notify.notify_one();
}
