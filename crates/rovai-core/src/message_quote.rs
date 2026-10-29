//! Immutable, owner-scoped excerpts. This module never resolves recipients or executable intent.
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

pub const MAX_QUOTE_SCALARS: usize = 12_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageQuoteSource {
    pub scope: String,
    pub camp_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum MessageQuoteAuthor {
    User {
        #[serde(rename = "displayName")]
        display_name: String,
    },
    Agent {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "displayName")]
        display_name: String,
    },
}

// Old snapshots may contain retired digests and locators. Only their saved text
// and optional presentation metadata are read; historical rows are not rewritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageQuoteSnapshot {
    pub version: u32,
    pub quote_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<MessageQuoteSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_at_capture: Option<MessageQuoteAuthor>,
    pub text: String,
    pub format: String,
    pub captured_at: String,
}

impl MessageQuoteSnapshot {
    pub fn model_projection(&self) -> Value {
        json!({"kind":"message_excerpt", "text":self.text})
    }
}

pub fn model_quotes(quotes: &[MessageQuoteSnapshot]) -> Vec<Value> {
    quotes
        .iter()
        .map(MessageQuoteSnapshot::model_projection)
        .collect()
}

pub fn model_quotes_schema() -> Value {
    json!({"type":"array", "items": {
        "type":"object", "additionalProperties":false,
        "required":["kind","text"], "properties": {
            "kind":{"const":"message_excerpt"},
            "text":{"type":"string","minLength":1,"maxLength":MAX_QUOTE_SCALARS}
        }
    }})
}

pub fn parse_quotes(value: &str) -> Result<Vec<MessageQuoteSnapshot>> {
    let quotes: Vec<MessageQuoteSnapshot> =
        serde_json::from_str(value).context("quote.invalid_snapshot")?;
    ensure!(
        quote_scalar_count(&quotes) <= MAX_QUOTE_SCALARS,
        "quote.limit_exceeded"
    );
    let mut ids = std::collections::HashSet::new();
    for quote in &quotes {
        ensure!(
            quote.version == 1
                && quote.format == "plain_text"
                && !quote.text.trim().is_empty()
                && ids.insert(&quote.quote_id),
            "quote.invalid_snapshot"
        );
    }
    Ok(quotes)
}

pub fn quote_scalar_count(quotes: &[MessageQuoteSnapshot]) -> usize {
    quotes.iter().map(|quote| quote.text.chars().count()).sum()
}

/// SQL identifiers are closed internal variants; caller-controlled IDs are always bound parameters.
#[derive(Debug, Clone, Copy)]
pub enum QuoteStorage<'a> {
    ClientCampDraft(&'a crate::draft_client::DraftClient),
    CampDraft,
    CampPending,
    CampEdit,
    CampMessage,
    PrivateDraft,
    ClientPrivateDraft(&'a crate::draft_client::DraftClient),
    PrivatePending,
    PrivateEdit,
    PrivateMessage,
}
impl QuoteStorage<'_> {
    fn client_filter(self) -> String {
        match self {
            Self::CampDraft | Self::PrivateDraft => " AND client_id = 'desktop'".to_owned(),
            Self::ClientCampDraft(client) | Self::ClientPrivateDraft(client) => {
                format!(" AND client_id = '{}'", client.sql_key())
            }
            _ => String::new(),
        }
    }
    fn table(self) -> &'static str {
        match self {
            Self::CampDraft | Self::ClientCampDraft(_) => "camp_composer_draft",
            Self::CampPending => "pending_camp_input",
            Self::CampEdit => "pending_input_edit_session",
            Self::CampMessage => "camp_message",
            Self::PrivateDraft | Self::ClientPrivateDraft(_) => "single_chat_composer_draft",
            Self::PrivatePending => "single_chat_pending_input",
            Self::PrivateEdit => "single_chat_pending_input_edit_session",
            Self::PrivateMessage => "conversation_message",
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::CampDraft | Self::ClientCampDraft(_) | Self::CampEdit => "camp_id",
            Self::PrivateDraft | Self::ClientPrivateDraft(_) | Self::PrivateEdit => {
                "conversation_id"
            }
            _ => "id",
        }
    }
}

