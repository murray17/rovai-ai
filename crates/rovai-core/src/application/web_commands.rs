//! Read-only reconciliation of individually admitted user commands. A missing
//! receipt remains unknown; this path never dispatches the original command.
use super::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reconcile {
    operation: String,
    params: Value,
}

fn receipt<C: rovai_core::command::DomainCommand>(
    database: &Database,
    envelope: CommandEnvelope<C>,
) -> Result<Value> {
    Ok(DomainCommandGateway
        .replay_if_recorded(database, &envelope)?
        .map(|execution| json!({"state":"recorded", "result":execution.result}))
        .unwrap_or_else(|| json!({"state":"unknown"})))
}

pub(super) fn reconcile(
    database: &Database,
    data_dir: &Path,
    client: &rovai_core::draft_client::DraftClient,
    value: Value,
) -> Result<Value> {
    let query: Reconcile = serde_json::from_value(value)?;
    macro_rules! camp {
        ($kind:ty) => {{
            let params: UserCommandParams<$kind> = serde_json::from_value(query.params)?;
            receipt(
                database,
                user_camp_command_envelope(
                    params.command_id,
                    params.command.camp_id.clone(),
                    params.command,
                ),
            )
        }};
    }
    macro_rules! user {
        ($kind:ty) => {{
            let params: UserCommandParams<$kind> = serde_json::from_value(query.params)?;
            receipt(
                database,
                user_command_envelope(params.command_id, params.command),
            )
        }};
    }
    match query.operation.as_str() {
        "camp.messages.send" => {
            let mut params: SendCampMessageParams = serde_json::from_value(query.params)?;
            params.draft_client = client.clone();
            let mut value = receipt(database, params.envelope())?;
            if value["state"] == "recorded" {
                value["result"] = json!({"commandResult":value["result"].take(), "replayed":true, "preflight":null, "pendingExecution":null});
            }
            Ok(value)
        }
        "action.approvals.resolve" => {
            let params: ResolveActionApprovalParams = serde_json::from_value(query.params)?;
            receipt(database, params.envelope())
        }
        "agentRuns.cancel" => camp!(CancelAgentRunCommand),
        "campTurns.cancel" => camp!(CancelCampTurnCommand),
        "camps.changeDefaultLead" => camp!(ChangeDefaultLeadCommand),
        "camps.members.add" => camp!(AddCampMemberCommand),
        "camps.members.remove" => camp!(RemoveCampMemberCommand),
        "members.create" => user!(CreateAgentProfileCommand),
        "members.update" => user!(UpdateAgentProfileCommand),
        "members.avatar.set" => user!(SetAgentProfileAvatarCommand),
        "members.runtime.set" => user!(SetMemberRuntimeConfigurationCommand),
        "members.runtime.clear" => user!(ClearMemberRuntimeConfigurationCommand),
        "camp.pendingInputs.edit" => {
            let mut params: UserCommandParams<
                rovai_core::pending_camp_input::EditPendingCampInputCommand,
            > = serde_json::from_value(query.params)?;
            params.command.draft_client = client.clone();
            receipt(
                database,
                user_camp_command_envelope(
                    params.command_id,
                    params.command.camp_id.clone(),
                    params.command,
                ),
            )
        }
        "messageQuotes.mutateDraft" => {
            let mut params: UserCommandParams<rovai_core::message_quote::MutateQuoteDraftCommand> =
                serde_json::from_value(query.params)?;
            params.command.draft_client = client.clone();
            anyhow::ensure!(
                params.command.conversation_id.is_none(),
                "Private Draft client scope is not admitted yet"
            );
            let value = receipt(
                database,
                user_camp_command_envelope(
                    params.command_id,
                    params.command.camp_id.clone(),
                    params.command.clone(),
                ),
            )?;
            if value["state"] == "recorded" {
                // The command's receipt proves whether it ran; the API response
                // is the current authorized Draft, like the original handler.
                if value["result"]["status"] == "rejected" {
                    // A durable rejection is a known outcome, not a failure to
                    // read the receipt. Preserve the original handler's error
                    // while letting a disconnected client settle its promise.
                    let code = &value["result"]["code"];
                    return Ok(json!({"state":"recorded", "error":{"code":code,"message":code}}));
                }
                Ok(
                    json!({"state":"recorded", "result":CampAttachmentStore::for_client(data_dir, client.clone()).load_draft(database, &params.command.camp_id)?}),
                )
            } else {
                Ok(value)
            }
        }
        "camps.create" => {
            let params: CreateCampParams = serde_json::from_value(query.params)?;
            let (project_binding_kind, path) = match params.workspace {
                Some(workspace) => (
                    ProjectBindingKind::Directory,
                    // Web admission already required this exact canonical
                    // spelling. Receipt reads must not inspect an arbitrary
                    // path or depend on the workspace still existing.
                    PathBuf::from(workspace.project_path),
                ),
                None => (
                    ProjectBindingKind::QuickChat,
                    std::fs::canonicalize(data_dir.join("quick-chat"))
                        .context("Quick Chat workspace is unavailable for reconciliation")?,
                ),
            };
            receipt(
                database,
                user_command_envelope(
                    params.command_id,
                    CreateCampCommand {
                        name: params.name,
                        project_binding_kind,
                        project_path: path.to_string_lossy().into_owned(),
                        member_agent_ids: params.member_agent_ids,
                        default_lead_agent_id: params.default_lead_agent_id,
                        collaboration_mode: params.collaboration_mode,
                        activation_state: params.activation_state,
                    },
                ),
            )
        }
        _ => anyhow::bail!("command reconciliation is not admitted"),
    }
}
