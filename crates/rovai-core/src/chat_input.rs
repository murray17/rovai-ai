use super::*;
use crate::agent_profile::resolve_frozen_runtime;
use crate::camp_content::StructuredThreadMessageSegment;
use crate::collaboration::append_domain_event;
use crate::command::canonical_json_digest;
use crate::message_quote::{MessageQuoteSnapshot, QuoteStorage, parse_quotes, store_quotes};
use crate::single_chat::{PrivateRun, insert_private_run};
use anyhow::{Context, bail};
use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChatSkill {
    pub skill_id: String,
    pub name_at_send: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_offset: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SendInput {
    pub chat_id: Option<String>,
    pub draft_id: Option<String>,
    pub agent_id: Option<String>,
    pub body: String,
    #[serde(default)]
    pub quotes: Vec<MessageQuoteSnapshot>,
    #[serde(default)]
    pub skills: Vec<ChatSkill>,
    pub mode: InputMode,
    pub run_id: Option<String>,
    pub execution_epoch: Option<i64>,
}
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InputMode {
    Start,
    Steer,
}
impl sealed::Sealed for SendInput {}
impl DomainCommand for SendInput {
    const TYPE: &'static str = "chat.send";
    fn matches_replay(&self, stored: &Value) -> Result<bool> {
        Ok(stored["inputDigest"] == self.digest()?)
    }
}
impl SendInput {
    fn digest(&self) -> Result<String> {
        canonical_json_digest(&serde_json::to_value(self)?)
    }
}

fn changed(
    tx: &Transaction<'_>,
    chat: &str,
    event: &str,
    id: &str,
    actor: &ActorRef,
) -> Result<()> {
    append_domain_event(
        tx,
        event,
        None,
        Some(("chat", chat)),
        actor,
        None,
        &json!({"chatId":chat,"inputId":id}),
    )?;
    tx.execute("UPDATE chat_topic SET last_activity_global_sequence=(SELECT max(global_sequence) FROM event_log) WHERE conversation_id=?1",[chat])?;
    Ok(())
}

pub(crate) fn send(
    db: &mut Database,
    mut envelope: CommandEnvelope<SendInput>,
) -> Result<CommandExecution> {
    let ActorRef::User { user_id } = &envelope.actor else {
        bail!("chat.user_required")
    };
    ensure!(user_id == CURRENT_USER_ID, "chat.user_required");
    let input = &envelope.payload;
    ensure!(
        input.body.len() <= 1_048_576 && input.skills.len() <= 128,
        "chat.input_too_large"
    );
    ensure!(
        !input.body.trim().is_empty() || !input.quotes.is_empty(),
        "chat.empty_input"
    );
    parse_quotes(&serde_json::to_string(&input.quotes)?)?;
    for skill in &input.skills {
        ensure!(
            !skill.skill_id.is_empty()
                && skill.skill_id.len() <= 512
                && !skill.name_at_send.is_empty()
                && skill.name_at_send.len() <= 512,
            "chat.invalid_skill"
        );
    }
    match (&input.chat_id, &input.agent_id, &input.draft_id) {
        (None, Some(agent), Some(draft))
            if input.mode == InputMode::Start
                && !draft.is_empty()
                && draft.len() <= 512
                && !agent.is_empty() =>
        {
            envelope.command_id = format!(
                "chat-first:{}",
                canonical_json_digest(&json!([user_id, draft]))?
            );
        }
        (Some(id), None, None) if Uuid::parse_str(id).is_ok() => {}
        _ => bail!("chat.invalid_target"),
    }
    let digest = input.digest()?;
    DomainCommandGateway.execute(db, &envelope, |tx| {
        let now = Utc::now().to_rfc3339();
        let (chat_id, agent_id, title) = topic_for_send(tx, input, user_id, &now)?;
        let active = tx
            .query_row(
                "SELECT id, execution_epoch FROM agent_run WHERE conversation_id=?1
             AND invocation_kind='chat' AND status IN ('queued','running','waiting')",
                [&chat_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        if input.mode == InputMode::Steer {
            let (target, epoch) = active.as_ref().context("chat.execution_changed")?;
            ensure!(
                input.run_id.as_ref() == Some(target) && input.execution_epoch == Some(*epoch),
                "chat.execution_changed"
            );
            bail!("chat.steer_unavailable");
        }
        ensure!(
            input.run_id.is_none() && input.execution_epoch.is_none(),
            "chat.invalid_target"
        );
        let queued: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM single_chat_pending_input WHERE conversation_id=?1
             AND requested_mode='start' AND state IN ('queued','needs_repair'))",
            [&chat_id],
            |row| row.get(0),
        )?;
        let mut result =
            if active.is_some() || queued {
                let input_id = Uuid::new_v4().to_string();
                tx.execute(
                "INSERT INTO single_chat_pending_input(id, conversation_id, enqueue_sequence, body,
                    user_id, quotes_json, chat_skills_json, created_at, updated_at)
                 SELECT ?1,?2,COALESCE(MAX(enqueue_sequence),0)+1,?3,?4,?5,?6,?7,?7
                 FROM single_chat_pending_input WHERE conversation_id=?2",
                params![input_id,chat_id,input.body,user_id,serde_json::to_string(&input.quotes)?,
                    serde_json::to_string(&input.skills)?,now],
            )?;
                changed(
                    tx,
                    &chat_id,
                    "chat.input_queued",
                    &input_id,
                    &envelope.actor,
                )?;
                json!({"kind":"queued","chatId":chat_id,"inputId":input_id})
            } else {
                let (message, run) = start(
                    tx,
                    &chat_id,
                    &agent_id,
                    &input.body,
                    &input.quotes,
                    &input.skills,
                    &envelope.command_id,
                    &now,
                )?;
                changed(tx, &chat_id, "chat.message_sent", &message, &envelope.actor)?;
                json!({"kind":"started","chatId":chat_id,"messageId":message,"runId":run})
            };
        if let Some(title) = title {
            result["title"] = json!(title);
        }
        result["inputDigest"] = json!(digest);
        Ok(CommandHandlerResult::accepted(
            "chat.input_accepted",
            result,
            Some(EntityReference {
                entity_type: "chat".into(),
                entity_id: chat_id,
            }),
        ))
    })
}

