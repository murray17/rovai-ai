use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    camp_content::{
        ExternalQuoteAttachmentSummary, StructuredCampMessageContent, StructuredCampMessageSegment,
        canonical_content_digest, mentions_current_user, normalize_content, validate_content,
    },
    camp_id::CampId,
    collaboration::{
        AddCampMemberCommand, CampMembershipMutationSource, CollaborationService,
        ExternalChannelAdmissionInput, RemoveCampMemberCommand, append_domain_event,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, CommandResultStatus,
        DomainCommand, DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    current_user::CURRENT_USER_ID,
    db::Database,
    read_model::{AgentRunExecutionEvidenceView, public_execution_evidence_for_agent_run},
};

const FEISHU_PROVIDER: &str = "feishu";
const DINGTALK_PROVIDER: &str = "dingtalk";
const FEISHU_CHANNEL_HOST_COMPONENT: &str = "feishu-channel-host";
const DINGTALK_CHANNEL_HOST_COMPONENT: &str = "dingtalk-channel-host";
const CHANNEL_MEMBERSHIP_SYNC_COMPONENT: &str = "channel-membership-sync";
const AGGREGATION_WINDOW_SECONDS: i64 = 3;
const DELIVERY_LEASE_SECONDS: i64 = 30;
const EXECUTION_CONSOLE_TERMINAL_QUIET_WINDOW_MILLISECONDS: i64 = 900;
const CHANNEL_TRANSPORT_RETENTION_DAYS: i64 = 7;
const MAX_DELIVERY_ATTEMPTS: i64 = 5;
const PENDING_BINDING_LIFETIME_HOURS: i64 = 24;
const PROJECT_SELECTION_CARD_REVISION: i64 = 3;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDingTalkAccountCommand {
    pub account_id: String,
    pub user_id_digest: String,
    pub corp_id: String,
    pub user_name: String,
    pub corp_name: String,
    pub oauth_profile_ref: String,
}

impl sealed::Sealed for UpsertDingTalkAccountCommand {}
impl DomainCommand for UpsertDingTalkAccountCommand {
    const TYPE: &'static str = "dingtalk_account.upsert";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectDingTalkAccountCommand {
    pub account_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for DisconnectDingTalkAccountCommand {}
impl DomainCommand for DisconnectDingTalkAccountCommand {
    const TYPE: &'static str = "dingtalk_account.disconnect";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpireDingTalkAccountCommand {
    pub account_id: String,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeishuConnectionAccountInput {
    pub account_id: String,
    pub user_id_digest: String,
    pub tenant_id: String,
    pub user_name: String,
    pub email: Option<String>,
    pub tenant_name: String,
    pub brand: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DingTalkConnectionAccountInput {
    pub account_id: String,
    pub user_id_digest: String,
    pub corp_id: String,
    pub user_name: String,
    pub corp_name: String,
    pub oauth_profile_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelDeveloperSessionInput {
    pub identity: Value,
    pub session: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitFeishuAccountConnectionCommand {
    pub expected_previous_account_version: Option<i64>,
    pub account: FeishuConnectionAccountInput,
    pub developer_session: ChannelDeveloperSessionInput,
}

impl sealed::Sealed for CommitFeishuAccountConnectionCommand {}
impl DomainCommand for CommitFeishuAccountConnectionCommand {
    const TYPE: &'static str = "feishu_account.commit_connection";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitDingTalkAccountConnectionCommand {
    pub expected_previous_account_version: Option<i64>,
    pub account: DingTalkConnectionAccountInput,
    pub developer_session: ChannelDeveloperSessionInput,
}

impl sealed::Sealed for CommitDingTalkAccountConnectionCommand {}
impl DomainCommand for CommitDingTalkAccountConnectionCommand {
    const TYPE: &'static str = "dingtalk_account.commit_connection";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceChannelDeveloperSessionCommand {
    pub provider: String,
    pub account_id: String,
    pub identity: Value,
    pub session: Value,
    pub expected_revision: Option<i64>,
}

impl sealed::Sealed for ReplaceChannelDeveloperSessionCommand {}
impl DomainCommand for ReplaceChannelDeveloperSessionCommand {
    const TYPE: &'static str = "channel_developer_session.replace";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteChannelDeveloperSessionCommand {
    pub provider: String,
}

impl sealed::Sealed for DeleteChannelDeveloperSessionCommand {}
impl DomainCommand for DeleteChannelDeveloperSessionCommand {
    const TYPE: &'static str = "channel_developer_session.delete";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorePublicationCredentialCommand {
    pub provider: String,
    pub publication_intent_id: String,
    pub expected_intent_version: i64,
    pub credential_ref: String,
    pub remote_app_id: String,
    pub credential: Value,
}

impl sealed::Sealed for StorePublicationCredentialCommand {}
impl DomainCommand for StorePublicationCredentialCommand {
    const TYPE: &'static str = "channel_publication_intent.store_credential";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteChannelCredentialCommand {
    pub provider: String,
    pub credential_ref: String,
}

impl sealed::Sealed for DeleteChannelCredentialCommand {}
impl DomainCommand for DeleteChannelCredentialCommand {
    const TYPE: &'static str = "channel_credential.delete";
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetChannelCredentialParams {
    pub credential_ref: String,
    pub provider: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetChannelDeveloperSessionParams {
    pub provider: String,
}

impl sealed::Sealed for ExpireDingTalkAccountCommand {}
impl DomainCommand for ExpireDingTalkAccountCommand {
    const TYPE: &'static str = "dingtalk_account.expire";
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDingTalkPublicationIntentCommand {
    pub publication_intent_id: String,
    pub account_id: String,
    pub agent_id: String,
    pub expected_user_id_digest: String,
    pub expected_corp_id: String,
    pub requested_app_name: String,
    pub provisioning_mode: String,
}

impl sealed::Sealed for CreateDingTalkPublicationIntentCommand {}
impl DomainCommand for CreateDingTalkPublicationIntentCommand {
    const TYPE: &'static str = "dingtalk_member_bot_publication_intent.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceDingTalkPublicationIntentCommand {
    pub publication_intent_id: String,
    pub expected_version: i64,
    pub state: String,
    pub remote_unified_app_id: Option<String>,
    pub app_key: Option<String>,
    pub robot_code: Option<String>,
    pub credential_ref: Option<String>,
    pub version_id: Option<String>,
    pub approval_mode: Option<String>,
    pub approver_user_id_digest: Option<String>,
    pub last_completed_step: Option<String>,
    pub failure_code: Option<String>,
}

impl sealed::Sealed for AdvanceDingTalkPublicationIntentCommand {}
impl DomainCommand for AdvanceDingTalkPublicationIntentCommand {
    const TYPE: &'static str = "dingtalk_member_bot_publication_intent.advance";
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
    pub owner_open_id: String,
    pub bot_open_id: Option<String>,
    pub bot_display_name: String,
    pub credential_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDingTalkMemberBotCommand {
    pub account_id: String,
    pub agent_id: String,
    pub unified_app_id: String,
    pub app_key: String,
    pub robot_code: String,
    pub owner_user_id: String,
    pub bot_display_name: String,
    pub credential_ref: String,
}

impl sealed::Sealed for UpsertDingTalkMemberBotCommand {}
impl DomainCommand for UpsertDingTalkMemberBotCommand {
    const TYPE: &'static str = "dingtalk_member_bot.upsert";
}

impl sealed::Sealed for UpsertFeishuMemberBotCommand {}
impl DomainCommand for UpsertFeishuMemberBotCommand {
    const TYPE: &'static str = "feishu_member_bot.upsert";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyFeishuOwnerCommand {
    pub provider: String,
    pub app_id: String,
    pub tenant_key: String,
    pub sender_open_id: Option<String>,
    pub sender_user_id: Option<String>,
    pub sender_union_id: Option<String>,
    pub sender_display_name: String,
}

impl sealed::Sealed for VerifyFeishuOwnerCommand {}
impl DomainCommand for VerifyFeishuOwnerCommand {
    const TYPE: &'static str = "feishu_owner.verify";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNewFeishuDmCommand {
    pub provider: String,
    pub app_id: String,
    pub tenant_key: String,
    pub chat_id: String,
    pub conversation_display_name: String,
    pub target_agent_id: String,
}

impl sealed::Sealed for StartNewFeishuDmCommand {}
impl DomainCommand for StartNewFeishuDmCommand {
    const TYPE: &'static str = "channel_dm.start_new";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePendingCampBindingCommand {
    pub pending_binding_id: String,
    pub app_id: String,
    pub external_picker_message_id: String,
    pub expected_version: i64,
    pub nonce: String,
    pub action: String,
    pub project_id: Option<String>,
    pub operator_open_id: Option<String>,
    pub operator_user_id: Option<String>,
    pub operator_union_id: Option<String>,
}

impl sealed::Sealed for ResolvePendingCampBindingCommand {}
impl DomainCommand for ResolvePendingCampBindingCommand {
    const TYPE: &'static str = "pending_camp_binding.resolve";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizeChannelExecutionConsolePageCommand {
    pub agent_run_id: String,
    pub app_id: String,
    pub external_message_id: String,
    pub snapshot_sequence: i64,
    pub page_index: i64,
    pub page_count: i64,
    pub operator_open_id: Option<String>,
    pub operator_user_id: Option<String>,
    pub operator_union_id: Option<String>,
}

impl sealed::Sealed for AuthorizeChannelExecutionConsolePageCommand {}
impl DomainCommand for AuthorizeChannelExecutionConsolePageCommand {
    const TYPE: &'static str = "channel_execution_console.page.authorize";
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
    pub owner_identity_status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuChannelSnapshot {
    pub schema_version: i64,
    pub account: Option<FeishuAccountView>,
    pub member_bots: Vec<FeishuMemberBotView>,
    pub publication_intents: Vec<MemberBotPublicationIntentView>,
    pub pending_binding_count: i64,
    pub binding_issue_count: i64,
    /// Host-only routing facts. Desktop strips these before exposing settings
    /// state to the Renderer.
    pub transport_conversations: Vec<ChannelTransportConversationView>,
    pub pending_aggregates: Vec<PendingChannelAggregateView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkAccountView {
    pub account_id: String,
    pub user_id_digest: String,
    pub corp_id: String,
    pub user_name: String,
    pub corp_name: String,
    pub oauth_profile_ref: String,
    pub status: String,
    pub version: i64,
    pub connected_at: String,
    pub last_verified_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkMemberBotView {
    pub agent_id: String,
    pub account_id: String,
    pub unified_app_id: String,
    pub app_key: String,
    pub robot_code: String,
    pub bot_display_name: String,
    pub credential_ref: String,
    pub status: String,
    pub failure_code: Option<String>,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkPublicationIntentView {
    pub publication_intent_id: String,
    pub agent_id: String,
    pub account_id: String,
    pub expected_user_id_digest: String,
    pub expected_corp_id: String,
    pub requested_app_name: String,
    pub provisioning_mode: String,
    pub state: String,
    pub remote_unified_app_id: Option<String>,
    pub app_key: Option<String>,
    pub robot_code: Option<String>,
    pub credential_ref: Option<String>,
    pub version_id: Option<String>,
    pub approval_mode: Option<String>,
    pub last_completed_step: Option<String>,
    pub failure_code: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkChannelSnapshot {
    pub schema_version: i64,
    pub account: Option<DingTalkAccountView>,
    pub member_bots: Vec<DingTalkMemberBotView>,
    pub publication_intents: Vec<DingTalkPublicationIntentView>,
    pub pending_binding_count: i64,
    pub binding_issue_count: i64,
    pub transport_conversations: Vec<ChannelTransportConversationView>,
    pub pending_aggregates: Vec<PendingChannelAggregateView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCredentialView {
    pub credential_ref: String,
    pub provider: String,
    pub remote_app_id: String,
    pub payload: Value,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedChannelCredentialView {
    pub agent_id: String,
    pub credential_ref: String,
    pub provider: String,
    pub remote_app_id: String,
    pub payload: Value,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDeveloperSessionView {
    pub provider: String,
    pub account_id: String,
    pub identity: Value,
    pub session: Value,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedChannelDelivery {
    pub delivery_id: String,
    pub provider: String,
    pub request_id: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelExecutionConsoleRunView {
    pub status: String,
    pub wait_reason: Option<String>,
    pub terminal_reason_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelExecutionConsoleSourceView {
    pub sequence: i64,
    pub agent_run_id: String,
    pub agent_display_name: String,
    pub run: ChannelExecutionConsoleRunView,
    pub evidence: Vec<AgentRunExecutionEvidenceView>,
    pub public_output: Option<String>,
    pub started_at: Option<String>,
    pub terminal_at: Option<String>,
    pub target_app_id: String,
    pub external_message_id: Option<String>,
    pub state: String,
}

#[derive(Debug, Default)]
pub struct ChannelService {
    gateway: DomainCommandGateway,
}

impl ChannelService {
    pub fn execution_console_source(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        expected_sequence: i64,
    ) -> Result<Option<ChannelExecutionConsoleSourceView>> {
        validate_nonempty(agent_run_id, "agentRunId")?;
        if expected_sequence < 1 {
            anyhow::bail!("expectedSequence must be positive");
        }
        let transaction = database.connection_mut().transaction()?;
        let source = transaction
            .query_row(
                r#"
                SELECT console.latest_sequence, run.id, profile.display_name,
                       run.status, run.wait_reason, run.terminal_reason_code,
                       run.started_at, run.ended_at,
                       console.target_app_id, console.external_message_id,
                       console.state
                FROM channel_execution_console AS console
                JOIN agent_run AS run ON run.id = console.agent_run_id
                JOIN agent_profile AS profile ON profile.id = console.agent_id
                WHERE console.agent_run_id = ?1
                  AND console.latest_sequence = ?2
                  AND console.state IN ('opening', 'active', 'terminal_sealed')
                "#,
                params![agent_run_id, expected_sequence],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, String>(10)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            sequence,
            agent_run_id,
            agent_display_name,
            status,
            wait_reason,
            terminal_reason_code,
            started_at,
            terminal_at,
            target_app_id,
            external_message_id,
            state,
        )) = source
        else {
            transaction.commit()?;
            return Ok(None);
        };
        let evidence = public_execution_evidence_for_agent_run(&transaction, &agent_run_id)?;
        let public_output = transaction
            .query_row(
                r#"
                SELECT body FROM camp_message
                WHERE source_agent_run_id = ?1
                  AND author_type = 'agent' AND tombstoned_at IS NULL
                ORDER BY sequence DESC, id DESC
                LIMIT 1
                "#,
                [&agent_run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        transaction.commit()?;
        Ok(Some(ChannelExecutionConsoleSourceView {
            sequence,
            agent_run_id,
            agent_display_name,
            run: ChannelExecutionConsoleRunView {
                status,
                wait_reason,
                terminal_reason_code,
            },
            evidence,
            public_output,
            started_at,
            terminal_at,
            target_app_id,
            external_message_id,
            state,
        }))
    }

    /// Reconciles a Feishu Topic Camp with the latest accepted parent-group
    /// Bot roster before an internal A2A/Gather admission, then fail-closes
    /// every explicitly requested target that is no longer present.
    /// Normal Camps and normal Feishu groups are left untouched.
    pub fn ensure_topic_roster_members(
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
        let Some((_binding_id, tenant_key, chat_id)) = topic_binding else {
            return Ok(());
        };
        reconcile_bound_group_memberships(
            database,
            FEISHU_PROVIDER,
            &tenant_key,
            &chat_id,
            parent_command_id,
        )?;
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
            if !roster_present {
                anyhow::bail!(
                    "channel.topic_bot_not_in_roster: requested Agent {agent_id} is not in the current Feishu parent-group Bot roster"
                );
            }
            if !active {
                anyhow::bail!(
                    "channel.topic_membership_sync_failed: requested Agent {agent_id} is not an active Topic Camp collaborator after roster reconciliation"
                );
            }
        }
        Ok(())
    }

    pub fn snapshot(&self, database: &mut Database) -> Result<FeishuChannelSnapshot> {
        refresh_project_catalog(database)?;
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
                   bot.status, bot.failure_code, bot.version,
                   EXISTS(
                       SELECT 1 FROM feishu_owner_app_identity AS identity
                       WHERE identity.account_id = bot.account_id
                         AND identity.app_id = bot.app_id
                   )
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
                    owner_identity_status: if row.get::<_, bool>(9)? {
                        "verified".to_string()
                    } else {
                        "unverified".to_string()
                    },
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
            WHERE conversation.provider = 'feishu'
              AND conversation.conversation_kind IN ('group', 'topic')
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
              AND conversation.provider = 'feishu'
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
        let pending_binding_count = connection.query_row(
            r#"
            SELECT COUNT(*)
            FROM pending_camp_binding AS pending
            JOIN channel_conversation AS conversation
              ON conversation.id = pending.channel_conversation_id
            WHERE pending.status IN ('pending', 'resolving')
              AND conversation.provider = 'feishu'
            "#,
            [],
            |row| row.get(0),
        )?;
        let binding_issue_count = connection.query_row(
            r#"
            SELECT COUNT(*)
            FROM channel_conversation_binding AS binding
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            LEFT JOIN project_catalog_item AS project ON project.id = binding.project_id
            WHERE binding.status = 'active'
              AND conversation.provider = 'feishu'
              AND binding.execution_scope_kind = 'project'
              AND (project.id IS NULL OR project.status <> 'active')
            "#,
            [],
            |row| row.get(0),
        )?;
        Ok(FeishuChannelSnapshot {
            schema_version: 2,
            account,
            member_bots,
            publication_intents,
            pending_binding_count,
            binding_issue_count,
            transport_conversations,
            pending_aggregates,
        })
    }

    pub fn dingtalk_snapshot(&self, database: &mut Database) -> Result<DingTalkChannelSnapshot> {
        refresh_project_catalog(database)?;
        let connection = database.connection();
        let account = connection
            .query_row(
                r#"
                SELECT id, user_id_digest, corp_id, user_name, corp_name,
                       oauth_profile_ref, status, version,
                       connected_at, last_verified_at
                FROM dingtalk_account
                ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END,
                         updated_at DESC, id
                LIMIT 1
                "#,
                [],
                |row| {
                    Ok(DingTalkAccountView {
                        account_id: row.get(0)?,
                        user_id_digest: row.get(1)?,
                        corp_id: row.get(2)?,
                        user_name: row.get(3)?,
                        corp_name: row.get(4)?,
                        oauth_profile_ref: row.get(5)?,
                        status: row.get(6)?,
                        version: row.get(7)?,
                        connected_at: row.get(8)?,
                        last_verified_at: row.get(9)?,
                    })
                },
            )
            .optional()?;
        let member_bots = query_rows(
            connection,
            r#"
            SELECT agent_id, account_id, unified_app_id, app_key, robot_code,
                   bot_display_name, credential_ref, status, failure_code, version
            FROM dingtalk_member_bot
            ORDER BY agent_id
            "#,
            [],
            |row| {
                Ok(DingTalkMemberBotView {
                    agent_id: row.get(0)?,
                    account_id: row.get(1)?,
                    unified_app_id: row.get(2)?,
                    app_key: row.get(3)?,
                    robot_code: row.get(4)?,
                    bot_display_name: row.get(5)?,
                    credential_ref: row.get(6)?,
                    status: row.get(7)?,
                    failure_code: row.get(8)?,
                    version: row.get(9)?,
                })
            },
        )?;
        let publication_intents = query_rows(
            connection,
            r#"
            SELECT id, agent_id, account_id, expected_user_id_digest,
                   expected_corp_id, requested_app_name, provisioning_mode,
                   state, remote_unified_app_id, app_key, robot_code,
                   credential_ref, version_id, approval_mode,
                   last_completed_step, failure_code, version, created_at, updated_at
            FROM dingtalk_member_bot_publication_intent
            ORDER BY created_at DESC, id
            "#,
            [],
            |row| {
                Ok(DingTalkPublicationIntentView {
                    publication_intent_id: row.get(0)?,
                    agent_id: row.get(1)?,
                    account_id: row.get(2)?,
                    expected_user_id_digest: row.get(3)?,
                    expected_corp_id: row.get(4)?,
                    requested_app_name: row.get(5)?,
                    provisioning_mode: row.get(6)?,
                    state: row.get(7)?,
                    remote_unified_app_id: row.get(8)?,
                    app_key: row.get(9)?,
                    robot_code: row.get(10)?,
                    credential_ref: row.get(11)?,
                    version_id: row.get(12)?,
                    approval_mode: row.get(13)?,
                    last_completed_step: row.get(14)?,
                    failure_code: row.get(15)?,
                    version: row.get(16)?,
                    created_at: row.get(17)?,
                    updated_at: row.get(18)?,
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
            WHERE conversation.provider = 'dingtalk'
              AND conversation.conversation_kind IN ('group', 'topic')
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
              AND conversation.provider = 'dingtalk'
              AND aggregate.canonical_mentions_complete = 1
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
        let pending_binding_count = connection.query_row(
            r#"
            SELECT COUNT(*)
            FROM pending_camp_binding AS pending
            JOIN channel_conversation AS conversation
              ON conversation.id = pending.channel_conversation_id
            WHERE pending.status IN ('pending', 'resolving')
              AND conversation.provider = 'dingtalk'
            "#,
            [],
            |row| row.get(0),
        )?;
        let binding_issue_count = connection.query_row(
            r#"
            SELECT COUNT(*)
            FROM channel_conversation_binding AS binding
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            LEFT JOIN project_catalog_item AS project ON project.id = binding.project_id
            WHERE binding.status = 'active'
              AND conversation.provider = 'dingtalk'
              AND binding.execution_scope_kind = 'project'
              AND (project.id IS NULL OR project.status <> 'active')
            "#,
            [],
            |row| row.get(0),
        )?;
        Ok(DingTalkChannelSnapshot {
            schema_version: 1,
            account,
            member_bots,
            publication_intents,
            pending_binding_count,
            binding_issue_count,
            transport_conversations,
            pending_aggregates,
        })
    }

    pub fn channel_credential(
        &self,
        database: &mut Database,
        params: &GetChannelCredentialParams,
    ) -> Result<Option<ChannelCredentialView>> {
        validate_provider(&params.provider)?;
        validate_credential_ref(&params.credential_ref, &params.provider)?;
        database
            .connection()
            .query_row(
                r#"
                SELECT credential_ref, provider, remote_app_id, payload_json, revision
                FROM channel_credentials
                WHERE credential_ref = ?1 AND provider = ?2
                "#,
                params![params.credential_ref, params.provider],
                |row| {
                    let provider = row.get::<_, String>(1)?;
                    let payload_json = row.get::<_, String>(3)?;
                    let payload = parse_stored_credential_payload(&provider, &payload_json)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                3,
                                rusqlite::types::Type::Text,
                                error.into(),
                            )
                        })?;
                    Ok(ChannelCredentialView {
                        credential_ref: row.get(0)?,
                        provider,
                        remote_app_id: row.get(2)?,
                        payload,
                        revision: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn published_channel_credentials(
        &self,
        database: &mut Database,
    ) -> Result<Vec<PublishedChannelCredentialView>> {
        query_rows(
            database.connection(),
            r#"
            SELECT bot.agent_id, credential.credential_ref, credential.provider,
                   credential.remote_app_id, credential.payload_json, credential.revision
            FROM feishu_member_bot AS bot
            JOIN channel_credentials AS credential
              ON credential.credential_ref = bot.credential_ref
             AND credential.provider = 'feishu'
             AND credential.credential_kind = 'member_bot'
             AND credential.remote_app_id = bot.app_id
            WHERE bot.status = 'published'
            UNION ALL
            SELECT bot.agent_id, credential.credential_ref, credential.provider,
                   credential.remote_app_id, credential.payload_json, credential.revision
            FROM dingtalk_member_bot AS bot
            JOIN channel_credentials AS credential
              ON credential.credential_ref = bot.credential_ref
             AND credential.provider = 'dingtalk'
             AND credential.credential_kind = 'member_bot'
             AND credential.remote_app_id = bot.app_key
            WHERE bot.status = 'published'
            ORDER BY provider, agent_id
            "#,
            [],
            |row| {
                let provider = row.get::<_, String>(2)?;
                let payload_json = row.get::<_, String>(4)?;
                let payload =
                    parse_stored_credential_payload(&provider, &payload_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?;
                Ok(PublishedChannelCredentialView {
                    agent_id: row.get(0)?,
                    credential_ref: row.get(1)?,
                    provider,
                    remote_app_id: row.get(3)?,
                    payload,
                    revision: row.get(5)?,
                })
            },
        )
    }

    pub fn channel_developer_session(
        &self,
        database: &mut Database,
        params: &GetChannelDeveloperSessionParams,
    ) -> Result<Option<ChannelDeveloperSessionView>> {
        validate_provider(&params.provider)?;
        database
            .connection()
            .query_row(
                r#"
                SELECT provider, account_id, identity_json, session_json, revision
                FROM channel_developer_sessions WHERE provider = ?1
                "#,
                [&params.provider],
                |row| {
                    let identity_json = row.get::<_, String>(2)?;
                    let session_json = row.get::<_, String>(3)?;
                    let identity = serde_json::from_str(&identity_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    let session = serde_json::from_str(&session_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(ChannelDeveloperSessionView {
                        provider: row.get(0)?,
                        account_id: row.get(1)?,
                        identity,
                        session,
                        revision: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn commit_feishu_account_connection(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CommitFeishuAccountConnectionCommand>,
    ) -> Result<CommandExecution> {
        validate_feishu_connection(&envelope.payload)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, FEISHU_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted Feishu Channel Host can commit a connection",
                ));
            }
            if let Some(conflict) = previous_account_version_conflict(
                transaction,
                "feishu_account",
                envelope.payload.expected_previous_account_version,
            )? {
                return Ok(version_conflict(conflict));
            }
            let session_revision = replace_developer_session_row(
                transaction,
                FEISHU_PROVIDER,
                &envelope.payload.account.account_id,
                &envelope.payload.developer_session.identity,
                &envelope.payload.developer_session.session,
            )?;
            let account_version = persist_feishu_account(transaction, &envelope.payload.account)?;
            Ok(CommandHandlerResult::applied(
                "feishu_account.connection_committed",
                json!({
                    "accountId": envelope.payload.account.account_id,
                    "version": account_version,
                    "sessionRevision": session_revision,
                }),
                Some(EntityReference {
                    entity_type: "feishu_account".to_string(),
                    entity_id: envelope.payload.account.account_id.clone(),
                }),
            ))
        })
    }

    pub fn commit_dingtalk_account_connection(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CommitDingTalkAccountConnectionCommand>,
    ) -> Result<CommandExecution> {
        validate_dingtalk_connection(&envelope.payload)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, DINGTALK_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only the trusted DingTalk Channel Host can commit a connection",
                ));
            }
            if let Some(conflict) = previous_account_version_conflict(
                transaction,
                "dingtalk_account",
                envelope.payload.expected_previous_account_version,
            )? {
                return Ok(version_conflict(conflict));
            }
            let session_revision = replace_developer_session_row(
                transaction,
                DINGTALK_PROVIDER,
                &envelope.payload.account.account_id,
                &envelope.payload.developer_session.identity,
                &envelope.payload.developer_session.session,
            )?;
            let account_version = persist_dingtalk_account(transaction, &envelope.payload.account)?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_account.connection_committed",
                json!({
                    "accountId": envelope.payload.account.account_id,
                    "version": account_version,
                    "sessionRevision": session_revision,
                }),
                Some(EntityReference {
                    entity_type: "dingtalk_account".to_string(),
                    entity_id: envelope.payload.account.account_id.clone(),
                }),
            ))
        })
    }

    pub fn replace_channel_developer_session(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReplaceChannelDeveloperSessionCommand>,
    ) -> Result<CommandExecution> {
        validate_provider(&envelope.payload.provider)?;
        validate_nonempty(&envelope.payload.account_id, "accountId")?;
        validate_developer_session_documents(
            &envelope.payload.provider,
            &envelope.payload.identity,
            &envelope.payload.session,
        )?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can replace its session",
                ));
            }
            let account_table = if envelope.payload.provider == FEISHU_PROVIDER {
                "feishu_account"
            } else {
                "dingtalk_account"
            };
            let account_connected: bool = transaction.query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM {account_table} WHERE id = ?1 AND status = 'connected')"
                ),
                [&envelope.payload.account_id],
                |row| row.get(0),
            )?;
            if !account_connected {
                return Ok(rejected(
                    "channel_developer_session.account_not_connected",
                    "Developer Session replacement requires its connected account",
                ));
            }
            let current = transaction
                .query_row(
                    r#"
                    SELECT account_id, revision FROM channel_developer_sessions
                    WHERE provider = ?1
                    "#,
                    [&envelope.payload.provider],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?;
            match current {
                Some((account_id, revision)) => {
                    if account_id != envelope.payload.account_id {
                        return Ok(rejected(
                            "channel_developer_session.account_mismatch",
                            "Developer Session cannot move to another account outside connection commit",
                        ));
                    }
                    if envelope.payload.expected_revision != Some(revision) {
                        return Ok(version_conflict(revision));
                    }
                }
                None if envelope.payload.expected_revision.is_some() => {
                    return Ok(version_conflict(0));
                }
                None => {}
            }
            let revision = replace_developer_session_row(
                transaction,
                &envelope.payload.provider,
                &envelope.payload.account_id,
                &envelope.payload.identity,
                &envelope.payload.session,
            )?;
            Ok(CommandHandlerResult::applied(
                "channel_developer_session.replaced",
                json!({
                    "provider": envelope.payload.provider,
                    "accountId": envelope.payload.account_id,
                    "revision": revision,
                }),
                None,
            ))
        })
    }

    pub fn delete_channel_developer_session(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteChannelDeveloperSessionCommand>,
    ) -> Result<CommandExecution> {
        validate_provider(&envelope.payload.provider)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can delete its session",
                ));
            }
            transaction.execute(
                "DELETE FROM channel_developer_sessions WHERE provider = ?1",
                [&envelope.payload.provider],
            )?;
            Ok(CommandHandlerResult::applied(
                "channel_developer_session.deleted",
                json!({ "provider": envelope.payload.provider }),
                None,
            ))
        })
    }

    pub fn delete_channel_credential(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteChannelCredentialCommand>,
    ) -> Result<CommandExecution> {
        validate_provider(&envelope.payload.provider)?;
        validate_credential_ref(&envelope.payload.credential_ref, &envelope.payload.provider)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can delete credentials",
                ));
            }
            let referenced: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM channel_member_bot_directory
                    WHERE provider = ?1 AND credential_ref = ?2
                )
                "#,
                params![envelope.payload.provider, envelope.payload.credential_ref],
                |row| row.get(0),
            )?;
            if referenced {
                return Ok(rejected(
                    "channel_credential.still_referenced",
                    "A member Bot still references this credential",
                ));
            }
            transaction.execute(
                "DELETE FROM channel_credentials WHERE provider = ?1 AND credential_ref = ?2",
                params![envelope.payload.provider, envelope.payload.credential_ref],
            )?;
            Ok(CommandHandlerResult::applied(
                "channel_credential.deleted",
                json!({
                    "provider": envelope.payload.provider,
                    "credentialRef": envelope.payload.credential_ref,
                }),
                None,
            ))
        })
    }

    pub fn store_publication_credential(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<StorePublicationCredentialCommand>,
    ) -> Result<CommandExecution> {
        validate_provider(&envelope.payload.provider)?;
        validate_credential_ref(&envelope.payload.credential_ref, &envelope.payload.provider)?;
        validate_nonempty(
            &envelope.payload.publication_intent_id,
            "publicationIntentId",
        )?;
        validate_nonempty(&envelope.payload.remote_app_id, "remoteAppId")?;
        let payload =
            validated_credential_payload(&envelope.payload.provider, &envelope.payload.credential)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can freeze credentials",
                ));
            }
            if envelope.payload.provider == FEISHU_PROVIDER {
                store_feishu_publication_credential(transaction, &envelope.payload, &payload)
            } else {
                store_dingtalk_publication_credential(transaction, &envelope.payload, &payload)
            }
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
            if !is_channel_host_for_provider(&envelope.actor, FEISHU_PROVIDER) {
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
            transaction.execute(
                r#"
                INSERT INTO feishu_owner_identity(
                    account_id, tenant_id, canonical_owner_principal_id,
                    user_id_digest, union_id_digest, verified_at,
                    version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, 1, ?5, ?5)
                ON CONFLICT(account_id) DO UPDATE SET
                    tenant_id = excluded.tenant_id,
                    user_id_digest = excluded.user_id_digest,
                    verified_at = excluded.verified_at,
                    version = feishu_owner_identity.version + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.tenant_id,
                    format!("rvep_{}", Uuid::new_v4().simple()),
                    envelope.payload.user_id_digest,
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
            transaction.execute(
                "DELETE FROM channel_developer_sessions WHERE provider = 'feishu'",
                [],
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
            if !is_channel_host_for_provider(&envelope.actor, FEISHU_PROVIDER) {
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
            transaction.execute(
                "DELETE FROM channel_developer_sessions WHERE provider = 'feishu'",
                [],
            )?;
            Ok(CommandHandlerResult::applied(
                "feishu_account.session_expired",
                json!({ "accountId": envelope.payload.account_id, "version": version + 1 }),
                None,
            ))
        })
    }

    pub fn upsert_dingtalk_account(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpsertDingTalkAccountCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(&envelope.payload.account_id, "accountId")?;
        validate_digest(&envelope.payload.user_id_digest, "userIdDigest")?;
        validate_nonempty(&envelope.payload.corp_id, "corpId")?;
        validate_nonempty(&envelope.payload.oauth_profile_ref, "oauthProfileRef")?;
        let user_name = normalize_display_name(&envelope.payload.user_name)?;
        let corp_name = normalize_display_name(&envelope.payload.corp_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, DINGTALK_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can persist DingTalk account facts",
                ));
            }
            let existing = transaction
                .query_row(
                    r#"
                    SELECT user_id_digest, corp_id, oauth_profile_ref
                    FROM dingtalk_account WHERE id = ?1
                    "#,
                    [&envelope.payload.account_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            if existing
                .as_ref()
                .is_some_and(|(user_digest, corp_id, profile_ref)| {
                    user_digest != &envelope.payload.user_id_digest
                        || corp_id != &envelope.payload.corp_id
                        || profile_ref != &envelope.payload.oauth_profile_ref
                })
            {
                return Ok(rejected(
                    "dingtalk_account.identity_conflict",
                    "DingTalk identity changed for the same account ID",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE dingtalk_account
                SET status = 'disconnected', disconnected_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE status = 'connected' AND id <> ?1
                "#,
                params![envelope.payload.account_id, now],
            )?;
            transaction.execute(
                r#"
                INSERT INTO dingtalk_account(
                    id, user_id_digest, corp_id, user_name, corp_name,
                    oauth_profile_ref, status, version, created_at, updated_at,
                    connected_at, last_verified_at, disconnected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'connected', 1, ?7, ?7, ?7, ?7, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    user_name = excluded.user_name,
                    corp_name = excluded.corp_name,
                    status = 'connected',
                    connected_at = CASE
                        WHEN dingtalk_account.status = 'connected'
                        THEN dingtalk_account.connected_at
                        ELSE excluded.connected_at
                    END,
                    last_verified_at = excluded.last_verified_at,
                    disconnected_at = NULL,
                    version = dingtalk_account.version + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.user_id_digest,
                    envelope.payload.corp_id,
                    user_name,
                    corp_name,
                    envelope.payload.oauth_profile_ref,
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO dingtalk_owner_identity(
                    account_id, corp_id, canonical_owner_principal_id,
                    user_id_digest, version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
                ON CONFLICT(account_id) DO UPDATE SET
                    corp_id = excluded.corp_id,
                    user_id_digest = excluded.user_id_digest,
                    version = dingtalk_owner_identity.version + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.corp_id,
                    format!("rvep_{}", Uuid::new_v4().simple()),
                    envelope.payload.user_id_digest,
                    now,
                ],
            )?;
            let version: i64 = transaction.query_row(
                "SELECT version FROM dingtalk_account WHERE id = ?1",
                [&envelope.payload.account_id],
                |row| row.get(0),
            )?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_account.connected",
                json!({ "accountId": envelope.payload.account_id, "version": version }),
                Some(EntityReference {
                    entity_type: "dingtalk_account".to_string(),
                    entity_id: envelope.payload.account_id.clone(),
                }),
            ))
        })
    }

    pub fn disconnect_dingtalk_account(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DisconnectDingTalkAccountCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_owner(&envelope.actor) {
                return Ok(rejected(
                    "dingtalk_account.owner_required",
                    "Only the local owner can disconnect DingTalk",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM dingtalk_account WHERE id = ?1 AND status = 'connected'",
                    [&envelope.payload.account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected(
                    "dingtalk_account.not_connected",
                    "Connected DingTalk account does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE dingtalk_account
                SET status = 'disconnected', disconnected_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![envelope.payload.account_id, now, version],
            )?;
            transaction.execute(
                "DELETE FROM channel_developer_sessions WHERE provider = 'dingtalk'",
                [],
            )?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_account.disconnected",
                json!({ "accountId": envelope.payload.account_id, "version": version + 1 }),
                None,
            ))
        })
    }

