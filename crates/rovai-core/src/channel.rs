use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    camp_content::{
        ExternalQuoteAttachmentSummary, StructuredCampMessageContent, StructuredCampMessageSegment,
        canonical_content_digest, mentions_current_user, normalize_content, validate_content,
    },
    camp_id::CampId,
    collaboration::{
        AddCampMemberCommand, CampMembershipMutationSource, CollaborationService,
        ExternalChannelAdmissionInput, RemoveCampMemberCommand,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, CommandResultStatus,
        DomainCommand, DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    current_user::CURRENT_USER_ID,
    db::Database,
};

const FEISHU_PROVIDER: &str = "feishu";
const FEISHU_CHANNEL_HOST_COMPONENT: &str = "feishu-channel-host";
const CHANNEL_MEMBERSHIP_SYNC_COMPONENT: &str = "channel-membership-sync";
const AGGREGATION_WINDOW_SECONDS: i64 = 3;
const DELIVERY_LEASE_SECONDS: i64 = 30;
const CHANNEL_TRANSPORT_RETENTION_DAYS: i64 = 7;
const MAX_DELIVERY_ATTEMPTS: i64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectBindingCommand {
    pub display_name: String,
    pub binding_kind: String,
    pub canonical_path: String,
}

impl sealed::Sealed for CreateProjectBindingCommand {}
impl DomainCommand for CreateProjectBindingCommand {
    const TYPE: &'static str = "project_binding.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectBindingCommand {
    pub project_binding_id: String,
    pub display_name: String,
    pub expected_version: i64,
}