fn topic_for_send(
    tx: &Transaction<'_>,
    input: &SendInput,
    user_id: &str,
    now: &str,
) -> Result<(String, String, Option<String>)> {
    if let Some(id) = &input.chat_id {
        let agent = tx
            .query_row(
                "SELECT c.agent_id FROM conversation c JOIN chat_topic t ON t.conversation_id=c.id
             WHERE c.id=?1 AND c.kind='chat' AND t.owner_user_id=?2
             AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL",
                params![id, user_id],
                |row| row.get(0),
            )
            .optional()?
            .context("chat.not_found")?;
        return Ok((id.clone(), agent, None));
    }
    let agent = input.agent_id.as_ref().context("chat.agent_required")?;
    let chat = Uuid::new_v4().to_string();
    let title: String = input
        .body
        .trim()
        .lines()
        .next()
        .filter(|line| !line.is_empty())
        .or_else(|| input.quotes.first().map(|quote| quote.text.trim()))
        .unwrap_or("")
        .chars()
        .take(20)
        .collect();
    ensure!(!title.is_empty(), "chat.empty_input");
    tx.execute(
        "INSERT INTO conversation(id,camp_id,agent_id,kind,version,created_at,updated_at)
        VALUES(?1,NULL,?2,'chat',1,?3,?3)",
        params![chat, agent, now],
    )?;
    tx.execute(
        "INSERT INTO chat_topic(conversation_id,owner_user_id,title) VALUES(?1,?2,?3)",
        params![chat, user_id, title],
    )?;
    Ok((chat, agent.clone(), Some(title)))
}

fn start(
    tx: &Transaction<'_>,
    chat: &str,
    agent: &str,
    body: &str,
    quotes: &[MessageQuoteSnapshot],
    skills: &[ChatSkill],
    command: &str,
    now: &str,
) -> Result<(String, String)> {
    let runtime = resolve_frozen_runtime(tx, chat, agent)?
        .map_err(|blocker| anyhow::anyhow!("chat.runtime_not_ready: {}", blocker.code))?;
    let sequence:i64=tx.query_row("UPDATE conversation SET last_message_sequence=last_message_sequence+1,version=version+1,updated_at=?2 WHERE id=?1 AND kind='chat' RETURNING last_message_sequence",params![chat,now],|r|r.get(0))?;
    let run = Uuid::new_v4().to_string();
    let message = Uuid::new_v4().to_string();
    insert_private_run(
        tx,
        PrivateRun {
            id: &run,
            turn_id: None,
            conversation_id: chat,
            agent_id: agent,
            trigger: &message,
            now,
            public_boundary: 0,
            sequence,
            command_id: command,
        },
        &runtime,
    )?;
    let mentions: Vec<_> = skills
        .iter()
        .map(|s| StructuredThreadMessageSegment::SkillMention {
            skill_id: s.skill_id.clone(),
            name_at_send: s.name_at_send.clone(),
        })
        .collect();
    let selection = crate::current_input_skill::freeze_skill_selection_with_messages(
        tx,
        &mentions,
        &vec![0; mentions.len()],
        runtime.adapter_kind,
    )?;
    tx.execute("UPDATE agent_run SET skill_selection_snapshot_json=?2,skill_selection_snapshot_digest=?3 WHERE id=?1",params![run,serde_json::to_string(&selection)?,selection.canonical_digest()?])?;
    tx.execute("INSERT INTO conversation_message(id,conversation_id,sequence,author_type,author_id,body,agent_run_id,chat_skills_json,created_at) VALUES(?1,?2,?3,'user',?4,?5,?6,?7,?8)",params![message,chat,sequence,CURRENT_USER_ID,body,run,serde_json::to_string(skills)?,now])?;
    store_quotes(tx, QuoteStorage::PrivateMessage, &message, quotes)?;
    Ok((message, run))
}

