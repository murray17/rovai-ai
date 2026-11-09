//! ChatBot mode: member Runtime reuse, chat transcript, communication items and
//! outbound delivery state. A chat turn is an ordinary Camp execution inside the
//! member's materials folder, so the member's own Runtime, model and permissions
//! answer the chat instead of a separate chat model configuration.
use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use std::str::FromStr;

use crate::agent_profile::AdapterKind;
use crate::collaboration::{ChatBotTurnAdmissionInput, CollaborationService};
use crate::db::Database;

pub(crate) const CHAT_MODE: &str = "chat";
pub(crate) const WORK_MODE: &str = "work";
const MAX_APP_ID_BYTES: usize = 256;
const MAX_CHAT_ID_BYTES: usize = 512;
const MAX_BODY_BYTES: usize = 32 * 1024;
const MAX_OUTBOUND_BYTES: usize = 16 * 1024;
const MAX_QUESTION_BYTES: usize = 8 * 1024;
const OUTBOUND_LEASE_MILLIS: i64 = 30_000;
const ITEM_WAITING: &str = "waiting";
const ITEM_REPORTED: &str = "reported";
const ITEM_CLOSED: &str = "closed";
const ITEM_PAUSED: &str = "paused";
const OUTBOUND_PENDING: &str = "pending";
const OUTBOUND_SENT: &str = "sent";
const OUTBOUND_FAILED: &str = "failed";
const OUTBOUND_UNKNOWN: &str = "unknown";

fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

fn text(value: &str, label: &str, max: usize) -> Result<()> {
    let trimmed = value.trim();
    anyhow::ensure!(!trimmed.is_empty(), "{label} is required");
    anyhow::ensure!(value.len() <= max, "{label} exceeds {max} bytes");
    Ok(())
}