impl sealed::Sealed for UpdateProjectBindingCommand {}
impl DomainCommand for UpdateProjectBindingCommand {
    const TYPE: &'static str = "project_binding.update";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProjectBindingCommand {
    pub project_binding_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for ArchiveProjectBindingCommand {}
impl DomainCommand for ArchiveProjectBindingCommand {
    const TYPE: &'static str = "project_binding.archive";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindChannelConversationCommand {
    pub channel_conversation_id: String,
    pub project_binding_id: String,
    pub expected_conversation_version: i64,
}

impl sealed::Sealed for BindChannelConversationCommand {}
impl DomainCommand for BindChannelConversationCommand {
    const TYPE: &'static str = "channel_conversation.bind";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertFeishuAccountCommand {
    pub account_id: String,
    pub user_id_digest: String,
    pub tenant_id: String,
    pub user_name: String,
    pub email: Option<String>,
    pub tenant_name: String,
    pub brand: String,
}

impl sealed::Sealed for UpsertFeishuAccountCommand {}
impl DomainCommand for UpsertFeishuAccountCommand {
    const TYPE: &'static str = "feishu_account.upsert";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectFeishuAccountCommand {
    pub account_id: String,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpireFeishuAccountCommand {
    pub account_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for ExpireFeishuAccountCommand {}
impl DomainCommand for ExpireFeishuAccountCommand {
    const TYPE: &'static str = "feishu_account.expire";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemberBotPublicationIntentCommand {
    pub publication_intent_id: String,
    pub account_id: String,
    pub agent_id: String,
    pub expected_user_id_digest: String,
    pub expected_tenant_id: String,
    pub requested_app_name: String,
    pub provisioning_mode: String,
}

impl sealed::Sealed for CreateMemberBotPublicationIntentCommand {}
impl DomainCommand for CreateMemberBotPublicationIntentCommand {
    const TYPE: &'static str = "feishu_member_bot_publication_intent.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceMemberBotPublicationIntentCommand {
    pub publication_intent_id: String,
    pub expected_version: i64,
    pub state: String,
    pub remote_app_id: Option<String>,
    pub credential_ref: Option<String>,
    pub last_completed_step: Option<String>,
    pub failure_code: Option<String>,
}

impl sealed::Sealed for AdvanceMemberBotPublicationIntentCommand {}
impl DomainCommand for AdvanceMemberBotPublicationIntentCommand {
    const TYPE: &'static str = "feishu_member_bot_publication_intent.advance";
}

impl sealed::Sealed for DisconnectFeishuAccountCommand {}
impl DomainCommand for DisconnectFeishuAccountCommand {
    const TYPE: &'static str = "feishu_account.disconnect";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertFeishuMemberBotCommand {
    pub account_id: String,
    pub agent_id: String,
    pub app_id: String,
    pub bot_open_id: Option<String>,
    pub bot_display_name: String,
    pub credential_ref: String,
}

impl sealed::Sealed for UpsertFeishuMemberBotCommand {}
impl DomainCommand for UpsertFeishuMemberBotCommand {
    const TYPE: &'static str = "feishu_member_bot.upsert";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelAttachmentSummaryInput {
    pub name: String,
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalQuoteInput {
    pub sender_display_name: String,
    pub body: String,
    #[serde(default)]
    pub attachment_summaries: Vec<ChannelAttachmentSummaryInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserveChannelInboundCommand {
    pub provider: String,
    pub app_id: String,
    pub external_message_id: String,
    pub tenant_key: String,
    pub chat_id: String,
    #[serde(default)]
    pub topic_key: String,
    pub conversation_kind: String,
    pub conversation_display_name: String,
    pub sender_external_user_id: String,
    pub sender_open_id: Option<String>,
    pub sender_user_id: Option<String>,
    pub sender_union_id: Option<String>,
    pub sender_display_name: String,
    pub body: String,
    #[serde(default)]
    pub attachment_summaries: Vec<ChannelAttachmentSummaryInput>,
    #[serde(default)]
    pub quote: Option<ExternalQuoteInput>,
    pub canonical_agent_ids: Vec<String>,
    pub canonical_mentions_complete: bool,
    pub expected_app_ids: Vec<String>,
    pub acknowledgement_app_id: String,
}

impl sealed::Sealed for ObserveChannelInboundCommand {}
impl DomainCommand for ObserveChannelInboundCommand {
    const TYPE: &'static str = "channel_inbound.observe";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeChannelInboundCommand {
    pub aggregate_id: String,
}

impl sealed::Sealed for FinalizeChannelInboundCommand {}
impl DomainCommand for FinalizeChannelInboundCommand {
    const TYPE: &'static str = "channel_inbound.finalize";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileFeishuGroupRosterCommand {
    pub provider: String,
    pub tenant_key: String,
    pub chat_id: String,
    pub present_app_ids: Vec<String>,
}

impl sealed::Sealed for ReconcileFeishuGroupRosterCommand {}
impl DomainCommand for ReconcileFeishuGroupRosterCommand {
    const TYPE: &'static str = "channel_group_roster.reconcile";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHostTickCommand {
    pub worker_id: String,
    #[serde(default = "default_delivery_claim_limit")]
    pub limit: usize,
}

fn default_delivery_claim_limit() -> usize {
    20
}

impl sealed::Sealed for ChannelHostTickCommand {}
impl DomainCommand for ChannelHostTickCommand {
    const TYPE: &'static str = "channel_host.tick";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleChannelDeliveryCommand {
    pub delivery_id: String,
    pub worker_id: String,
    pub outcome: String,
    pub external_delivery_message_id: Option<String>,
    pub failure_code: Option<String>,
    #[serde(default)]
    pub retryable: bool,
}

impl sealed::Sealed for SettleChannelDeliveryCommand {}
impl DomainCommand for SettleChannelDeliveryCommand {
    const TYPE: &'static str = "channel_delivery.settle";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBindingView {
    pub project_binding_id: String,
    pub display_name: String,
    pub binding_kind: String,
    pub canonical_path: String,
    pub status: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnboundChannelConversationView {
    pub channel_conversation_id: String,
    pub provider: String,
    pub conversation_kind: String,
    pub display_name: String,
    pub last_sender_display_name: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConversationBindingView {
    pub channel_conversation_id: String,
    pub display_name: String,
    pub conversation_kind: String,
    pub project_binding_id: String,
    pub camp_id: Option<String>,
    pub status: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTransportConversationView {
    pub channel_conversation_id: String,
    pub binding_id: Option<String>,
    pub provider: String,
    pub tenant_key: String,
    pub chat_id: String,
    pub topic_key: String,
    pub conversation_kind: String,
    pub camp_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChannelAggregateView {
    pub aggregate_id: String,
    pub tenant_key: String,
    pub chat_id: String,
    pub topic_key: String,
    pub conversation_kind: String,
    pub acknowledgement_app_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuAccountView {
    pub account_id: String,
    pub user_id_digest: String,
    pub tenant_id: String,
    pub user_name: String,
    pub email: Option<String>,
    pub tenant_name: String,
    pub brand: String,
    pub status: String,
    pub version: i64,
    pub connected_at: String,
    pub last_verified_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberBotPublicationIntentView {
    pub publication_intent_id: String,
    pub agent_id: String,
    pub account_id: String,
    pub expected_user_id_digest: String,
    pub expected_tenant_id: String,
    pub requested_app_name: String,
    pub provisioning_mode: String,
    pub state: String,
    pub remote_app_id: Option<String>,
    pub credential_ref: Option<String>,
    pub last_completed_step: Option<String>,
    pub failure_code: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuMemberBotView {
    pub agent_id: String,
    pub account_id: String,
    pub brand: String,
    pub app_id: String,
    pub bot_display_name: String,
    pub credential_ref: String,
    pub status: String,
    pub failure_code: Option<String>,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuChannelSnapshot {
    pub schema_version: i64,
    pub account: Option<FeishuAccountView>,
    pub member_bots: Vec<FeishuMemberBotView>,
    pub publication_intents: Vec<MemberBotPublicationIntentView>,
    pub project_bindings: Vec<ProjectBindingView>,
    pub unbound_conversations: Vec<UnboundChannelConversationView>,
    pub conversation_bindings: Vec<ChannelConversationBindingView>,
    /// Host-only routing facts. Desktop strips these before exposing settings
    /// state to the Renderer.
    pub transport_conversations: Vec<ChannelTransportConversationView>,
    pub pending_aggregates: Vec<PendingChannelAggregateView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedChannelDelivery {
    pub delivery_id: String,
    pub request_id: String,
    pub delivery_kind: String,
    pub target_app_id: String,
    pub credential_ref: String,
    pub chat_id: String,
    pub topic_key: String,
    pub conversation_kind: String,
    pub payload: Value,
    pub attempt_count: i64,
    pub update_message_id: Option<String>,
    pub recipient_open_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct ChannelService {
    gateway: DomainCommandGateway,
}

impl ChannelService {
    /// Admits explicitly addressed A2A targets into a Feishu topic Camp when
    /// their published Bot is still present in the parent group roster.
    /// Normal Camps and normal Feishu groups are left untouched.
    pub fn ensure_topic_a2a_members(
        &self,
        database: &mut Database,
        camp_id: &str,
        requested_agent_ids: &[String],
        parent_command_id: &str,
    ) -> Result<()> {
        let topic_binding = database
            .connection()
            .query_row(
                r#"
                SELECT binding.id, conversation.tenant_key, conversation.chat_id
                FROM channel_conversation_binding AS binding
                JOIN channel_conversation AS conversation
                  ON conversation.id = binding.channel_conversation_id
                WHERE binding.camp_id = ?1 AND binding.status = 'active'
                  AND conversation.provider = 'feishu'
                  AND conversation.conversation_kind = 'topic'
                "#,
                [camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((binding_id, tenant_key, chat_id)) = topic_binding else {
            return Ok(());
        };
        for agent_id in requested_agent_ids.iter().cloned().collect::<BTreeSet<_>>() {
            let (active, roster_present): (bool, bool) = database.connection().query_row(
                r#"
                SELECT
                    EXISTS(
                        SELECT 1 FROM camp_member
                        WHERE camp_id = ?1 AND agent_id = ?2
                          AND status = 'active' AND leave_requested_at IS NULL
                    ),
                    EXISTS(
                        SELECT 1
                        FROM external_group_bot_roster AS roster
                        JOIN feishu_member_bot AS bot
                          ON bot.app_id = roster.app_id
                         AND bot.agent_id = roster.agent_id
                        WHERE roster.provider = 'feishu'
                          AND roster.tenant_key = ?3 AND roster.chat_id = ?4
                          AND roster.agent_id = ?2 AND roster.status = 'present'
                          AND bot.status = 'published'
                    )
                "#,
                params![camp_id, agent_id, tenant_key, chat_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if active || !roster_present {
                continue;
            }
            let (membership_generation, reconciliation_generation) =
                channel_membership_generations(database, camp_id, &binding_id)?;
            let execution = CollaborationService::default().add_camp_member(
                database,
                &CommandEnvelope {
                    command_id: format!(
                        "{parent_command_id}:{binding_id}:topic-a2a:{agent_id}:{reconciliation_generation}"
                    ),
                    actor: ActorRef::System {
                        component_id: CHANNEL_MEMBERSHIP_SYNC_COMPONENT.to_string(),
                    },
                    camp_id: Some(camp_id.to_string()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AddCampMemberCommand {
                        camp_id: camp_id.to_string(),
                        agent_id,
                        expected_membership_generation: membership_generation,
                        capability_overrides: json!({}),
                        source: Some(CampMembershipMutationSource {
                            namespace: FEISHU_PROVIDER.to_string(),
                            binding_id: binding_id.clone(),
                            reconciliation_generation,
                        }),
                    },
                },
            )?;
            if execution.result.status == CommandResultStatus::Rejected {
                // Preserve the ordinary A2A validation result when membership
                // admission cannot be completed; never route to another Agent.
                continue;
            }
        }
        Ok(())
    }

    pub fn snapshot(&self, database: &Database) -> Result<FeishuChannelSnapshot> {
        let connection = database.connection();
        let account = connection
            .query_row(
                r#"
                SELECT id, user_id_digest, tenant_id, user_name, email,
                       tenant_name, brand, status, version,
                       connected_at, last_verified_at
                FROM feishu_account
                WHERE user_id_digest IS NOT NULL
                  AND tenant_id IS NOT NULL
                  AND user_name IS NOT NULL
                  AND brand IS NOT NULL
                  AND connected_at IS NOT NULL
                  AND last_verified_at IS NOT NULL
                ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END,
                         updated_at DESC, id
                LIMIT 1
                "#,
                [],
                |row| {
                    Ok(FeishuAccountView {
                        account_id: row.get(0)?,
                        user_id_digest: row.get(1)?,
                        tenant_id: row.get(2)?,
                        user_name: row.get(3)?,
                        email: row.get(4)?,
                        tenant_name: row.get(5)?,
                        brand: row.get(6)?,
                        status: row.get(7)?,
                        version: row.get(8)?,
                        connected_at: row.get(9)?,
                        last_verified_at: row.get(10)?,
                    })
                },
            )
            .optional()?;
        let member_bots = query_rows(
            connection,
            r#"
            SELECT bot.agent_id, bot.account_id, COALESCE(account.brand, 'feishu'),
                   bot.app_id, bot.bot_display_name, bot.credential_ref,
                   bot.status, bot.failure_code, bot.version
            FROM feishu_member_bot AS bot
            JOIN feishu_account AS account ON account.id = bot.account_id
            ORDER BY bot.agent_id
            "#,
            [],
            |row| {
                Ok(FeishuMemberBotView {
                    agent_id: row.get(0)?,
                    account_id: row.get(1)?,
                    brand: row.get(2)?,
                    app_id: row.get(3)?,
                    bot_display_name: row.get(4)?,
                    credential_ref: row.get(5)?,
                    status: row.get(6)?,
                    failure_code: row.get(7)?,
                    version: row.get(8)?,
                })
            },
        )?;
        let publication_intents = query_rows(
            connection,
            r#"
            SELECT id, agent_id, account_id, expected_user_id_digest,
                   expected_tenant_id, requested_app_name, provisioning_mode,
                   state, remote_app_id, credential_ref, last_completed_step,
                   failure_code, version, created_at, updated_at
            FROM feishu_member_bot_publication_intent
            ORDER BY created_at DESC, id
            "#,
            [],
            |row| {
                Ok(MemberBotPublicationIntentView {
                    publication_intent_id: row.get(0)?,
                    agent_id: row.get(1)?,
                    account_id: row.get(2)?,
                    expected_user_id_digest: row.get(3)?,
                    expected_tenant_id: row.get(4)?,
                    requested_app_name: row.get(5)?,
                    provisioning_mode: row.get(6)?,
                    state: row.get(7)?,
                    remote_app_id: row.get(8)?,
                    credential_ref: row.get(9)?,
                    last_completed_step: row.get(10)?,
                    failure_code: row.get(11)?,
                    version: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )?;
        let project_bindings = query_rows(
            connection,
            r#"
            SELECT id, display_name, binding_kind, canonical_path, status, version
            FROM project_binding
            ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                     updated_at DESC, id
            "#,
            [],
            |row| {
                Ok(ProjectBindingView {
                    project_binding_id: row.get(0)?,
                    display_name: row.get(1)?,
                    binding_kind: row.get(2)?,
                    canonical_path: row.get(3)?,
                    status: row.get(4)?,
                    version: row.get(5)?,
                })
            },
        )?;
        let unbound_conversations = query_rows(
            connection,
            r#"
            SELECT conversation.id, conversation.provider,
                   conversation.conversation_kind, conversation.display_name,
                   conversation.last_sender_display_name,
                   conversation.first_seen_at, conversation.last_seen_at,
                   conversation.version
            FROM channel_conversation AS conversation
            LEFT JOIN channel_conversation_binding AS binding
              ON binding.channel_conversation_id = conversation.id
            WHERE binding.id IS NULL
            ORDER BY conversation.last_seen_at DESC, conversation.id
            "#,
            [],
            |row| {
                Ok(UnboundChannelConversationView {
                    channel_conversation_id: row.get(0)?,
                    provider: row.get(1)?,
                    conversation_kind: row.get(2)?,
                    display_name: row.get(3)?,
                    last_sender_display_name: row.get(4)?,
                    first_seen_at: row.get(5)?,
                    last_seen_at: row.get(6)?,
                    version: row.get(7)?,
                })
            },
        )?;
        let conversation_bindings = query_rows(
            connection,
            r#"
            SELECT conversation.id, conversation.display_name,
                   conversation.conversation_kind, binding.project_binding_id,
                   binding.camp_id, binding.status, conversation.version
            FROM channel_conversation_binding AS binding
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            ORDER BY conversation.last_seen_at DESC, conversation.id
            "#,
            [],
            |row| {
                Ok(ChannelConversationBindingView {
                    channel_conversation_id: row.get(0)?,
                    display_name: row.get(1)?,
                    conversation_kind: row.get(2)?,
                    project_binding_id: row.get(3)?,
                    camp_id: row.get(4)?,
                    status: row.get(5)?,
                    version: row.get(6)?,
                })
            },
        )?;
        let transport_conversations = query_rows(
            connection,
            r#"
            SELECT conversation.id, binding.id, conversation.provider,
                   conversation.tenant_key, conversation.chat_id,
                   conversation.topic_key, conversation.conversation_kind,
                   binding.camp_id
            FROM channel_conversation AS conversation
            LEFT JOIN channel_conversation_binding AS binding
              ON binding.channel_conversation_id = conversation.id
             AND binding.status = 'active'
            WHERE conversation.conversation_kind IN ('group', 'topic')
            ORDER BY conversation.last_seen_at DESC, conversation.id
            "#,
            [],
            |row| {
                Ok(ChannelTransportConversationView {
                    channel_conversation_id: row.get(0)?,
                    binding_id: row.get(1)?,
                    provider: row.get(2)?,
                    tenant_key: row.get(3)?,
                    chat_id: row.get(4)?,
                    topic_key: row.get(5)?,
                    conversation_kind: row.get(6)?,
                    camp_id: row.get(7)?,
                })
            },
        )?;
        let pending_aggregates = query_rows(
            connection,
            r#"
            SELECT aggregate.id, aggregate.tenant_key, aggregate.chat_id,
                   aggregate.topic_key, conversation.conversation_kind,
                   json_extract(aggregate.frozen_payload_json, '$.acknowledgementAppId')
            FROM channel_inbound_aggregate AS aggregate
            JOIN channel_conversation AS conversation
              ON conversation.id = json_extract(
                   aggregate.frozen_payload_json, '$.conversationId'
                 )
            WHERE aggregate.status = 'collecting'
              AND (
                aggregate.canonical_mentions_complete = 1
                OR NOT EXISTS (
                    SELECT 1
                    FROM json_each(aggregate.expected_app_ids_json) AS expected
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM json_each(aggregate.observed_app_ids_json) AS observed
                        WHERE observed.value = expected.value
                    )
                )
              )
            ORDER BY aggregate.created_at, aggregate.id
            "#,
            [],
            |row| {
                Ok(PendingChannelAggregateView {
                    aggregate_id: row.get(0)?,
                    tenant_key: row.get(1)?,
                    chat_id: row.get(2)?,
                    topic_key: row.get(3)?,
                    conversation_kind: row.get(4)?,
                    acknowledgement_app_id: row.get(5)?,
                })
            },
        )?;
        Ok(FeishuChannelSnapshot {
            schema_version: 1,
            account,
            member_bots,
            publication_intents,
            project_bindings,
            unbound_conversations,
            conversation_bindings,
            transport_conversations,
            pending_aggregates,
        })
    }

    pub fn create_project_binding(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateProjectBindingCommand>,
    ) -> Result<CommandExecution> {
        let display_name = normalize_display_name(&envelope.payload.display_name)?;
        validate_binding_path(
            &envelope.payload.binding_kind,
            &envelope.payload.canonical_path,
        )?;
        let binding_id = format!("rvpb_{}", Uuid::new_v4().simple());
        self.gateway.execute(database, envelope, |transaction| {
            if !is_owner(&envelope.actor) {
                return Ok(rejected(
                    "project_binding.owner_required",
                    "Only the local owner can configure project paths",
                ));
            }
            let now = Utc::now().to_rfc3339();
            let inserted = transaction.execute(
                r#"
                INSERT INTO project_binding(
                    id, display_name, binding_kind, canonical_path,
                    status, version, created_at, updated_at, archived_at
                ) VALUES (?1, ?2, ?3, ?4, 'active', 1, ?5, ?5, NULL)
                ON CONFLICT(canonical_path) DO NOTHING
                "#,
                params![
                    binding_id,
                    display_name,
                    envelope.payload.binding_kind,
                    envelope.payload.canonical_path,
                    now,
                ],
            )?;
            if inserted == 0 {
                return Ok(rejected(
                    "project_binding.path_conflict",
                    "This canonical path already has a Project Binding",
                ));
            }
            Ok(CommandHandlerResult::applied(
                "project_binding.created",
                json!({ "projectBindingId": binding_id, "version": 1 }),
                Some(EntityReference {
                    entity_type: "project_binding".to_string(),
                    entity_id: binding_id.clone(),
                }),
            ))
        })
    }

    pub fn update_project_binding(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateProjectBindingCommand>,
    ) -> Result<CommandExecution> {
        let display_name = normalize_display_name(&envelope.payload.display_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_owner(&envelope.actor) {
                return Ok(rejected(
                    "project_binding.owner_required",
                    "Only the local owner can maintain Project Bindings",
                ));
            }
            let state = transaction
                .query_row(
                    "SELECT status, version FROM project_binding WHERE id = ?1",
                    [&envelope.payload.project_binding_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?;
            let Some((status, version)) = state else {
                return Ok(rejected(
                    "project_binding.not_found",
                    "Project Binding does not exist",
                ));
            };
            if status != "active" {
                return Ok(rejected(
                    "project_binding.archived",
                    "Archived Project Binding cannot be edited",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE project_binding
                SET display_name = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![
                    envelope.payload.project_binding_id,
                    display_name,
                    now,
                    version,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "project_binding.updated",
                json!({
                    "projectBindingId": envelope.payload.project_binding_id,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "project_binding".to_string(),
                    entity_id: envelope.payload.project_binding_id.clone(),
                }),
            ))
        })
    }

    pub fn archive_project_binding(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ArchiveProjectBindingCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_owner(&envelope.actor) {
                return Ok(rejected(
                    "project_binding.owner_required",
                    "Only the local owner can maintain Project Bindings",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM project_binding WHERE id = ?1 AND status = 'active'",
                    [&envelope.payload.project_binding_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected(
                    "project_binding.not_found",
                    "Active Project Binding does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let in_use: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM channel_conversation_binding WHERE project_binding_id = ?1)",
                [&envelope.payload.project_binding_id],
                |row| row.get(0),
            )?;
            if in_use {
                return Ok(rejected(
                    "project_binding.in_use",
                    "Unbind or switch every channel conversation before archiving",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE project_binding
                SET status = 'archived', archived_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![envelope.payload.project_binding_id, now, version],
            )?;
            Ok(CommandHandlerResult::applied(
                "project_binding.archived",
                json!({
                    "projectBindingId": envelope.payload.project_binding_id,
                    "version": version + 1,
                }),
                None,
            ))
        })
    }

    pub fn bind_conversation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<BindChannelConversationCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_owner(&envelope.actor) {
                return Ok(rejected(
                    "channel_binding.owner_required",
                    "Only the local owner can bind channel conversations",
                ));
            }
            let conversation_version = transaction
                .query_row(
                    "SELECT version FROM channel_conversation WHERE id = ?1",
                    [&envelope.payload.channel_conversation_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(conversation_version) = conversation_version else {
                return Ok(rejected(
                    "channel_conversation.not_found",
                    "Channel conversation does not exist",
                ));
            };
            if conversation_version != envelope.payload.expected_conversation_version {
                return Ok(CommandHandlerResult::rejected(
                    "channel_conversation.version_conflict",
                    json!({ "currentVersion": conversation_version }),
                ));
            }
            let binding_active: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM project_binding WHERE id = ?1 AND status = 'active')",
                [&envelope.payload.project_binding_id],
                |row| row.get(0),
            )?;
            if !binding_active {
                return Ok(rejected(
                    "project_binding.not_found",
                    "Active Project Binding does not exist",
                ));
            }
            let existing_binding = transaction
                .query_row(
                    r#"
                    SELECT id, project_binding_id, version
                    FROM channel_conversation_binding
                    WHERE channel_conversation_id = ?1
                    "#,
                    [&envelope.payload.channel_conversation_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((binding_id, project_binding_id, binding_version)) = existing_binding {
                if project_binding_id == envelope.payload.project_binding_id {
                    return Ok(CommandHandlerResult::applied(
                        "channel_binding.unchanged",
                        json!({
                            "bindingId": binding_id,
                            "version": binding_version,
                            "changed": false,
                        }),
                        Some(EntityReference {
                            entity_type: "channel_conversation_binding".to_string(),
                            entity_id: binding_id,
                        }),
                    ));
                }
                let has_open_requests: bool = transaction.query_row(
                    r#"
                    SELECT EXISTS(
                        SELECT 1 FROM channel_turn_request
                        WHERE binding_id = ?1 AND status IN ('queued', 'admitted')
                    )
                    "#,
                    [&binding_id],
                    |row| row.get(0),
                )?;
                if has_open_requests {
                    return Ok(rejected(
                        "channel_binding.busy",
                        "Wait for queued channel turns before switching the project",
                    ));
                }
                let now = Utc::now().to_rfc3339();
                transaction.execute(
                    r#"
                    UPDATE channel_conversation_binding
                    SET project_binding_id = ?2, camp_id = NULL,
                        version = version + 1, updated_at = ?3
                    WHERE id = ?1
                    "#,
                    params![binding_id, envelope.payload.project_binding_id, now],
                )?;
                transaction.execute(
                    r#"
                    UPDATE channel_conversation
                    SET version = version + 1, last_seen_at = ?2
                    WHERE id = ?1 AND version = ?3
                    "#,
                    params![
                        envelope.payload.channel_conversation_id,
                        now,
                        conversation_version,
                    ],
                )?;
                return Ok(CommandHandlerResult::applied(
                    "channel_binding.switched",
                    json!({
                        "bindingId": binding_id,
                        "version": binding_version + 1,
                        "changed": true,
                    }),
                    Some(EntityReference {
                        entity_type: "channel_conversation_binding".to_string(),
                        entity_id: binding_id,
                    }),
                ));
            }
            let binding_id = format!("rvcb_{}", Uuid::new_v4().simple());
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO channel_conversation_binding(
                    id, channel_conversation_id, project_binding_id,
                    camp_id, status, version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 'active', 1, ?4, ?4)
                "#,
                params![
                    binding_id,
                    envelope.payload.channel_conversation_id,
                    envelope.payload.project_binding_id,
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE channel_conversation
                SET version = version + 1, last_seen_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![
                    envelope.payload.channel_conversation_id,
                    now,
                    conversation_version,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "channel_binding.created",
                json!({ "bindingId": binding_id, "version": 1, "changed": true }),
                Some(EntityReference {
                    entity_type: "channel_conversation_binding".to_string(),
                    entity_id: binding_id.clone(),
                }),
            ))
        })
    }

    pub fn upsert_feishu_account(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpsertFeishuAccountCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(&envelope.payload.account_id, "accountId")?;
        validate_digest(&envelope.payload.user_id_digest, "userIdDigest")?;
        validate_nonempty(&envelope.payload.tenant_id, "tenantId")?;
        let user_name = normalize_display_name(&envelope.payload.user_name)?;
        let email = normalize_optional_email(envelope.payload.email.as_deref())?;
        let tenant_name = normalize_display_name(&envelope.payload.tenant_name)?;
        if !matches!(envelope.payload.brand.as_str(), "feishu" | "lark") {
            anyhow::bail!("brand must be feishu or lark");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can persist account facts",
                ));
            }
            let conflicting_identity = transaction
                .query_row(
                    "SELECT user_id_digest FROM feishu_account WHERE id = ?1",
                    [&envelope.payload.account_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten()
                .is_some_and(|digest| digest != envelope.payload.user_id_digest);
            if conflicting_identity {
                return Ok(rejected(
                    "feishu_account.identity_conflict",
                    "Account identity changed for the same account ID",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE feishu_account
                SET status = 'disconnected', disconnected_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE status = 'connected' AND id <> ?1
                "#,
                params![envelope.payload.account_id, now],
            )?;
            transaction.execute(
                r#"
                INSERT INTO feishu_account(
                    id, identity_digest, display_name, tenant_name,
                    status, version, created_at, updated_at, disconnected_at,
                    user_id_digest, tenant_id, user_name, email, brand,
                    connected_at, last_verified_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, 'connected', 1, ?8, ?8, NULL,
                    ?2, ?5, ?3, ?6, ?7, ?8, ?8
                )
                ON CONFLICT(id) DO UPDATE SET
                    identity_digest = excluded.identity_digest,
                    display_name = excluded.display_name,
                    tenant_name = excluded.tenant_name,
                    user_id_digest = excluded.user_id_digest,
                    tenant_id = excluded.tenant_id,
                    user_name = excluded.user_name,
                    email = excluded.email,
                    brand = excluded.brand,
                    status = 'connected',
                    disconnected_at = NULL,
                    connected_at = CASE
                        WHEN feishu_account.status = 'connected'
                         AND feishu_account.connected_at IS NOT NULL
                        THEN feishu_account.connected_at
                        ELSE excluded.connected_at
                    END,
                    last_verified_at = excluded.last_verified_at,
                    version = feishu_account.version + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.user_id_digest,
                    user_name,
                    tenant_name,
                    envelope.payload.tenant_id,
                    email,
                    envelope.payload.brand,
                    now,
                ],
            )?;
            let version: i64 = transaction.query_row(
                "SELECT version FROM feishu_account WHERE id = ?1",
                [&envelope.payload.account_id],
                |row| row.get(0),
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_account.connected",
                json!({ "accountId": envelope.payload.account_id, "version": version }),
                Some(EntityReference {
                    entity_type: "feishu_account".to_string(),
                    entity_id: envelope.payload.account_id.clone(),
                }),
            ))
        })
    }

    pub fn disconnect_feishu_account(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DisconnectFeishuAccountCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_owner(&envelope.actor) {
                return Ok(rejected(
                    "feishu_account.owner_required",
                    "Only the local owner can disconnect Feishu",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM feishu_account WHERE id = ?1 AND status = 'connected'",
                    [&envelope.payload.account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected(
                    "feishu_account.not_connected",
                    "Connected Feishu account does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE feishu_account
                SET status = 'disconnected', disconnected_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![envelope.payload.account_id, now, version],
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_account.disconnected",
                json!({ "accountId": envelope.payload.account_id, "version": version + 1 }),
                None,
            ))
        })
    }

    pub fn expire_feishu_account(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ExpireFeishuAccountCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can expire a developer session",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM feishu_account WHERE id = ?1 AND status = 'connected'",
                    [&envelope.payload.account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected(
                    "feishu_account.not_connected",
                    "Connected Feishu account does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE feishu_account
                SET status = 'session_expired', disconnected_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![envelope.payload.account_id, now, version],
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_account.session_expired",
                json!({ "accountId": envelope.payload.account_id, "version": version + 1 }),
                None,
            ))
        })
    }

    pub fn create_member_bot_publication_intent(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateMemberBotPublicationIntentCommand>,
    ) -> Result<CommandExecution> {
        for (value, field) in [
            (
                &envelope.payload.publication_intent_id,
                "publicationIntentId",
            ),
            (&envelope.payload.account_id, "accountId"),
            (&envelope.payload.agent_id, "agentId"),
            (&envelope.payload.expected_tenant_id, "expectedTenantId"),
        ] {
            validate_nonempty(value, field)?;
        }
        validate_digest(
            &envelope.payload.expected_user_id_digest,
            "expectedUserIdDigest",
        )?;
        let requested_app_name = normalize_display_name(&envelope.payload.requested_app_name)?;
        if envelope.payload.provisioning_mode != "developer_session" {
            anyhow::bail!("provisioningMode must be developer_session");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can create publication intents",
                ));
            }
            let account_matches: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM feishu_account
                    WHERE id = ?1 AND status = 'connected'
                      AND user_id_digest = ?2 AND tenant_id = ?3
                )
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.expected_user_id_digest,
                    envelope.payload.expected_tenant_id,
                ],
                |row| row.get(0),
            )?;
            if !account_matches {
                return Ok(rejected(
                    "feishu_account.identity_mismatch",
                    "Publication intent requires the exact connected developer identity",
                ));
            }
            let agent_present: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_profile WHERE id = ?1 AND profile_status = 'present')",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if !agent_present {
                return Ok(rejected(
                    "agent.unavailable",
                    "Bot publication requires a present AgentProfile",
                ));
            }
            let member_bot_bound: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM feishu_member_bot WHERE agent_id = ?1)",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if member_bot_bound {
                return Ok(rejected(
                    "feishu_member_bot.already_bound",
                    "This member already has an immutable Feishu App binding",
                ));
            }
            let has_active: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM feishu_member_bot_publication_intent
                    WHERE agent_id = ?1
                      AND state NOT IN (
                        'completed', 'failed_recoverable'
                      )
                )
                "#,
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if has_active {
                return Ok(rejected(
                    "feishu_publication_intent.active_conflict",
                    "This member already has an active publication intent",
                ));
            }
            let app_identity_frozen: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM feishu_member_bot_publication_intent
                    WHERE agent_id = ?1 AND remote_app_id IS NOT NULL
                )
                "#,
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if app_identity_frozen {
                return Ok(rejected(
                    "feishu_publication_intent.app_identity_frozen",
                    "This member already has a frozen Feishu App identity",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO feishu_member_bot_publication_intent(
                    id, agent_id, account_id, expected_user_id_digest,
                    expected_tenant_id, requested_app_name, provisioning_mode,
                    state, remote_app_id, credential_ref, last_completed_step,
                    failure_code, version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    'created', NULL, NULL, NULL, NULL, 1, ?8, ?8
                )
                "#,
                params![
                    envelope.payload.publication_intent_id,
                    envelope.payload.agent_id,
                    envelope.payload.account_id,
                    envelope.payload.expected_user_id_digest,
                    envelope.payload.expected_tenant_id,
                    requested_app_name,
                    envelope.payload.provisioning_mode,
                    now,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_member_bot_publication_intent.created",
                json!({
                    "publicationIntentId": envelope.payload.publication_intent_id,
                    "version": 1,
                }),
                Some(EntityReference {
                    entity_type: "feishu_member_bot_publication_intent".to_string(),
                    entity_id: envelope.payload.publication_intent_id.clone(),
                }),
            ))
        })
    }

    pub fn advance_member_bot_publication_intent(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AdvanceMemberBotPublicationIntentCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(
            &envelope.payload.publication_intent_id,
            "publicationIntentId",
        )?;
        validate_publication_intent_state(&envelope.payload.state)?;
        if let Some(app_id) = &envelope.payload.remote_app_id {
            validate_nonempty(app_id, "remoteAppId")?;
        }
        if let Some(credential_ref) = &envelope.payload.credential_ref {
            validate_nonempty(credential_ref, "credentialRef")?;
        }
        if let Some(step) = &envelope.payload.last_completed_step {
            validate_nonempty(step, "lastCompletedStep")?;
        }
        if let Some(code) = &envelope.payload.failure_code {
            validate_nonempty(code, "failureCode")?;
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can advance publication intents",
                ));
            }
            let current = transaction
                .query_row(
                    r#"
                    SELECT agent_id, account_id, state, remote_app_id, credential_ref, version
                    FROM feishu_member_bot_publication_intent
                    WHERE id = ?1
                    "#,
                    [&envelope.payload.publication_intent_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                agent_id,
                account_id,
                current_state,
                current_app_id,
                current_credential_ref,
                version,
            )) = current
            else {
                return Ok(rejected(
                    "feishu_publication_intent.not_found",
                    "Publication intent does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if !publication_intent_transition_allowed(&current_state, &envelope.payload.state) {
                return Ok(rejected(
                    "feishu_publication_intent.invalid_transition",
                    "Publication intent transition is not allowed",
                ));
            }
            if current_state == "completed" && envelope.payload.state == "session_verified" {
                let Some(frozen_app_id) = current_app_id.as_deref() else {
                    return Ok(rejected(
                        "feishu_publication_intent.reactivation_binding_mismatch",
                        "Completed publication cannot be reactivated without its frozen App",
                    ));
                };
                let Some(frozen_credential_ref) = current_credential_ref.as_deref() else {
                    return Ok(rejected(
                        "feishu_publication_intent.reactivation_binding_mismatch",
                        "Completed publication cannot be reactivated without its frozen credential identity",
                    ));
                };
                let exact_disabled_binding: bool = transaction.query_row(
                    r#"
                    SELECT EXISTS(
                        SELECT 1
                        FROM feishu_member_bot AS bot
                        JOIN feishu_account AS account ON account.id = bot.account_id
                        WHERE bot.agent_id = ?1 AND bot.account_id = ?2
                          AND bot.app_id = ?3
                          AND bot.credential_ref = ?4
                          AND bot.status IN ('published', 'disabled')
                          AND account.status = 'connected'
                    )
                    "#,
                    params![agent_id, account_id, frozen_app_id, frozen_credential_ref],
                    |row| row.get(0),
                )?;
                if !exact_disabled_binding
                    || envelope.payload.remote_app_id.as_deref() != Some(frozen_app_id)
                {
                    return Ok(rejected(
                        "feishu_publication_intent.reactivation_binding_mismatch",
                        "Only an existing member Bot may recover its exact frozen App",
                    ));
                }
            }
            if current_state == "failed_unknown_remote_state"
                && matches!(
                    envelope.payload.state.as_str(),
                    "credentials_read" | "failed_recoverable"
                )
                && current_app_id.is_none()
            {
                return Ok(rejected(
                    "feishu_publication_intent.reconciliation_remote_app_required",
                    "Unknown publication recovery requires an already frozen remote App",
                ));
            }
            if current_app_id.is_some()
                && envelope.payload.remote_app_id.is_some()
                && current_app_id != envelope.payload.remote_app_id
            {
                return Ok(rejected(
                    "feishu_publication_intent.remote_app_conflict",
                    "Publication intent cannot change its remote App identity",
                ));
            }
            if current_credential_ref.is_some()
                && envelope.payload.credential_ref.is_some()
                && current_credential_ref != envelope.payload.credential_ref
            {
                return Ok(rejected(
                    "feishu_publication_intent.credential_conflict",
                    "Publication intent cannot change its credential reference",
                ));
            }
            let remote_app_id = envelope.payload.remote_app_id.clone().or(current_app_id);
            let credential_ref = envelope
                .payload
                .credential_ref
                .clone()
                .or(current_credential_ref);
            if publication_intent_requires_app(&envelope.payload.state) && remote_app_id.is_none() {
                return Ok(rejected(
                    "feishu_publication_intent.remote_app_required",
                    "This publication state requires a frozen remote App ID",
                ));
            }
            if matches!(
                envelope.payload.state.as_str(),
                "credentials_read"
                    | "bot_configured"
                    | "version_published"
                    | "connection_verified"
                    | "completed"
            ) && credential_ref.is_none()
            {
                return Ok(rejected(
                    "feishu_publication_intent.credential_required",
                    "This publication state requires a frozen credential reference",
                ));
            }
            if matches!(
                envelope.payload.state.as_str(),
                "connection_verified" | "completed"
            ) {
                let exact_published_binding: bool = transaction.query_row(
                    r#"
                    SELECT EXISTS(
                        SELECT 1 FROM feishu_member_bot
                        WHERE agent_id = ?1 AND account_id = ?2
                          AND app_id = ?3 AND credential_ref = ?4
                          AND status = 'published'
                    )
                    "#,
                    params![agent_id, account_id, remote_app_id, credential_ref,],
                    |row| row.get(0),
                )?;
                if !exact_published_binding {
                    return Ok(rejected(
                        "feishu_publication_intent.member_bot_binding_required",
                        "Connection completion requires the exact published member Bot binding",
                    ));
                }
            }
            if envelope.payload.state.starts_with("failed_")
                && envelope.payload.failure_code.is_none()
            {
                return Ok(rejected(
                    "feishu_publication_intent.failure_code_required",
                    "A failed publication intent requires a failure code",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE feishu_member_bot_publication_intent
                SET state = ?2, remote_app_id = ?3, credential_ref = ?4,
                    last_completed_step = ?5, failure_code = ?6,
                    version = version + 1, updated_at = ?7
                WHERE id = ?1 AND version = ?8
                "#,
                params![
                    envelope.payload.publication_intent_id,
                    envelope.payload.state,
                    remote_app_id,
                    credential_ref,
                    envelope.payload.last_completed_step,
                    envelope.payload.failure_code,
                    now,
                    version,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_member_bot_publication_intent.advanced",
                json!({
                    "publicationIntentId": envelope.payload.publication_intent_id,
                    "state": envelope.payload.state,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "feishu_member_bot_publication_intent".to_string(),
                    entity_id: envelope.payload.publication_intent_id.clone(),
                }),
            ))
        })
    }

    pub fn upsert_feishu_member_bot(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpsertFeishuMemberBotCommand>,
    ) -> Result<CommandExecution> {
        for (value, field) in [
            (&envelope.payload.account_id, "accountId"),
            (&envelope.payload.agent_id, "agentId"),
            (&envelope.payload.app_id, "appId"),
            (&envelope.payload.credential_ref, "credentialRef"),
        ] {
            validate_nonempty(value, field)?;
        }
        let display_name = normalize_display_name(&envelope.payload.bot_display_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can persist Bot facts",
                ));
            }
            let agent_present: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_profile WHERE id = ?1 AND profile_status = 'present')",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if !agent_present {
                return Ok(rejected(
                    "agent.unavailable",
                    "Bot publication requires a present AgentProfile",
                ));
            }
            let existing_binding = transaction
                .query_row(
                    r#"
                    SELECT account_id, app_id, credential_ref, status
                    FROM feishu_member_bot
                    WHERE agent_id = ?1
                    "#,
                    [&envelope.payload.agent_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((account_id, app_id, credential_ref, status)) = &existing_binding {
                if account_id != &envelope.payload.account_id
                    || app_id != &envelope.payload.app_id
                    || credential_ref != &envelope.payload.credential_ref
                {
                    return Ok(rejected(
                        "feishu_member_bot.binding_immutable",
                        "A member Bot cannot change its Feishu App, owner account, or credential identity",
                    ));
                }
                if status != "published"
                    && !member_bot_publication_ready(transaction, &envelope.payload)?
                {
                    return Ok(rejected(
                        "feishu_member_bot.publication_state_required",
                        "Reactivating a member Bot requires its matching publication state machine",
                    ));
                }
            } else {
                let account_connected: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM feishu_account WHERE id = ?1 AND status = 'connected')",
                    [&envelope.payload.account_id],
                    |row| row.get(0),
                )?;
                if !account_connected {
                    return Ok(rejected(
                        "feishu_account.not_connected",
                        "Initial Bot publication requires the connected Feishu account",
                    ));
                }
                if !member_bot_publication_ready(transaction, &envelope.payload)? {
                    return Ok(rejected(
                        "feishu_member_bot.publication_state_required",
                        "Initial Bot binding requires the matching publication state machine",
                    ));
                }
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO feishu_member_bot(
                    agent_id, account_id, app_id, bot_open_id, bot_display_name,
                    credential_ref, status, failure_code, version,
                    created_at, updated_at, published_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'published', NULL, 1, ?7, ?7, ?7)
                ON CONFLICT(agent_id) DO UPDATE SET
                    bot_open_id = excluded.bot_open_id,
                    bot_display_name = excluded.bot_display_name,
                    status = 'published', failure_code = NULL,
                    published_at = excluded.published_at,
                    version = feishu_member_bot.version + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.agent_id,
                    envelope.payload.account_id,
                    envelope.payload.app_id,
                    envelope.payload.bot_open_id,
                    display_name,
                    envelope.payload.credential_ref,
                    now,
                ],
            )?;
            let version: i64 = transaction.query_row(
                "SELECT version FROM feishu_member_bot WHERE agent_id = ?1",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_member_bot.published",
                json!({ "agentId": envelope.payload.agent_id, "version": version }),
                Some(EntityReference {
                    entity_type: "feishu_member_bot".to_string(),
                    entity_id: envelope.payload.agent_id.clone(),
                }),
            ))
        })
    }

    pub fn reconcile_feishu_group_roster(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReconcileFeishuGroupRosterCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.provider != FEISHU_PROVIDER {
            anyhow::bail!("only the Feishu channel provider is supported");
        }
        validate_nonempty(&envelope.payload.tenant_key, "tenantKey")?;
        validate_nonempty(&envelope.payload.chat_id, "chatId")?;
        if envelope.payload.present_app_ids.len() > 64 {
            anyhow::bail!("presentAppIds cannot contain more than 64 Apps");
        }
        for app_id in &envelope.payload.present_app_ids {
            validate_nonempty(app_id, "presentAppIds")?;
        }
        let present_app_ids = sorted_unique(&envelope.payload.present_app_ids);
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can reconcile the Bot roster",
                ));
            }
            let known_bots = query_rows(
                transaction,
                r#"
                SELECT app_id, agent_id, status
                FROM feishu_member_bot
                ORDER BY app_id
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )?;
            let published_app_ids = known_bots
                .iter()
                .filter(|(_, _, status)| status == "published")
                .map(|(app_id, _, _)| app_id.clone())
                .collect::<BTreeSet<_>>();
            let unknown_present = present_app_ids
                .difference(&published_app_ids)
                .cloned()
                .collect::<Vec<_>>();
            if !unknown_present.is_empty() {
                return Ok(CommandHandlerResult::rejected(
                    "channel.roster_unknown_bot",
                    json!({
                        "message": "Roster contains an App that is not a published member Bot",
                        "appIds": unknown_present,
                    }),
                ));
            }
            let current_generation = transaction
                .query_row(
                    r#"
                    SELECT generation FROM external_group_bot_roster_state
                    WHERE provider = ?1 AND tenant_key = ?2 AND chat_id = ?3
                    "#,
                    params![
                        envelope.payload.provider,
                        envelope.payload.tenant_key,
                        envelope.payload.chat_id,
                    ],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            let generation = current_generation + 1;
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO external_group_bot_roster_state(
                    provider, tenant_key, chat_id, generation, observed_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                ON CONFLICT(provider, tenant_key, chat_id) DO UPDATE SET
                    generation = excluded.generation,
                    observed_at = excluded.observed_at,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.provider,
                    envelope.payload.tenant_key,
                    envelope.payload.chat_id,
                    generation,
                    now,
                ],
            )?;
            let mut present_agent_ids = Vec::new();
            for (app_id, agent_id, bot_status) in known_bots {
                let roster_status =
                    if bot_status == "published" && present_app_ids.contains(&app_id) {
                        present_agent_ids.push(agent_id.clone());
                        "present"
                    } else {
                        "absent"
                    };
                transaction.execute(
                    r#"
                    INSERT INTO external_group_bot_roster(
                        provider, tenant_key, chat_id, app_id, agent_id,
                        status, version, observed_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
                    ON CONFLICT(provider, tenant_key, chat_id, app_id) DO UPDATE SET
                        agent_id = excluded.agent_id,
                        status = excluded.status,
                        version = CASE
                            WHEN external_group_bot_roster.agent_id = excluded.agent_id
                             AND external_group_bot_roster.status = excluded.status
                            THEN external_group_bot_roster.version
                            ELSE external_group_bot_roster.version + 1
                        END,
                        observed_at = excluded.observed_at,
                        updated_at = excluded.updated_at
                    "#,
                    params![
                        envelope.payload.provider,
                        envelope.payload.tenant_key,
                        envelope.payload.chat_id,
                        app_id,
                        agent_id,
                        roster_status,
                        now,
                    ],
                )?;
            }
            Ok(CommandHandlerResult::applied(
                "channel.group_roster.reconciled",
                json!({
                    "provider": envelope.payload.provider,
                    "tenantKey": envelope.payload.tenant_key,
                    "chatId": envelope.payload.chat_id,
                    "generation": generation,
                    "presentAgentIds": present_agent_ids,
                }),
                Some(EntityReference {
                    entity_type: "external_group_bot_roster".to_string(),
                    entity_id: format!(
                        "{}:{}:{}",
                        envelope.payload.provider,
                        envelope.payload.tenant_key,
                        envelope.payload.chat_id
                    ),
                }),
            ))
        })?;
        if execution.result.status != CommandResultStatus::Rejected {
            reconcile_bound_group_memberships(
                database,
                &envelope.payload.provider,
                &envelope.payload.tenant_key,
                &envelope.payload.chat_id,
                &envelope.command_id,
            )?;
        }
        Ok(execution)
    }

    pub fn observe_inbound(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ObserveChannelInboundCommand>,
    ) -> Result<CommandExecution> {
        validate_observation_input(&envelope.payload)?;
        let aggregate_id = format!("rvcia_{}", Uuid::new_v4().simple());
        let external_message_digest = format!(
            "sha256:{}",
            canonical_json_digest(&json!({
                "provider": envelope.payload.provider,
                "tenantKey": envelope.payload.tenant_key,
                "externalMessageId": envelope.payload.external_message_id,
            }))?
        );
        let proposed_principal_id = stable_external_principal_id(
            &envelope.payload.provider,
            &envelope.payload.tenant_key,
            &envelope.payload.sender_external_user_id,
        )?;
        let conversation_id = stable_channel_conversation_id(
            &envelope.payload.provider,
            &envelope.payload.tenant_key,
            &envelope.payload.chat_id,
            &envelope.payload.topic_key,
            if envelope.payload.conversation_kind == "p2p" {
                envelope.payload.app_id.as_str()
            } else {
                ""
            },
        )?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can observe inbound events",
                ));
            }
            let target_agent_ids = resolve_observation_targets(transaction, &envelope.payload)?;
            let structured_content = build_external_content(&envelope.payload, &target_agent_ids)?;
            validate_content(&structured_content)?;
            let principal_id = resolve_external_principal_id(
                transaction,
                &envelope.payload,
                &proposed_principal_id,
            )?;
            let observed_binding_id = transaction
                .query_row(
                    r#"
                    SELECT binding.id
                    FROM channel_conversation_binding AS binding
                    WHERE binding.channel_conversation_id = ?1 AND binding.status = 'active'
                    "#,
                    [&conversation_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let payload_digest = format!(
                "sha256:{}",
                canonical_json_digest(&json!({
                    "provider": envelope.payload.provider,
                    "tenantKey": envelope.payload.tenant_key,
                    "chatId": envelope.payload.chat_id,
                    "topicKey": envelope.payload.topic_key,
                    "conversationKind": envelope.payload.conversation_kind,
                    "principalId": principal_id,
                    "structuredContent": structured_content,
                    "targetAgentIds": target_agent_ids,
                    "expectedAppIds": sorted_unique(&envelope.payload.expected_app_ids),
                    "acknowledgementAppId": envelope.payload.acknowledgement_app_id,
                    "bindingIdAtObservation": observed_binding_id,
                }))?
            );
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            let sender_display_name = normalize_display_name(&envelope.payload.sender_display_name)?;
            if observed_binding_id.is_some() {
                transaction.execute(
                    r#"
                    INSERT INTO external_principal(
                        id, provider, tenant_key, external_user_id, display_name,
                        version, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
                    ON CONFLICT(provider, tenant_key, external_user_id) DO UPDATE SET
                        display_name = excluded.display_name,
                        version = CASE
                            WHEN external_principal.display_name IS excluded.display_name
                            THEN external_principal.version
                            ELSE external_principal.version + 1
                        END,
                        updated_at = excluded.updated_at
                    "#,
                    params![
                        principal_id,
                        envelope.payload.provider,
                        envelope.payload.tenant_key,
                        envelope.payload.sender_external_user_id,
                        sender_display_name,
                        now_text,
                    ],
                )?;
                for (identity_kind, external_id) in [
                    ("open_id", envelope.payload.sender_open_id.as_deref()),
                    ("user_id", envelope.payload.sender_user_id.as_deref()),
                    ("union_id", envelope.payload.sender_union_id.as_deref()),
                ] {
                    let Some(external_id) = external_id else {
                        continue;
                    };
                    transaction.execute(
                        r#"
                        INSERT INTO external_principal_app_identity(
                            principal_id, provider, app_id, identity_kind,
                            external_id, updated_at
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                        ON CONFLICT(principal_id, provider, app_id, identity_kind) DO UPDATE SET
                            external_id = excluded.external_id,
                            updated_at = excluded.updated_at
                        "#,
                        params![
                            principal_id,
                            envelope.payload.provider,
                            envelope.payload.app_id,
                            identity_kind,
                            external_id,
                            now_text,
                        ],
                    )?;
                }
            }
            let bot_scope_app_id = if envelope.payload.conversation_kind == "p2p" {
                envelope.payload.app_id.as_str()
            } else {
                ""
            };
            transaction.execute(
                r#"
                INSERT INTO channel_conversation(
                    id, provider, tenant_key, chat_id, topic_key, bot_scope_app_id,
                    conversation_kind, display_name, last_sender_display_name,
                    last_sender_principal_id,
                    first_seen_at, last_seen_at, version
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, 1)
                ON CONFLICT(provider, tenant_key, chat_id, topic_key, bot_scope_app_id) DO UPDATE SET
                    conversation_kind = excluded.conversation_kind,
                    display_name = excluded.display_name,
                    last_sender_display_name = excluded.last_sender_display_name,
                    last_sender_principal_id = excluded.last_sender_principal_id,
                    last_seen_at = excluded.last_seen_at,
                    version = channel_conversation.version + 1
                "#,
                params![
                    conversation_id,
                    envelope.payload.provider,
                    envelope.payload.tenant_key,
                    envelope.payload.chat_id,
                    envelope.payload.topic_key,
                    bot_scope_app_id,
                    envelope.payload.conversation_kind,
                    normalize_display_name(&envelope.payload.conversation_display_name)?,
                    sender_display_name,
                    observed_binding_id.as_ref().map(|_| principal_id.as_str()),
                    now_text,
                ],
            )?;
            let existing = transaction
                .query_row(
                    r#"
                    SELECT id, payload_digest, status, observed_app_ids_json,
                           canonical_mentions_complete, expected_app_ids_json
                    FROM channel_inbound_aggregate
                    WHERE provider = ?1 AND tenant_key = ?2
                      AND external_message_digest = ?3
                    "#,
                    params![
                        envelope.payload.provider,
                        envelope.payload.tenant_key,
                        external_message_digest,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, bool>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((
                existing_id,
                existing_payload_digest,
                status,
                observed_json,
                mentions_complete,
                expected_json,
            )) = existing
            {
                if existing_payload_digest != payload_digest {
                    if status == "collecting" {
                        transaction.execute(
                            r#"
                            UPDATE channel_inbound_aggregate
                            SET status = 'failed', failure_code = 'observation_mismatch',
                                finalized_at = ?2, updated_at = ?2
                            WHERE id = ?1
                            "#,
                            params![existing_id, now_text],
                        )?;
                    }
                    return Ok(CommandHandlerResult::applied(
                        "channel.inbound.failed",
                        json!({
                            "aggregateId": existing_id,
                            "status": "failed",
                            "failureCode": "observation_mismatch",
                            "readyToFinalize": false,
                        }),
                        None,
                    ));
                }
                if status != "collecting" {
                    return Ok(CommandHandlerResult::applied(
                        "channel.inbound.replayed",
                        json!({
                            "aggregateId": existing_id,
                            "status": status,
                            "readyToFinalize": false,
                        }),
                        Some(EntityReference {
                            entity_type: "channel_inbound_aggregate".to_string(),
                            entity_id: existing_id,
                        }),
                    ));
                }
                transaction.execute(
                    r#"
                    INSERT INTO channel_inbound_observation(
                        aggregate_id, app_id, observation_digest, observed_at
                    ) VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(aggregate_id, app_id) DO NOTHING
                    "#,
                    params![
                        existing_id,
                        envelope.payload.app_id,
                        payload_digest,
                        now_text
                    ],
                )?;
                let mut observed = parse_string_set(&observed_json)?;
                observed.insert(envelope.payload.app_id.clone());
                let expected = parse_string_set(&expected_json)?;
                let complete = mentions_complete || envelope.payload.canonical_mentions_complete;
                transaction.execute(
                    r#"
                    UPDATE channel_inbound_aggregate
                    SET observed_app_ids_json = ?2,
                        canonical_mentions_complete = ?3,
                        updated_at = ?4
                    WHERE id = ?1
                    "#,
                    params![
                        existing_id,
                        serde_json::to_string(&observed)?,
                        complete,
                        now_text,
                    ],
                )?;
                let ready = complete || expected.is_subset(&observed);
                return Ok(CommandHandlerResult::applied(
                    "channel.inbound.collecting",
                    json!({
                        "aggregateId": existing_id,
                        "status": "collecting",
                        "observationCount": observed.len(),
                        "readyToFinalize": ready,
                    }),
                    Some(EntityReference {
                        entity_type: "channel_inbound_aggregate".to_string(),
                        entity_id: existing_id,
                    }),
                ));
            }
            let expected = sorted_unique(&envelope.payload.expected_app_ids);
            let observed = BTreeSet::from([envelope.payload.app_id.clone()]);
            let frozen_payload = json!({
                "conversationId": conversation_id,
                "principalId": observed_binding_id.as_ref().map(|_| principal_id.as_str()),
                "bindingIdAtObservation": observed_binding_id,
                "structuredContent": structured_content,
                "targetAgentIds": target_agent_ids,
                "acknowledgementAppId": envelope.payload.acknowledgement_app_id,
            });
            let deadline = (now + Duration::seconds(AGGREGATION_WINDOW_SECONDS)).to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO channel_inbound_aggregate(
                    id, provider, tenant_key, chat_id, topic_key,
                    external_message_digest, payload_digest, status,
                    canonical_mentions_complete, expected_app_ids_json,
                    observed_app_ids_json, frozen_payload_json, deadline_at,
                    created_at, updated_at, finalized_at, failure_code
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'collecting', ?8,
                    ?9, ?10, ?11, ?12, ?13, ?13, NULL, NULL
                )
                "#,
                params![
                    aggregate_id,
                    envelope.payload.provider,
                    envelope.payload.tenant_key,
                    envelope.payload.chat_id,
                    envelope.payload.topic_key,
                    external_message_digest,
                    payload_digest,
                    envelope.payload.canonical_mentions_complete,
                    serde_json::to_string(&expected)?,
                    serde_json::to_string(&observed)?,
                    serde_json::to_string(&frozen_payload)?,
                    deadline,
                    now_text,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO channel_inbound_observation(
                    aggregate_id, app_id, observation_digest, observed_at
                ) VALUES (?1, ?2, ?3, ?4)
                "#,
                params![
                    aggregate_id,
                    envelope.payload.app_id,
                    payload_digest,
                    now_text
                ],
            )?;
            // Deliberately never admit here. Even a complete first observation
            // only establishes a durable collecting aggregate; finalization is
            // a separate command boundary.
            Ok(CommandHandlerResult::applied(
                "channel.inbound.collecting",
                json!({
                    "aggregateId": aggregate_id,
                    "status": "collecting",
                    "observationCount": 1,
                    "readyToFinalize": envelope.payload.canonical_mentions_complete
                        || expected.is_subset(&observed),
                }),
                Some(EntityReference {
                    entity_type: "channel_inbound_aggregate".to_string(),
                    entity_id: aggregate_id.clone(),
                }),
            ))
        })
    }

    pub fn finalize_inbound(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<FinalizeChannelInboundCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can finalize inbound events",
                ));
            }
            let aggregate = load_collecting_aggregate(transaction, &envelope.payload.aggregate_id)?;
            let Some(aggregate) = aggregate else {
                let existing = transaction
                    .query_row(
                        "SELECT status FROM channel_inbound_aggregate WHERE id = ?1",
                        [&envelope.payload.aggregate_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                return Ok(match existing.as_deref() {
                    Some("finalized") => CommandHandlerResult::applied(
                        "channel.inbound.already_finalized",
                        json!({ "aggregateId": envelope.payload.aggregate_id }),
                        None,
                    ),
                    Some("failed") => rejected(
                        "channel.inbound.failed",
                        "Inbound aggregation is already terminally failed",
                    ),
                    _ => rejected(
                        "channel.inbound.not_found",
                        "Inbound aggregation does not exist",
                    ),
                });
            };
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            let expected = parse_string_set(&aggregate.expected_app_ids_json)?;
            let observed = parse_string_set(&aggregate.observed_app_ids_json)?;
            let ready = aggregate.canonical_mentions_complete || expected.is_subset(&observed);
            if !ready {
                if now
                    < chrono::DateTime::parse_from_rfc3339(&aggregate.deadline_at)?
                        .with_timezone(&Utc)
                {
                    return Ok(rejected(
                        "channel.inbound.not_ready",
                        "Canonical mentions or all expected App observations are still incomplete",
                    ));
                }
                transaction.execute(
                    r#"
                    UPDATE channel_inbound_aggregate
                    SET status = 'failed', failure_code = 'aggregation_timeout',
                        finalized_at = ?2, updated_at = ?2
                    WHERE id = ?1 AND status = 'collecting'
                    "#,
                    params![aggregate.id, now_text],
                )?;
                return Ok(CommandHandlerResult::applied(
                    "channel.inbound.failed",
                    json!({
                        "aggregateId": aggregate.id,
                        "status": "failed",
                        "failureCode": "aggregation_timeout",
                    }),
                    None,
                ));
            }
            let frozen: FrozenInboundPayload = serde_json::from_str(&aggregate.frozen_payload_json)
                .context("channel inbound frozen payload is invalid")?;
            let binding = if let Some(binding_id_at_observation) =
                frozen.binding_id_at_observation.as_deref()
            {
                transaction
                    .query_row(
                    r#"
                    SELECT binding.id, binding.project_binding_id, binding.camp_id,
                           project.display_name, project.binding_kind,
                           project.canonical_path, conversation.display_name,
                           conversation.tenant_key, conversation.chat_id,
                           conversation.conversation_kind
                    FROM channel_conversation AS conversation
                    JOIN channel_conversation_binding AS binding
                      ON binding.channel_conversation_id = conversation.id
                    JOIN project_binding AS project
                      ON project.id = binding.project_binding_id
                     AND project.status = 'active'
                    WHERE conversation.id = ?1 AND binding.id = ?2
                      AND binding.status = 'active'
                    "#,
                    params![frozen.conversation_id, binding_id_at_observation],
                    |row| {
                        Ok(ChannelBindingAdmission {
                            binding_id: row.get(0)?,
                            project_binding_id: row.get(1)?,
                            camp_id: row.get(2)?,
                            project_display_name: row.get(3)?,
                            binding_kind: row.get(4)?,
                            canonical_path: row.get(5)?,
                            conversation_display_name: row.get(6)?,
                            tenant_key: row.get(7)?,
                            chat_id: row.get(8)?,
                            conversation_kind: row.get(9)?,
                        })
                    },
                    )
                    .optional()?
            } else {
                None
            };
            let Some(mut binding) = binding else {
                transaction.execute(
                    r#"
                    UPDATE channel_inbound_aggregate
                    SET status = 'finalized', finalized_at = ?2, updated_at = ?2
                    WHERE id = ?1 AND status = 'collecting'
                    "#,
                    params![aggregate.id, now_text],
                )?;
                return Ok(CommandHandlerResult::applied(
                    "channel.inbound.unbound",
                    json!({
                        "aggregateId": aggregate.id,
                        "status": "unbound",
                        "requiresResend": true,
                    }),
                    None,
                ));
            };
            let roster_agent_ids = if matches!(
                binding.conversation_kind.as_str(),
                "group" | "topic"
            ) {
                let roster_state_exists: bool = transaction.query_row(
                    r#"
                    SELECT EXISTS(
                        SELECT 1 FROM external_group_bot_roster_state
                        WHERE provider = 'feishu' AND tenant_key = ?1 AND chat_id = ?2
                    )
                    "#,
                    params![binding.tenant_key, binding.chat_id],
                    |row| row.get(0),
                )?;
                if !roster_state_exists {
                    return Ok(CommandHandlerResult::rejected(
                        "channel.roster_sync_required",
                        json!({
                            "message": "The Feishu group Bot roster must be reconciled before admission",
                            "tenantKey": binding.tenant_key,
                            "chatId": binding.chat_id,
                        }),
                    ));
                }
                let present_app_ids = query_rows(
                    transaction,
                    r#"
                    SELECT app_id FROM external_group_bot_roster
                    WHERE provider = 'feishu' AND tenant_key = ?1 AND chat_id = ?2
                      AND status = 'present'
                    ORDER BY app_id
                    "#,
                    params![binding.tenant_key, binding.chat_id],
                    |row| row.get::<_, String>(0),
                )?
                .into_iter()
                .collect::<BTreeSet<_>>();
                let missing_apps = expected
                    .difference(&present_app_ids)
                    .cloned()
                    .collect::<Vec<_>>();
                if !missing_apps.is_empty() {
                    return Ok(CommandHandlerResult::rejected(
                        "channel.bot_not_in_roster",
                        json!({
                            "message": "A mentioned member Bot is no longer in this Feishu group",
                            "tenantKey": binding.tenant_key,
                            "chatId": binding.chat_id,
                            "appIds": missing_apps,
                        }),
                    ));
                }
                query_rows(
                    transaction,
                    r#"
                    SELECT roster.agent_id
                    FROM external_group_bot_roster AS roster
                    JOIN feishu_member_bot AS bot
                      ON bot.app_id = roster.app_id AND bot.agent_id = roster.agent_id
                    WHERE roster.provider = 'feishu'
                      AND roster.tenant_key = ?1 AND roster.chat_id = ?2
                      AND roster.status = 'present' AND bot.status = 'published'
                    ORDER BY roster.agent_id
                    "#,
                    params![binding.tenant_key, binding.chat_id],
                    |row| row.get::<_, String>(0),
                )?
            } else {
                Vec::new()
            };
            if binding.camp_id.is_none() {
                let initial_members = if binding.conversation_kind == "group" {
                    &roster_agent_ids
                } else {
                    &frozen.target_agent_ids
                };
                binding.camp_id = Some(create_channel_camp(
                    transaction,
                    &binding,
                    initial_members,
                    &now_text,
                )?);
            }
            let camp_id = binding
                .camp_id
                .clone()
                .context("channel binding Camp creation did not persist an identity")?;
            let principal_id = frozen
                .principal_id
                .clone()
                .context("bound channel observation omitted its External Principal")?;
            let missing_members =
                missing_active_members(transaction, &camp_id, &frozen.target_agent_ids)?;
            if !missing_members.is_empty() {
                let membership_generation: i64 = transaction.query_row(
                    "SELECT membership_generation FROM camp WHERE id = ?1",
                    [&camp_id],
                    |row| row.get(0),
                )?;
                let source_generation: i64 = transaction.query_row(
                    r#"
                    SELECT last_reconciliation_generation
                    FROM camp_membership_source_binding
                    WHERE camp_id = ?1 AND source_namespace = 'feishu'
                      AND binding_id = ?2
                    "#,
                    params![camp_id, binding.binding_id],
                    |row| row.get(0),
                )?;
                return Ok(CommandHandlerResult::rejected(
                    "channel.membership_sync_required",
                    json!({
                        "campId": camp_id,
                        "bindingId": binding.binding_id,
                        "agentIds": missing_members,
                        "expectedMembershipGeneration": membership_generation,
                        "nextReconciliationGeneration": source_generation + 1,
                    }),
                ));
            }
            let request_id = format!("rvctr_{}", Uuid::new_v4().simple());
            let queue_position: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*) + 1
                FROM channel_turn_request
                WHERE binding_id = ?1 AND status IN ('queued', 'admitted')
                "#,
                [&binding.binding_id],
                |row| row.get(0),
            )?;
            let ack_app_id = frozen.acknowledgement_app_id.clone();
            transaction.execute(
                r#"
                INSERT INTO channel_turn_request(
                    id, binding_id, aggregate_id, external_principal_id,
                    ack_app_id, structured_content_json, addressed_agent_ids_json,
                    status, queue_position, camp_id, camp_message_id, camp_turn_id,
                    trigger_camp_sequence, failure_code, version,
                    created_at, admitted_at, completed_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?9,
                    NULL, NULL, NULL, NULL, 1, ?10, NULL, NULL, ?10
                )
                "#,
                params![
                    request_id,
                    binding.binding_id,
                    aggregate.id,
                    principal_id,
                    ack_app_id,
                    serde_json::to_string(&frozen.structured_content)?,
                    serde_json::to_string(&frozen.target_agent_ids)?,
                    queue_position,
                    camp_id,
                    now_text,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE channel_inbound_aggregate
                SET status = 'finalized', finalized_at = ?2, updated_at = ?2
                WHERE id = ?1 AND status = 'collecting'
                "#,
                params![aggregate.id, now_text],
            )?;
            let admission = if queue_position == 1 {
                try_admit_request(transaction, &request_id, &now_text, &envelope.command_id)?
            } else {
                AdmissionAttempt::Deferred
            };
            if !matches!(admission, AdmissionAttempt::Failed(_)) {
                insert_queue_ack_delivery(
                    transaction,
                    &request_id,
                    &ack_app_id,
                    queue_position,
                    admission == AdmissionAttempt::Admitted,
                    &now_text,
                )?;
            }
            let request_status = match &admission {
                AdmissionAttempt::Admitted => "admitted",
                AdmissionAttempt::Deferred => "queued",
                AdmissionAttempt::Failed(_) => "failed",
            };
            Ok(CommandHandlerResult::accepted(
                match admission {
                    AdmissionAttempt::Admitted => "channel.turn.admitted",
                    AdmissionAttempt::Deferred => "channel.turn.queued",
                    AdmissionAttempt::Failed(_) => "channel.turn.failed",
                },
                json!({
                    "aggregateId": aggregate.id,
                    "requestId": request_id,
                    "campId": camp_id,
                    "queuePosition": queue_position,
                    "status": request_status,
                }),
                Some(EntityReference {
                    entity_type: "channel_turn_request".to_string(),
                    entity_id: request_id.clone(),
                }),
            ))
        })
    }

    pub fn host_tick(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ChannelHostTickCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(&envelope.payload.worker_id, "workerId")?;
        if envelope.payload.limit == 0 || envelope.payload.limit > 100 {
            anyhow::bail!("limit must be between 1 and 100");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can run the outbox pump",
                ));
            }
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            transaction.execute(
                r#"
                UPDATE channel_inbound_aggregate
                SET status = 'failed', failure_code = 'aggregation_timeout',
                    finalized_at = ?1, updated_at = ?1
                WHERE status = 'collecting' AND deadline_at <= ?1
                  AND canonical_mentions_complete = 0
                  AND EXISTS (
                      SELECT 1
                      FROM json_each(channel_inbound_aggregate.expected_app_ids_json) AS expected
                      WHERE NOT EXISTS (
                          SELECT 1
                          FROM json_each(channel_inbound_aggregate.observed_app_ids_json) AS observed
                          WHERE observed.value = expected.value
                      )
                  )
                "#,
                [&now_text],
            )?;
            project_active_request_deliveries(transaction, &now_text)?;
            settle_terminal_requests(transaction, &now_text)?;
            promote_ready_requests(transaction, &now_text, &envelope.command_id)?;
            let claims = claim_deliveries(
                transaction,
                &envelope.payload.worker_id,
                envelope.payload.limit,
                &now,
            )?;
            let retention_boundary =
                (now - Duration::days(CHANNEL_TRANSPORT_RETENTION_DAYS)).to_rfc3339();
            transaction.execute(
                r#"
                DELETE FROM channel_inbound_aggregate
                WHERE finalized_at IS NOT NULL AND finalized_at < ?1
                  AND NOT EXISTS (
                      SELECT 1 FROM channel_turn_request
                      WHERE aggregate_id = channel_inbound_aggregate.id
                        AND status IN ('queued', 'admitted')
                  )
                "#,
                [&retention_boundary],
            )?;
            Ok(CommandHandlerResult::applied(
                "channel.host.tick_completed",
                json!({ "deliveries": claims }),
                None,
            ))
        })
    }

    pub fn settle_delivery(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SettleChannelDeliveryCommand>,
    ) -> Result<CommandExecution> {
        if !matches!(envelope.payload.outcome.as_str(), "sent" | "failed") {
            anyhow::bail!("outcome must be sent or failed");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can settle deliveries",
                ));
            }
            let state = transaction
                .query_row(
                    r#"
                    SELECT status, lease_owner, attempt_count
                    FROM channel_delivery WHERE id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((status, lease_owner, attempt_count)) = state else {
                return Ok(rejected(
                    "channel.delivery.not_found",
                    "Channel delivery does not exist",
                ));
            };
            if matches!(status.as_str(), "sent" | "failed") {
                return Ok(CommandHandlerResult::applied(
                    "channel.delivery.already_terminal",
                    json!({ "deliveryId": envelope.payload.delivery_id, "status": status }),
                    None,
                ));
            }
            if status != "attempting"
                || lease_owner.as_deref() != Some(envelope.payload.worker_id.as_str())
            {
                return Ok(rejected(
                    "channel.delivery.lease_mismatch",
                    "Delivery is not owned by this Host worker",
                ));
            }
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            if envelope.payload.outcome == "failed"
                && envelope.payload.retryable
                && attempt_count < MAX_DELIVERY_ATTEMPTS
            {
                let delay = 2_i64.pow(u32::try_from(attempt_count.min(5)).unwrap_or(5));
                let available_at = (now + Duration::seconds(delay)).to_rfc3339();
                transaction.execute(
                    r#"
                    UPDATE channel_delivery
                    SET status = 'pending', available_at = ?2,
                        lease_owner = NULL, lease_expires_at = NULL,
                        failure_code = ?3, updated_at = ?4
                    WHERE id = ?1
                    "#,
                    params![
                        envelope.payload.delivery_id,
                        available_at,
                        envelope.payload.failure_code,
                        now_text,
                    ],
                )?;
                return Ok(CommandHandlerResult::applied(
                    "channel.delivery.retry_scheduled",
                    json!({
                        "deliveryId": envelope.payload.delivery_id,
                        "status": "pending",
                        "availableAt": available_at,
                    }),
                    None,
                ));
            }
            transaction.execute(
                r#"
                UPDATE channel_delivery
                SET status = ?2, external_delivery_message_id = ?3,
                    failure_code = ?4, lease_owner = NULL, lease_expires_at = NULL,
                    ended_at = ?5, updated_at = ?5
                WHERE id = ?1
                "#,
                params![
                    envelope.payload.delivery_id,
                    envelope.payload.outcome,
                    envelope.payload.external_delivery_message_id,
                    envelope.payload.failure_code,
                    now_text,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "channel.delivery.settled",
                json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "status": envelope.payload.outcome,
                }),
                None,
            ))
        })
    }
}

