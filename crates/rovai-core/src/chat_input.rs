use super::*;
use crate::agent_profile::resolve_frozen_runtime;
use crate::camp_content::StructuredThreadMessageSegment;
use crate::collaboration::append_domain_event;
use crate::command::canonical_json_digest;
use crate::local_attachment_source::{
    LocalAttachmentSourceRef, parse_source_attachments, serialize_source_attachments,
    validate_source_attachments,
};
use crate::message_quote::{MessageQuoteSnapshot, QuoteStorage, parse_quotes, store_quotes};
use crate::single_chat::{PrivateRun, insert_private_run};
use anyhow::{Context, bail};
use chrono::Utc;
use serde_json::Value;
use unicode_segmentation::UnicodeSegmentation;
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_attachments: Vec<LocalAttachmentSourceRef>,
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

pub(crate) fn bind_send_identity(envelope: &mut CommandEnvelope<SendInput>) -> Result<()> {
    let input = &envelope.payload;
    match (&input.chat_id, &input.agent_id, &input.draft_id) {
        (None, Some(agent), Some(draft))
            if input.mode == InputMode::Start
                && !draft.is_empty()
                && draft.len() <= 512
                && !agent.is_empty() =>
        {
            envelope.command_id = format!(
                "chat-first:{}",
                canonical_json_digest(&json!([CURRENT_USER_ID, draft]))?
            );
        }
        (Some(id), None, None) if Uuid::parse_str(id).is_ok() => {}
        _ => bail!("chat.invalid_target"),
    }
    Ok(())
}

pub(crate) fn public_input_result(mut payload: Value) -> Value {
    if let Some(object) = payload.as_object_mut() {
        object.remove("inputDigest");
    }
    payload
}

pub(crate) fn send(
    db: &mut Database,
    mut envelope: CommandEnvelope<SendInput>,
) -> Result<CommandExecution> {
    let ActorRef::User { user_id } = &envelope.actor else {
        bail!("chat.user_required")
    };
    ensure!(user_id == CURRENT_USER_ID, "chat.user_required");
    bind_send_identity(&mut envelope)?;
    let user_id = CURRENT_USER_ID;
    let input = &envelope.payload;
    ensure!(
        input.body.len() <= 1_048_576
            && input.skills.len() <= 128
            && input.source_attachments.len() <= 10,
        "chat.input_too_large"
    );
    ensure!(
        !input.body.trim().is_empty()
            || !input.quotes.is_empty()
            || !input.source_attachments.is_empty(),
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
    let digest = input.digest()?;
    let execution=DomainCommandGateway.execute(db, &envelope, |tx| {
        let files=serialize_source_attachments(&input.source_attachments)?;
        validate_source_attachments(&input.source_attachments)?;
        let now = Utc::now().to_rfc3339();
        let (chat_id, agent_id, title) = topic_for_send(tx, input, user_id, &now)?;
        for source in input.quotes.iter().filter_map(|q|q.source.as_ref()).filter(|q|q.scope=="chat") {
            ensure!(source.conversation_id.as_deref()==Some(chat_id.as_str()) && source.camp_id.is_empty() &&
                tx.query_row("SELECT EXISTS(SELECT 1 FROM conversation_message WHERE conversation_id=?1 AND id=?2)",params![chat_id,source.message_id],|r|r.get::<_,bool>(0))?,"quote.owner_mismatch");
        }
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
            let availability=crate::steer::active_input_availability(tx,target,*epoch)?;
            ensure!(availability.can_steer, "chat.steer_unavailable");
            let target_epoch=(*epoch).max(1);
            let id=Uuid::new_v4().to_string();
            tx.execute("INSERT INTO single_chat_pending_input(id,conversation_id,enqueue_sequence,body,user_id,quotes_json,chat_skills_json,created_at,updated_at,requested_mode,target_run_id,target_execution_epoch,source_attachments_json)
                SELECT ?1,?2,COALESCE(MAX(enqueue_sequence),0)+1,?3,?4,?5,?6,?7,?7,'steer',?8,?9,?10 FROM single_chat_pending_input WHERE conversation_id=?2",
                params![id,chat_id,input.body,user_id,serde_json::to_string(&input.quotes)?,serde_json::to_string(&input.skills)?,now,target,target_epoch,files])?;
            let sequence=crate::execution_input::record_marker(tx,&id,target,target_epoch,&now,json!({"inputId":id}))?;
            changed(tx,&chat_id,"chat.steer_submitted",&id,&envelope.actor)?;
            return Ok(CommandHandlerResult::accepted("chat.input_accepted",json!({"kind":"steer_submitted","chatId":chat_id,"inputId":id,"runId":target,"executionEpoch":target_epoch,"evidenceSequence":sequence,"inputDigest":digest}),Some(EntityReference{entity_type:"chat".into(),entity_id:chat_id})));
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
                    user_id, quotes_json, chat_skills_json, created_at, updated_at,source_attachments_json)
                 SELECT ?1,?2,COALESCE(MAX(enqueue_sequence),0)+1,?3,?4,?5,?6,?7,?7,?8
                 FROM single_chat_pending_input WHERE conversation_id=?2",
                params![input_id,chat_id,input.body,user_id,serde_json::to_string(&input.quotes)?,
                    serde_json::to_string(&input.skills)?,now,files],
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
                    &files,
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
    })?;
    ensure!(execution.result.code != "chat.deleted", "chat.deleted");
    Ok(execution)
}

// A composer reference is [escaped label](rovai://kind/id). Other Markdown stays as typed.
fn title_reference(after_open: &str) -> Option<(String, &str, &str)> {
    let mut chars = after_open.chars();
    let mut label = String::new();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => label.push(chars.next()?),
            '[' => return None,
            ']' => {
                let (target, rest) = chars.as_str().strip_prefix("(rovai://")?.split_once(')')?;
                return (target.starts_with("thread/") || target.starts_with("mission/"))
                    .then_some((label, target, rest));
            }
            _ => label.push(ch),
        }
    }
    None
}