fn validate_identity(provider: &str, app_id: &str) -> Result<()> {
    anyhow::ensure!(
        provider == "feishu" || provider == "lark",
        "chat mode supports feishu or lark only"
    );
    text(app_id, "appId", MAX_APP_ID_BYTES)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatBotConfigView {
    pub provider: String,
    pub app_id: String,
    /// The member whose Runtime answers this Bot once chat mode is on.
    pub agent_id: Option<String>,
    /// Inverse of the member's chat switch; kept so older read models stay valid.
    pub owner_only: bool,
    pub mode: String,
    /// The member's materials folder; also the execution root of chat Threads.
    pub materials_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMention {
    pub open_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInboundCommand {
    pub provider: String,
    pub app_id: String,
    pub external_message_id: String,
    pub chat_id: String,
    pub conversation_kind: String,
    pub chat_name: Option<String>,
    pub author_external_id: String,
    pub author_name: String,
    pub author_is_owner: bool,
    pub body: String,
    pub quote_message_id: Option<String>,
    #[serde(default)]
    pub mentions: Vec<ChatMention>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInboundResult {
    pub mode: String,
    pub duplicate: bool,
    pub owner: bool,
}

/// One inbound Feishu message admitted as a chat turn. Identity is the Bot's
/// published app; the answering member and folder come from Core state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnSubmitCommand {
    pub external_message_id: String,
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub conversation_kind: String,
    pub chat_name: Option<String>,
    pub author_name: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnSubmitResult {
    pub camp_id: String,
    pub camp_message_id: String,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnResultParams {
    pub provider: String,
    pub app_id: String,
    pub camp_message_id: String,
}

/// Pending and running are live; waiting needs a human in the App; every other
/// state is terminal. Text is only present once the turn succeeded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnResultView {
    pub status: String,
    pub text: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnAppendCommand {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub role: String,
    pub body: String,
    pub materials_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnView {
    pub role: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatItemCreateCommand {
    pub provider: String,
    pub app_id: String,
    pub requester_external_id: String,
    pub requester_name: String,
    pub destination_chat_id: String,
    pub destination_kind: String,
    pub target_external_id: String,
    pub target_name: String,
    pub target_is_owner: bool,
    pub question: String,
    pub ask_message_id: Option<String>,
    pub ask_chat_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatItemView {
    pub id: String,
    pub provider: String,
    pub app_id: String,
    pub requester_external_id: String,
    pub requester_name: String,
    pub destination_chat_id: String,
    pub destination_kind: String,
    pub target_external_id: String,
    pub target_name: String,
    pub target_is_owner: bool,
    pub question: String,
    pub ask_message_id: Option<String>,
    pub ask_chat_id: Option<String>,
    pub status: String,
    pub last_report_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatItemUpdateCommand {
    pub item_id: String,
    pub status: Option<String>,
    pub mark_reported: bool,
    #[serde(default)]
    pub ask_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOwnerTargetView {
    pub app_id: String,
    pub external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundEnqueueCommand {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub text: String,
    pub source: String,
    pub idempotency_key: String,
    #[serde(default)]
    pub camp_message_id: Option<String>,
    #[serde(default)]
    pub complete_turn: bool,
    #[serde(default)]
    pub uses_materials: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundView {
    pub id: String,
    pub chat_id: String,
    pub text: String,
    pub source: String,
    pub attempts: i64,
    pub target_kind: String,
    pub lease_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundEnqueueResult {
    pub outbound_id: String,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundSettleCommand {
    pub outbound_id: String,
    pub worker_id: String,
    pub lease_token: String,
    pub status: String,
    pub external_message_id: Option<String>,
    pub failure_code: Option<String>,
}

/// Validate columns used by chat storage without reading message or credential data.
pub(crate) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    for (table, columns) in [
        (
            "channel_chat_bot",
            "provider,app_id,owner_only,model_provider,model_name,model_base_url,materials_path,materials_status,updated_at",
        ),
        (
            "channel_chat_credential",
            "provider,app_id,api_key,updated_at",
        ),
        (
            "channel_chat_message",
            "id,provider,app_id,chat_id,conversation_kind,chat_name,author_external_id,author_name,author_is_owner,body,quote_message_id,external_message_id,dedupe_key,received_at",
        ),
        (
            "channel_chat_turn",
            "id,provider,app_id,chat_id,role,body,materials_only,created_at",
        ),
        (
            "channel_chat_item",
            "id,provider,app_id,requester_external_id,requester_name,destination_chat_id,destination_kind,target_external_id,target_name,target_is_owner,question,ask_message_id,ask_chat_id,status,last_report_at,created_at,updated_at",
        ),
        (
            "channel_chat_outbound",
            "id,provider,app_id,chat_id,body,source,idempotency_key,uses_materials,status,attempts,lease_owner,lease_expires_at,external_message_id,failure_code,created_at,updated_at",
        ),
    ] {
        let mut statement = connection.prepare("SELECT name FROM pragma_table_info(?1)")?;
        let actual = statement
            .query_map([table], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if columns
            .split(',')
            .any(|column| !actual.iter().any(|name| name == column))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Additive migration 223. Every table is chat-only state and never feeds Camp.
pub(crate) fn migrate(database: &mut Database) -> Result<()> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS channel_chat_bot (
            provider TEXT NOT NULL CHECK(provider IN ('feishu', 'lark')),
            app_id TEXT NOT NULL,
            owner_only INTEGER NOT NULL DEFAULT 1 CHECK(owner_only IN (0, 1)),
            model_provider TEXT,
            model_name TEXT,
            model_base_url TEXT,
            materials_path TEXT,
            materials_status TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, app_id)
        );

        CREATE TABLE IF NOT EXISTS channel_chat_credential (
            provider TEXT NOT NULL CHECK(provider IN ('feishu', 'lark')),
            app_id TEXT NOT NULL,
            api_key TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, app_id)
        );

        CREATE TABLE IF NOT EXISTS channel_chat_message (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            conversation_kind TEXT NOT NULL,
            chat_name TEXT,
            author_external_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            author_is_owner INTEGER NOT NULL DEFAULT 0 CHECK(author_is_owner IN (0, 1)),
            body TEXT NOT NULL,
            quote_message_id TEXT,
            external_message_id TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            received_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_message_chat_idx
            ON channel_chat_message(provider, app_id, chat_id, received_at);

        CREATE TABLE IF NOT EXISTS channel_chat_turn (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
            body TEXT NOT NULL,
            materials_only INTEGER NOT NULL DEFAULT 0 CHECK(materials_only IN (0, 1)),
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_turn_chat_idx
            ON channel_chat_turn(provider, app_id, chat_id, created_at);

        CREATE TABLE IF NOT EXISTS channel_chat_item (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            requester_external_id TEXT NOT NULL,
            requester_name TEXT NOT NULL,
            destination_chat_id TEXT NOT NULL,
            destination_kind TEXT NOT NULL,
            target_external_id TEXT NOT NULL,
            target_name TEXT NOT NULL,
            target_is_owner INTEGER NOT NULL DEFAULT 0 CHECK(target_is_owner IN (0, 1)),
            question TEXT NOT NULL,
            ask_message_id TEXT,
            ask_chat_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('waiting', 'reported', 'closed', 'paused')),
            last_report_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_item_target_idx
            ON channel_chat_item(provider, app_id, target_external_id, status);

        CREATE TABLE IF NOT EXISTS channel_chat_outbound (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            body TEXT NOT NULL,
            source TEXT NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            uses_materials INTEGER NOT NULL DEFAULT 0 CHECK(uses_materials IN (0, 1)),
            status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed', 'unknown')),
            attempts INTEGER NOT NULL DEFAULT 0,
            lease_owner TEXT,
            lease_expires_at INTEGER,
            external_message_id TEXT,
            failure_code TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_outbound_claim_idx
            ON channel_chat_outbound(provider, app_id, status, created_at);
        "#,
    )?;
    // Additive chat tables do not change any existing projection, so the
    // projection schema marker stays at 154.
    transaction.execute_batch("INSERT INTO schema_migration VALUES(223,datetime('now')); UPDATE rovai_data_contract SET projection_schema_version=173,updated_at=datetime('now') WHERE singleton=1;")?;
    transaction.commit()?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatScopeParams {
    pub provider: String,
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatPendingParams {
    pub provider: String,
    pub app_id: String,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatContextParams {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWaitingItemsParams {
    pub provider: String,
    pub app_id: String,
    pub target_external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundClaimParams {
    pub provider: String,
    pub app_id: String,
    pub worker_id: String,
    pub limit: i64,
}

/// Best-effort chat configuration for read models; a missing row means work mode.
pub(crate) fn config_for_app(
    connection: &Connection,
    provider: &str,
    app_id: &str,
) -> Option<ChatBotConfigView> {
    load_config(connection, provider, app_id).ok()
}

pub struct ChannelChatService;

impl ChannelChatService {
    pub fn snapshot(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<ChatBotConfigView> {
        validate_identity(provider, app_id)?;
        load_config(database.connection(), provider, app_id)
    }

    /// Admits one chat turn as an ordinary Camp execution inside the member's
    /// materials folder. The Thread is created once per external chat and then
    /// reused, so a conversation keeps its Runtime session.
    pub fn submit_turn(
        &self,
        database: &mut Database,
        command: &ChatTurnSubmitCommand,
    ) -> Result<ChatTurnSubmitResult> {
        validate_identity(&command.provider, &command.app_id)?;
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        text(
            &command.external_message_id,
            "externalMessageId",
            MAX_CHAT_ID_BYTES,
        )?;
        // Immutable inbound receipts own author, content and conversation identity.
        let (inbound_id, frozen): (String, ChatTurnSubmitCommand) = database.connection().query_row(
            "SELECT id,chat_id,conversation_kind,chat_name,author_name,body FROM channel_chat_message WHERE provider=?1 AND app_id=?2 AND external_message_id=?3",
            params![command.provider,command.app_id,command.external_message_id],
            |row| Ok((row.get(0)?, ChatTurnSubmitCommand { external_message_id: command.external_message_id.clone(), provider:command.provider.clone(), app_id:command.app_id.clone(), chat_id:row.get(1)?, conversation_kind:row.get(2)?,chat_name:row.get(3)?,author_name:row.get(4)?,body:row.get(5)? }))
        ).optional()?.context("chat inbound receipt is missing")?;
        anyhow::ensure!(
            command.chat_id == frozen.chat_id,
            "chat inbound scope mismatch"
        );
        let command = &frozen;
        if let Some(result) = database
            .connection()
            .query_row(
                "SELECT camp_id,camp_message_id FROM channel_chat_input WHERE inbound_id=?1",
                [&inbound_id],
                |row| {
                    Ok(ChatTurnSubmitResult {
                        camp_id: row.get(0)?,
                        camp_message_id: row.get(1)?,
                        duplicate: true,
                    })
                },
            )
            .optional()?
        {
            return Ok(result);
        }
        let config = load_config(database.connection(), &command.provider, &command.app_id)?;
        anyhow::ensure!(
            config.mode == CHAT_MODE,
            "chat mode is not enabled for this Bot"
        );
        let agent_id = config
            .agent_id
            .clone()
            .context("the chat Bot has no published member")?;
        let materials_path = config
            .materials_path
            .clone()
            .context("the chat Bot member has no materials folder")?;
        std::fs::create_dir_all(&materials_path)
            .with_context(|| format!("failed to prepare chat materials at {materials_path}"))?;
        let adapter_kind: Option<String> = database
            .connection()
            .query_row(
                "SELECT selected_runtime_adapter_kind FROM agent_profile WHERE id = ?1",
                [&agent_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        AdapterKind::from_str(
            adapter_kind
                .as_deref()
                .context("the chat Bot member has no Runtime configuration")?,
        )?;
        let now = Utc::now().to_rfc3339();
        let command_id = format!("chat-turn-{}", Uuid::new_v4());
        let body = format!(
            "[{}·{}] {}",
            conversation_label(command),
            command.author_name.trim(),
            command.body.trim()
        );
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = transaction
            .query_row(
                "SELECT camp_id,camp_message_id FROM channel_chat_input WHERE inbound_id=?1",
                [&inbound_id],
                |row| {
                    Ok(ChatTurnSubmitResult {
                        camp_id: row.get(0)?,
                        camp_message_id: row.get(1)?,
                        duplicate: true,
                    })
                },
            )
            .optional()?
        {
            return Ok(result);
        }
        let camp_id = bound_camp(
            &transaction,
            &command.provider,
            &command.app_id,
            &command.chat_id,
            &agent_id,
            &materials_path,
        )?;
        let admission = CollaborationService::default().admit_chat_bot_turn(
            &transaction,
            ChatBotTurnAdmissionInput {
                agent_id: agent_id.clone(),
                camp_id,
                camp_title: camp_title(command),
                project_path: materials_path.clone(),
                body,
                command_id: command_id.clone(),
                now: now.clone(),
            },
        )?;
        let admission = match admission {
            Ok(admission) => admission,
            Err(rejection) => anyhow::bail!("chat turn was rejected: {}", rejection.code),
        };
        transaction.execute(
            r#"
            INSERT INTO channel_chat_conversation(provider, app_id, chat_id, camp_id, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(provider, app_id, chat_id) DO UPDATE SET
                camp_id = excluded.camp_id,
                created_at = excluded.created_at
            "#,
            params![
                command.provider,
                command.app_id,
                command.chat_id,
                admission.camp_id,
                now_millis(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO channel_chat_input(inbound_id,camp_message_id,camp_id) VALUES(?1,?2,?3)",
            params![inbound_id, admission.camp_message_id, admission.camp_id],
        )?;
        transaction.execute(
            "UPDATE camp SET navigation_is_chat_bot = 1 WHERE id = ?1",
            [&admission.camp_id],
        )?;
        transaction.commit()?;
        Ok(ChatTurnSubmitResult {
            camp_id: admission.camp_id,
            camp_message_id: admission.camp_message_id,
            duplicate: false,
        })
    }

    /// Reads the authoritative state of one submitted chat turn.
    pub fn turn_result(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        camp_message_id: &str,
    ) -> Result<ChatTurnResultView> {
        validate_identity(provider, app_id)?;
        let connection = database.connection();
        anyhow::ensure!(connection.query_row("SELECT EXISTS(SELECT 1 FROM channel_chat_input b JOIN channel_chat_message m ON m.id=b.inbound_id WHERE b.camp_message_id=?1 AND m.provider=?2 AND m.app_id=?3)",params![camp_message_id,provider,app_id],|r|r.get::<_,bool>(0))?,"chat turn scope mismatch");
        let delivery = connection
            .query_row(
                r#"
                SELECT delivery.status, delivery.claimed_agent_run_id
                FROM camp_message_delivery AS delivery
                WHERE delivery.message_id = ?1
                ORDER BY delivery.created_at, delivery.id
                LIMIT 1
                "#,
                [camp_message_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        let Some((delivery_status, agent_run_id)) = delivery else {
            return Ok(ChatTurnResultView {
                status: "failed".to_string(),
                text: None,
                reason: Some("chat_turn_not_admitted".to_string()),
            });
        };
        let Some(agent_run_id) = agent_run_id else {
            return Ok(ChatTurnResultView {
                status: if delivery_status == "cancelled" {
                    "cancelled".to_string()
                } else {
                    "pending".to_string()
                },
                text: None,
                reason: None,
            });
        };
        let (run_status, wait_reason) = connection
            .query_row(
                "SELECT status, wait_reason FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .context("chat turn Run does not exist")?;
        let status = match run_status.as_str() {
            "queued" => "pending",
            "running" => "running",
            "succeeded" => "completed",
            "waiting" => "waiting",
            "failed" => "failed",
            "cancelled" => "cancelled",
            other => other,
        };
        if status != "completed" {
            return Ok(ChatTurnResultView {
                status: status.to_string(),
                text: None,
                reason: wait_reason,
            });
        }
        let text = agent_run_result_text(connection, &agent_run_id)?;
        let reason = if text.is_none() {
            Some("empty_result".to_string())
        } else {
            None
        };
        Ok(ChatTurnResultView {
            status: "completed".to_string(),
            text,
            reason,
        })
    }

    pub fn inbound(
        &self,
        database: &mut Database,
        command: &ChatInboundCommand,
    ) -> Result<ChatInboundResult> {
        validate_identity(&command.provider, &command.app_id)?;
        text(
            &command.external_message_id,
            "externalMessageId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        text(
            &command.author_external_id,
            "authorExternalId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(&command.body, "body", MAX_BODY_BYTES)?;
        let config = load_config(database.connection(), &command.provider, &command.app_id)?;
        anyhow::ensure!(command.mentions.len() <= 20, "too many mentions");
        for mention in &command.mentions {
            text(&mention.open_id, "mention openId", 512)?;
            text(&mention.name, "mention name", 256)?;
        }
        let mentions_json = serde_json::to_string(&command.mentions)?;
        let dedupe_key = format!(
            "{}\u{0}{}\u{0}{}",
            command.provider, command.app_id, command.external_message_id
        );
        let now = now_millis();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let inserted = transaction.execute(
            r#"
            INSERT INTO channel_chat_message(
                id, provider, app_id, chat_id, conversation_kind, chat_name,
                author_external_id, author_name, author_is_owner, body,
                quote_message_id, external_message_id, dedupe_key, received_at, mentions_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(dedupe_key) DO NOTHING
            "#,
            params![
                Uuid::new_v4().to_string(),
                command.provider,
                command.app_id,
                command.chat_id,
                command.conversation_kind,
                command.chat_name,
                command.author_external_id,
                command.author_name,
                i64::from(command.author_is_owner),
                command.body,
                command.quote_message_id,
                command.external_message_id,
                dedupe_key,
                now,
                mentions_json
            ],
        )?;
        let duplicate = inserted == 0;
        if !duplicate {
            transaction.execute(
                r#"
                INSERT INTO channel_chat_turn(
                    id, provider, app_id, chat_id, role, body, materials_only, created_at
                ) VALUES (?1, ?2, ?3, ?4, 'user', ?5, 0, ?6)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    command.provider,
                    command.app_id,
                    command.chat_id,
                    command.body,
                    now
                ],
            )?;
        }
        transaction.commit()?;
        Ok(ChatInboundResult {
            mode: config.mode,
            duplicate,
            owner: command.author_is_owner,
        })
    }

    pub fn append_turn(
        &self,
        database: &mut Database,
        command: &ChatTurnAppendCommand,
    ) -> Result<()> {
        validate_identity(&command.provider, &command.app_id)?;
        anyhow::ensure!(
            command.role == "user" || command.role == "assistant",
            "unsupported chat turn role"
        );
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        anyhow::ensure!(!command.body.trim().is_empty(), "turn body is required");
        anyhow::ensure!(
            command.body.len() <= MAX_BODY_BYTES,
            "turn body is too large"
        );
        database.connection().execute(
            r#"
            INSERT INTO channel_chat_turn(
                id, provider, app_id, chat_id, role, body, materials_only, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                Uuid::new_v4().to_string(),
                command.provider,
                command.app_id,
                command.chat_id,
                command.role,
                command.body,
                i64::from(command.materials_only),
                now_millis()
            ],
        )?;
        Ok(())
    }

    pub fn context(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        chat_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatTurnView>> {
        validate_identity(provider, app_id)?;
        let limit = limit.clamp(1, 40);
        let mut statement = database.connection().prepare(
            r#"
            SELECT role, body FROM (
                SELECT role, body, created_at, rowid FROM channel_chat_turn
                WHERE provider = ?1 AND app_id = ?2 AND chat_id = ?3 AND materials_only = 0
                ORDER BY created_at DESC, rowid DESC LIMIT ?4
            ) ORDER BY created_at ASC, rowid ASC
            "#,
        )?;
        let rows = statement.query_map(params![provider, app_id, chat_id, limit], |row| {
            Ok(ChatTurnView {
                role: row.get(0)?,
                body: row.get(1)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn create_item(
        &self,
        database: &mut Database,
        command: &ChatItemCreateCommand,
    ) -> Result<ChatItemView> {
        validate_identity(&command.provider, &command.app_id)?;
        text(
            &command.requester_external_id,
            "requesterExternalId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(
            &command.destination_chat_id,
            "destinationChatId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(
            &command.target_external_id,
            "targetExternalId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(&command.question, "question", MAX_QUESTION_BYTES)?;
        let now = now_millis();
        let id = Uuid::new_v4().to_string();
        database.connection().execute(
            r#"
            INSERT INTO channel_chat_item(
                id, provider, app_id, requester_external_id, requester_name,
                destination_chat_id, destination_kind, target_external_id,
                target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                status, last_report_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, ?15)
            "#,
            params![
                id,
                command.provider,
                command.app_id,
                command.requester_external_id,
                command.requester_name,
                command.destination_chat_id,
                command.destination_kind,
                command.target_external_id,
                command.target_name,
                i64::from(command.target_is_owner),
                command.question,
                command.ask_message_id,
                command.ask_chat_id,
                ITEM_WAITING,
                now
            ],
        )?;
        self.item(database, &id)?
            .context("chat item disappeared after insert")
    }

    pub fn item(&self, database: &mut Database, item_id: &str) -> Result<Option<ChatItemView>> {
        database
            .connection()
            .query_row(
                r#"
                SELECT id, provider, app_id, requester_external_id, requester_name,
                       destination_chat_id, destination_kind, target_external_id,
                       target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                       status, last_report_at, created_at
                FROM channel_chat_item WHERE id = ?1
                "#,
                [item_id],
                item_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn waiting_items_for_target(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        target_external_id: &str,
    ) -> Result<Vec<ChatItemView>> {
        validate_identity(provider, app_id)?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, provider, app_id, requester_external_id, requester_name,
                   destination_chat_id, destination_kind, target_external_id,
                   target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                   status, last_report_at, created_at
            FROM channel_chat_item
            WHERE provider = ?1 AND app_id = ?2 AND target_external_id = ?3 AND status = ?4
            ORDER BY created_at ASC
            "#,
        )?;
        let rows = statement.query_map(
            params![provider, app_id, target_external_id, ITEM_WAITING],
            item_row,
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn active_items(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<Vec<ChatItemView>> {
        validate_identity(provider, app_id)?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, provider, app_id, requester_external_id, requester_name,
                   destination_chat_id, destination_kind, target_external_id,
                   target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                   status, last_report_at, created_at
            FROM channel_chat_item
            WHERE provider = ?1 AND app_id = ?2 AND status = ?3
            ORDER BY created_at ASC LIMIT 50
            "#,
        )?;
        let rows = statement.query_map(params![provider, app_id, ITEM_WAITING], item_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn update_item(
        &self,
        database: &mut Database,
        command: &ChatItemUpdateCommand,
    ) -> Result<ChatItemView> {
        let now = now_millis();
        let existing = self
            .item(database, &command.item_id)?
            .context("chat item not found")?;
        let status = command
            .status
            .as_deref()
            .unwrap_or(existing.status.as_str());
        anyhow::ensure!(
            matches!(
                status,
                ITEM_WAITING | ITEM_REPORTED | ITEM_CLOSED | ITEM_PAUSED
            ),
            "unsupported chat item status"
        );
        database.connection().execute(
            r#"
            UPDATE channel_chat_item
            SET status = ?2,
                last_report_at = CASE WHEN ?3 = 1 THEN ?4 ELSE last_report_at END,
                ask_message_id = COALESCE(?5, ask_message_id),
                updated_at = ?4
            WHERE id = ?1
            "#,
            params![
                command.item_id,
                status,
                i64::from(command.mark_reported),
                now,
                command.ask_message_id
            ],
        )?;
        self.item(database, &command.item_id)?
            .context("chat item disappeared after update")
    }

    pub fn owner_target(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<Option<ChatOwnerTargetView>> {
        validate_identity(provider, app_id)?;
        let (bot, owner, app) = match provider {
            "feishu" => (
                "feishu_member_bot",
                "feishu_owner_identity",
                "feishu_owner_app_identity",
            ),
            _ => (
                "lark_member_bot",
                "lark_owner_identity",
                "lark_owner_app_identity",
            ),
        };
        database
            .connection()
            .query_row(
                &format!(
                    r#"
                    SELECT bot.app_id, identity.external_id
                    FROM {bot} AS bot
                    JOIN {owner} AS owner ON owner.account_id = bot.account_id
                    JOIN {app} AS app
                      ON app.account_id = bot.account_id AND app.app_id = bot.app_id
                    JOIN external_principal_app_identity AS identity
                      ON identity.principal_id = owner.canonical_owner_principal_id
                     AND identity.provider = ?1 AND identity.app_id = bot.app_id
                     AND identity.identity_kind = 'open_id'
                    WHERE bot.app_id = ?2 AND bot.status = 'published'
                    "#
                ),
                params![provider, app_id],
                |row| {
                    Ok(ChatOwnerTargetView {
                        app_id: row.get(0)?,
                        external_id: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn enqueue(
        &self,
        database: &mut Database,
        command: &ChatOutboundEnqueueCommand,
    ) -> Result<ChatOutboundEnqueueResult> {
        validate_identity(&command.provider, &command.app_id)?;
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        text(&command.text, "text", MAX_OUTBOUND_BYTES)?;
        text(&command.source, "source", 64)?;
        text(&command.idempotency_key, "idempotencyKey", 512)?;
        let now = now_millis();
        let id = Uuid::new_v4().to_string();
        let tx = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(message) = command.camp_message_id.as_deref() {
            let previous:Option<Option<String>>=tx.query_row("SELECT b.reply_outbound_id FROM channel_chat_input b JOIN channel_chat_message m ON m.id=b.inbound_id WHERE b.camp_message_id=?1 AND m.provider=?2 AND m.app_id=?3 AND m.chat_id=?4",params![message,command.provider,command.app_id,command.chat_id],|r|r.get(0)).optional()?;
            match previous {
                Some(Some(outbound_id)) => {
                    return Ok(ChatOutboundEnqueueResult {
                        outbound_id,
                        duplicate: true,
                    });
                }
                Some(None) => {}
                None => anyhow::bail!("chat reply input scope mismatch"),
            }
        }
        let inserted = tx.execute(
            r#"
            INSERT INTO channel_chat_outbound(
                id, provider, app_id, chat_id, body, source, idempotency_key,
                uses_materials, status, attempts, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)
            ON CONFLICT(idempotency_key) DO NOTHING
            "#,
            params![
                id,
                command.provider,
                command.app_id,
                command.chat_id,
                command.text,
                command.source,
                command.idempotency_key,
                i64::from(command.uses_materials),
                OUTBOUND_PENDING,
                now
            ],
        )?;
        let outbound_id = if inserted == 1 {
            id
        } else {
            tx.query_row("SELECT id FROM channel_chat_outbound WHERE idempotency_key=?1 AND provider=?2 AND app_id=?3 AND chat_id=?4 AND body=?5 AND source=?6",params![command.idempotency_key,command.provider,command.app_id,command.chat_id,command.text,command.source],|row|row.get::<_,String>(0)).optional()?.context("outbound idempotency conflict")?
        };
        if let Some(message) = command
            .camp_message_id
            .as_deref()
            .filter(|_| command.complete_turn)
        {
            tx.execute(
                "UPDATE channel_chat_input SET reply_outbound_id=?2 WHERE camp_message_id=?1",
                params![message, outbound_id],
            )?;
        }
        tx.commit()?;
        Ok(ChatOutboundEnqueueResult {
            outbound_id,
            duplicate: inserted == 0,
        })
    }

    pub fn claim(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        worker_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatOutboundView>> {
        validate_identity(provider, app_id)?;
        text(worker_id, "workerId", 256)?;
        let limit = limit.clamp(1, 50);
        let config = load_config(database.connection(), provider, app_id)?;
        if config.mode != CHAT_MODE {
            return Ok(vec![]);
        }
        let now = now_millis();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // An expired send is ambiguous, not permission to send again. Retain its
        // exact worker/token so a late truthful receipt can still be recorded.
        transaction.execute("UPDATE channel_chat_outbound SET status='unknown',failure_code='lease_expired',updated_at=?3 WHERE provider=?1 AND app_id=?2 AND status='pending' AND lease_expires_at<=?3",params![provider,app_id,now])?;
        let ids: Vec<String> = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id FROM channel_chat_outbound
                WHERE provider = ?1 AND app_id = ?2 AND status = ?3
                  AND (lease_expires_at IS NULL OR lease_expires_at <= ?4)
                ORDER BY created_at ASC, rowid ASC
                LIMIT ?5
                "#,
            )?;
            let rows = statement.query_map(
                params![provider, app_id, OUTBOUND_PENDING, now, limit],
                |row| row.get(0),
            )?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            if !crate::channel_chat_tools::outbound_authorized(&transaction, &id)? {
                transaction.execute("UPDATE channel_chat_outbound SET status='failed',failure_code='scope_unavailable',updated_at=?2 WHERE id=?1",params![id,now])?;
                continue;
            }
            let lease_token = Uuid::new_v4().to_string();
            transaction.execute(
                r#"
                UPDATE channel_chat_outbound
                SET lease_owner = ?2, lease_expires_at = ?3, lease_token = ?6,
                    attempts = attempts + 1, updated_at = ?4
                WHERE id = ?1 AND status = ?5
                "#,
                params![
                    id,
                    worker_id,
                    now + OUTBOUND_LEASE_MILLIS,
                    now,
                    OUTBOUND_PENDING,
                    lease_token
                ],
            )?;
            let view = transaction.query_row(
                "SELECT id, chat_id, body, source, attempts, target_kind, lease_token FROM channel_chat_outbound WHERE id = ?1",
                [&id],
                |row| {
                    Ok(ChatOutboundView {
                        id: row.get(0)?,
                        chat_id: row.get(1)?,
                        text: row.get(2)?,
                        source: row.get(3)?,
                        attempts: row.get(4)?,
                        target_kind: row.get(5)?,
                        lease_token: row.get(6)?,
                    })
                },
            )?;
            claimed.push(view);
        }
        transaction.commit()?;
        Ok(claimed)
    }

    pub fn settle(
        &self,
        database: &mut Database,
        command: &ChatOutboundSettleCommand,
    ) -> Result<bool> {
        anyhow::ensure!(
            matches!(
                command.status.as_str(),
                OUTBOUND_SENT | OUTBOUND_FAILED | OUTBOUND_UNKNOWN
            ),
            "unsupported outbound status"
        );
        let tx = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let updated = tx.execute(
            r#"
            UPDATE channel_chat_outbound
            SET status = ?2, external_message_id = ?3, failure_code = ?4,
                lease_expires_at = NULL, updated_at = ?5
            WHERE id = ?1 AND lease_owner=?6 AND lease_token=?7
              AND (status='pending' OR (status='unknown' AND ?2='sent'))
            "#,
            params![
                command.outbound_id,
                command.status,
                command.external_message_id,
                command.failure_code,
                now_millis(),
                command.worker_id,
                command.lease_token
            ],
        )?;
        if updated == 1 && command.status == OUTBOUND_SENT {
            tx.execute("UPDATE channel_chat_item SET ask_message_id=?2,ask_chat_id=(SELECT chat_id FROM channel_chat_outbound WHERE id=?1) WHERE id=(SELECT item_id FROM channel_chat_outbound WHERE id=?1 AND target_kind='open_id')",params![command.outbound_id,command.external_message_id])?;
            tx.execute("UPDATE channel_chat_item SET last_report_at=?2,updated_at=?2 WHERE id=(SELECT item_id FROM channel_chat_outbound WHERE id=?1 AND target_kind='chat_id')",params![command.outbound_id,now_millis()])?;
        }
        if updated == 1 && command.status == OUTBOUND_FAILED {
            tx.execute("UPDATE channel_chat_item SET status='paused',updated_at=?2 WHERE id=(SELECT item_id FROM channel_chat_outbound WHERE id=?1 AND target_kind='open_id') AND status='waiting'",params![command.outbound_id,now_millis()])?;
        }
        tx.commit()?;
        Ok(updated == 1)
    }

    pub fn cancel_pending(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<()> {
        validate_identity(provider, app_id)?;
        database.connection().execute(
            "UPDATE channel_chat_outbound SET status = CASE WHEN lease_owner IS NULL THEN ?3 ELSE 'unknown' END, failure_code='mode_closed', updated_at = ?4
             WHERE provider = ?1 AND app_id = ?2 AND status = ?5",
            params![
                provider,
                app_id,
                OUTBOUND_FAILED,
                now_millis(),
                OUTBOUND_PENDING
            ],
        )?;
        Ok(())
    }
}

fn conversation_label(command: &ChatTurnSubmitCommand) -> String {
    match command.conversation_kind.as_str() {
        "p2p" => "飞书私聊".to_string(),
        "topic" => command
            .chat_name
            .as_deref()
            .map(|name| format!("飞书话题「{name}」"))
            .unwrap_or_else(|| "飞书话题".to_string()),
        _ => command
            .chat_name
            .as_deref()
            .map(|name| format!("飞书群聊「{name}」"))
            .unwrap_or_else(|| "飞书群聊".to_string()),
    }
}

fn camp_title(command: &ChatTurnSubmitCommand) -> String {
    match command.conversation_kind.as_str() {
        "p2p" => format!("飞书私聊 · {}", command.author_name.trim()),
        _ => conversation_label(command),
    }
}

/// The Thread bound to this external chat, when it is still usable for the same
/// member and folder. Anything else opens a fresh Thread on the next turn.
fn bound_camp(
    connection: &Connection,
    provider: &str,
    app_id: &str,
    chat_id: &str,
    agent_id: &str,
    materials_path: &str,
) -> Result<Option<String>> {
    Ok(connection
        .query_row(
            r#"
            SELECT mapping.camp_id
            FROM channel_chat_conversation AS mapping
            JOIN camp ON camp.id = mapping.camp_id
            WHERE mapping.provider = ?1 AND mapping.app_id = ?2
              AND mapping.chat_id = ?3
              AND camp.deletion_operation_id IS NULL
              AND camp.default_lead_agent_id = ?4
              AND camp.project_path = ?5
            "#,
            params![provider, app_id, chat_id, agent_id, materials_path],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn agent_run_result_text(connection: &Connection, agent_run_id: &str) -> Result<Option<String>> {
    let body = connection
        .query_row(
            r#"
            SELECT message.body
            FROM agent_run AS run
            JOIN camp_message AS message ON message.id = run.final_camp_message_id
            WHERE run.id = ?1 AND message.source_agent_run_id = run.id
              AND message.author_type = 'agent' AND message.tombstoned_at IS NULL
              AND json_array_length(message.effective_recipient_ids_json) = 0
            "#,
            [agent_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if body.is_some() {
        return Ok(body);
    }
    connection
        .query_row(
            r#"
            SELECT body FROM camp_message
            WHERE source_agent_run_id = ?1 AND author_type = 'agent'
              AND tombstoned_at IS NULL
              AND json_array_length(effective_recipient_ids_json) = 0
            ORDER BY sequence DESC, id DESC LIMIT 1
            "#,
            [agent_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

/// Chat mode is a member switch: the Bot answers only when its published member
/// has chat enabled and a materials folder to run in.
fn load_config(connection: &Connection, provider: &str, app_id: &str) -> Result<ChatBotConfigView> {
    let row = connection
        .query_row(
            r#"
            SELECT bot.agent_id, profile.chat_bot_enabled, profile.chat_materials_path
            FROM channel_member_bot_directory AS bot
            LEFT JOIN agent_profile AS profile ON profile.id = bot.agent_id
            WHERE bot.provider = ?1 AND bot.app_id = ?2
            "#,
            params![provider, app_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((agent_id, enabled, materials_path)) = row else {
        return Ok(ChatBotConfigView {
            provider: provider.to_string(),
            app_id: app_id.to_string(),
            agent_id: None,
            owner_only: true,
            mode: WORK_MODE.to_string(),
            materials_path: None,
        });
    };
    let materials_path = materials_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    let chat = enabled == 1 && materials_path.is_some();
    Ok(ChatBotConfigView {
        provider: provider.to_string(),
        app_id: app_id.to_string(),
        agent_id: Some(agent_id),
        owner_only: !chat,
        mode: if chat { CHAT_MODE } else { WORK_MODE }.to_string(),
        materials_path,
    })
}

fn item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatItemView> {
    Ok(ChatItemView {
        id: row.get(0)?,
        provider: row.get(1)?,
        app_id: row.get(2)?,
        requester_external_id: row.get(3)?,
        requester_name: row.get(4)?,
        destination_chat_id: row.get(5)?,
        destination_kind: row.get(6)?,
        target_external_id: row.get(7)?,
        target_name: row.get(8)?,
        target_is_owner: row.get::<_, i64>(9)? == 1,
        question: row.get(10)?,
        ask_message_id: row.get(11)?,
        ask_chat_id: row.get(12)?,
        status: row.get(13)?,
        last_report_at: row.get(14)?,
        created_at: row.get(15)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded_runtime_database_owned;

    const PROVIDER: &str = "feishu";
    const APP: &str = "cli_chat_test";

    fn enable_chat(database: &mut Database, materials: &std::path::Path) {
        database
            .connection()
            .execute_batch(&format!(
                "INSERT OR IGNORE INTO feishu_account(
                    id, identity_digest, display_name, tenant_name, status, version,
                    created_at, updated_at)
                 VALUES ('account_chat', 'digest', 'Owner', 'Tenant', 'connected', 1,
                    '2026-01-01', '2026-01-01');
                 INSERT OR REPLACE INTO feishu_member_bot(
                    agent_id, account_id, app_id, bot_display_name, credential_ref,
                    status, version, created_at, updated_at, published_at)
                 VALUES ('agent_1', 'account_chat', '{APP}', '聊天 Bot', 'credential_chat',
                    'published', 1, '2026-01-01', '2026-01-01', '2026-01-01');
                 UPDATE agent_profile
                 SET chat_bot_enabled = 1, chat_materials_path = '{}'
                 WHERE id = 'agent_1';",
                materials.to_string_lossy().replace('\\', "/")
            ))
            .unwrap();
    }

    fn materials_root() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("rovai-chat-root-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn chat_mode_follows_the_member_switch_and_materials_folder() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;

        let default = service.snapshot(&mut database, PROVIDER, APP).unwrap();
        assert!(default.owner_only);
        assert_eq!(default.mode, WORK_MODE);
        assert!(default.agent_id.is_none());

        let root = materials_root();
        enable_chat(&mut database, &root);
        let chat = service.snapshot(&mut database, PROVIDER, APP).unwrap();
        assert_eq!(chat.mode, CHAT_MODE);
        assert!(!chat.owner_only);
        assert_eq!(chat.agent_id.as_deref(), Some("agent_1"));
        assert_eq!(
            chat.materials_path.as_deref(),
            Some(root.to_string_lossy().replace('\\', "/").as_str())
        );

        // A member without a materials folder can never reach chat mode.
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET chat_materials_path = NULL WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        assert_eq!(
            service.snapshot(&mut database, PROVIDER, APP).unwrap().mode,
            WORK_MODE
        );
    }

    #[test]
    fn submit_turn_runs_in_the_materials_folder_and_reuses_the_thread() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        let root = materials_root();
        enable_chat(&mut database, &root);
        let mut command = ChatTurnSubmitCommand {
            external_message_id: "om_submit_1".to_string(),
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            chat_id: "oc_chat".to_string(),
            conversation_kind: "p2p".to_string(),
            chat_name: None,
            author_name: "请求者".to_string(),
            body: "帮我记一条备忘".to_string(),
        };
        let mut inbound = ChatInboundCommand {
            provider: command.provider.clone(),
            app_id: command.app_id.clone(),
            external_message_id: command.external_message_id.clone(),
            chat_id: command.chat_id.clone(),
            conversation_kind: command.conversation_kind.clone(),
            chat_name: None,
            author_external_id: "ou_requester".into(),
            author_name: command.author_name.clone(),
            author_is_owner: false,
            body: command.body.clone(),
            quote_message_id: None,
            mentions: vec![],
        };
        service.inbound(&mut database, &inbound).unwrap();
        let first = service.submit_turn(&mut database, &command).unwrap();
        let replay = service.submit_turn(&mut database, &command).unwrap();
        assert!(replay.duplicate);
        assert_eq!(replay.camp_message_id, first.camp_message_id);
        command.external_message_id = "om_submit_2".into();
        inbound.external_message_id = command.external_message_id.clone();
        service.inbound(&mut database, &inbound).unwrap();
        let second = service.submit_turn(&mut database, &command).unwrap();
        assert_eq!(first.camp_id, second.camp_id);
        assert_ne!(first.camp_message_id, second.camp_message_id);

        let camps: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM camp", [], |row| row.get(0))
            .unwrap();
        assert_eq!(camps, 1);
        let (project_path, binding_kind): (String, String) = database
            .connection()
            .query_row(
                "SELECT project_path, project_binding_kind FROM camp WHERE id = ?1",
                [&first.camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(project_path, root.to_string_lossy().replace('\\', "/"));
        assert_eq!(binding_kind, "directory");

        // The turn is an ordinary Delivery, claimed later by the scheduler.
        let deliveries: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message_delivery WHERE status = 'waiting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(deliveries, 2);
        let pending = service
            .turn_result(&mut database, PROVIDER, APP, &first.camp_message_id)
            .unwrap();
        assert_eq!(pending.status, "pending");
        let mut notice = ChatOutboundEnqueueCommand {
            provider: PROVIDER.into(),
            app_id: APP.into(),
            chat_id: command.chat_id.clone(),
            text: "approval required".into(),
            source: "notice".into(),
            idempotency_key: "waiting-notice".into(),
            camp_message_id: Some(first.camp_message_id.clone()),
            complete_turn: false,
            uses_materials: false,
        };
        service.enqueue(&mut database, &notice).unwrap();
        let ack: Option<String> = database
            .connection()
            .query_row(
                "SELECT reply_outbound_id FROM channel_chat_input WHERE camp_message_id=?1",
                [&first.camp_message_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            ack.is_none(),
            "waiting notice must not complete the durable turn"
        );
        notice.text = "final reply".into();
        notice.source = "reply".into();
        notice.idempotency_key = "final-reply".into();
        notice.complete_turn = true;
        let final_reply = service.enqueue(&mut database, &notice).unwrap();
        let ack: String = database
            .connection()
            .query_row(
                "SELECT reply_outbound_id FROM channel_chat_input WHERE camp_message_id=?1",
                [&first.camp_message_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ack, final_reply.outbound_id);
        assert!(service.enqueue(&mut database, &notice).unwrap().duplicate);

        let override_json: Option<String> = database
            .connection()
            .query_row(
                "SELECT permission_override_json FROM conversation LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(override_json.is_none());
        let conversation_id: String = database
            .connection()
            .query_row("SELECT id FROM conversation LIMIT 1", [], |r| r.get(0))
            .unwrap();
        let saved: String = database
            .connection()
            .query_row(
                "SELECT default_permission_config_json FROM agent_profile WHERE id='agent_1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let saved: crate::agent_profile::AdapterPermissionConfig =
            serde_json::from_str(&saved).unwrap();
        // Old chat rows must not override the member after an upgrade either.
        database.connection().execute("UPDATE conversation SET permission_override_json='not-current-permissions' WHERE id=?1",[&conversation_id]).unwrap();
        let tx = database.connection_mut().transaction().unwrap();
        let frozen = crate::agent_profile::resolve_frozen_runtime(&tx, &conversation_id, "agent_1")
            .unwrap()
            .unwrap();
        assert_eq!(frozen.permissions, saved);
        tx.commit().unwrap();
        command.external_message_id = "om_after_permissions_fix".into();
        inbound.external_message_id = command.external_message_id.clone();
        service.inbound(&mut database, &inbound).unwrap();
        service.submit_turn(&mut database, &command).unwrap();
        let stale: Option<String> = database
            .connection()
            .query_row(
                "SELECT permission_override_json FROM conversation WHERE id=?1",
                [&conversation_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(stale.is_none());
        let navigation = crate::read_model::ReadModelService;
        let snapshot = navigation.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.chat_bot.total_count, 1);
        assert!(snapshot.projects.is_empty());
        assert_eq!(snapshot.chat_bot.recent_camps[0].id, first.camp_id);

        // Rebinding the same external chat must not move its earlier history into Projects.
        let next_root = materials_root();
        enable_chat(&mut database, &next_root);
        command.external_message_id = "om_rebound_navigation".into();
        inbound.external_message_id = command.external_message_id.clone();
        service.inbound(&mut database, &inbound).unwrap();
        let replacement = service.submit_turn(&mut database, &command).unwrap();
        assert_ne!(first.camp_id, replacement.camp_id);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET chat_bot_enabled = 0 WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        let snapshot = navigation.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.chat_bot.total_count, 2);
        assert!(snapshot.projects.is_empty());
        assert!(
            snapshot
                .chat_bot
                .recent_camps
                .iter()
                .all(|camp| camp.navigation_group_key == "chat-bot")
        );
    }

    #[test]
    fn duplicate_inbound_events_do_not_repeat_the_conversation_turn() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        let root = materials_root();
        enable_chat(&mut database, &root);
        let command = ChatInboundCommand {
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            external_message_id: "om_1".to_string(),
            chat_id: "oc_chat".to_string(),
            conversation_kind: "p2p".to_string(),
            chat_name: None,
            author_external_id: "ou_requester".to_string(),
            author_name: "请求者".to_string(),
            author_is_owner: false,
            body: "你好".to_string(),
            quote_message_id: None,
            mentions: vec![],
        };
        let first = service.inbound(&mut database, &command).unwrap();
        assert!(!first.duplicate);
        assert_eq!(first.mode, CHAT_MODE);
        let second = service.inbound(&mut database, &command).unwrap();
        assert!(second.duplicate);

        let turns = service
            .context(&mut database, PROVIDER, APP, "oc_chat", 10)
            .unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].body, "你好");
    }

    #[test]
    fn outbound_enqueue_is_idempotent_and_a_lease_prevents_double_claim() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        enable_chat(&mut database, &materials_root());
        let command = ChatOutboundEnqueueCommand {
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            chat_id: "oc_chat".to_string(),
            text: "已收到".to_string(),
            source: "reply".to_string(),
            idempotency_key: "turn-1-reply".to_string(),
            camp_message_id: None,
            complete_turn: false,
            uses_materials: false,
        };
        let first = service.enqueue(&mut database, &command).unwrap();
        assert!(!first.duplicate);
        let second = service.enqueue(&mut database, &command).unwrap();
        assert!(second.duplicate);
        assert_eq!(first.outbound_id, second.outbound_id);

        let claimed = service
            .claim(&mut database, PROVIDER, APP, "worker-1", 10)
            .unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].attempts, 1);
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "worker-2", 10)
                .unwrap()
                .is_empty()
        );

        assert!(
            !service
                .settle(
                    &mut database,
                    &ChatOutboundSettleCommand {
                        outbound_id: first.outbound_id.clone(),
                        worker_id: "worker-2".into(),
                        lease_token: claimed[0].lease_token.clone(),
                        status: OUTBOUND_SENT.into(),
                        external_message_id: Some("wrong".into()),
                        failure_code: None
                    }
                )
                .unwrap()
        );
        database
            .connection()
            .execute(
                "UPDATE channel_chat_outbound SET lease_expires_at=0 WHERE id=?1",
                [&first.outbound_id],
            )
            .unwrap();
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "new-worker", 10)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM channel_chat_outbound WHERE id=?1",
                    [&first.outbound_id],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "unknown"
        );
        service
            .settle(
                &mut database,
                &ChatOutboundSettleCommand {
                    outbound_id: first.outbound_id,
                    worker_id: "worker-1".into(),
                    lease_token: claimed[0].lease_token.clone(),
                    status: OUTBOUND_SENT.to_string(),
                    external_message_id: Some("om_sent".to_string()),
                    failure_code: None,
                },
            )
            .unwrap();
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "worker-3", 10)
                .unwrap()
                .is_empty()
        );
    }

    // Independent security boundary: authenticated Run/input capabilities and the
    // atomic ask/outbox transaction are not owned by the Host transcript tests.
    #[test]
    fn runtime_tools_bind_inputs_and_fence_atomic_communication() {
        use crate::channel_chat_tools::{
            QueryClaim, QueryContact, QuerySettle, claim, execute, settle,
        };
        use crate::team_tool::AuthenticatedTeamToolRun;
        use serde_json::json;
        let mut database = seeded_runtime_database_owned();
        let root = materials_root();
        enable_chat(&mut database, &root);
        let service = ChannelChatService;
        let mut inbound = ChatInboundCommand {
            provider: PROVIDER.into(),
            app_id: APP.into(),
            external_message_id: "om_runtime".into(),
            chat_id: "oc_runtime".into(),
            conversation_kind: "p2p".into(),
            chat_name: None,
            author_external_id: "ou_requester".into(),
            author_name: "Requester".into(),
            author_is_owner: false,
            body: "Ask the contact for a progress report and forward: Initial synthetic delegation"
                .into(),
            quote_message_id: None,
            mentions: vec![ChatMention {
                open_id: "ou_mention".into(),
                name: "Mention".into(),
            }],
        };
        service.inbound(&mut database, &inbound).unwrap();
        let submit = |inbound: &ChatInboundCommand| ChatTurnSubmitCommand {
            external_message_id: inbound.external_message_id.clone(),
            provider: inbound.provider.clone(),
            app_id: inbound.app_id.clone(),
            chat_id: inbound.chat_id.clone(),
            conversation_kind: inbound.conversation_kind.clone(),
            chat_name: None,
            author_name: "untrusted".into(),
            body: "untrusted".into(),
        };
        let submitted = service
            .submit_turn(&mut database, &submit(&inbound))
            .unwrap();
        let run_ids =
            crate::delivery_queue::claim_waiting_delivery_batches(&mut database, 10).unwrap();
        assert_eq!(run_ids.len(), 1);
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='running',execution_epoch=1 WHERE id=?1",
                [&run_ids[0]],
            )
            .unwrap();
        let runtime = crate::runtime::ExecutionRuntimeService::default();
        let execution = runtime
            .load_agent_run_execution(&database, &run_ids[0], 1)
            .unwrap()
            .unwrap();
        let bind = runtime
            .bind_native_session(
                &mut database,
                &crate::command::CommandEnvelope {
                    command_id: "chat-bind-test".into(),
                    actor: crate::command::ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".into(),
                    },
                    camp_id: Some(submitted.camp_id.clone()),
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: crate::runtime::BindNativeSessionCommand {
                        conversation_id: execution.conversation_id.clone(),
                        agent_run_id: run_ids[0].clone(),
                        expected_conversation_version: execution.conversation_version,
                        expected_execution_epoch: 1,
                        previous_adapter_installation_id: None,
                        previous_native_session_id: None,
                        previous_binding_compatibility_digest: None,
                        proposed_binding_id: None,
                        adapter_installation_id: execution.runtime.installation_id.clone(),
                        native_session_id: "chat-native-fixture".into(),
                        binding_compatibility_digest: execution
                            .runtime
                            .binding_compatibility_digest,
                    },
                },
            )
            .unwrap();
        assert_eq!(
            bind.result.status,
            crate::command::CommandResultStatus::Applied
        );
        let team = crate::team_tool::TeamToolService::default();
        let credential = team
            .issue_binding_credential(&mut database, &run_ids[0], 1)
            .unwrap();
        assert!(
            team.authenticate_attested_binding(
                &database,
                &credential.native_binding_id,
                "wrong-credential",
                "chat-auth",
                &run_ids[0],
                1
            )
            .is_err()
        );
        let run = team
            .authenticate_attested_binding(
                &database,
                &credential.native_binding_id,
                &credential.binding_credential,
                "chat-auth",
                &run_ids[0],
                1,
            )
            .unwrap();
        let status = execute(&mut database, &run, "status", "feishu.status", &json!({})).unwrap();
        assert_eq!(status["status"], "ready", "{status}");
        assert_eq!(status["inputs"][0]["authorName"], "Requester");
        assert_eq!(status["contacts"][0]["name"], "Mention");
        let input_ref = status["inputs"][0]["inputRef"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            execute(
                &mut database,
                &run,
                "bad-target",
                "feishu.forward",
                &json!({"targetRef":"ou_arbitrary","text":"no"})
            )
            .unwrap()["errorCode"],
            "target_not_authorized"
        );
        let queued = execute(
            &mut database,
            &run,
            "search",
            "feishu.search",
            &json!({"query":"Contact"}),
        )
        .unwrap();
        assert_eq!(queued["status"], "queued");
        assert_eq!(
            execute(
                &mut database,
                &run,
                "search",
                "feishu.search",
                &json!({"query":"Contact"})
            )
            .unwrap(),
            queued
        );
        assert_eq!(
            execute(
                &mut database,
                &run,
                "search",
                "feishu.search",
                &json!({"query":"Other"})
            )
            .unwrap()["errorCode"],
            "request_conflict"
        );
        let claimed = claim(
            &mut database,
            &QueryClaim {
                provider: PROVIDER.into(),
                app_id: APP.into(),
                worker_id: "host".into(),
                limit: 10,
            },
        )
        .unwrap();
        assert_eq!(claimed.len(), 1);
        let mut receipt = QuerySettle {
            provider: PROVIDER.into(),
            app_id: APP.into(),
            worker_id: "wrong".into(),
            request_id: claimed[0]["requestId"].as_str().unwrap().into(),
            lease_token: claimed[0]["leaseToken"].as_str().unwrap().into(),
            contacts: vec![QueryContact {
                open_id: "ou_target".into(),
                name: "Contact".into(),
                department: None,
            }],
            error_code: None,
        };
        assert_eq!(settle(&mut database, &receipt).unwrap()["settled"], false);
        receipt.worker_id = "host".into();
        assert_eq!(settle(&mut database, &receipt).unwrap()["settled"], true);
        let result = execute(
            &mut database,
            &run,
            "poll",
            "feishu.result",
            &json!({"requestId":"search"}),
        )
        .unwrap();
        assert_eq!(result["status"], "ready");
        assert!(!result.to_string().contains("ou_target"));
        let target = result["contacts"][0]["targetRef"].as_str().unwrap();
        database.connection().execute_batch("CREATE TRIGGER reject_test_outbound BEFORE INSERT ON channel_chat_outbound BEGIN SELECT RAISE(ABORT,'test atomic rollback'); END;").unwrap();
        assert!(
            execute(
                &mut database,
                &run,
                "atomic",
                "feishu.ask",
                &json!({"targetRef":target,"question":"Rollback?"})
            )
            .is_err()
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM channel_chat_item", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_test_outbound;")
            .unwrap();
        let ask = execute(
            &mut database,
            &run,
            "ask",
            "feishu.ask",
            &json!({"targetRef":target,"question":"Progress?"}),
        )
        .unwrap();
        assert_eq!(ask["status"], "queued");
        let item = ask["items"][0]["itemId"].as_str().unwrap().to_string();
        assert_eq!(
            execute(
                &mut database,
                &run,
                "ask",
                "feishu.ask",
                &json!({"targetRef":target,"question":"Progress?"})
            )
            .unwrap(),
            ask
        );
        assert_eq!(
            execute(
                &mut database,
                &run,
                "ask-new-cli-id",
                "feishu.ask",
                &json!({"targetRef":target,"question":"Progress?","inputRef":input_ref})
            )
            .unwrap(),
            ask
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM channel_chat_item", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        // Ordinary successful completion must not discard an already authorized send.
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='succeeded',ended_at=datetime('now') WHERE id=?1",
                [&run.agent_run_id],
            )
            .unwrap();
        let outbound = service
            .claim(&mut database, PROVIDER, APP, "sender", 10)
            .unwrap();
        assert_eq!(outbound.len(), 1);
        assert_eq!(outbound[0].target_kind, "open_id");
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='running',ended_at=NULL WHERE id=?1",
                [&run.agent_run_id],
            )
            .unwrap();
        service
            .settle(
                &mut database,
                &ChatOutboundSettleCommand {
                    outbound_id: outbound[0].id.clone(),
                    worker_id: "sender".into(),
                    lease_token: outbound[0].lease_token.clone(),
                    status: "sent".into(),
                    external_message_id: Some("om_question".into()),
                    failure_code: None,
                },
            )
            .unwrap();
        assert_eq!(
            execute(
                &mut database,
                &run,
                "poll2",
                "feishu.result",
                &json!({"requestId":"ask"})
            )
            .unwrap()["status"],
            "sent"
        );
        assert_eq!(
            execute(
                &mut database,
                &run,
                "forged-report",
                "feishu.report",
                &json!({"itemId":item,"text":"forged"})
            )
            .unwrap()["errorCode"],
            "item_not_authorized"
        );
        let mut wrong = run.clone();
        wrong.agent_id = "agent_2".into();
        assert_eq!(
            execute(&mut database, &wrong, "status", "feishu.status", &json!({})).unwrap()["errorCode"],
            "scope_unavailable"
        );
        wrong = run.clone();
        wrong.execution_epoch = 0;
        assert_eq!(
            execute(&mut database, &wrong, "status", "feishu.status", &json!({})).unwrap()["errorCode"],
            "scope_unavailable"
        );
        inbound.external_message_id = "om_reply".into();
        inbound.chat_id = "oc_target".into();
        inbound.author_external_id = "ou_target".into();
        inbound.author_name = "Contact".into();
        inbound.body = "Half done".into();
        inbound.quote_message_id = Some("om_question".into());
        service.inbound(&mut database, &inbound).unwrap();
        let submitted_reply = service
            .submit_turn(&mut database, &submit(&inbound))
            .unwrap();
        let next =
            crate::delivery_queue::claim_waiting_delivery_batches(&mut database, 10).unwrap();
        assert_eq!(next.len(), 1);
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='running',execution_epoch=1 WHERE id=?1",
                [&next[0]],
            )
            .unwrap();
        let reply_run = AuthenticatedTeamToolRun {
            camp_id: submitted_reply.camp_id,
            agent_id: "agent_1".into(),
            agent_run_id: next[0].clone(),
            execution_epoch: 1,
        };
        assert_eq!(
            execute(
                &mut database,
                &reply_run,
                "cross-request",
                "feishu.result",
                &json!({"requestId":"search"})
            )
            .unwrap()["errorCode"],
            "request_not_found"
        );
        assert_eq!(
            execute(
                &mut database,
                &reply_run,
                "cross-input",
                "feishu.items",
                &json!({"inputRef":input_ref})
            )
            .unwrap()["errorCode"],
            "input_not_found"
        );
        assert_eq!(
            execute(
                &mut database,
                &reply_run,
                "cross-grant",
                "feishu.ask",
                &json!({"targetRef":target,"question":"no"})
            )
            .unwrap()["errorCode"],
            "target_not_authorized"
        );
        // Quotation wins even with several waiting items; absent quotation cannot guess.
        let other = execute(
            &mut database,
            &run,
            "ask-other",
            "feishu.ask",
            &json!({"targetRef":target,"question":"Another question?"}),
        )
        .unwrap();
        assert_eq!(other["status"], "queued");
        database.connection().execute("UPDATE channel_chat_message SET quote_message_id=NULL WHERE external_message_id='om_reply'",[]).unwrap();
        assert_eq!(
            execute(
                &mut database,
                &reply_run,
                "ambiguous",
                "feishu.report",
                &json!({"itemId":item,"text":"No guess"})
            )
            .unwrap()["errorCode"],
            "item_ambiguous"
        );
        database.connection().execute("UPDATE channel_chat_message SET quote_message_id='om_question' WHERE external_message_id='om_reply'",[]).unwrap();
        database.connection().execute("UPDATE channel_chat_outbound SET status='failed' WHERE source_run_id=?1 AND status='pending'",[&run.agent_run_id]).unwrap();
        let report = execute(
            &mut database,
            &reply_run,
            "report",
            "feishu.report",
            &json!({"itemId":item,"text":"Half done"}),
        )
        .unwrap();
        assert_eq!(report["status"], "queued");
        let rows = service
            .claim(&mut database, PROVIDER, APP, "reporter", 10)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].chat_id, "oc_runtime");
        assert_eq!(rows[0].target_kind, "chat_id");
        database
            .connection()
            .execute(
                "UPDATE channel_chat_item SET status='closed' WHERE id=?1",
                [&item],
            )
            .unwrap();
        assert_eq!(
            execute(
                &mut database,
                &reply_run,
                "late-report",
                "feishu.report",
                &json!({"itemId":item,"text":"Late"})
            )
            .unwrap()["errorCode"],
            "item_closed"
        );
        // FRR-10 characterizes the current authorization boundary, not a safe outcome:
        // an accepted local Steer must not be mistaken for the initial delegation.
        use crate::context::{
            CharterDeliveryMode, ContextMaterialization, ContextService, MaterializeContextRequest,
        };
        let before = execute(
            &mut database,
            &run,
            "frr10-before",
            "feishu.forward",
            &json!({"targetRef":target,"inputRef":input_ref,"text":"Initial synthetic delegation"}),
        )
        .unwrap();
        assert_eq!(before["status"], "queued");
        assert_eq!(
            execute(
                &mut database,
                &run,
                "frr10-before",
                "feishu.forward",
                &json!({"targetRef":target,"inputRef":input_ref,"text":"Different body"})
            )
            .unwrap()["errorCode"],
            "request_conflict"
        );
        let unknown = execute(
            &mut database,
            &run,
            "frr04-unknown",
            "feishu.forward",
            &json!({"targetRef":target,"inputRef":input_ref,"text":"Synthetic unknown outcome"}),
        )
        .unwrap();
        assert_eq!(unknown["status"], "queued");
        let claimed_unknown = service
            .claim(&mut database, PROVIDER, APP, "frr04-unknown-host", 10)
            .unwrap();
        let claimed_unknown = claimed_unknown
            .iter()
            .find(|o| o.text == "Synthetic unknown outcome")
            .unwrap();
        service
            .settle(
                &mut database,
                &ChatOutboundSettleCommand {
                    outbound_id: claimed_unknown.id.clone(),
                    worker_id: "frr04-unknown-host".into(),
                    lease_token: claimed_unknown.lease_token.clone(),
                    status: "unknown".into(),
                    external_message_id: None,
                    failure_code: None,
                },
            )
            .unwrap();
        let replay_unknown = execute(
            &mut database,
            &run,
            "frr04-unknown",
            "feishu.forward",
            &json!({"targetRef":target,"inputRef":input_ref,"text":"Synthetic unknown outcome"}),
        )
        .unwrap();
        assert_eq!(replay_unknown["status"], "unknown");
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "frr04-unknown-again", 10)
                .unwrap()
                .iter()
                .all(|o| o.id != claimed_unknown.id)
        );
        assert_eq!(database.connection().query_row("SELECT count(*) FROM channel_chat_outbound WHERE body='Synthetic unknown outcome'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        database
            .connection()
            .execute(
                "UPDATE agent_run SET runtime_reported_version='0.162.1' WHERE id=?1",
                [&run.agent_run_id],
            )
            .unwrap();
        let blobs = crate::managed_blob::ManagedBlobStore::new(database.directory());
        let request = MaterializeContextRequest {
            agent_run_id: &run.agent_run_id,
            execution_epoch: 1,
            charter_delivery_mode: CharterDeliveryMode::NativeAppend,
            max_payload_bytes: 256 * 1024,
        };
        let ContextMaterialization::Ready(initial_context) = ContextService
            .materialize(&mut database, &blobs, &request)
            .unwrap()
        else {
            panic!("FRR-10 initial context must be ready")
        };
        let chat_projection = |payload: &str| -> serde_json::Value {
            serde_json::from_str(
                payload
                    .split("[CHAT_REPLY_CONTEXT]\n")
                    .nth(1)
                    .unwrap()
                    .split("\n[/CHAT_REPLY_CONTEXT]")
                    .next()
                    .unwrap(),
            )
            .unwrap()
        };
        let initial_route = chat_projection(&initial_context.rendered_payload);
        assert_eq!(initial_route["schemaVersion"], 1);
        assert_eq!(initial_route["inputMode"], "initial");
        assert_eq!(initial_route["inputs"][0]["origin"], "channel_chat");
        assert_eq!(
            initial_route["inputs"][0]["sender"],
            json!({"kind":"external_person","displayName":"Requester","isOwner":false})
        );
        assert_eq!(initial_route["inputs"][0]["channel"]["inputRef"], input_ref);
        assert_eq!(
            initial_route["finalResponse"],
            json!({"mode":"host_auto_reply","audienceInputRefs":[input_ref],"includesLocalInput":false,"deliveryReceipt":"not_observed"})
        );
        assert_eq!(
            initial_route["guidance"].as_str().unwrap().lines().count(),
            6
        );
        let source: String = database
            .connection()
            .query_row(
                "SELECT current_input_source_json FROM context_manifest WHERE id=?1",
                [&initial_context.manifest_id],
                |r| r.get(0),
            )
            .unwrap();
        let source: serde_json::Value = serde_json::from_str(&source).unwrap();
        assert_eq!(source["chatReplyContext"]["projection"], initial_route);
        assert_eq!(
            source["chatReplyContext"]["projectionDigest"],
            crate::command::canonical_json_digest(&initial_route).unwrap()
        );
        let claim: String = database
            .connection()
            .query_row(
                "SELECT context_json FROM agent_run_claim_context WHERE agent_run_id=?1",
                [&run.agent_run_id],
                |r| r.get(0),
            )
            .unwrap();
        let frozen_claim: crate::context::ClaimedBatchContext =
            serde_json::from_str(&claim).unwrap();
        let claim: serde_json::Value = serde_json::from_str(&claim).unwrap();
        assert!(frozen_claim.payload_len().unwrap() >= initial_context.runtime_payload.len());
        let without_chat = {
            let mut value = claim.clone();
            value["chatReplyContext"] = serde_json::Value::Null;
            serde_json::from_value::<crate::context::ClaimedBatchContext>(value).unwrap()
        };
        let section = format!(
            "[CHAT_REPLY_CONTEXT]\n{}\n[/CHAT_REPLY_CONTEXT]\n\n",
            serde_json::to_string(&initial_route).unwrap()
        );
        assert_eq!(
            frozen_claim.payload_len().unwrap() - without_chat.payload_len().unwrap(),
            section.len()
        );
        let long_name = "长显示名界".repeat(500);
        let mut long_claim = claim.clone();
        long_claim["chatReplyContext"]["inputs"][0]["sender"]["displayName"] = json!(long_name);
        let long_frozen: crate::context::ClaimedBatchContext =
            serde_json::from_value(long_claim).unwrap();
        assert_eq!(
            long_frozen.payload_len().unwrap() - frozen_claim.payload_len().unwrap(),
            long_name.len() - "Requester".len()
        );
        assert_eq!(claim["chatReplyContext"], initial_route);
        assert!(
            !claim
                .as_object()
                .unwrap()
                .contains_key("chat_reply_context")
        );
        assert!(
            initial_context
                .rendered_payload
                .find("[/CHAT_REPLY_CONTEXT]")
                .unwrap()
                < initial_context
                    .rendered_payload
                    .find("[RUN_INPUT]")
                    .unwrap()
        );
        let version: (i64,i64,i64,i64) = database.connection().query_row("SELECT context_manifest_version,formatter_version,run_facts_schema_version,context_delivery_profile_version FROM context_manifest WHERE id=?1",[&initial_context.manifest_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(version, (43, 43, 11, 15));
        database.connection().execute("UPDATE channel_chat_message SET author_name='Changed after freeze',author_is_owner=1 WHERE id=?1", [&input_ref]).unwrap();
        let ContextMaterialization::Ready(replayed) = ContextService
            .materialize(&mut database, &blobs, &request)
            .unwrap()
        else {
            panic!("frozen replay required")
        };
        assert_eq!(replayed.rendered_payload, initial_context.rendered_payload);
        let initial_delivery = ContextService
            .prepare_input_delivery_for_context(
                &mut database,
                &run.agent_run_id,
                1,
                &initial_context,
            )
            .unwrap();
        ContextService
            .acknowledge_input_delivery(&mut database, &initial_delivery.id, "frr10-native-turn")
            .unwrap();
        assert!(
            crate::steer::active_input_availability(database.connection(), &run.agent_run_id, 1,)
                .unwrap()
                .ready
        );
        let local_id = "frr10-local-message";
        let local_body =
            "Local instruction only: forward LOCAL_ONLY_SYNTHETIC_MARKER using the old target";
        let source = {
            let tx = database.connection_mut().transaction().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE camp SET last_message_sequence=last_message_sequence+1,version=version+1,updated_at=?2 WHERE id=?1",
                params![run.camp_id, now],
            ).unwrap();
            tx.execute(
                r#"INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,
                    structured_content_json,content_digest,address_mode,addressed_agent_ids_json,
                    effective_recipient_ids_json,recipient_presentation_json,origin_kind,recall_state,
                    version,created_at,updated_at)
                 SELECT ?1,id,last_message_sequence,'user','local_user',?3,?4,?5,
                    'explicit','["agent_1"]','["agent_1"]','{}','local_composer','recallable',1,?6,?6
                 FROM camp WHERE id=?2"#,
                params![local_id, run.camp_id, local_body,
                    json!([{"kind":"text","text":local_body}]).to_string(),
                    "sha256:frr10-local-fixture", now],
            ).unwrap();
            let delivery = crate::delivery_queue::enqueue_message_deliveries(
                &tx,
                &run.camp_id,
                local_id,
                &[run.agent_id.clone()],
                &now,
            )
            .unwrap()
            .pop()
            .unwrap();
            crate::steer::route_user_message(
                &tx,
                local_id,
                Some(&[crate::steer::ActiveInputTarget {
                    agent_run_id: run.agent_run_id.clone(),
                    execution_epoch: 1,
                }]),
            )
            .unwrap();
            tx.commit().unwrap();
            delivery.delivery_id
        };
        let pending = crate::steer::pending_inputs(database.connection()).unwrap();
        assert!(
            pending
                .iter()
                .any(|p| p.delivery_id == source && p.agent_run_id == run.agent_run_id)
        );
        let ContextMaterialization::Ready(local_context) = ContextService
            .materialize_message_delivery(&mut database, &blobs, &source, &[], &request)
            .unwrap()
        else {
            panic!("FRR-10 local Steer must be ready")
        };
        let projected: serde_json::Value = serde_json::from_str(
            local_context
                .rendered_payload
                .split("[RUN_INPUT]\n")
                .nth(1)
                .unwrap()
                .split("\n[/RUN_INPUT]")
                .next()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(projected["messages"].as_array().unwrap().len(), 1);
        assert!(projected.to_string().contains(local_body));
        let local_route = chat_projection(&local_context.rendered_payload);
        assert_eq!(local_route["inputMode"], "steer");
        assert_eq!(
            local_route["inputs"],
            json!([{
                "messageId":local_id,"origin":"local_composer",
                "sender":{"kind":"local_user","displayName":null,"isOwner":null},
                "channel":null,"reply":{"mode":"thread_only","target":"current_thread"}
            }])
        );
        assert_eq!(
            local_route["finalResponse"],
            json!({"mode":"host_auto_reply_with_local_input","audienceInputRefs":[input_ref],"includesLocalInput":true,"deliveryReceipt":"not_observed"})
        );
        let source: String = database
            .connection()
            .query_row(
                "SELECT current_input_source_json FROM context_manifest WHERE id=?1",
                [&local_context.manifest_id],
                |r| r.get(0),
            )
            .unwrap();
        let source: serde_json::Value = serde_json::from_str(&source).unwrap();
        assert_eq!(
            source["chatReplyContext"]["sourceCampMessageIds"],
            json!([local_id])
        );
        assert_eq!(source["chatReplyContext"]["sourceInboundIds"], json!([]));
        assert_eq!(source["chatReplyContext"]["projection"], local_route);
        let local_delivery = ContextService
            .prepare_input_delivery_for_context(&mut database, &run.agent_run_id, 1, &local_context)
            .unwrap();
        ContextService
            .mark_input_delivery_not_accepted(
                &mut database,
                &local_delivery.id,
                "synthetic FRR-11 rejection",
            )
            .unwrap();
        assert_eq!(
            ContextService
                .runtime_input_delivery_status(&database, &local_delivery.id)
                .unwrap()
                .as_deref(),
            Some("not_accepted")
        );
        assert_eq!(
            execute(
                &mut database,
                &run,
                "frr11-result",
                "feishu.result",
                &json!({"requestId":"search"})
            )
            .unwrap()["status"],
            "ready"
        );
        assert_eq!(execute(&mut database,&run,"frr10-before","feishu.forward",&json!({"targetRef":target,"inputRef":input_ref,"text":"Initial synthetic delegation"})).unwrap(),before);
        let retried = ContextService
            .prepare_input_delivery_for_context(&mut database, &run.agent_run_id, 1, &local_context)
            .unwrap();
        assert_eq!(retried.id, local_delivery.id);
        assert_eq!(retried.status, "prepared");
        assert!(
            ContextService
                .begin_runtime_input_dispatch(
                    &mut database,
                    &local_delivery.id,
                    &run.agent_run_id,
                    1,
                )
                .unwrap()
        );
        ContextService
            .acknowledge_active_input_delivery(
                &mut database,
                &local_delivery.id,
                "frr10-local-input",
            )
            .unwrap();
        let provenance: (String, String, i64, i64) = database
            .connection()
            .query_row(
                "SELECT m.origin_kind,r.status,
                (SELECT count(*) FROM channel_chat_input WHERE camp_message_id=m.id),
                (SELECT count(*) FROM agent_run_input WHERE agent_run_id=?2 AND message_id=m.id)
             FROM camp_message m JOIN camp_message_delivery d ON d.message_id=m.id
             JOIN context_manifest cm ON cm.source_delivery_id=d.id
             JOIN runtime_input_delivery r ON r.context_manifest_id=cm.id
             WHERE m.id=?1 AND r.agent_run_id=?2 AND r.input_kind='steer'",
                params![local_id, run.agent_run_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            provenance,
            ("local_composer".into(), "accepted".into(), 0, 0)
        );
        let after = execute(
            &mut database,
            &run,
            "frr10-after",
            "feishu.forward",
            &json!({"targetRef":target,"inputRef":input_ref,"text":"LOCAL_ONLY_SYNTHETIC_MARKER"}),
        )
        .unwrap();
        assert_eq!(
            after["status"], "queued",
            "FRR-10 risk characterization changed: {after}"
        );
        let recorded: (String, String, String, String) = database
            .connection()
            .query_row(
                "SELECT q.input_id,o.body,o.target_kind,o.status FROM channel_chat_tool_request q
             JOIN channel_chat_outbound o ON o.id=q.outbound_id
             WHERE q.agent_run_id=?1 AND q.request_id='frr10-after'",
                [&run.agent_run_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            recorded,
            (
                input_ref.clone(),
                "LOCAL_ONLY_SYNTHETIC_MARKER".into(),
                "open_id".into(),
                "pending".into()
            )
        );
        let eligible = service
            .claim(&mut database, PROVIDER, APP, "frr10-synthetic-host", 10)
            .unwrap();
        assert_eq!(
            eligible
                .iter()
                .filter(|o| o.text == "LOCAL_ONLY_SYNTHETIC_MARKER")
                .count(),
            1
        );
        assert_eq!(
            execute(
                &mut database,
                &run,
                "frr10-result",
                "feishu.result",
                &json!({"requestId":"search"})
            )
            .unwrap()["status"],
            "ready"
        );
        for wrong in [
            AuthenticatedTeamToolRun {
                execution_epoch: 0,
                ..run.clone()
            },
            AuthenticatedTeamToolRun {
                agent_id: "agent_2".into(),
                ..run.clone()
            },
        ] {
            assert_eq!(
                execute(
                    &mut database,
                    &wrong,
                    "frr10-cross-scope",
                    "feishu.forward",
                    &json!({"targetRef":target,"text":"must not queue"})
                )
                .unwrap()["errorCode"],
                "scope_unavailable"
            );
        }
        println!(
            "FRR-10: before=queued; steer_origin=local_composer; steer_receipt=accepted; local_channel_bindings=0; local_initial_inputs=0; after=queued; request_attributed_to=initial_inbound; synthetic_host_claim=1; real_network_calls=0; model_behavior=not_run; acceptance=BLOCKED"
        );
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET chat_bot_enabled=0 WHERE id='agent_1'",
                [],
            )
            .unwrap();
        assert_eq!(
            execute(
                &mut database,
                &reply_run,
                "disabled",
                "feishu.items",
                &json!({})
            )
            .unwrap()["errorCode"],
            "scope_unavailable"
        );
        drop(database);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn migration_221_adds_member_chat_state() {
        let mut database = seeded_runtime_database_owned();
        assert!(crate::channel_chat_tools::schema_matches(database.connection()).unwrap());
        assert!(matches!(
            crate::db::classify_database_contract(database.connection()).unwrap(),
            crate::db::DatabaseContractClassification::Current(_)
        ));
        // A receipt without its exact layout is not a migratable old database.
        database.connection().execute("ALTER TABLE channel_chat_target_grant RENAME COLUMN department TO broken_department",[]).unwrap();
        assert!(matches!(
            crate::db::classify_database_contract(database.connection()).unwrap(),
            crate::db::DatabaseContractClassification::Unknown(_)
        ));
        database.connection().execute("ALTER TABLE channel_chat_target_grant RENAME COLUMN broken_department TO department",[]).unwrap();
        database.connection().execute_batch("DELETE FROM schema_migration WHERE version=227; UPDATE rovai_data_contract SET projection_schema_version=176 WHERE singleton=1;").unwrap();
        database.connection().execute_batch("DROP TABLE channel_chat_target_grant; DROP TABLE channel_chat_tool_request; DROP TABLE channel_chat_input; ALTER TABLE channel_chat_message DROP COLUMN mentions_json; ALTER TABLE channel_chat_outbound DROP COLUMN target_kind; ALTER TABLE channel_chat_outbound DROP COLUMN lease_token; ALTER TABLE channel_chat_outbound DROP COLUMN item_id; ALTER TABLE channel_chat_outbound DROP COLUMN source_run_id; ALTER TABLE channel_chat_outbound DROP COLUMN source_execution_epoch; DELETE FROM schema_migration WHERE version=225;").unwrap();
        assert!(matches!(
            crate::db::classify_database_contract(database.connection()).unwrap(),
            crate::db::DatabaseContractClassification::SupportedMigrationSource(_)
        ));
        crate::channel_chat_tools::migrate(&mut database).unwrap();
        // Only the chat-tool step is applied here, so the marker is an intermediate
        // migration source rather than the current projection.
        assert!(matches!(
            crate::db::classify_database_contract(database.connection()).unwrap(),
            crate::db::DatabaseContractClassification::SupportedMigrationSource(ref m)
                if m.projection_schema_version == 175
        ));
        crate::db::assert_chat_tool_upgrade_sources(&mut database);
        let columns: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('agent_profile')
                 WHERE name IN ('chat_bot_enabled', 'chat_materials_path')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 2);
        let conversation_columns: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('conversation')
                 WHERE name = 'permission_override_json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(conversation_columns, 1);
        let applied: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 224",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(applied, 1);
        let (enabled, path): (i64, Option<String>) = database
            .connection()
            .query_row(
                "SELECT chat_bot_enabled, chat_materials_path FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(enabled, 0);
        assert!(path.is_none());
    }
}