const READY_FIFO: &str = "SELECT p.id FROM single_chat_pending_input p
    JOIN chat_topic t ON t.conversation_id=p.conversation_id
    WHERE p.requested_mode='start' AND p.state='queued'
      AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM agent_run r WHERE r.conversation_id=t.conversation_id
                     AND r.status IN ('queued','running','waiting'))
      AND NOT EXISTS(SELECT 1 FROM single_chat_pending_input q WHERE q.conversation_id=t.conversation_id
                     AND q.requested_mode='start' AND q.state IN ('queued','needs_repair')
                     AND q.enqueue_sequence < p.enqueue_sequence)
      AND (?1 IS NULL OR p.id=?1)
    ORDER BY p.created_at,p.id";

pub(crate) fn publish_ready(db: &mut Database) -> Result<Vec<String>> {
    let ids = db
        .connection()
        .prepare_cached(READY_FIFO)?
        .query_map([None::<String>], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    let mut changes = Vec::new();
    for id in ids {
        let tx = db
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if !tx.prepare_cached(READY_FIFO)?.exists([&id])? {
            continue;
        }
        let (chat, agent, body, quotes, skills) = tx.query_row(
            "SELECT p.conversation_id,c.agent_id,p.body,p.quotes_json,p.chat_skills_json
             FROM single_chat_pending_input p JOIN conversation c ON p.conversation_id=c.id WHERE p.id=?1",
            [&id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?)))?;
        let now = Utc::now().to_rfc3339();
        match start(
            &tx,
            &chat,
            &agent,
            &body,
            &parse_quotes(&quotes)?,
            &serde_json::from_str::<Vec<ChatSkill>>(&skills)?,
            &id,
            &now,
        ) {
            Ok((message, run)) => {
                tx.execute("UPDATE single_chat_pending_input SET state='published',revision=revision+1,
                    published_conversation_message_id=?2,published_agent_run_id=?3,published_at=?4,updated_at=?4 WHERE id=?1",
                    params![id,message,run,now])?;
                tx.commit()?;
                changes.push(chat);
            }
            Err(error) => {
                tx.rollback()?;
                if error.to_string().starts_with("chat.runtime_not_ready:") {
                    continue;
                }
                eprintln!("Cannot publish queued chat input {id}: {error:#}");
                let changed = db.connection().execute("UPDATE single_chat_pending_input SET state='needs_repair',
                    last_attempt_error_code='chat.queue_publication_failed',revision=revision+1,updated_at=?2
                    WHERE id=?1 AND state='queued'", params![id,now])?;
                if changed == 1 {
                    changes.push(chat);
                }
            }
        }
    }
    Ok(changes)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditPending {
    pub chat_id: String,
    input_id: String,
    expected_revision: i64,
    operation: EditOperation,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum EditOperation {
    ReturnToComposer,
    Remove,
}
impl sealed::Sealed for EditPending {}
impl DomainCommand for EditPending {
    const TYPE: &'static str = "chat.pending_input_edit";
    fn matches_replay(&self, value: &Value) -> Result<bool> {
        Ok(value["inputDigest"] == canonical_json_digest(&serde_json::to_value(self)?)?)
    }
}
pub(crate) fn edit_pending(
    db: &mut Database,
    envelope: &CommandEnvelope<EditPending>,
) -> Result<CommandExecution> {
    let ActorRef::User { user_id } = &envelope.actor else {
        bail!("chat.user_required")
    };
    ensure!(user_id == CURRENT_USER_ID, "chat.user_required");
    let input = &envelope.payload;
    DomainCommandGateway.execute(db,envelope,|tx| {
        let (body,skills):(String,String)=tx.query_row("UPDATE single_chat_pending_input SET state='cancelled',revision=revision+1,updated_at=?4
               WHERE id=?1 AND conversation_id=?2 AND revision=?3 AND state IN ('queued','needs_repair') AND requested_mode='start'
               AND EXISTS (SELECT 1 FROM chat_topic t WHERE t.conversation_id=?2 AND owner_user_id=?5 AND archived_at IS NULL AND deletion_operation_id IS NULL)
               RETURNING body,chat_skills_json",params![input.input_id,input.chat_id,input.expected_revision,Utc::now().to_rfc3339(),user_id],
               |row| Ok((row.get(0)?,row.get(1)?))).optional()?.context("chat.input_changed")?;
        let mut result = json!({"inputDigest":canonical_json_digest(&serde_json::to_value(input)?)?});
        if matches!(input.operation, EditOperation::ReturnToComposer) {
            result["body"]=json!(body);
            result["skills"]=serde_json::from_str(&skills)?;
        }
        Ok(CommandHandlerResult::applied("chat.pending_input_removed",result,None))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submit(db: &mut Database, id: &str, input: Value) -> Result<Value> {
        let execution = send(
            db,
            CommandEnvelope {
                command_id: id.to_owned(),
                actor: ActorRef::User {
                    user_id: CURRENT_USER_ID.to_owned(),
                },
                camp_id: None,
                execution_epoch: None,
                expected_versions: Vec::new(),
                payload: serde_json::from_value(input)?,
            },
        )?;
        Ok(execution.result.payload)
    }

    #[test]
    fn first_send_replays_the_draft_and_fifo_preserves_message_skills_without_a_thread() {
        let mut db = crate::test_support::seeded_runtime_database_owned();
        let count = |db: &Database, table: &str| {
            db.connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap()
        };
        let public_counts = ["camp", "camp_member", "camp_turn"].map(|name| count(&db, name));
        let first =
            json!({"draftId":"shared","agentId":"agent_1","mode":"start","body":"讨论发布计划"});
        let result = submit(&mut db, "first", first.clone()).unwrap();
        assert_eq!(result["kind"], "started");
        assert_eq!(
            submit(&mut db, "another-window", first.clone()).unwrap(),
            result
        );
        let mut modified = first;
        modified["skills"] = json!([{"skillId":"rovai:review-duo","nameAtSend":"review-duo"}]);
        assert!(submit(&mut db, "changed", modified).is_err());
        let chat = result["chatId"].as_str().unwrap();
        let queue = json!({"chatId":chat,"mode":"start","body":"用 $review-duo 评审","skills":[{"skillId":"rovai:review-duo","nameAtSend":"review-duo"}]});
        let accepted = submit(&mut db, "queue", queue.clone()).unwrap();
        assert_eq!(accepted["kind"], "queued");
        assert_eq!(submit(&mut db, "queue", queue).unwrap(), accepted);
        assert!(publish_ready(&mut db).unwrap().is_empty());
        assert_eq!(count(&db, "chat_topic"), 1);
        assert_eq!(count(&db, "conversation_message"), 1);
        assert_eq!(count(&db, "agent_run"), 1);
        db.connection()
            .execute(
                "UPDATE agent_run SET status='cancelled',ended_at=created_at WHERE id=?1",
                [result["runId"].as_str().unwrap()],
            )
            .unwrap();
        db.connection()
            .execute(
                "UPDATE chat_topic SET archived_at='now' WHERE conversation_id=?1",
                [chat],
            )
            .unwrap();
        assert!(publish_ready(&mut db).unwrap().is_empty());
        db.connection()
            .execute(
                "UPDATE chat_topic SET archived_at=NULL WHERE conversation_id=?1",
                [chat],
            )
            .unwrap();
        assert_eq!(publish_ready(&mut db).unwrap(), [chat]);
        assert!(publish_ready(&mut db).unwrap().is_empty());
        let frozen:String=db.connection().query_row("SELECT chat_skills_json FROM conversation_message WHERE conversation_id=?1 AND sequence=2",[chat],|r|r.get(0)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&frozen).unwrap()[0]["skillId"],
            "rovai:review-duo"
        );
        assert_eq!(
            public_counts,
            ["camp", "camp_member", "camp_turn"].map(|name| count(&db, name))
        );
    }
}