fn initial_text_title(tx: &Transaction<'_>, line: &str) -> Result<String> {
    let mut text = String::new();
    let mut rest = line;
    while let Some((prefix, after_open)) = rest.split_once('[') {
        text.push_str(prefix);
        let Some((label, target, tail)) = title_reference(after_open) else {
            text.push('[');
            rest = after_open;
            continue;
        };
        if text.is_empty() && tail.is_empty() {
            let (query, id) = if let Some(id) = target.strip_prefix("thread/") {
                (
                    "SELECT title FROM camp WHERE id=?1 AND deletion_operation_id IS NULL AND archived_at IS NULL",
                    id,
                )
            } else {
                (
                    "SELECT title FROM mission WHERE id=?1",
                    &target["mission/".len()..],
                )
            };
            return tx
                .query_row(query, [id], |r| r.get(0))
                .optional()?
                .context("chat.reference_unavailable");
        }
        text.push_str(&label);
        rest = tail;
    }
    text.push_str(rest);
    Ok(text
        .split_sentence_bounds()
        .next()
        .unwrap_or(&text)
        .trim_end()
        .to_owned())
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
    let first_line = input
        .body
        .trim()
        .lines()
        .next()
        .filter(|line| !line.is_empty())
        .map(|line| initial_text_title(tx, line))
        .transpose()?
        .or_else(|| {
            input
                .source_attachments
                .first()
                .map(|file| file.display_name.clone())
        })
        .or_else(|| {
            input
                .quotes
                .first()
                .map(|quote| quote.text.trim().to_owned())
        })
        .unwrap_or_default();
    let title: String = first_line.graphemes(true).take(20).collect();
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
    files: &str,
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
    tx.execute("INSERT INTO conversation_message(id,conversation_id,sequence,author_type,author_id,body,agent_run_id,chat_skills_json,created_at,source_attachments_json) VALUES(?1,?2,?3,'user',?4,?5,?6,?7,?8,?9)",params![message,chat,sequence,CURRENT_USER_ID,body,run,serde_json::to_string(skills)?,now,files])?;
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

pub(super) fn mark_input_published(
    tx: &Transaction<'_>,
    input_id: &str,
    message_id: &str,
    run_id: &str,
    now: &str,
) -> Result<()> {
    tx.execute(
        "UPDATE single_chat_pending_input SET state='published',revision=revision+1,
         published_conversation_message_id=?2,published_agent_run_id=?3,published_at=?4,updated_at=?4,
         body='',quotes_json='[]',source_attachments_json='[]',chat_skills_json='[]' WHERE id=?1",
        params![input_id, message_id, run_id, now],
    )?;
    Ok(())
}

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
        let (chat, agent, body, quotes, skills, files) = tx.query_row(
            "SELECT p.conversation_id,c.agent_id,p.body,p.quotes_json,p.chat_skills_json,p.source_attachments_json
             FROM single_chat_pending_input p JOIN conversation c ON p.conversation_id=c.id WHERE p.id=?1",
            [&id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?)))?;
        let now = Utc::now().to_rfc3339();
        let publication = validate_source_attachments(&parse_source_attachments(&files)?)
            .map_err(anyhow::Error::from)
            .and_then(|()| {
                start(
                    &tx,
                    &chat,
                    &agent,
                    &body,
                    &files,
                    &parse_quotes(&quotes)?,
                    &serde_json::from_str::<Vec<ChatSkill>>(&skills)?,
                    &id,
                    &now,
                )
            });
        match publication {
            Ok((message, run)) => {
                mark_input_published(&tx, &id, &message, &run, &now)?;
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
        let (body,skills,quotes,files):(String,String,String,String)=tx.query_row("UPDATE single_chat_pending_input SET state='cancelled',revision=revision+1,updated_at=?4
               WHERE id=?1 AND conversation_id=?2 AND revision=?3 AND state IN ('queued','needs_repair') AND requested_mode='start'
               AND EXISTS (SELECT 1 FROM chat_topic t WHERE t.conversation_id=?2 AND owner_user_id=?5 AND archived_at IS NULL AND deletion_operation_id IS NULL)
               RETURNING body,chat_skills_json,quotes_json,source_attachments_json",params![input.input_id,input.chat_id,input.expected_revision,Utc::now().to_rfc3339(),user_id],
               |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?.context("chat.input_changed")?;
        let mut result = json!({"inputDigest":canonical_json_digest(&serde_json::to_value(input)?)?});
        if matches!(input.operation, EditOperation::ReturnToComposer) {
            result["body"]=json!(body);
            result["skills"]=serde_json::from_str(&skills)?;
            result["quotes"]=serde_json::from_str(&quotes)?;
            result["sourceAttachments"]=serde_json::from_str(&files)?;
        }
        Ok(CommandHandlerResult::applied("chat.pending_input_removed",result,Some(EntityReference{entity_type:"chat".into(),entity_id:input.chat_id.clone()})))
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

    fn claim_chat(
        db: &mut Database,
        chat: &str,
        run_id: &str,
        body: &str,
    ) -> (i64, crate::team_tool::BuiltinToolBindingCredential) {
        use crate::context::{
            CharterDeliveryMode, ContextMaterialization, ContextService, MaterializeContextRequest,
        };
        use crate::runtime::{
            BindNativeSessionCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
        };
        let service = ExecutionRuntimeService::default();

        let candidate = service
            .list_dispatchable_agent_runs(db, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.agent_run_id == run_id)
            .expect("private Run should be dispatchable");
        let claim = service
            .claim_agent_run(
                db,
                &CommandEnvelope {
                    command_id: format!("claim-{run_id}"),
                    actor: ActorRef::System {
                        component_id: "agent-run-scheduler".into(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: run_id.into(),
                        expected_version: candidate.version,
                        lease_owner: "chat-worker".into(),
                        lease_seconds: 60,
                        workspace: Some(candidate.execution_workspace()),
                        starting_git_observation: None,
                    },
                },
            )
            .unwrap();
        let epoch = claim.result.payload["executionEpoch"]
            .as_i64()
            .unwrap_or_else(|| panic!("{:?}", claim.result));
        let execution = service
            .load_agent_run_execution(db, run_id, epoch)
            .unwrap()
            .unwrap();
        let credential = crate::team_tool::TeamToolService::default()
            .prepare_binding_credential(db, run_id, epoch, false)
            .unwrap();
        let store = crate::managed_blob::ManagedBlobStore::new(db.path().parent().unwrap());
        let prepared = ContextService
            .materialize(
                db,
                &store,
                &MaterializeContextRequest {
                    agent_run_id: run_id,
                    execution_epoch: epoch,
                    charter_delivery_mode: CharterDeliveryMode::FirstPayload,
                    max_payload_bytes: 262144,
                },
            )
            .unwrap();
        let ContextMaterialization::Ready(prepared) = prepared else {
            panic!("chat context should be ready")
        };
        assert!(
            prepared
                .runtime_payload
                .contains("You are in Rovai. Reply in this private chat.")
        );
        assert!(
            prepared
                .rendered_payload
                .contains("[ROVAI_ADDITIONAL_SKILLS]")
        );
        let current_input = prepared
            .rendered_payload
            .rsplit_once("[CURRENT_INPUT]\n")
            .unwrap()
            .1
            .split_once("\n[/CURRENT_INPUT]")
            .unwrap()
            .0;
        assert_eq!(
            serde_json::from_str::<Value>(current_input).unwrap()["message"],
            body
        );
        assert!(!prepared.rendered_payload.contains("[RUN_FACTS]"));
        let binding = service
            .bind_native_session(
                db,
                &CommandEnvelope {
                    command_id: format!("bind-{run_id}"),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:test".into(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: BindNativeSessionCommand {
                        conversation_id: chat.into(),
                        agent_run_id: run_id.into(),
                        expected_conversation_version: credential.conversation_version,
                        expected_execution_epoch: epoch,
                        previous_adapter_installation_id: credential
                            .previous_adapter_installation_id
                            .clone(),
                        previous_native_session_id: credential.previous_native_session_id.clone(),
                        previous_binding_compatibility_digest: credential
                            .previous_binding_compatibility_digest
                            .clone(),
                        proposed_binding_id: Some(credential.native_binding_id.clone()),
                        adapter_installation_id: credential.adapter_installation_id.clone(),
                        native_session_id: format!("private-{run_id}"),
                        binding_compatibility_digest: execution
                            .runtime
                            .binding_compatibility_digest
                            .clone(),
                    },
                },
            )
            .unwrap();
        assert_eq!(
            binding.result.status,
            crate::command::CommandResultStatus::Applied,
            "{:?}",
            binding.result
        );
        let initial = ContextService
            .prepare_input_delivery_for_context(db, run_id, epoch, &prepared)
            .unwrap();
        assert!(
            ContextService
                .begin_runtime_input_dispatch(db, &initial.id, run_id, epoch)
                .unwrap()
        );
        ContextService
            .acknowledge_input_delivery(db, &initial.id, "native-first")
            .unwrap();
        (epoch, credential)
    }

    #[test]
    fn first_send_replays_the_draft_and_fifo_preserves_message_skills_without_a_thread() {
        let mut db = crate::test_support::seeded_runtime_database_owned();
        db.connection().execute("UPDATE adapter_capability_snapshot SET reported_version='0.162.1' WHERE installation_id='adapter-test-codex'",[]).unwrap();
        let exe = std::env::current_exe().unwrap();
        let observed = crate::agent_runtime_adapter::observe_executable_identity(&exe)
            .unwrap()
            .file_identity;
        db.connection().execute("INSERT OR REPLACE INTO runtime_executable_identity(installation_id,executable_path,executable_fingerprint,byte_size,modified_at_unix_nanos,file_id,verified_at)
            SELECT s.installation_id,i.executable_path,s.executable_fingerprint,?1,?2,?3,datetime('now') FROM adapter_capability_snapshot s JOIN adapter_installation i ON i.id=s.installation_id WHERE i.id='adapter-test-codex'",
            params![i64::try_from(observed.byte_size).unwrap(),observed.modified_at_unix_nanos,observed.file_id]).unwrap();
        let count = |db: &Database, table: &str| {
            db.connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap()
        };
        let public_counts = ["camp", "camp_member", "camp_turn"].map(|name| count(&db, name));
        {
            let tx = db.connection_mut().transaction().unwrap();
            assert_eq!(
                initial_text_title(
                    &tx,
                    "[A](rovai://thread/a) 已发版。再看 [B](rovai://thread/b)"
                )
                .unwrap(),
                "A 已发版。"
            );
            assert_eq!(
                initial_text_title(&tx, r"核对 [预算\[Q4\]](rovai://thread/a)。下一步").unwrap(),
                "核对 预算[Q4]。"
            );
        }
        let external_upload = db.directory().join("first-upload.txt");
        std::fs::write(&external_upload, "release notes").unwrap();
        let upload = crate::local_attachment_source::observe_agent_source_attachments(
            &[external_upload.to_string_lossy().into_owned()],
            db.directory(),
        )
        .unwrap()
        .remove(0);
        let client = crate::draft_client::DraftClient::verified_web(&"a".repeat(64)).unwrap();
        let intent = crate::web_upload::UploadIntent {
            target: crate::web_upload::UploadTarget::Chat,
            command_id: upload.id.clone(),
            camp_id: "chat-draft:shared".into(),
            expected_revision: 1,
            display_name: upload.display_name.clone(),
            byte_size: upload.observed_byte_size.unwrap(),
            sha256: "a".repeat(64),
        };
        let upload_dir = db.directory().to_owned();
        crate::web_upload::bind(
            &mut db,
            &upload_dir,
            &client,
            intent.clone(),
            upload.clone(),
        )
        .unwrap();
        let first = json!({"draftId":"shared","agentId":"agent_1","mode":"start","body":"讨论发布计划。再核对发布时间。","sourceAttachments":[upload]});
        let result = submit(&mut db, "first", first.clone()).unwrap();
        assert_eq!(result["kind"], "started");
        assert_eq!(result["title"], "讨论发布计划。");
        assert_eq!(
            submit(&mut db, "another-window", first.clone()).unwrap(),
            result
        );
        let mut modified = first;
        modified["skills"] = json!([{"skillId":"rovai:review-duo","nameAtSend":"review-duo"}]);
        assert!(submit(&mut db, "changed", modified).is_err());
        let chat = result["chatId"].as_str().unwrap();
        let queue = json!({"chatId":chat,"mode":"start","body":"用 $review-duo 评审","sourceAttachments":[upload],"skills":[{"skillId":"rovai:review-duo","nameAtSend":"review-duo"}]});
        let accepted = submit(&mut db, "queue", queue.clone()).unwrap();
        assert_eq!(accepted["kind"], "queued");
        assert_eq!(submit(&mut db, "queue", queue).unwrap(), accepted);
        assert!(publish_ready(&mut db).unwrap().is_empty());
        assert_eq!(count(&db, "chat_topic"), 1);
        assert_eq!(count(&db, "conversation_message"), 1);
        assert_eq!(count(&db, "agent_run"), 1);
        use crate::context::{
            CharterDeliveryMode, ContextMaterialization, ContextService, MaterializeContextRequest,
        };
        use crate::runtime::{ExecutionRuntimeService, SucceedAgentRunCommand};
        let service = ExecutionRuntimeService::default();
        let run_id = result["runId"].as_str().unwrap();
        let (epoch, _) = claim_chat(&mut db, chat, run_id, "讨论发布计划。再核对发布时间。");
        let store = crate::managed_blob::ManagedBlobStore::new(db.path().parent().unwrap());
        let availability =
            crate::steer::active_input_availability(db.connection(), run_id, epoch).unwrap();
        assert!(availability.ready, "{availability:?}");
        let supplement = json!({"chatId":chat,"mode":"steer","body":"用中文","runId":run_id,"executionEpoch":epoch});
        let submitted = submit(&mut db, "supplement", supplement.clone()).unwrap();
        let input = submitted["inputId"].as_str().unwrap();
        assert_eq!(
            submitted,
            submit(&mut db, "supplement", supplement).unwrap()
        );
        let snapshot = |db: &mut Database| {
            super::super::open(
                db,
                super::super::OpenParams {
                    chat_id: chat.into(),
                    before_sequence: None,
                    limit: None,
                },
            )
            .unwrap()
            .unwrap()
        };
        assert_eq!(snapshot(&mut db).supplements.len(), 1);
        assert_eq!(crate::chat::ready_steers(db.connection()).unwrap().len(), 1);
        let ContextMaterialization::Ready(steer) = ContextService
            .materialize_with_attachment_reads(
                &mut db,
                &store,
                None,
                None,
                &[],
                &MaterializeContextRequest {
                    agent_run_id: run_id,
                    execution_epoch: epoch,
                    charter_delivery_mode: CharterDeliveryMode::FirstPayload,
                    max_payload_bytes: 262144,
                },
                Some(input),
                &Default::default(),
            )
            .unwrap()
        else {
            panic!("supplement should materialize")
        };
        assert!(steer.rendered_payload.contains("用中文"));
        let signed = ContextService
            .prepare_input_delivery_for_context(&mut db, run_id, epoch, &steer)
            .unwrap();
        assert!(
            ContextService
                .begin_runtime_input_dispatch(&mut db, &signed.id, run_id, epoch)
                .unwrap()
        );
        ContextService
            .mark_input_delivery_unknown(&mut db, &signed.id, "transport disconnected")
            .unwrap();
        db.reopen_production().unwrap();
        let uncertain = snapshot(&mut db);
        assert!(uncertain.supplements[0].unconfirmed);
        assert_eq!(
            uncertain.supplements[0].pending.as_ref().unwrap().body,
            "用中文"
        );
        assert!(uncertain.supplements[0].message_id.is_none());
        assert!(
            crate::chat::ready_steers(db.connection())
                .unwrap()
                .is_empty()
        );
        for _ in 0..2 {
            ContextService
                .acknowledge_input_delivery(&mut db, &signed.id, "native-steer")
                .unwrap();
        }
        assert!(
            crate::chat::ready_steers(db.connection())
                .unwrap()
                .is_empty()
        );
        let after = snapshot(&mut db);
        assert_eq!(after.supplements.len(), 1);
        assert!(!after.supplements[0].unconfirmed);
        let marker = serde_json::to_value(&after.supplements[0]).unwrap();
        assert!(marker["messageId"].is_string() && marker["occurredAt"].is_string());
        assert!(
            ["body", "quotes", "attachments"]
                .iter()
                .all(|key| marker.get(*key).is_none())
        );
        let supplement_only = super::super::open(
            &mut db,
            super::super::OpenParams {
                chat_id: chat.into(),
                before_sequence: None,
                limit: Some(1),
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(supplement_only.messages[0].body, "用中文");
        assert_eq!(supplement_only.runs[0].run_id, run_id);
        assert_eq!(after.pending_inputs.len(), 1);
        assert_eq!(
            after
                .messages
                .iter()
                .filter(|msg| msg.body == "用中文")
                .count(),
            1
        );
        let execution = service
            .load_agent_run_execution(&db, run_id, epoch)
            .unwrap()
            .unwrap();
        let at_completion = submit(&mut db, "at-completion", json!({
            "chatId":chat,"mode":"steer","body":"also check the date","runId":run_id,"executionEpoch":epoch
        })).unwrap();
        let completed = service
            .succeed_agent_run(
                &mut db,
                &CommandEnvelope {
                    command_id: "complete-chat".into(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".into(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: run_id.into(),
                        expected_version: execution.version,
                        execution_epoch: epoch,
                        native_turn_id: "native-1".into(),
                        final_output: "今天开会。".into(),
                        ending_git_observation: None,
                        missing_send_recovery_candidate: None,
                    },
                },
            )
            .unwrap();
        assert!(
            completed.result.payload["finalConversationMessageId"].is_string(),
            "{:?}",
            completed.result
        );
        fn user_command<T>(id: &str, payload: T) -> CommandEnvelope<T> {
            CommandEnvelope {
                command_id: id.into(),
                actor: ActorRef::User {
                    user_id: CURRENT_USER_ID.into(),
                },
                camp_id: None,
                execution_epoch: None,
                expected_versions: vec![],
                payload,
            }
        }
        let queue_after_success = snapshot(&mut db).pending_inputs;
        assert_eq!(queue_after_success.len(), 2);
        assert_eq!(
            queue_after_success[0].input_id,
            accepted["inputId"].as_str().unwrap()
        );
        let converted = &queue_after_success[1];
        assert_eq!(
            converted.input_id,
            at_completion["inputId"].as_str().unwrap()
        );
        assert!(converted.converted_from_steer);
        edit_pending(&mut db, &user_command("remove-converted", serde_json::from_value(json!({
            "chatId":chat,"inputId":converted.input_id,"expectedRevision":converted.revision,"operation":"remove"
        })).unwrap())).unwrap();
        let archive = |db: &mut Database, id: &str, value| {
            super::super::set_archived(
                db,
                &user_command(
                    id,
                    super::super::SetArchived {
                        chat_id: chat.to_owned(),
                        archived: value,
                    },
                ),
            )
            .unwrap()
        };
        archive(&mut db, "archive", true);
        db.reopen_production().unwrap();
        assert!(publish_ready(&mut db).unwrap().is_empty());
        assert!(
            crate::chat::ready_steers(db.connection())
                .unwrap()
                .is_empty()
        );
        archive(&mut db, "restore", false);
        assert_eq!(publish_ready(&mut db).unwrap(), [chat]);
        assert!(publish_ready(&mut db).unwrap().is_empty());
        let frozen:String=db.connection().query_row("SELECT chat_skills_json FROM conversation_message WHERE conversation_id=?1 AND sequence=4",[chat],|r|r.get(0)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&frozen).unwrap()[0]["skillId"],
            "rovai:review-duo"
        );
        let queued_id = accepted["inputId"].as_str().unwrap();
        let locator =
            crate::local_attachment_source::LocalAttachmentOwnerLocator::SingleChatPending {
                camp_id: chat.into(),
                conversation_id: chat.into(),
                pending_input_id: queued_id.into(),
                attachment_ref_id: upload.id.clone(),
            };
        assert_eq!(
            crate::local_attachment_source::load_source_attachment(&db, &locator).unwrap(),
            Some(upload.clone())
        );
        let has_payload = |db: &Database| {
            db.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM single_chat_pending_input WHERE conversation_id=?1 AND state='published'
             AND (body<>'' OR quotes_json<>'[]' OR source_attachments_json<>'[]' OR chat_skills_json<>'[]'))",
            [chat], |r| r.get::<_,bool>(0)).unwrap()
        };
        assert!(!has_payload(&db));
        // Reopen a database with a published payload left by the previous release.
        db.connection()
            .execute(
                "UPDATE single_chat_pending_input SET body='old copy' WHERE id=?1",
                [queued_id],
            )
            .unwrap();
        db.connection()
            .execute_batch(
                "DELETE FROM schema_migration WHERE version=237;
            UPDATE rovai_data_contract SET projection_schema_version=186",
            )
            .unwrap();
        db.reopen_production().unwrap();
        assert!(!has_payload(&db));
        assert_eq!(
            crate::local_attachment_source::load_source_attachment(&db, &locator).unwrap(),
            Some(upload)
        );
        let queued_file = db.directory().join("queue.txt");
        std::fs::write(&queued_file, "queued file").unwrap();
        let files = crate::local_attachment_source::observe_agent_source_attachments(
            &[queued_file.to_string_lossy().into_owned()],
            db.directory(),
        )
        .unwrap();
        let broken = submit(
            &mut db,
            "file-at-head",
            json!({"chatId":chat,"mode":"start","body":"核对文件","sourceAttachments":files}),
        )
        .unwrap();
        submit(
            &mut db,
            "behind",
            json!({"chatId":chat,"mode":"start","body":"下一件事"}),
        )
        .unwrap();
        std::fs::remove_file(queued_file).unwrap();
        archive(&mut db, "pause-file", true);
        archive(&mut db, "resume-file", false);
        assert_eq!(publish_ready(&mut db).unwrap(), [chat]);
        assert!(publish_ready(&mut db).unwrap().is_empty());
        let pending = snapshot(&mut db).pending_inputs;
        assert_eq!(
            pending.iter().map(|p| p.state.as_str()).collect::<Vec<_>>(),
            ["needs_repair", "queued"]
        );
        let edit = user_command("edit-file", serde_json::from_value::<EditPending>(json!({
            "chatId":chat,"inputId":broken["inputId"],"expectedRevision":pending[0].revision,"operation":"return_to_composer"
        })).unwrap());
        assert_eq!(
            edit_pending(&mut db, &edit).unwrap().result.payload["body"],
            "核对文件"
        );
        assert!(edit_pending(&mut db, &edit).unwrap().replayed);
        assert_eq!(publish_ready(&mut db).unwrap(), [chat]);
        // The sidebar can confirm permanent deletion while its next Run is still queued.
        super::super::request_delete(
            &mut db,
            &user_command(
                "delete",
                super::super::DeleteChat {
                    chat_id: chat.into(),
                },
            ),
        )
        .unwrap();
        let directory =
            crate::storage_layout::chat_directory(db.runtime_camp_files_root(), chat).unwrap();
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("report.txt"), "report").unwrap();
        let outside = db.directory().join("external.txt");
        std::fs::write(&outside, "external").unwrap();
        db.reopen_production().unwrap();
        let pending = super::super::prepare_deletions(&mut db).unwrap();
        assert_eq!(pending.len(), 1);
        db.reopen_production().unwrap();
        let pending = super::super::prepare_deletions(&mut db).unwrap();
        for cleanup in pending {
            cleanup.remove_directory().unwrap();
            cleanup.remove_directory().unwrap();
            super::super::complete_directory_cleanup(&db, &cleanup.operation_id).unwrap();
        }
        assert!(
            crate::web_upload::reconcile(&db, &client, intent)
                .unwrap()
                .is_none()
        );
        assert!(external_upload.is_file());
        assert_eq!(count(&db, "chat_topic"), 0);
        assert!(!directory.exists());
        assert!(outside.is_file());
        assert_eq!(count(&db, "conversation_message"), 0);
        assert_eq!(
            public_counts,
            ["camp", "camp_member", "camp_turn"].map(|name| count(&db, name))
        );

        let restarted = submit(&mut db, "restart-draft", json!({"draftId":"restart-draft","agentId":"agent_1","mode":"start","body":"original turn"})).unwrap();
        let chat = restarted["chatId"].as_str().unwrap();
        let run = restarted["runId"].as_str().unwrap();
        let (epoch, _) = claim_chat(&mut db, chat, run, "original turn");
        let ordinary = submit(
            &mut db,
            "restart-queue",
            json!({"chatId":chat,"mode":"start","body":"next"}),
        )
        .unwrap();
        let unsent = submit(&mut db, "restart-steer", json!({"chatId":chat,"mode":"steer","body":"keep me","runId":run,"executionEpoch":epoch})).unwrap();
        db.reopen_production().unwrap();
        service
            .cancel_interrupted_single_chat_runs(&mut db)
            .unwrap();
        service
            .cancel_interrupted_single_chat_runs(&mut db)
            .unwrap();
        let reopened = super::super::open(
            &mut db,
            super::super::OpenParams {
                chat_id: chat.into(),
                before_sequence: None,
                limit: None,
            },
        )
        .unwrap()
        .unwrap();
        assert!(reopened.supplements.is_empty());
        assert_eq!(
            reopened
                .pending_inputs
                .iter()
                .map(|p| p.input_id.as_str())
                .collect::<Vec<_>>(),
            [
                ordinary["inputId"].as_str().unwrap(),
                unsent["inputId"].as_str().unwrap()
            ]
        );
        assert!(reopened.pending_inputs[1].converted_from_steer);
        assert_eq!(reopened.pending_inputs[1].body, "keep me");
        // An upgrade also restores the exact interrupted input left by a 235 restart.
        db.connection().execute("UPDATE single_chat_pending_input SET requested_mode='steer',state='cancelled' WHERE id=?1",[unsent["inputId"].as_str().unwrap()]).unwrap();
        db.connection().execute_batch("DELETE FROM schema_migration WHERE version IN (236,237); UPDATE rovai_data_contract SET projection_schema_version=185;").unwrap();
        db.reopen_production().unwrap();
        let restored = super::super::open(
            &mut db,
            super::super::OpenParams {
                chat_id: chat.into(),
                before_sequence: None,
                limit: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(restored.pending_inputs[1].input_id, unsent["inputId"]);
        assert!(restored.pending_inputs[1].converted_from_steer);
        let failed_turn = submit(
            &mut db,
            "provider-failure",
            json!({"draftId":"provider-failure",
            "agentId":"agent_1","mode":"start","body":"write the plan"}),
        )
        .unwrap();
        let chat = failed_turn["chatId"].as_str().unwrap();
        let next_run = failed_turn["runId"].as_str().unwrap().to_owned();
        let (epoch, _) = claim_chat(&mut db, chat, &next_run, "write the plan");
        let queued = submit(
            &mut db,
            "older-input",
            json!({"chatId":chat,"mode":"start","body":"next"}),
        )
        .unwrap();
        let budget = submit(
            &mut db,
            "budget",
            json!({"chatId":chat,"mode":"steer","body":"预算控制在五万以内",
            "runId":next_run,"executionEpoch":epoch}),
        )
        .unwrap();
        let version = db
            .connection()
            .query_row(
                "SELECT version FROM agent_run WHERE id=?1",
                [&next_run],
                |r| r.get(0),
            )
            .unwrap();
        service
            .fail_agent_run(
                &mut db,
                &CommandEnvelope {
                    command_id: "ordinary-failure".into(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".into(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: crate::runtime::FailAgentRunCommand {
                        agent_run_id: next_run.clone(),
                        execution_epoch: epoch,
                        expected_version: version,
                        error_code: "provider_error".into(),
                        error_detail: None,
                        failure: None,
                        manual_retry_allowed: true,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        let after_failure = super::super::open(
            &mut db,
            super::super::OpenParams {
                chat_id: chat.into(),
                before_sequence: None,
                limit: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            after_failure
                .pending_inputs
                .iter()
                .map(|p| p.input_id.as_str())
                .collect::<Vec<_>>(),
            [
                queued["inputId"].as_str().unwrap(),
                budget["inputId"].as_str().unwrap()
            ]
        );
        assert!(after_failure.pending_inputs[1].converted_from_steer);
        assert_eq!(after_failure.pending_inputs[1].body, "预算控制在五万以内");
        db.connection().execute("UPDATE single_chat_pending_input SET requested_mode='steer',state='cancelled' WHERE id=?1",
            [budget["inputId"].as_str().unwrap()]).unwrap();
        db.connection()
            .execute_batch(
                "DELETE FROM schema_migration WHERE version=237;
            UPDATE rovai_data_contract SET projection_schema_version=186",
            )
            .unwrap();
        db.reopen_production().unwrap();
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT state,requested_mode FROM single_chat_pending_input WHERE id=?1",
                    [budget["inputId"].as_str().unwrap()],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                )
                .unwrap(),
            ("queued".into(), "start".into())
        );
    }
    #[test]
    fn private_history_and_public_writes_stay_with_their_respective_owners() {
        use crate::team_tool::{
            TeamTaskToolInvocation, TeamToolService, ThreadMessageSendInvocation,
        };
        let mut db = crate::test_support::seeded_runtime_database_owned();
        // A previous preview already committed 235 with guards referencing the wrong table.
        db.connection().execute_batch("DELETE FROM schema_migration WHERE version IN (236,237);
            UPDATE rovai_data_contract SET projection_schema_version=185;
            DROP TRIGGER chat_memory_revision_source;
            CREATE TRIGGER chat_memory_revision_source BEFORE INSERT ON memory_revision
            WHEN NEW.source_camp_id IS NULL AND EXISTS(SELECT 1 FROM agent_run WHERE agent_id=NEW.actor_id)
            BEGIN SELECT RAISE(ABORT,'old guard'); END;").unwrap();
        db.reopen_production().unwrap();
        let tools = TeamToolService::default();
        crate::task_capability::set(db.connection(), true).unwrap();
        let open = |db: &mut Database, key: &str, body: &str| {
            submit(
                db,
                key,
                json!({"draftId":key,"agentId":"agent_1","mode":"start","body":body}),
            )
            .unwrap()
        };
        let a = open(&mut db, "draft-a", "新建团队会话，建任务并通知小林。");
        let prefix = "这是另一个话题".to_owned() + &"好".repeat(12);
        let b = open(&mut db, "draft-b", &format!("{prefix}👨‍👩‍👧‍👦。"));
        assert_eq!(b["title"], format!("{prefix}👨‍👩‍👧‍👦"));
        let chat = a["chatId"].as_str().unwrap();
        let run = a["runId"].as_str().unwrap();
        let (epoch, binding) = claim_chat(&mut db, chat, run, "新建团队会话，建任务并通知小林。");
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        let history = super::super::history(
            &db,
            run,
            epoch,
            super::super::HistoryInput {
                cursor: None,
                limit: Some(10),
            },
        )
        .unwrap();
        assert!(!history.to_string().contains("这是另一个话题"));
        let invalid = URL_SAFE_NO_PAD.encode(json!([b["chatId"], 1, 1]).to_string());
        assert!(
            super::super::history(
                &db,
                run,
                epoch,
                super::super::HistoryInput {
                    cursor: Some(invalid),
                    limit: None
                }
            )
            .is_err()
        );
        let auth = tools
            .authenticate_binding(
                &db,
                &binding.native_binding_id,
                &binding.binding_credential,
                "create-public",
            )
            .unwrap();
        for (scope, table) in [
            ("companion", "memory_revision"),
            ("hearth", "hearth_review_item"),
        ] {
            let write = crate::memory_tool::MemoryToolService.write_attested(&mut db, &crate::memory_tool::MemoryWriteToolInvocation {
                native_binding_id: binding.native_binding_id.clone(), binding_credential: binding.binding_credential.clone(),
                runtime_tool_call_id: format!("remember-{scope}"), input:serde_json::from_value(json!({
                    "action":"add", "scope":scope, "kind":"agreement", "body":format!("Review the {scope} release notes together."),
                    "retrievalKeys":["release notes"]
                })).unwrap(),
            }, run, epoch).unwrap();
            assert_ne!(
                write.result.status,
                crate::command::CommandResultStatus::Rejected,
                "{:?}",
                write.result
            );
            assert_eq!(db.connection().query_row(&format!("SELECT COUNT(*) FROM {table} WHERE source_agent_run_id=?1 AND source_camp_id IS NULL"),[run],|r|r.get::<_,i64>(0)).unwrap(),1);
        }
        let root = db.directory().to_owned();
        let card = serde_json::json!({"creationKey":Uuid::new_v4().to_string(),"displayName":"发布助手","teamRole":"发布"});
        let create_member = |db: &mut Database, value: Value| {
            crate::member_studio::create_member(
                db,
                &root,
                &auth,
                serde_json::from_value(value).unwrap(),
            )
        };
        let first = create_member(&mut db, card.clone()).unwrap();
        assert!(!first.execution.replayed);
        assert!(
            create_member(&mut db, card.clone())
                .unwrap()
                .execution
                .replayed
        );
        let mut changed_card = card.clone();
        changed_card["workingPrinciples"] = json!("修改过的确认卡");
        let conflict = create_member(&mut db, changed_card.clone()).unwrap_err();
        assert_eq!(
            conflict
                .downcast_ref::<crate::member_studio::MemberOperationError>()
                .unwrap()
                .code,
            "member.creation_key_conflict"
        );
        // A receipt from an older build can be verified against the original, untouched profile.
        let old_receipt = format!("member-create:{}", card["creationKey"].as_str().unwrap());
        assert_eq!(1, db.connection().execute(
            "UPDATE event_log SET result_payload_json=json_remove(result_payload_json,'$.cardDigest')
             WHERE command_id=?1 AND event_type='command.result'",
            [&old_receipt],
        ).unwrap());
        assert!(create_member(&mut db, card).unwrap().execution.replayed);
        assert!(create_member(&mut db, changed_card).is_err());
        let created = super::super::create_thread(
            &mut db,
            &auth,
            "create-public".into(),
            super::super::CreateThread {
                title: "发布组".into(),
                member_agent_ids: vec!["agent_1".into(), "agent_2".into()],
                default_lead_agent_id: "agent_2".into(),
            },
            &root,
        )
        .unwrap();
        let target = created.result.payload["threadId"]
            .as_str()
            .unwrap_or_else(|| panic!("{:?}", created.result));
        let task=TeamTaskToolInvocation{
            native_binding_id:binding.native_binding_id.clone(),binding_credential:binding.binding_credential.clone(),runtime_tool_call_id:"create-task".into(),
            input:serde_json::from_value(json!({"threadId":target,"title":"检查发布说明","description":"核对时间","assigneeAgentId":"agent_1"})).unwrap()
        };
        let result = tools.create_task(&mut db, &task).unwrap();
        assert_eq!(
            result.result.status,
            crate::command::CommandResultStatus::Applied,
            "{:?}",
            result.result
        );
        assert_eq!(result.result.payload["createdById"], "agent_1");
        assert!(result.result.payload["sourceAgentRunId"].is_null());
        assert!(tools.create_task(&mut db, &task).unwrap().replayed);
        let task_id = result.result.payload["taskId"].as_str().unwrap();
        tools.update_task(&mut db, &TeamTaskToolInvocation {
            native_binding_id: binding.native_binding_id.clone(),
            binding_credential: binding.binding_credential.clone(),
            runtime_tool_call_id: "close-task".into(),
            input: serde_json::from_value(json!({"threadId":target,"taskId":task_id,"status":"completed","completionSummary":"已检查"})).unwrap(),
        }).unwrap();
        let sources: (String, String) = db
            .connection()
            .query_row(
                "SELECT source_agent_run_id,closed_by_agent_run_id FROM task WHERE id=?1",
                [task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(sources, (run.to_owned(), run.to_owned()));
        let read = crate::read_model::ReadModelService;
        for tasks in [
            read.camp_open_projection(&mut db, target).unwrap().tasks,
            read.camp_snapshot(&mut db, target).unwrap().tasks,
        ] {
            let public = tasks
                .unwrap()
                .into_iter()
                .find(|entry| entry.task.id == task_id)
                .unwrap()
                .task;
            assert_eq!(public.created_by_id, "agent_1");
            assert!(
                public.source_agent_run_id.is_none() && public.closed_by_agent_run_id.is_none()
            );
        }
        let directory =
            crate::storage_layout::chat_directory(db.runtime_camp_files_root(), chat).unwrap();
        std::fs::create_dir_all(&directory).unwrap();
        let report = directory.join("report.txt");
        let external = db.directory().join("list.txt");
        std::fs::write(&report, "report").unwrap();
        std::fs::write(&external, "external").unwrap();
        let files = vec![
            "report.txt".to_owned(),
            external.to_string_lossy().into_owned(),
        ];
        let source_files =
            crate::local_attachment_source::observe_agent_source_attachments(&files, &directory)
                .unwrap();
        let notice = ThreadMessageSendInvocation {
            cli_receipt_proof: Some("original-transport-proof".into()),
            native_binding_id: binding.native_binding_id,
            binding_credential: binding.binding_credential,
            runtime_tool_call_id: format!("agent-run:{run}:builtin-cli:{}", Uuid::new_v4()),
            input: serde_json::from_value(
                json!({"threadId":target,"body":"请检查发布说明","to":["agent_2"],"files":files}),
            )
            .unwrap(),
            source_files,
        };
        db.connection()
            .execute(
                "UPDATE camp_member SET status='left' WHERE camp_id=?1 AND agent_id='agent_1'",
                [target],
            )
            .unwrap();
        assert!(tools.send_public_message(&mut db, &notice).is_err());
        db.reopen_production().unwrap();
        db.connection()
            .execute(
                "UPDATE camp_member SET status='active' WHERE camp_id=?1 AND agent_id='agent_1'",
                [target],
            )
            .unwrap();
        let mut refused = ThreadMessageSendInvocation {
            cli_receipt_proof: Some("refused-transport-proof".into()),
            native_binding_id: notice.native_binding_id.clone(),
            binding_credential: notice.binding_credential.clone(),
            runtime_tool_call_id: format!("agent-run:{run}:builtin-cli:{}", Uuid::new_v4()),
            input: notice.input.clone(),
            source_files: vec![],
        };
        refused.input.files.clear();
        refused.input.to = vec!["not-a-participant".into()];
        let refusal = tools.send_public_message(&mut db, &refused).unwrap();
        assert_eq!(
            refusal.result.status,
            crate::command::CommandResultStatus::Rejected
        );
        let sent = tools.send_public_message(&mut db, &notice).unwrap();
        assert_ne!(
            sent.result.status,
            crate::command::CommandResultStatus::Rejected,
            "{:?}",
            sent.result
        );
        assert!(
            tools
                .send_public_message(&mut db, &notice)
                .unwrap()
                .replayed
        );
        let assert_public_receipt = |db: &mut Database| {
            let events = crate::read_model::ReadModelService
                .events_since(db, Some(target), 0, 2000)
                .unwrap()
                .events;
            let receipt = events
                .iter()
                .find(|e| {
                    e.event_type == "command.result"
                        && e.payload["result"]["messageId"] == sent.result.payload["messageId"]
                })
                .unwrap();
            assert!(receipt.source_agent_run_id.is_none() && receipt.execution_epoch.is_none());
            assert!(receipt.payload["result"].get("chatSendKey").is_none());
            assert!(!serde_json::to_string(&events).unwrap().contains(run));
        };
        assert_public_receipt(&mut db);
        let counts:(i64,i64)=db.connection().query_row("SELECT (SELECT COUNT(*) FROM task WHERE camp_id=?1 AND source_agent_run_id=?2),
            (SELECT COUNT(*) FROM camp_message WHERE camp_id=?1 AND author_id='agent_1' AND body='请检查发布说明' AND agent_run_id IS NULL AND source_agent_run_id IS NULL)",params![target,run],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(counts, (1, 1));
        let execution = crate::runtime::ExecutionRuntimeService::default()
            .load_agent_run_execution(&db, run, epoch)
            .unwrap()
            .unwrap();
        crate::runtime::ExecutionRuntimeService::default()
            .succeed_agent_run(
                &mut db,
                &CommandEnvelope {
                    command_id: "finished-publishing".into(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".into(),
                    },
                    camp_id: None,
                    execution_epoch: None,
                    expected_versions: vec![],
                    payload: crate::runtime::SucceedAgentRunCommand {
                        agent_run_id: run.into(),
                        expected_version: execution.version,
                        execution_epoch: epoch,
                        native_turn_id: "finished".into(),
                        final_output: "已通知小林。[报告](report.txt) ![图片](chart.png) [链接](linked-report) [外部](linked-outside) `[示例](sample.txt)`".into(),
                        ending_git_observation: None,
                        missing_send_recovery_candidate: None,
                    },
                },
            )
            .unwrap();
        let final_id: String = db
            .connection()
            .query_row(
                "SELECT final_conversation_message_id FROM agent_run WHERE id = ?1",
                [run],
                |row| row.get(0),
            )
            .unwrap();
        db.reopen_production().unwrap();
        let read_receipt = |input: &crate::team_tool::ThreadMessageSendInput| {
            tools
                .recorded_chat_send(&db, run, epoch, &notice.runtime_tool_call_id, &json!(input))
                .unwrap()
        };
        assert_eq!(read_receipt(&notice.input).unwrap().result, sent.result);
        assert_eq!(
            tools
                .recorded_cli_chat_send(&db, target, "original-transport-proof")
                .unwrap()
                .unwrap()
                .result,
            sent.result
        );
        assert!(
            tools
                .recorded_cli_chat_send(&db, target, "other-proof")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            tools
                .recorded_chat_send(
                    &db,
                    run,
                    epoch,
                    &refused.runtime_tool_call_id,
                    &json!(refused.input)
                )
                .unwrap()
                .unwrap()
                .result,
            refusal.result
        );
        assert_eq!(
            tools
                .recorded_cli_chat_send(&db, target, "refused-transport-proof")
                .unwrap()
                .unwrap()
                .result,
            refusal.result
        );
        let mut changed_input = notice.input.clone();
        changed_input.body.push('!');
        assert!(read_receipt(&changed_input).is_none());
        changed_input.thread_id = Some(chat.into());
        assert!(read_receipt(&changed_input).is_none());
        assert!(
            tools
                .recorded_chat_send(
                    &db,
                    run,
                    epoch + 1,
                    &notice.runtime_tool_call_id,
                    &json!(notice.input)
                )
                .unwrap()
                .is_none()
        );
        assert!(
            tools
                .send_public_message_attested(&mut db, &notice, run, epoch)
                .unwrap()
                .replayed
        );
        let can_preview = |chat_id: &str, reference: &str| {
            crate::file_preview_authority::can_preview_chat_reference(
                &db,
                serde_json::from_value(
                    json!({"chatId":chat_id,"messageId":final_id,"rawReference":reference}),
                )
                .unwrap(),
            )
            .unwrap()
        };
        std::fs::write(directory.join("chart.png"), b"image").unwrap();
        std::fs::write(directory.join("sample.txt"), "sample").unwrap();
        assert!(can_preview(chat, "report.txt"));
        assert!(can_preview(chat, "chart.png"));
        assert!(!can_preview(chat, "sample.txt"));
        assert!(!can_preview(b["chatId"].as_str().unwrap(), "report.txt"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&report, directory.join("linked-report")).unwrap();
            std::os::unix::fs::symlink(&external, directory.join("linked-outside")).unwrap();
            assert!(can_preview(chat, "linked-report"));
            assert!(!can_preview(chat, "linked-outside"));
        }
        let user = ActorRef::User {
            user_id: CURRENT_USER_ID.into(),
        };
        super::super::set_archived(
            &mut db,
            &CommandEnvelope {
                command_id: "archive-publisher".into(),
                actor: user.clone(),
                camp_id: None,
                execution_epoch: None,
                expected_versions: vec![],
                payload: super::super::SetArchived {
                    chat_id: chat.into(),
                    archived: true,
                },
            },
        )
        .unwrap();
        super::super::request_delete(
            &mut db,
            &CommandEnvelope {
                command_id: "delete-publisher".into(),
                actor: user,
                camp_id: None,
                execution_epoch: None,
                expected_versions: vec![],
                payload: super::super::DeleteChat {
                    chat_id: chat.into(),
                },
            },
        )
        .unwrap();
        db.reopen_production().unwrap();
        for cleanup in super::super::prepare_deletions(&mut db).unwrap() {
            cleanup.remove_directory().unwrap();
            super::super::complete_directory_cleanup(&db, &cleanup.operation_id).unwrap();
        }
        assert_public_receipt(&mut db);
        assert!(!report.exists());
        assert!(external.is_file());
        let stored: String = db
            .connection()
            .query_row(
                "SELECT source_attachments_json FROM camp_message WHERE id=?1",
                [sent.result.payload["messageId"].as_str().unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        let references = crate::local_attachment_source::parse_source_attachments(&stored).unwrap();
        assert_eq!(references[0].source_path, report.to_string_lossy());
        assert_eq!(references[1].source_path, external.to_string_lossy());
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT count(*) FROM task WHERE camp_id=?1 AND chat_source_deleted=1",
                    [target],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }
}