#[derive(Debug)]
struct BoundGroupCamp {
    binding_id: String,
    camp_id: String,
    conversation_kind: String,
}

fn reconcile_bound_group_memberships(
    database: &mut Database,
    provider: &str,
    tenant_key: &str,
    chat_id: &str,
    parent_command_id: &str,
) -> Result<()> {
    let camps = query_rows(
        database.connection(),
        r#"
        SELECT binding.id, binding.camp_id, conversation.conversation_kind
        FROM channel_conversation AS conversation
        JOIN channel_conversation_binding AS binding
          ON binding.channel_conversation_id = conversation.id
         AND binding.status = 'active'
        WHERE conversation.provider = ?1
          AND conversation.tenant_key = ?2
          AND conversation.chat_id = ?3
          AND conversation.conversation_kind IN ('group', 'topic')
          AND binding.camp_id IS NOT NULL
        ORDER BY binding.id
        "#,
        params![provider, tenant_key, chat_id],
        |row| {
            Ok(BoundGroupCamp {
                binding_id: row.get(0)?,
                camp_id: row.get(1)?,
                conversation_kind: row.get(2)?,
            })
        },
    )?;
    let desired_agents = query_rows(
        database.connection(),
        r#"
        SELECT roster.agent_id
        FROM external_group_bot_roster AS roster
        JOIN feishu_member_bot AS bot
          ON bot.app_id = roster.app_id AND bot.agent_id = roster.agent_id
        WHERE roster.provider = ?1 AND roster.tenant_key = ?2
          AND roster.chat_id = ?3 AND roster.status = 'present'
          AND bot.status = 'published'
        ORDER BY roster.agent_id
        "#,
        params![provider, tenant_key, chat_id],
        |row| row.get::<_, String>(0),
    )?
    .into_iter()
    .collect::<BTreeSet<_>>();

    for camp in camps {
        let active_managed_agents = query_rows(
            database.connection(),
            r#"
            SELECT member.agent_id
            FROM camp_member AS member
            JOIN external_group_bot_roster AS roster
              ON roster.agent_id = member.agent_id
             AND roster.provider = ?2
             AND roster.tenant_key = ?3
             AND roster.chat_id = ?4
            WHERE member.camp_id = ?1 AND member.status = 'active'
              AND member.leave_requested_at IS NULL
            ORDER BY member.agent_id
            "#,
            params![camp.camp_id, provider, tenant_key, chat_id],
            |row| row.get::<_, String>(0),
        )?
        .into_iter()
        .collect::<BTreeSet<_>>();

        if camp.conversation_kind == "group" {
            for agent_id in desired_agents.difference(&active_managed_agents) {
                let (membership_generation, reconciliation_generation) =
                    channel_membership_generations(database, &camp.camp_id, &camp.binding_id)?;
                let execution = CollaborationService::default().add_camp_member(
                    database,
                    &CommandEnvelope {
                        command_id: format!(
                            "{parent_command_id}:{}:add:{agent_id}:{reconciliation_generation}",
                            camp.binding_id
                        ),
                        actor: ActorRef::System {
                            component_id: CHANNEL_MEMBERSHIP_SYNC_COMPONENT.to_string(),
                        },
                        camp_id: Some(camp.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: AddCampMemberCommand {
                            camp_id: camp.camp_id.clone(),
                            agent_id: agent_id.clone(),
                            expected_membership_generation: membership_generation,
                            capability_overrides: json!({}),
                            source: Some(CampMembershipMutationSource {
                                namespace: FEISHU_PROVIDER.to_string(),
                                binding_id: camp.binding_id.clone(),
                                reconciliation_generation,
                            }),
                        },
                    },
                )?;
                if execution.result.status == CommandResultStatus::Rejected {
                    anyhow::bail!(
                        "Feishu roster member add rejected: {}",
                        execution.result.code
                    );
                }
            }
        }

        for agent_id in active_managed_agents.difference(&desired_agents) {
            let Some(preview) = CollaborationService::default().camp_member_removal_preview(
                database,
                &camp.camp_id,
                agent_id,
            )?
            else {
                continue;
            };
            if !preview.removable
                || (preview.is_default_lead && preview.next_default_lead_agent_id.is_none())
            {
                continue;
            }
            let (_, reconciliation_generation) =
                channel_membership_generations(database, &camp.camp_id, &camp.binding_id)?;
            let execution = CollaborationService::default().remove_camp_member(
                database,
                &CommandEnvelope {
                    command_id: format!(
                        "{parent_command_id}:{}:remove:{agent_id}:{reconciliation_generation}",
                        camp.binding_id
                    ),
                    actor: ActorRef::System {
                        component_id: CHANNEL_MEMBERSHIP_SYNC_COMPONENT.to_string(),
                    },
                    camp_id: Some(camp.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RemoveCampMemberCommand {
                        camp_id: camp.camp_id.clone(),
                        agent_id: agent_id.clone(),
                        expected_membership_generation: preview.membership_generation,
                        expected_membership_version: preview.membership_version,
                        replacement_default_lead_agent_id: preview
                            .next_default_lead_agent_id
                            .clone(),
                        reason: Some("removed_from_feishu_group".to_string()),
                        source: Some(CampMembershipMutationSource {
                            namespace: FEISHU_PROVIDER.to_string(),
                            binding_id: camp.binding_id.clone(),
                            reconciliation_generation,
                        }),
                    },
                },
            )?;
            if execution.result.status == CommandResultStatus::Rejected {
                anyhow::bail!(
                    "Feishu roster member removal rejected: {}",
                    execution.result.code
                );
            }
        }
    }
    Ok(())
}

fn channel_membership_generations(
    database: &Database,
    camp_id: &str,
    binding_id: &str,
) -> Result<(i64, i64)> {
    database
        .connection()
        .query_row(
            r#"
            SELECT camp.membership_generation,
                   source.last_reconciliation_generation + 1
            FROM camp
            JOIN camp_membership_source_binding AS source
              ON source.camp_id = camp.id
             AND source.source_namespace = 'feishu'
             AND source.binding_id = ?2
             AND source.trusted_component_id = ?3
            WHERE camp.id = ?1
            "#,
            params![camp_id, binding_id, CHANNEL_MEMBERSHIP_SYNC_COMPONENT],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("channel Camp membership source binding is missing")
}

#[derive(Debug)]
struct CollectingAggregate {
    id: String,
    expected_app_ids_json: String,
    observed_app_ids_json: String,
    canonical_mentions_complete: bool,
    frozen_payload_json: String,
    deadline_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrozenInboundPayload {
    conversation_id: String,
    principal_id: Option<String>,
    binding_id_at_observation: Option<String>,
    structured_content: StructuredCampMessageContent,
    target_agent_ids: Vec<String>,
    acknowledgement_app_id: String,
}

#[derive(Debug)]
struct ChannelBindingAdmission {
    binding_id: String,
    #[allow(dead_code)]
    project_binding_id: String,
    camp_id: Option<String>,
    project_display_name: String,
    binding_kind: String,
    canonical_path: String,
    conversation_display_name: String,
    tenant_key: String,
    chat_id: String,
    conversation_kind: String,
}

fn load_collecting_aggregate(
    transaction: &Transaction<'_>,
    aggregate_id: &str,
) -> Result<Option<CollectingAggregate>> {
    transaction
        .query_row(
            r#"
            SELECT id, expected_app_ids_json, observed_app_ids_json,
                   canonical_mentions_complete, frozen_payload_json, deadline_at
            FROM channel_inbound_aggregate
            WHERE id = ?1 AND status = 'collecting'
            "#,
            [aggregate_id],
            |row| {
                Ok(CollectingAggregate {
                    id: row.get(0)?,
                    expected_app_ids_json: row.get(1)?,
                    observed_app_ids_json: row.get(2)?,
                    canonical_mentions_complete: row.get(3)?,
                    frozen_payload_json: row.get(4)?,
                    deadline_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn create_channel_camp(
    transaction: &Transaction<'_>,
    binding: &ChannelBindingAdmission,
    target_agent_ids: &[String],
    now: &str,
) -> Result<String> {
    let mut unique_targets = target_agent_ids.iter().cloned().collect::<BTreeSet<_>>();
    if unique_targets.is_empty() {
        anyhow::bail!("channel Camp requires at least one target Agent");
    }
    for agent_id in &unique_targets {
        let present: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_profile WHERE id = ?1 AND profile_status = 'present')",
            [agent_id],
            |row| row.get(0),
        )?;
        if !present {
            anyhow::bail!("channel target Agent is not present");
        }
    }
    let default_lead = unique_targets
        .pop_first()
        .context("channel Camp requires a Default Lead")?;
    unique_targets.insert(default_lead.clone());
    let camp_id = CampId::new().to_string();
    let title = format!(
        "{} · {}",
        binding.conversation_display_name, binding.project_display_name
    )
    .chars()
    .take(80)
    .collect::<String>();
    transaction.execute(
        r#"
        INSERT INTO camp(
            id, title, name_origin, collaboration_mode,
            project_binding_kind, project_path,
            default_lead_agent_id, activation_state, last_message_sequence,
            membership_generation, version, created_at, updated_at
        ) VALUES (?1, ?2, 'generated', 'peer', ?3, ?4, ?5, 'active', 0, 1, 1, ?6, ?6)
        "#,
        params![
            camp_id,
            title,
            binding.binding_kind,
            binding.canonical_path,
            default_lead,
            now,
        ],
    )?;
    for agent_id in unique_targets {
        transaction.execute(
            r#"
            INSERT INTO camp_member(
                camp_id, agent_id, status, capability_overrides_json,
                leave_requested_at, leave_request_command_id,
                pending_default_lead_successor_agent_id,
                version, joined_at, left_at
            ) VALUES (?1, ?2, 'active', '{}', NULL, NULL, NULL, 1, ?3, NULL)
            "#,
            params![camp_id, agent_id, now],
        )?;
    }
    transaction.execute(
        r#"
        INSERT INTO camp_membership_source_binding(
            camp_id, source_namespace, binding_id, trusted_component_id,
            last_reconciliation_generation, created_at, updated_at
        ) VALUES (?1, 'feishu', ?2, ?3, 0, ?4, ?4)
        "#,
        params![
            camp_id,
            binding.binding_id,
            CHANNEL_MEMBERSHIP_SYNC_COMPONENT,
            now,
        ],
    )?;
    transaction.execute(
        r#"
        UPDATE channel_conversation_binding
        SET camp_id = ?2, version = version + 1, updated_at = ?3
        WHERE id = ?1 AND camp_id IS NULL
        "#,
        params![binding.binding_id, camp_id, now],
    )?;
    Ok(camp_id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AdmissionAttempt {
    Admitted,
    Deferred,
    Failed(String),
}

fn try_admit_request(
    transaction: &Transaction<'_>,
    request_id: &str,
    now: &str,
    command_id: &str,
) -> Result<AdmissionAttempt> {
    let request = transaction
        .query_row(
            r#"
            SELECT channel_turn_request.camp_id,
                   channel_turn_request.external_principal_id,
                   channel_turn_request.structured_content_json,
                   channel_turn_request.addressed_agent_ids_json,
                   channel_turn_request.ack_app_id,
                   conversation.conversation_kind, conversation.tenant_key,
                   conversation.chat_id
            FROM channel_turn_request
            JOIN channel_conversation_binding AS binding
              ON binding.id = channel_turn_request.binding_id
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            WHERE channel_turn_request.id = ?1
              AND channel_turn_request.status = 'queued'
              AND NOT EXISTS (
                  SELECT 1 FROM channel_turn_request AS active
                  WHERE active.binding_id = channel_turn_request.binding_id
                    AND active.status = 'admitted'
              )
            "#,
            [request_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        camp_id,
        principal_id,
        content_json,
        targets_json,
        ack_app_id,
        conversation_kind,
        tenant_key,
        chat_id,
    )) = request
    else {
        return Ok(AdmissionAttempt::Deferred);
    };
    let content: StructuredCampMessageContent = serde_json::from_str(&content_json)?;
    let targets: Vec<String> = serde_json::from_str(&targets_json)?;
    for agent_id in &targets {
        let bot_state = transaction
            .query_row(
                "SELECT app_id, status FROM feishu_member_bot WHERE agent_id = ?1",
                [agent_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((_app_id, bot_status)) = bot_state else {
            return fail_queued_request(
                transaction,
                request_id,
                &ack_app_id,
                "channel.target_bot_unpublished",
                now,
            );
        };
        if bot_status != "published" {
            return fail_queued_request(
                transaction,
                request_id,
                &ack_app_id,
                "channel.target_bot_unpublished",
                now,
            );
        }
        if matches!(conversation_kind.as_str(), "group" | "topic") {
            let present: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM external_group_bot_roster
                    WHERE provider = 'feishu' AND tenant_key = ?1 AND chat_id = ?2
                      AND agent_id = ?3 AND status = 'present'
                )
                "#,
                params![tenant_key, chat_id, agent_id],
                |row| row.get(0),
            )?;
            if !present {
                return fail_queued_request(
                    transaction,
                    request_id,
                    &ack_app_id,
                    "channel.target_bot_not_in_roster",
                    now,
                );
            }
        }
    }
    let result = CollaborationService::default().admit_external_channel_message(
        transaction,
        ExternalChannelAdmissionInput {
            camp_id: camp_id.clone(),
            external_principal_id: principal_id,
            body: String::new(),
            structured_content: content,
            addressed_agent_ids: targets,
            command_id: format!("{command_id}:{request_id}:admission"),
            now: now.to_string(),
        },
    )?;
    let Ok(admission) = result else {
        let rejection = result.expect_err("checked external channel admission rejection");
        if rejection.code == "agent_run.runtime_not_ready" {
            // Runtime availability may change without another channel event.
            // The durable serial queue retries this blocker on Host ticks.
            return Ok(AdmissionAttempt::Deferred);
        }
        return fail_queued_request(transaction, request_id, &ack_app_id, &rejection.code, now);
    };
    transaction.execute(
        r#"
        UPDATE channel_turn_request
        SET status = 'admitted', camp_message_id = ?2, camp_turn_id = ?3,
            trigger_camp_sequence = ?4, admitted_at = ?5,
            version = version + 1, updated_at = ?5
        WHERE id = ?1 AND status = 'queued'
        "#,
        params![
            request_id,
            admission.camp_message_id,
            admission.camp_turn_id,
            admission.camp_sequence,
            now,
        ],
    )?;
    update_queue_ack_on_admission(transaction, request_id, &ack_app_id, now)?;
    for agent_run_id in admission.agent_run_ids {
        let agent_id: String = transaction.query_row(
            r#"
            SELECT conversation.agent_id
            FROM agent_run JOIN conversation ON conversation.id = agent_run.conversation_id
            WHERE agent_run.id = ?1
            "#,
            [&agent_run_id],
            |row| row.get(0),
        )?;
        insert_delivery(
            transaction,
            request_id,
            &format!("agent_status:{agent_run_id}:queued:1"),
            "agent_status",
            &bot_app_id(transaction, &agent_id)?.unwrap_or_else(|| ack_app_id.clone()),
            Some(&agent_id),
            None,
            &json!({
                "kind": "agent_status",
                "agentId": agent_id,
                "status": "queued",
                "text": "已进入 Rovai 执行队列",
            }),
            now,
        )?;
    }
    Ok(AdmissionAttempt::Admitted)
}

fn update_queue_ack_on_admission(
    transaction: &Transaction<'_>,
    request_id: &str,
    ack_app_id: &str,
    now: &str,
) -> Result<()> {
    let pending_delivery_id = transaction
        .query_row(
            r#"
            SELECT id FROM channel_delivery
            WHERE request_id = ?1 AND delivery_kind = 'queue_ack'
              AND status = 'pending'
            ORDER BY created_at, id
            LIMIT 1
            "#,
            [request_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let payload = json!({
        "kind": "queue_ack",
        "status": "admitted",
        "text": "Rovai 已开始处理这条消息",
    });
    if let Some(delivery_id) = pending_delivery_id {
        transaction.execute(
            r#"
            UPDATE channel_delivery
            SET payload_json = ?2, updated_at = ?3
            WHERE id = ?1 AND status = 'pending'
            "#,
            params![delivery_id, serde_json::to_string(&payload)?, now],
        )?;
    } else {
        let prior_ack_exists: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM channel_delivery
                WHERE request_id = ?1 AND delivery_kind = 'queue_ack'
            )
            "#,
            [request_id],
            |row| row.get(0),
        )?;
        if prior_ack_exists {
            insert_delivery(
                transaction,
                request_id,
                &format!("queue_started:{request_id}"),
                "queue_ack",
                ack_app_id,
                None,
                None,
                &payload,
                now,
            )?;
        }
    }
    Ok(())
}

fn fail_queued_request(
    transaction: &Transaction<'_>,
    request_id: &str,
    ack_app_id: &str,
    failure_code: &str,
    now: &str,
) -> Result<AdmissionAttempt> {
    transaction.execute(
        r#"
        UPDATE channel_turn_request
        SET status = 'failed', failure_code = ?2, completed_at = ?3,
            version = version + 1, updated_at = ?3
        WHERE id = ?1 AND status = 'queued'
        "#,
        params![request_id, failure_code, now],
    )?;
    insert_delivery(
        transaction,
        request_id,
        &format!("attention:{request_id}:{failure_code}"),
        "attention",
        ack_app_id,
        None,
        None,
        &json!({
            "kind": "attention",
            "failureCode": failure_code,
            "text": "这条消息当前无法交给目标队员，请确认 Bot 仍在群内且队员运行配置可用。",
        }),
        now,
    )?;
    Ok(AdmissionAttempt::Failed(failure_code.to_string()))
}

fn insert_queue_ack_delivery(
    transaction: &Transaction<'_>,
    request_id: &str,
    app_id: &str,
    queue_position: i64,
    admitted: bool,
    now: &str,
) -> Result<()> {
    insert_delivery(
        transaction,
        request_id,
        &format!("queue_ack:{request_id}"),
        "queue_ack",
        app_id,
        None,
        None,
        &json!({
            "kind": "queue_ack",
            "queuePosition": queue_position,
            "status": if admitted { "admitted" } else { "queued" },
            "text": if admitted { "Rovai 已接收，正在执行" } else { "Rovai 已接收，正在排队" },
        }),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn insert_delivery(
    transaction: &Transaction<'_>,
    request_id: &str,
    dedupe_key: &str,
    delivery_kind: &str,
    target_app_id: &str,
    source_agent_id: Option<&str>,
    source_camp_message_id: Option<&str>,
    payload: &Value,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO channel_delivery(
            id, request_id, dedupe_key, delivery_kind, target_app_id,
            source_agent_id, source_camp_message_id, payload_json,
            status, attempt_count, available_at, lease_owner, lease_expires_at,
            external_delivery_message_id, failure_code, created_at, updated_at, ended_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            'pending', 0, ?9, NULL, NULL, NULL, NULL, ?9, ?9, NULL
        )
        ON CONFLICT(dedupe_key) DO NOTHING
        "#,
        params![
            format!("rvcd_{}", Uuid::new_v4().simple()),
            request_id,
            dedupe_key,
            delivery_kind,
            target_app_id,
            source_agent_id,
            source_camp_message_id,
            serde_json::to_string(payload)?,
            now,
        ],
    )?;
    Ok(())
}

fn project_active_request_deliveries(transaction: &Transaction<'_>, now: &str) -> Result<()> {
    let active = query_rows(
        transaction,
        r#"
        SELECT request.id, request.camp_turn_id, request.trigger_camp_sequence,
               request.ack_app_id
        FROM channel_turn_request AS request
        WHERE request.status = 'admitted'
        ORDER BY request.created_at, request.id
        "#,
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    )?;
    for (request_id, camp_turn_id, trigger_sequence, ack_app_id) in active {
        let run_states = query_rows(
            transaction,
            r#"
            SELECT run.id, conversation.agent_id, run.status, run.version
            FROM agent_run AS run
            JOIN conversation ON conversation.id = run.conversation_id
            WHERE run.camp_turn_id = ?1
            ORDER BY run.created_at, run.id
            "#,
            [&camp_turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )?;
        for (run_id, agent_id, status, version) in run_states {
            insert_delivery(
                transaction,
                &request_id,
                &format!("agent_status:{run_id}:{status}:{version}"),
                "agent_status",
                &bot_app_id(transaction, &agent_id)?.unwrap_or_else(|| ack_app_id.clone()),
                Some(&agent_id),
                None,
                &json!({
                    "kind": "agent_status",
                    "agentId": agent_id,
                    "status": status,
                    "text": run_status_text(&status),
                }),
                now,
            )?;
        }
        let outputs = query_rows(
            transaction,
            r#"
            SELECT message.id, message.author_id, message.body,
                   message.structured_content_json
            FROM camp_message AS message
            WHERE message.camp_turn_id = ?1
              AND message.sequence > ?2
              AND message.author_type = 'agent'
              AND message.tombstoned_at IS NULL
            ORDER BY message.sequence, message.id
            "#,
            params![camp_turn_id, trigger_sequence],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )?;
        for (message_id, agent_id, body, structured_content_json) in outputs {
            let content: StructuredCampMessageContent =
                serde_json::from_str(&structured_content_json)?;
            if let Some(author_app_id) = bot_app_id(transaction, &agent_id)? {
                insert_delivery(
                    transaction,
                    &request_id,
                    &format!("agent_output:{message_id}"),
                    "agent_output",
                    &author_app_id,
                    Some(&agent_id),
                    Some(&message_id),
                    &json!({
                        "kind": "agent_output",
                        "agentId": agent_id,
                        "body": body,
                        "mentionPrincipal": mentions_current_user(&content),
                    }),
                    now,
                )?;
            } else {
                insert_delivery(
                    transaction,
                    &request_id,
                    &format!("agent_output_identity_missing:{message_id}"),
                    "attention",
                    &ack_app_id,
                    Some(&agent_id),
                    Some(&message_id),
                    &json!({
                        "kind": "attention",
                        "failureCode": "channel.author_bot_unpublished",
                        "text": "一名队员已产生公开回复，但其飞书 Bot 当前不可用；Rovai 没有用其他 Bot 冒充发送。",
                    }),
                    now,
                )?;
            }
        }
        let turn_status: String = transaction.query_row(
            "SELECT status FROM camp_turn WHERE id = ?1",
            [&camp_turn_id],
            |row| row.get(0),
        )?;
        if matches!(turn_status.as_str(), "completed" | "failed" | "cancelled") {
            insert_delivery(
                transaction,
                &request_id,
                &format!("completion:{request_id}:{turn_status}"),
                "completion",
                &ack_app_id,
                None,
                None,
                &json!({
                    "kind": "completion",
                    "status": turn_status,
                    "text": match turn_status.as_str() {
                        "completed" => "本轮协作已完成",
                        "cancelled" => "本轮协作已取消",
                        _ => "本轮协作已结束，但有任务失败",
                    },
                }),
                now,
            )?;
        }
    }
    Ok(())
}

fn settle_terminal_requests(transaction: &Transaction<'_>, now: &str) -> Result<()> {
    let terminal = query_rows(
        transaction,
        r#"
        SELECT request.id,
               EXISTS(
                   SELECT 1 FROM channel_delivery
                   WHERE request_id = request.id AND delivery_kind = 'completion'
               ) AS has_completion,
               EXISTS(
                   SELECT 1 FROM channel_delivery
                   WHERE request_id = request.id AND status IN ('pending', 'attempting')
               ) AS has_nonterminal_delivery,
               EXISTS(
                   SELECT 1 FROM channel_delivery
                   WHERE request_id = request.id AND status = 'failed'
               ) AS has_failed_delivery
        FROM channel_turn_request AS request
        WHERE request.status = 'admitted'
        "#,
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, bool>(3)?,
            ))
        },
    )?;
    for (request_id, has_completion, has_nonterminal, has_failed) in terminal {
        if has_completion && !has_nonterminal {
            transaction.execute(
                r#"
                UPDATE channel_turn_request
                SET status = ?2, failure_code = ?3,
                    completed_at = ?4, updated_at = ?4, version = version + 1
                WHERE id = ?1 AND status = 'admitted'
                "#,
                params![
                    request_id,
                    if has_failed { "failed" } else { "completed" },
                    has_failed.then_some("channel_delivery_failed"),
                    now,
                ],
            )?;
        }
    }
    Ok(())
}

fn promote_ready_requests(
    transaction: &Transaction<'_>,
    now: &str,
    command_id: &str,
) -> Result<()> {
    let candidates = query_rows(
        transaction,
        r#"
        SELECT queued.id
        FROM channel_turn_request AS queued
        WHERE queued.status = 'queued'
          AND NOT EXISTS (
              SELECT 1 FROM channel_turn_request AS active
              WHERE active.binding_id = queued.binding_id
                AND active.status = 'admitted'
          )
          AND queued.id = (
              SELECT next.id FROM channel_turn_request AS next
              WHERE next.binding_id = queued.binding_id AND next.status = 'queued'
              ORDER BY next.queue_position, next.created_at, next.id
              LIMIT 1
          )
        ORDER BY queued.created_at, queued.id
        "#,
        [],
        |row| row.get::<_, String>(0),
    )?;
    for request_id in candidates {
        try_admit_request(transaction, &request_id, now, command_id)?;
    }
    Ok(())
}

fn claim_deliveries(
    transaction: &Transaction<'_>,
    worker_id: &str,
    limit: usize,
    now: &chrono::DateTime<Utc>,
) -> Result<Vec<ClaimedChannelDelivery>> {
    let now_text = now.to_rfc3339();
    transaction.execute(
        r#"
        UPDATE channel_delivery
        SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
            failure_code = COALESCE(failure_code, 'lease_expired'),
            available_at = ?1, updated_at = ?1
        WHERE status = 'attempting' AND lease_expires_at <= ?1
        "#,
        [&now_text],
    )?;
    let ids = query_rows(
        transaction,
        r#"
        SELECT id FROM channel_delivery
        WHERE status = 'pending' AND available_at <= ?1
        ORDER BY available_at, created_at, id
        LIMIT ?2
        "#,
        params![now_text, i64::try_from(limit)?],
        |row| row.get::<_, String>(0),
    )?;
    let lease_expires_at = (*now + Duration::seconds(DELIVERY_LEASE_SECONDS)).to_rfc3339();
    let mut claims = Vec::new();
    for delivery_id in ids {
        let changed = transaction.execute(
            r#"
            UPDATE channel_delivery
            SET status = 'attempting', attempt_count = attempt_count + 1,
                lease_owner = ?2, lease_expires_at = ?3, updated_at = ?4
            WHERE id = ?1 AND status = 'pending' AND available_at <= ?4
            "#,
            params![delivery_id, worker_id, lease_expires_at, now_text],
        )?;
        if changed == 0 {
            continue;
        }
        let claim = transaction.query_row(
            r#"
            SELECT delivery.id, delivery.request_id, delivery.delivery_kind,
                   delivery.target_app_id, COALESCE(bot.credential_ref, ''),
                   conversation.chat_id, conversation.topic_key,
                   conversation.conversation_kind, delivery.payload_json,
                   delivery.attempt_count,
                   (
                       SELECT previous.external_delivery_message_id
                       FROM channel_delivery AS previous
                       WHERE previous.request_id = delivery.request_id
                         AND previous.id <> delivery.id
                         AND previous.status = 'sent'
                         AND previous.external_delivery_message_id IS NOT NULL
                         AND (
                             (delivery.delivery_kind IN ('queue_ack', 'completion', 'attention')
                              AND previous.delivery_kind = 'queue_ack')
                             OR
                             (delivery.delivery_kind IN ('agent_status', 'agent_output')
                              AND previous.source_agent_id = delivery.source_agent_id
                              AND previous.delivery_kind IN ('agent_status', 'agent_output'))
                         )
                       ORDER BY previous.ended_at DESC, previous.id DESC
                       LIMIT 1
                   ) AS update_message_id
                   ,(
                       SELECT identity.external_id
                       FROM external_principal_app_identity AS identity
                       WHERE identity.principal_id = request.external_principal_id
                         AND identity.provider = 'feishu'
                         AND identity.app_id = delivery.target_app_id
                         AND identity.identity_kind = 'open_id'
                       LIMIT 1
                   ) AS recipient_open_id
            FROM channel_delivery AS delivery
            JOIN channel_turn_request AS request ON request.id = delivery.request_id
            JOIN channel_conversation_binding AS binding ON binding.id = request.binding_id
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            LEFT JOIN feishu_member_bot AS bot
              ON bot.app_id = delivery.target_app_id
            WHERE delivery.id = ?1
            "#,
            [&delivery_id],
            |row| {
                let payload_json = row.get::<_, String>(8)?;
                let payload = serde_json::from_str(&payload_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        8,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(ClaimedChannelDelivery {
                    delivery_id: row.get(0)?,
                    request_id: row.get(1)?,
                    delivery_kind: row.get(2)?,
                    target_app_id: row.get(3)?,
                    credential_ref: row.get(4)?,
                    chat_id: row.get(5)?,
                    topic_key: row.get(6)?,
                    conversation_kind: row.get(7)?,
                    payload,
                    attempt_count: row.get(9)?,
                    update_message_id: row.get(10)?,
                    recipient_open_id: row.get(11)?,
                })
            },
        )?;
        claims.push(claim);
    }
    Ok(claims)
}

fn missing_active_members(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_ids: &[String],
) -> Result<Vec<String>> {
    let mut missing = Vec::new();
    for agent_id in agent_ids {
        let active: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM camp_member
                WHERE camp_id = ?1 AND agent_id = ?2
                  AND status = 'active' AND leave_requested_at IS NULL
            )
            "#,
            params![camp_id, agent_id],
            |row| row.get(0),
        )?;
        if !active {
            missing.push(agent_id.clone());
        }
    }
    Ok(missing)
}

fn resolve_observation_targets(
    transaction: &Transaction<'_>,
    command: &ObserveChannelInboundCommand,
) -> Result<Vec<String>> {
    let expected_apps = sorted_unique(&command.expected_app_ids);
    let mut targets_by_app = BTreeMap::new();
    for app_id in &expected_apps {
        let agent_id = transaction
            .query_row(
                "SELECT agent_id FROM feishu_member_bot WHERE app_id = ?1 AND status = 'published'",
                [app_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .with_context(|| {
                format!("expected Feishu App {app_id} is not a published member Bot")
            })?;
        targets_by_app.insert(app_id.clone(), agent_id);
    }
    let expected_targets = targets_by_app.values().cloned().collect::<BTreeSet<_>>();
    let canonical_targets = command
        .canonical_agent_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if command.canonical_mentions_complete && canonical_targets != expected_targets {
        anyhow::bail!("canonical Agent mentions do not match expected member Bot Apps");
    }
    if expected_targets.is_empty() {
        anyhow::bail!("channel message has no expected member Bot target");
    }
    Ok(expected_targets.into_iter().collect())
}

fn build_external_content(
    command: &ObserveChannelInboundCommand,
    target_agent_ids: &[String],
) -> Result<StructuredCampMessageContent> {
    let mut content = Vec::new();
    if let Some(quote) = &command.quote {
        let sender_display_name = normalize_display_name(&quote.sender_display_name)?;
        let body = quote.body.chars().take(8_000).collect::<String>();
        let attachment_summaries = quote
            .attachment_summaries
            .iter()
            .map(|attachment| ExternalQuoteAttachmentSummary {
                name: attachment.name.clone(),
                media_type: attachment.media_type.clone(),
            })
            .collect::<Vec<_>>();
        let content_digest = format!(
            "sha256:{}",
            canonical_json_digest(&json!({
                "senderDisplayName": sender_display_name,
                "body": body,
                "attachmentSummaries": attachment_summaries,
            }))?
        );
        content.push(StructuredCampMessageSegment::ExternalQuote {
            sender_display_name,
            body,
            attachment_summaries,
            content_digest,
        });
        content.push(StructuredCampMessageSegment::Text {
            text: "\n\n".to_string(),
        });
    }
    for agent_id in target_agent_ids {
        content.push(StructuredCampMessageSegment::MemberMention {
            agent_id: agent_id.clone(),
        });
        content.push(StructuredCampMessageSegment::Text {
            text: " ".to_string(),
        });
    }
    content.push(StructuredCampMessageSegment::Text {
        text: command.body.clone(),
    });
    for attachment in &command.attachment_summaries {
        content.push(StructuredCampMessageSegment::Text {
            text: format!(
                "\n[附件] {}{}",
                attachment.name,
                attachment
                    .media_type
                    .as_deref()
                    .map(|media_type| format!(" ({media_type})"))
                    .unwrap_or_default()
            ),
        });
    }
    let content = normalize_content(content);
    validate_content(&content)?;
    let _ = canonical_content_digest(&content)?;
    Ok(content)
}

fn validate_observation_input(command: &ObserveChannelInboundCommand) -> Result<()> {
    if command.provider != FEISHU_PROVIDER {
        anyhow::bail!("only the Feishu channel provider is supported");
    }
    for (value, field) in [
        (&command.app_id, "appId"),
        (&command.external_message_id, "externalMessageId"),
        (&command.tenant_key, "tenantKey"),
        (&command.chat_id, "chatId"),
        (
            &command.conversation_display_name,
            "conversationDisplayName",
        ),
        (&command.sender_external_user_id, "senderExternalUserId"),
        (&command.sender_display_name, "senderDisplayName"),
        (&command.acknowledgement_app_id, "acknowledgementAppId"),
    ] {
        validate_nonempty(value, field)?;
    }
    for (value, field) in [
        (command.sender_open_id.as_deref(), "senderOpenId"),
        (command.sender_user_id.as_deref(), "senderUserId"),
        (command.sender_union_id.as_deref(), "senderUnionId"),
    ] {
        if let Some(value) = value {
            validate_nonempty(value, field)?;
        }
    }
    if !matches!(
        command.conversation_kind.as_str(),
        "p2p" | "group" | "topic"
    ) {
        anyhow::bail!("conversationKind must be p2p, group or topic");
    }
    if (command.conversation_kind == "topic") != !command.topic_key.is_empty() {
        anyhow::bail!("topic conversation requires exactly one topicKey");
    }
    if command.body.chars().count() > 32_768 {
        anyhow::bail!("channel message body exceeds 32 Ki Unicode scalar budget");
    }
    if command.expected_app_ids.is_empty() || command.expected_app_ids.len() > 64 {
        anyhow::bail!("expectedAppIds must contain between 1 and 64 Apps");
    }
    if sorted_unique(&command.expected_app_ids).len() != command.expected_app_ids.len() {
        anyhow::bail!("expectedAppIds must contain distinct Apps");
    }
    if !command.expected_app_ids.contains(&command.app_id) {
        anyhow::bail!("the observing appId must be one of expectedAppIds");
    }
    if !command
        .expected_app_ids
        .contains(&command.acknowledgement_app_id)
    {
        anyhow::bail!("acknowledgementAppId must be one of expectedAppIds");
    }
    if command.attachment_summaries.len() > 20 {
        anyhow::bail!("channel message has too many attachment summaries");
    }
    Ok(())
}

fn validate_binding_path(binding_kind: &str, canonical_path: &str) -> Result<()> {
    if !matches!(binding_kind, "quick_chat" | "directory") {
        anyhow::bail!("bindingKind must be quick_chat or directory");
    }
    let path = Path::new(canonical_path);
    if canonical_path.trim() != canonical_path
        || canonical_path.is_empty()
        || !path.is_absolute()
        || path.parent().is_none()
    {
        anyhow::bail!("canonicalPath must be a safe absolute non-root path");
    }
    Ok(())
}

fn normalize_display_name(value: &str) -> Result<String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > 120 || value.chars().any(char::is_control) {
        anyhow::bail!("display name must contain 1 to 120 safe Unicode scalar values");
    }
    Ok(value)
}

fn normalize_optional_email(value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 320
        || value.chars().any(char::is_control)
        || !value.contains('@')
        || value.starts_with('@')
        || value.ends_with('@')
    {
        anyhow::bail!("email must be a bounded email address");
    }
    Ok(Some(value.to_string()))
}

fn validate_publication_intent_state(value: &str) -> Result<()> {
    if !matches!(
        value,
        "created"
            | "session_verified"
            | "app_created"
            | "credentials_read"
            | "bot_configured"
            | "version_published"
            | "connection_verified"
            | "completed"
            | "failed_recoverable"
            | "failed_unknown_remote_state"
    ) {
        anyhow::bail!("unknown member Bot publication intent state");
    }
    Ok(())
}

fn publication_intent_transition_allowed(current: &str, next: &str) -> bool {
    if current == next {
        return true;
    }
    if current == "completed" {
        return next == "session_verified";
    }
    if current == "failed_unknown_remote_state" {
        return matches!(next, "credentials_read" | "failed_recoverable");
    }
    if matches!(next, "failed_recoverable" | "failed_unknown_remote_state") {
        return true;
    }
    let rank = |state: &str| match state {
        "created" => Some(0),
        "session_verified" => Some(1),
        "app_created" => Some(2),
        "credentials_read" => Some(3),
        "bot_configured" => Some(4),
        "version_published" => Some(5),
        "connection_verified" => Some(6),
        "completed" => Some(7),
        _ => None,
    };
    match (rank(current), rank(next)) {
        (Some(current), Some(next)) => next == current + 1,
        (None, Some(_)) if current == "failed_recoverable" => true,
        _ => false,
    }
}

fn publication_intent_requires_app(state: &str) -> bool {
    matches!(
        state,
        "app_created"
            | "credentials_read"
            | "bot_configured"
            | "version_published"
            | "connection_verified"
            | "completed"
    )
}

fn validate_nonempty(value: &str, field: &str) -> Result<()> {
    if value.trim() != value || value.is_empty() || value.len() > 512 {
        anyhow::bail!("{field} must be a bounded canonical value");
    }
    Ok(())
}

fn validate_digest(value: &str, field: &str) -> Result<()> {
    let valid = value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    if !valid {
        anyhow::bail!("{field} must be a canonical SHA-256 digest");
    }
    Ok(())
}

fn stable_external_principal_id(provider: &str, tenant: &str, user_id: &str) -> Result<String> {
    let digest = canonical_json_digest(&json!([provider, tenant, user_id]))?;
    Ok(format!("rvxp_{}", &digest[..32]))
}

fn resolve_external_principal_id(
    transaction: &Transaction<'_>,
    command: &ObserveChannelInboundCommand,
    fallback_id: &str,
) -> Result<String> {
    for (identity_kind, external_id, app_scoped) in [
        ("union_id", command.sender_union_id.as_deref(), false),
        ("user_id", command.sender_user_id.as_deref(), false),
        ("open_id", command.sender_open_id.as_deref(), true),
    ] {
        let Some(external_id) = external_id else {
            continue;
        };
        let existing = transaction
            .query_row(
                r#"
                SELECT identity.principal_id
                FROM external_principal_app_identity AS identity
                JOIN external_principal AS principal ON principal.id = identity.principal_id
                WHERE identity.provider = ?1
                  AND principal.tenant_key = ?2
                  AND identity.identity_kind = ?3
                  AND identity.external_id = ?4
                  AND (?5 = 0 OR identity.app_id = ?6)
                ORDER BY identity.updated_at DESC, identity.principal_id
                LIMIT 1
                "#,
                params![
                    command.provider,
                    command.tenant_key,
                    identity_kind,
                    external_id,
                    app_scoped,
                    command.app_id,
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(principal_id) = existing {
            return Ok(principal_id);
        }
    }
    Ok(fallback_id.to_string())
}

fn stable_channel_conversation_id(
    provider: &str,
    tenant: &str,
    chat_id: &str,
    topic_key: &str,
    bot_scope_app_id: &str,
) -> Result<String> {
    let digest = canonical_json_digest(&json!([
        provider,
        tenant,
        chat_id,
        topic_key,
        bot_scope_app_id
    ]))?;
    Ok(format!("rvcc_{}", &digest[..32]))
}

fn parse_string_set(value: &str) -> Result<BTreeSet<String>> {
    serde_json::from_str(value).context("stored channel identity set is invalid")
}

fn sorted_unique(values: &[String]) -> BTreeSet<String> {
    values.iter().cloned().collect()
}

fn bot_app_id(transaction: &Transaction<'_>, agent_id: &str) -> Result<Option<String>> {
    transaction
        .query_row(
            "SELECT app_id FROM feishu_member_bot WHERE agent_id = ?1 AND status = 'published'",
            [agent_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn run_status_text(status: &str) -> &'static str {
    match status {
        "queued" => "已进入 Rovai 执行队列",
        "running" => "正在处理",
        "waiting" => "正在等待运行条件",
        "succeeded" => "处理完成",
        "cancelled" => "已取消",
        _ => "处理失败",
    }
}

fn is_owner(actor: &ActorRef) -> bool {
    matches!(actor, ActorRef::User { user_id } if user_id == CURRENT_USER_ID)
}

fn is_channel_host(actor: &ActorRef) -> bool {
    matches!(actor, ActorRef::System { component_id } if component_id == FEISHU_CHANNEL_HOST_COMPONENT)
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn version_conflict(current_version: i64) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        "command.version_conflict",
        json!({ "currentVersion": current_version }),
    )
}

fn member_bot_publication_ready(
    transaction: &Transaction<'_>,
    command: &UpsertFeishuMemberBotCommand,
) -> Result<bool> {
    Ok(transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM feishu_member_bot_publication_intent
            WHERE agent_id = ?1 AND account_id = ?2
              AND remote_app_id = ?3 AND credential_ref = ?4
              AND state = 'version_published'
        )
        "#,
        params![
            command.agent_id,
            command.account_id,
            command.app_id,
            command.credential_ref,
        ],
        |row| row.get(0),
    )?)
}

fn query_rows<T, P, F>(
    connection: &rusqlite::Connection,
    sql: &str,
    params: P,
    map: F,
) -> Result<Vec<T>>
where
    P: rusqlite::Params,
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut statement = connection.prepare(sql)?;
    Ok(statement
        .query_map(params, map)?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{command::CommandResultStatus, test_support::seeded_runtime_database_owned};

    fn owner_envelope<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: CURRENT_USER_ID.to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn host_envelope<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: FEISHU_CHANNEL_HOST_COMPONENT.to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn connect_account(service: &ChannelService, database: &mut Database) {
        connect_account_with_command_id(service, database, "account");
    }

    fn connect_account_with_command_id(
        service: &ChannelService,
        database: &mut Database,
        command_id: &str,
    ) {
        service
            .upsert_feishu_account(
                database,
                &host_envelope(
                    command_id,
                    UpsertFeishuAccountCommand {
                        account_id: "account_1".to_string(),
                        user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        tenant_id: "tenant_1".to_string(),
                        user_name: "主人".to_string(),
                        email: Some("owner@example.com".to_string()),
                        tenant_name: "测试租户".to_string(),
                        brand: "feishu".to_string(),
                    },
                ),
            )
            .unwrap();
    }

    fn publish_bot(
        service: &ChannelService,
        database: &mut Database,
        agent_id: &str,
        app_id: &str,
    ) {
        let publication_intent_id = format!("intent-{agent_id}");
        let credential_ref = format!("feishu/member/{agent_id}");
        service
            .create_member_bot_publication_intent(
                database,
                &host_envelope(
                    &format!("create-{publication_intent_id}"),
                    CreateMemberBotPublicationIntentCommand {
                        publication_intent_id: publication_intent_id.clone(),
                        account_id: "account_1".to_string(),
                        agent_id: agent_id.to_string(),
                        expected_user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        expected_tenant_id: "tenant_1".to_string(),
                        requested_app_name: agent_id.to_string(),
                        provisioning_mode: "developer_session".to_string(),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state) in [
            (1, "session_verified"),
            (2, "app_created"),
            (3, "credentials_read"),
            (4, "bot_configured"),
            (5, "version_published"),
        ] {
            service
                .advance_member_bot_publication_intent(
                    database,
                    &host_envelope(
                        &format!("{publication_intent_id}-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: publication_intent_id.clone(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: (state != "session_verified")
                                .then(|| app_id.to_string()),
                            credential_ref: matches!(
                                state,
                                "credentials_read" | "bot_configured" | "version_published"
                            )
                            .then(|| credential_ref.clone()),
                            last_completed_step: Some(state.to_string()),
                            failure_code: None,
                        },
                    ),
                )
                .unwrap();
        }
        service
            .upsert_feishu_member_bot(
                database,
                &host_envelope(
                    &format!("publish-{agent_id}"),
                    UpsertFeishuMemberBotCommand {
                        account_id: "account_1".to_string(),
                        agent_id: agent_id.to_string(),
                        app_id: app_id.to_string(),
                        bot_open_id: Some(format!("ou_bot_{agent_id}")),
                        bot_display_name: agent_id.to_string(),
                        credential_ref: credential_ref.clone(),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state) in [(6, "connection_verified"), (7, "completed")] {
            service
                .advance_member_bot_publication_intent(
                    database,
                    &host_envelope(
                        &format!("{publication_intent_id}-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: publication_intent_id.clone(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: Some(app_id.to_string()),
                            credential_ref: Some(credential_ref.clone()),
                            last_completed_step: Some(state.to_string()),
                            failure_code: None,
                        },
                    ),
                )
                .unwrap();
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn observation_command(
        app_id: &str,
        external_message_id: &str,
        chat_id: &str,
        topic_key: &str,
        conversation_kind: &str,
        body: &str,
        targets: &[(&str, &str)],
        canonical_mentions_complete: bool,
    ) -> ObserveChannelInboundCommand {
        ObserveChannelInboundCommand {
            provider: FEISHU_PROVIDER.to_string(),
            app_id: app_id.to_string(),
            external_message_id: external_message_id.to_string(),
            tenant_key: "tenant_1".to_string(),
            chat_id: chat_id.to_string(),
            topic_key: topic_key.to_string(),
            conversation_kind: conversation_kind.to_string(),
            conversation_display_name: "测试会话".to_string(),
            sender_external_user_id: "union_user".to_string(),
            sender_open_id: Some("ou_user".to_string()),
            sender_user_id: Some("user_1".to_string()),
            sender_union_id: Some("union_user".to_string()),
            sender_display_name: "小明".to_string(),
            body: body.to_string(),
            attachment_summaries: Vec::new(),
            quote: None,
            canonical_agent_ids: targets
                .iter()
                .map(|(agent_id, _)| (*agent_id).to_string())
                .collect(),
            canonical_mentions_complete,
            expected_app_ids: targets
                .iter()
                .map(|(_, app_id)| (*app_id).to_string())
                .collect(),
            acknowledgement_app_id: targets[0].1.to_string(),
        }
    }

    fn create_binding(
        service: &ChannelService,
        database: &mut Database,
        conversation_id: &str,
        conversation_version: i64,
    ) -> String {
        let path = database.path().parent().unwrap().join("channel-project");
        std::fs::create_dir_all(&path).unwrap();
        let created = service
            .create_project_binding(
                database,
                &owner_envelope(
                    &format!("create-binding-{conversation_id}"),
                    CreateProjectBindingCommand {
                        display_name: "渠道项目".to_string(),
                        binding_kind: "directory".to_string(),
                        canonical_path: path.to_string_lossy().to_string(),
                    },
                ),
            )
            .unwrap();
        let project_binding_id = created.result.payload["projectBindingId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .bind_conversation(
                database,
                &owner_envelope(
                    &format!("bind-{conversation_id}"),
                    BindChannelConversationCommand {
                        channel_conversation_id: conversation_id.to_string(),
                        project_binding_id,
                        expected_conversation_version: conversation_version,
                    },
                ),
            )
            .unwrap();
        created.result.payload["projectBindingId"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn only_owner_can_create_project_bindings() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        let path = database.path().parent().unwrap().join("channel-project");
        std::fs::create_dir_all(&path).unwrap();
        let mut envelope = owner_envelope(
            "project-binding-owner",
            CreateProjectBindingCommand {
                display_name: "渠道项目".to_string(),
                binding_kind: "directory".to_string(),
                canonical_path: path.to_string_lossy().to_string(),
            },
        );
        envelope.actor = ActorRef::System {
            component_id: FEISHU_CHANNEL_HOST_COMPONENT.to_string(),
        };
        let rejected = service
            .create_project_binding(&mut database, &envelope)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "project_binding.owner_required");
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM project_binding", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn developer_identity_and_unknown_publication_state_are_persistent_core_facts() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        let first = service.snapshot(&database).unwrap().account.unwrap();
        assert_eq!(first.account_id, "account_1");
        assert_eq!(first.user_id_digest, format!("sha256:{}", "a".repeat(64)));
        assert_eq!(first.tenant_id, "tenant_1");
        assert_eq!(first.user_name, "主人");
        assert_eq!(first.email.as_deref(), Some("owner@example.com"));
        assert_eq!(first.brand, "feishu");

        connect_account_with_command_id(&service, &mut database, "account-verify");
        let verified = service.snapshot(&database).unwrap().account.unwrap();
        assert_eq!(verified.connected_at, first.connected_at);
        assert!(verified.version > first.version);

        let created = service
            .create_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-create",
                    CreateMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_1".to_string(),
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        expected_user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        expected_tenant_id: "tenant_1".to_string(),
                        requested_app_name: "木瓦".to_string(),
                        provisioning_mode: "developer_session".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(created.result.status, CommandResultStatus::Applied);
        for (version, state) in [(1, "session_verified"), (2, "failed_unknown_remote_state")] {
            let failure_code = (state == "failed_unknown_remote_state")
                .then(|| "provisioning_transport_lost".to_string());
            let advanced = service
                .advance_member_bot_publication_intent(
                    &mut database,
                    &host_envelope(
                        &format!("publication-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: "intent_1".to_string(),
                            expected_version: version,
                            state: state.to_string(),
                            remote_app_id: (state == "failed_unknown_remote_state")
                                .then(|| "cli_unknown".to_string()),
                            credential_ref: None,
                            last_completed_step: (state == "session_verified")
                                .then(|| state.to_string()),
                            failure_code,
                        },
                    ),
                )
                .unwrap();
            assert_eq!(advanced.result.status, CommandResultStatus::Applied);
        }
        let snapshot = service.snapshot(&database).unwrap();
        assert_eq!(
            snapshot.publication_intents[0].state,
            "failed_unknown_remote_state"
        );
        assert_eq!(
            snapshot.publication_intents[0].failure_code.as_deref(),
            Some("provisioning_transport_lost")
        );

        let duplicate = service
            .create_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-duplicate",
                    CreateMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_2".to_string(),
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        expected_user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        expected_tenant_id: "tenant_1".to_string(),
                        requested_app_name: "木瓦".to_string(),
                        provisioning_mode: "developer_session".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(duplicate.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            duplicate.result.code,
            "feishu_publication_intent.active_conflict"
        );

        let reclassified = service
            .advance_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-known-app-recoverable",
                    AdvanceMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_1".to_string(),
                        expected_version: 3,
                        state: "failed_recoverable".to_string(),
                        remote_app_id: Some("cli_unknown".to_string()),
                        credential_ref: None,
                        last_completed_step: Some("session_verified".to_string()),
                        failure_code: Some("feishu_console_event_verification_failed".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(reclassified.result.status, CommandResultStatus::Applied);

        let wrong_app = service
            .advance_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-reconcile-wrong-app",
                    AdvanceMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_1".to_string(),
                        expected_version: 4,
                        state: "credentials_read".to_string(),
                        remote_app_id: Some("cli_other".to_string()),
                        credential_ref: Some("feishu-member-agent_1".to_string()),
                        last_completed_step: Some("credentials_read".to_string()),
                        failure_code: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(wrong_app.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            wrong_app.result.code,
            "feishu_publication_intent.remote_app_conflict"
        );

        let reconciled = service
            .advance_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-reconcile",
                    AdvanceMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_1".to_string(),
                        expected_version: 4,
                        state: "credentials_read".to_string(),
                        remote_app_id: Some("cli_unknown".to_string()),
                        credential_ref: Some("feishu-member-agent_1".to_string()),
                        last_completed_step: Some("credentials_read".to_string()),
                        failure_code: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(reconciled.result.status, CommandResultStatus::Applied);
        let recovered = service.snapshot(&database).unwrap();
        assert_eq!(recovered.publication_intents[0].state, "credentials_read");
        assert_eq!(
            recovered.publication_intents[0].remote_app_id.as_deref(),
            Some("cli_unknown")
        );

        let no_app_created = service
            .create_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-no-app-create",
                    CreateMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_no_app".to_string(),
                        account_id: "account_1".to_string(),
                        agent_id: "agent_2".to_string(),
                        expected_user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        expected_tenant_id: "tenant_1".to_string(),
                        requested_app_name: "岩兰".to_string(),
                        provisioning_mode: "developer_session".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(no_app_created.result.status, CommandResultStatus::Applied);
        for (expected_version, state) in
            [(1, "session_verified"), (2, "failed_unknown_remote_state")]
        {
            let advanced = service
                .advance_member_bot_publication_intent(
                    &mut database,
                    &host_envelope(
                        &format!("publication-no-app-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: "intent_no_app".to_string(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: None,
                            credential_ref: None,
                            last_completed_step: (state == "session_verified")
                                .then(|| state.to_string()),
                            failure_code: (state == "failed_unknown_remote_state")
                                .then(|| "feishu_console_create_outcome_unknown".to_string()),
                        },
                    ),
                )
                .unwrap();
            assert_eq!(advanced.result.status, CommandResultStatus::Applied);
        }
        let unsafe_reclassification = service
            .advance_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "publication-no-app-recoverable",
                    AdvanceMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent_no_app".to_string(),
                        expected_version: 3,
                        state: "failed_recoverable".to_string(),
                        remote_app_id: None,
                        credential_ref: None,
                        last_completed_step: Some("session_verified".to_string()),
                        failure_code: Some("retry_requested".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            unsafe_reclassification.result.code,
            "feishu_publication_intent.reconciliation_remote_app_required"
        );
    }

    #[test]
    fn member_bot_app_binding_is_immutable_across_legacy_disabled_reactivation() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");

        let duplicate_intent = service
            .create_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "duplicate-completed-publication",
                    CreateMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent-replacement".to_string(),
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        expected_user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        expected_tenant_id: "tenant_1".to_string(),
                        requested_app_name: "木瓦".to_string(),
                        provisioning_mode: "developer_session".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            duplicate_intent.result.status,
            CommandResultStatus::Rejected
        );
        assert_eq!(
            duplicate_intent.result.code,
            "feishu_member_bot.already_bound"
        );

        let replacement = service
            .upsert_feishu_member_bot(
                &mut database,
                &host_envelope(
                    "replace-bound-app",
                    UpsertFeishuMemberBotCommand {
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        app_id: "cli_app_2".to_string(),
                        bot_open_id: Some("ou_replacement".to_string()),
                        bot_display_name: "木瓦".to_string(),
                        credential_ref: "feishu/member/agent_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(replacement.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            replacement.result.code,
            "feishu_member_bot.binding_immutable"
        );

        database
            .connection()
            .execute(
                "UPDATE feishu_member_bot SET status = 'disabled' WHERE agent_id = 'agent_1'",
                [],
            )
            .unwrap();
        let reopened = service
            .advance_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "reopen-bound-app",
                    AdvanceMemberBotPublicationIntentCommand {
                        publication_intent_id: "intent-agent_1".to_string(),
                        expected_version: 8,
                        state: "session_verified".to_string(),
                        remote_app_id: Some("cli_app_1".to_string()),
                        credential_ref: Some("feishu/member/agent_1".to_string()),
                        last_completed_step: Some("session_verified".to_string()),
                        failure_code: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(reopened.result.status, CommandResultStatus::Applied);

        let premature_reactivation = service
            .upsert_feishu_member_bot(
                &mut database,
                &host_envelope(
                    "premature-reactivation",
                    UpsertFeishuMemberBotCommand {
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        app_id: "cli_app_1".to_string(),
                        bot_open_id: Some("ou_bot_agent_1".to_string()),
                        bot_display_name: "木瓦".to_string(),
                        credential_ref: "feishu/member/agent_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            premature_reactivation.result.status,
            CommandResultStatus::Rejected
        );
        assert_eq!(
            premature_reactivation.result.code,
            "feishu_member_bot.publication_state_required"
        );

        for (expected_version, state) in [
            (9, "app_created"),
            (10, "credentials_read"),
            (11, "bot_configured"),
            (12, "version_published"),
        ] {
            service
                .advance_member_bot_publication_intent(
                    &mut database,
                    &host_envelope(
                        &format!("reactivate-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: "intent-agent_1".to_string(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: Some("cli_app_1".to_string()),
                            credential_ref: Some("feishu/member/agent_1".to_string()),
                            last_completed_step: Some(state.to_string()),
                            failure_code: None,
                        },
                    ),
                )
                .unwrap();
        }
        let reactivated = service
            .upsert_feishu_member_bot(
                &mut database,
                &host_envelope(
                    "reactivate-bound-app",
                    UpsertFeishuMemberBotCommand {
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        app_id: "cli_app_1".to_string(),
                        bot_open_id: Some("ou_bot_agent_1".to_string()),
                        bot_display_name: "木瓦".to_string(),
                        credential_ref: "feishu/member/agent_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(reactivated.result.status, CommandResultStatus::Applied);
        for (expected_version, state) in [(13, "connection_verified"), (14, "completed")] {
            service
                .advance_member_bot_publication_intent(
                    &mut database,
                    &host_envelope(
                        &format!("reactivate-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: "intent-agent_1".to_string(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: Some("cli_app_1".to_string()),
                            credential_ref: Some("feishu/member/agent_1".to_string()),
                            last_completed_step: Some(state.to_string()),
                            failure_code: None,
                        },
                    ),
                )
                .unwrap();
        }
        let binding: (String, String) = database
            .connection()
            .query_row(
                "SELECT app_id, status FROM feishu_member_bot WHERE agent_id = 'agent_1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(binding, ("cli_app_1".to_string(), "published".to_string()));
        let snapshot = service.snapshot(&database).unwrap();
        assert_eq!(snapshot.member_bots[0].brand, "feishu");
        assert_eq!(snapshot.publication_intents[0].state, "completed");
    }

    #[test]
    fn first_observation_only_collects_and_unbound_finalize_creates_no_execution() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        service
            .upsert_feishu_account(
                &mut database,
                &host_envelope(
                    "account",
                    UpsertFeishuAccountCommand {
                        account_id: "account_1".to_string(),
                        user_id_digest: format!("sha256:{}", "a".repeat(64)),
                        tenant_id: "tenant_1".to_string(),
                        user_name: "主人".to_string(),
                        email: Some("owner@example.com".to_string()),
                        tenant_name: "测试租户".to_string(),
                        brand: "feishu".to_string(),
                    },
                ),
            )
            .unwrap();
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-1",
                    ObserveChannelInboundCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        app_id: "cli_app_1".to_string(),
                        external_message_id: "om_1".to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_1".to_string(),
                        topic_key: String::new(),
                        conversation_kind: "p2p".to_string(),
                        conversation_display_name: "小明".to_string(),
                        sender_external_user_id: "ou_user".to_string(),
                        sender_open_id: Some("ou_user".to_string()),
                        sender_user_id: None,
                        sender_union_id: None,
                        sender_display_name: "小明".to_string(),
                        body: "帮我检查".to_string(),
                        attachment_summaries: Vec::new(),
                        quote: None,
                        canonical_agent_ids: vec!["agent_1".to_string()],
                        canonical_mentions_complete: true,
                        expected_app_ids: vec!["cli_app_1".to_string()],
                        acknowledgement_app_id: "cli_app_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(observation.result.code, "channel.inbound.collecting");
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let aggregate_id = observation.result.payload["aggregateId"]
            .as_str()
            .unwrap()
            .to_string();
        let finalized = service
            .finalize_inbound(
                &mut database,
                &host_envelope("finalize-1", FinalizeChannelInboundCommand { aggregate_id }),
            )
            .unwrap();
        assert_eq!(finalized.result.code, "channel.inbound.unbound");
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM external_principal", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0,
            "an unbound transport observation must not create a Principal"
        );
        for table in ["camp_message", "camp_turn", "agent_run"] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must stay empty");
        }
    }

    #[test]
    fn observation_requires_the_receiving_app_in_the_expected_bot_set() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");

        let error = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-from-unexpected-app",
                    observation_command(
                        "cli_app_1",
                        "om_unexpected_app",
                        "oc_group",
                        "",
                        "group",
                        "检查一下",
                        &[("agent_2", "cli_app_2")],
                        true,
                    ),
                ),
            )
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("observing appId must be one of expectedAppIds")
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM channel_inbound_aggregate",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn binding_never_replays_the_old_message_and_resend_uses_atomic_admission() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");

        let old_observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-before-binding",
                    observation_command(
                        "cli_app_1",
                        "om_before_binding",
                        "oc_private_1",
                        "",
                        "p2p",
                        "旧消息不能补跑",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let snapshot = service.snapshot(&database).unwrap();
        let unbound = snapshot.unbound_conversations.first().unwrap();
        let project_binding_id = create_binding(
            &service,
            &mut database,
            &unbound.channel_conversation_id,
            unbound.version,
        );
        let old_finalized = service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "finalize-before-binding",
                    FinalizeChannelInboundCommand {
                        aggregate_id: old_observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(old_finalized.result.code, "channel.inbound.unbound");
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );

        let resend = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-after-binding",
                    observation_command(
                        "cli_app_1",
                        "om_after_binding",
                        "oc_private_1",
                        "",
                        "p2p",
                        "重新发送后执行",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let admitted = service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "finalize-after-binding",
                    FinalizeChannelInboundCommand {
                        aggregate_id: resend.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(admitted.result.code, "channel.turn.admitted");
        for table in ["camp_message", "camp_turn", "agent_run"] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "{table} should be atomically admitted once");
        }
        let (author_type, reply_to, camp_path, binding_path): (
            String,
            Option<String>,
            String,
            String,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT message.author_type, message.reply_to_camp_message_id,
                       camp.project_path, binding.canonical_path
                FROM camp_message AS message
                JOIN camp ON camp.id = message.camp_id
                JOIN project_binding AS binding ON binding.id = ?1
                WHERE message.author_type = 'external_principal'
                "#,
                [&project_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(author_type, "external_principal");
        assert_eq!(reply_to, None);
        assert_eq!(camp_path, binding_path, "Camp must freeze the Core path");

        let second = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-while-active",
                    observation_command(
                        "cli_app_1",
                        "om_while_active",
                        "oc_private_1",
                        "",
                        "p2p",
                        "第二轮先排队",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let queued = service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "finalize-while-active",
                    FinalizeChannelInboundCommand {
                        aggregate_id: second.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(queued.result.code, "channel.turn.queued");
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1,
            "queued channel input must stay outside Camp conversation"
        );
    }

    #[test]
    fn multi_bot_aggregation_is_complete_or_fails_closed() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");
        let targets = [("agent_1", "cli_app_1"), ("agent_2", "cli_app_2")];

        let first = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "aggregate-first",
                    observation_command(
                        "cli_app_1",
                        "om_multi",
                        "oc_multi",
                        "",
                        "group",
                        "一起检查",
                        &targets,
                        false,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(first.result.payload["readyToFinalize"], false);
        let second = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "aggregate-second",
                    observation_command(
                        "cli_app_2",
                        "om_multi",
                        "oc_multi",
                        "",
                        "group",
                        "一起检查",
                        &targets,
                        false,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(second.result.payload["readyToFinalize"], true);
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM channel_turn_request", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0,
            "observations alone must never cross admission"
        );

        service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "mismatch-first",
                    observation_command(
                        "cli_app_1",
                        "om_mismatch",
                        "oc_multi",
                        "",
                        "group",
                        "版本 A",
                        &targets,
                        false,
                    ),
                ),
            )
            .unwrap();
        let mismatch = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "mismatch-second",
                    observation_command(
                        "cli_app_2",
                        "om_mismatch",
                        "oc_multi",
                        "",
                        "group",
                        "版本 B",
                        &targets,
                        false,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(
            mismatch.result.payload["failureCode"],
            "observation_mismatch"
        );

        let timeout = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "timeout-first",
                    observation_command(
                        "cli_app_1",
                        "om_timeout",
                        "oc_multi",
                        "",
                        "group",
                        "只到一份",
                        &targets,
                        false,
                    ),
                ),
            )
            .unwrap();
        let timeout_id = timeout.result.payload["aggregateId"].as_str().unwrap();
        database
            .connection()
            .execute(
                "UPDATE channel_inbound_aggregate SET deadline_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
                [timeout_id],
            )
            .unwrap();
        let finalized = service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "timeout-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: timeout_id.to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            finalized.result.payload["failureCode"],
            "aggregation_timeout"
        );
    }

    #[test]
    fn group_roster_seeds_members_and_removal_reuses_membership_reconciliation() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");

        let discovery = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "group-discovery",
                    observation_command(
                        "cli_app_1",
                        "om_group_discovery",
                        "oc_group",
                        "",
                        "group",
                        "发现群聊",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "group-discovery-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: discovery.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        let unbound = service
            .snapshot(&database)
            .unwrap()
            .unbound_conversations
            .into_iter()
            .find(|conversation| conversation.conversation_kind == "group")
            .unwrap();
        create_binding(
            &service,
            &mut database,
            &unbound.channel_conversation_id,
            unbound.version,
        );
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "roster-both",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_group".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string(), "cli_app_2".to_string()],
                    },
                ),
            )
            .unwrap();
        let trigger = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "group-trigger",
                    observation_command(
                        "cli_app_1",
                        "om_group_trigger",
                        "oc_group",
                        "",
                        "group",
                        "只点名一号",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let admitted = service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "group-trigger-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: trigger.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(admitted.result.code, "channel.turn.admitted");
        let camp_id = admitted.result.payload["campId"].as_str().unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_member WHERE camp_id = ?1 AND status = 'active'",
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2,
            "normal group Camp starts from the full present Bot roster"
        );
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "roster-agent-two-left",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_group".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string()],
                    },
                ),
            )
            .unwrap();
        let (status, source_generation): (String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT member.status, source.last_reconciliation_generation
                FROM camp_member AS member
                JOIN camp_membership_source_binding AS source ON source.camp_id = member.camp_id
                WHERE member.camp_id = ?1 AND member.agent_id = 'agent_2'
                "#,
                [camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "left");
        assert_eq!(source_generation, 1);
    }

    #[test]
    fn topic_membership_is_added_on_a2a_need_not_on_parent_roster_sync() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");
        let discovery = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "topic-discovery",
                    observation_command(
                        "cli_app_1",
                        "om_topic_discovery",
                        "oc_topic_group",
                        "omt_root",
                        "topic",
                        "发现话题",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "topic-discovery-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: discovery.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        let unbound = service
            .snapshot(&database)
            .unwrap()
            .unbound_conversations
            .into_iter()
            .find(|conversation| conversation.conversation_kind == "topic")
            .unwrap();
        create_binding(
            &service,
            &mut database,
            &unbound.channel_conversation_id,
            unbound.version,
        );
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "topic-roster",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_topic_group".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string(), "cli_app_2".to_string()],
                    },
                ),
            )
            .unwrap();
        let trigger = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "topic-trigger",
                    observation_command(
                        "cli_app_1",
                        "om_topic_trigger",
                        "oc_topic_group",
                        "omt_root",
                        "topic",
                        "只点名一号",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let admitted = service
            .finalize_inbound(
                &mut database,
                &host_envelope(
                    "topic-trigger-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: trigger.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        let camp_id = admitted.result.payload["campId"].as_str().unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_member WHERE camp_id = ?1 AND status = 'active'",
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1,
            "parent roster sync must not pollute historical topic Camps"
        );
        service
            .ensure_topic_a2a_members(
                &mut database,
                camp_id,
                &["agent_2".to_string()],
                "topic-a2a",
            )
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_member WHERE camp_id = ?1 AND status = 'active'",
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2,
            "the first A2A need should reuse camp.member.add"
        );
    }

    #[test]
    fn external_quote_stays_structured_and_never_sets_internal_reply() {
        let content = build_external_content(
            &ObserveChannelInboundCommand {
                provider: FEISHU_PROVIDER.to_string(),
                app_id: "cli_app_1".to_string(),
                external_message_id: "om_1".to_string(),
                tenant_key: "tenant_1".to_string(),
                chat_id: "oc_1".to_string(),
                topic_key: String::new(),
                conversation_kind: "p2p".to_string(),
                conversation_display_name: "小明".to_string(),
                sender_external_user_id: "ou_user".to_string(),
                sender_open_id: Some("ou_user".to_string()),
                sender_user_id: None,
                sender_union_id: None,
                sender_display_name: "小明".to_string(),
                body: "继续".to_string(),
                attachment_summaries: Vec::new(),
                quote: Some(ExternalQuoteInput {
                    sender_display_name: "小红".to_string(),
                    body: "原始问题".to_string(),
                    attachment_summaries: vec![ChannelAttachmentSummaryInput {
                        name: "说明.pdf".to_string(),
                        media_type: Some("application/pdf".to_string()),
                    }],
                }),
                canonical_agent_ids: vec!["agent_1".to_string()],
                canonical_mentions_complete: true,
                expected_app_ids: vec!["cli_app_1".to_string()],
                acknowledgement_app_id: "cli_app_1".to_string(),
            },
            &["agent_1".to_string()],
        )
        .unwrap();
        assert!(matches!(
            content.first(),
            Some(StructuredCampMessageSegment::ExternalQuote { body, .. }) if body == "原始问题"
        ));
        assert!(matches!(
            content.get(1),
            Some(StructuredCampMessageSegment::Text { text }) if text == "\n\n"
        ));
        assert!(matches!(
            content.get(2),
            Some(StructuredCampMessageSegment::MemberMention { agent_id }) if agent_id == "agent_1"
        ));
        let serialized = serde_json::to_value(&content).unwrap();
        assert!(!serialized.to_string().contains("externalMessageId"));

        let mut tampered = content.clone();
        let Some(StructuredCampMessageSegment::ExternalQuote { content_digest, .. }) =
            tampered.first_mut()
        else {
            panic!("the first segment must remain the external quote");
        };
        *content_digest = format!("sha256:{}", "0".repeat(64));
        assert!(validate_content(&tampered).is_err());
    }
}