    pub fn expire_dingtalk_account(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ExpireDingTalkAccountCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, DINGTALK_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can expire DingTalk OAuth",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM dingtalk_account WHERE id = ?1 AND status = 'connected'",
                    [&envelope.payload.account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected(
                    "dingtalk_account.not_connected",
                    "Connected DingTalk account does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE dingtalk_account
                SET status = 'oauth_expired', disconnected_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![envelope.payload.account_id, now, version],
            )?;
            transaction.execute(
                "DELETE FROM channel_developer_sessions WHERE provider = 'dingtalk'",
                [],
            )?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_account.oauth_expired",
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
            if !is_channel_host_for_provider(&envelope.actor, FEISHU_PROVIDER) {
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
            if !is_channel_host_for_provider(&envelope.actor, FEISHU_PROVIDER) {
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

    pub fn create_dingtalk_publication_intent(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateDingTalkPublicationIntentCommand>,
    ) -> Result<CommandExecution> {
        for (value, field) in [
            (
                &envelope.payload.publication_intent_id,
                "publicationIntentId",
            ),
            (&envelope.payload.account_id, "accountId"),
            (&envelope.payload.agent_id, "agentId"),
            (&envelope.payload.expected_corp_id, "expectedCorpId"),
        ] {
            validate_nonempty(value, field)?;
        }
        validate_digest(
            &envelope.payload.expected_user_id_digest,
            "expectedUserIdDigest",
        )?;
        let requested_app_name = normalize_display_name(&envelope.payload.requested_app_name)?;
        if envelope.payload.provisioning_mode != "direct_open_platform" {
            anyhow::bail!("provisioningMode must be direct_open_platform");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, DINGTALK_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can create DingTalk publication intents",
                ));
            }
            let account_matches: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM dingtalk_account
                    WHERE id = ?1 AND status = 'connected'
                      AND user_id_digest = ?2 AND corp_id = ?3
                )
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.expected_user_id_digest,
                    envelope.payload.expected_corp_id,
                ],
                |row| row.get(0),
            )?;
            if !account_matches {
                return Ok(rejected(
                    "dingtalk_account.identity_mismatch",
                    "Publication requires the exact connected DingTalk identity",
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
            let already_bound: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM dingtalk_member_bot WHERE agent_id = ?1)",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if already_bound {
                return Ok(rejected(
                    "dingtalk_member_bot.already_bound",
                    "This member already has an immutable DingTalk App binding",
                ));
            }
            let intent_exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM dingtalk_member_bot_publication_intent WHERE agent_id = ?1)",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            if intent_exists {
                return Ok(rejected(
                    "dingtalk_publication_intent.already_exists",
                    "DingTalk publication must resume the member's existing durable intent",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO dingtalk_member_bot_publication_intent(
                    id, agent_id, account_id, expected_user_id_digest,
                    expected_corp_id, requested_app_name, provisioning_mode,
                    state, remote_unified_app_id, app_key, robot_code,
                    credential_ref, version_id, approval_mode,
                    approver_user_id_digest, last_completed_step, failure_code,
                    version, created_at, updated_at, completed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, 'direct_open_platform',
                    'created', NULL, NULL, NULL, NULL, NULL, NULL,
                    NULL, NULL, NULL, 1, ?7, ?7, NULL
                )
                "#,
                params![
                    envelope.payload.publication_intent_id,
                    envelope.payload.agent_id,
                    envelope.payload.account_id,
                    envelope.payload.expected_user_id_digest,
                    envelope.payload.expected_corp_id,
                    requested_app_name,
                    now,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_member_bot_publication_intent.created",
                json!({
                    "publicationIntentId": envelope.payload.publication_intent_id,
                    "version": 1,
                }),
                Some(EntityReference {
                    entity_type: "dingtalk_member_bot_publication_intent".to_string(),
                    entity_id: envelope.payload.publication_intent_id.clone(),
                }),
            ))
        })
    }

    pub fn advance_dingtalk_publication_intent(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AdvanceDingTalkPublicationIntentCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(
            &envelope.payload.publication_intent_id,
            "publicationIntentId",
        )?;
        validate_dingtalk_publication_state(&envelope.payload.state)?;
        for (value, field) in [
            (
                envelope.payload.remote_unified_app_id.as_ref(),
                "remoteUnifiedAppId",
            ),
            (envelope.payload.app_key.as_ref(), "appKey"),
            (envelope.payload.robot_code.as_ref(), "robotCode"),
            (envelope.payload.credential_ref.as_ref(), "credentialRef"),
            (envelope.payload.version_id.as_ref(), "versionId"),
            (
                envelope.payload.last_completed_step.as_ref(),
                "lastCompletedStep",
            ),
            (envelope.payload.failure_code.as_ref(), "failureCode"),
        ] {
            if let Some(value) = value {
                validate_nonempty(value, field)?;
            }
        }
        if let Some(digest) = &envelope.payload.approver_user_id_digest {
            validate_digest(digest, "approverUserIdDigest")?;
        }
        if envelope
            .payload
            .approval_mode
            .as_deref()
            .is_some_and(|mode| !matches!(mode, "NO_APPROVAL" | "SELECT_APPROVER" | "AUTO"))
        {
            anyhow::bail!("approvalMode is not supported");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, DINGTALK_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can advance DingTalk publication intents",
                ));
            }
            let current = transaction
                .query_row(
                    r#"
                    SELECT agent_id, account_id, state, remote_unified_app_id,
                           app_key, robot_code, credential_ref, version_id,
                           approval_mode, approver_user_id_digest, version
                    FROM dingtalk_member_bot_publication_intent
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
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<String>>(6)?,
                            row.get::<_, Option<String>>(7)?,
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, i64>(10)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                agent_id,
                account_id,
                current_state,
                current_unified_app_id,
                current_app_key,
                current_robot_code,
                current_credential_ref,
                current_version_id,
                current_approval_mode,
                current_approver_digest,
                version,
            )) = current
            else {
                return Ok(rejected(
                    "dingtalk_publication_intent.not_found",
                    "DingTalk publication intent does not exist",
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if !dingtalk_publication_transition_allowed(&current_state, &envelope.payload.state) {
                return Ok(rejected(
                    "dingtalk_publication_intent.invalid_transition",
                    "DingTalk publication intent transition is not allowed",
                ));
            }
            macro_rules! freeze_field {
                ($current:expr, $incoming:expr, $code:literal, $message:literal) => {
                    if $current.as_ref().is_some()
                        && $incoming.as_ref().is_some()
                        && $current.as_ref() != $incoming.as_ref()
                    {
                        return Ok(rejected($code, $message));
                    }
                };
            }
            freeze_field!(
                current_unified_app_id,
                envelope.payload.remote_unified_app_id,
                "dingtalk_publication_intent.remote_app_conflict",
                "Publication intent cannot change its unified App identity"
            );
            freeze_field!(
                current_app_key,
                envelope.payload.app_key,
                "dingtalk_publication_intent.app_key_conflict",
                "Publication intent cannot change its AppKey"
            );
            freeze_field!(
                current_robot_code,
                envelope.payload.robot_code,
                "dingtalk_publication_intent.robot_code_conflict",
                "Publication intent cannot change its robotCode"
            );
            freeze_field!(
                current_credential_ref,
                envelope.payload.credential_ref,
                "dingtalk_publication_intent.credential_conflict",
                "Publication intent cannot change its credential reference"
            );
            freeze_field!(
                current_version_id,
                envelope.payload.version_id,
                "dingtalk_publication_intent.version_conflict",
                "Publication intent cannot change its release version identity"
            );
            let remote_unified_app_id = envelope
                .payload
                .remote_unified_app_id
                .clone()
                .or(current_unified_app_id);
            let app_key = envelope.payload.app_key.clone().or(current_app_key);
            let robot_code = envelope.payload.robot_code.clone().or(current_robot_code);
            let credential_ref = envelope
                .payload
                .credential_ref
                .clone()
                .or(current_credential_ref);
            let version_id = envelope.payload.version_id.clone().or(current_version_id);
            let approval_mode = envelope
                .payload
                .approval_mode
                .clone()
                .or(current_approval_mode);
            let approver_digest = envelope
                .payload
                .approver_user_id_digest
                .clone()
                .or(current_approver_digest);
            if dingtalk_state_requires_app(&envelope.payload.state)
                && remote_unified_app_id.is_none()
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.remote_app_required",
                    "This publication state requires a durably frozen unified App ID",
                ));
            }
            if dingtalk_state_requires_credentials(&envelope.payload.state)
                && (app_key.is_none() || credential_ref.is_none())
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.credentials_required",
                    "This publication state requires frozen App credentials",
                ));
            }
            if dingtalk_state_requires_robot(&envelope.payload.state) && robot_code.is_none() {
                return Ok(rejected(
                    "dingtalk_publication_intent.robot_required",
                    "This publication state requires a frozen robotCode",
                ));
            }
            if dingtalk_state_requires_version(&envelope.payload.state) && version_id.is_none() {
                return Ok(rejected(
                    "dingtalk_publication_intent.version_required",
                    "This publication state requires a frozen version ID",
                ));
            }
            if envelope.payload.state == "awaiting_approver_selection"
                && approval_mode.as_deref() != Some("SELECT_APPROVER")
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.approver_selection_mode_required",
                    "Approver selection requires SELECT_APPROVER mode",
                ));
            }
            if envelope.payload.state == "awaiting_approval"
                && approval_mode.as_deref() == Some("SELECT_APPROVER")
                && approver_digest.is_none()
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.approver_required",
                    "Selected-approver publication requires the Owner's explicit choice",
                ));
            }
            if envelope.payload.state.starts_with("failed_")
                && envelope.payload.failure_code.is_none()
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.failure_code_required",
                    "A failed publication intent requires a failure code",
                ));
            }
            if envelope.payload.state == "failed_unknown_remote_state"
                && remote_unified_app_id.is_some()
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.known_app_is_recoverable",
                    "A frozen unified App ID must use failed_recoverable",
                ));
            }
            if current_state == "failed_unknown_remote_state"
                && envelope.payload.state == "failed_recoverable"
                && remote_unified_app_id.is_none()
            {
                return Ok(rejected(
                    "dingtalk_publication_intent.reconciliation_remote_app_required",
                    "An unknown create result needs a proven unified App ID before recovery",
                ));
            }
            if matches!(
                envelope.payload.state.as_str(),
                "stream_verified" | "card_verified" | "completed"
            ) {
                let exact_binding: bool = transaction.query_row(
                    r#"
                    SELECT EXISTS(
                        SELECT 1 FROM dingtalk_member_bot
                        WHERE agent_id = ?1 AND account_id = ?2
                          AND unified_app_id = ?3 AND app_key = ?4
                          AND robot_code = ?5 AND credential_ref = ?6
                          AND status = 'published'
                    )
                    "#,
                    params![
                        agent_id,
                        account_id,
                        remote_unified_app_id,
                        app_key,
                        robot_code,
                        credential_ref,
                    ],
                    |row| row.get(0),
                )?;
                if !exact_binding {
                    return Ok(rejected(
                        "dingtalk_publication_intent.member_bot_binding_required",
                        "Stream and card verification require the exact published Bot binding",
                    ));
                }
            }
            let now = Utc::now().to_rfc3339();
            let completed_at = (envelope.payload.state == "completed").then_some(now.clone());
            transaction.execute(
                r#"
                UPDATE dingtalk_member_bot_publication_intent
                SET state = ?2, remote_unified_app_id = ?3, app_key = ?4,
                    robot_code = ?5, credential_ref = ?6, version_id = ?7,
                    approval_mode = ?8, approver_user_id_digest = ?9,
                    last_completed_step = ?10, failure_code = ?11,
                    completed_at = COALESCE(?12, completed_at),
                    version = version + 1, updated_at = ?13
                WHERE id = ?1 AND version = ?14
                "#,
                params![
                    envelope.payload.publication_intent_id,
                    envelope.payload.state,
                    remote_unified_app_id,
                    app_key,
                    robot_code,
                    credential_ref,
                    version_id,
                    approval_mode,
                    approver_digest,
                    envelope.payload.last_completed_step,
                    envelope.payload.failure_code,
                    completed_at,
                    now,
                    version,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_member_bot_publication_intent.advanced",
                json!({
                    "publicationIntentId": envelope.payload.publication_intent_id,
                    "state": envelope.payload.state,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "dingtalk_member_bot_publication_intent".to_string(),
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
            (&envelope.payload.owner_open_id, "ownerOpenId"),
            (&envelope.payload.credential_ref, "credentialRef"),
        ] {
            validate_nonempty(value, field)?;
        }
        if envelope.payload.owner_open_id.len() > 512 {
            anyhow::bail!("ownerOpenId is too long");
        }
        let display_name = normalize_display_name(&envelope.payload.bot_display_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, FEISHU_PROVIDER) {
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
            let owner_open_id_digest =
                opaque_digest("feishu-open", &envelope.payload.owner_open_id);
            let owner_identity_conflict: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM feishu_owner_app_identity
                    WHERE app_id = ?1
                      AND (
                        account_id <> ?2
                        OR (open_id_digest IS NOT NULL AND open_id_digest <> ?3)
                      )
                )
                "#,
                params![
                    envelope.payload.app_id,
                    envelope.payload.account_id,
                    owner_open_id_digest,
                ],
                |row| row.get(0),
            )?;
            if owner_identity_conflict {
                return Ok(rejected(
                    "feishu_owner_identity.conflict",
                    "The frozen App-scoped Owner identity cannot be rebound",
                ));
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
            transaction.execute(
                r#"
                INSERT INTO feishu_owner_app_identity(
                    account_id, app_id, open_id_digest, user_id_digest,
                    union_id_digest, verified_at, version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, 1, ?4, ?4)
                ON CONFLICT(account_id, app_id) DO UPDATE SET
                    open_id_digest = excluded.open_id_digest,
                    verified_at = excluded.verified_at,
                    version = CASE
                        WHEN feishu_owner_app_identity.open_id_digest = excluded.open_id_digest
                        THEN feishu_owner_app_identity.version
                        ELSE feishu_owner_app_identity.version + 1
                    END,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.account_id,
                    envelope.payload.app_id,
                    owner_open_id_digest,
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

    pub fn upsert_dingtalk_member_bot(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpsertDingTalkMemberBotCommand>,
    ) -> Result<CommandExecution> {
        for (value, field) in [
            (&envelope.payload.account_id, "accountId"),
            (&envelope.payload.agent_id, "agentId"),
            (&envelope.payload.unified_app_id, "unifiedAppId"),
            (&envelope.payload.app_key, "appKey"),
            (&envelope.payload.robot_code, "robotCode"),
            (&envelope.payload.owner_user_id, "ownerUserId"),
            (&envelope.payload.credential_ref, "credentialRef"),
        ] {
            validate_nonempty(value, field)?;
        }
        let display_name = normalize_display_name(&envelope.payload.bot_display_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, DINGTALK_PROVIDER) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can persist DingTalk Bot facts",
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
                    SELECT account_id, unified_app_id, app_key, robot_code,
                           credential_ref, status
                    FROM dingtalk_member_bot WHERE agent_id = ?1
                    "#,
                    [&envelope.payload.agent_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((account_id, unified_app_id, app_key, robot_code, credential_ref, status)) =
                &existing_binding
            {
                if account_id != &envelope.payload.account_id
                    || unified_app_id != &envelope.payload.unified_app_id
                    || app_key != &envelope.payload.app_key
                    || robot_code != &envelope.payload.robot_code
                    || credential_ref != &envelope.payload.credential_ref
                {
                    return Ok(rejected(
                        "dingtalk_member_bot.binding_immutable",
                        "A member Bot cannot change its DingTalk App, robot, owner account, or credential identity",
                    ));
                }
                if status != "published"
                    && !dingtalk_member_bot_publication_ready(transaction, &envelope.payload)?
                {
                    return Ok(rejected(
                        "dingtalk_member_bot.publication_state_required",
                        "Reactivating a member Bot requires its matching publication state machine",
                    ));
                }
            } else {
                let account_connected: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM dingtalk_account WHERE id = ?1 AND status = 'connected')",
                    [&envelope.payload.account_id],
                    |row| row.get(0),
                )?;
                if !account_connected {
                    return Ok(rejected(
                        "dingtalk_account.not_connected",
                        "Initial Bot publication requires the connected DingTalk account",
                    ));
                }
                if !dingtalk_member_bot_publication_ready(transaction, &envelope.payload)? {
                    return Ok(rejected(
                        "dingtalk_member_bot.publication_state_required",
                        "Initial Bot binding requires the matching publication state machine",
                    ));
                }
            }
            let owner_user_id_digest =
                opaque_digest("dingtalk-user", &envelope.payload.owner_user_id);
            let owner_matches_account: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM dingtalk_owner_identity
                    WHERE account_id = ?1 AND user_id_digest = ?2
                )
                "#,
                params![envelope.payload.account_id, owner_user_id_digest],
                |row| row.get(0),
            )?;
            if !owner_matches_account {
                return Ok(rejected(
                    "dingtalk_owner_identity.conflict",
                    "The App-scoped Owner must match the connected DingTalk account",
                ));
            }
            let app_identity_conflict: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM dingtalk_owner_app_identity
                    WHERE app_key = ?1
                      AND (account_id <> ?2 OR user_id_digest <> ?3)
                )
                "#,
                params![
                    envelope.payload.app_key,
                    envelope.payload.account_id,
                    owner_user_id_digest,
                ],
                |row| row.get(0),
            )?;
            if app_identity_conflict {
                return Ok(rejected(
                    "dingtalk_owner_identity.conflict",
                    "The frozen App-scoped Owner identity cannot be rebound",
                ));
            }
            let corp_id: String = transaction.query_row(
                "SELECT corp_id FROM dingtalk_account WHERE id = ?1",
                [&envelope.payload.account_id],
                |row| row.get(0),
            )?;
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO dingtalk_member_bot(
                    agent_id, account_id, unified_app_id, app_key, robot_code,
                    bot_display_name, credential_ref, owner_user_id_digest,
                    status, failure_code, version, created_at, updated_at, published_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    'published', NULL, 1, ?9, ?9, ?9
                )
                ON CONFLICT(agent_id) DO UPDATE SET
                    bot_display_name = excluded.bot_display_name,
                    status = 'published', failure_code = NULL,
                    published_at = excluded.published_at,
                    version = dingtalk_member_bot.version + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.agent_id,
                    envelope.payload.account_id,
                    envelope.payload.unified_app_id,
                    envelope.payload.app_key,
                    envelope.payload.robot_code,
                    display_name,
                    envelope.payload.credential_ref,
                    owner_user_id_digest,
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO dingtalk_owner_app_identity(
                    app_key, account_id, corp_id, user_id_digest,
                    version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
                ON CONFLICT(app_key) DO UPDATE SET
                    version = CASE
                        WHEN dingtalk_owner_app_identity.user_id_digest = excluded.user_id_digest
                        THEN dingtalk_owner_app_identity.version
                        ELSE dingtalk_owner_app_identity.version + 1
                    END,
                    updated_at = excluded.updated_at
                "#,
                params![
                    envelope.payload.app_key,
                    envelope.payload.account_id,
                    corp_id,
                    owner_user_id_digest,
                    now,
                ],
            )?;
            let version: i64 = transaction.query_row(
                "SELECT version FROM dingtalk_member_bot WHERE agent_id = ?1",
                [&envelope.payload.agent_id],
                |row| row.get(0),
            )?;
            Ok(CommandHandlerResult::applied(
                "dingtalk_member_bot.published",
                json!({ "agentId": envelope.payload.agent_id, "version": version }),
                Some(EntityReference {
                    entity_type: "dingtalk_member_bot".to_string(),
                    entity_id: envelope.payload.agent_id.clone(),
                }),
            ))
        })
    }

    pub fn verify_feishu_owner(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<VerifyFeishuOwnerCommand>,
    ) -> Result<CommandExecution> {
        validate_owner_identity_input(
            &envelope.payload.provider,
            &envelope.payload.app_id,
            &envelope.payload.tenant_key,
            envelope.payload.sender_open_id.as_deref(),
            envelope.payload.sender_user_id.as_deref(),
            envelope.payload.sender_union_id.as_deref(),
        )?;
        let display_name = normalize_display_name(&envelope.payload.sender_display_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can verify sender identity",
                ));
            }
            let now = Utc::now().to_rfc3339();
            match classify_and_record_feishu_owner(
                transaction,
                &envelope.payload.provider,
                &envelope.payload.app_id,
                &envelope.payload.tenant_key,
                envelope.payload.sender_open_id.as_deref(),
                envelope.payload.sender_user_id.as_deref(),
                envelope.payload.sender_union_id.as_deref(),
                &display_name,
                &now,
            )? {
                FeishuOwnerClassification::Owner { principal_id } => {
                    Ok(CommandHandlerResult::applied(
                        "channel.owner.verified",
                        json!({
                            "classification": "owner",
                            "ownerPrincipalId": principal_id,
                        }),
                        Some(EntityReference {
                            entity_type: "external_principal".to_string(),
                            entity_id: principal_id,
                        }),
                    ))
                }
                FeishuOwnerClassification::NonOwner => Ok(CommandHandlerResult::applied(
                    "channel.owner.non_owner",
                    json!({ "classification": "non_owner" }),
                    None,
                )),
                FeishuOwnerClassification::Unverified => Ok(CommandHandlerResult::applied(
                    "channel.owner.unverified",
                    json!({ "classification": "unverified" }),
                    None,
                )),
            }
        })
    }

    pub fn start_new_feishu_dm(
        &self,
        database: &mut Database,
        quick_chat_path: &Path,
        envelope: &CommandEnvelope<StartNewFeishuDmCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(&envelope.payload.app_id, "appId")?;
        validate_nonempty(&envelope.payload.tenant_key, "tenantKey")?;
        validate_nonempty(&envelope.payload.chat_id, "chatId")?;
        validate_nonempty(&envelope.payload.target_agent_id, "targetAgentId")?;
        if !matches!(
            envelope.payload.provider.as_str(),
            FEISHU_PROVIDER | DINGTALK_PROVIDER
        ) {
            anyhow::bail!("provider must be feishu or dingtalk");
        }
        if !quick_chat_path.is_dir() {
            anyhow::bail!("managed Quick Chat path is unavailable");
        }
        let conversation_display_name =
            normalize_display_name(&envelope.payload.conversation_display_name)?;
        let canonical_path = quick_chat_path.to_string_lossy().to_string();
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can rotate a DM Camp",
                ));
            }
            let owner = load_verified_owner_for_app(
                transaction,
                &envelope.payload.provider,
                &envelope.payload.app_id,
                &envelope.payload.tenant_key,
            )?;
            let Some((owner_principal_id, owner_display_name)) = owner else {
                return Ok(rejected(
                    "owner_identity_unverified",
                    "This Bot cannot prove the connected Rovai owner identity",
                ));
            };
            let app_targets_agent: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM channel_member_bot_directory
                    WHERE provider = ?1 AND app_id = ?2
                      AND agent_id = ?3 AND status = 'published'
                )
                "#,
                params![
                    envelope.payload.provider,
                    envelope.payload.app_id,
                    envelope.payload.target_agent_id
                ],
                |row| row.get(0),
            )?;
            if !app_targets_agent {
                return Ok(rejected(
                    "channel.target_bot_unpublished",
                    "The DM target Bot is not a published managed Agent",
                ));
            }
            let conversation_id = stable_channel_conversation_id(
                &envelope.payload.provider,
                &envelope.payload.tenant_key,
                &envelope.payload.chat_id,
                "",
                &envelope.payload.app_id,
            )?;
            let now = Utc::now().to_rfc3339();
            upsert_channel_conversation(
                transaction,
                &conversation_id,
                &envelope.payload.provider,
                &envelope.payload.tenant_key,
                &envelope.payload.chat_id,
                "",
                &envelope.payload.app_id,
                "p2p",
                &conversation_display_name,
                &owner_display_name,
                Some(&owner_principal_id),
                &now,
            )?;
            let current = transaction
                .query_row(
                    r#"
                    SELECT id, camp_id
                    FROM channel_conversation_binding
                    WHERE channel_conversation_id = ?1 AND status = 'active'
                    "#,
                    [&conversation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()?;
            if current.is_none() {
                let collecting: bool = transaction.query_row(
                    r#"
                    SELECT EXISTS(
                        SELECT 1 FROM channel_inbound_aggregate
                        WHERE status = 'collecting'
                          AND json_extract(frozen_payload_json, '$.conversationId') = ?1
                    )
                    "#,
                    [&conversation_id],
                    |row| row.get(0),
                )?;
                if collecting {
                    return Ok(rejected(
                        "channel.dm.busy",
                        "Wait for the current message to finish admission before starting a new Quick Chat",
                    ));
                }
            }
            if let Some((current_binding_id, _)) = &current {
                let busy: bool = transaction.query_row(
                    r#"
                    SELECT
                        EXISTS(
                            SELECT 1 FROM channel_turn_request
                            WHERE binding_id = ?1 AND status IN ('queued', 'admitted')
                        )
                        OR EXISTS(
                            SELECT 1 FROM channel_inbound_aggregate
                            WHERE status = 'collecting'
                              AND json_extract(frozen_payload_json, '$.conversationId') = ?2
                        )
                    "#,
                    params![current_binding_id, conversation_id],
                    |row| row.get(0),
                )?;
                if busy {
                    return Ok(rejected(
                        "channel.dm.busy",
                        "Wait for the current reply to finish before starting a new Quick Chat",
                    ));
                }
                transaction.execute(
                    r#"
                    UPDATE channel_conversation_binding
                    SET status = 'closed', closed_at = ?2,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1 AND status = 'active'
                    "#,
                    params![current_binding_id, now],
                )?;
            }
            let generation: i64 = transaction.query_row(
                r#"
                SELECT COALESCE(MAX(generation), 0) + 1
                FROM channel_conversation_binding
                WHERE channel_conversation_id = ?1
                "#,
                [&conversation_id],
                |row| row.get(0),
            )?;
            let binding_id = format!("rvcb_{}", Uuid::new_v4().simple());
            transaction.execute(
                r#"
                INSERT INTO channel_conversation_binding(
                    id, channel_conversation_id, execution_scope_kind,
                    project_id, camp_id, status, generation, version,
                    created_at, updated_at, closed_at
                ) VALUES (?1, ?2, 'quick_chat', NULL, NULL, 'active', ?3, 1, ?4, ?4, NULL)
                "#,
                params![binding_id, conversation_id, generation, now],
            )?;
            let mut binding = ChannelBindingAdmission {
                binding_id: binding_id.clone(),
                camp_id: None,
                project_display_name: "快速对话".to_string(),
                binding_kind: "quick_chat".to_string(),
                canonical_path,
                project_status: None,
                conversation_display_name,
                conversation_kind: "p2p".to_string(),
            };
            let camp_id = create_channel_camp(
                transaction,
                &binding,
                std::slice::from_ref(&envelope.payload.target_agent_id),
                &now,
            )?;
            binding.camp_id = Some(camp_id.clone());
            Ok(CommandHandlerResult::applied(
                "channel.dm.started_new",
                json!({
                    "conversationId": conversation_id,
                    "bindingId": binding_id,
                    "campId": camp_id,
                    "campCreated": true,
                    "generation": generation,
                }),
                Some(EntityReference {
                    entity_type: "channel_conversation_binding".to_string(),
                    entity_id: binding_id,
                }),
            ))
        })
    }

    pub fn reconcile_feishu_group_roster(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReconcileFeishuGroupRosterCommand>,
    ) -> Result<CommandExecution> {
        if !matches!(
            envelope.payload.provider.as_str(),
            FEISHU_PROVIDER | DINGTALK_PROVIDER
        ) {
            anyhow::bail!("channel provider must be feishu or dingtalk");
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
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can reconcile the Bot roster",
                ));
            }
            let known_bots = query_rows(
                transaction,
                r#"
                SELECT app_id, agent_id, status
                FROM channel_member_bot_directory
                WHERE provider = ?1
                ORDER BY app_id
                "#,
                [&envelope.payload.provider],
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
            crate::message_delivery::dispatch_topic_deliveries_waiting_for_roster(
                database,
                &envelope.payload.provider,
                &envelope.payload.tenant_key,
                &envelope.payload.chat_id,
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
            if !is_channel_host_for_provider(&envelope.actor, &envelope.payload.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can observe inbound events",
                ));
            }
            let sender_display_name =
                normalize_display_name(&envelope.payload.sender_display_name)?;
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            let owner = classify_and_record_feishu_owner(
                transaction,
                &envelope.payload.provider,
                &envelope.payload.app_id,
                &envelope.payload.tenant_key,
                envelope.payload.sender_open_id.as_deref(),
                envelope.payload.sender_user_id.as_deref(),
                envelope.payload.sender_union_id.as_deref(),
                &sender_display_name,
                &now_text,
            )?;
            let FeishuOwnerClassification::Owner { principal_id } = owner else {
                return Ok(rejected(
                    "channel.owner_required",
                    "Only the verified Rovai owner can trigger a channel human message",
                ));
            };
            let target_agent_ids = resolve_observation_targets(transaction, &envelope.payload)?;
            let structured_content = build_external_content(&envelope.payload, &target_agent_ids)?;
            validate_content(&structured_content)?;
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
            let bot_scope_app_id = if envelope.payload.conversation_kind == "p2p" {
                envelope.payload.app_id.as_str()
            } else {
                ""
            };
            upsert_channel_conversation(
                transaction,
                &conversation_id,
                &envelope.payload.provider,
                &envelope.payload.tenant_key,
                &envelope.payload.chat_id,
                &envelope.payload.topic_key,
                bot_scope_app_id,
                &envelope.payload.conversation_kind,
                &normalize_display_name(&envelope.payload.conversation_display_name)?,
                &sender_display_name,
                Some(&principal_id),
                &now_text,
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
                let ready = if envelope.payload.provider == DINGTALK_PROVIDER {
                    complete
                } else {
                    complete || expected.is_subset(&observed)
                };
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
                "principalId": principal_id,
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
                    "readyToFinalize": if envelope.payload.provider == DINGTALK_PROVIDER {
                        envelope.payload.canonical_mentions_complete
                    } else {
                        envelope.payload.canonical_mentions_complete
                            || expected.is_subset(&observed)
                    },
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
        quick_chat_path: &Path,
        envelope: &CommandEnvelope<FinalizeChannelInboundCommand>,
    ) -> Result<CommandExecution> {
        refresh_project_catalog(database)?;
        if !quick_chat_path.is_dir() {
            anyhow::bail!("managed Quick Chat path is unavailable");
        }
        let quick_chat_path = quick_chat_path.to_string_lossy().to_string();
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can finalize inbound events",
                ));
            }
            let aggregate = load_collecting_aggregate(transaction, &envelope.payload.aggregate_id)?;
            let Some(aggregate) = aggregate else {
                let existing = transaction
                    .query_row(
                        "SELECT status, provider FROM channel_inbound_aggregate WHERE id = ?1",
                        [&envelope.payload.aggregate_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()?;
                return Ok(match existing {
                    Some((_, provider))
                        if !is_channel_host_for_provider(&envelope.actor, &provider) =>
                    {
                        rejected(
                            "channel.host_required",
                            "Only this provider's trusted Channel Host can finalize inbound events",
                        )
                    }
                    Some((status, _)) if status == "finalized" => CommandHandlerResult::applied(
                        "channel.inbound.already_finalized",
                        json!({ "aggregateId": envelope.payload.aggregate_id }),
                        None,
                    ),
                    Some((status, _)) if status == "failed" => rejected(
                        "channel.inbound.failed",
                        "Inbound aggregation is already terminally failed",
                    ),
                    _ => rejected(
                        "channel.inbound.not_found",
                        "Inbound aggregation does not exist",
                    ),
                });
            };
            if !is_channel_host_for_provider(&envelope.actor, &aggregate.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can finalize inbound events",
                ));
            }
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            let expected = parse_string_set(&aggregate.expected_app_ids_json)?;
            let observed = parse_string_set(&aggregate.observed_app_ids_json)?;
            let ready = if aggregate.provider == DINGTALK_PROVIDER {
                aggregate.canonical_mentions_complete
            } else {
                aggregate.canonical_mentions_complete || expected.is_subset(&observed)
            };
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
                mark_aggregate_failed(
                    transaction,
                    &aggregate.id,
                    "aggregation_timeout",
                    &now_text,
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
            let conversation = load_channel_conversation(
                transaction,
                &frozen.conversation_id,
            )?.context("channel inbound conversation is missing")?;
            let roster_agent_ids = match group_roster_readiness(
                transaction,
                &conversation,
                &expected,
            )? {
                GroupRosterReadiness::NotRequired => Vec::new(),
                GroupRosterReadiness::MissingState => {
                    return Ok(CommandHandlerResult::rejected(
                        "channel.roster_sync_required",
                        json!({
                            "message": "The channel group Bot roster must be reconciled before admission",
                            "tenantKey": conversation.tenant_key,
                            "chatId": conversation.chat_id,
                        }),
                    ));
                }
                GroupRosterReadiness::MissingApps(app_ids) => {
                    return Ok(CommandHandlerResult::rejected(
                        "channel.bot_not_in_roster",
                        json!({
                            "message": "A mentioned member Bot is no longer in this channel group",
                            "tenantKey": conversation.tenant_key,
                            "chatId": conversation.chat_id,
                            "appIds": app_ids,
                        }),
                    ));
                }
                GroupRosterReadiness::Ready(agent_ids) => agent_ids,
            };

            let mut camp_created = false;
            let mut binding = if let Some(observed_binding_id) =
                frozen.binding_id_at_observation.as_deref()
            {
                let exact = load_active_channel_binding(
                    transaction,
                    &frozen.conversation_id,
                    Some(observed_binding_id),
                    &quick_chat_path,
                )?;
                if exact.is_none() {
                    mark_aggregate_failed(
                        transaction,
                        &aggregate.id,
                        "binding_generation_changed",
                        &now_text,
                    )?;
                    return Ok(CommandHandlerResult::applied(
                        "channel.inbound.failed",
                        json!({
                            "aggregateId": aggregate.id,
                            "status": "failed",
                            "failureCode": "binding_generation_changed",
                        }),
                        None,
                    ));
                }
                exact
            } else {
                load_active_channel_binding(
                    transaction,
                    &frozen.conversation_id,
                    None,
                    &quick_chat_path,
                )?
            };

            if let Some(current) = binding.as_ref()
                && current.binding_kind == "directory"
                && (current.project_status.as_deref() != Some("active")
                    || !Path::new(&current.canonical_path).is_dir())
            {
                return Ok(rejected(
                    "channel.project_unavailable",
                    "The Camp project is no longer available",
                ));
            }

            if binding.is_none() {
                if conversation.conversation_kind == "p2p" {
                    binding = Some(create_quick_chat_binding(
                        transaction,
                        &conversation,
                        &frozen.target_agent_ids,
                        &quick_chat_path,
                        &now_text,
                    )?);
                    camp_created = true;
                } else {
                    if !aggregate.canonical_mentions_complete {
                        mark_aggregate_failed(
                            transaction,
                            &aggregate.id,
                            "acknowledgement_app_unresolved",
                            &now_text,
                        )?;
                        return Ok(CommandHandlerResult::applied(
                            "channel.inbound.failed",
                            json!({
                                "aggregateId": aggregate.id,
                                "status": "failed",
                                "failureCode": "acknowledgement_app_unresolved",
                            }),
                            None,
                        ));
                    }
                    let pending = append_pending_camp_binding(
                        transaction,
                        &aggregate.id,
                        &frozen,
                        &conversation,
                        &now,
                    )?;
                    mark_aggregate_finalized(transaction, &aggregate.id, &now_text)?;
                    return Ok(CommandHandlerResult::applied(
                        "channel.binding.pending",
                        json!({
                            "aggregateId": aggregate.id,
                            "pendingBindingId": pending.pending_binding_id,
                            "pendingMessagePosition": pending.queue_position,
                            "projectCardQueued": pending.created,
                            "acknowledgementAppId": pending.acknowledgement_app_id,
                        }),
                        Some(EntityReference {
                            entity_type: "pending_camp_binding".to_string(),
                            entity_id: pending.pending_binding_id,
                        }),
                    ));
                }
            }

            let mut binding = binding.context("channel binding creation failed")?;
            if binding.camp_id.is_none() {
                let initial_members = if matches!(
                    binding.conversation_kind.as_str(),
                    "group" | "topic"
                ) {
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
                camp_created = true;
            }
            let camp_id = binding
                .camp_id
                .clone()
                .context("channel binding Camp creation did not persist an identity")?;
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
                    WHERE camp_id = ?1 AND source_namespace = (
                        SELECT conversation.provider
                        FROM channel_conversation_binding AS source_binding
                        JOIN channel_conversation AS conversation
                          ON conversation.id = source_binding.channel_conversation_id
                        WHERE source_binding.id = ?2
                    )
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
            let (request_id, queue_position) = insert_channel_turn_request(
                transaction,
                &binding.binding_id,
                &camp_id,
                &aggregate.id,
                &frozen.principal_id,
                &frozen.acknowledgement_app_id,
                &frozen.structured_content,
                &frozen.target_agent_ids,
                &now_text,
            )?;
            mark_aggregate_finalized(transaction, &aggregate.id, &now_text)?;
            let admission = if queue_position == 1 {
                try_admit_request(transaction, &request_id, &now_text, &envelope.command_id)?
            } else {
                AdmissionAttempt::Deferred
            };
            if matches!(admission, AdmissionAttempt::Deferred) {
                insert_queue_ack_delivery(
                    transaction,
                    &request_id,
                    &frozen.acknowledgement_app_id,
                    queue_position,
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
                    "campCreated": camp_created,
                    "queuePosition": queue_position,
                    "status": request_status,
                }),
                Some(EntityReference {
                    entity_type: "channel_turn_request".to_string(),
                    entity_id: request_id,
                }),
            ))
        })
    }

    pub fn resolve_pending_camp_binding(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ResolvePendingCampBindingCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(&envelope.payload.pending_binding_id, "pendingBindingId")?;
        validate_nonempty(&envelope.payload.app_id, "appId")?;
        validate_nonempty(
            &envelope.payload.external_picker_message_id,
            "externalPickerMessageId",
        )?;
        validate_nonempty(&envelope.payload.nonce, "nonce")?;
        if envelope.payload.expected_version < 1 {
            anyhow::bail!("expectedVersion must be positive");
        }
        if !matches!(
            envelope.payload.action.as_str(),
            "bind" | "cancel" | "refresh"
        ) {
            anyhow::bail!("action must be bind, cancel, or refresh");
        }
        if envelope.payload.action == "bind" && envelope.payload.project_id.is_none() {
            anyhow::bail!("bind action requires projectId");
        }
        for (value, field) in [
            (envelope.payload.operator_open_id.as_ref(), "operatorOpenId"),
            (envelope.payload.operator_user_id.as_ref(), "operatorUserId"),
            (
                envelope.payload.operator_union_id.as_ref(),
                "operatorUnionId",
            ),
        ] {
            if let Some(value) = value {
                validate_nonempty(value, field)?;
            }
        }
        refresh_project_catalog(database)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can resolve a project card",
                ));
            }
            let pending =
                load_pending_binding_resolution(transaction, &envelope.payload.pending_binding_id)?;
            let Some(pending) = pending else {
                return Ok(rejected(
                    "channel.binding.not_found",
                    "Pending Camp binding does not exist",
                ));
            };
            if !is_channel_host_for_provider(&envelope.actor, &pending.conversation.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can resolve a project card",
                ));
            }
            validate_owner_identity_input(
                &pending.conversation.provider,
                &envelope.payload.app_id,
                &pending.conversation.tenant_key,
                envelope.payload.operator_open_id.as_deref(),
                envelope.payload.operator_user_id.as_deref(),
                envelope.payload.operator_union_id.as_deref(),
            )?;
            if pending.acknowledgement_app_id != envelope.payload.app_id {
                return Ok(rejected(
                    "channel.binding.callback_app_mismatch",
                    "The callback did not arrive through the frozen acknowledgement Bot",
                ));
            }
            let now = Utc::now();
            let now_text = now.to_rfc3339();
            if !operator_matches_channel_owner(
                transaction,
                &pending.conversation.provider,
                &envelope.payload.app_id,
                &pending.owner_principal_id,
                envelope.payload.operator_open_id.as_deref(),
                envelope.payload.operator_user_id.as_deref(),
                envelope.payload.operator_union_id.as_deref(),
                &now_text,
            )? {
                return Ok(rejected(
                    "channel.binding.owner_required",
                    "Only the verified Rovai owner can operate this project card",
                ));
            }
            if pending.status != "pending" {
                return Ok(CommandHandlerResult::rejected(
                    "channel.binding.stale_card",
                    json!({
                        "message": "This project card has already been handled",
                        "status": pending.status,
                        "currentVersion": pending.version,
                    }),
                ));
            }
            if pending.authoritative_picker_message_id.as_deref()
                != Some(envelope.payload.external_picker_message_id.as_str())
            {
                return Ok(CommandHandlerResult::rejected(
                    "channel.binding.stale_card",
                    json!({
                        "message": "This project card is not authoritative",
                        "currentVersion": pending.version,
                    }),
                ));
            }
            if pending.version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "channel.binding.stale_card",
                    json!({
                        "message": "This project card version is stale",
                        "currentVersion": pending.version,
                    }),
                ));
            }
            if pending.nonce_digest
                != opaque_digest("pending-binding-nonce", &envelope.payload.nonce)
            {
                return Ok(rejected(
                    "channel.binding.invalid_nonce",
                    "Project card nonce is invalid",
                ));
            }
            if now >= chrono::DateTime::parse_from_rfc3339(&pending.expires_at)?.with_timezone(&Utc)
            {
                insert_project_picker_recall_delivery(
                    transaction,
                    &pending.id,
                    &pending.acknowledgement_app_id,
                    &envelope.payload.external_picker_message_id,
                    pending.version,
                    &now_text,
                )?;
                transaction.execute(
                    r#"
                    UPDATE pending_camp_binding
                    SET status = 'expired', resolved_at = ?2,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1 AND status = 'pending' AND version = ?3
                    "#,
                    params![pending.id, now_text, pending.version],
                )?;
                return Ok(CommandHandlerResult::applied(
                    "channel.binding.expired",
                    json!({ "pendingBindingId": pending.id }),
                    None,
                ));
            }
            if envelope.payload.action == "refresh" {
                let (next_version, project_options) =
                    rotate_pending_project_picker(transaction, &pending, None, &now_text)?;
                return Ok(CommandHandlerResult::applied(
                    "channel.binding.refreshed",
                    json!({
                        "pendingBindingId": pending.id,
                        "expectedVersion": next_version,
                        "projectOptions": project_options,
                        "pickerRefreshQueued": true,
                    }),
                    None,
                ));
            }
            if envelope.payload.action == "cancel" {
                let changed = transaction.execute(
                    r#"
                    UPDATE pending_camp_binding
                    SET status = 'cancelled', resolved_at = ?2,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1 AND status = 'pending' AND version = ?3
                    "#,
                    params![pending.id, now_text, pending.version],
                )?;
                if changed != 1 {
                    return Ok(rejected(
                        "channel.binding.stale_card",
                        "Pending Camp binding changed before cancellation",
                    ));
                }
                insert_project_picker_recall_delivery(
                    transaction,
                    &pending.id,
                    &pending.acknowledgement_app_id,
                    &envelope.payload.external_picker_message_id,
                    pending.version,
                    &now_text,
                )?;
                return Ok(CommandHandlerResult::applied(
                    "channel.binding.cancelled",
                    json!({
                        "pendingBindingId": pending.id,
                        "version": pending.version + 1,
                    }),
                    None,
                ));
            }

            let project_id = envelope
                .payload
                .project_id
                .as_deref()
                .context("bind action omitted projectId")?;
            let project = transaction
                .query_row(
                    r#"
                    SELECT id, display_name, canonical_path
                    FROM project_catalog_item
                    WHERE id = ?1 AND status = 'active'
                    "#,
                    [project_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((project_id, project_display_name, canonical_path)) = project else {
                let (next_version, project_options) = rotate_pending_project_picker(
                    transaction,
                    &pending,
                    Some("project_unavailable"),
                    &now_text,
                )?;
                return Ok(CommandHandlerResult::rejected(
                    "channel.project_unavailable",
                    json!({
                        "message": "The selected Rovai project is no longer available",
                        "pendingBindingId": pending.id,
                        "expectedVersion": next_version,
                        "projectOptions": project_options,
                        "pickerRefreshQueued": true,
                    }),
                ));
            };
            if !Path::new(&canonical_path).is_dir() {
                let (next_version, project_options) = rotate_pending_project_picker(
                    transaction,
                    &pending,
                    Some("project_unavailable"),
                    &now_text,
                )?;
                return Ok(CommandHandlerResult::rejected(
                    "channel.project_unavailable",
                    json!({
                        "message": "The selected Rovai project directory is unavailable",
                        "pendingBindingId": pending.id,
                        "expectedVersion": next_version,
                        "projectOptions": project_options,
                        "pickerRefreshQueued": true,
                    }),
                ));
            }
            let active_binding_exists: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM channel_conversation_binding
                    WHERE channel_conversation_id = ?1 AND status = 'active'
                )
                "#,
                [&pending.conversation.id],
                |row| row.get(0),
            )?;
            if active_binding_exists {
                return Ok(rejected(
                    "channel.binding.already_resolved",
                    "This channel conversation already has an immutable Camp binding",
                ));
            }
            let messages = load_pending_messages(transaction, &pending.id)?;
            if messages.is_empty() {
                anyhow::bail!("pending Camp binding has no frozen messages");
            }
            let mut all_targets = BTreeSet::new();
            for message in &messages {
                all_targets.extend(message.target_agent_ids.iter().cloned());
            }
            let expected_apps =
                app_ids_for_agents(transaction, &pending.conversation.provider, &all_targets)?;
            let roster_agent_ids =
                match group_roster_readiness(transaction, &pending.conversation, &expected_apps)? {
                    GroupRosterReadiness::Ready(agent_ids) => agent_ids,
                    GroupRosterReadiness::MissingState => {
                        return Ok(rejected(
                            "channel.roster_sync_required",
                            "The channel group Bot roster must be reconciled before binding",
                        ));
                    }
                    GroupRosterReadiness::MissingApps(_) => {
                        return Ok(rejected(
                            "channel.bot_not_in_roster",
                            "A selected message target Bot is no longer in the channel group",
                        ));
                    }
                    GroupRosterReadiness::NotRequired => Vec::new(),
                };
            let changed = transaction.execute(
                r#"
                UPDATE pending_camp_binding
                SET status = 'resolving', version = version + 1, updated_at = ?2
                WHERE id = ?1 AND status = 'pending' AND version = ?3
                "#,
                params![pending.id, now_text, pending.version],
            )?;
            if changed != 1 {
                return Ok(rejected(
                    "channel.binding.stale_card",
                    "Pending Camp binding changed before resolution",
                ));
            }
            let generation: i64 = transaction.query_row(
                r#"
                SELECT COALESCE(MAX(generation), 0) + 1
                FROM channel_conversation_binding
                WHERE channel_conversation_id = ?1
                "#,
                [&pending.conversation.id],
                |row| row.get(0),
            )?;
            let binding_id = format!("rvcb_{}", Uuid::new_v4().simple());
            transaction.execute(
                r#"
                INSERT INTO channel_conversation_binding(
                    id, channel_conversation_id, execution_scope_kind,
                    project_id, camp_id, status, generation, version,
                    created_at, updated_at, closed_at
                ) VALUES (?1, ?2, 'project', ?3, NULL, 'active', ?4, 1, ?5, ?5, NULL)
                "#,
                params![
                    binding_id,
                    pending.conversation.id,
                    project_id,
                    generation,
                    now_text
                ],
            )?;
            let mut binding = ChannelBindingAdmission {
                binding_id: binding_id.clone(),
                camp_id: None,
                project_display_name: project_display_name.clone(),
                binding_kind: "directory".to_string(),
                canonical_path,
                project_status: Some("active".to_string()),
                conversation_display_name: pending.conversation.display_name.clone(),
                conversation_kind: pending.conversation.conversation_kind.clone(),
            };
            let initial_members = if matches!(binding.conversation_kind.as_str(), "group" | "topic")
            {
                roster_agent_ids
            } else {
                all_targets.iter().cloned().collect()
            };
            let camp_id = create_channel_camp(transaction, &binding, &initial_members, &now_text)?;
            binding.camp_id = Some(camp_id.clone());
            let mut queued = Vec::new();
            for message in &messages {
                let (request_id, queue_position) = insert_channel_turn_request(
                    transaction,
                    &binding_id,
                    &camp_id,
                    &message.aggregate_id,
                    &message.external_principal_id,
                    &message.ack_app_id,
                    &message.structured_content,
                    &message.target_agent_ids,
                    &now_text,
                )?;
                queued.push((request_id, queue_position, message.ack_app_id.clone()));
            }
            for (index, (request_id, queue_position, ack_app_id)) in queued.iter().enumerate() {
                let admission = if index == 0 {
                    try_admit_request(transaction, request_id, &now_text, &envelope.command_id)?
                } else {
                    AdmissionAttempt::Deferred
                };
                if matches!(admission, AdmissionAttempt::Deferred) {
                    insert_queue_ack_delivery(
                        transaction,
                        request_id,
                        ack_app_id,
                        *queue_position,
                        &now_text,
                    )?;
                }
            }
            let resolved = transaction.execute(
                r#"
                UPDATE pending_camp_binding
                SET status = 'resolved', project_id = ?2, binding_id = ?3,
                    camp_id = ?4, resolved_at = ?5,
                    version = version + 1, updated_at = ?5
                WHERE id = ?1 AND status = 'resolving' AND version = ?6
                "#,
                params![
                    pending.id,
                    project_id,
                    binding_id,
                    camp_id,
                    now_text,
                    pending.version + 1,
                ],
            )?;
            if resolved != 1 {
                anyhow::bail!("pending Camp binding resolution lost its atomic state");
            }
            insert_project_picker_recall_delivery(
                transaction,
                &pending.id,
                &pending.acknowledgement_app_id,
                &envelope.payload.external_picker_message_id,
                pending.version,
                &now_text,
            )?;
            Ok(CommandHandlerResult::accepted(
                "channel.binding.resolved",
                json!({
                    "pendingBindingId": pending.id,
                    "projectId": project_id,
                    "projectDisplayName": project_display_name,
                    "bindingId": binding_id,
                    "campId": camp_id,
                    "campCreated": true,
                    "promotedMessageCount": queued.len(),
                    "version": pending.version + 2,
                }),
                Some(EntityReference {
                    entity_type: "channel_conversation_binding".to_string(),
                    entity_id: binding_id,
                }),
            ))
        })
    }

    pub fn authorize_execution_console_page(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AuthorizeChannelExecutionConsolePageCommand>,
    ) -> Result<CommandExecution> {
        validate_nonempty(&envelope.payload.agent_run_id, "agentRunId")?;
        validate_nonempty(&envelope.payload.app_id, "appId")?;
        validate_nonempty(&envelope.payload.external_message_id, "externalMessageId")?;
        if envelope.payload.snapshot_sequence < 1 {
            anyhow::bail!("snapshotSequence must be positive");
        }
        if !(1..=10_000).contains(&envelope.payload.page_count) {
            anyhow::bail!("pageCount must be between 1 and 10000");
        }
        if envelope.payload.page_index < 0
            || envelope.payload.page_index >= envelope.payload.page_count
        {
            anyhow::bail!("pageIndex must address an available execution console page");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can authorize an execution console page",
                ));
            }
            let projection = transaction
                .query_row(
                    r#"
                    SELECT channel_conversation.provider,
                           console.target_app_id, console.external_message_id,
                           console.latest_sequence, console.state,
                           COALESCE(
                               feishu_owner.canonical_owner_principal_id,
                               dingtalk_owner.canonical_owner_principal_id
                           )
                    FROM channel_execution_console AS console
                    JOIN channel_turn_request AS request ON request.id = console.request_id
                    JOIN channel_conversation_binding AS binding ON binding.id = request.binding_id
                    JOIN channel_conversation
                      ON channel_conversation.id = binding.channel_conversation_id
                    LEFT JOIN channel_member_bot_directory AS bot
                      ON bot.provider = channel_conversation.provider
                     AND bot.app_id = console.target_app_id AND bot.status = 'published'
                    LEFT JOIN feishu_owner_identity AS feishu_owner
                      ON channel_conversation.provider = 'feishu'
                     AND feishu_owner.account_id = bot.account_id
                    LEFT JOIN dingtalk_owner_identity AS dingtalk_owner
                      ON channel_conversation.provider = 'dingtalk'
                     AND dingtalk_owner.account_id = bot.account_id
                    WHERE console.agent_run_id = ?1
                    "#,
                    [&envelope.payload.agent_run_id],
                    |row| {
                        Ok(ExecutionConsolePageProjection {
                            provider: row.get(0)?,
                            target_app_id: row.get(1)?,
                            external_message_id: row.get(2)?,
                            latest_sequence: row.get(3)?,
                            state: row.get(4)?,
                            owner_principal_id: row.get(5)?,
                        })
                    },
                )
                .optional()?;
            let Some(projection) = projection else {
                return Ok(rejected(
                    "channel.execution_console.not_found",
                    "Execution console does not exist",
                ));
            };
            if !is_channel_host_for_provider(&envelope.actor, &projection.provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can authorize an execution console page",
                ));
            }
            validate_owner_identity_input(
                &projection.provider,
                &envelope.payload.app_id,
                "callback",
                envelope.payload.operator_open_id.as_deref(),
                envelope.payload.operator_user_id.as_deref(),
                envelope.payload.operator_union_id.as_deref(),
            )?;
            if projection.target_app_id != envelope.payload.app_id {
                return Ok(rejected(
                    "channel.execution_console.callback_app_mismatch",
                    "The callback did not arrive through the execution console Bot",
                ));
            }
            if projection.external_message_id.as_deref()
                != Some(envelope.payload.external_message_id.as_str())
            {
                return Ok(rejected(
                    "channel.execution_console.stale_card",
                    "This execution console card is no longer authoritative",
                ));
            }
            let Some(owner_principal_id) = projection.owner_principal_id.as_deref() else {
                return Ok(rejected(
                    "channel.execution_console.owner_required",
                    "Only the verified Rovai Owner can operate this execution console card",
                ));
            };
            let now = Utc::now().to_rfc3339();
            if !operator_matches_channel_owner(
                transaction,
                &projection.provider,
                &envelope.payload.app_id,
                owner_principal_id,
                envelope.payload.operator_open_id.as_deref(),
                envelope.payload.operator_user_id.as_deref(),
                envelope.payload.operator_union_id.as_deref(),
                &now,
            )? {
                return Ok(rejected(
                    "channel.execution_console.owner_required",
                    "Only the verified Rovai Owner can operate this execution console card",
                ));
            }
            if projection.state != "terminal_sealed"
                || projection.latest_sequence != envelope.payload.snapshot_sequence
            {
                return Ok(CommandHandlerResult::rejected(
                    "channel.execution_console.stale_card",
                    json!({
                        "message": "Execution console snapshot has changed or is not sealed",
                        "currentSnapshotSequence": projection.latest_sequence,
                    }),
                ));
            }
            Ok(CommandHandlerResult::accepted(
                "channel.execution_console.page_authorized",
                json!({
                    "agentRunId": envelope.payload.agent_run_id,
                    "pageIndex": envelope.payload.page_index,
                    "pageCount": envelope.payload.page_count,
                    "snapshotSequence": projection.latest_sequence,
                    "externalMessageId": envelope.payload.external_message_id,
                }),
                Some(EntityReference {
                    entity_type: "channel_execution_console".to_string(),
                    entity_id: envelope.payload.agent_run_id.clone(),
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
        let provider = channel_host_provider(&envelope.actor)
            .context("Channel Host actor does not identify a supported provider")?;
        self.gateway.execute(database, envelope, |transaction| {
            if !is_channel_host(&envelope.actor) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only a trusted Channel Host can run the outbox pump",
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
                  AND provider = ?2
                  AND canonical_mentions_complete = 0
                  AND (
                      provider = 'dingtalk'
                      OR EXISTS (
                          SELECT 1
                          FROM json_each(channel_inbound_aggregate.expected_app_ids_json) AS expected
                          WHERE NOT EXISTS (
                              SELECT 1
                              FROM json_each(channel_inbound_aggregate.observed_app_ids_json) AS observed
                              WHERE observed.value = expected.value
                          )
                      )
                  )
                "#,
                params![now_text, provider],
            )?;
            reconcile_obsolete_project_picker_card_revision(transaction, &now_text)?;
            reconcile_pending_project_picker_placement(transaction, &now_text)?;
            expire_pending_project_pickers(transaction, &now_text)?;
            decline_unattended_channel_retries(transaction, &envelope.actor, &now_text)?;
            project_active_request_deliveries(transaction, &now_text)?;
            settle_terminal_requests(transaction, &now_text)?;
            promote_ready_requests(transaction, &now_text, &envelope.command_id)?;
            let claims = claim_deliveries(
                transaction,
                provider,
                &envelope.payload.worker_id,
                envelope.payload.limit,
                &now,
            )?;
            let roster_refreshes = if provider == FEISHU_PROVIDER {
                crate::message_delivery::pending_topic_roster_refreshes(transaction)?
            } else {
                Vec::new()
            };
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
                  AND NOT EXISTS (
                      SELECT 1 FROM pending_camp_message
                      WHERE aggregate_id = channel_inbound_aggregate.id
                  )
                "#,
                [&retention_boundary],
            )?;
            Ok(CommandHandlerResult::applied(
                "channel.host.tick_completed",
                json!({
                    "deliveries": claims,
                    "rosterRefreshes": roster_refreshes,
                }),
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
                    "Only a trusted Channel Host can settle deliveries",
                ));
            }
            let state = transaction
                .query_row(
                    r#"
                    SELECT delivery.status, delivery.lease_owner,
                           delivery.attempt_count, delivery.delivery_kind,
                           delivery.console_id, delivery.request_id,
                           delivery.payload_json, delivery.target_app_id,
                           delivery.source_agent_id,
                           delivery.source_camp_message_id,
                           COALESCE(
                               request_conversation.provider,
                               pending_conversation.provider
                           )
                    FROM channel_delivery AS delivery
                    LEFT JOIN channel_turn_request AS request
                      ON request.id = delivery.request_id
                    LEFT JOIN channel_conversation_binding AS request_binding
                      ON request_binding.id = request.binding_id
                    LEFT JOIN channel_conversation AS request_conversation
                      ON request_conversation.id = request_binding.channel_conversation_id
                    LEFT JOIN pending_camp_binding AS pending
                      ON pending.id = delivery.pending_binding_id
                    LEFT JOIN channel_conversation AS pending_conversation
                      ON pending_conversation.id = pending.channel_conversation_id
                    WHERE delivery.id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, String>(10)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                status,
                lease_owner,
                attempt_count,
                delivery_kind,
                console_id,
                request_id,
                payload_json,
                target_app_id,
                source_agent_id,
                source_camp_message_id,
                provider,
            )) = state
            else {
                return Ok(rejected(
                    "channel.delivery.not_found",
                    "Channel delivery does not exist",
                ));
            };
            if !is_channel_host_for_provider(&envelope.actor, &provider) {
                return Ok(rejected(
                    "channel.host_required",
                    "Only this provider's trusted Channel Host can settle deliveries",
                ));
            }
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
            let payload: Value = serde_json::from_str(&payload_json)
                .context("stored channel delivery payload is invalid")?;
            match delivery_kind.as_str() {
                "execution_console_upsert" if envelope.payload.outcome == "sent" => {
                    let console_id = console_id
                        .as_deref()
                        .context("execution console upsert has no console identity")?;
                    let expected_sequence = payload
                        .get("expectedSequence")
                        .and_then(Value::as_i64)
                        .context("execution console upsert has no expected sequence")?;
                    if let Some(external_message_id) =
                        envelope.payload.external_delivery_message_id.as_deref()
                    {
                        let updated = transaction.execute(
                            r#"
                            UPDATE channel_execution_console
                            SET external_message_id = COALESCE(external_message_id, ?2),
                                delivered_sequence = MAX(
                                    delivered_sequence,
                                    MIN(latest_sequence, ?3)
                                ),
                                failure_code = NULL, updated_at = ?4
                            WHERE id = ?1
                              AND (external_message_id IS NULL OR external_message_id = ?2)
                            "#,
                            params![console_id, external_message_id, expected_sequence, now_text],
                        )?;
                        if updated != 1 {
                            anyhow::bail!(
                                "execution console external message identity changed unexpectedly"
                            );
                        }
                    }
                }
                "execution_console_upsert" => {
                    let console_id = console_id
                        .as_deref()
                        .context("execution console upsert has no console identity")?;
                    transaction.execute(
                        r#"
                        UPDATE channel_execution_console
                        SET failure_code = ?2, updated_at = ?3
                        WHERE id = ?1
                        "#,
                        params![console_id, envelope.payload.failure_code, now_text],
                    )?;
                }
                "execution_console_recall" => {
                    let console_id = console_id
                        .as_deref()
                        .context("execution console recall has no console identity")?;
                    if envelope.payload.outcome == "sent" {
                        transaction.execute(
                            r#"
                            UPDATE channel_execution_console
                            SET state = 'recalled', failure_code = NULL,
                                recalled_at = ?2, updated_at = ?2
                            WHERE id = ?1 AND state <> 'recalled'
                            "#,
                            params![console_id, now_text],
                        )?;
                    } else {
                        transaction.execute(
                            r#"
                            UPDATE channel_execution_console
                            SET state = 'recall_failed', failure_code = ?2,
                                recalled_at = ?3, updated_at = ?3
                            WHERE id = ?1 AND state <> 'recalled'
                            "#,
                            params![console_id, envelope.payload.failure_code, now_text],
                        )?;
                    }
                }
                "agent_attachment" if envelope.payload.outcome == "failed" => {
                    let request_id = request_id
                        .as_deref()
                        .context("agent attachment delivery has no request identity")?;
                    let acknowledgement_app_id: String = transaction.query_row(
                        "SELECT ack_app_id FROM channel_turn_request WHERE id = ?1",
                        [request_id],
                        |row| row.get(0),
                    )?;
                    let file_name = payload
                        .get("fileName")
                        .and_then(Value::as_str)
                        .unwrap_or("附件");
                    insert_delivery(
                        transaction,
                        request_id,
                        &format!(
                            "attention:agent_attachment:{}",
                            envelope.payload.delivery_id
                        ),
                        "attention",
                        &acknowledgement_app_id,
                        source_agent_id.as_deref(),
                        source_camp_message_id.as_deref(),
                        &json!({
                            "kind": "attention",
                            "failureCode": envelope.payload.failure_code.as_deref()
                                .unwrap_or("channel_attachment_delivery_failed"),
                            "text": format!("附件「{file_name}」发送失败；正文及其他附件不会重复发送。"),
                            "failedTargetAppId": target_app_id,
                        }),
                        &now_text,
                    )?;
                }
                _ => {}
            }
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
        JOIN channel_member_bot_directory AS bot
          ON bot.provider = roster.provider
         AND bot.app_id = roster.app_id AND bot.agent_id = roster.agent_id
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
            JOIN channel_member_bot_directory AS bot
              ON bot.agent_id = member.agent_id
             AND bot.provider = ?2
            WHERE member.camp_id = ?1 AND member.status = 'active'
              AND member.leave_requested_at IS NULL
            ORDER BY member.agent_id
            "#,
            params![camp.camp_id, provider],
            |row| row.get::<_, String>(0),
        )?
        .into_iter()
        .collect::<BTreeSet<_>>();

        for agent_id in desired_agents.difference(&active_managed_agents) {
            let (membership_generation, reconciliation_generation) =
                channel_membership_generations(
                    database,
                    provider,
                    &camp.camp_id,
                    &camp.binding_id,
                )?;
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
                            namespace: provider.to_string(),
                            binding_id: camp.binding_id.clone(),
                            reconciliation_generation,
                        }),
                    },
                },
            )?;
            if execution.result.status == CommandResultStatus::Rejected {
                anyhow::bail!(
                    "channel roster member add rejected: {}",
                    execution.result.code
                );
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
            if camp.conversation_kind == "topic" && preview.non_terminal_agent_run_count > 0 {
                // A remote roster change controls future admission. It must
                // never cancel an AgentRun whose execution context was already
                // frozen. A later reconciliation finalizes the membership once
                // those Runs have reached terminal state.
                continue;
            }
            let (_, reconciliation_generation) = channel_membership_generations(
                database,
                provider,
                &camp.camp_id,
                &camp.binding_id,
            )?;
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
                        reason: Some(format!("removed_from_{provider}_group")),
                        source: Some(CampMembershipMutationSource {
                            namespace: provider.to_string(),
                            binding_id: camp.binding_id.clone(),
                            reconciliation_generation,
                        }),
                    },
                },
            )?;
            if execution.result.status == CommandResultStatus::Rejected {
                anyhow::bail!(
                    "channel roster member removal rejected: {}",
                    execution.result.code
                );
            }
        }
    }
    Ok(())
}

