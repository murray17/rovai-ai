//! A NativeInteraction is the question authority. The channel Outbox stores only
//! its routing/terminal markers and card identity. Feishu/Lark additionally keep
//! bounded display previews for updating the original card after completion.
use super::*;
use crate::native_interaction::{
    NativeInteractionAnswer, NativeInteractionStatus as Status, NativeInteractionView,
    RespondNativeInteraction,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardReference {
    pub interaction_id: String,
    pub thread_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_preview: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSource {
    pub delivery_id: String,
    pub agent_display_name: String,
    pub owner_user_id: Option<String>,
    pub interaction: NativeInteractionView,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer_preview: Option<String>,
}

/// Host-only platform identity, used as creator and to clear the Owner's private
/// error hint when another surface finishes the same request.
pub fn owner_user_id(database: &Database, provider: &str, app_id: &str) -> Result<Option<String>> {
    if provider != DINGTALK_PROVIDER {
        return Ok(None);
    }
    Ok(database.connection().query_row("SELECT identity.external_id FROM channel_member_bot_directory AS bot
        JOIN dingtalk_owner_identity AS owner ON owner.account_id=bot.account_id
        JOIN external_principal_app_identity AS identity ON identity.principal_id=owner.canonical_owner_principal_id
          AND identity.provider='dingtalk' AND identity.app_id=bot.app_id AND identity.identity_kind='user_id'
        WHERE bot.provider='dingtalk' AND bot.app_id=?1 AND bot.status='published'", [app_id], |r|r.get(0)).optional()?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceParams {
    pub delivery_id: String,
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnswerParams {
    pub delivery_id: String,
    pub interaction_id: String,
    pub app_id: String,
    pub external_message_id: String,
    pub chat_id: Option<String>,
    pub operator_open_id: Option<String>,
    pub operator_user_id: Option<String>,
    pub operator_union_id: Option<String>,
    pub answer: NativeInteractionAnswer,
}

fn reference(payload: &Value) -> Result<CardReference> {
    Ok(serde_json::from_value(
        payload["nativeInteraction"].clone(),
    )?)
}

/// Append one independent carrier per question. Public Run/binding ownership is
/// read from Core; a private conversation can never acquire a channel carrier.
pub fn project_pending(
    database: &mut Database,
    provider: &str,
    questions: &[(String, NativeInteractionView)],
) -> Result<()> {
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = Utc::now().to_rfc3339();
    for (thread_id, question) in questions
        .iter()
        .filter(|(_, q)| q.status == Status::Pending)
    {
        let route = tx.query_row(
            "SELECT binding.id, conversation.agent_id
             FROM agent_run AS run JOIN conversation ON conversation.id=run.conversation_id
             LEFT JOIN camp_turn ON camp_turn.id=run.camp_turn_id
             JOIN channel_conversation_binding AS binding ON binding.camp_id=COALESCE(run.camp_id,camp_turn.camp_id) AND binding.status='active'
             JOIN channel_conversation AS channel ON channel.id=binding.channel_conversation_id
             WHERE run.id=?1 AND run.execution_epoch=?2 AND binding.camp_id=?3 AND channel.provider=?4
               AND run.invocation_kind<>'single_chat' AND run.status IN ('running','waiting') AND run.cancel_requested_at IS NULL",
            params![question.agent_run_id, question.execution_epoch, thread_id, provider],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ).optional()?;
        let Some((binding_id, agent_id)) = route else {
            continue;
        };
        let Some(app_id) = bot_app_id(&tx, provider, &agent_id)? else {
            continue;
        };
        let value = CardReference {
            interaction_id: question.id.clone(),
            thread_id: thread_id.clone(),
            agent_run_id: question.agent_run_id.clone(),
            execution_epoch: question.execution_epoch,
            created_at: question.created_at,
            expires_at: question.expires_at,
            status: Status::Pending,
            question_preview: if matches!(provider, FEISHU_PROVIDER | LARK_PROVIDER) {
                question.questions.first().map(|q| q.display_preview())
            } else {
                None
            },
            answer_preview: None,
        };
        tx.execute("INSERT INTO channel_delivery(id,channel_binding_id,dedupe_key,delivery_kind,priority,target_app_id,source_agent_id,payload_json,status,attempt_count,available_at,created_at,updated_at)
            VALUES(?1,?2,?3,'native_interaction',15,?4,?5,?6,'pending',0,?7,?7,?7) ON CONFLICT(dedupe_key) DO NOTHING",
            params![format!("rvcd_{}",Uuid::new_v4().simple()),binding_id,format!("native_interaction:{binding_id}:{}",question.id),app_id,agent_id,
                serde_json::to_string(&json!({"operation":"send","nativeInteraction":value}))?,now])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn references(database: &Database, provider: &str) -> Result<Vec<CardReference>> {
    query_rows(database.connection(), "SELECT delivery.payload_json,binding.status FROM channel_delivery AS delivery
        JOIN channel_conversation_binding AS binding ON binding.id=delivery.channel_binding_id
        JOIN channel_conversation AS channel ON channel.id=binding.channel_conversation_id
        WHERE delivery.delivery_kind='native_interaction' AND json_extract(delivery.payload_json,'$.operation')='send'
          AND channel.provider=?1 AND binding.camp_id=json_extract(delivery.payload_json,'$.nativeInteraction.threadId')
          AND json_extract(delivery.payload_json,'$.nativeInteraction.status')='pending'", [provider], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?
        .into_iter().map(|(value,binding_status)| {
            let mut card = reference(&serde_json::from_str::<Value>(&value)?)?;
            if binding_status != "active" { card.status = Status::Unavailable; }
            Ok(card)
        }).collect()
}

/// Independent delivery updates use the existing Outbox retry/lease machinery.
/// In particular, retrying a PATCH can never call the native answer writer.
pub fn record_status(
    database: &mut Database,
    interaction_id: &str,
    status: Status,
    answer_preview: Option<&str>,
) -> Result<()> {
    if matches!(status, Status::Pending | Status::Failed) {
        return Ok(());
    }
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = Utc::now().to_rfc3339();
    let roots = query_rows(&tx, "SELECT id,channel_binding_id,target_app_id,source_agent_id,payload_json,COALESCE(json_extract(payload_json,'$.externalMessageId'),external_delivery_message_id)
        FROM channel_delivery WHERE delivery_kind='native_interaction'
          AND json_extract(payload_json,'$.operation')='send' AND json_extract(payload_json,'$.nativeInteraction.interactionId')=?1",
        [interaction_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?)))?;
    for (id, binding, app, agent, payload, message_id) in roots {
        let mut payload: Value = serde_json::from_str(&payload)?;
        let card = reference(&payload)?;
        // First native write wins, even if a lifecycle sweep reached this row
        // before its completion was recorded. Unknown writes are never replayed.
        let status = match card.status {
            Status::Sent | Status::Skipped | Status::Unknown => card.status,
            Status::Pending | Status::Failed => status,
            _ if matches!(status, Status::Sent | Status::Skipped) => status,
            _ => card.status,
        };
        payload["nativeInteraction"]["status"] = serde_json::to_value(status)?;
        if status == Status::Sent
            && card.question_preview.is_some()
            && card.answer_preview.is_none()
            && let Some(preview) = answer_preview
        {
            payload["nativeInteraction"]["answerPreview"] = json!(preview);
        }
        tx.execute(
            "UPDATE channel_delivery SET payload_json=?2,updated_at=?3 WHERE id=?1",
            params![id, serde_json::to_string(&payload)?, now],
        )?;
        // A write with unknown outcome must leave the client's form/draft alone.
        // Later clicks only read this marker; they cannot write another answer.
        if let Some(message_id) = message_id.filter(|_| status != Status::Unknown) {
            payload["operation"] = json!("update");
            payload["rootDeliveryId"] = json!(id);
            payload["externalMessageId"] = json!(message_id);
            tx.execute("INSERT INTO channel_delivery(id,channel_binding_id,dedupe_key,delivery_kind,priority,target_app_id,source_agent_id,payload_json,status,attempt_count,available_at,created_at,updated_at)
                VALUES(?1,?2,?3,'native_interaction',15,?4,?5,?6,'pending',0,?7,?7,?7) ON CONFLICT(dedupe_key) DO NOTHING",
                params![format!("rvcd_{}",Uuid::new_v4().simple()),binding,format!("native_interaction:{id}:{status:?}"),app,agent,serde_json::to_string(&payload)?,now])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Called after initial delivery settlement too, since the answer can beat the
/// HTTP send receipt. This never reopens a finished question.
pub fn reconcile_delivered(database: &mut Database, provider: &str) -> Result<()> {
    let rows=query_rows(database.connection(), "SELECT delivery.payload_json FROM channel_delivery AS delivery
        JOIN channel_conversation_binding AS binding ON binding.id=delivery.channel_binding_id
        JOIN channel_conversation AS channel ON channel.id=binding.channel_conversation_id
        WHERE delivery.delivery_kind='native_interaction' AND json_extract(delivery.payload_json,'$.operation')='send'
          AND channel.provider=?1 AND delivery.status='sent' AND delivery.external_delivery_message_id IS NOT NULL
          AND json_extract(delivery.payload_json,'$.nativeInteraction.status')<>'pending'
          AND json_extract(delivery.payload_json,'$.nativeInteraction.status')<>'unknown'
          AND NOT EXISTS(SELECT 1 FROM channel_delivery AS updated WHERE updated.delivery_kind='native_interaction'
              AND json_extract(updated.payload_json,'$.rootDeliveryId')=delivery.id)", [provider], |r| r.get::<_,String>(0))?;
    for row in rows {
        let value = reference(&serde_json::from_str::<Value>(&row)?)?;
        record_status(database, &value.interaction_id, value.status, None)?;
    }
    Ok(())
}

pub fn source_reference(
    database: &Database,
    provider: &str,
    delivery_id: &str,
    app_id: &str,
) -> Result<Option<(String, String, CardReference)>> {
    let row=database.connection().query_row("SELECT COALESCE(json_extract(delivery.payload_json,'$.rootDeliveryId'),delivery.id),COALESCE(profile.display_name,delivery.source_agent_id),binding.status
        FROM channel_delivery AS delivery JOIN channel_conversation_binding AS binding ON binding.id=delivery.channel_binding_id
        JOIN channel_conversation AS channel ON channel.id=binding.channel_conversation_id
        JOIN channel_member_bot_directory AS bot ON bot.provider=channel.provider AND bot.app_id=delivery.target_app_id AND bot.agent_id=delivery.source_agent_id AND bot.status='published'
        LEFT JOIN agent_profile AS profile ON profile.id=delivery.source_agent_id
        WHERE delivery.id=?1 AND delivery.target_app_id=?2 AND delivery.delivery_kind='native_interaction' AND channel.provider=?3
          AND binding.camp_id=json_extract(delivery.payload_json,'$.nativeInteraction.threadId')",
        params![delivery_id,app_id,provider], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional()?;
    row.map(|(root, name, binding_status)| {
        let root_payload: String = database.connection().query_row(
            "SELECT payload_json FROM channel_delivery WHERE id=?1",
            [&root],
            |r| r.get(0),
        )?;
        let mut card = reference(&serde_json::from_str::<Value>(&root_payload)?)?;
        if binding_status != "active" && card.status == Status::Pending {
            card.status = Status::Unavailable;
        }
        Ok((root, name, card))
    })
    .transpose()
}

/// Platform identity is received separately from the answer. No Owner command
/// envelope or local_user impersonation is used, and answer text is not journaled.
pub fn authorize_answer(
    database: &mut Database,
    actor: &ActorRef,
    provider: &str,
    params: &AnswerParams,
) -> Result<(RespondNativeInteraction, Status)> {
    anyhow::ensure!(
        is_channel_host_for_provider(actor, provider),
        "channel.native_interaction.host_required"
    );
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Deferred)?;
    let owner_table = match provider {
        "feishu" => FEISHU_SPEC.owner_identity,
        "lark" => LARK_SPEC.owner_identity,
        "dingtalk" => "dingtalk_owner_identity",
        _ => anyhow::bail!("channel.native_interaction.provider_invalid"),
    };
    let row=tx.query_row(&format!("SELECT delivery.payload_json,channel.chat_id,owner.canonical_owner_principal_id
        FROM channel_delivery AS delivery JOIN channel_conversation_binding AS binding ON binding.id=delivery.channel_binding_id
        JOIN channel_conversation AS channel ON channel.id=binding.channel_conversation_id
        JOIN channel_member_bot_directory AS bot ON bot.provider=channel.provider AND bot.app_id=delivery.target_app_id AND bot.agent_id=delivery.source_agent_id AND bot.status='published'
        JOIN {owner_table} AS owner ON owner.account_id=bot.account_id
        WHERE delivery.id=?1 AND delivery.target_app_id=?2 AND COALESCE(json_extract(delivery.payload_json,'$.externalMessageId'),delivery.external_delivery_message_id)=?3
          AND delivery.delivery_kind='native_interaction' AND delivery.status='sent' AND channel.provider=?4 AND binding.status='active'
          AND binding.camp_id=json_extract(delivery.payload_json,'$.nativeInteraction.threadId')
          AND json_extract(delivery.payload_json,'$.operation')='send'"),
        params![params.delivery_id,params.app_id,params.external_message_id,provider], |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional()?;
    let (payload, chat_id, owner) = row.context("channel.native_interaction.card_invalid")?;
    anyhow::ensure!(
        params.chat_id.as_deref().is_none_or(|id| id == chat_id),
        "channel.native_interaction.chat_mismatch"
    );
    anyhow::ensure!(
        operator_matches_channel_owner(
            &tx,
            provider,
            &params.app_id,
            &owner,
            params.operator_open_id.as_deref(),
            params.operator_user_id.as_deref(),
            params.operator_union_id.as_deref(),
            &Utc::now().to_rfc3339()
        )?,
        "channel.native_interaction.owner_required"
    );
    let card = reference(&serde_json::from_str::<Value>(&payload)?)?;
    anyhow::ensure!(
        card.interaction_id == params.interaction_id,
        "channel.native_interaction.request_mismatch"
    );
    tx.commit()?;
    // The answer remains in this request only; no DomainCommand receipt journals it.
    Ok((
        RespondNativeInteraction {
            command_id: Uuid::new_v4().to_string(),
            thread_id: card.thread_id,
            agent_run_id: card.agent_run_id,
            execution_epoch: card.execution_epoch,
            interaction_id: card.interaction_id,
            answer: params.answer.clone(),
        },
        card.status,
    ))
}