pub fn load_quotes(
    connection: &Connection,
    storage: QuoteStorage,
    id: &str,
) -> Result<Vec<MessageQuoteSnapshot>> {
    let value = connection
        .query_row(
            &format!(
                "SELECT quotes_json FROM {} WHERE {}=?1{}",
                storage.table(),
                storage.key(),
                storage.client_filter()
            ),
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    parse_quotes(value.as_deref().unwrap_or("[]"))
}

pub fn store_quotes(
    connection: &Connection,
    storage: QuoteStorage,
    id: &str,
    quotes: &[MessageQuoteSnapshot],
) -> Result<()> {
    let value = serde_json::to_string(quotes)?;
    parse_quotes(&value)?;
    let changed = connection.execute(
        &format!(
            "UPDATE {} SET quotes_json=?2 WHERE {}=?1{}",
            storage.table(),
            storage.key(),
            storage.client_filter()
        ),
        params![id, value],
    )?;
    ensure!(changed == 1, "quote.owner_unavailable");
    Ok(())
}

pub fn copy_quotes(
    connection: &Connection,
    from: QuoteStorage,
    from_id: &str,
    to: QuoteStorage,
    to_id: &str,
) -> Result<()> {
    store_quotes(
        connection,
        to,
        to_id,
        &load_quotes(connection, from, from_id)?,
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteSelection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    pub text: String,
}

pub fn capture_quote(
    transaction: &Transaction<'_>,
    camp_id: &str,
    conversation_id: Option<&str>,
    selection: &QuoteSelection,
) -> Result<MessageQuoteSnapshot> {
    ensure!(!selection.text.trim().is_empty(), "quote.invalid_selection");
    ensure!(
        selection.text.chars().count() <= MAX_QUOTE_SCALARS,
        "quote.limit_exceeded"
    );
    // Source lookup only supplies an optional display label. Missing/deleted or
    // changed messages never prevent the selected text from being saved.
    let author = if let Some(message_id) = &selection.message_id {
        let (sql, owner) = if let Some(conversation_id) = conversation_id {
            (
                "SELECT m.author_type, m.author_id, p.display_name FROM conversation_message m
              LEFT JOIN agent_profile p ON p.id=m.author_id WHERE m.id=?1 AND m.conversation_id=?2",
                conversation_id,
            )
        } else {
            (
                "SELECT m.author_type, m.author_id, p.display_name FROM camp_message m
              LEFT JOIN agent_profile p ON p.id=m.author_id WHERE m.id=?1 AND m.camp_id=?2",
                camp_id,
            )
        };
        transaction
            .query_row(sql, params![message_id, owner], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .optional()?
    } else {
        None
    };
    let author_at_capture = author.and_then(|(kind, id, name)| match kind.as_str() {
        "user" => Some(MessageQuoteAuthor::User {
            display_name: "用户".into(),
        }),
        "agent" => name.map(|display_name| MessageQuoteAuthor::Agent {
            agent_id: id,
            display_name,
        }),
        _ => None,
    });
    Ok(MessageQuoteSnapshot {
        version: 1,
        quote_id: Uuid::new_v4().to_string(),
        source: selection
            .message_id
            .as_ref()
            .map(|message_id| MessageQuoteSource {
                scope: if conversation_id.is_some() {
                    "single_chat"
                } else {
                    "camp"
                }
                .into(),
                camp_id: camp_id.into(),
                conversation_id: conversation_id.map(str::to_owned),
                message_id: message_id.clone(),
            }),
        author_at_capture,
        text: selection.text.clone(),
        format: "plain_text".into(),
        captured_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum QuoteAction {
    Add {
        selection: QuoteSelection,
    },
    Remove {
        #[serde(rename = "quoteId")]
        quote_id: String,
    },
    Restore {
        #[serde(rename = "quoteId")]
        quote_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemovedQuote {
    quote: MessageQuoteSnapshot,
    index: usize,
}

/// The caller owns its draft revision or Pending edit-token fence and the surrounding transaction.
pub fn mutate_quotes(
    transaction: &Transaction<'_>,
    storage: QuoteStorage,
    id: &str,
    camp_id: &str,
    conversation_id: Option<&str>,
    action: &QuoteAction,
) -> Result<()> {
    let mut quotes = load_quotes(transaction, storage, id)?;
    let trash_json: String = transaction.query_row(
        &format!(
            "SELECT quote_trash_json FROM {} WHERE {}=?1{}",
            storage.table(),
            storage.key(),
            storage.client_filter()
        ),
        [id],
        |row| row.get(0),
    )?;
    let mut trash: Vec<RemovedQuote> = serde_json::from_str(&trash_json)?;
    match action {
        QuoteAction::Add { selection } => quotes.push(capture_quote(
            transaction,
            camp_id,
            conversation_id,
            selection,
        )?),
        QuoteAction::Remove { quote_id } => {
            let index = quotes
                .iter()
                .position(|quote| quote.quote_id == *quote_id)
                .context("quote.not_found")?;
            trash.push(RemovedQuote {
                quote: quotes.remove(index),
                index,
            });
        }
        QuoteAction::Restore { quote_id } => {
            let position = trash
                .iter()
                .position(|item| item.quote.quote_id == *quote_id)
                .context("quote.undo_unavailable")?;
            let item = trash.remove(position);
            quotes.insert(item.index.min(quotes.len()), item.quote);
        }
    }
    ensure!(
        quote_scalar_count(&quotes) <= MAX_QUOTE_SCALARS,
        "quote.limit_exceeded"
    );
    store_quotes(transaction, storage, id, &quotes)?;
    transaction.execute(
        &format!(
            "UPDATE {} SET quote_trash_json=?2 WHERE {}=?1{}",
            storage.table(),
            storage.key(),
            storage.client_filter()
        ),
        params![id, serde_json::to_string(&trash)?],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutateQuoteDraftCommand {
    #[serde(
        default,
        skip_serializing_if = "crate::draft_client::DraftClient::is_desktop"
    )]
    pub draft_client: crate::draft_client::DraftClient,
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    #[serde(rename = "threadId", alias = "campId")]
    pub camp_id: String,
    pub conversation_id: Option<String>,
    pub expected_revision: i64,
    pub action: QuoteAction,
}
impl crate::command::sealed::Sealed for MutateQuoteDraftCommand {}
impl crate::command::DomainCommand for MutateQuoteDraftCommand {
    const TYPE: &'static str = "message_quote.draft.mutate";
}

pub fn mutate_draft(
    database: &mut crate::db::Database,
    envelope: &crate::command::CommandEnvelope<MutateQuoteDraftCommand>,
) -> Result<crate::command::CommandExecution> {
    use crate::command::{ActorRef, CommandHandlerResult, DomainCommandGateway};
    DomainCommandGateway.execute(database, envelope, |transaction| {
        let command = &envelope.payload;
        ensure!(matches!(envelope.actor, ActorRef::User { .. }) && envelope.camp_id.as_deref() == Some(&command.camp_id), "quote.local_user_required");
        let (storage, owner_id) = match command.conversation_id.as_deref() {
            Some(conversation_id) => {
                let valid: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM conversation WHERE id=?1 AND camp_id=?2 AND kind='single_chat' AND ended_at IS NULL)",
                    params![conversation_id, command.camp_id], |row| row.get(0))?;
                ensure!(valid, "quote.owner_unavailable");
                (QuoteStorage::ClientPrivateDraft(&command.draft_client), conversation_id)
            }
            None => {
                let valid: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM camp WHERE id=?1)", [&command.camp_id], |row| row.get(0))?;
                ensure!(valid, "quote.owner_unavailable");
                (QuoteStorage::ClientCampDraft(&command.draft_client), command.camp_id.as_str())
            }
        };
        let revision: i64 = transaction.query_row(&format!("SELECT revision FROM {} WHERE {}=?1{}", storage.table(), storage.key(), storage.client_filter()), [owner_id], |row| row.get(0)).optional()?.unwrap_or(0);
        if revision != command.expected_revision {
            return Ok(CommandHandlerResult::rejected("draft_changed", json!({"currentRevision":revision})));
        }
        let now = chrono::Utc::now();
        if matches!(storage, QuoteStorage::CampDraft | QuoteStorage::ClientCampDraft(_)) {
            transaction.execute("INSERT INTO camp_composer_draft(camp_id, body, structured_content_json, revision, created_at, updated_at, expires_at, client_id) VALUES(?1,'',?2,1,?3,?3,?4,?5) ON CONFLICT(camp_id, client_id) DO NOTHING",
                params![owner_id, crate::camp_content::EMPTY_COMPOSER_DOCUMENT_JSON, now.to_rfc3339(), (now + chrono::Duration::days(crate::camp_attachment::DRAFT_RETENTION_DAYS)).to_rfc3339(), command.draft_client.id()])?;
        } else {
            transaction.execute("INSERT OR IGNORE INTO single_chat_composer_draft(conversation_id, revision, source_attachments_json, updated_at, client_id) VALUES(?1,0,'[]',?2,?3)", params![owner_id, now.to_rfc3339(), command.draft_client.id()])?;
        }
        mutate_quotes(transaction, storage, owner_id, &command.camp_id, command.conversation_id.as_deref(), &command.action)?;
        transaction.execute(&format!("UPDATE {} SET revision=?3, updated_at=?2 WHERE {}=?1{}", storage.table(), storage.key(), storage.client_filter()), params![owner_id, now.to_rfc3339(), revision + 1])?;
        if matches!(storage, QuoteStorage::CampDraft | QuoteStorage::ClientCampDraft(_)) {
            transaction.execute("UPDATE camp_composer_draft SET expires_at=?2 WHERE camp_id=?1 AND client_id=?3", params![owner_id, (now + chrono::Duration::days(crate::camp_attachment::DRAFT_RETENTION_DAYS)).to_rfc3339(), command.draft_client.id()])?;
        }
        Ok(CommandHandlerResult::applied("quote.draft_updated", json!({"revision":revision+1}), None))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_keeps_selected_text_without_rechecking_source() {
        let directory = std::env::temp_dir().join(format!("rovai-quote-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("quotes.sqlite");
        let mut connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE camp_message(id TEXT PRIMARY KEY,camp_id TEXT,author_type TEXT,author_id TEXT,body TEXT,quotes_json TEXT);
          CREATE TABLE agent_profile(id TEXT,display_name TEXT);
          INSERT INTO agent_profile VALUES('agent_a','芝士');
          INSERT INTO camp_message VALUES('source','camp_a','agent','agent_a','new streaming text','[]');
          INSERT INTO camp_message VALUES('owner','camp_a','user','user','question','[]');").unwrap();
        let text = "已选文字\n第二行\t另一列\n  code();\n@agent[other] /campfire";
        let transaction = connection.transaction().unwrap();
        // A Web pending request may retain retired selection fields across an upgrade.
        let selected: QuoteSelection = serde_json::from_value(json!({
            "messageId": "source", "text": text,
            "bodyAtSelection": "old streaming text", "startScalar": 0, "endScalar": 3,
            "currentUserDisplayName": "旧名称"
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&selected).unwrap(),
            json!({
                "messageId": "source", "text": text
            })
        );
        let quote = capture_quote(&transaction, "camp_a", None, &selected).unwrap();
        assert_eq!(quote.text, text);
        assert!(matches!(
            quote.author_at_capture,
            Some(MessageQuoteAuthor::Agent { .. })
        ));
        transaction
            .execute("DELETE FROM camp_message WHERE id='source'", [])
            .unwrap();
        let missing = capture_quote(&transaction, "camp_a", None, &selected).unwrap();
        assert_eq!(missing.text, text);
        assert!(missing.author_at_capture.is_none());
        let plain = capture_quote(
            &transaction,
            "camp_a",
            None,
            &QuoteSelection {
                message_id: None,
                text: "无来源选文 🙂".into(),
            },
        )
        .unwrap();
        assert!(plain.source.is_none());
        let quotes = vec![quote, missing, plain];
        store_quotes(&transaction, QuoteStorage::CampMessage, "owner", &quotes).unwrap();
        transaction.commit().unwrap();
        drop(connection);
        let reopened = Connection::open(&path).unwrap();
        assert_eq!(
            load_quotes(&reopened, QuoteStorage::CampMessage, "owner").unwrap(),
            quotes
        );
        for quote in &quotes {
            assert_eq!(
                quote.model_projection(),
                json!({"kind":"message_excerpt","text":quote.text})
            );
        }
        // Historical snapshots keep their exact text, regardless of obsolete proofs.
        let mut old = serde_json::to_value(&quotes).unwrap();
        old[0]["sourceContentDigest"] = json!("obsolete");
        old[0]["snapshotDigest"] = json!("obsolete");
        old[0]["locator"] = json!({"projectionVersion":1,"startScalar":9,"endScalar":10,"projectionDigest":"obsolete"});
        assert_eq!(parse_quotes(&old.to_string()).unwrap(), quotes);
        let mut invalid = old.clone();
        invalid[0]["text"] = json!(" ");
        assert!(parse_quotes(&invalid.to_string()).is_err());
        invalid[0]["text"] = json!("字".repeat(MAX_QUOTE_SCALARS + 1));
        assert!(parse_quotes(&invalid.to_string()).is_err());
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