fn channel_membership_generations(
    database: &Database,
    provider: &str,
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
             AND source.source_namespace = ?2
             AND source.binding_id = ?3
             AND source.trusted_component_id = ?4
            WHERE camp.id = ?1
            "#,
            params![
                camp_id,
                provider,
                binding_id,
                CHANNEL_MEMBERSHIP_SYNC_COMPONENT
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("channel Camp membership source binding is missing")
}

#[derive(Debug)]
struct CollectingAggregate {
    id: String,
    provider: String,
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
    principal_id: String,
    binding_id_at_observation: Option<String>,
    structured_content: StructuredCampMessageContent,
    target_agent_ids: Vec<String>,
    acknowledgement_app_id: String,
}

#[derive(Debug)]
struct ChannelBindingAdmission {
    binding_id: String,
    camp_id: Option<String>,
    project_display_name: String,
    binding_kind: String,
    canonical_path: String,
    project_status: Option<String>,
    conversation_display_name: String,
    conversation_kind: String,
}

#[derive(Debug, Clone)]
struct ChannelConversationAdmission {
    id: String,
    provider: String,
    display_name: String,
    tenant_key: String,
    chat_id: String,
    conversation_kind: String,
}

#[derive(Debug)]
enum GroupRosterReadiness {
    NotRequired,
    MissingState,
    MissingApps(Vec<String>),
    Ready(Vec<String>),
}

#[derive(Debug)]
struct PendingBindingAppend {
    pending_binding_id: String,
    queue_position: i64,
    acknowledgement_app_id: String,
    created: bool,
}

#[derive(Debug)]
struct PendingBindingResolution {
    id: String,
    owner_principal_id: String,
    acknowledgement_app_id: String,
    authoritative_picker_message_id: Option<String>,
    status: String,
    version: i64,
    nonce_digest: String,
    expires_at: String,
    conversation: ChannelConversationAdmission,
}

#[derive(Debug)]
struct ExecutionConsolePageProjection {
    provider: String,
    target_app_id: String,
    external_message_id: Option<String>,
    latest_sequence: i64,
    state: String,
    owner_principal_id: Option<String>,
}

#[derive(Debug)]
struct PendingMessageRecord {
    aggregate_id: String,
    external_principal_id: String,
    ack_app_id: String,
    structured_content: StructuredCampMessageContent,
    target_agent_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCardItem {
    project_id: String,
    display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum FeishuOwnerClassification {
    Owner { principal_id: String },
    NonOwner,
    Unverified,
}

fn load_collecting_aggregate(
    transaction: &Transaction<'_>,
    aggregate_id: &str,
) -> Result<Option<CollectingAggregate>> {
    transaction
        .query_row(
            r#"
            SELECT id, provider, expected_app_ids_json, observed_app_ids_json,
                   canonical_mentions_complete, frozen_payload_json, deadline_at
            FROM channel_inbound_aggregate
            WHERE id = ?1 AND status = 'collecting'
            "#,
            [aggregate_id],
            |row| {
                Ok(CollectingAggregate {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    expected_app_ids_json: row.get(2)?,
                    observed_app_ids_json: row.get(3)?,
                    canonical_mentions_complete: row.get(4)?,
                    frozen_payload_json: row.get(5)?,
                    deadline_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn refresh_project_catalog(database: &mut Database) -> Result<()> {
    let projects = query_rows(
        database.connection(),
        r#"
        SELECT project_path, MAX(updated_at)
        FROM camp
        WHERE project_binding_kind = 'directory'
        GROUP BY project_path
        ORDER BY MAX(updated_at) DESC, project_path
        "#,
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = Utc::now().to_rfc3339();
    let current_paths_json =
        serde_json::to_string(&projects.iter().map(|(path, _)| path).collect::<Vec<_>>())?;
    transaction.execute(
        r#"
        UPDATE project_catalog_item
        SET status = 'archived', version = version + 1, updated_at = ?1
        WHERE status <> 'archived'
          AND canonical_path NOT IN (SELECT value FROM json_each(?2))
        "#,
        params![now, current_paths_json],
    )?;
    for (canonical_path, last_opened_at) in projects {
        let path = Path::new(&canonical_path);
        let display_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("未命名项目")
            .to_string();
        let status = if path.is_dir() {
            "active"
        } else {
            "unavailable"
        };
        transaction.execute(
            r#"
            INSERT INTO project_catalog_item(
                id, canonical_path, display_name, status, last_opened_at,
                version, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
            ON CONFLICT(canonical_path) DO UPDATE SET
                display_name = excluded.display_name,
                status = excluded.status,
                last_opened_at = excluded.last_opened_at,
                version = CASE
                    WHEN project_catalog_item.display_name IS excluded.display_name
                     AND project_catalog_item.status IS excluded.status
                     AND project_catalog_item.last_opened_at IS excluded.last_opened_at
                    THEN project_catalog_item.version
                    ELSE project_catalog_item.version + 1
                END,
                updated_at = CASE
                    WHEN project_catalog_item.display_name IS excluded.display_name
                     AND project_catalog_item.status IS excluded.status
                     AND project_catalog_item.last_opened_at IS excluded.last_opened_at
                    THEN project_catalog_item.updated_at
                    ELSE excluded.updated_at
                END
            "#,
            params![
                format!("rvproj_{}", Uuid::new_v4().simple()),
                canonical_path,
                display_name,
                status,
                last_opened_at,
                now,
            ],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn active_project_card_items(transaction: &Transaction<'_>) -> Result<Vec<ProjectCardItem>> {
    query_rows(
        transaction,
        r#"
        SELECT id, display_name
        FROM project_catalog_item
        WHERE status = 'active'
        ORDER BY last_opened_at DESC, display_name, id
        "#,
        [],
        |row| {
            Ok(ProjectCardItem {
                project_id: row.get(0)?,
                display_name: row.get(1)?,
            })
        },
    )
}

fn opaque_digest(namespace: &str, value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(namespace.as_bytes());
    hasher.update([0]);
    hasher.update(value.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn validate_owner_identity_input(
    provider: &str,
    app_id: &str,
    tenant_key: &str,
    open_id: Option<&str>,
    user_id: Option<&str>,
    union_id: Option<&str>,
) -> Result<()> {
    if !matches!(provider, FEISHU_PROVIDER | DINGTALK_PROVIDER) {
        anyhow::bail!("provider must be feishu or dingtalk");
    }
    validate_nonempty(app_id, "appId")?;
    validate_nonempty(tenant_key, "tenantKey")?;
    if provider == DINGTALK_PROVIDER && user_id.is_none() {
        anyhow::bail!("a DingTalk sender userId is required");
    }
    if provider == FEISHU_PROVIDER && open_id.is_none() && user_id.is_none() && union_id.is_none() {
        anyhow::bail!("a Feishu sender identity is required");
    }
    for (value, field) in [
        (open_id, "openId"),
        (user_id, "userId"),
        (union_id, "unionId"),
    ] {
        if let Some(value) = value {
            validate_nonempty(value, field)?;
            if value.len() > 512 {
                anyhow::bail!("{field} is too long");
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn classify_and_record_feishu_owner(
    transaction: &Transaction<'_>,
    provider: &str,
    app_id: &str,
    tenant_key: &str,
    open_id: Option<&str>,
    user_id: Option<&str>,
    union_id: Option<&str>,
    display_name: &str,
    now: &str,
) -> Result<FeishuOwnerClassification> {
    if provider == DINGTALK_PROVIDER {
        return classify_and_record_dingtalk_owner(
            transaction,
            app_id,
            tenant_key,
            user_id,
            display_name,
            now,
        );
    }
    let identity = transaction
        .query_row(
            r#"
            SELECT bot.account_id, owner.canonical_owner_principal_id,
                   owner.user_id_digest, owner.union_id_digest,
                   app.open_id_digest, app.user_id_digest, app.union_id_digest,
                   principal.tenant_key
            FROM feishu_member_bot AS bot
            JOIN feishu_owner_identity AS owner ON owner.account_id = bot.account_id
            LEFT JOIN feishu_owner_app_identity AS app
              ON app.account_id = owner.account_id AND app.app_id = bot.app_id
            LEFT JOIN external_principal AS principal
              ON principal.id = owner.canonical_owner_principal_id
            WHERE bot.app_id = ?1 AND bot.status = 'published'
            "#,
            [app_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        account_id,
        principal_id,
        canonical_user_digest,
        canonical_union_digest,
        app_open_digest,
        app_user_digest,
        app_union_digest,
        frozen_tenant_key,
    )) = identity
    else {
        return Ok(FeishuOwnerClassification::Unverified);
    };
    if frozen_tenant_key
        .as_deref()
        .is_some_and(|expected| tenant_key != expected)
    {
        return Ok(FeishuOwnerClassification::Unverified);
    }
    let open_digest = open_id.map(|value| opaque_digest("feishu-open", value));
    let user_digest = user_id.map(|value| opaque_digest("feishu-user", value));
    let union_digest = union_id.map(|value| opaque_digest("feishu-union", value));
    let matches = user_digest.as_deref() == Some(canonical_user_digest.as_str())
        || union_digest.as_deref().is_some_and(|digest| {
            canonical_union_digest.as_deref() == Some(digest)
                || app_union_digest.as_deref() == Some(digest)
        })
        || open_digest
            .as_deref()
            .is_some_and(|digest| app_open_digest.as_deref() == Some(digest))
        || user_digest
            .as_deref()
            .is_some_and(|digest| app_user_digest.as_deref() == Some(digest));
    if !matches {
        return Ok(FeishuOwnerClassification::NonOwner);
    }
    let conflicts = canonical_union_digest
        .as_deref()
        .zip(union_digest.as_deref())
        .is_some_and(|(expected, actual)| expected != actual)
        || app_open_digest
            .as_deref()
            .zip(open_digest.as_deref())
            .is_some_and(|(expected, actual)| expected != actual)
        || app_user_digest
            .as_deref()
            .zip(user_digest.as_deref())
            .is_some_and(|(expected, actual)| expected != actual)
        || app_union_digest
            .as_deref()
            .zip(union_digest.as_deref())
            .is_some_and(|(expected, actual)| expected != actual);
    if conflicts {
        return Ok(FeishuOwnerClassification::Unverified);
    }
    transaction.execute(
        r#"
        UPDATE feishu_owner_identity
        SET union_id_digest = COALESCE(union_id_digest, ?2),
            verified_at = ?3, version = version + 1, updated_at = ?3
        WHERE account_id = ?1
        "#,
        params![account_id, union_digest, now],
    )?;
    transaction.execute(
        r#"
        INSERT INTO feishu_owner_app_identity(
            account_id, app_id, open_id_digest, user_id_digest,
            union_id_digest, verified_at, version, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?6, ?6)
        ON CONFLICT(account_id, app_id) DO UPDATE SET
            open_id_digest = COALESCE(excluded.open_id_digest, open_id_digest),
            user_id_digest = COALESCE(excluded.user_id_digest, user_id_digest),
            union_id_digest = COALESCE(excluded.union_id_digest, union_id_digest),
            verified_at = excluded.verified_at,
            version = feishu_owner_app_identity.version + 1,
            updated_at = excluded.updated_at
        "#,
        params![
            account_id,
            app_id,
            open_digest,
            user_digest,
            union_digest,
            now
        ],
    )?;
    let canonical_external_user_id = format!("owner:{account_id}");
    transaction.execute(
        r#"
        INSERT INTO external_principal(
            id, provider, tenant_key, external_user_id, display_name,
            version, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
        ON CONFLICT(id) DO UPDATE SET
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
            provider,
            tenant_key,
            canonical_external_user_id,
            display_name,
            now,
        ],
    )?;
    persist_external_principal_identities(
        transaction,
        &principal_id,
        provider,
        app_id,
        open_id,
        user_id,
        union_id,
        now,
    )?;
    Ok(FeishuOwnerClassification::Owner { principal_id })
}

fn classify_and_record_dingtalk_owner(
    transaction: &Transaction<'_>,
    app_key: &str,
    corp_id: &str,
    user_id: Option<&str>,
    display_name: &str,
    now: &str,
) -> Result<FeishuOwnerClassification> {
    let identity = transaction
        .query_row(
            r#"
            SELECT owner.account_id, owner.canonical_owner_principal_id,
                   owner.user_id_digest, app.user_id_digest, owner.corp_id
            FROM dingtalk_member_bot AS bot
            JOIN dingtalk_owner_identity AS owner ON owner.account_id = bot.account_id
            JOIN dingtalk_owner_app_identity AS app
              ON app.account_id = owner.account_id AND app.app_key = bot.app_key
            WHERE bot.app_key = ?1 AND bot.status = 'published'
            "#,
            [app_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((account_id, principal_id, owner_digest, app_digest, frozen_corp_id)) = identity
    else {
        return Ok(FeishuOwnerClassification::Unverified);
    };
    if frozen_corp_id != corp_id {
        return Ok(FeishuOwnerClassification::Unverified);
    }
    let Some(user_id) = user_id else {
        return Ok(FeishuOwnerClassification::Unverified);
    };
    let actual_digest = opaque_digest("dingtalk-user", user_id);
    if actual_digest != owner_digest {
        return Ok(FeishuOwnerClassification::NonOwner);
    }
    if actual_digest != app_digest {
        return Ok(FeishuOwnerClassification::Unverified);
    }
    transaction.execute(
        r#"
        UPDATE dingtalk_owner_identity
        SET version = version + 1, updated_at = ?2
        WHERE account_id = ?1
        "#,
        params![account_id, now],
    )?;
    let canonical_external_user_id = format!("owner:{account_id}");
    transaction.execute(
        r#"
        INSERT INTO external_principal(
            id, provider, tenant_key, external_user_id, display_name,
            version, created_at, updated_at
        ) VALUES (?1, 'dingtalk', ?2, ?3, ?4, 1, ?5, ?5)
        ON CONFLICT(id) DO UPDATE SET
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
            corp_id,
            canonical_external_user_id,
            display_name,
            now,
        ],
    )?;
    persist_external_principal_identities(
        transaction,
        &principal_id,
        DINGTALK_PROVIDER,
        app_key,
        None,
        Some(user_id),
        None,
        now,
    )?;
    Ok(FeishuOwnerClassification::Owner { principal_id })
}

#[allow(clippy::too_many_arguments)]
fn persist_external_principal_identities(
    transaction: &Transaction<'_>,
    principal_id: &str,
    provider: &str,
    app_id: &str,
    open_id: Option<&str>,
    user_id: Option<&str>,
    union_id: Option<&str>,
    now: &str,
) -> Result<()> {
    for (identity_kind, external_id) in [
        ("open_id", open_id),
        ("user_id", user_id),
        ("union_id", union_id),
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
                provider,
                app_id,
                identity_kind,
                external_id,
                now
            ],
        )?;
    }
    Ok(())
}

fn load_verified_owner_for_app(
    transaction: &Transaction<'_>,
    provider: &str,
    app_id: &str,
    tenant_key: &str,
) -> Result<Option<(String, String)>> {
    if provider == DINGTALK_PROVIDER {
        return transaction
            .query_row(
                r#"
                SELECT owner.canonical_owner_principal_id, principal.display_name
                FROM dingtalk_member_bot AS bot
                JOIN dingtalk_owner_identity AS owner ON owner.account_id = bot.account_id
                JOIN dingtalk_owner_app_identity AS app
                  ON app.account_id = owner.account_id AND app.app_key = bot.app_key
                JOIN external_principal AS principal
                  ON principal.id = owner.canonical_owner_principal_id
                WHERE bot.app_key = ?1 AND bot.status = 'published'
                  AND owner.corp_id = ?2 AND principal.tenant_key = ?2
                "#,
                params![app_id, tenant_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(Into::into);
    }
    transaction
        .query_row(
            r#"
            SELECT owner.canonical_owner_principal_id, principal.display_name
            FROM feishu_member_bot AS bot
            JOIN feishu_owner_identity AS owner ON owner.account_id = bot.account_id
            JOIN feishu_owner_app_identity AS app
              ON app.account_id = owner.account_id AND app.app_id = bot.app_id
            JOIN external_principal AS principal
              ON principal.id = owner.canonical_owner_principal_id
            WHERE bot.app_id = ?1 AND bot.status = 'published'
              AND principal.tenant_key = ?2
            "#,
            params![app_id, tenant_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
fn operator_matches_channel_owner(
    transaction: &Transaction<'_>,
    provider: &str,
    app_id: &str,
    expected_principal_id: &str,
    open_id: Option<&str>,
    user_id: Option<&str>,
    union_id: Option<&str>,
    now: &str,
) -> Result<bool> {
    if provider == DINGTALK_PROVIDER {
        let Some(user_id) = user_id else {
            return Ok(false);
        };
        let expected_digest = opaque_digest("dingtalk-user", user_id);
        let identity = transaction
            .query_row(
                r#"
                SELECT owner.account_id, owner.user_id_digest, app.user_id_digest
                FROM dingtalk_member_bot AS bot
                JOIN dingtalk_owner_identity AS owner ON owner.account_id = bot.account_id
                JOIN dingtalk_owner_app_identity AS app
                  ON app.account_id = owner.account_id AND app.app_key = bot.app_key
                WHERE bot.app_key = ?1 AND bot.status = 'published'
                  AND owner.canonical_owner_principal_id = ?2
                "#,
                params![app_id, expected_principal_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((account_id, owner_digest, app_digest)) = identity else {
            return Ok(false);
        };
        if expected_digest != owner_digest || expected_digest != app_digest {
            return Ok(false);
        }
        transaction.execute(
            "UPDATE dingtalk_owner_identity SET version = version + 1, updated_at = ?2 WHERE account_id = ?1",
            params![account_id, now],
        )?;
        persist_external_principal_identities(
            transaction,
            expected_principal_id,
            DINGTALK_PROVIDER,
            app_id,
            None,
            Some(user_id),
            None,
            now,
        )?;
        return Ok(true);
    }
    operator_matches_feishu_owner(
        transaction,
        app_id,
        expected_principal_id,
        open_id,
        user_id,
        union_id,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn operator_matches_feishu_owner(
    transaction: &Transaction<'_>,
    app_id: &str,
    expected_principal_id: &str,
    open_id: Option<&str>,
    _user_id: Option<&str>,
    union_id: Option<&str>,
    now: &str,
) -> Result<bool> {
    let identity = transaction
        .query_row(
            r#"
            SELECT owner.account_id, owner.union_id_digest,
                   app.open_id_digest, app.union_id_digest
            FROM feishu_member_bot AS bot
            JOIN feishu_owner_identity AS owner ON owner.account_id = bot.account_id
            JOIN feishu_owner_app_identity AS app
              ON app.account_id = owner.account_id AND app.app_id = bot.app_id
            WHERE bot.app_id = ?1 AND bot.status = 'published'
              AND owner.canonical_owner_principal_id = ?2
            "#,
            params![app_id, expected_principal_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((account_id, owner_union_digest, app_open_digest, app_union_digest)) = identity else {
        return Ok(false);
    };
    let open_digest = open_id.map(|value| opaque_digest("feishu-open", value));
    let union_digest = union_id.map(|value| opaque_digest("feishu-union", value));
    let matches = union_digest.as_deref().is_some_and(|digest| {
        owner_union_digest.as_deref() == Some(digest) || app_union_digest.as_deref() == Some(digest)
    }) || open_digest
        .as_deref()
        .is_some_and(|digest| app_open_digest.as_deref() == Some(digest));
    if !matches {
        return Ok(false);
    }
    if owner_union_digest
        .as_deref()
        .zip(union_digest.as_deref())
        .is_some_and(|(expected, actual)| expected != actual)
        || app_open_digest
            .as_deref()
            .zip(open_digest.as_deref())
            .is_some_and(|(expected, actual)| expected != actual)
        || app_union_digest
            .as_deref()
            .zip(union_digest.as_deref())
            .is_some_and(|(expected, actual)| expected != actual)
    {
        return Ok(false);
    }
    transaction.execute(
        r#"
        UPDATE feishu_owner_identity
        SET union_id_digest = COALESCE(union_id_digest, ?2),
            verified_at = ?3, version = version + 1, updated_at = ?3
        WHERE account_id = ?1
        "#,
        params![account_id, union_digest, now],
    )?;
    transaction.execute(
        r#"
        UPDATE feishu_owner_app_identity
        SET open_id_digest = COALESCE(open_id_digest, ?3),
            union_id_digest = COALESCE(union_id_digest, ?4),
            verified_at = ?5, version = version + 1, updated_at = ?5
        WHERE account_id = ?1 AND app_id = ?2
        "#,
        params![account_id, app_id, open_digest, union_digest, now],
    )?;
    persist_external_principal_identities(
        transaction,
        expected_principal_id,
        FEISHU_PROVIDER,
        app_id,
        open_id,
        None,
        union_id,
        now,
    )?;
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
fn upsert_channel_conversation(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    provider: &str,
    tenant_key: &str,
    chat_id: &str,
    topic_key: &str,
    bot_scope_app_id: &str,
    conversation_kind: &str,
    display_name: &str,
    sender_display_name: &str,
    sender_principal_id: Option<&str>,
    now: &str,
) -> Result<()> {
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
            provider,
            tenant_key,
            chat_id,
            topic_key,
            bot_scope_app_id,
            conversation_kind,
            display_name,
            sender_display_name,
            sender_principal_id,
            now,
        ],
    )?;
    Ok(())
}

fn load_channel_conversation(
    transaction: &Transaction<'_>,
    conversation_id: &str,
) -> Result<Option<ChannelConversationAdmission>> {
    transaction
        .query_row(
            r#"
            SELECT id, provider, display_name, tenant_key, chat_id, conversation_kind
            FROM channel_conversation
            WHERE id = ?1
            "#,
            [conversation_id],
            |row| {
                Ok(ChannelConversationAdmission {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    display_name: row.get(2)?,
                    tenant_key: row.get(3)?,
                    chat_id: row.get(4)?,
                    conversation_kind: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn group_roster_readiness(
    transaction: &Transaction<'_>,
    conversation: &ChannelConversationAdmission,
    expected_app_ids: &BTreeSet<String>,
) -> Result<GroupRosterReadiness> {
    if !matches!(conversation.conversation_kind.as_str(), "group" | "topic") {
        return Ok(GroupRosterReadiness::NotRequired);
    }
    let roster_state_exists: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM external_group_bot_roster_state
            WHERE provider = ?1 AND tenant_key = ?2 AND chat_id = ?3
        )
        "#,
        params![
            conversation.provider,
            conversation.tenant_key,
            conversation.chat_id
        ],
        |row| row.get(0),
    )?;
    if !roster_state_exists {
        return Ok(GroupRosterReadiness::MissingState);
    }
    let present_app_ids = query_rows(
        transaction,
        r#"
        SELECT app_id FROM external_group_bot_roster
        WHERE provider = ?1 AND tenant_key = ?2 AND chat_id = ?3
          AND status = 'present'
        ORDER BY app_id
        "#,
        params![
            conversation.provider,
            conversation.tenant_key,
            conversation.chat_id
        ],
        |row| row.get::<_, String>(0),
    )?
    .into_iter()
    .collect::<BTreeSet<_>>();
    let missing_apps = expected_app_ids
        .difference(&present_app_ids)
        .cloned()
        .collect::<Vec<_>>();
    if !missing_apps.is_empty() {
        return Ok(GroupRosterReadiness::MissingApps(missing_apps));
    }
    let present_agents = query_rows(
        transaction,
        r#"
        SELECT roster.agent_id
        FROM external_group_bot_roster AS roster
        JOIN channel_member_bot_directory AS bot
          ON bot.provider = roster.provider
         AND bot.app_id = roster.app_id AND bot.agent_id = roster.agent_id
        WHERE roster.provider = ?1
          AND roster.tenant_key = ?2 AND roster.chat_id = ?3
          AND roster.status = 'present' AND bot.status = 'published'
        ORDER BY roster.agent_id
        "#,
        params![
            conversation.provider,
            conversation.tenant_key,
            conversation.chat_id
        ],
        |row| row.get::<_, String>(0),
    )?;
    Ok(GroupRosterReadiness::Ready(present_agents))
}

fn load_active_channel_binding(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    exact_binding_id: Option<&str>,
    quick_chat_path: &str,
) -> Result<Option<ChannelBindingAdmission>> {
    transaction
        .query_row(
            r#"
            SELECT binding.id, binding.camp_id,
                   CASE binding.execution_scope_kind
                       WHEN 'quick_chat' THEN '快速对话'
                       ELSE project.display_name
                   END,
                   CASE binding.execution_scope_kind
                       WHEN 'quick_chat' THEN 'quick_chat'
                       ELSE 'directory'
                   END,
                   CASE binding.execution_scope_kind
                       WHEN 'quick_chat' THEN ?3
                       ELSE project.canonical_path
                   END,
                   project.status,
                   conversation.display_name, conversation.conversation_kind
            FROM channel_conversation_binding AS binding
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            LEFT JOIN project_catalog_item AS project ON project.id = binding.project_id
            WHERE binding.channel_conversation_id = ?1
              AND binding.status = 'active'
              AND (?2 IS NULL OR binding.id = ?2)
            "#,
            params![conversation_id, exact_binding_id, quick_chat_path],
            |row| {
                Ok(ChannelBindingAdmission {
                    binding_id: row.get(0)?,
                    camp_id: row.get(1)?,
                    project_display_name: row.get(2)?,
                    binding_kind: row.get(3)?,
                    canonical_path: row.get(4)?,
                    project_status: row.get(5)?,
                    conversation_display_name: row.get(6)?,
                    conversation_kind: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn create_quick_chat_binding(
    transaction: &Transaction<'_>,
    conversation: &ChannelConversationAdmission,
    target_agent_ids: &[String],
    quick_chat_path: &str,
    now: &str,
) -> Result<ChannelBindingAdmission> {
    let generation: i64 = transaction.query_row(
        r#"
        SELECT COALESCE(MAX(generation), 0) + 1
        FROM channel_conversation_binding
        WHERE channel_conversation_id = ?1
        "#,
        [&conversation.id],
        |row| row.get(0),
    )?;
    let binding_id = format!("rvcb_{}", Uuid::new_v4().simple());
    transaction.execute(
        r#"
        INSERT INTO channel_conversation_binding(
            id, channel_conversation_id, execution_scope_kind,
            project_id, camp_id, status, generation, version,
            created_at, updated_at, closed_at
        ) VALUES (?1, ?2, 'quick_chat', NULL, NULL, 'active', ?3, 1, ?4, ?4, NULL)
        "#,
        params![binding_id, conversation.id, generation, now],
    )?;
    let mut binding = ChannelBindingAdmission {
        binding_id,
        camp_id: None,
        project_display_name: "快速对话".to_string(),
        binding_kind: "quick_chat".to_string(),
        canonical_path: quick_chat_path.to_string(),
        project_status: None,
        conversation_display_name: conversation.display_name.clone(),
        conversation_kind: conversation.conversation_kind.clone(),
    };
    binding.camp_id = Some(create_channel_camp(
        transaction,
        &binding,
        target_agent_ids,
        now,
    )?);
    Ok(binding)
}

fn append_pending_camp_binding(
    transaction: &Transaction<'_>,
    aggregate_id: &str,
    frozen: &FrozenInboundPayload,
    conversation: &ChannelConversationAdmission,
    now: &chrono::DateTime<Utc>,
) -> Result<PendingBindingAppend> {
    let now_text = now.to_rfc3339();
    if let Some((expired_id, expires_at)) = transaction
        .query_row(
            r#"
            SELECT id, expires_at
            FROM pending_camp_binding
            WHERE channel_conversation_id = ?1 AND status = 'pending'
            "#,
            [&conversation.id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .filter(|(_, expires_at)| {
            chrono::DateTime::parse_from_rfc3339(expires_at)
                .map(|deadline| now >= &deadline.with_timezone(&Utc))
                .unwrap_or(true)
        })
    {
        let _ = expires_at;
        transaction.execute(
            r#"
            UPDATE pending_camp_binding
            SET status = 'expired', resolved_at = ?2,
                version = version + 1, updated_at = ?2
            WHERE id = ?1 AND status = 'pending'
            "#,
            params![expired_id, now_text],
        )?;
    }
    let existing = transaction
        .query_row(
            r#"
            SELECT id, owner_principal_id, acknowledgement_app_id
            FROM pending_camp_binding
            WHERE channel_conversation_id = ?1 AND status = 'pending'
            "#,
            [&conversation.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let (pending_binding_id, acknowledgement_app_id, created) =
        if let Some((pending_id, owner_principal_id, acknowledgement_app_id)) = existing {
            if owner_principal_id != frozen.principal_id {
                anyhow::bail!("pending Camp binding owner identity changed");
            }
            (pending_id, acknowledgement_app_id, false)
        } else {
            let pending_id = format!("rvpcb_{}", Uuid::new_v4().simple());
            let nonce = Uuid::new_v4().simple().to_string();
            let expires_at = (*now + Duration::hours(PENDING_BINDING_LIFETIME_HOURS)).to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO pending_camp_binding(
                    id, channel_conversation_id, owner_principal_id,
                    acknowledgement_app_id, status, version, nonce_digest,
                    expires_at, project_id, binding_id, camp_id,
                    created_at, updated_at, resolved_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, 'pending', 1, ?5, ?6,
                    NULL, NULL, NULL, ?7, ?7, NULL
                )
                "#,
                params![
                    pending_id,
                    conversation.id,
                    frozen.principal_id,
                    frozen.acknowledgement_app_id,
                    opaque_digest("pending-binding-nonce", &nonce),
                    expires_at,
                    now_text,
                ],
            )?;
            insert_pending_project_delivery(
                transaction,
                PendingProjectPickerDelivery {
                    pending_binding_id: &pending_id,
                    app_id: &frozen.acknowledgement_app_id,
                    conversation,
                    nonce: &nonce,
                    expected_version: 1,
                    operation: PendingProjectPickerOperation::Send,
                    notice: None,
                    now: &now_text,
                },
            )?;
            (pending_id, frozen.acknowledgement_app_id.clone(), true)
        };
    let queue_position: i64 = transaction.query_row(
        r#"
        SELECT COALESCE(MAX(queue_position), 0) + 1
        FROM pending_camp_message
        WHERE pending_binding_id = ?1
        "#,
        [&pending_binding_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        r#"
        INSERT INTO pending_camp_message(
            pending_binding_id, aggregate_id, external_principal_id,
            ack_app_id, structured_content_json, addressed_agent_ids_json,
            queue_position, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(aggregate_id) DO NOTHING
        "#,
        params![
            pending_binding_id,
            aggregate_id,
            frozen.principal_id,
            frozen.acknowledgement_app_id,
            serde_json::to_string(&frozen.structured_content)?,
            serde_json::to_string(&frozen.target_agent_ids)?,
            queue_position,
            now_text,
        ],
    )?;
    let persisted_position: i64 = transaction.query_row(
        "SELECT queue_position FROM pending_camp_message WHERE aggregate_id = ?1",
        [aggregate_id],
        |row| row.get(0),
    )?;
    Ok(PendingBindingAppend {
        pending_binding_id,
        queue_position: persisted_position,
        acknowledgement_app_id,
        created,
    })
}

enum PendingProjectPickerOperation<'a> {
    Send,
    Update { external_message_id: &'a str },
}

struct PendingProjectPickerDelivery<'a> {
    pending_binding_id: &'a str,
    app_id: &'a str,
    conversation: &'a ChannelConversationAdmission,
    nonce: &'a str,
    expected_version: i64,
    operation: PendingProjectPickerOperation<'a>,
    notice: Option<&'a str>,
    now: &'a str,
}

fn insert_pending_project_delivery(
    transaction: &Transaction<'_>,
    input: PendingProjectPickerDelivery<'_>,
) -> Result<()> {
    let (operation, external_picker_message_id) = match input.operation {
        PendingProjectPickerOperation::Send => ("send", None),
        PendingProjectPickerOperation::Update {
            external_message_id,
        } => ("update", Some(external_message_id)),
    };
    let payload = json!({
        "kind": "project_selection",
        "placement": "conversation",
        "operation": operation,
        "pendingBindingId": input.pending_binding_id,
        "conversationDisplayName": input.conversation.display_name,
        "conversationKind": input.conversation.conversation_kind,
        "cardRevision": PROJECT_SELECTION_CARD_REVISION,
        "expectedVersion": input.expected_version,
        "nonce": input.nonce,
        "projectOptions": active_project_card_items(transaction)?,
        "externalPickerMessageId": external_picker_message_id,
        "notice": input.notice,
    });
    transaction.execute(
        r#"
        INSERT INTO channel_delivery(
            id, request_id, pending_binding_id, dedupe_key, delivery_kind,
            priority, target_app_id, source_agent_id, source_camp_message_id,
            payload_json, status, attempt_count, available_at,
            lease_owner, lease_expires_at, external_delivery_message_id,
            failure_code, created_at, updated_at, ended_at
        ) VALUES (
            ?1, NULL, ?2, ?3, 'project_selection', 5, ?4,
            NULL, NULL, ?5, 'pending', 0, ?6,
            NULL, NULL, NULL, NULL, ?6, ?6, NULL
        )
        ON CONFLICT(dedupe_key) DO NOTHING
        "#,
        params![
            format!("rvcd_{}", Uuid::new_v4().simple()),
            input.pending_binding_id,
            format!(
                "project_selection:{}:{}:{operation}",
                input.pending_binding_id, input.expected_version
            ),
            input.app_id,
            serde_json::to_string(&payload)?,
            input.now,
        ],
    )?;
    Ok(())
}

fn insert_project_picker_recall_delivery(
    transaction: &Transaction<'_>,
    pending_binding_id: &str,
    app_id: &str,
    external_picker_message_id: &str,
    expected_version: i64,
    now: &str,
) -> Result<()> {
    let payload = json!({
        "kind": "project_selection_recall",
        "placement": "conversation",
        "operation": "recall",
        "pendingBindingId": pending_binding_id,
        "expectedVersion": expected_version,
        "externalPickerMessageId": external_picker_message_id,
    });
    transaction.execute(
        r#"
        INSERT INTO channel_delivery(
            id, request_id, pending_binding_id, dedupe_key, delivery_kind,
            priority, target_app_id, source_agent_id, source_camp_message_id,
            payload_json, status, attempt_count, available_at,
            lease_owner, lease_expires_at, external_delivery_message_id,
            failure_code, created_at, updated_at, ended_at
        ) VALUES (
            ?1, NULL, ?2, ?3, 'project_selection', 6, ?4,
            NULL, NULL, ?5, 'pending', 0, ?6,
            NULL, NULL, NULL, NULL, ?6, ?6, NULL
        )
        ON CONFLICT(dedupe_key) DO NOTHING
        "#,
        params![
            format!("rvcd_{}", Uuid::new_v4().simple()),
            pending_binding_id,
            format!(
                "project_selection_recall:{pending_binding_id}:{expected_version}:{}",
                opaque_digest("project-picker-message", external_picker_message_id)
            ),
            app_id,
            serde_json::to_string(&payload)?,
            now,
        ],
    )?;
    Ok(())
}

fn rotate_pending_project_picker(
    transaction: &Transaction<'_>,
    pending: &PendingBindingResolution,
    notice: Option<&str>,
    now: &str,
) -> Result<(i64, Vec<ProjectCardItem>)> {
    let picker_message_id = pending
        .authoritative_picker_message_id
        .as_deref()
        .context("pending Camp binding has no authoritative project picker")?;
    let nonce = Uuid::new_v4().simple().to_string();
    let next_version = pending.version + 1;
    let changed = transaction.execute(
        r#"
        UPDATE pending_camp_binding
        SET version = ?2, nonce_digest = ?3, updated_at = ?4
        WHERE id = ?1 AND status = 'pending' AND version = ?5
        "#,
        params![
            pending.id,
            next_version,
            opaque_digest("pending-binding-nonce", &nonce),
            now,
            pending.version,
        ],
    )?;
    if changed != 1 {
        anyhow::bail!("pending Camp binding changed before picker refresh");
    }
    insert_pending_project_delivery(
        transaction,
        PendingProjectPickerDelivery {
            pending_binding_id: &pending.id,
            app_id: &pending.acknowledgement_app_id,
            conversation: &pending.conversation,
            nonce: &nonce,
            expected_version: next_version,
            operation: PendingProjectPickerOperation::Update {
                external_message_id: picker_message_id,
            },
            notice,
            now,
        },
    )?;
    Ok((next_version, active_project_card_items(transaction)?))
}

fn reconcile_pending_project_picker_placement(
    transaction: &Transaction<'_>,
    now: &str,
) -> Result<()> {
    let pending = query_rows(
        transaction,
        r#"
        SELECT pending.id, pending.acknowledgement_app_id, pending.version,
               conversation.id, conversation.provider, conversation.display_name,
               conversation.tenant_key, conversation.chat_id,
               conversation.conversation_kind
        FROM pending_camp_binding AS pending
        JOIN channel_conversation AS conversation
          ON conversation.id = pending.channel_conversation_id
        WHERE pending.status = 'pending' AND pending.expires_at > ?1
          AND NOT EXISTS (
              SELECT 1 FROM channel_delivery AS delivery
              WHERE delivery.pending_binding_id = pending.id
                AND delivery.delivery_kind = 'project_selection'
                AND json_extract(delivery.payload_json, '$.placement') = 'conversation'
                AND COALESCE(
                    json_extract(delivery.payload_json, '$.operation'),
                    'send'
                ) IN ('send', 'update')
                AND CAST(
                    json_extract(delivery.payload_json, '$.expectedVersion') AS INTEGER
                ) = pending.version
          )
        ORDER BY pending.created_at, pending.id
        "#,
        [now],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                ChannelConversationAdmission {
                    id: row.get(3)?,
                    provider: row.get(4)?,
                    display_name: row.get(5)?,
                    tenant_key: row.get(6)?,
                    chat_id: row.get(7)?,
                    conversation_kind: row.get(8)?,
                },
            ))
        },
    )?;
    for (pending_id, app_id, version, conversation) in pending {
        let legacy_message_ids = query_rows(
            transaction,
            r#"
            SELECT external_delivery_message_id
            FROM channel_delivery
            WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
              AND status = 'sent' AND external_delivery_message_id IS NOT NULL
              AND COALESCE(json_extract(payload_json, '$.placement'), '') <> 'conversation'
            ORDER BY ended_at, id
            "#,
            [&pending_id],
            |row| row.get::<_, String>(0),
        )?;
        let nonce = Uuid::new_v4().simple().to_string();
        let next_version = version + 1;
        let changed = transaction.execute(
            r#"
            UPDATE pending_camp_binding
            SET version = ?2, nonce_digest = ?3, updated_at = ?4
            WHERE id = ?1 AND status = 'pending' AND version = ?5
            "#,
            params![
                pending_id,
                next_version,
                opaque_digest("pending-binding-nonce", &nonce),
                now,
                version,
            ],
        )?;
        if changed != 1 {
            continue;
        }
        for legacy_message_id in legacy_message_ids {
            insert_project_picker_recall_delivery(
                transaction,
                &pending_id,
                &app_id,
                &legacy_message_id,
                version,
                now,
            )?;
        }
        transaction.execute(
            r#"
            UPDATE channel_delivery
            SET status = 'failed', failure_code = 'legacy_private_picker_replaced',
                lease_owner = NULL, lease_expires_at = NULL,
                ended_at = ?2, updated_at = ?2
            WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
              AND COALESCE(json_extract(payload_json, '$.placement'), '') <> 'conversation'
              AND status IN ('pending', 'attempting')
            "#,
            params![pending_id, now],
        )?;
        insert_pending_project_delivery(
            transaction,
            PendingProjectPickerDelivery {
                pending_binding_id: &pending_id,
                app_id: &app_id,
                conversation: &conversation,
                nonce: &nonce,
                expected_version: next_version,
                operation: PendingProjectPickerOperation::Send,
                notice: Some("moved_to_conversation"),
                now,
            },
        )?;
    }
    Ok(())
}

fn reconcile_obsolete_project_picker_card_revision(
    transaction: &Transaction<'_>,
    now: &str,
) -> Result<()> {
    let pending = query_rows(
        transaction,
        r#"
        SELECT pending.id, pending.acknowledgement_app_id, pending.version,
               conversation.id, conversation.provider, conversation.display_name,
               conversation.tenant_key, conversation.chat_id,
               conversation.conversation_kind,
               delivery.external_delivery_message_id
        FROM pending_camp_binding AS pending
        JOIN channel_conversation AS conversation
          ON conversation.id = pending.channel_conversation_id
        JOIN channel_delivery AS delivery
          ON delivery.id = (
              SELECT candidate.id
              FROM channel_delivery AS candidate
              WHERE candidate.pending_binding_id = pending.id
                AND candidate.delivery_kind = 'project_selection'
                AND json_extract(candidate.payload_json, '$.placement') = 'conversation'
                AND CAST(
                    json_extract(candidate.payload_json, '$.expectedVersion') AS INTEGER
                ) = pending.version
                AND COALESCE(
                    CAST(json_extract(
                        candidate.payload_json,
                        '$.cardRevision'
                    ) AS INTEGER),
                    0
                ) < ?2
                AND (
                    (
                        candidate.status = 'failed'
                        AND candidate.failure_code = 'format_error'
                        AND candidate.external_delivery_message_id IS NULL
                        AND COALESCE(
                            json_extract(candidate.payload_json, '$.operation'),
                            'send'
                        ) = 'send'
                    )
                    OR (
                        candidate.status = 'sent'
                        AND candidate.external_delivery_message_id IS NOT NULL
                        AND COALESCE(
                            json_extract(candidate.payload_json, '$.operation'),
                            'send'
                        ) IN ('send', 'update')
                    )
                )
              ORDER BY
                  CASE candidate.status WHEN 'sent' THEN 0 ELSE 1 END,
                  candidate.created_at DESC,
                  candidate.id DESC
              LIMIT 1
          )
        WHERE pending.status = 'pending' AND pending.expires_at > ?1
        ORDER BY pending.created_at, pending.id
        "#,
        params![now, PROJECT_SELECTION_CARD_REVISION],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                ChannelConversationAdmission {
                    id: row.get(3)?,
                    provider: row.get(4)?,
                    display_name: row.get(5)?,
                    tenant_key: row.get(6)?,
                    chat_id: row.get(7)?,
                    conversation_kind: row.get(8)?,
                },
                row.get::<_, Option<String>>(9)?,
            ))
        },
    )?;
    for (pending_id, app_id, version, conversation, external_message_id) in pending {
        let nonce = Uuid::new_v4().simple().to_string();
        let next_version = version + 1;
        let changed = transaction.execute(
            r#"
            UPDATE pending_camp_binding
            SET version = ?2, nonce_digest = ?3, updated_at = ?4
            WHERE id = ?1 AND status = 'pending' AND version = ?5
            "#,
            params![
                pending_id,
                next_version,
                opaque_digest("pending-binding-nonce", &nonce),
                now,
                version,
            ],
        )?;
        if changed != 1 {
            continue;
        }
        insert_pending_project_delivery(
            transaction,
            PendingProjectPickerDelivery {
                pending_binding_id: &pending_id,
                app_id: &app_id,
                conversation: &conversation,
                nonce: &nonce,
                expected_version: next_version,
                operation: external_message_id
                    .as_deref()
                    .map(
                        |external_message_id| PendingProjectPickerOperation::Update {
                            external_message_id,
                        },
                    )
                    .unwrap_or(PendingProjectPickerOperation::Send),
                notice: None,
                now,
            },
        )?;
    }
    Ok(())
}

fn expire_pending_project_pickers(transaction: &Transaction<'_>, now: &str) -> Result<()> {
    let expiring = query_rows(
        transaction,
        r#"
        SELECT id, acknowledgement_app_id, version
        FROM pending_camp_binding
        WHERE status = 'pending' AND expires_at <= ?1
        ORDER BY created_at, id
        "#,
        [now],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    for (pending_id, app_id, version) in expiring {
        let message_ids = query_rows(
            transaction,
            r#"
            SELECT DISTINCT external_delivery_message_id
            FROM channel_delivery
            WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
              AND status = 'sent' AND external_delivery_message_id IS NOT NULL
              AND COALESCE(json_extract(payload_json, '$.operation'), 'send') <> 'recall'
            ORDER BY external_delivery_message_id
            "#,
            [&pending_id],
            |row| row.get::<_, String>(0),
        )?;
        for message_id in message_ids {
            insert_project_picker_recall_delivery(
                transaction,
                &pending_id,
                &app_id,
                &message_id,
                version,
                now,
            )?;
        }
        transaction.execute(
            r#"
            UPDATE channel_delivery
            SET status = 'failed', failure_code = 'pending_binding_expired',
                lease_owner = NULL, lease_expires_at = NULL,
                ended_at = ?2, updated_at = ?2
            WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
              AND COALESCE(json_extract(payload_json, '$.operation'), 'send') <> 'recall'
              AND status IN ('pending', 'attempting')
            "#,
            params![pending_id, now],
        )?;
        transaction.execute(
            r#"
            UPDATE pending_camp_binding
            SET status = 'expired', resolved_at = ?2,
                version = version + 1, updated_at = ?2
            WHERE id = ?1 AND status = 'pending' AND version = ?3
            "#,
            params![pending_id, now, version],
        )?;
    }
    Ok(())
}

fn mark_aggregate_finalized(
    transaction: &Transaction<'_>,
    aggregate_id: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        UPDATE channel_inbound_aggregate
        SET status = 'finalized', finalized_at = ?2, updated_at = ?2
        WHERE id = ?1 AND status = 'collecting'
        "#,
        params![aggregate_id, now],
    )?;
    Ok(())
}

fn mark_aggregate_failed(
    transaction: &Transaction<'_>,
    aggregate_id: &str,
    failure_code: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        UPDATE channel_inbound_aggregate
        SET status = 'failed', failure_code = ?2,
            finalized_at = ?3, updated_at = ?3
        WHERE id = ?1 AND status = 'collecting'
        "#,
        params![aggregate_id, failure_code, now],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_channel_turn_request(
    transaction: &Transaction<'_>,
    binding_id: &str,
    camp_id: &str,
    aggregate_id: &str,
    principal_id: &str,
    ack_app_id: &str,
    structured_content: &StructuredCampMessageContent,
    target_agent_ids: &[String],
    now: &str,
) -> Result<(String, i64)> {
    let request_id = format!("rvctr_{}", Uuid::new_v4().simple());
    let queue_position: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) + 1
        FROM channel_turn_request
        WHERE binding_id = ?1 AND status IN ('queued', 'admitted')
        "#,
        [binding_id],
        |row| row.get(0),
    )?;
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
            binding_id,
            aggregate_id,
            principal_id,
            ack_app_id,
            serde_json::to_string(structured_content)?,
            serde_json::to_string(target_agent_ids)?,
            queue_position,
            camp_id,
            now,
        ],
    )?;
    Ok((request_id, queue_position))
}

fn load_pending_binding_resolution(
    transaction: &Transaction<'_>,
    pending_binding_id: &str,
) -> Result<Option<PendingBindingResolution>> {
    transaction
        .query_row(
            r#"
            SELECT pending.id, pending.owner_principal_id,
                   pending.acknowledgement_app_id,
                   (
                       SELECT delivery.external_delivery_message_id
                       FROM channel_delivery AS delivery
                       WHERE delivery.pending_binding_id = pending.id
                         AND delivery.delivery_kind = 'project_selection'
                         AND delivery.status = 'sent'
                         AND delivery.external_delivery_message_id IS NOT NULL
                         AND json_extract(delivery.payload_json, '$.placement') = 'conversation'
                         AND COALESCE(
                             json_extract(delivery.payload_json, '$.operation'),
                             'send'
                         ) IN ('send', 'update')
                         AND CAST(
                             json_extract(delivery.payload_json, '$.expectedVersion') AS INTEGER
                         ) = pending.version
                       ORDER BY delivery.ended_at DESC, delivery.id DESC
                       LIMIT 1
                   ),
                   pending.status, pending.version,
                   pending.nonce_digest, pending.expires_at,
                   conversation.id, conversation.provider, conversation.display_name,
                   conversation.tenant_key, conversation.chat_id,
                   conversation.conversation_kind
            FROM pending_camp_binding AS pending
            JOIN channel_conversation AS conversation
              ON conversation.id = pending.channel_conversation_id
            WHERE pending.id = ?1
            "#,
            [pending_binding_id],
            |row| {
                Ok(PendingBindingResolution {
                    id: row.get(0)?,
                    owner_principal_id: row.get(1)?,
                    acknowledgement_app_id: row.get(2)?,
                    authoritative_picker_message_id: row.get(3)?,
                    status: row.get(4)?,
                    version: row.get(5)?,
                    nonce_digest: row.get(6)?,
                    expires_at: row.get(7)?,
                    conversation: ChannelConversationAdmission {
                        id: row.get(8)?,
                        provider: row.get(9)?,
                        display_name: row.get(10)?,
                        tenant_key: row.get(11)?,
                        chat_id: row.get(12)?,
                        conversation_kind: row.get(13)?,
                    },
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn load_pending_messages(
    transaction: &Transaction<'_>,
    pending_binding_id: &str,
) -> Result<Vec<PendingMessageRecord>> {
    query_rows(
        transaction,
        r#"
        SELECT aggregate_id, external_principal_id, ack_app_id,
               structured_content_json, addressed_agent_ids_json
        FROM pending_camp_message
        WHERE pending_binding_id = ?1
        ORDER BY queue_position, created_at, aggregate_id
        "#,
        [pending_binding_id],
        |row| {
            let content_json = row.get::<_, String>(3)?;
            let targets_json = row.get::<_, String>(4)?;
            let structured_content = serde_json::from_str(&content_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            let target_agent_ids = serde_json::from_str(&targets_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(PendingMessageRecord {
                aggregate_id: row.get(0)?,
                external_principal_id: row.get(1)?,
                ack_app_id: row.get(2)?,
                structured_content,
                target_agent_ids,
            })
        },
    )
}

fn app_ids_for_agents(
    transaction: &Transaction<'_>,
    provider: &str,
    agent_ids: &BTreeSet<String>,
) -> Result<BTreeSet<String>> {
    let mut app_ids = BTreeSet::new();
    for agent_id in agent_ids {
        let app_id = transaction
            .query_row(
                r#"
                SELECT app_id FROM channel_member_bot_directory
                WHERE provider = ?1 AND agent_id = ?2 AND status = 'published'
                "#,
                params![provider, agent_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(app_id) = app_id else {
            anyhow::bail!("pending target Agent has no published channel Bot");
        };
        app_ids.insert(app_id);
    }
    Ok(app_ids)
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
        )
        SELECT ?1, conversation.provider, binding.id, ?3, 0, ?4, ?4
        FROM channel_conversation_binding AS binding
        JOIN channel_conversation AS conversation
          ON conversation.id = binding.channel_conversation_id
        WHERE binding.id = ?2
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
                   conversation.provider, conversation.conversation_kind, conversation.tenant_key,
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
                    row.get::<_, String>(8)?,
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
        provider,
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
                "SELECT app_id, status FROM channel_member_bot_directory WHERE provider = ?1 AND agent_id = ?2",
                params![provider, agent_id],
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
                    WHERE provider = ?1 AND tenant_key = ?2 AND chat_id = ?3
                      AND agent_id = ?4 AND status = 'present'
                )
                "#,
                params![provider, tenant_key, chat_id, agent_id],
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
    recall_older_execution_consoles(transaction, request_id, &admission.camp_turn_id, now)?;
    Ok(AdmissionAttempt::Admitted)
}

fn update_queue_ack_on_admission(
    transaction: &Transaction<'_>,
    request_id: &str,
    ack_app_id: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        DELETE FROM channel_delivery
        WHERE request_id = ?1 AND delivery_kind = 'queue_ack'
          AND status = 'pending'
          AND json_extract(payload_json, '$.action') IS NULL
        "#,
        [request_id],
    )?;
    let prior_ack_exists: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM channel_delivery
            WHERE request_id = ?1 AND delivery_kind = 'queue_ack'
              AND status IN ('attempting', 'sent')
              AND json_extract(payload_json, '$.action') IS NULL
        )
        "#,
        [request_id],
        |row| row.get(0),
    )?;
    if prior_ack_exists {
        insert_delivery(
            transaction,
            request_id,
            &format!("queue_ack_recall:{request_id}"),
            "queue_ack",
            ack_app_id,
            None,
            None,
            &json!({ "kind": "queue_ack", "action": "recall" }),
            now,
        )?;
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
            "status": "queued",
            "text": "Rovai 已接收，正在排队",
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
            id, request_id, dedupe_key, delivery_kind, priority, target_app_id,
            source_agent_id, source_camp_message_id, payload_json,
            status, attempt_count, available_at, lease_owner, lease_expires_at,
            external_delivery_message_id, failure_code, created_at, updated_at, ended_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            'pending', 0, ?10, NULL, NULL, NULL, NULL, ?10, ?10, NULL
        )
        ON CONFLICT(dedupe_key) DO NOTHING
        "#,
        params![
            format!("rvcd_{}", Uuid::new_v4().simple()),
            request_id,
            dedupe_key,
            delivery_kind,
            delivery_priority(delivery_kind),
            target_app_id,
            source_agent_id,
            source_camp_message_id,
            serde_json::to_string(payload)?,
            now,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_console_delivery(
    transaction: &Transaction<'_>,
    request_id: &str,
    console_id: &str,
    dedupe_key: &str,
    delivery_kind: &str,
    target_app_id: &str,
    source_agent_id: Option<&str>,
    payload: &Value,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO channel_delivery(
            id, request_id, console_id, dedupe_key, delivery_kind, priority,
            target_app_id, source_agent_id, source_camp_message_id,
            attachment_ordinal, payload_json, status, attempt_count,
            available_at, lease_owner, lease_expires_at,
            external_delivery_message_id, failure_code, created_at, updated_at, ended_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL,
            NULL, ?9, 'pending', 0, ?10, NULL, NULL,
            NULL, NULL, ?10, ?10, NULL
        )
        ON CONFLICT(dedupe_key) DO NOTHING
        "#,
        params![
            format!("rvcd_{}", Uuid::new_v4().simple()),
            request_id,
            console_id,
            dedupe_key,
            delivery_kind,
            delivery_priority(delivery_kind),
            target_app_id,
            source_agent_id,
            serde_json::to_string(payload)?,
            now,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_attachment_delivery(
    transaction: &Transaction<'_>,
    request_id: &str,
    dedupe_key: &str,
    target_app_id: &str,
    source_agent_id: &str,
    source_camp_message_id: &str,
    attachment_ordinal: i64,
    payload: &Value,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO channel_delivery(
            id, request_id, dedupe_key, delivery_kind, priority,
            target_app_id, source_agent_id, source_camp_message_id,
            attachment_ordinal, payload_json, status, attempt_count,
            available_at, lease_owner, lease_expires_at,
            external_delivery_message_id, failure_code, created_at, updated_at, ended_at
        ) VALUES (
            ?1, ?2, ?3, 'agent_attachment', 50,
            ?4, ?5, ?6, ?7, ?8, 'pending', 0,
            ?9, NULL, NULL, NULL, NULL, ?9, ?9, NULL
        )
        ON CONFLICT(dedupe_key) DO NOTHING
        "#,
        params![
            format!("rvcd_{}", Uuid::new_v4().simple()),
            request_id,
            dedupe_key,
            target_app_id,
            source_agent_id,
            source_camp_message_id,
            attachment_ordinal,
            serde_json::to_string(payload)?,
            now,
        ],
    )?;
    Ok(())
}

fn delivery_priority(delivery_kind: &str) -> i64 {
    match delivery_kind {
        "execution_console_recall" => 10,
        "queue_ack" => 20,
        "execution_console_upsert" => 30,
        "agent_output" => 40,
        "agent_attachment" => 50,
        "attention" => 60,
        "project_selection" => 5,
        _ => 60,
    }
}

fn recall_older_execution_consoles(
    transaction: &Transaction<'_>,
    new_request_id: &str,
    new_camp_turn_id: &str,
    now: &str,
) -> Result<()> {
    let channel_conversation_id: String = transaction.query_row(
        r#"
        SELECT binding.channel_conversation_id
        FROM channel_turn_request AS request
        JOIN channel_conversation_binding AS binding ON binding.id = request.binding_id
        WHERE request.id = ?1
        "#,
        [new_request_id],
        |row| row.get(0),
    )?;
    let consoles = query_rows(
        transaction,
        r#"
        SELECT console.id, console.request_id, console.target_app_id, console.agent_id,
               console.state
        FROM channel_execution_console AS console
        WHERE console.channel_conversation_id = ?1
          AND console.camp_turn_id <> ?2
          AND console.state <> 'recalled'
        ORDER BY console.created_at, console.agent_run_id
        "#,
        params![channel_conversation_id, new_camp_turn_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    )?;
    for (console_id, request_id, target_app_id, agent_id, state) in consoles {
        let recall_open: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM channel_delivery
                WHERE console_id = ?1 AND delivery_kind = 'execution_console_recall'
                  AND status IN ('pending', 'attempting')
            )
            "#,
            [&console_id],
            |row| row.get(0),
        )?;
        if recall_open || state == "recall_pending" {
            continue;
        }
        transaction.execute(
            r#"
            DELETE FROM channel_delivery
            WHERE console_id = ?1 AND delivery_kind = 'execution_console_upsert'
              AND status = 'pending'
            "#,
            [&console_id],
        )?;
        transaction.execute(
            r#"
            UPDATE channel_execution_console
            SET state = 'recall_pending', failure_code = NULL,
                recalled_at = NULL, updated_at = ?2
            WHERE id = ?1 AND state <> 'recalled'
            "#,
            params![console_id, now],
        )?;
        insert_console_delivery(
            transaction,
            &request_id,
            &console_id,
            &format!("execution_console_recall:{console_id}:{new_request_id}"),
            "execution_console_recall",
            &target_app_id,
            Some(&agent_id),
            &json!({
                "kind": "execution_console_recall",
                "executionConsoleId": console_id,
            }),
            now,
        )?;
    }
    Ok(())
}

fn decline_unattended_channel_retries(
    transaction: &Transaction<'_>,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    let candidates = query_rows(
        transaction,
        r#"
        SELECT run.id, request.camp_id, request.camp_turn_id, run.execution_epoch
        FROM channel_turn_request AS request
        JOIN camp_turn AS turn ON turn.id = request.camp_turn_id
        JOIN agent_run AS run ON run.camp_turn_id = request.camp_turn_id
        WHERE request.status = 'admitted'
          AND turn.status = 'waiting'
          AND run.completion_role = 'required'
          AND run.status = 'failed'
          AND run.manual_retry_allowed = 1
          AND run.retry_declined_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM agent_run AS successor
              WHERE successor.predecessor_agent_run_id = run.id
          )
        ORDER BY request.created_at, run.created_at, run.id
        "#,
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    )?;
    let mut affected_turns = BTreeMap::new();
    for (agent_run_id, camp_id, camp_turn_id, execution_epoch) in candidates {
        let updated = transaction.execute(
            r#"
            UPDATE agent_run
            SET retry_declined_at = ?2, version = version + 1, updated_at = ?2
            WHERE id = ?1 AND status = 'failed'
              AND manual_retry_allowed = 1 AND retry_declined_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run AS successor
                  WHERE successor.predecessor_agent_run_id = agent_run.id
              )
            "#,
            params![agent_run_id, now],
        )?;
        if updated == 0 {
            continue;
        }
        append_domain_event(
            transaction,
            "agent_run.retry_declined",
            Some(&camp_id),
            Some(("agent_run", &agent_run_id)),
            actor,
            Some(execution_epoch),
            &json!({ "reasonCode": "channel_unattended_retry_unavailable" }),
        )?;
        affected_turns.insert(camp_turn_id, camp_id);
    }
    for (camp_turn_id, camp_id) in affected_turns {
        crate::runtime::recompute_camp_turn(
            transaction,
            &camp_id,
            &camp_turn_id,
            actor,
            None,
            now,
        )?;
    }
    Ok(())
}

fn project_active_request_deliveries(transaction: &Transaction<'_>, now: &str) -> Result<()> {
    let active = query_rows(
        transaction,
        r#"
        SELECT request.id, request.camp_turn_id, request.trigger_camp_sequence,
               request.ack_app_id, request.camp_id, binding.channel_conversation_id,
               channel_conversation.provider
        FROM channel_turn_request AS request
        JOIN channel_conversation_binding AS binding ON binding.id = request.binding_id
        JOIN channel_conversation
          ON channel_conversation.id = binding.channel_conversation_id
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
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        },
    )?;
    for (
        request_id,
        camp_turn_id,
        trigger_sequence,
        ack_app_id,
        camp_id,
        channel_conversation_id,
        provider,
    ) in active
    {
        let run_states = query_rows(
            transaction,
            r#"
            SELECT run.id, conversation.agent_id, run.status, run.version,
                   COALESCE(MAX(evidence.sequence), 0),
                   COALESCE(MAX(output.sequence), 0), bot.app_id
            FROM agent_run AS run
            JOIN conversation ON conversation.id = run.conversation_id
            LEFT JOIN agent_run_execution_evidence AS evidence
              ON evidence.agent_run_id = run.id
            LEFT JOIN camp_message AS output
              ON output.source_agent_run_id = run.id
             AND output.author_type = 'agent' AND output.tombstoned_at IS NULL
            LEFT JOIN channel_member_bot_directory AS bot
              ON bot.provider = ?2 AND bot.agent_id = conversation.agent_id
             AND bot.status = 'published'
            WHERE run.camp_turn_id = ?1
            GROUP BY run.id, conversation.agent_id, run.status, run.version, bot.app_id
            ORDER BY run.created_at, run.id
            "#,
            params![camp_turn_id, provider],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )?;
        for (run_id, agent_id, status, version, evidence_sequence, output_sequence, app_id) in
            run_states
        {
            let Some(app_id) = app_id else {
                insert_delivery(
                    transaction,
                    &request_id,
                    &format!("execution_console_identity_missing:{run_id}"),
                    "attention",
                    &ack_app_id,
                    Some(&agent_id),
                    None,
                    &json!({
                        "kind": "attention",
                        "failureCode": "channel.author_bot_unpublished",
                        "text": "一名队员已开始执行，但其对应渠道 Bot 当前不可用；Rovai 没有用其他 Bot 冒充发送执行台。",
                    }),
                    now,
                )?;
                continue;
            };
            materialize_execution_console(
                transaction,
                &request_id,
                &channel_conversation_id,
                &camp_turn_id,
                &run_id,
                &agent_id,
                &app_id,
                &status,
                version,
                evidence_sequence,
                output_sequence,
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
            if let Some(author_app_id) = bot_app_id(transaction, &provider, &agent_id)? {
                if !body.trim().is_empty() {
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
                }
                materialize_agent_attachments(
                    transaction,
                    AgentAttachmentDeliveryContext {
                        request_id: &request_id,
                        camp_id: &camp_id,
                        message_id: &message_id,
                        agent_id: &agent_id,
                        target_app_id: &author_app_id,
                        requires_body_delivery: !body.trim().is_empty(),
                    },
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
                        "text": "一名队员已产生公开回复，但其对应渠道 Bot 当前不可用；Rovai 没有用其他 Bot 冒充发送。",
                    }),
                    now,
                )?;
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn materialize_execution_console(
    transaction: &Transaction<'_>,
    request_id: &str,
    channel_conversation_id: &str,
    camp_turn_id: &str,
    agent_run_id: &str,
    agent_id: &str,
    target_app_id: &str,
    run_status: &str,
    run_version: i64,
    evidence_sequence: i64,
    output_sequence: i64,
    now: &str,
) -> Result<()> {
    let digest = canonical_json_digest(&json!({
        "runStatus": run_status,
        "runVersion": run_version,
        "evidenceSequence": evidence_sequence,
        "outputSequence": output_sequence,
    }))?;
    let existing = transaction
        .query_row(
            r#"
            SELECT id, latest_sequence, latest_snapshot_digest, state, updated_at
            FROM channel_execution_console WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let terminal = matches!(run_status, "succeeded" | "failed" | "cancelled");
    let live_state = if run_status == "queued" {
        "opening"
    } else {
        "active"
    };
    let (console_id, latest_sequence, queue_upsert) = match existing {
        Some((
            console_id,
            latest_sequence,
            previous_digest,
            previous_state,
            previous_updated_at,
        )) => {
            if matches!(
                previous_state.as_str(),
                "terminal_sealed" | "recall_pending" | "recalled" | "recall_failed"
            ) {
                return Ok(());
            }
            if terminal {
                if previous_state != "terminal_pending" || previous_digest != digest {
                    let next_sequence = latest_sequence + 1;
                    transaction.execute(
                        r#"
                        UPDATE channel_execution_console
                        SET latest_sequence = ?2, latest_snapshot_digest = ?3,
                            state = 'terminal_pending', updated_at = ?4
                        WHERE id = ?1
                          AND state IN ('opening', 'active', 'terminal_pending')
                        "#,
                        params![console_id, next_sequence, digest, now],
                    )?;
                    (console_id, next_sequence, false)
                } else if execution_console_terminal_quiet_window_elapsed(
                    &previous_updated_at,
                    now,
                )? {
                    let next_sequence = latest_sequence + 1;
                    transaction.execute(
                        r#"
                        UPDATE channel_execution_console
                        SET latest_sequence = ?2, state = 'terminal_sealed',
                            updated_at = ?3
                        WHERE id = ?1 AND state = 'terminal_pending'
                          AND latest_sequence = ?4 AND latest_snapshot_digest = ?5
                        "#,
                        params![console_id, next_sequence, now, latest_sequence, digest],
                    )?;
                    (console_id, next_sequence, true)
                } else {
                    (console_id, latest_sequence, false)
                }
            } else if previous_digest == digest && previous_state == live_state {
                (console_id, latest_sequence, false)
            } else {
                let next_sequence = latest_sequence + 1;
                transaction.execute(
                    r#"
                    UPDATE channel_execution_console
                    SET latest_sequence = ?2, latest_snapshot_digest = ?3,
                        state = ?4, updated_at = ?5
                    WHERE id = ?1
                      AND state IN ('opening', 'active', 'terminal_pending')
                    "#,
                    params![console_id, next_sequence, digest, live_state, now,],
                )?;
                (console_id, next_sequence, true)
            }
        }
        None => {
            let console_id = format!("rvcec_{}", Uuid::new_v4().simple());
            transaction.execute(
                r#"
                INSERT INTO channel_execution_console(
                    id, agent_run_id, request_id, channel_conversation_id,
                    camp_turn_id, agent_id, target_app_id, external_message_id,
                    latest_sequence, delivered_sequence, latest_snapshot_digest,
                    state, failure_code, created_at, updated_at, recalled_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL,
                    1, 0, ?8, ?9, NULL, ?10, ?10, NULL
                )
                "#,
                params![
                    console_id,
                    agent_run_id,
                    request_id,
                    channel_conversation_id,
                    camp_turn_id,
                    agent_id,
                    target_app_id,
                    digest,
                    if terminal {
                        "terminal_pending"
                    } else {
                        live_state
                    },
                    now,
                ],
            )?;
            (console_id, 1, !terminal)
        }
    };
    if !queue_upsert {
        return Ok(());
    }
    queue_execution_console_upsert(
        transaction,
        request_id,
        &console_id,
        agent_run_id,
        agent_id,
        target_app_id,
        latest_sequence,
        now,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn queue_execution_console_upsert(
    transaction: &Transaction<'_>,
    request_id: &str,
    console_id: &str,
    agent_run_id: &str,
    agent_id: &str,
    target_app_id: &str,
    latest_sequence: i64,
    now: &str,
) -> Result<()> {
    let payload = json!({
        "kind": "execution_console_upsert",
        "executionConsoleId": console_id,
        "agentRunId": agent_run_id,
        "expectedSequence": latest_sequence,
    });
    let coalesced = transaction.execute(
        r#"
        UPDATE channel_delivery
        SET payload_json = ?2, updated_at = ?3
        WHERE console_id = ?1 AND delivery_kind = 'execution_console_upsert'
          AND status = 'pending'
        "#,
        params![console_id, serde_json::to_string(&payload)?, now],
    )?;
    if coalesced == 0 {
        insert_console_delivery(
            transaction,
            request_id,
            console_id,
            &format!("execution_console_upsert:{console_id}:{latest_sequence}"),
            "execution_console_upsert",
            target_app_id,
            Some(agent_id),
            &payload,
            now,
        )?;
    }
    Ok(())
}

fn execution_console_terminal_quiet_window_elapsed(previous: &str, now: &str) -> Result<bool> {
    let previous = chrono::DateTime::parse_from_rfc3339(previous)
        .with_context(|| format!("invalid execution console updated_at {previous}"))?;
    let now = chrono::DateTime::parse_from_rfc3339(now)
        .with_context(|| format!("invalid execution console materialization time {now}"))?;
    Ok(now.signed_duration_since(previous).num_milliseconds()
        >= EXECUTION_CONSOLE_TERMINAL_QUIET_WINDOW_MILLISECONDS)
}

struct AgentAttachmentDeliveryContext<'a> {
    request_id: &'a str,
    camp_id: &'a str,
    message_id: &'a str,
    agent_id: &'a str,
    target_app_id: &'a str,
    requires_body_delivery: bool,
}

fn materialize_agent_attachments(
    transaction: &Transaction<'_>,
    context: AgentAttachmentDeliveryContext<'_>,
    now: &str,
) -> Result<()> {
    let AgentAttachmentDeliveryContext {
        request_id,
        camp_id,
        message_id,
        agent_id,
        target_app_id,
        requires_body_delivery,
    } = context;
    let attachments = query_rows(
        transaction,
        r#"
        SELECT reference.ordinal, managed.id, reference.display_name_snapshot,
               managed.media_type, managed.byte_size, managed.content_digest,
               managed.preview_kind
        FROM camp_message_attachment_ref AS reference
        JOIN managed_attachment AS managed
          ON managed.camp_id = reference.camp_id
         AND managed.id = reference.attachment_id
        WHERE reference.camp_id = ?1 AND reference.camp_message_id = ?2
          AND managed.state = 'available' AND managed.kind = 'file'
        ORDER BY reference.ordinal, managed.id
        "#,
        params![camp_id, message_id],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        },
    )?;
    for (ordinal, attachment_id, file_name, media_type, size, digest, preview_kind) in attachments {
        let attachment_kind = if preview_kind == "image" || media_type.starts_with("image/") {
            "image"
        } else {
            "file"
        };
        insert_attachment_delivery(
            transaction,
            request_id,
            &format!("agent_attachment:{message_id}:{ordinal}:{attachment_id}"),
            target_app_id,
            agent_id,
            message_id,
            ordinal,
            &json!({
                "kind": "agent_attachment",
                "sourceCampMessageId": message_id,
                "sourceAgentId": agent_id,
                "campId": camp_id,
                "attachmentId": attachment_id,
                "ordinal": ordinal,
                "attachmentKind": attachment_kind,
                "fileName": file_name,
                "mediaType": media_type,
                "size": size,
                "contentDigest": digest,
                "requiresBodyDelivery": requires_body_delivery,
            }),
            now,
        )?;
    }
    Ok(())
}

fn settle_terminal_requests(transaction: &Transaction<'_>, now: &str) -> Result<()> {
    let terminal = query_rows(
        transaction,
        r#"
        SELECT request.id, turn.status,
               EXISTS(
                   SELECT 1 FROM channel_delivery
                   WHERE request_id = request.id
                     AND delivery_kind IN ('agent_output', 'agent_attachment', 'attention')
                     AND status IN ('pending', 'attempting')
               ) AS has_nonterminal_delivery,
               EXISTS(
                   SELECT 1 FROM channel_delivery
                   WHERE request_id = request.id
                     AND delivery_kind IN ('agent_output', 'agent_attachment', 'attention')
                     AND status = 'failed'
               ) AS has_failed_delivery
        FROM channel_turn_request AS request
        JOIN camp_turn AS turn ON turn.id = request.camp_turn_id
        WHERE request.status = 'admitted'
          AND turn.status IN ('completed', 'failed', 'cancelled')
        "#,
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, bool>(3)?,
            ))
        },
    )?;
    for (request_id, turn_status, has_nonterminal, has_failed) in terminal {
        if !has_nonterminal {
            let failed = has_failed || turn_status != "completed";
            transaction.execute(
                r#"
                UPDATE channel_turn_request
                SET status = ?2, failure_code = ?3,
                    completed_at = ?4, updated_at = ?4, version = version + 1
                WHERE id = ?1 AND status = 'admitted'
                "#,
                params![
                    request_id,
                    if failed { "failed" } else { "completed" },
                    if has_failed {
                        Some("channel_delivery_failed")
                    } else if turn_status != "completed" {
                        Some("channel_turn_failed")
                    } else {
                        None
                    },
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
    provider: &str,
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
        SELECT delivery.id
        FROM channel_delivery AS delivery
        WHERE delivery.status = 'pending' AND delivery.available_at <= ?1
          AND COALESCE(
              (
                  SELECT conversation.provider
                  FROM channel_turn_request AS request
                  JOIN channel_conversation_binding AS binding
                    ON binding.id = request.binding_id
                  JOIN channel_conversation AS conversation
                    ON conversation.id = binding.channel_conversation_id
                  WHERE request.id = delivery.request_id
              ),
              (
                  SELECT conversation.provider
                  FROM pending_camp_binding AS pending
                  JOIN channel_conversation AS conversation
                    ON conversation.id = pending.channel_conversation_id
                  WHERE pending.id = delivery.pending_binding_id
              )
          ) = ?2
          AND (
              delivery.delivery_kind <> 'project_selection'
              OR json_extract(delivery.payload_json, '$.placement') = 'conversation'
          )
          AND (
              delivery.delivery_kind <> 'execution_console_recall'
              OR NOT EXISTS (
                  SELECT 1 FROM channel_delivery AS pending_console_update
                  WHERE pending_console_update.console_id = delivery.console_id
                    AND pending_console_update.delivery_kind = 'execution_console_upsert'
                    AND pending_console_update.status IN ('pending', 'attempting')
              )
          )
          AND (
              delivery.delivery_kind <> 'queue_ack'
              OR COALESCE(json_extract(delivery.payload_json, '$.action'), '') <> 'recall'
              OR NOT EXISTS (
                  SELECT 1 FROM channel_delivery AS pending_queue_ack
                  WHERE pending_queue_ack.request_id = delivery.request_id
                    AND pending_queue_ack.delivery_kind = 'queue_ack'
                    AND json_extract(pending_queue_ack.payload_json, '$.action') IS NULL
                    AND pending_queue_ack.status IN ('pending', 'attempting')
              )
          )
          AND (
              delivery.delivery_kind <> 'agent_attachment'
              OR (
                  (
                      COALESCE(
                          json_extract(delivery.payload_json, '$.requiresBodyDelivery'),
                          0
                      ) = 0
                      OR EXISTS (
                          SELECT 1 FROM channel_delivery AS body_delivery
                          WHERE body_delivery.request_id = delivery.request_id
                            AND body_delivery.source_camp_message_id =
                                delivery.source_camp_message_id
                            AND body_delivery.delivery_kind = 'agent_output'
                            AND body_delivery.status IN ('sent', 'failed')
                      )
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM channel_delivery AS earlier_attachment
                      WHERE earlier_attachment.request_id = delivery.request_id
                        AND earlier_attachment.source_camp_message_id =
                            delivery.source_camp_message_id
                        AND earlier_attachment.delivery_kind = 'agent_attachment'
                        AND earlier_attachment.attachment_ordinal <
                            delivery.attachment_ordinal
                        AND earlier_attachment.status IN ('pending', 'attempting')
                  )
              )
          )
        ORDER BY delivery.priority, delivery.available_at,
                 delivery.created_at, delivery.id
        LIMIT ?3
        "#,
        params![now_text, provider, i64::try_from(limit)?],
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
                   COALESCE(request_conversation.chat_id, pending_conversation.chat_id),
                   COALESCE(request_conversation.topic_key, pending_conversation.topic_key),
                   COALESCE(
                       request_conversation.conversation_kind,
                       pending_conversation.conversation_kind
                   ),
                   delivery.payload_json,
                   delivery.attempt_count,
                   CASE
                       WHEN delivery.delivery_kind IN (
                           'execution_console_upsert', 'execution_console_recall'
                       ) THEN console.external_message_id
                       WHEN delivery.delivery_kind = 'project_selection'
                        AND json_extract(delivery.payload_json, '$.operation') IN (
                            'update', 'recall'
                        )
                       THEN json_extract(
                           delivery.payload_json,
                           '$.externalPickerMessageId'
                       )
                       WHEN delivery.delivery_kind = 'queue_ack'
                        AND json_extract(delivery.payload_json, '$.action') = 'recall'
                       THEN (
                           SELECT previous.external_delivery_message_id
                           FROM channel_delivery AS previous
                           WHERE previous.request_id = delivery.request_id
                             AND previous.delivery_kind = 'queue_ack'
                             AND json_extract(previous.payload_json, '$.action') IS NULL
                             AND previous.status = 'sent'
                             AND previous.external_delivery_message_id IS NOT NULL
                           ORDER BY previous.ended_at DESC, previous.id DESC
                           LIMIT 1
                       )
                       ELSE NULL
                   END AS update_message_id
                   ,(
                       SELECT identity.external_id
                       FROM external_principal_app_identity AS identity
                       WHERE identity.principal_id = COALESCE(
                                 request.external_principal_id,
                                 pending.owner_principal_id
                             )
                         AND identity.provider = COALESCE(
                             request_conversation.provider,
                             pending_conversation.provider
                         )
                         AND identity.app_id = delivery.target_app_id
                         AND identity.identity_kind = CASE COALESCE(
                             request_conversation.provider,
                             pending_conversation.provider
                         )
                             WHEN 'dingtalk' THEN 'user_id'
                             ELSE 'open_id'
                         END
                       LIMIT 1
                   ) AS recipient_open_id
                   ,COALESCE(
                       request_conversation.provider,
                       pending_conversation.provider
                   ) AS provider
            FROM channel_delivery AS delivery
            LEFT JOIN channel_turn_request AS request ON request.id = delivery.request_id
            LEFT JOIN channel_conversation_binding AS binding ON binding.id = request.binding_id
            LEFT JOIN channel_conversation AS request_conversation
              ON request_conversation.id = binding.channel_conversation_id
            LEFT JOIN pending_camp_binding AS pending
              ON pending.id = delivery.pending_binding_id
            LEFT JOIN channel_conversation AS pending_conversation
              ON pending_conversation.id = pending.channel_conversation_id
            LEFT JOIN channel_member_bot_directory AS bot
              ON bot.provider = COALESCE(
                    request_conversation.provider,
                    pending_conversation.provider
                 )
             AND bot.app_id = delivery.target_app_id
            LEFT JOIN channel_execution_console AS console
              ON console.id = delivery.console_id
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
                    provider: row.get(12)?,
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
                "SELECT agent_id FROM channel_member_bot_directory WHERE provider = ?1 AND app_id = ?2 AND status = 'published'",
                params![command.provider, app_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .with_context(|| {
                format!("expected channel App {app_id} is not a published member Bot")
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
    if !matches!(
        command.provider.as_str(),
        FEISHU_PROVIDER | DINGTALK_PROVIDER
    ) {
        anyhow::bail!("channel provider must be feishu or dingtalk");
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
    validate_owner_identity_input(
        &command.provider,
        &command.app_id,
        &command.tenant_key,
        command.sender_open_id.as_deref(),
        command.sender_user_id.as_deref(),
        command.sender_union_id.as_deref(),
    )?;
    if !matches!(
        command.conversation_kind.as_str(),
        "p2p" | "group" | "topic"
    ) {
        anyhow::bail!("conversationKind must be p2p, group or topic");
    }
    if command.provider == DINGTALK_PROVIDER && command.conversation_kind == "topic" {
        anyhow::bail!("DingTalk topic admission is disabled until capability probes pass");
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

fn validate_dingtalk_publication_state(value: &str) -> Result<()> {
    if !matches!(
        value,
        "created"
            | "account_verified"
            | "app_created"
            | "credentials_read"
            | "avatar_configured"
            | "robot_configured"
            | "permissions_configured"
            | "version_created"
            | "awaiting_approver_selection"
            | "awaiting_approval"
            | "version_released"
            | "stream_verified"
            | "card_verified"
            | "completed"
            | "failed_recoverable"
            | "failed_unknown_remote_state"
    ) {
        anyhow::bail!("unknown DingTalk member Bot publication state");
    }
    Ok(())
}

fn dingtalk_publication_transition_allowed(current: &str, next: &str) -> bool {
    if current == next {
        return true;
    }
    if current == "completed" || next == "created" {
        return false;
    }
    if matches!(next, "failed_recoverable" | "failed_unknown_remote_state") {
        return true;
    }
    if current == "failed_unknown_remote_state" {
        return next == "failed_recoverable";
    }
    if current == "failed_recoverable" {
        return next != "created";
    }
    if current == "version_created" {
        return matches!(
            next,
            "awaiting_approver_selection" | "awaiting_approval" | "version_released"
        );
    }
    if current == "awaiting_approver_selection" {
        return matches!(next, "awaiting_approval" | "version_released");
    }
    if current == "awaiting_approval" {
        return next == "version_released";
    }
    let rank = |state: &str| match state {
        "created" => Some(0),
        "account_verified" => Some(1),
        "app_created" => Some(2),
        "credentials_read" => Some(3),
        "avatar_configured" => Some(4),
        "robot_configured" => Some(5),
        "permissions_configured" => Some(6),
        "version_created" => Some(7),
        "version_released" => Some(8),
        "stream_verified" => Some(9),
        "card_verified" => Some(10),
        "completed" => Some(11),
        _ => None,
    };
    match (rank(current), rank(next)) {
        (Some(current), Some(next)) => next == current + 1,
        _ => false,
    }
}

fn dingtalk_state_requires_app(state: &str) -> bool {
    !matches!(
        state,
        "created" | "account_verified" | "failed_recoverable" | "failed_unknown_remote_state"
    )
}

fn dingtalk_state_requires_credentials(state: &str) -> bool {
    matches!(
        state,
        "credentials_read"
            | "avatar_configured"
            | "robot_configured"
            | "permissions_configured"
            | "version_created"
            | "awaiting_approver_selection"
            | "awaiting_approval"
            | "version_released"
            | "stream_verified"
            | "card_verified"
            | "completed"
    )
}

fn dingtalk_state_requires_robot(state: &str) -> bool {
    matches!(
        state,
        "robot_configured"
            | "permissions_configured"
            | "version_created"
            | "awaiting_approver_selection"
            | "awaiting_approval"
            | "version_released"
            | "stream_verified"
            | "card_verified"
            | "completed"
    )
}

fn dingtalk_state_requires_version(state: &str) -> bool {
    matches!(
        state,
        "version_created"
            | "awaiting_approver_selection"
            | "awaiting_approval"
            | "version_released"
            | "stream_verified"
            | "card_verified"
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

fn bot_app_id(
    transaction: &Transaction<'_>,
    provider: &str,
    agent_id: &str,
) -> Result<Option<String>> {
    transaction
        .query_row(
            "SELECT app_id FROM channel_member_bot_directory WHERE provider = ?1 AND agent_id = ?2 AND status = 'published'",
            params![provider, agent_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn validate_provider(provider: &str) -> Result<()> {
    if !matches!(provider, FEISHU_PROVIDER | DINGTALK_PROVIDER) {
        anyhow::bail!("provider is not supported");
    }
    Ok(())
}

fn validate_credential_ref(credential_ref: &str, provider: &str) -> Result<()> {
    validate_nonempty(credential_ref, "credentialRef")?;
    let prefix = if provider == FEISHU_PROVIDER {
        "feishu-"
    } else {
        "dingtalk-"
    };
    if credential_ref.len() > 128
        || !credential_ref.starts_with(prefix)
        || !credential_ref
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        anyhow::bail!("credentialRef is invalid for provider");
    }
    Ok(())
}

fn required_json_string<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
    maximum: usize,
) -> Result<&'a str> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= maximum && !value.contains('\0'))
        .with_context(|| format!("{key} is invalid"))?;
    Ok(value)
}

fn validated_credential_payload(provider: &str, value: &Value) -> Result<Value> {
    validate_provider(provider)?;
    let object = value
        .as_object()
        .context("credential payload must be an object")?;
    let app_secret = required_json_string(object, "appSecret", 16_384)?;
    if provider == FEISHU_PROVIDER {
        if object.len() != 1 {
            anyhow::bail!("Feishu credential payload has unsupported fields");
        }
        return Ok(json!({ "appSecret": app_secret }));
    }
    if object.len() != 2 {
        anyhow::bail!("DingTalk credential payload has unsupported fields");
    }
    let robot_code = required_json_string(object, "robotCode", 512)?;
    Ok(json!({ "appSecret": app_secret, "robotCode": robot_code }))
}

fn parse_stored_credential_payload(provider: &str, payload_json: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(payload_json)
        .context("stored channel credential payload is invalid")?;
    validated_credential_payload(provider, &value)
}

fn validate_developer_session_documents(
    provider: &str,
    identity: &Value,
    session: &Value,
) -> Result<()> {
    validate_provider(provider)?;
    let identity_object = identity
        .as_object()
        .context("developer identity must be an object")?;
    let session_object = session
        .as_object()
        .context("developer session must be an object")?;
    if serde_json::to_vec(identity)?.len() > 65_536 {
        anyhow::bail!("developer identity exceeds the storage limit");
    }
    if serde_json::to_vec(session)?.len() > 1_048_576 {
        anyhow::bail!("developer session exceeds the storage limit");
    }
    if provider == FEISHU_PROVIDER {
        for (key, maximum) in [
            ("brand", 16),
            ("userId", 512),
            ("userName", 512),
            ("tenantId", 512),
            ("tenantName", 512),
        ] {
            required_json_string(identity_object, key, maximum)?;
        }
        if !matches!(
            identity_object.get("brand").and_then(Value::as_str),
            Some("feishu" | "lark")
        ) {
            anyhow::bail!("Feishu developer identity brand is invalid");
        }
        if let Some(email) = identity_object.get("email")
            && !email.is_null()
        {
            let email = email
                .as_str()
                .context("developer identity email is invalid")?;
            if email.len() > 512 || email.contains('\0') {
                anyhow::bail!("developer identity email is invalid");
            }
        }
        let cookies = session_object
            .get("cookies")
            .and_then(Value::as_array)
            .context("Feishu developer session cookies are missing")?;
        if session_object.len() != 1 || cookies.len() > 512 {
            anyhow::bail!("Feishu developer session shape is invalid");
        }
        for cookie in cookies {
            let cookie = cookie
                .as_object()
                .context("Feishu developer session cookie is invalid")?;
            required_json_string(cookie, "name", 512)?;
            required_json_string(cookie, "value", 16_384)?;
            let domain = required_json_string(cookie, "domain", 512)?;
            let domain = domain.trim_start_matches('.').to_ascii_lowercase();
            if !(domain == "feishu.cn"
                || domain.ends_with(".feishu.cn")
                || domain == "larksuite.com"
                || domain.ends_with(".larksuite.com"))
            {
                anyhow::bail!("Feishu developer session cookie domain is invalid");
            }
            required_json_string(cookie, "path", 4096)?;
        }
    } else {
        for (key, maximum) in [
            ("corpId", 512),
            ("corpName", 512),
            ("userId", 512),
            ("userName", 512),
        ] {
            required_json_string(identity_object, key, maximum)?;
        }
        if session_object.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
            anyhow::bail!("DingTalk developer session schema is invalid");
        }
        let current_profile_key = required_json_string(session_object, "currentProfileKey", 512)?;
        let profiles = session_object
            .get("profiles")
            .and_then(Value::as_array)
            .context("DingTalk developer session profiles are missing")?;
        if profiles.is_empty() || profiles.len() > 32 {
            anyhow::bail!("DingTalk developer session profiles are invalid");
        }
        let expected_corp_id = required_json_string(identity_object, "corpId", 512)?;
        let expected_user_id = required_json_string(identity_object, "userId", 512)?;
        let mut active_identity_matches = false;
        for profile in profiles {
            let profile = profile
                .as_object()
                .context("DingTalk developer session profile is invalid")?;
            for (key, maximum) in [
                ("accessToken", 16_384),
                ("refreshToken", 16_384),
                ("accessTokenExpiresAt", 128),
                ("refreshTokenExpiresAt", 128),
                ("corpId", 512),
                ("corpName", 512),
                ("userId", 512),
                ("userName", 512),
                ("clientId", 4096),
            ] {
                required_json_string(profile, key, maximum)?;
            }
            let profile_key = profile_key_for_dingtalk(
                required_json_string(profile, "corpId", 512)?,
                required_json_string(profile, "userId", 512)?,
            );
            if profile_key == current_profile_key {
                active_identity_matches = required_json_string(profile, "corpId", 512)?
                    == expected_corp_id
                    && required_json_string(profile, "userId", 512)? == expected_user_id;
            }
        }
        if !active_identity_matches {
            anyhow::bail!("DingTalk active profile does not match the developer identity");
        }
    }
    Ok(())
}

fn profile_key_for_dingtalk(corp_id: &str, user_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(corp_id.as_bytes());
    digest.update([0]);
    digest.update(user_id.as_bytes());
    let encoded = format!("{:x}", digest.finalize());
    format!("rvdtp_{}", &encoded[..32])
}

fn validate_feishu_connection(command: &CommitFeishuAccountConnectionCommand) -> Result<()> {
    let account = &command.account;
    validate_nonempty(&account.account_id, "accountId")?;
    validate_digest(&account.user_id_digest, "userIdDigest")?;
    validate_nonempty(&account.tenant_id, "tenantId")?;
    normalize_display_name(&account.user_name)?;
    normalize_display_name(&account.tenant_name)?;
    normalize_optional_email(account.email.as_deref())?;
    if !matches!(account.brand.as_str(), "feishu" | "lark") {
        anyhow::bail!("brand must be feishu or lark");
    }
    validate_developer_session_documents(
        FEISHU_PROVIDER,
        &command.developer_session.identity,
        &command.developer_session.session,
    )?;
    let identity = command.developer_session.identity.as_object().unwrap();
    let user_id = required_json_string(identity, "userId", 512)?;
    if opaque_digest("feishu-user", user_id) != account.user_id_digest
        || required_json_string(identity, "tenantId", 512)? != account.tenant_id
        || required_json_string(identity, "userName", 512)? != account.user_name
        || required_json_string(identity, "tenantName", 512)? != account.tenant_name
        || required_json_string(identity, "brand", 16)? != account.brand
    {
        anyhow::bail!("Feishu account and developer identity do not match");
    }
    Ok(())
}

fn validate_dingtalk_connection(command: &CommitDingTalkAccountConnectionCommand) -> Result<()> {
    let account = &command.account;
    validate_nonempty(&account.account_id, "accountId")?;
    validate_digest(&account.user_id_digest, "userIdDigest")?;
    validate_nonempty(&account.corp_id, "corpId")?;
    validate_nonempty(&account.oauth_profile_ref, "oauthProfileRef")?;
    normalize_display_name(&account.user_name)?;
    normalize_display_name(&account.corp_name)?;
    validate_developer_session_documents(
        DINGTALK_PROVIDER,
        &command.developer_session.identity,
        &command.developer_session.session,
    )?;
    let identity = command.developer_session.identity.as_object().unwrap();
    let user_id = required_json_string(identity, "userId", 512)?;
    if opaque_digest("dingtalk-user", user_id) != account.user_id_digest
        || required_json_string(identity, "corpId", 512)? != account.corp_id
        || required_json_string(identity, "userName", 512)? != account.user_name
        || required_json_string(identity, "corpName", 512)? != account.corp_name
    {
        anyhow::bail!("DingTalk account and developer identity do not match");
    }
    Ok(())
}

fn previous_account_version_conflict(
    transaction: &Transaction<'_>,
    table: &str,
    expected: Option<i64>,
) -> Result<Option<i64>> {
    let current = transaction
        .query_row(
            &format!("SELECT version FROM {table} WHERE status = 'connected' LIMIT 1"),
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    Ok(match (current, expected) {
        (None, None) => None,
        (Some(current), Some(expected)) if current == expected => None,
        (Some(current), _) => Some(current),
        (None, Some(_)) => Some(0),
    })
}

fn replace_developer_session_row(
    transaction: &Transaction<'_>,
    provider: &str,
    account_id: &str,
    identity: &Value,
    session: &Value,
) -> Result<i64> {
    validate_developer_session_documents(provider, identity, session)?;
    let identity_json = serde_json::to_string(identity)?;
    let session_json = serde_json::to_string(session)?;
    let now = Utc::now().timestamp_millis();
    transaction.execute(
        r#"
        INSERT INTO channel_developer_sessions(
            provider, account_id, identity_json, session_json,
            schema_version, revision, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, ?5)
        ON CONFLICT(provider) DO UPDATE SET
            account_id = excluded.account_id,
            identity_json = excluded.identity_json,
            session_json = excluded.session_json,
            schema_version = 1,
            revision = channel_developer_sessions.revision + 1,
            updated_at = excluded.updated_at
        "#,
        params![provider, account_id, identity_json, session_json, now],
    )?;
    transaction
        .query_row(
            "SELECT revision FROM channel_developer_sessions WHERE provider = ?1",
            [provider],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn persist_feishu_account(
    transaction: &Transaction<'_>,
    account: &FeishuConnectionAccountInput,
) -> Result<i64> {
    let conflicting_identity = transaction
        .query_row(
            "SELECT user_id_digest FROM feishu_account WHERE id = ?1",
            [&account.account_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten()
        .is_some_and(|digest| digest != account.user_id_digest);
    if conflicting_identity {
        anyhow::bail!("Feishu account identity conflict");
    }
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE feishu_account
        SET status = 'disconnected', disconnected_at = ?2,
            version = version + 1, updated_at = ?2
        WHERE status = 'connected' AND id <> ?1
        "#,
        params![account.account_id, now],
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
            status = 'connected', disconnected_at = NULL,
            connected_at = CASE
                WHEN feishu_account.status = 'connected'
                 AND feishu_account.connected_at IS NOT NULL
                THEN feishu_account.connected_at ELSE excluded.connected_at END,
            last_verified_at = excluded.last_verified_at,
            version = feishu_account.version + 1,
            updated_at = excluded.updated_at
        "#,
        params![
            account.account_id,
            account.user_id_digest,
            normalize_display_name(&account.user_name)?,
            normalize_display_name(&account.tenant_name)?,
            account.tenant_id,
            normalize_optional_email(account.email.as_deref())?,
            account.brand,
            now,
        ],
    )?;
    transaction.execute(
        r#"
        INSERT INTO feishu_owner_identity(
            account_id, tenant_id, canonical_owner_principal_id,
            user_id_digest, union_id_digest, verified_at,
            version, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, 1, ?5, ?5)
        ON CONFLICT(account_id) DO UPDATE SET
            tenant_id = excluded.tenant_id,
            user_id_digest = excluded.user_id_digest,
            verified_at = excluded.verified_at,
            version = feishu_owner_identity.version + 1,
            updated_at = excluded.updated_at
        "#,
        params![
            account.account_id,
            account.tenant_id,
            format!("rvep_{}", Uuid::new_v4().simple()),
            account.user_id_digest,
            now,
        ],
    )?;
    transaction
        .query_row(
            "SELECT version FROM feishu_account WHERE id = ?1",
            [&account.account_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn persist_dingtalk_account(
    transaction: &Transaction<'_>,
    account: &DingTalkConnectionAccountInput,
) -> Result<i64> {
    let existing = transaction
        .query_row(
            "SELECT user_id_digest, corp_id, oauth_profile_ref FROM dingtalk_account WHERE id = ?1",
            [&account.account_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    if existing
        .as_ref()
        .is_some_and(|(user_digest, corp_id, profile_ref)| {
            user_digest != &account.user_id_digest
                || corp_id != &account.corp_id
                || profile_ref != &account.oauth_profile_ref
        })
    {
        anyhow::bail!("DingTalk account identity conflict");
    }
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE dingtalk_account
        SET status = 'disconnected', disconnected_at = ?2,
            version = version + 1, updated_at = ?2
        WHERE status = 'connected' AND id <> ?1
        "#,
        params![account.account_id, now],
    )?;
    transaction.execute(
        r#"
        INSERT INTO dingtalk_account(
            id, user_id_digest, corp_id, user_name, corp_name,
            oauth_profile_ref, status, version, created_at, updated_at,
            connected_at, last_verified_at, disconnected_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'connected', 1, ?7, ?7, ?7, ?7, NULL)
        ON CONFLICT(id) DO UPDATE SET
            user_name = excluded.user_name,
            corp_name = excluded.corp_name,
            status = 'connected',
            connected_at = CASE WHEN dingtalk_account.status = 'connected'
                THEN dingtalk_account.connected_at ELSE excluded.connected_at END,
            last_verified_at = excluded.last_verified_at,
            disconnected_at = NULL,
            version = dingtalk_account.version + 1,
            updated_at = excluded.updated_at
        "#,
        params![
            account.account_id,
            account.user_id_digest,
            account.corp_id,
            normalize_display_name(&account.user_name)?,
            normalize_display_name(&account.corp_name)?,
            account.oauth_profile_ref,
            now,
        ],
    )?;
    transaction.execute(
        r#"
        INSERT INTO dingtalk_owner_identity(
            account_id, corp_id, canonical_owner_principal_id,
            user_id_digest, version, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
        ON CONFLICT(account_id) DO UPDATE SET
            corp_id = excluded.corp_id,
            user_id_digest = excluded.user_id_digest,
            version = dingtalk_owner_identity.version + 1,
            updated_at = excluded.updated_at
        "#,
        params![
            account.account_id,
            account.corp_id,
            format!("rvep_{}", Uuid::new_v4().simple()),
            account.user_id_digest,
            now,
        ],
    )?;
    transaction
        .query_row(
            "SELECT version FROM dingtalk_account WHERE id = ?1",
            [&account.account_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn load_credential_identity(
    transaction: &Transaction<'_>,
    credential_ref: &str,
) -> Result<Option<(String, String, i64)>> {
    transaction
        .query_row(
            "SELECT provider, remote_app_id, revision FROM channel_credentials WHERE credential_ref = ?1",
            [credential_ref],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(Into::into)
}

fn credential_identity_conflict(
    transaction: &Transaction<'_>,
    provider: &str,
    credential_ref: &str,
    remote_app_id: &str,
) -> Result<bool> {
    if load_credential_identity(transaction, credential_ref)?.is_some_and(
        |(stored_provider, stored_app_id, _)| {
            stored_provider != provider || stored_app_id != remote_app_id
        },
    ) {
        return Ok(true);
    }
    transaction
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM channel_credentials
                WHERE provider = ?1 AND credential_kind = 'member_bot'
                  AND remote_app_id = ?2 AND credential_ref <> ?3
            )
            "#,
            params![provider, remote_app_id, credential_ref],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn upsert_credential_row(
    transaction: &Transaction<'_>,
    provider: &str,
    credential_ref: &str,
    remote_app_id: &str,
    payload: &Value,
) -> Result<i64> {
    let payload_json = serde_json::to_string(payload)?;
    if payload_json.len() > 65_536 {
        anyhow::bail!("credential payload exceeds the storage limit");
    }
    let now = Utc::now().timestamp_millis();
    transaction.execute(
        r#"
        INSERT INTO channel_credentials(
            credential_ref, provider, credential_kind, remote_app_id,
            payload_json, schema_version, revision, created_at, updated_at
        ) VALUES (?1, ?2, 'member_bot', ?3, ?4, 1, 1, ?5, ?5)
        ON CONFLICT(credential_ref) DO UPDATE SET
            payload_json = excluded.payload_json,
            schema_version = 1,
            revision = channel_credentials.revision + 1,
            updated_at = excluded.updated_at
        "#,
        params![credential_ref, provider, remote_app_id, payload_json, now],
    )?;
    transaction
        .query_row(
            "SELECT revision FROM channel_credentials WHERE credential_ref = ?1",
            [credential_ref],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn store_feishu_publication_credential(
    transaction: &Transaction<'_>,
    command: &StorePublicationCredentialCommand,
    payload: &Value,
) -> Result<CommandHandlerResult> {
    let current = transaction
        .query_row(
            r#"
            SELECT state, remote_app_id, credential_ref, version
            FROM feishu_member_bot_publication_intent WHERE id = ?1
            "#,
            [&command.publication_intent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((state, remote_app_id, credential_ref, version)) = current else {
        return Ok(rejected(
            "feishu_publication_intent.not_found",
            "Publication intent does not exist",
        ));
    };
    if version != command.expected_intent_version {
        return Ok(version_conflict(version));
    }
    if !publication_intent_transition_allowed(&state, "credentials_read") {
        return Ok(rejected(
            "feishu_publication_intent.invalid_transition",
            "Credential storage requires the credentials_read transition",
        ));
    }
    if remote_app_id.as_deref() != Some(command.remote_app_id.as_str()) {
        return Ok(rejected(
            "feishu_publication_intent.remote_app_conflict",
            "Credential does not belong to the frozen App",
        ));
    }
    if credential_ref
        .as_deref()
        .is_some_and(|current| current != command.credential_ref)
        || credential_identity_conflict(
            transaction,
            FEISHU_PROVIDER,
            &command.credential_ref,
            &command.remote_app_id,
        )?
    {
        return Ok(rejected(
            "channel_credential.identity_conflict",
            "Credential identity is immutable",
        ));
    }
    let revision = upsert_credential_row(
        transaction,
        FEISHU_PROVIDER,
        &command.credential_ref,
        &command.remote_app_id,
        payload,
    )?;
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE feishu_member_bot_publication_intent
        SET state = 'credentials_read', credential_ref = ?2,
            last_completed_step = 'credentials_read', failure_code = NULL,
            version = version + 1, updated_at = ?3
        WHERE id = ?1 AND version = ?4
        "#,
        params![
            command.publication_intent_id,
            command.credential_ref,
            now,
            version
        ],
    )?;
    Ok(CommandHandlerResult::applied(
        "feishu_publication_intent.credential_stored",
        json!({
            "publicationIntentId": command.publication_intent_id,
            "credentialRef": command.credential_ref,
            "credentialRevision": revision,
            "version": version + 1,
        }),
        None,
    ))
}

fn store_dingtalk_publication_credential(
    transaction: &Transaction<'_>,
    command: &StorePublicationCredentialCommand,
    payload: &Value,
) -> Result<CommandHandlerResult> {
    let current = transaction
        .query_row(
            r#"
            SELECT state, remote_unified_app_id, app_key, robot_code,
                   credential_ref, version
            FROM dingtalk_member_bot_publication_intent WHERE id = ?1
            "#,
            [&command.publication_intent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((state, unified_app_id, app_key, robot_code, credential_ref, version)) = current
    else {
        return Ok(rejected(
            "dingtalk_publication_intent.not_found",
            "DingTalk publication intent does not exist",
        ));
    };
    if version != command.expected_intent_version {
        return Ok(version_conflict(version));
    }
    if !dingtalk_publication_transition_allowed(&state, "credentials_read") {
        return Ok(rejected(
            "dingtalk_publication_intent.invalid_transition",
            "Credential storage requires the credentials_read transition",
        ));
    }
    if unified_app_id.is_none()
        || app_key
            .as_deref()
            .is_some_and(|current| current != command.remote_app_id)
        || credential_ref
            .as_deref()
            .is_some_and(|current| current != command.credential_ref)
        || credential_identity_conflict(
            transaction,
            DINGTALK_PROVIDER,
            &command.credential_ref,
            &command.remote_app_id,
        )?
    {
        return Ok(rejected(
            "channel_credential.identity_conflict",
            "Credential does not belong to the frozen DingTalk App",
        ));
    }
    let payload_robot_code = payload.get("robotCode").and_then(Value::as_str).unwrap();
    if robot_code
        .as_deref()
        .is_some_and(|current| current != payload_robot_code)
    {
        return Ok(rejected(
            "dingtalk_publication_intent.robot_conflict",
            "Credential cannot change the frozen robot identity",
        ));
    }
    let revision = upsert_credential_row(
        transaction,
        DINGTALK_PROVIDER,
        &command.credential_ref,
        &command.remote_app_id,
        payload,
    )?;
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE dingtalk_member_bot_publication_intent
        SET state = 'credentials_read', app_key = ?2, robot_code = ?3,
            credential_ref = ?4, last_completed_step = 'credentials_read',
            failure_code = NULL, version = version + 1, updated_at = ?5
        WHERE id = ?1 AND version = ?6
        "#,
        params![
            command.publication_intent_id,
            command.remote_app_id,
            payload_robot_code,
            command.credential_ref,
            now,
            version,
        ],
    )?;
    Ok(CommandHandlerResult::applied(
        "dingtalk_publication_intent.credential_stored",
        json!({
            "publicationIntentId": command.publication_intent_id,
            "credentialRef": command.credential_ref,
            "credentialRevision": revision,
            "version": version + 1,
        }),
        None,
    ))
}

fn is_owner(actor: &ActorRef) -> bool {
    matches!(actor, ActorRef::User { user_id } if user_id == CURRENT_USER_ID)
}

fn is_channel_host(actor: &ActorRef) -> bool {
    matches!(
        actor,
        ActorRef::System { component_id }
            if component_id == FEISHU_CHANNEL_HOST_COMPONENT
                || component_id == DINGTALK_CHANNEL_HOST_COMPONENT
    )
}

fn channel_host_provider(actor: &ActorRef) -> Option<&'static str> {
    match actor {
        ActorRef::System { component_id } if component_id == FEISHU_CHANNEL_HOST_COMPONENT => {
            Some(FEISHU_PROVIDER)
        }
        ActorRef::System { component_id } if component_id == DINGTALK_CHANNEL_HOST_COMPONENT => {
            Some(DINGTALK_PROVIDER)
        }
        _ => None,
    }
}

fn is_channel_host_for_provider(actor: &ActorRef, provider: &str) -> bool {
    channel_host_provider(actor) == Some(provider)
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

fn dingtalk_member_bot_publication_ready(
    transaction: &Transaction<'_>,
    command: &UpsertDingTalkMemberBotCommand,
) -> Result<bool> {
    Ok(transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM dingtalk_member_bot_publication_intent
            WHERE agent_id = ?1 AND account_id = ?2
              AND remote_unified_app_id = ?3 AND app_key = ?4
              AND robot_code = ?5 AND credential_ref = ?6
              AND state = 'version_released'
        )
        "#,
        params![
            command.agent_id,
            command.account_id,
            command.unified_app_id,
            command.app_key,
            command.robot_code,
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

    fn dingtalk_host_envelope<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: DINGTALK_CHANNEL_HOST_COMPONENT.to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn provider_host_envelope<P>(
        provider: &str,
        command_id: &str,
        payload: P,
    ) -> CommandEnvelope<P> {
        if provider == DINGTALK_PROVIDER {
            dingtalk_host_envelope(command_id, payload)
        } else {
            host_envelope(command_id, payload)
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
                        user_id_digest: owner_user_digest(),
                        tenant_id: "tenant_1".to_string(),
                        user_name: "Owner".to_string(),
                        email: Some("owner@example.com".to_string()),
                        tenant_name: "测试租户".to_string(),
                        brand: "feishu".to_string(),
                    },
                ),
            )
            .unwrap();
    }

    fn owner_user_digest() -> String {
        opaque_digest("feishu-user", "user_1")
    }

    fn dingtalk_owner_user_digest() -> String {
        opaque_digest("dingtalk-user", "owner-staff-1")
    }

    #[test]
    fn sqlite_channel_storage_keeps_connection_and_publication_transitions_atomic() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        let agent_id: String = database
            .connection()
            .query_row(
                "SELECT id FROM agent_profile ORDER BY member_order LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let account_id = "account-sqlite";
        let identity = json!({
            "brand": "feishu",
            "userId": "user-sqlite",
            "userName": "Owner",
            "email": "owner@example.com",
            "tenantId": "tenant-sqlite",
            "tenantName": "测试租户"
        });
        let session = json!({
            "cookies": [{
                "name": "session",
                "value": "plaintext-cookie",
                "domain": ".feishu.cn",
                "path": "/",
                "secure": true,
                "httpOnly": true,
                "sameSite": "lax",
                "session": true
            }]
        });
        let connected = service
            .commit_feishu_account_connection(
                &mut database,
                &host_envelope(
                    "sqlite-connect",
                    CommitFeishuAccountConnectionCommand {
                        expected_previous_account_version: None,
                        account: FeishuConnectionAccountInput {
                            account_id: account_id.to_string(),
                            user_id_digest: opaque_digest("feishu-user", "user-sqlite"),
                            tenant_id: "tenant-sqlite".to_string(),
                            user_name: "Owner".to_string(),
                            email: Some("owner@example.com".to_string()),
                            tenant_name: "测试租户".to_string(),
                            brand: "feishu".to_string(),
                        },
                        developer_session: ChannelDeveloperSessionInput {
                            identity: identity.clone(),
                            session: session.clone(),
                        },
                    },
                ),
            )
            .unwrap();
        assert_eq!(connected.result.status, CommandResultStatus::Applied);
        assert_eq!(connected.result.payload["sessionRevision"], 1);
        let stored_session = service
            .channel_developer_session(
                &mut database,
                &GetChannelDeveloperSessionParams {
                    provider: FEISHU_PROVIDER.to_string(),
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(stored_session.identity, identity);
        assert_eq!(stored_session.session, session);

        let stale_switch = service
            .commit_feishu_account_connection(
                &mut database,
                &host_envelope(
                    "sqlite-stale-switch",
                    CommitFeishuAccountConnectionCommand {
                        expected_previous_account_version: None,
                        account: FeishuConnectionAccountInput {
                            account_id: "account-other".to_string(),
                            user_id_digest: opaque_digest("feishu-user", "user-other"),
                            tenant_id: "tenant-other".to_string(),
                            user_name: "Other".to_string(),
                            email: None,
                            tenant_name: "其他租户".to_string(),
                            brand: "feishu".to_string(),
                        },
                        developer_session: ChannelDeveloperSessionInput {
                            identity: json!({
                                "brand": "feishu", "userId": "user-other",
                                "userName": "Other", "tenantId": "tenant-other",
                                "tenantName": "其他租户"
                            }),
                            session: json!({"cookies": []}),
                        },
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale_switch.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            service
                .channel_developer_session(
                    &mut database,
                    &GetChannelDeveloperSessionParams {
                        provider: FEISHU_PROVIDER.to_string(),
                    },
                )
                .unwrap()
                .unwrap()
                .identity,
            identity
        );

        let intent_id = "intent-sqlite";
        service
            .create_member_bot_publication_intent(
                &mut database,
                &host_envelope(
                    "sqlite-intent",
                    CreateMemberBotPublicationIntentCommand {
                        publication_intent_id: intent_id.to_string(),
                        account_id: account_id.to_string(),
                        agent_id: agent_id.clone(),
                        expected_user_id_digest: opaque_digest("feishu-user", "user-sqlite"),
                        expected_tenant_id: "tenant-sqlite".to_string(),
                        requested_app_name: "SQLite Bot".to_string(),
                        provisioning_mode: "developer_session".to_string(),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state, app_id) in [
            (1, "session_verified", None),
            (2, "app_created", Some("cli-sqlite")),
        ] {
            service
                .advance_member_bot_publication_intent(
                    &mut database,
                    &host_envelope(
                        &format!("sqlite-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: intent_id.to_string(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: app_id.map(str::to_string),
                            credential_ref: None,
                            last_completed_step: Some(state.to_string()),
                            failure_code: None,
                        },
                    ),
                )
                .unwrap();
        }
        let credential_ref = "feishu-sqlite";
        let stored = service
            .store_publication_credential(
                &mut database,
                &host_envelope(
                    "sqlite-store-credential",
                    StorePublicationCredentialCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        publication_intent_id: intent_id.to_string(),
                        expected_intent_version: 3,
                        credential_ref: credential_ref.to_string(),
                        remote_app_id: "cli-sqlite".to_string(),
                        credential: json!({"appSecret": "plaintext-app-secret"}),
                    },
                ),
            )
            .unwrap();
        assert_eq!(stored.result.status, CommandResultStatus::Applied);
        assert_eq!(stored.result.payload["version"], 4);
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT intent.state, credential.payload_json
                    FROM feishu_member_bot_publication_intent AS intent
                    JOIN channel_credentials AS credential
                      ON credential.credential_ref = intent.credential_ref
                    WHERE intent.id = ?1
                    "#,
                    [intent_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .unwrap(),
            (
                "credentials_read".to_string(),
                r#"{"appSecret":"plaintext-app-secret"}"#.to_string(),
            )
        );
        for (expected_version, state) in [(4, "bot_configured"), (5, "version_published")] {
            service
                .advance_member_bot_publication_intent(
                    &mut database,
                    &host_envelope(
                        &format!("sqlite-{state}"),
                        AdvanceMemberBotPublicationIntentCommand {
                            publication_intent_id: intent_id.to_string(),
                            expected_version,
                            state: state.to_string(),
                            remote_app_id: Some("cli-sqlite".to_string()),
                            credential_ref: Some(credential_ref.to_string()),
                            last_completed_step: Some(state.to_string()),
                            failure_code: None,
                        },
                    ),
                )
                .unwrap();
        }
        service
            .upsert_feishu_member_bot(
                &mut database,
                &host_envelope(
                    "sqlite-publish-bot",
                    UpsertFeishuMemberBotCommand {
                        account_id: account_id.to_string(),
                        agent_id: agent_id.clone(),
                        app_id: "cli-sqlite".to_string(),
                        owner_open_id: "ou-owner-sqlite".to_string(),
                        bot_open_id: None,
                        bot_display_name: "SQLite Bot".to_string(),
                        credential_ref: credential_ref.to_string(),
                    },
                ),
            )
            .unwrap();
        let published = service
            .published_channel_credentials(&mut database)
            .unwrap();
        assert_eq!(published.len(), 1);
        assert_eq!(published[0].agent_id, agent_id);
        assert_eq!(published[0].payload["appSecret"], "plaintext-app-secret");
    }

    fn connect_dingtalk_account(service: &ChannelService, database: &mut Database) {
        service
            .upsert_dingtalk_account(
                database,
                &dingtalk_host_envelope(
                    "dingtalk-account",
                    UpsertDingTalkAccountCommand {
                        account_id: "dingtalk-account-1".to_string(),
                        user_id_digest: dingtalk_owner_user_digest(),
                        corp_id: "ding-corp-1".to_string(),
                        user_name: "Owner".to_string(),
                        corp_name: "测试组织".to_string(),
                        oauth_profile_ref: "dingtalk/oauth/profile-1".to_string(),
                    },
                ),
            )
            .unwrap();
    }

    fn advance_dingtalk_publication(
        service: &ChannelService,
        database: &mut Database,
        agent_id: &str,
        expected_version: i64,
        state: &str,
        approval_mode: Option<&str>,
        approver_user_id_digest: Option<String>,
    ) -> CommandExecution {
        let remote_unified_app_id =
            dingtalk_state_requires_app(state).then(|| format!("ding-unified-{agent_id}"));
        let app_key =
            dingtalk_state_requires_credentials(state).then(|| format!("ding-app-{agent_id}"));
        let robot_code =
            dingtalk_state_requires_robot(state).then(|| format!("ding-robot-{agent_id}"));
        let credential_ref = dingtalk_state_requires_credentials(state)
            .then(|| format!("dingtalk/member/{agent_id}"));
        let version_id =
            dingtalk_state_requires_version(state).then(|| format!("ding-version-{agent_id}"));
        service
            .advance_dingtalk_publication_intent(
                database,
                &dingtalk_host_envelope(
                    &format!("dingtalk-{agent_id}-{state}-{expected_version}"),
                    AdvanceDingTalkPublicationIntentCommand {
                        publication_intent_id: format!("dingtalk-intent-{agent_id}"),
                        expected_version,
                        state: state.to_string(),
                        remote_unified_app_id,
                        app_key,
                        robot_code,
                        credential_ref,
                        version_id,
                        approval_mode: approval_mode.map(str::to_string),
                        approver_user_id_digest,
                        last_completed_step: Some(state.to_string()),
                        failure_code: None,
                    },
                ),
            )
            .unwrap()
    }

    fn publish_dingtalk_bot(service: &ChannelService, database: &mut Database, agent_id: &str) {
        service
            .create_dingtalk_publication_intent(
                database,
                &dingtalk_host_envelope(
                    &format!("dingtalk-create-{agent_id}"),
                    CreateDingTalkPublicationIntentCommand {
                        publication_intent_id: format!("dingtalk-intent-{agent_id}"),
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: agent_id.to_string(),
                        expected_user_id_digest: dingtalk_owner_user_digest(),
                        expected_corp_id: "ding-corp-1".to_string(),
                        requested_app_name: agent_id.to_string(),
                        provisioning_mode: "direct_open_platform".to_string(),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state) in [
            (1, "account_verified"),
            (2, "app_created"),
            (3, "credentials_read"),
            (4, "avatar_configured"),
            (5, "robot_configured"),
            (6, "permissions_configured"),
            (7, "version_created"),
            (8, "version_released"),
        ] {
            let advanced = advance_dingtalk_publication(
                service,
                database,
                agent_id,
                expected_version,
                state,
                Some("NO_APPROVAL"),
                None,
            );
            assert_eq!(advanced.result.status, CommandResultStatus::Applied);
        }
        service
            .upsert_dingtalk_member_bot(
                database,
                &dingtalk_host_envelope(
                    &format!("dingtalk-publish-{agent_id}"),
                    UpsertDingTalkMemberBotCommand {
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: agent_id.to_string(),
                        unified_app_id: format!("ding-unified-{agent_id}"),
                        app_key: format!("ding-app-{agent_id}"),
                        robot_code: format!("ding-robot-{agent_id}"),
                        owner_user_id: "owner-staff-1".to_string(),
                        bot_display_name: agent_id.to_string(),
                        credential_ref: format!("dingtalk/member/{agent_id}"),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state) in [
            (9, "stream_verified"),
            (10, "card_verified"),
            (11, "completed"),
        ] {
            let advanced = advance_dingtalk_publication(
                service,
                database,
                agent_id,
                expected_version,
                state,
                Some("NO_APPROVAL"),
                None,
            );
            assert_eq!(advanced.result.status, CommandResultStatus::Applied);
        }
    }

    fn quick_chat_path(database: &Database) -> std::path::PathBuf {
        let path = database.path().parent().unwrap().join("quick-chat");
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn insert_pending_topic_delivery(
        database: &Database,
        camp_id: &str,
        recipient_agent_id: &str,
    ) -> String {
        let (camp_turn_id, source_agent_run_id): (String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT run.camp_turn_id, run.id
                FROM agent_run AS run
                JOIN conversation ON conversation.id = run.conversation_id
                WHERE conversation.camp_id = ?1 AND conversation.agent_id = 'agent_1'
                LIMIT 1
                "#,
                [camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let recipient_membership_version: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT version FROM camp_member
                WHERE camp_id = ?1 AND agent_id = ?2
                  AND status = 'active' AND leave_requested_at IS NULL
                "#,
                params![camp_id, recipient_agent_id],
                |row| row.get(0),
            )
            .unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE camp
                SET last_message_sequence = last_message_sequence + 1,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![camp_id, now],
            )
            .unwrap();
        let camp_sequence: i64 = database
            .connection()
            .query_row(
                "SELECT last_message_sequence FROM camp WHERE id = ?1",
                [camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let message_id = format!("topic-message-{recipient_agent_id}");
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence,
                    author_type, author_id, source_agent_run_id, body,
                    structured_content_json, content_digest,
                    address_mode, addressed_agent_ids_json,
                    camp_turn_id, agent_run_id,
                    version, created_at, updated_at,
                    effective_recipient_ids_json, recipient_set_digest,
                    recipient_presentation_json, source_operation_id,
                    agent_addressing_mode
                ) VALUES (
                    ?1, ?2, ?3,
                    'agent', 'agent_1', ?4, '调用协作队员',
                    '[{"kind":"text","text":"调用协作队员"}]', 'message-digest',
                    'explicit', ?5,
                    ?6, ?4,
                    1, ?7, ?7,
                    ?5, 'recipient-set-digest', '[]', ?1, 'automatic'
                )
                "#,
                params![
                    message_id,
                    camp_id,
                    camp_sequence,
                    source_agent_run_id,
                    serde_json::to_string(&vec![recipient_agent_id]).unwrap(),
                    camp_turn_id,
                    now,
                ],
            )
            .unwrap();
        let project_path: String = database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = ?1",
                [camp_id],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET workspace_json = ?2 WHERE id = ?1",
                params![
                    source_agent_run_id,
                    serde_json::to_string(
                        &crate::runtime::AgentRunWorkspace::runtime_managed_path(project_path)
                    )
                    .unwrap(),
                ],
            )
            .unwrap();
        let delivery_id = format!("topic-delivery-{recipient_agent_id}");
        database
            .connection()
            .execute(
                r#"
                INSERT INTO message_delivery(
                    id, camp_id, camp_turn_id, message_id,
                    recipient_agent_id, recipient_canonical_position,
                    recipient_digest, message_body_digest,
                    source_agent_run_id, edge_kind,
                    target_parent_agent_run_id, a2a_root_agent_run_id, a2a_depth,
                    ancestor_agent_ids_json, recipient_presentation_snapshot_json,
                    frozen_snapshot_json, delivery_kind, dispatch_disposition,
                    completion_role, camp_message_boundary_sequence, queue_sequence,
                    status, dispatch_phase, retry_generation,
                    created_at, updated_at, recipient_membership_version_at_admission
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, 0,
                    'recipient-digest', 'message-digest',
                    ?6, 'forward', ?6, ?6, 1,
                    '[]', '{}',
                    '{"schemaVersion":3,"deliveryKind":"public_a2a","dispatchDisposition":"dispatch","completionRole":"required"}',
                    'public_a2a', 'dispatch', 'required', ?7, 1,
                    'pending', 'never_attempted', 0, ?8, ?8, ?9
                )
                "#,
                params![
                    delivery_id,
                    camp_id,
                    camp_turn_id,
                    message_id,
                    recipient_agent_id,
                    source_agent_run_id,
                    camp_sequence,
                    now,
                    recipient_membership_version,
                ],
            )
            .unwrap();
        delivery_id
    }

    fn execution_console_page_command(
        source: &ChannelExecutionConsoleSourceView,
        app_id: &str,
        external_message_id: &str,
        page_index: i64,
        page_count: i64,
        owner: bool,
    ) -> AuthorizeChannelExecutionConsolePageCommand {
        AuthorizeChannelExecutionConsolePageCommand {
            agent_run_id: source.agent_run_id.clone(),
            app_id: app_id.to_string(),
            external_message_id: external_message_id.to_string(),
            snapshot_sequence: source.sequence,
            page_index,
            page_count,
            operator_open_id: Some(if owner { "ou_user" } else { "ou_other" }.to_string()),
            operator_user_id: Some(if owner { "user_1" } else { "user_other" }.to_string()),
            operator_union_id: Some(if owner { "union_user" } else { "union_other" }.to_string()),
        }
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
                        expected_user_id_digest: owner_user_digest(),
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
                        owner_open_id: "ou_user".to_string(),
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

    fn seed_project(database: &Database, suffix: &str) -> std::path::PathBuf {
        let path = database
            .path()
            .parent()
            .unwrap()
            .join(format!("channel-project-{suffix}"));
        std::fs::create_dir_all(&path).unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, name_origin, collaboration_mode,
                    project_binding_kind, project_path,
                    default_lead_agent_id, activation_state, last_message_sequence,
                    membership_generation, version, created_at, updated_at
                ) VALUES (?1, ?2, 'user', 'peer', 'directory', ?3,
                          'agent_1', 'active', 0, 1, 1, ?4, ?4)
                "#,
                params![
                    format!("seed-project-{suffix}"),
                    format!("项目 {suffix}"),
                    path.to_string_lossy(),
                    now
                ],
            )
            .unwrap();
        path
    }

    fn resolve_pending(
        service: &ChannelService,
        database: &mut Database,
        pending_binding_id: &str,
        command_id: &str,
    ) -> CommandExecution {
        resolve_pending_for_provider(
            service,
            database,
            pending_binding_id,
            command_id,
            FEISHU_PROVIDER,
        )
    }

    fn resolve_pending_for_provider(
        service: &ChannelService,
        database: &mut Database,
        pending_binding_id: &str,
        command_id: &str,
        provider: &str,
    ) -> CommandExecution {
        let existing_picker = database
            .connection()
            .query_row(
                r#"
                SELECT delivery.target_app_id, delivery.payload_json,
                       delivery.external_delivery_message_id
                FROM channel_delivery AS delivery
                JOIN pending_camp_binding AS pending
                  ON pending.id = delivery.pending_binding_id
                WHERE pending.id = ?1 AND delivery.delivery_kind = 'project_selection'
                  AND delivery.status = 'sent'
                  AND delivery.external_delivery_message_id IS NOT NULL
                  AND json_extract(delivery.payload_json, '$.placement') = 'conversation'
                  AND COALESCE(
                      json_extract(delivery.payload_json, '$.operation'), 'send'
                  ) IN ('send', 'update')
                  AND CAST(
                      json_extract(delivery.payload_json, '$.expectedVersion') AS INTEGER
                  ) = pending.version
                ORDER BY delivery.ended_at DESC, delivery.id DESC
                LIMIT 1
                "#,
                [pending_binding_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .unwrap();
        let (app_id, payload, picker_message_id) =
            if let Some((app_id, payload, message_id)) = existing_picker {
                (app_id, serde_json::from_str(&payload).unwrap(), message_id)
            } else {
                let picker_message_id = format!("om_picker_{pending_binding_id}");
                let worker_id = format!("{command_id}-picker-worker");
                let tick = service
                    .host_tick(
                        database,
                        &provider_host_envelope(
                            provider,
                            &format!("{command_id}-picker-tick"),
                            ChannelHostTickCommand {
                                worker_id: worker_id.clone(),
                                limit: 20,
                            },
                        ),
                    )
                    .unwrap();
                let picker = tick.result.payload["deliveries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|delivery| {
                        delivery["deliveryKind"] == "project_selection"
                            && delivery["payload"]["operation"] != "recall"
                    })
                    .unwrap();
                let delivery_id = picker["deliveryId"].as_str().unwrap().to_string();
                let app_id = picker["targetAppId"].as_str().unwrap().to_string();
                let payload = picker["payload"].clone();
                service
                    .settle_delivery(
                        database,
                        &provider_host_envelope(
                            provider,
                            &format!("{command_id}-picker-sent"),
                            SettleChannelDeliveryCommand {
                                delivery_id,
                                worker_id,
                                outcome: "sent".to_string(),
                                external_delivery_message_id: Some(picker_message_id.clone()),
                                failure_code: None,
                                retryable: false,
                            },
                        ),
                    )
                    .unwrap();
                (app_id, payload, picker_message_id)
            };
        let project_id: String = database
            .connection()
            .query_row(
                "SELECT id FROM project_catalog_item WHERE status = 'active' ORDER BY last_opened_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        service
            .resolve_pending_camp_binding(
                database,
                &provider_host_envelope(
                    provider,
                    command_id,
                    ResolvePendingCampBindingCommand {
                        pending_binding_id: pending_binding_id.to_string(),
                        app_id,
                        external_picker_message_id: picker_message_id,
                        action: "bind".to_string(),
                        project_id: Some(project_id),
                        expected_version: payload["expectedVersion"].as_i64().unwrap(),
                        nonce: payload["nonce"].as_str().unwrap().to_string(),
                        operator_open_id: (provider == FEISHU_PROVIDER)
                            .then(|| "ou_user".to_string()),
                        operator_user_id: Some(if provider == DINGTALK_PROVIDER {
                            "owner-staff-1".to_string()
                        } else {
                            "ignored-envelope-user".to_string()
                        }),
                        operator_union_id: (provider == FEISHU_PROVIDER)
                            .then(|| "union_user".to_string()),
                    },
                ),
            )
            .unwrap()
    }

    #[test]
    fn non_owner_is_rejected_before_any_channel_business_fact() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        let mut command = observation_command(
            "cli_app_1",
            "om_non_owner",
            "oc_private_non_owner",
            "",
            "p2p",
            "尝试触发",
            &[("agent_1", "cli_app_1")],
            true,
        );
        command.sender_external_user_id = "other_union".to_string();
        command.sender_open_id = Some("ou_other".to_string());
        command.sender_user_id = Some("user_other".to_string());
        command.sender_union_id = Some("other_union".to_string());
        let rejected = service
            .observe_inbound(&mut database, &host_envelope("observe-non-owner", command))
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "channel.owner_required");
        for table in [
            "external_principal",
            "channel_conversation",
            "channel_inbound_aggregate",
        ] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must not be created for a non-owner");
        }
    }

    #[test]
    fn dingtalk_publication_requires_explicit_approver_and_freezes_the_app_binding() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_dingtalk_account(&service, &mut database);
        service
            .create_dingtalk_publication_intent(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-approval-create",
                    CreateDingTalkPublicationIntentCommand {
                        publication_intent_id: "dingtalk-intent-agent_1".to_string(),
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: "agent_1".to_string(),
                        expected_user_id_digest: dingtalk_owner_user_digest(),
                        expected_corp_id: "ding-corp-1".to_string(),
                        requested_app_name: "木瓦".to_string(),
                        provisioning_mode: "direct_open_platform".to_string(),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state) in [
            (1, "account_verified"),
            (2, "app_created"),
            (3, "credentials_read"),
            (4, "avatar_configured"),
            (5, "robot_configured"),
            (6, "permissions_configured"),
            (7, "version_created"),
        ] {
            let advanced = advance_dingtalk_publication(
                &service,
                &mut database,
                "agent_1",
                expected_version,
                state,
                None,
                None,
            );
            assert_eq!(advanced.result.status, CommandResultStatus::Applied);
        }

        let missing_approver = advance_dingtalk_publication(
            &service,
            &mut database,
            "agent_1",
            8,
            "awaiting_approval",
            Some("SELECT_APPROVER"),
            None,
        );
        assert_eq!(
            missing_approver.result.status,
            CommandResultStatus::Rejected
        );
        assert_eq!(
            missing_approver.result.code,
            "dingtalk_publication_intent.approver_required"
        );
        let selecting = advance_dingtalk_publication(
            &service,
            &mut database,
            "agent_1",
            8,
            "awaiting_approver_selection",
            Some("SELECT_APPROVER"),
            None,
        );
        assert_eq!(selecting.result.status, CommandResultStatus::Applied);
        let approver_digest = opaque_digest("dingtalk-user", "approver-1");
        let released = advance_dingtalk_publication(
            &service,
            &mut database,
            "agent_1",
            9,
            "version_released",
            Some("SELECT_APPROVER"),
            Some(approver_digest),
        );
        assert_eq!(released.result.status, CommandResultStatus::Applied);

        let published = service
            .upsert_dingtalk_member_bot(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-approval-publish",
                    UpsertDingTalkMemberBotCommand {
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: "agent_1".to_string(),
                        unified_app_id: "ding-unified-agent_1".to_string(),
                        app_key: "ding-app-agent_1".to_string(),
                        robot_code: "ding-robot-agent_1".to_string(),
                        owner_user_id: "owner-staff-1".to_string(),
                        bot_display_name: "木瓦".to_string(),
                        credential_ref: "dingtalk/member/agent_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(published.result.status, CommandResultStatus::Applied);
        let rebound = service
            .upsert_dingtalk_member_bot(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-approval-rebind",
                    UpsertDingTalkMemberBotCommand {
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: "agent_1".to_string(),
                        unified_app_id: "ding-unified-other".to_string(),
                        app_key: "ding-app-other".to_string(),
                        robot_code: "ding-robot-other".to_string(),
                        owner_user_id: "owner-staff-1".to_string(),
                        bot_display_name: "木瓦".to_string(),
                        credential_ref: "dingtalk/member/other".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(rebound.result.status, CommandResultStatus::Rejected);
        assert_eq!(rebound.result.code, "dingtalk_member_bot.binding_immutable");

        let snapshot = service.dingtalk_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.account.unwrap().corp_id, "ding-corp-1");
        assert_eq!(snapshot.member_bots.len(), 1);
        assert_eq!(snapshot.member_bots[0].app_key, "ding-app-agent_1");
        assert_eq!(snapshot.publication_intents[0].state, "version_released");
    }

    #[test]
    fn dingtalk_recoverable_publication_reenters_its_durable_watermark() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_dingtalk_account(&service, &mut database);
        service
            .create_dingtalk_publication_intent(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-recovery-create",
                    CreateDingTalkPublicationIntentCommand {
                        publication_intent_id: "dingtalk-intent-agent_1".to_string(),
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: "agent_1".to_string(),
                        expected_user_id_digest: dingtalk_owner_user_digest(),
                        expected_corp_id: "ding-corp-1".to_string(),
                        requested_app_name: "木瓦".to_string(),
                        provisioning_mode: "direct_open_platform".to_string(),
                    },
                ),
            )
            .unwrap();
        for (expected_version, state) in [
            (1, "account_verified"),
            (2, "app_created"),
            (3, "credentials_read"),
        ] {
            let advanced = advance_dingtalk_publication(
                &service,
                &mut database,
                "agent_1",
                expected_version,
                state,
                None,
                None,
            );
            assert_eq!(advanced.result.status, CommandResultStatus::Applied);
        }
        let failed = service
            .advance_dingtalk_publication_intent(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-recovery-failed",
                    AdvanceDingTalkPublicationIntentCommand {
                        publication_intent_id: "dingtalk-intent-agent_1".to_string(),
                        expected_version: 4,
                        state: "failed_recoverable".to_string(),
                        remote_unified_app_id: Some("ding-unified-agent_1".to_string()),
                        app_key: Some("ding-app-agent_1".to_string()),
                        robot_code: None,
                        credential_ref: Some("dingtalk/member/agent_1".to_string()),
                        version_id: None,
                        approval_mode: None,
                        approver_user_id_digest: None,
                        last_completed_step: Some("credentials_read".to_string()),
                        failure_code: Some("dingtalk_open_platform_timeout".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(failed.result.status, CommandResultStatus::Applied);

        let recovered = advance_dingtalk_publication(
            &service,
            &mut database,
            "agent_1",
            5,
            "credentials_read",
            None,
            None,
        );
        assert_eq!(recovered.result.status, CommandResultStatus::Applied);
        let snapshot = service.dingtalk_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.publication_intents[0].state, "credentials_read");
        assert_eq!(snapshot.publication_intents[0].failure_code, None);

        service
            .create_dingtalk_publication_intent(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-unknown-create",
                    CreateDingTalkPublicationIntentCommand {
                        publication_intent_id: "dingtalk-intent-agent_2".to_string(),
                        account_id: "dingtalk-account-1".to_string(),
                        agent_id: "agent_2".to_string(),
                        expected_user_id_digest: dingtalk_owner_user_digest(),
                        expected_corp_id: "ding-corp-1".to_string(),
                        requested_app_name: "岩兰".to_string(),
                        provisioning_mode: "direct_open_platform".to_string(),
                    },
                ),
            )
            .unwrap();
        let verified = advance_dingtalk_publication(
            &service,
            &mut database,
            "agent_2",
            1,
            "account_verified",
            None,
            None,
        );
        assert_eq!(verified.result.status, CommandResultStatus::Applied);
        let unknown = service
            .advance_dingtalk_publication_intent(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-create-unknown",
                    AdvanceDingTalkPublicationIntentCommand {
                        publication_intent_id: "dingtalk-intent-agent_2".to_string(),
                        expected_version: 2,
                        state: "failed_unknown_remote_state".to_string(),
                        remote_unified_app_id: None,
                        app_key: None,
                        robot_code: None,
                        credential_ref: None,
                        version_id: None,
                        approval_mode: None,
                        approver_user_id_digest: None,
                        last_completed_step: Some("account_verified".to_string()),
                        failure_code: Some("dingtalk_app_create_unknown_remote_state".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(unknown.result.status, CommandResultStatus::Applied);
        let unsafe_retry = service
            .advance_dingtalk_publication_intent(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-create-unknown-retry",
                    AdvanceDingTalkPublicationIntentCommand {
                        publication_intent_id: "dingtalk-intent-agent_2".to_string(),
                        expected_version: 3,
                        state: "failed_recoverable".to_string(),
                        remote_unified_app_id: None,
                        app_key: None,
                        robot_code: None,
                        credential_ref: None,
                        version_id: None,
                        approval_mode: None,
                        approver_user_id_digest: None,
                        last_completed_step: Some("account_verified".to_string()),
                        failure_code: Some("retry_requested".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(unsafe_retry.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            unsafe_retry.result.code,
            "dingtalk_publication_intent.reconciliation_remote_app_required"
        );
    }

    #[test]
    fn dingtalk_owner_dm_reuses_atomic_admission_and_topics_fail_closed() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_dingtalk_account(&service, &mut database);
        publish_dingtalk_bot(&service, &mut database, "agent_1");
        let verified = service
            .verify_feishu_owner(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-owner-verify",
                    VerifyFeishuOwnerCommand {
                        provider: DINGTALK_PROVIDER.to_string(),
                        app_id: "ding-app-agent_1".to_string(),
                        tenant_key: "ding-corp-1".to_string(),
                        sender_open_id: None,
                        sender_user_id: Some("owner-staff-1".to_string()),
                        sender_union_id: None,
                        sender_display_name: "Owner".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(verified.result.payload["classification"], "owner");
        let quick_chat_path = quick_chat_path(&database);
        let started = service
            .start_new_feishu_dm(
                &mut database,
                &quick_chat_path,
                &dingtalk_host_envelope(
                    "dingtalk-dm-new",
                    StartNewFeishuDmCommand {
                        provider: DINGTALK_PROVIDER.to_string(),
                        app_id: "ding-app-agent_1".to_string(),
                        tenant_key: "ding-corp-1".to_string(),
                        chat_id: "ding-dm-1".to_string(),
                        conversation_display_name: "Owner 与木瓦".to_string(),
                        target_agent_id: "agent_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(started.result.status, CommandResultStatus::Applied);

        let mut observation = observation_command(
            "ding-app-agent_1",
            "ding-message-1",
            "ding-dm-1",
            "",
            "p2p",
            "帮我检查登录模块",
            &[("agent_1", "ding-app-agent_1")],
            false,
        );
        observation.provider = DINGTALK_PROVIDER.to_string();
        observation.tenant_key = "ding-corp-1".to_string();
        observation.sender_external_user_id = "owner-staff-1".to_string();
        observation.sender_open_id = None;
        observation.sender_user_id = Some("owner-staff-1".to_string());
        observation.sender_union_id = None;
        let observed = service
            .observe_inbound(
                &mut database,
                &dingtalk_host_envelope("dingtalk-observe", observation),
            )
            .unwrap();
        assert_eq!(observed.result.code, "channel.inbound.collecting");
        assert_eq!(observed.result.payload["readyToFinalize"], false);
        let wrong_host = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "dingtalk-finalize-wrong-host",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observed.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(wrong_host.result.status, CommandResultStatus::Rejected);
        assert_eq!(wrong_host.result.code, "channel.host_required");
        let incomplete = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &dingtalk_host_envelope(
                    "dingtalk-finalize-incomplete",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observed.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(incomplete.result.status, CommandResultStatus::Rejected);
        assert_eq!(incomplete.result.code, "channel.inbound.not_ready");
        let mut completed_observation = observation_command(
            "ding-app-agent_1",
            "ding-message-1",
            "ding-dm-1",
            "",
            "p2p",
            "帮我检查登录模块",
            &[("agent_1", "ding-app-agent_1")],
            true,
        );
        completed_observation.provider = DINGTALK_PROVIDER.to_string();
        completed_observation.tenant_key = "ding-corp-1".to_string();
        completed_observation.sender_external_user_id = "owner-staff-1".to_string();
        completed_observation.sender_open_id = None;
        completed_observation.sender_user_id = Some("owner-staff-1".to_string());
        completed_observation.sender_union_id = None;
        let completed = service
            .observe_inbound(
                &mut database,
                &dingtalk_host_envelope("dingtalk-observe-complete", completed_observation),
            )
            .unwrap();
        assert_eq!(completed.result.payload["readyToFinalize"], true);
        let finalized = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &dingtalk_host_envelope(
                    "dingtalk-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observed.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(finalized.result.code, "channel.turn.admitted");
        for table in ["camp_message", "camp_turn", "agent_run"] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "DingTalk must reuse atomic admission for {table}");
        }

        let aggregate_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM channel_inbound_aggregate",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut topic = observation_command(
            "ding-app-agent_1",
            "ding-topic-message-1",
            "ding-group-1",
            "ding-thread-1",
            "topic",
            "不应进入 Core",
            &[("agent_1", "ding-app-agent_1")],
            true,
        );
        topic.provider = DINGTALK_PROVIDER.to_string();
        topic.tenant_key = "ding-corp-1".to_string();
        topic.sender_external_user_id = "owner-staff-1".to_string();
        topic.sender_open_id = None;
        topic.sender_user_id = Some("owner-staff-1".to_string());
        topic.sender_union_id = None;
        let error = service
            .observe_inbound(
                &mut database,
                &dingtalk_host_envelope("dingtalk-topic-reject", topic),
            )
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("DingTalk topic admission is disabled")
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM channel_inbound_aggregate",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            aggregate_count,
            "a disabled DingTalk topic must not create transport facts"
        );
    }

    #[test]
    fn dingtalk_incomplete_canonical_observation_times_out_after_the_collecting_window() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_dingtalk_account(&service, &mut database);
        publish_dingtalk_bot(&service, &mut database, "agent_1");
        let mut observation = observation_command(
            "ding-app-agent_1",
            "ding-timeout-message-1",
            "ding-dm-timeout-1",
            "",
            "p2p",
            "这条 observation 尚未完成 canonical 证明",
            &[("agent_1", "ding-app-agent_1")],
            false,
        );
        observation.provider = DINGTALK_PROVIDER.to_string();
        observation.tenant_key = "ding-corp-1".to_string();
        observation.sender_external_user_id = "owner-staff-1".to_string();
        observation.sender_open_id = None;
        observation.sender_user_id = Some("owner-staff-1".to_string());
        observation.sender_union_id = None;
        let observed = service
            .observe_inbound(
                &mut database,
                &dingtalk_host_envelope("dingtalk-timeout-observe", observation),
            )
            .unwrap();
        assert_eq!(observed.result.payload["readyToFinalize"], false);
        let aggregate_id = observed.result.payload["aggregateId"].as_str().unwrap();
        database
            .connection()
            .execute(
                "UPDATE channel_inbound_aggregate SET deadline_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
                [aggregate_id],
            )
            .unwrap();

        service
            .host_tick(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-timeout-tick",
                    ChannelHostTickCommand {
                        worker_id: "dingtalk-test-worker".to_string(),
                        limit: 10,
                    },
                ),
            )
            .unwrap();
        let terminal: (String, Option<String>) = database
            .connection()
            .query_row(
                "SELECT status, failure_code FROM channel_inbound_aggregate WHERE id = ?1",
                [aggregate_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(terminal.0, "failed");
        assert_eq!(terminal.1.as_deref(), Some("aggregation_timeout"));
    }

    #[test]
    fn dingtalk_group_roster_reconciles_camp_members_with_dingtalk_generations() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_dingtalk_account(&service, &mut database);
        publish_dingtalk_bot(&service, &mut database, "agent_1");
        publish_dingtalk_bot(&service, &mut database, "agent_2");
        seed_project(&database, "dingtalk-group-roster");
        let quick_chat_path = quick_chat_path(&database);

        let verified = service
            .verify_feishu_owner(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-group-owner-verify",
                    VerifyFeishuOwnerCommand {
                        provider: DINGTALK_PROVIDER.to_string(),
                        app_id: "ding-app-agent_1".to_string(),
                        tenant_key: "ding-corp-1".to_string(),
                        sender_open_id: None,
                        sender_user_id: Some("owner-staff-1".to_string()),
                        sender_union_id: None,
                        sender_display_name: "Owner".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(verified.result.payload["classification"], "owner");

        service
            .reconcile_feishu_group_roster(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-group-roster-initial",
                    ReconcileFeishuGroupRosterCommand {
                        provider: DINGTALK_PROVIDER.to_string(),
                        tenant_key: "ding-corp-1".to_string(),
                        chat_id: "ding-group-roster".to_string(),
                        present_app_ids: vec![
                            "ding-app-agent_1".to_string(),
                            "ding-app-agent_2".to_string(),
                        ],
                    },
                ),
            )
            .unwrap();

        let mut observation = observation_command(
            "ding-app-agent_1",
            "ding-group-roster-message-1",
            "ding-group-roster",
            "",
            "group",
            "只点名一号",
            &[("agent_1", "ding-app-agent_1")],
            true,
        );
        observation.provider = DINGTALK_PROVIDER.to_string();
        observation.tenant_key = "ding-corp-1".to_string();
        observation.sender_external_user_id = "owner-staff-1".to_string();
        observation.sender_open_id = None;
        observation.sender_user_id = Some("owner-staff-1".to_string());
        observation.sender_union_id = None;
        let observed = service
            .observe_inbound(
                &mut database,
                &dingtalk_host_envelope("dingtalk-group-roster-observe", observation),
            )
            .unwrap();
        let pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &dingtalk_host_envelope(
                    "dingtalk-group-roster-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observed.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(pending.result.code, "channel.binding.pending");
        let pending_id = pending.result.payload["pendingBindingId"].as_str().unwrap();
        let resolved = resolve_pending_for_provider(
            &service,
            &mut database,
            pending_id,
            "dingtalk-group-roster-resolve",
            DINGTALK_PROVIDER,
        );
        assert_eq!(resolved.result.code, "channel.binding.resolved");
        let camp_id = resolved.result.payload["campId"].as_str().unwrap();
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
            "the initial DingTalk group Camp uses the full present Bot roster"
        );

        publish_dingtalk_bot(&service, &mut database, "agent_3");
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &dingtalk_host_envelope(
                    "dingtalk-group-roster-updated",
                    ReconcileFeishuGroupRosterCommand {
                        provider: DINGTALK_PROVIDER.to_string(),
                        tenant_key: "ding-corp-1".to_string(),
                        chat_id: "ding-group-roster".to_string(),
                        present_app_ids: vec![
                            "ding-app-agent_1".to_string(),
                            "ding-app-agent_3".to_string(),
                        ],
                    },
                ),
            )
            .unwrap();

        let (agent_2_status, agent_3_status): (String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT status FROM camp_member WHERE camp_id = ?1 AND agent_id = 'agent_2'),
                    (SELECT status FROM camp_member WHERE camp_id = ?1 AND agent_id = 'agent_3')
                "#,
                [camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(agent_2_status, "left");
        assert_eq!(agent_3_status, "active");
        let (namespace, reconciliation_generation): (String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT source_namespace, last_reconciliation_generation
                FROM camp_membership_source_binding
                WHERE camp_id = ?1
                "#,
                [camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(namespace, DINGTALK_PROVIDER);
        assert_eq!(reconciliation_generation, 2);
    }

    #[test]
    fn developer_identity_and_unknown_publication_state_are_persistent_core_facts() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        let first = service.snapshot(&mut database).unwrap().account.unwrap();
        assert_eq!(first.account_id, "account_1");
        assert_eq!(first.user_id_digest, owner_user_digest());
        assert_eq!(first.tenant_id, "tenant_1");
        assert_eq!(first.user_name, "Owner");
        assert_eq!(first.email.as_deref(), Some("owner@example.com"));
        assert_eq!(first.brand, "feishu");

        connect_account_with_command_id(&service, &mut database, "account-verify");
        let verified = service.snapshot(&mut database).unwrap().account.unwrap();
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
                        expected_user_id_digest: owner_user_digest(),
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
        let snapshot = service.snapshot(&mut database).unwrap();
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
                        expected_user_id_digest: owner_user_digest(),
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
        let recovered = service.snapshot(&mut database).unwrap();
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
                        expected_user_id_digest: owner_user_digest(),
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
                        expected_user_id_digest: owner_user_digest(),
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
                        owner_open_id: "ou_user_replacement".to_string(),
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
                        owner_open_id: "ou_user".to_string(),
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
                        owner_open_id: "ou_user".to_string(),
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
        let snapshot = service.snapshot(&mut database).unwrap();
        assert_eq!(snapshot.member_bots[0].brand, "feishu");
        assert_eq!(snapshot.publication_intents[0].state, "completed");
    }

    #[test]
    fn owner_identity_does_not_conflate_developer_tenant_id_with_event_tenant_key() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");

        let verified = service
            .verify_feishu_owner(
                &mut database,
                &host_envelope(
                    "verify-owner-distinct-tenant-key",
                    VerifyFeishuOwnerCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        app_id: "cli_app_1".to_string(),
                        tenant_key: "event_tenant_key_1".to_string(),
                        sender_open_id: Some("ou_user".to_string()),
                        sender_user_id: None,
                        sender_union_id: Some("union_user".to_string()),
                        sender_display_name: "Owner".to_string(),
                    },
                ),
            )
            .unwrap();

        assert_eq!(verified.result.payload["classification"], "owner");

        let conflicting_tenant_key = service
            .verify_feishu_owner(
                &mut database,
                &host_envelope(
                    "verify-owner-conflicting-tenant-key",
                    VerifyFeishuOwnerCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        app_id: "cli_app_1".to_string(),
                        tenant_key: "event_tenant_key_2".to_string(),
                        sender_open_id: Some("ou_user".to_string()),
                        sender_user_id: Some("user_1".to_string()),
                        sender_union_id: Some("union_user".to_string()),
                        sender_display_name: "Owner".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            conflicting_tenant_key.result.payload["classification"],
            "unverified"
        );
    }

    #[test]
    fn published_bot_rejects_owner_open_id_rebinding() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");

        let rejected = service
            .upsert_feishu_member_bot(
                &mut database,
                &host_envelope(
                    "rebind-owner-open-id",
                    UpsertFeishuMemberBotCommand {
                        account_id: "account_1".to_string(),
                        agent_id: "agent_1".to_string(),
                        app_id: "cli_app_1".to_string(),
                        owner_open_id: "ou_different_owner".to_string(),
                        bot_open_id: Some("ou_bot_agent_1".to_string()),
                        bot_display_name: "木瓦".to_string(),
                        credential_ref: "feishu/member/agent_1".to_string(),
                    },
                ),
            )
            .unwrap();

        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "feishu_owner_identity.conflict");
    }

    #[test]
    fn owner_dm_uses_quick_chat_and_new_rotates_only_without_active_work() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        let quick_chat_path = quick_chat_path(&database);
        let verified = service
            .verify_feishu_owner(
                &mut database,
                &host_envelope(
                    "verify-owner-dm",
                    VerifyFeishuOwnerCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        app_id: "cli_app_1".to_string(),
                        tenant_key: "tenant_1".to_string(),
                        sender_open_id: Some("ou_user".to_string()),
                        sender_user_id: Some("user_1".to_string()),
                        sender_union_id: Some("union_user".to_string()),
                        sender_display_name: "Owner".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(verified.result.payload["classification"], "owner");
        let new_command = || StartNewFeishuDmCommand {
            provider: FEISHU_PROVIDER.to_string(),
            app_id: "cli_app_1".to_string(),
            tenant_key: "tenant_1".to_string(),
            chat_id: "oc_1".to_string(),
            conversation_display_name: "Owner 私聊".to_string(),
            target_agent_id: "agent_1".to_string(),
        };
        let first_generation = service
            .start_new_feishu_dm(
                &mut database,
                &quick_chat_path,
                &host_envelope("dm-new-first", new_command()),
            )
            .unwrap();
        let second_generation = service
            .start_new_feishu_dm(
                &mut database,
                &quick_chat_path,
                &host_envelope("dm-new-second", new_command()),
            )
            .unwrap();
        assert_eq!(first_generation.result.payload["generation"], 1);
        assert_eq!(second_generation.result.payload["generation"], 2);
        assert_eq!(first_generation.result.payload["campCreated"], true);
        assert_eq!(second_generation.result.payload["campCreated"], true);
        for table in ["camp_message", "camp_turn", "agent_run"] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "/new must not create {table}");
        }
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-1",
                    observation_command(
                        "cli_app_1",
                        "om_1",
                        "oc_1",
                        "",
                        "p2p",
                        "帮我检查",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
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
                &quick_chat_path,
                &host_envelope("finalize-1", FinalizeChannelInboundCommand { aggregate_id }),
            )
            .unwrap();
        assert_eq!(finalized.result.code, "channel.turn.admitted");
        assert_eq!(finalized.result.payload["campCreated"], false);
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM external_principal", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1,
            "the owner must remain an ExternalPrincipal"
        );
        for table in ["camp_message", "camp_turn", "agent_run"] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "{table} must be admitted atomically");
        }
        let console_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "host-tick-open-console",
                    ChannelHostTickCommand {
                        worker_id: "channel-test-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let console_delivery = console_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "execution_console_upsert")
            .expect("an admitted AgentRun must open one execution console");
        assert!(
            console_tick.result.payload["deliveries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|delivery| !matches!(
                    delivery["deliveryKind"].as_str(),
                    Some("agent_status" | "completion")
                ))
        );
        let console_source = service
            .execution_console_source(
                &mut database,
                console_delivery["payload"]["agentRunId"].as_str().unwrap(),
                console_delivery["payload"]["expectedSequence"]
                    .as_i64()
                    .unwrap(),
            )
            .unwrap()
            .expect("the claimed console source must be readable");
        assert_eq!(console_source.run.status, "queued");
        assert_eq!(console_source.state, "opening");
        service
            .settle_delivery(
                &mut database,
                &host_envelope(
                    "settle-open-console",
                    SettleChannelDeliveryCommand {
                        delivery_id: console_delivery["deliveryId"].as_str().unwrap().to_string(),
                        worker_id: "channel-test-worker".to_string(),
                        outcome: "sent".to_string(),
                        external_delivery_message_id: Some("om-console-1".to_string()),
                        failure_code: None,
                        retryable: false,
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT external_message_id FROM channel_execution_console
                    WHERE agent_run_id = ?1
                    "#,
                    [&console_source.agent_run_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "om-console-1"
        );
        let busy = service
            .start_new_feishu_dm(
                &mut database,
                &quick_chat_path,
                &host_envelope("dm-new-busy", new_command()),
            )
            .unwrap();
        assert_eq!(busy.result.code, "channel.dm.busy");

        let (camp_id, camp_turn_id, agent_run_id): (String, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT request.camp_id, request.camp_turn_id, run.id
                FROM channel_turn_request AS request
                JOIN agent_run AS run ON run.camp_turn_id = request.camp_turn_id
                WHERE request.status = 'admitted'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let failed_at = Utc::now().to_rfc3339();
        let output_content = vec![StructuredCampMessageSegment::Text {
            text: "partial channel output".to_string(),
        }];
        let output_content_json = serde_json::to_string(&output_content).unwrap();
        let output_digest = canonical_content_digest(&output_content).unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp SET last_message_sequence = last_message_sequence + 1 WHERE id = ?1",
                [&camp_id],
            )
            .unwrap();
        let output_sequence: i64 = database
            .connection()
            .query_row(
                "SELECT last_message_sequence FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id,
                    source_agent_run_id, body, structured_content_json, content_digest,
                    address_mode, addressed_agent_ids_json, reply_to_camp_message_id,
                    camp_turn_id, agent_run_id, tombstoned_at, version,
                    created_at, updated_at, effective_recipient_ids_json,
                    recipient_set_digest, recipient_presentation_json, source_operation_id
                ) VALUES (
                    'channel-output', ?1, ?2, 'agent', 'agent_1',
                    ?3, 'partial channel output', ?4, ?5,
                    'default', '[]', NULL, ?6, ?3, NULL, 1,
                    ?7, ?7, '[]', NULL, '{}', NULL
                )
                "#,
                params![
                    camp_id,
                    output_sequence,
                    agent_run_id,
                    output_content_json,
                    output_digest,
                    camp_turn_id,
                    failed_at,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO managed_attachment(
                    camp_id, id, kind, root_relative_payload_path,
                    media_type, byte_size, file_count, directory_count, node_count,
                    content_digest, preview_kind, origin, state, safe_reason_code,
                    available_revision, created_by_type, created_by_id, created_at
                ) VALUES (
                    ?1, 'channel-attachment', 'file',
                    'managed/channel-attachment/payload', 'image/png', 12, 1, 0, 1,
                    'sha256:channel-attachment', 'image', 'agent_workspace',
                    'available', NULL, 1, 'agent', 'agent_1', ?2
                )
                "#,
                params![camp_id, failed_at],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message_attachment_ref(
                    camp_id, camp_message_id, ordinal, attachment_id,
                    display_name_snapshot, created_at
                ) VALUES (?1, 'channel-output', 0, 'channel-attachment', 'result.png', ?2)
                "#,
                params![camp_id, failed_at],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', last_error_code = 'runtime_failed',
                    manual_retry_allowed = 1, ended_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![agent_run_id, failed_at],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_turn SET status = 'waiting', updated_at = ?2 WHERE id = ?1",
                params![camp_turn_id, failed_at],
            )
            .unwrap();

        let tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "host-tick-decline-channel-retry",
                    ChannelHostTickCommand {
                        worker_id: "channel-test-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let claimed = tick.result.payload["deliveries"].as_array().unwrap();
        assert!(claimed.iter().any(|delivery| {
            delivery["deliveryKind"] == "agent_output"
                && delivery["payload"]["body"] == "partial channel output"
        }));
        assert!(claimed.iter().all(|delivery| !matches!(
            delivery["deliveryKind"].as_str(),
            Some("agent_status" | "completion")
        )));
        assert!(
            claimed
                .iter()
                .all(|delivery| { delivery["deliveryKind"] != "execution_console_upsert" })
        );
        let pending_state: String = database
            .connection()
            .query_row(
                "SELECT state FROM channel_execution_console WHERE agent_run_id = ?1",
                [&agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending_state, "terminal_pending");
        database
            .connection()
            .execute(
                "UPDATE channel_execution_console SET updated_at = ?2 WHERE agent_run_id = ?1",
                params![
                    agent_run_id,
                    (Utc::now() - Duration::seconds(2)).to_rfc3339()
                ],
            )
            .unwrap();
        let sealed_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "host-tick-seal-channel-console",
                    ChannelHostTickCommand {
                        worker_id: "channel-test-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let terminal_console = sealed_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "execution_console_upsert")
            .expect("the sealed terminal snapshot must update the existing execution console");
        assert_eq!(terminal_console["updateMessageId"], "om-console-1");
        let terminal_source = service
            .execution_console_source(
                &mut database,
                &agent_run_id,
                terminal_console["payload"]["expectedSequence"]
                    .as_i64()
                    .unwrap(),
            )
            .unwrap()
            .expect("the terminal execution console remains readable");
        assert_eq!(terminal_source.run.status, "failed");
        assert_eq!(terminal_source.state, "terminal_sealed");
        assert_eq!(
            terminal_source.external_message_id.as_deref(),
            Some("om-console-1")
        );
        assert!(
            service
                .execution_console_source(
                    &mut database,
                    &agent_run_id,
                    terminal_source.sequence - 1,
                )
                .unwrap()
                .is_none(),
            "an obsolete snapshot sequence must not read through to the sealed snapshot"
        );

        let wrong_app = service
            .authorize_execution_console_page(
                &mut database,
                &host_envelope(
                    "execution-console-wrong-app",
                    execution_console_page_command(
                        &terminal_source,
                        "cli_other",
                        "om-console-1",
                        0,
                        2,
                        true,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(wrong_app.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            wrong_app.result.code,
            "channel.execution_console.callback_app_mismatch"
        );
        let non_owner = service
            .authorize_execution_console_page(
                &mut database,
                &host_envelope(
                    "execution-console-non-owner",
                    execution_console_page_command(
                        &terminal_source,
                        "cli_app_1",
                        "om-console-1",
                        0,
                        2,
                        false,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(non_owner.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            non_owner.result.code,
            "channel.execution_console.owner_required"
        );
        let view_state_before: (String, i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT display_mode, page_index, view_version
                FROM channel_execution_console WHERE agent_run_id = ?1
                "#,
                [&agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let delivery_count_before: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM channel_delivery", [], |row| {
                row.get(0)
            })
            .unwrap();
        let page_two = service
            .authorize_execution_console_page(
                &mut database,
                &host_envelope(
                    "execution-console-page-two",
                    execution_console_page_command(
                        &terminal_source,
                        "cli_app_1",
                        "om-console-1",
                        1,
                        2,
                        true,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(page_two.result.status, CommandResultStatus::Accepted);
        assert_eq!(page_two.result.payload["pageIndex"], 1);
        let page_two_again = service
            .authorize_execution_console_page(
                &mut database,
                &host_envelope(
                    "execution-console-page-two-again",
                    execution_console_page_command(
                        &terminal_source,
                        "cli_app_1",
                        "om-console-1",
                        1,
                        2,
                        true,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(page_two_again.result.status, CommandResultStatus::Accepted);
        let stale_snapshot = service
            .authorize_execution_console_page(
                &mut database,
                &host_envelope(
                    "execution-console-stale-snapshot",
                    AuthorizeChannelExecutionConsolePageCommand {
                        snapshot_sequence: terminal_source.sequence - 1,
                        ..execution_console_page_command(
                            &terminal_source,
                            "cli_app_1",
                            "om-console-1",
                            0,
                            2,
                            true,
                        )
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale_snapshot.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            stale_snapshot.result.code,
            "channel.execution_console.stale_card"
        );
        let wrong_message = service
            .authorize_execution_console_page(
                &mut database,
                &host_envelope(
                    "execution-console-wrong-message",
                    execution_console_page_command(
                        &terminal_source,
                        "cli_app_1",
                        "om-console-obsolete",
                        0,
                        2,
                        true,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(wrong_message.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            wrong_message.result.code,
            "channel.execution_console.stale_card"
        );
        let view_state_after: (String, i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT display_mode, page_index, view_version
                FROM channel_execution_console WHERE agent_run_id = ?1
                "#,
                [&agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let delivery_count_after: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM channel_delivery", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(view_state_after, view_state_before);
        assert_eq!(delivery_count_after, delivery_count_before);
        database
            .connection()
            .execute(
                "UPDATE agent_run SET version = version + 1 WHERE id = ?1",
                [&agent_run_id],
            )
            .unwrap();
        let after_seal_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "host-tick-after-console-sealed",
                    ChannelHostTickCommand {
                        worker_id: "channel-test-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        assert!(
            after_seal_tick.result.payload["deliveries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|delivery| delivery["deliveryKind"] != "execution_console_upsert"),
            "a sealed console must ignore later background materialization changes"
        );
        let sealed_sequence: i64 = database
            .connection()
            .query_row(
                "SELECT latest_sequence FROM channel_execution_console WHERE agent_run_id = ?1",
                [&agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sealed_sequence, terminal_source.sequence);
        assert!(
            claimed
                .iter()
                .all(|delivery| delivery["deliveryKind"] != "agent_attachment")
        );
        let output_delivery_id = claimed
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "agent_output")
            .unwrap()["deliveryId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .settle_delivery(
                &mut database,
                &host_envelope(
                    "settle-channel-output",
                    SettleChannelDeliveryCommand {
                        delivery_id: output_delivery_id,
                        worker_id: "channel-test-worker".to_string(),
                        outcome: "sent".to_string(),
                        external_delivery_message_id: Some("om-output-1".to_string()),
                        failure_code: None,
                        retryable: false,
                    },
                ),
            )
            .unwrap();
        let attachment_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "host-tick-channel-attachment",
                    ChannelHostTickCommand {
                        worker_id: "channel-test-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let attachment_delivery = attachment_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "agent_attachment")
            .expect("the attachment becomes claimable after its body is terminal");
        assert_eq!(
            attachment_delivery["payload"]["attachmentId"],
            "channel-attachment"
        );
        assert_eq!(attachment_delivery["payload"]["ordinal"], 0);
        let attachment_delivery_id = attachment_delivery["deliveryId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .settle_delivery(
                &mut database,
                &host_envelope(
                    "settle-channel-attachment-failed",
                    SettleChannelDeliveryCommand {
                        delivery_id: attachment_delivery_id,
                        worker_id: "channel-test-worker".to_string(),
                        outcome: "failed".to_string(),
                        external_delivery_message_id: None,
                        failure_code: Some("upload_failed".to_string()),
                        retryable: false,
                    },
                ),
            )
            .unwrap();
        let attention_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "host-tick-channel-attachment-attention",
                    ChannelHostTickCommand {
                        worker_id: "channel-test-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let attention_deliveries = attention_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|delivery| delivery["deliveryKind"] == "attention")
            .collect::<Vec<_>>();
        assert_eq!(attention_deliveries.len(), 1);
        assert!(
            attention_deliveries[0]["payload"]["text"]
                .as_str()
                .unwrap()
                .contains("正文及其他附件不会重复发送")
        );

        let retry_declined_at: Option<String> = database
            .connection()
            .query_row(
                "SELECT retry_declined_at FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            retry_declined_at.is_some(),
            "a Channel request cannot wait for a local-only retry decision"
        );
        let turn_status: String = database
            .connection()
            .query_row(
                "SELECT status FROM camp_turn WHERE id = ?1 AND camp_id = ?2",
                params![camp_turn_id, camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(turn_status, "failed");

        let data_directory = database.directory().to_path_buf();
        database.close();
        let mut restarted = Database::open(&data_directory).unwrap();
        let restored = service
            .execution_console_source(&mut restarted, &agent_run_id, terminal_source.sequence)
            .unwrap()
            .expect("the sealed execution console snapshot must survive restart");
        assert_eq!(restored.state, "terminal_sealed");
        assert_eq!(restored.sequence, terminal_source.sequence);
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
    fn group_binding_freezes_messages_sends_one_card_and_promotes_fifo_atomically() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");
        let project_path = seed_project(&database, "binding");
        let quick_chat_path = quick_chat_path(&database);
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "binding-roster",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_group_binding".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string(), "cli_app_2".to_string()],
                    },
                ),
            )
            .unwrap();

        let first_observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-pending-first",
                    observation_command(
                        "cli_app_2",
                        "om_pending_first",
                        "oc_group_binding",
                        "",
                        "group",
                        "先由二号确认项目",
                        &[("agent_2", "cli_app_2"), ("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let first_pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "finalize-pending-first",
                    FinalizeChannelInboundCommand {
                        aggregate_id: first_observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(first_pending.result.code, "channel.binding.pending");
        assert_eq!(first_pending.result.payload["projectCardQueued"], true);
        assert_eq!(
            first_pending.result.payload["acknowledgementAppId"],
            "cli_app_2"
        );
        let pending_binding_id = first_pending.result.payload["pendingBindingId"]
            .as_str()
            .unwrap()
            .to_string();

        let second_observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-pending-second",
                    observation_command(
                        "cli_app_1",
                        "om_pending_second",
                        "oc_group_binding",
                        "",
                        "group",
                        "第二条一起排队",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let second_pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "finalize-pending-second",
                    FinalizeChannelInboundCommand {
                        aggregate_id: second_observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(second_pending.result.code, "channel.binding.pending");
        assert_eq!(second_pending.result.payload["projectCardQueued"], false);
        assert_eq!(
            second_pending.result.payload["pendingBindingId"],
            pending_binding_id
        );
        assert_eq!(
            database.connection().query_row(
                "SELECT COUNT(*) FROM channel_delivery WHERE delivery_kind = 'project_selection'",
                [],
                |row| row.get::<_, i64>(0),
            ).unwrap(),
            1,
            "one frozen acknowledgement Bot must send exactly one project card",
        );
        for table in ["camp_message", "camp_turn", "agent_run"] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                count, 0,
                "pending project selection must not create {table}"
            );
        }

        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "binding-roster-missing",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_group_binding".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string()],
                    },
                ),
            )
            .unwrap();
        let rejected = resolve_pending(
            &service,
            &mut database,
            &pending_binding_id,
            "resolve-missing-roster",
        );
        assert_eq!(rejected.result.code, "channel.bot_not_in_roster");
        let (picker_app_id, picker_payload_json, picker_message_id): (String, String, String) =
            database
                .connection()
                .query_row(
                    r#"
                    SELECT target_app_id, payload_json, external_delivery_message_id
                    FROM channel_delivery
                    WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
                      AND status = 'sent'
                      AND json_extract(payload_json, '$.placement') = 'conversation'
                      AND json_extract(payload_json, '$.operation') = 'send'
                    "#,
                    [&pending_binding_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
        let picker_payload: Value = serde_json::from_str(&picker_payload_json).unwrap();
        assert_eq!(picker_payload["conversationKind"], "group");
        assert_eq!(picker_payload["placement"], "conversation");
        assert!(picker_payload.get("canonicalPath").is_none());
        let selected_project_id = picker_payload["projectOptions"][0]["projectId"]
            .as_str()
            .unwrap()
            .to_string();
        let stale_message = service
            .resolve_pending_camp_binding(
                &mut database,
                &host_envelope(
                    "resolve-stale-picker-message",
                    ResolvePendingCampBindingCommand {
                        pending_binding_id: pending_binding_id.clone(),
                        app_id: picker_app_id.clone(),
                        external_picker_message_id: "om_not_authoritative".to_string(),
                        expected_version: picker_payload["expectedVersion"].as_i64().unwrap(),
                        nonce: picker_payload["nonce"].as_str().unwrap().to_string(),
                        action: "bind".to_string(),
                        project_id: Some(selected_project_id.clone()),
                        operator_open_id: Some("ou_user".to_string()),
                        operator_user_id: Some("user_1".to_string()),
                        operator_union_id: Some("union_user".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale_message.result.code, "channel.binding.stale_card");
        let non_owner = service
            .resolve_pending_camp_binding(
                &mut database,
                &host_envelope(
                    "resolve-picker-non-owner",
                    ResolvePendingCampBindingCommand {
                        pending_binding_id: pending_binding_id.clone(),
                        app_id: picker_app_id.clone(),
                        external_picker_message_id: picker_message_id.clone(),
                        expected_version: picker_payload["expectedVersion"].as_i64().unwrap(),
                        nonce: picker_payload["nonce"].as_str().unwrap().to_string(),
                        action: "bind".to_string(),
                        project_id: Some(selected_project_id),
                        operator_open_id: Some("ou_other".to_string()),
                        operator_user_id: Some("user_other".to_string()),
                        operator_union_id: Some("union_other".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(non_owner.result.code, "channel.binding.owner_required");
        let unchanged_pending: (String, i64, String) = database
            .connection()
            .query_row(
                "SELECT status, version, nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [&pending_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(unchanged_pending.0, "pending");
        assert_eq!(
            unchanged_pending.1,
            picker_payload["expectedVersion"].as_i64().unwrap()
        );
        assert_eq!(
            unchanged_pending.2,
            opaque_digest(
                "pending-binding-nonce",
                picker_payload["nonce"].as_str().unwrap()
            )
        );
        let unavailable = service
            .resolve_pending_camp_binding(
                &mut database,
                &host_envelope(
                    "resolve-picker-project-became-unavailable",
                    ResolvePendingCampBindingCommand {
                        pending_binding_id: pending_binding_id.clone(),
                        app_id: picker_app_id.clone(),
                        external_picker_message_id: picker_message_id.clone(),
                        expected_version: picker_payload["expectedVersion"].as_i64().unwrap(),
                        nonce: picker_payload["nonce"].as_str().unwrap().to_string(),
                        action: "bind".to_string(),
                        project_id: Some("rvproj_missing".to_string()),
                        operator_open_id: Some("ou_user".to_string()),
                        operator_user_id: Some("user_1".to_string()),
                        operator_union_id: Some("union_user".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(unavailable.result.code, "channel.project_unavailable");
        assert_eq!(unavailable.result.payload["pickerRefreshQueued"], true);
        assert_eq!(
            unavailable.result.payload["expectedVersion"]
                .as_i64()
                .unwrap(),
            unchanged_pending.1 + 1
        );
        let refreshed_nonce_digest: String = database
            .connection()
            .query_row(
                "SELECT nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [&pending_binding_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(refreshed_nonce_digest, unchanged_pending.2);
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM pending_camp_binding WHERE id = ?1",
                    [&pending_binding_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "pending",
            "a failed precondition must not leave a resolving half-state",
        );
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "binding-roster-restored",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_group_binding".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string(), "cli_app_2".to_string()],
                    },
                ),
            )
            .unwrap();
        let resolved = resolve_pending(
            &service,
            &mut database,
            &pending_binding_id,
            "resolve-restored-roster",
        );
        assert_eq!(resolved.result.code, "channel.binding.resolved");
        assert_eq!(resolved.result.payload["promotedMessageCount"], 2);
        for (table, expected) in [("camp_message", 1), ("camp_turn", 1), ("agent_run", 2)] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                count, expected,
                "only the FIFO head should cross atomic admission"
            );
        }
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM channel_turn_request WHERE binding_id = ?1",
                    [resolved.result.payload["bindingId"].as_str().unwrap()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2,
        );
        let (author_type, reply_to, camp_path): (String, Option<String>, String) = database
            .connection()
            .query_row(
                r#"
                SELECT message.author_type, message.reply_to_camp_message_id,
                       camp.project_path
                FROM camp_message AS message
                JOIN camp ON camp.id = message.camp_id
                WHERE message.author_type = 'external_principal'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(author_type, "external_principal");
        assert_eq!(reply_to, None);
        assert_eq!(camp_path, project_path.to_string_lossy());
        let outbox = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "binding-outbox",
                    ChannelHostTickCommand {
                        worker_id: "binding-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let queue_acknowledgements = outbox.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|delivery| delivery["deliveryKind"] == "queue_ack")
            .collect::<Vec<_>>();
        assert_eq!(
            queue_acknowledgements.len(),
            1,
            "only the request that actually remained queued may emit a queue acknowledgement"
        );
        assert_eq!(queue_acknowledgements[0]["payload"]["status"], "queued");
        let picker_recalls = outbox.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|delivery| {
                delivery["deliveryKind"] == "project_selection"
                    && delivery["payload"]["operation"] == "recall"
            })
            .collect::<Vec<_>>();
        assert_eq!(picker_recalls.len(), 1);
        assert_eq!(picker_recalls[0]["targetAppId"], "cli_app_2");
        assert_eq!(picker_recalls[0]["updateMessageId"], picker_message_id);

        let replay = service
            .resolve_pending_camp_binding(
                &mut database,
                &host_envelope(
                    "resolve-picker-replay-after-commit",
                    ResolvePendingCampBindingCommand {
                        pending_binding_id: pending_binding_id.clone(),
                        app_id: picker_app_id,
                        external_picker_message_id: picker_message_id,
                        expected_version: picker_payload["expectedVersion"].as_i64().unwrap(),
                        nonce: picker_payload["nonce"].as_str().unwrap().to_string(),
                        action: "bind".to_string(),
                        project_id: picker_payload["projectOptions"][0]["projectId"]
                            .as_str()
                            .map(ToString::to_string),
                        operator_open_id: Some("ou_user".to_string()),
                        operator_user_id: Some("user_1".to_string()),
                        operator_union_id: Some("union_user".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(replay.result.code, "channel.binding.stale_card");
    }

    #[test]
    fn legacy_private_picker_is_recalled_and_reissued_in_the_original_conversation() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        seed_project(&database, "legacy-picker");
        let quick_chat_path = quick_chat_path(&database);
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "legacy-picker-roster",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_legacy_picker".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string()],
                    },
                ),
            )
            .unwrap();
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-legacy-picker",
                    observation_command(
                        "cli_app_1",
                        "om_legacy_request",
                        "oc_legacy_picker",
                        "",
                        "group",
                        "请检查",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "finalize-legacy-picker",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        let pending_binding_id = pending.result.payload["pendingBindingId"].as_str().unwrap();
        let (legacy_payload_json, original_version, original_nonce_digest): (String, i64, String) =
            database
                .connection()
                .query_row(
                    r#"
                    SELECT delivery.payload_json, pending.version, pending.nonce_digest
                    FROM channel_delivery AS delivery
                    JOIN pending_camp_binding AS pending
                      ON pending.id = delivery.pending_binding_id
                    WHERE pending.id = ?1 AND delivery.delivery_kind = 'project_selection'
                    "#,
                    [pending_binding_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
        let legacy_payload: Value = serde_json::from_str(&legacy_payload_json).unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE channel_delivery
                SET payload_json = json_remove(payload_json, '$.placement'),
                    status = 'sent', external_delivery_message_id = 'om_legacy_private',
                    updated_at = ?2, ended_at = ?2
                WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
                "#,
                params![pending_binding_id, now],
            )
            .unwrap();

        let tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "reconcile-legacy-private-picker",
                    ChannelHostTickCommand {
                        worker_id: "legacy-picker-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let deliveries = tick.result.payload["deliveries"].as_array().unwrap();
        let recall = deliveries
            .iter()
            .find(|delivery| delivery["payload"]["operation"] == "recall")
            .expect("the legacy private picker must be recalled");
        assert_eq!(recall["targetAppId"], "cli_app_1");
        assert_eq!(recall["updateMessageId"], "om_legacy_private");
        let replacement = deliveries
            .iter()
            .find(|delivery| delivery["payload"]["operation"] == "send")
            .expect("a replacement picker must be sent in the original conversation");
        assert_eq!(replacement["chatId"], "oc_legacy_picker");
        assert_eq!(replacement["payload"]["placement"], "conversation");
        assert_eq!(replacement["payload"]["notice"], "moved_to_conversation");
        assert_eq!(
            replacement["payload"]["expectedVersion"],
            original_version + 1
        );
        assert!(
            deliveries
                .iter()
                .position(|delivery| delivery["payload"]["operation"] == "send")
                .unwrap()
                < deliveries
                    .iter()
                    .position(|delivery| delivery["payload"]["operation"] == "recall")
                    .unwrap(),
            "the replacement must be attempted before best-effort legacy recall"
        );
        let (next_version, next_nonce_digest): (i64, String) = database
            .connection()
            .query_row(
                "SELECT version, nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [pending_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(next_version, original_version + 1);
        assert_ne!(next_nonce_digest, original_nonce_digest);

        let stale = service
            .resolve_pending_camp_binding(
                &mut database,
                &host_envelope(
                    "reject-legacy-private-picker",
                    ResolvePendingCampBindingCommand {
                        pending_binding_id: pending_binding_id.to_string(),
                        app_id: "cli_app_1".to_string(),
                        external_picker_message_id: "om_legacy_private".to_string(),
                        expected_version: legacy_payload["expectedVersion"].as_i64().unwrap(),
                        nonce: legacy_payload["nonce"].as_str().unwrap().to_string(),
                        action: "bind".to_string(),
                        project_id: legacy_payload["projectOptions"][0]["projectId"]
                            .as_str()
                            .map(ToString::to_string),
                        operator_open_id: Some("ou_user".to_string()),
                        operator_user_id: Some("user_1".to_string()),
                        operator_union_id: Some("union_user".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale.result.code, "channel.binding.stale_card");
    }

    #[test]
    fn failed_picker_from_an_obsolete_card_revision_is_reissued_once() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        seed_project(&database, "picker-card-revision");
        let quick_chat_path = quick_chat_path(&database);
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "picker-card-revision-roster",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_picker_card_revision".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string()],
                    },
                ),
            )
            .unwrap();
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-picker-card-revision",
                    observation_command(
                        "cli_app_1",
                        "om_picker_card_revision",
                        "oc_picker_card_revision",
                        "",
                        "group",
                        "请检查",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "finalize-picker-card-revision",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        let pending_binding_id = pending.result.payload["pendingBindingId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                r#"
                UPDATE channel_delivery
                SET payload_json = json_remove(payload_json, '$.cardRevision')
                WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
                "#,
                [&pending_binding_id],
            )
            .unwrap();
        let (original_version, original_nonce_digest): (i64, String) = database
            .connection()
            .query_row(
                "SELECT version, nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [&pending_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        let first_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "claim-obsolete-picker-card",
                    ChannelHostTickCommand {
                        worker_id: "obsolete-picker-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let obsolete_delivery_id = first_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "project_selection")
            .unwrap()["deliveryId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .settle_delivery(
                &mut database,
                &host_envelope(
                    "fail-obsolete-picker-card",
                    SettleChannelDeliveryCommand {
                        delivery_id: obsolete_delivery_id,
                        worker_id: "obsolete-picker-worker".to_string(),
                        outcome: "failed".to_string(),
                        external_delivery_message_id: None,
                        failure_code: Some("format_error".to_string()),
                        retryable: false,
                    },
                ),
            )
            .unwrap();

        let recovery_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "recover-obsolete-picker-card",
                    ChannelHostTickCommand {
                        worker_id: "recovered-picker-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let replacement = recovery_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "project_selection")
            .expect("an obsolete failed picker must be reissued with the current card revision");
        assert_eq!(replacement["chatId"], "oc_picker_card_revision");
        assert_eq!(
            replacement["payload"]["expectedVersion"],
            original_version + 1
        );
        assert_eq!(replacement["payload"]["cardRevision"], 3);
        let (next_version, next_nonce_digest): (i64, String) = database
            .connection()
            .query_row(
                "SELECT version, nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [&pending_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(next_version, original_version + 1);
        assert_ne!(next_nonce_digest, original_nonce_digest);

        service
            .settle_delivery(
                &mut database,
                &host_envelope(
                    "fail-current-picker-card",
                    SettleChannelDeliveryCommand {
                        delivery_id: replacement["deliveryId"].as_str().unwrap().to_string(),
                        worker_id: "recovered-picker-worker".to_string(),
                        outcome: "failed".to_string(),
                        external_delivery_message_id: None,
                        failure_code: Some("format_error".to_string()),
                        retryable: false,
                    },
                ),
            )
            .unwrap();
        let no_loop_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "do-not-loop-current-picker-card",
                    ChannelHostTickCommand {
                        worker_id: "current-picker-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        assert!(
            no_loop_tick.result.payload["deliveries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|delivery| delivery["deliveryKind"] != "project_selection"),
            "the current card revision must not enter an automatic retry loop"
        );
    }

    #[test]
    fn sent_picker_from_an_obsolete_card_revision_is_updated_once() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        seed_project(&database, "sent-picker-card-revision");
        let quick_chat_path = quick_chat_path(&database);
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "sent-picker-card-revision-roster",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_sent_picker_card_revision".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string()],
                    },
                ),
            )
            .unwrap();
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "observe-sent-picker-card-revision",
                    observation_command(
                        "cli_app_1",
                        "om_sent_picker_card_revision",
                        "oc_sent_picker_card_revision",
                        "",
                        "group",
                        "请检查",
                        &[("agent_1", "cli_app_1")],
                        true,
                    ),
                ),
            )
            .unwrap();
        let pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "finalize-sent-picker-card-revision",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        let pending_binding_id = pending.result.payload["pendingBindingId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                r#"
                UPDATE channel_delivery
                SET payload_json = json_set(payload_json, '$.cardRevision', 2)
                WHERE pending_binding_id = ?1 AND delivery_kind = 'project_selection'
                "#,
                [&pending_binding_id],
            )
            .unwrap();
        let (original_version, original_nonce_digest): (i64, String) = database
            .connection()
            .query_row(
                "SELECT version, nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [&pending_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let first_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "claim-sent-obsolete-picker-card",
                    ChannelHostTickCommand {
                        worker_id: "sent-obsolete-picker-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let obsolete_delivery_id = first_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "project_selection")
            .unwrap()["deliveryId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .settle_delivery(
                &mut database,
                &host_envelope(
                    "settle-sent-obsolete-picker-card",
                    SettleChannelDeliveryCommand {
                        delivery_id: obsolete_delivery_id,
                        worker_id: "sent-obsolete-picker-worker".to_string(),
                        outcome: "sent".to_string(),
                        external_delivery_message_id: Some("om_sent_obsolete_picker".to_string()),
                        failure_code: None,
                        retryable: false,
                    },
                ),
            )
            .unwrap();

        let recovery_tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "update-sent-obsolete-picker-card",
                    ChannelHostTickCommand {
                        worker_id: "updated-picker-worker".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        let replacement = recovery_tick.result.payload["deliveries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|delivery| delivery["deliveryKind"] == "project_selection")
            .expect("an obsolete sent picker must be updated to the current card revision");
        assert_eq!(replacement["payload"]["operation"], "update");
        assert_eq!(replacement["updateMessageId"], "om_sent_obsolete_picker");
        assert_eq!(
            replacement["payload"]["expectedVersion"],
            original_version + 1
        );
        assert_eq!(replacement["payload"]["cardRevision"], 3);
        let (next_version, next_nonce_digest): (i64, String) = database
            .connection()
            .query_row(
                "SELECT version, nonce_digest FROM pending_camp_binding WHERE id = ?1",
                [&pending_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(next_version, original_version + 1);
        assert_ne!(next_nonce_digest, original_nonce_digest);
    }

    #[test]
    fn multi_bot_aggregation_is_complete_or_fails_closed() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");
        let quick_chat_path = quick_chat_path(&database);
        let targets = [("agent_1", "cli_app_1"), ("agent_2", "cli_app_2")];
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "aggregate-roster",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_multi".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string(), "cli_app_2".to_string()],
                    },
                ),
            )
            .unwrap();

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
        let unresolved_ack = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "aggregate-finalize-without-canonical-order",
                    FinalizeChannelInboundCommand {
                        aggregate_id: second.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(unresolved_ack.result.code, "channel.inbound.failed");
        assert_eq!(
            unresolved_ack.result.payload["failureCode"],
            "acknowledgement_app_unresolved"
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM pending_camp_binding", [], |row| row
                    .get::<_, i64>(
                    0
                ),)
                .unwrap(),
            0,
            "an unresolved canonical mention order must not choose a project-card Bot"
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
                &quick_chat_path,
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
        seed_project(&database, "group-roster");
        let quick_chat_path = quick_chat_path(&database);
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
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "group-pending",
                    observation_command(
                        "cli_app_1",
                        "om_group_pending",
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
        let pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "group-pending-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(pending.result.code, "channel.binding.pending");
        let pending_id = pending.result.payload["pendingBindingId"].as_str().unwrap();
        let resolved = resolve_pending(&service, &mut database, pending_id, "group-resolve");
        assert_eq!(resolved.result.code, "channel.binding.resolved");
        let camp_id = resolved.result.payload["campId"].as_str().unwrap();
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
    fn topic_membership_tracks_parent_roster_without_expanding_initial_targets() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelService::default();
        connect_account(&service, &mut database);
        publish_bot(&service, &mut database, "agent_1", "cli_app_1");
        publish_bot(&service, &mut database, "agent_2", "cli_app_2");
        seed_project(&database, "topic-roster");
        let quick_chat_path = quick_chat_path(&database);
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
        let observation = service
            .observe_inbound(
                &mut database,
                &host_envelope(
                    "topic-pending",
                    observation_command(
                        "cli_app_1",
                        "om_topic_pending",
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
        let pending = service
            .finalize_inbound(
                &mut database,
                &quick_chat_path,
                &host_envelope(
                    "topic-pending-finalize",
                    FinalizeChannelInboundCommand {
                        aggregate_id: observation.result.payload["aggregateId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(pending.result.code, "channel.binding.pending");
        let pending_id = pending.result.payload["pendingBindingId"].as_str().unwrap();
        let resolved = resolve_pending(&service, &mut database, pending_id, "topic-resolve");
        let camp_id = resolved.result.payload["campId"].as_str().unwrap();
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
            "a Topic Camp starts from the full present parent Bot roster"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT COUNT(*)
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE camp_turn.camp_id = ?1
                    "#,
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1,
            "only the explicitly mentioned Bot receives the initial AgentRun"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT conversation.agent_id
                    FROM agent_run
                    JOIN conversation ON conversation.id = agent_run.conversation_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE camp_turn.camp_id = ?1
                    "#,
                    [camp_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "agent_1"
        );

        publish_bot(&service, &mut database, "agent_3", "cli_app_3");
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "topic-roster-added-agent-three",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_topic_group".to_string(),
                        present_app_ids: vec![
                            "cli_app_1".to_string(),
                            "cli_app_2".to_string(),
                            "cli_app_3".to_string(),
                        ],
                    },
                ),
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
            3,
            "adding a parent-group Bot updates an existing Topic Camp"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT COUNT(*)
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE camp_turn.camp_id = ?1
                    "#,
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1,
            "roster reconciliation never creates an AgentRun"
        );

        let delivery_id = insert_pending_topic_delivery(&database, camp_id, "agent_3");
        let generation_before_dispatch: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT generation FROM external_group_bot_roster_state
                WHERE provider = 'feishu' AND tenant_key = 'tenant_1'
                  AND chat_id = 'oc_topic_group'
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            crate::message_delivery::dispatch_delivery(
                &mut database,
                &delivery_id,
                crate::message_delivery::DeliveryDispatchTrigger::Accepted,
                true,
            )
            .unwrap(),
            crate::message_delivery::DeliveryDispatchOutcome::Waiting {
                condition: "runtime_unavailable".to_string(),
            },
            "an internal Topic delivery must wait for a newer Host roster observation"
        );
        let tick = service
            .host_tick(
                &mut database,
                &host_envelope(
                    "topic-roster-refresh-tick",
                    ChannelHostTickCommand {
                        worker_id: "topic-roster-test-host".to_string(),
                        limit: 20,
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            tick.result.payload["rosterRefreshes"],
            json!([{
                "provider": "feishu",
                "tenantKey": "tenant_1",
                "chatId": "oc_topic_group",
                "requiredRosterGeneration": generation_before_dispatch + 1,
            }]),
            "the Host pump must receive the exact parent-group refresh request"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE trigger_message_delivery_id = ?1",
                    [&delivery_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0,
            "no AgentRun exists before the requested generation is reconciled"
        );
        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "topic-roster-release-delivery",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_topic_group".to_string(),
                        present_app_ids: vec![
                            "cli_app_1".to_string(),
                            "cli_app_2".to_string(),
                            "cli_app_3".to_string(),
                        ],
                    },
                ),
            )
            .unwrap();
        let (delivery_status, recipient_agent_id): (String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT delivery.status, conversation.agent_id
                FROM message_delivery AS delivery
                JOIN agent_run AS run ON run.id = delivery.target_agent_run_id
                JOIN conversation ON conversation.id = run.conversation_id
                WHERE delivery.id = ?1
                "#,
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(delivery_status, "running");
        assert_eq!(recipient_agent_id, "agent_3");

        let leaving_delivery_id = insert_pending_topic_delivery(&database, camp_id, "agent_2");
        assert!(matches!(
            crate::message_delivery::dispatch_delivery(
                &mut database,
                &leaving_delivery_id,
                crate::message_delivery::DeliveryDispatchTrigger::Accepted,
                true,
            )
            .unwrap(),
            crate::message_delivery::DeliveryDispatchOutcome::Waiting { .. }
        ));

        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "topic-roster-removed-agent-two",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_topic_group".to_string(),
                        present_app_ids: vec!["cli_app_1".to_string(), "cli_app_3".to_string()],
                    },
                ),
            )
            .unwrap();
        let (removed_status, initial_run_cancel_requested_at): (String, Option<String>) = database
            .connection()
            .query_row(
                r#"
                SELECT removed.status, initial_run.cancel_requested_at
                FROM camp_member AS removed
                JOIN camp_turn ON camp_turn.camp_id = removed.camp_id
                JOIN agent_run AS initial_run ON initial_run.camp_turn_id = camp_turn.id
                WHERE removed.camp_id = ?1 AND removed.agent_id = 'agent_2'
                "#,
                [camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(removed_status, "left");
        assert_eq!(
            initial_run_cancel_requested_at, None,
            "removing another Bot must not disturb the already-created AgentRun"
        );
        let (leaving_delivery_status, leaving_target_run_count): (String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT delivery.status, COUNT(run.id)
                FROM message_delivery AS delivery
                LEFT JOIN agent_run AS run ON run.trigger_message_delivery_id = delivery.id
                WHERE delivery.id = ?1
                GROUP BY delivery.id
                "#,
                [&leaving_delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(matches!(
            leaving_delivery_status.as_str(),
            "failed" | "cancelled"
        ));
        assert_eq!(
            leaving_target_run_count, 0,
            "a Bot removed by the fresh roster cannot receive the pending next AgentRun"
        );
        {
            let transaction = database.connection_mut().transaction().unwrap();
            assert!(
                crate::message_delivery::topic_channel_recipient_is_present(
                    &transaction,
                    camp_id,
                    "agent_3",
                )
                .unwrap()
            );
            assert!(
                !crate::message_delivery::topic_channel_recipient_is_present(
                    &transaction,
                    camp_id,
                    "agent_2",
                )
                .unwrap(),
                "A2A/Gather retry materialization must reject a Bot that left the parent group"
            );
            transaction.commit().unwrap();
        }
        service
            .ensure_topic_roster_members(
                &mut database,
                camp_id,
                &["agent_3".to_string()],
                "topic-a2a-present",
            )
            .unwrap();
        let removed_target = service.ensure_topic_roster_members(
            &mut database,
            camp_id,
            &["agent_2".to_string()],
            "topic-a2a-removed",
        );
        assert!(
            removed_target
                .unwrap_err()
                .to_string()
                .contains("channel.topic_bot_not_in_roster"),
            "A2A/Gather to a Bot that left the parent group must fail closed"
        );

        service
            .reconcile_feishu_group_roster(
                &mut database,
                &host_envelope(
                    "topic-roster-running-agent-left",
                    ReconcileFeishuGroupRosterCommand {
                        provider: FEISHU_PROVIDER.to_string(),
                        tenant_key: "tenant_1".to_string(),
                        chat_id: "oc_topic_group".to_string(),
                        present_app_ids: vec!["cli_app_3".to_string()],
                    },
                ),
            )
            .unwrap();
        let (running_member_status, running_member_cancel_requested_at): (String, Option<String>) =
            database
                .connection()
                .query_row(
                    r#"
                SELECT member.status, run.cancel_requested_at
                FROM camp_member AS member
                JOIN camp_turn ON camp_turn.camp_id = member.camp_id
                JOIN agent_run AS run ON run.camp_turn_id = camp_turn.id
                JOIN conversation ON conversation.id = run.conversation_id
                WHERE member.camp_id = ?1 AND member.agent_id = 'agent_1'
                  AND conversation.agent_id = 'agent_1'
                "#,
                    [camp_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
        assert_eq!(
            running_member_status, "active",
            "membership cutover is deferred while an AgentRun still uses the frozen lifetime"
        );
        assert_eq!(
            running_member_cancel_requested_at, None,
            "a Bot leaving the parent group must not cancel its already-created AgentRun"
        );
        {
            let transaction = database.connection_mut().transaction().unwrap();
            assert!(
                !crate::message_delivery::topic_channel_recipient_is_present(
                    &transaction,
                    camp_id,
                    "agent_1",
                )
                .unwrap(),
                "a deferred membership cutover must still fail-close every new AgentRun"
            );
            transaction.commit().unwrap();
        }
        let running_removed_target = service.ensure_topic_roster_members(
            &mut database,
            camp_id,
            &["agent_1".to_string()],
            "topic-a2a-running-removed",
        );
        assert!(
            running_removed_target
                .unwrap_err()
                .to_string()
                .contains("channel.topic_bot_not_in_roster"),
            "the frozen Run may finish, but no new A2A/Gather may target its removed Bot"
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
