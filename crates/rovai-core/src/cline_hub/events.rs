use super::*;
use crate::{
    acp::CompletedAcpAction,
    action::{
        ActionResultOutcome, CanonicalActionInput, RuntimeActionRequestBinding,
        RuntimePermissionOption,
    },
    command::canonical_json_digest,
};

impl ClineHubRuntime {
    pub(super) async fn hook(self: &Arc<Self>, payload: &Value) -> Result<()> {
        let context = &payload["payload"]["context"];
        if !context["snapshot"]["parentAgentId"].is_null() {
            return Ok(());
        }
        let run = context["snapshot"]["runId"]
            .as_str()
            .context("cline_hub_hook_run_missing")?;
        let name = payload["capabilityName"]
            .as_str()
            .context("cline_hub_hook_name_missing")?;
        if name == "rovai.beforeRun" {
            let mut active = self.native_run.write().await;
            if active.as_ref().is_some_and(|id| id != run) {
                bail!("cline_hub_native_run_changed");
            }
            if active.is_none() {
                *active = Some(run.to_owned());
                self.emit("accepted", json!({"runId":run}));
            }
            return Ok(());
        }
        if self.native_run.read().await.as_deref() != Some(run) {
            bail!("cline_hub_hook_fenced");
        }
        if name == "rovai.beforeModel" {
            let system = context["request"]["systemPrompt"]
                .as_str()
                .context("cline_hub_system_rule_unverified")?;
            if system.matches(&self.bootstrap).count() != 1 {
                bail!("cline_hub_system_rule_mismatch");
            }
            self.observed_model.store(true, Ordering::Release);
        } else if name == "rovai.afterModel" {
            let message = &context["assistantMessage"];
            for (configured, observed) in [("modelId", "id"), ("providerId", "provider")] {
                if let Some(expected) = self.host.session_config[configured].as_str()
                    && message["modelInfo"][observed].as_str() != Some(expected)
                {
                    bail!("cline_hub_native_model_changed");
                }
            }
            let Some(id) = message["id"].as_str().filter(|s| !s.is_empty()) else {
                return Ok(());
            };
            let mut metrics = json!({});
            for key in [
                "inputTokens",
                "outputTokens",
                "cacheReadTokens",
                "cacheWriteTokens",
                "reasoningTokenCount",
            ] {
                if let Some(value) = message["metrics"][key]
                    .as_i64()
                    .filter(|n| *n >= 0 && *n <= 9_007_199_254_740_991)
                {
                    metrics[key] = json!(value);
                }
            }
            let provider = &message["modelInfo"]["provider"];
            let model = &message["modelInfo"]["id"];
            let window = model.as_str().and_then(|id| {
                self.host.session_config["knownModels"][id]["contextWindow"].as_i64()
            });
            self.emit(
                "model.metrics",
                json!({"schemaVersion":1,"kind":"model_completed","sessionId":self.session,
                "runId":run,"messageId":id,"metrics":metrics,"providerId":provider,"modelId":model,
                "contextWindow":window,"contextWindowSource":"native_models_config"}),
            );
        } else {
            bail!("cline_hub_unregistered_hook");
        }
        Ok(())
    }

