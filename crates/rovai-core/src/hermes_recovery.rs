//! Explicit User maintenance of one native unknown admission. No business Run
//! or input is created here; native receipts own resolution and idempotence.
use super::{Core, user_camp_command_envelope};
use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    command::{
        CommandHandlerResult, CommandResultStatus, DomainCommand, DomainCommandGateway, sealed,
    },
    runtime::{AgentRunWorkspace, PermissionSemantics},
};
use anyhow::{Context, Result, ensure};
use rusqlite::{OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const WARNING: &str = "该次任务可能已经产生文件修改、公开消息或其他外部效果。放弃追认只解除 Hermes 原会话的未知执行阻塞，不撤销这些效果，不重做原任务，也不把原任务改为成功。处理后请发送一条新的任务。";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecoveryScope {
    pub agent_run_id: String,
    pub run_version: i64,
    pub execution_epoch: i64,
    #[serde(rename = "threadId")]
    pub camp_id: String,
    pub agent_id: String,
    pub native_binding_id: String,
    pub native_binding_generation: i64,
    pub native_session_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Confirmation {
    scope: RecoveryScope,
    admission_id: String,
    execution_generation: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectParams {
    agent_run_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveParams {
    command_id: String,
    confirmation: Confirmation,
    acknowledge_effects: bool,
}
impl sealed::Sealed for ResolveParams {}
impl DomainCommand for ResolveParams {
    const TYPE: &'static str = "hermes.recovery.authorize";
}

#[derive(Serialize)]
struct RecoveryOutcome {
    confirmation: Confirmation,
    receipt: Value,
}
impl sealed::Sealed for RecoveryOutcome {}
impl DomainCommand for RecoveryOutcome {
    const TYPE: &'static str = "hermes.recovery.result";
}

struct Target {
    scope: RecoveryScope,
    runtime: FrozenAgentRuntimeConfig,
    workspace: AgentRunWorkspace,
    permission_semantics: PermissionSemantics,
}

fn target(connection: &Transaction<'_>, run: &str) -> Result<Target> {
    let row = connection.query_row(
        "SELECT run.id,run.version,run.execution_epoch,run.camp_id,conversation.agent_id,
                conversation.native_binding_id,conversation.native_binding_generation,conversation.native_session_id,
                conversation.id,run.workspace_json,run.permission_semantics
         FROM agent_run AS run JOIN conversation ON conversation.id=run.conversation_id
         JOIN camp ON camp.id=run.camp_id
         JOIN camp_member AS member ON member.camp_id=run.camp_id AND member.agent_id=conversation.agent_id
         JOIN agent_profile AS profile ON profile.id=conversation.agent_id
         WHERE run.id=?1 AND run.status IN ('failed','cancelled') AND run.runtime_adapter_kind='hermes-cli'
           AND camp.deletion_operation_id IS NULL AND member.status='active' AND profile.profile_status='present'
           AND conversation.native_session_id IS NOT NULL AND conversation.native_binding_id IS NOT NULL
           AND EXISTS(SELECT 1 FROM runtime_input_delivery AS input WHERE input.agent_run_id=run.id
               AND input.native_binding_id=conversation.native_binding_id
               AND input.native_binding_generation=conversation.native_binding_generation
               AND (input.status IN ('accepted','delivery_unknown') OR input.dispatch_started_at IS NOT NULL))
           AND NOT EXISTS(SELECT 1 FROM agent_run AS active WHERE active.conversation_id=run.conversation_id
               AND (active.status NOT IN ('succeeded','failed','cancelled')
                 OR (active.cancel_requested_at IS NOT NULL AND active.cancel_acknowledged_at IS NULL)))",
        [run], |row| Ok((RecoveryScope {
            agent_run_id: row.get(0)?, run_version: row.get(1)?, execution_epoch: row.get(2)?,
            camp_id: row.get(3)?, agent_id: row.get(4)?, native_binding_id: row.get(5)?,
            native_binding_generation: row.get(6)?, native_session_id: row.get(7)?,
        }, row.get::<_,String>(8)?, row.get::<_,String>(9)?, row.get::<_,String>(10)?)),
    ).optional()?.context("Recovery requires a settled Hermes Run on its original binding with confirmed process cleanup; stop active work and inspect the original interrupted Run")?;
    // The old Run identifies the original Session/storage and execution, not
    // the executable that must be used forever. Resolve today's selection just
    // as a new ordinary input does; the live Host probes its actual capabilities.
    let mut runtime =
        crate::agent_profile::resolve_frozen_runtime(connection, &row.1, &row.0.agent_id)?
            .map_err(|blocker| anyhow::anyhow!("{}: {}", blocker.code, blocker.payload))?;
    ensure!(
        runtime.adapter_kind == AdapterKind::HermesCli,
        "Hermes Runtime identity mismatch"
    );
    runtime.environment = Some(crate::member_environment::current_for_launch(
        connection,
        &row.0.agent_id,
        AdapterKind::HermesCli,
    )?);
    if runtime
        .environment
        .as_ref()
        .is_some_and(|env| env.has_overlay())
    {
        runtime.custom_api = None;
    }
    let workspace: AgentRunWorkspace = serde_json::from_str(&row.2)?;
    workspace.validate()?;
    Ok(Target {
        scope: row.0,
        runtime,
        workspace,
        permission_semantics: PermissionSemantics::parse(&row.3)?,
    })
}

impl Core {
    pub(crate) async fn handle_hermes_recovery(&self, method: &str, value: Value) -> Result<Value> {
        let resolve: Option<ResolveParams> = if method.ends_with(".resolve") {
            let params: ResolveParams = serde_json::from_value(value.clone())?;
            ensure!(
                params.acknowledge_effects,
                "Explicit acknowledgement of possible external effects is required"
            );
            ensure!(
                !params.confirmation.admission_id.is_empty()
                    && params.confirmation.admission_id.len() <= 256
                    && params.confirmation.execution_generation > 0,
                "Invalid native execution identity"
            );
            Some(params)
        } else {
            None
        };
        let run = match &resolve {
            Some(params) => params.confirmation.scope.agent_run_id.clone(),
            None => serde_json::from_value::<InspectParams>(value)?.agent_run_id,
        };
        let target = {
            let mut database = self.database.lock().await;
            let target = {
                let transaction = database.connection_mut().transaction()?;
                target(&transaction, &run)?
            };
            if let Some(params) = &resolve {
                ensure!(
                    target.scope == params.confirmation.scope,
                    "Recovery inspection is stale; inspect again"
                );
                // Durable User intent precedes the native mutation. An unknown
                // transport response is reconciled using this exact identity.
                let receipt = DomainCommandGateway.execute(
                    &mut database,
                    &user_camp_command_envelope(
                        params.command_id.clone(),
                        target.scope.camp_id.clone(),
                        params.clone(),
                    ),
                    |_| {
                        Ok(CommandHandlerResult::accepted(
                            "hermes.recovery.authorized",
                            json!({"confirmation":params.confirmation,"warning":WARNING}),
                            None,
                        ))
                    },
                )?;
                ensure!(
                    receipt.result.status != CommandResultStatus::Rejected,
                    "Recovery authorization was rejected"
                );
                ensure!(
                    receipt.result.payload["confirmation"]
                        == serde_json::to_value(&params.confirmation)?,
                    "This commandId belongs to another confirmation; reuse the original inspection"
                );
            }
            target
        };
        self.subsystems
            .require(&super::runtime_subsystem_id(AdapterKind::HermesCli))?;
        let mut native_params = json!({"sessionId":target.scope.native_session_id});
        if let Some(params) = &resolve {
            native_params["admissionId"] = json!(params.confirmation.admission_id);
            native_params["executionGeneration"] = json!(params.confirmation.execution_generation);
            native_params["acknowledgeEffects"] = json!(true);
        }
        let native = self
            .hermes_cli
            .recover_hermes_session(
                &target.scope,
                &target.workspace,
                target.permission_semantics,
                target.runtime,
                native_params,
            )
            .await?;
        ensure!(
            native["sessionId"] == target.scope.native_session_id,
            "Recovery returned another session"
        );
        if let Some(params) = resolve {
            let receipt = &native["receipt"];
            ensure!(
                receipt["admission_id"] == params.confirmation.admission_id
                    && receipt["execution_generation"] == params.confirmation.execution_generation
                    && receipt["session_id"] == target.scope.native_session_id
                    && receipt["status"] == "terminal",
                "Recovery outcome is uncertain; inspect or retry the same confirmation"
            );
            let mut database = self.database.lock().await;
            let recorded = DomainCommandGateway.execute(&mut database,
                &user_camp_command_envelope(format!("{}:outcome", params.command_id), target.scope.camp_id,
                    RecoveryOutcome { confirmation: params.confirmation, receipt: receipt.clone() }),
                |_| Ok(CommandHandlerResult::applied("hermes.recovery.resolved", json!({
                    "nativeReceipt":receipt,"originalRunUnchanged":true,"taskReplayed":false,
                    "message":"原生未知执行已处理。原任务状态与证据保留；现在可以在原会话发送一条新任务。"
                }),None)))?;
            return Ok(serde_json::to_value(recorded.result)?);
        }
        let receipts = native["receipts"]
            .as_array()
            .context("Invalid recovery inspection")?;
        let unknown: Vec<_> = receipts
            .iter()
            .filter(|row| row["status"] == "unknown")
            .collect();
        let confirmation = if native["state"] == "unknown" && unknown.len() == 1 {
            Some(Confirmation {
                scope: target.scope.clone(),
                admission_id: unknown[0]["admission_id"]
                    .as_str()
                    .context("Missing admission identity")?
                    .into(),
                execution_generation: unknown[0]["execution_generation"]
                    .as_i64()
                    .context("Missing execution generation")?,
            })
        } else {
            None
        };
        Ok(
            json!({"scope":target.scope,"nativeReceipts":receipts,"confirmation":confirmation,
            "state":native["state"],"warning":WARNING,
            "taskReplayed":false,"originalRunUnchanged":true}),
        )
    }
}
