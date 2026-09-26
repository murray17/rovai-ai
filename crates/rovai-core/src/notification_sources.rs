//! Business changes admit immutable occurrences in the command's own transaction.
use super::*;

pub(crate) struct StatusTransition<'a> {
    pub kind: &'a str,
    pub id: &'a str,
    pub camp_id: &'a str,
    pub status: &'a str,
    pub source_message_id: Option<&'a str>,
}

pub(crate) fn record_status_transition(
    tx: &Transaction<'_>,
    actor: &ActorRef,
    change: StatusTransition<'_>,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    // Every real transition resolves the previous question, including user changes.
    if change.kind == "mission" {
        tx.execute(
            "UPDATE notification_occurrence_disposition SET resolved_at=?2,updated_at=?2
             WHERE resolved_at IS NULL AND occurrence_id IN (
               SELECT id FROM notification_occurrence WHERE source_type='mission'
                 AND source_id=?1 AND semantic='mission_needs_you')",
            params![change.id, now],
        )?;
    }
    if matches!(actor, ActorRef::User { .. }) {
        return Ok(());
    }
    let semantic = match (change.kind, change.status) {
        ("mission", "needs_you") => "mission_needs_you",
        ("mission", _) => "mission_status_changed",
        ("task", _) => "task_status_changed",
        _ => anyhow::bail!("invalid notification business subject"),
    };
    let run = match actor {
        ActorRef::Agent {
            source_agent_run_id,
            ..
        } => Some(source_agent_run_id.as_str()),
        _ => None,
    };
    let key = format!("{}:local_user:{}", change.kind, change.id);
    tx.execute("UPDATE notification_change_clock SET current_sequence=current_sequence+1 WHERE singleton=1", [])?;
    tx.execute(
        "INSERT INTO notification_episode(id,aggregation_key,recipient_user_id,kind,camp_id,subject_id,
           version,attention_revision,created_change_sequence,last_change_sequence,sort_at,created_at,updated_at)
         SELECT ?1,?2,'local_user',?3,?4,?5,0,0,current_sequence,current_sequence,?6,?6,?6
         FROM notification_change_clock WHERE singleton=1 ON CONFLICT(aggregation_key) DO NOTHING",
        params![uuid::Uuid::new_v4().to_string(), key, change.kind, change.camp_id, change.id, now],
    )?;
    tx.execute(
        "INSERT INTO notification_occurrence(id,episode_id,recipient_user_id,semantic,source_type,source_id,
           source_revision,camp_id,agent_run_id,source_message_id,business_status,admitted_episode_version,
           admitted_attention_revision,admitted_change_sequence,occurred_at)
         SELECT ?1,e.id,'local_user',?2,?3,?4,
           1+COALESCE((SELECT MAX(source_revision) FROM notification_occurrence WHERE source_type=?3 AND source_id=?4),0),
           ?5,?6,?7,?8,e.version+1,e.attention_revision+1,c.current_sequence,?9
         FROM notification_episode e JOIN notification_change_clock c ON c.singleton=1 WHERE e.aggregation_key=?10",
        params![uuid::Uuid::new_v4().to_string(), semantic, change.kind, change.id, change.camp_id,
            run, change.source_message_id, change.status, now, key],
    )?;
    Ok(())
}

pub(super) fn load_subject(
    connection: &rusqlite::Connection,
    occurrence: &RawOccurrence,
) -> Result<Option<NotificationSubject>> {
    if !matches!(
        occurrence.source_type.as_str(),
        "round" | "mission" | "task"
    ) {
        return Ok(None);
    }
    let (id, status): (String, Option<String>) = connection.query_row(
        "SELECT source_id,business_status FROM notification_occurrence WHERE id=?1",
        [&occurrence.id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (title, related_run_ids) = match occurrence.source_type.as_str() {
        "round" => {
            let runs: Option<String> = connection
                .query_row(
                    "SELECT run_ids_json FROM notification_round WHERE id=?1",
                    [&id],
                    |row| row.get(0),
                )
                .optional()?;
            (
                "本轮完成".to_string(),
                runs.map(|value| serde_json::from_str(&value))
                    .transpose()?
                    .unwrap_or_default(),
            )
        }
        // Identifiers are closed above. Titles stay current, statuses stay frozen per occurrence.
        kind => (
            connection
                .query_row(
                    &format!("SELECT title FROM {kind} WHERE id=?1"),
                    [&id],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or_default(),
            Vec::new(),
        ),
    };
    Ok(Some(NotificationSubject {
        kind: occurrence.source_type.clone(),
        id,
        title,
        status,
        source_message_id: occurrence.source_message_id.clone(),
        source_agent_run_id: occurrence.agent_run_id.clone(),
        related_run_ids,
    }))
}

// Preferences affect only transient presentation. Both immutable facts and exact acknowledgements remain.
pub(super) fn superseded_heads_up(
    connection: &rusqlite::Connection,
    occurrence: &RawOccurrence,
) -> Result<bool> {
    if occurrence.semantic == NotificationSemantic::UserMention {
        return Ok(connection.query_row(
            "SELECT p.mission_needs_you_heads_up_enabled AND EXISTS(
               SELECT 1 FROM notification_occurrence o JOIN notification_occurrence_disposition d ON d.occurrence_id=o.id
               WHERE o.semantic='mission_needs_you' AND o.source_message_id=?1 AND d.resolved_at IS NULL)
             FROM notification_preference p WHERE singleton=1", [&occurrence.source_message_id], |row| row.get(0))?);
    }
    if occurrence.semantic == NotificationSemantic::RoundCompleted {
        return Ok(connection.query_row(
            "SELECT p.mission_status_heads_up_enabled AND EXISTS(SELECT 1 FROM json_each(p.mission_statuses_json) WHERE value='completed')
              AND EXISTS(SELECT 1 FROM notification_occurrence o
                JOIN notification_round n ON n.id=(SELECT source_id FROM notification_occurrence WHERE id=?1)
                JOIN json_each(n.run_ids_json) r ON r.value=o.agent_run_id
                WHERE o.semantic='mission_status_changed' AND o.business_status='completed' AND o.camp_id=n.camp_id)
             FROM notification_preference p WHERE singleton=1", [&occurrence.id], |row| row.get(0))?);
    }
    Ok(false)
}