    pub(crate) async fn normalize(
        &self,
        event: &str,
        value: &Value,
    ) -> Result<(Option<(&'static str, Value)>, Option<CompletedAcpAction>)> {
        match event {
            "assistant.delta" => {
                return Ok((
                    Some(("agent.text.delta", json!({"delta":value["text"]}))),
                    None,
                ));
            }
            "reasoning.delta" => {
                return Ok((
                    Some(("agent.thought.delta", json!({"delta":value["text"]}))),
                    None,
                ));
            }
            "tool.started" | "tool.finished" => {}
            _ => return Ok((None, None)),
        }
        let Some(id) = value["toolCallId"].as_str().filter(|s| !s.is_empty()) else {
            return Ok((None, None));
        };
        let mut tools = self.tools.lock().await;
        if event == "tool.started" {
            if tools.len() >= 1024 && !tools.contains_key(id) {
                bail!("cline_hub_tool_budget_exceeded");
            }
            tools.insert(id.into(), value.clone());
        }
        let started = if event == "tool.finished" {
            tools.remove(id)
        } else {
            tools.get(id).cloned()
        };
        let name = value["toolName"]
            .as_str()
            .or_else(|| started.as_ref().and_then(|v| v["toolName"].as_str()))
            .unwrap_or("unknown");
        let input = started
            .as_ref()
            .map(|v| v["input"].clone())
            .unwrap_or(Value::Null);
        // Use Cline's typed tool-result decoder. This
        // is a local result record, never an ACP envelope or synthetic wire event.
        let mut result = json!({"title":name,"rawInput":input,"rawOutput":value["output"],
            "status":if event == "tool.started" { "in_progress" } else if value["error"].is_null() { "completed" } else { "failed" }});
        crate::cline::enrich_tool_update(&mut result, None);
        let kind = match name {
            "run_commands" => "execute",
            "read_files" => "read",
            "apply_patch" | "editor" => "edit",
            "search_codebase" => "search",
            _ => "other",
        };
        let text = result
            .pointer("/content/0/content/text")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| value["output"].as_str().map(str::to_owned));
        let mut public = json!({"toolCallId":id,"toolName":name,"status":result["status"],"kind":kind,"input":result["rawInput"],"output":text});
        if let Some(locations) = result.get("locations") {
            public["locations"] = locations.clone();
        }
        if let Some(entries) = result.pointer("/_meta/rovaiClineMutation/entries") {
            public["runtimeDiff"] = json!({"adapterKind":"cline-cli","protocolFamily":PROTOCOL,"sourceEventKind":format!("tool.finished.completed.{name}"),"semanticKind":"reported_mutation","entries":entries});
        }
        if event == "tool.started" {
            return Ok((Some(("runtime.action", public)), None));
        }
        let failed = result["status"] == "failed";
        if self.denied_tools.lock().await.remove(id) {
            if !failed {
                bail!("cline_hub_denied_tool_executed");
            }
            // ActionSafety already recorded not_executed/none. Native rejection
            // is public tool evidence, not a second observed side effect.
            return Ok((Some(("runtime.action", public)), None));
        }
        let path = (!failed && matches!(kind, "read" | "edit"))
            .then(|| result["locations"].as_array())
            .flatten()
            .filter(|locations| locations.len() == 1)
            .and_then(|locations| locations[0]["path"].as_str())
            .map(str::to_owned);
        let file_kind = path
            .as_ref()
            .map(|_| if kind == "read" { "read" } else { "write" }.to_owned());
        if let (Some(path), Some(operation)) = (&path, &file_kind) {
            public["runtimeFileOperation"] = json!({
                "adapterKind":"cline-cli", "protocolFamily":PROTOCOL,
                "sourceEventKind":format!("tool.finished.completed.{name}"),
                "operationKind":operation, "path":path
            });
        }
        let completion = CompletedAcpAction {
            native_item_id: id.into(),
            native_kind: kind.into(),
            public_command: result["rawInput"]["command"].as_str().map(str::to_owned),
            public_search_operation_candidate: None,
            public_file_operation_kind: file_kind,
            public_file_operation_path: path,
            public_file_operation_change_kind: None,
            public_file_changes: None,
            observation_digest: canonical_json_digest(value)?,
            outcome: if failed {
                ActionResultOutcome::Failed
            } else {
                ActionResultOutcome::Succeeded
            },
            result_code: if failed {
                "cline_tool_failed"
            } else {
                "cline_tool_completed"
            }
            .into(),
            result_summary: format!(
                "Cline {name} {}",
                if failed { "failed" } else { "completed" }
            ),
            result_data: json!({"nativeItemId":id,"status":result["status"],"kind":kind,"title":name,
                "rawInputDigest":canonical_json_digest(&result["rawInput"])?,
                "rawOutputDigest":canonical_json_digest(&value["output"])?}),
            effect_disposition: if failed {
                "unknown"
            } else if matches!(kind, "read" | "search") {
                "none"
            } else {
                "complete"
            }
            .into(),
        };
        Ok((Some(("runtime.action", public)), Some(completion)))
    }

    pub(crate) fn approval(
        &self,
        payload: &Value,
        cwd: &str,
    ) -> Result<(String, CanonicalActionInput, RuntimeActionRequestBinding)> {
        let id = payload["approvalId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .context("cline_hub_approval_missing_id")?;
        let tool = payload["toolCallId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .context("cline_hub_approval_missing_tool")?;
        let digest = canonical_json_digest(payload)?;
        let input = CanonicalActionInput::RuntimePermissionGrant {
            cwd: cwd.into(),
            permissions: json!({"clineHubTool":payload}),
            request_digest: digest,
        };
        let options = [true, false]
            .into_iter()
            .map(|approved| {
                RuntimePermissionOption::from_native(
                    if approved {
                        "allow_once"
                    } else {
                        "reject_once"
                    },
                    if approved { "allow_once" } else { "deny" },
                    if approved { "允许一次" } else { "拒绝" },
                    if approved {
                        "执行当前工具调用"
                    } else {
                        "不执行当前工具调用"
                    },
                    json!({"approved":approved}),
                    approved,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        let request = RuntimeActionRequestBinding {
            native_method: APPROVAL_METHOD.into(),
            native_request_id: json!(id),
            native_item_id: tool.into(),
            native_thread_id: self.session.clone(),
            native_turn_id: self.prompt.clone(),
            response_context: payload.clone(),
            options,
        };
        Ok((
            format!(
                "action-{}",
                canonical_json_digest(&json!([self.run, self.epoch, id, tool]))?
            ),
            input,
            request,
        ))
    }
}
