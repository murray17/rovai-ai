//! User delivery routing. Message bodies remain owned by CampMessage.
use anyhow::Result;
use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserDeliveryMode {
    #[default]
    Start,
    Steer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveInputTarget {
    pub agent_run_id: String,
    pub execution_epoch: i64,
}

/// Adapters whose active-input transport is fenced to this Run/epoch.
pub fn supports_active_input(adapter: &str) -> bool {
    matches!(
        adapter,
        "codex-cli"
            | "claude-code-cli"
            | "pi"
            | "codebuddy-cli"
            | "qwen-code"
            | "minimax-code-cli"
            | "hermes-cli"
            | "grok-build"
            | "kiro-cli"
            | "zcode-app"
            | "trae-cn-cli"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SteerUnavailableReason {
    RuntimeUnsupported,
    ExecutionNotReady,
    ExecutionChanged,
    InputOutcomeUnknown,
    RuntimeIdentityUnknown,
    ProtocolIncompatible,
    VersionIncompatible,
    VersionUnverified,
}

#[derive(Debug, Clone, Default)]
pub struct ActiveInputAvailability {
    pub can_steer: bool,
    pub ready: bool,
    pub unavailable_reason: Option<SteerUnavailableReason>,
}

impl ActiveInputAvailability {
    fn unavailable(reason: SteerUnavailableReason) -> Self {
        Self {
            can_steer: false,
            ready: false,
            unavailable_reason: Some(reason),
        }
    }
}

/// This is a Steer ABI policy, never ordinary Runtime eligibility. The bounds
/// describe the currently implemented request/receipt/end protocol, not a claim
/// that every release in a range was tested. Unknown protocol families fail closed.
pub fn protocol_unavailable(
    adapter: &str,
    version: Option<&str>,
    protocol: &str,
) -> Option<SteerUnavailableReason> {
    use SteerUnavailableReason::*;
    if !supports_active_input(adapter) {
        return Some(RuntimeUnsupported);
    }
    let expected = match adapter {
        "codex-cli" => "codex-app-server-v2",
        "claude-code-cli" => "claude-code-print-v1",
        "pi" => "pi-jsonl-rpc-v1",
        "zcode-app" => "zcode-app-server-v1",
        _ => "acp-v1",
    };
    if protocol != expected {
        return Some(ProtocolIncompatible);
    }
    let Some((v, prerelease)) =
        version.and_then(crate::agent_runtime_adapter::parse_reported_runtime_version)
    else {
        return Some(RuntimeIdentityUnknown);
    };
    if prerelease {
        return Some(VersionUnverified);
    }
    let (minimum, major) = match adapter {
        "codex-cli" => ([0, 162, 1], 0),
        "claude-code-cli" => ([2, 1, 83], 2),
        "pi" => ([0, 99, 0], v[0].min(1)),
        "qwen-code" => ([0, 18, 4], 0),
        "minimax-code-cli" => ([0, 6, 12], 0),
        "hermes-cli" => ([0, 22, 4], v[0]),
        "grok-build" => ([1, 0, 14], 1),
        "kiro-cli" => ([2, 21, 1], 2),
        "zcode-app" => ([0, 16, 5], 0),
        "trae-cn-cli" => ([0, 207, 1], 0),
        // The unresolved 2.132.0 business outcome is not an established ABI break.
        // CodeBuddy uses a minimum-only version policy; observed release results
        // remain separate from this compatibility policy.
        "codebuddy-cli" => ([2, 109, 1], v[0]),
        _ => return Some(RuntimeUnsupported),
    };
    if v[0] != major {
        Some(VersionUnverified)
    } else if v < minimum {
        Some(VersionIncompatible)
    } else {
        None
    }
}

/// All callers use the target Run's frozen executable identity and protocol.
/// Neither member edits nor a replacement binary on disk can retarget a live Host.
pub fn active_input_availability(
    c: &Connection,
    run_id: &str,
    epoch: i64,
) -> Result<ActiveInputAvailability> {
    use SteerUnavailableReason::*;
    use rusqlite::OptionalExtension;
    let row=c.query_row("SELECT r.runtime_adapter_kind,r.runtime_reported_version,r.runtime_protocol_version,
        r.runtime_executable_fingerprint,r.runtime_installation_id,r.runtime_installation_generation,
        r.runtime_executable_path,r.execution_epoch,r.status,r.cancel_requested_at,r.invocation_kind,
        r.runtime_binding_compatibility_digest,
        EXISTS(SELECT 1 FROM runtime_input_delivery i WHERE i.agent_run_id=r.id AND i.execution_epoch=r.execution_epoch
            AND i.input_kind='start' AND i.status='accepted' AND i.native_binding_id=c.native_binding_id
            AND i.native_binding_generation=c.native_binding_generation),
        EXISTS(SELECT 1 FROM runtime_input_delivery i WHERE i.agent_run_id=r.id AND i.execution_epoch=r.execution_epoch AND i.status='delivery_unknown')
        FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE r.id=?1", [run_id], |r|Ok((
            r.get::<_,Option<String>>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?,
            r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<i64>>(5)?,
            r.get::<_,Option<String>>(6)?,r.get::<_,i64>(7)?,r.get::<_,String>(8)?,r.get::<_,Option<String>>(9)?,
            r.get::<_,String>(10)?,r.get::<_,Option<String>>(11)?,r.get::<_,bool>(12)?,r.get::<_,bool>(13)?
        ))).optional()?;
    let Some((
        adapter,
        version,
        protocol,
        fingerprint,
        installation,
        generation,
        path,
        actual_epoch,
        status,
        cancel,
        kind,
        binding,
        accepted,
        unknown,
    )) = row
    else {
        return Ok(ActiveInputAvailability::unavailable(ExecutionChanged));
    };
    let reason = if actual_epoch != epoch {
        Some(ExecutionChanged)
    } else if kind != "batch"
        || !matches!(status.as_str(), "queued" | "running" | "waiting")
        || cancel.is_some()
    {
        Some(ExecutionNotReady)
    } else if unknown {
        Some(InputOutcomeUnknown)
    } else if [&fingerprint, &installation, &path, &binding]
        .iter()
        .any(|v| v.as_deref().is_none_or(|s| s.trim().is_empty()))
        || generation.is_none_or(|g| g <= 0)
    {
        Some(RuntimeIdentityUnknown)
    } else {
        protocol_unavailable(
            adapter.as_deref().unwrap_or(""),
            version.as_deref(),
            protocol.as_deref().unwrap_or(""),
        )
    };
    Ok(ActiveInputAvailability {
        can_steer: reason.is_none(),
        ready: reason.is_none() && accepted && status != "queued",
        unavailable_reason: reason,
    })
}

/// Proof that this source was not written, or was removed from an unconsumed
/// native queue. Transport failures must never be converted to this error.
#[derive(Debug)]
pub struct ActiveInputNotAccepted;

impl std::fmt::Display for ActiveInputNotAccepted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("The target execution no longer accepts this input")
    }
}
impl std::error::Error for ActiveInputNotAccepted {}

pub(crate) fn route_user_message(
    tx: &Transaction<'_>,
    message_id: &str,
    expected_targets: Option<&[ActiveInputTarget]>,
) -> Result<()> {
    // Admission captures the intended execution; later preparation may not retarget it.
    let targets = {
        let mut query = tx.prepare("SELECT d.id,r.id,r.runtime_adapter_kind,r.execution_epoch FROM camp_message_delivery d
            JOIN camp_message m ON m.id=d.message_id
            JOIN conversation c ON c.agent_id=d.recipient_agent_id
            JOIN agent_run r ON r.camp_id=d.camp_id AND r.conversation_id=c.id
            WHERE m.id=?1 AND m.author_type='user' AND d.status='waiting'
              AND r.invocation_kind='batch' AND r.status IN ('queued','running','waiting') AND r.cancel_requested_at IS NULL")?;
        query
            .query_map([message_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (delivery, run, adapter, epoch) in targets {
        if supports_active_input(&adapter)
            && active_input_availability(tx, &run, epoch)?.can_steer
            && expected_targets.is_none_or(|targets| {
                targets
                    .iter()
                    .any(|t| t.agent_run_id == run && t.execution_epoch == epoch)
            })
        {
            tx.execute(
                "UPDATE camp_message_delivery SET requested_mode='steer',status='claimed',
                claimed_agent_run_id=?2,target_execution_epoch=?3 + CASE
                  WHEN (SELECT status FROM agent_run WHERE id=?2)='queued' THEN 1 ELSE 0 END,
                claimed_at=updated_at,version=version+1 WHERE id=?1 AND status='waiting'",
                params![delivery, run, epoch],
            )?;
            crate::execution_input::record(tx, &delivery)?;
            tx.execute(
                "UPDATE camp_message SET recall_state='closed',version=version+1
                WHERE id=?1 AND recall_state='recallable'",
                [message_id],
            )?;
        }
    }
    Ok(())
}

#[derive(Debug)]
pub struct PendingInput {
    pub delivery_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
}

/// One source per execution, in existing Delivery order. Ambiguity fences later inputs.
pub fn pending_inputs(connection: &Connection) -> Result<Vec<PendingInput>> {
    let mut query = connection.prepare("SELECT d.id,r.id,r.execution_epoch FROM camp_message_delivery d
        JOIN agent_run r ON r.id=d.claimed_agent_run_id
        WHERE d.requested_mode='steer' AND d.status='claimed' AND r.status IN ('running','waiting')
          AND r.cancel_requested_at IS NULL AND d.target_execution_epoch=r.execution_epoch
          AND EXISTS(SELECT 1 FROM runtime_input_delivery initial JOIN conversation c ON c.id=r.conversation_id
              WHERE initial.agent_run_id=r.id AND initial.execution_epoch=r.execution_epoch AND initial.input_kind='start'
                AND initial.status='accepted' AND initial.native_binding_id=c.native_binding_id
                AND initial.native_binding_generation=c.native_binding_generation)
          AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id
              WHERE m.source_delivery_id=d.id AND (i.status<>'prepared' OR i.dispatch_started_at IS NOT NULL))
          AND NOT EXISTS(SELECT 1 FROM camp_message_delivery earlier
              WHERE earlier.claimed_agent_run_id=r.id AND earlier.requested_mode='steer'
                AND earlier.status='claimed' AND earlier.queue_sequence<d.queue_sequence)
        ORDER BY d.queue_sequence,d.id")?;
    Ok(query
        .query_map([], |r| {
            Ok(PendingInput {
                delivery_id: r.get(0)?,
                agent_run_id: r.get(1)?,
                execution_epoch: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Preparation failures update the source receipt and its existing execution marker atomically.
pub fn fail_preparation(tx: &Transaction<'_>, delivery: &str) -> Result<()> {
    let changed = tx.execute("UPDATE camp_message_delivery SET status='failed',failure_code='input_preparation_failed',ended_at=datetime('now'),updated_at=datetime('now'),version=version+1 WHERE id=?1 AND status='claimed' AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id WHERE m.source_delivery_id=?1 AND i.dispatch_started_at IS NOT NULL)", [delivery])?;
    if changed == 1 {
        crate::execution_input::changed(tx, delivery)?;
    }
    Ok(())
}

/// Called only with proof that native submission did not accept this input.
pub fn return_to_queue(tx: &Transaction<'_>, delivery_id: &str, now: &str) -> Result<()> {
    let updated = tx.execute("UPDATE camp_message_delivery SET requested_mode='start',status='waiting',claimed_agent_run_id=NULL,target_execution_epoch=NULL,
        claimed_at=NULL,ended_at=NULL,failure_code=NULL,updated_at=?2,version=version+1
        WHERE id=?1 AND requested_mode='steer' AND (status='claimed' OR (status='failed' AND failure_code='input_delivery_unknown'))
          AND EXISTS(SELECT 1 FROM agent_run r WHERE r.id=claimed_agent_run_id AND r.cancel_requested_at IS NULL AND r.status IN ('running','waiting','succeeded'))
          AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id
              WHERE m.source_delivery_id=?1 AND (i.status IN ('accepted','delivery_unknown')
                  OR (i.status='prepared' AND i.dispatch_started_at IS NOT NULL)))", params![delivery_id,now])?;
    if updated == 1 {
        crate::execution_input::changed(tx, delivery_id)?;
    }
    Ok(())
}

pub(crate) fn settle_execution(
    tx: &Transaction<'_>,
    run_id: &str,
    run_status: &str,
    now: &str,
) -> Result<()> {
    // Only unfinished receipts whose presentation actually changes at settlement.
    // Accepted/unknown inputs retain their receipt regardless of the Run outcome.
    let changed_sources = {
        let mut query = tx.prepare("SELECT d.id FROM camp_message_delivery d
            LEFT JOIN context_manifest m ON m.source_delivery_id=d.id
            LEFT JOIN runtime_input_delivery i ON i.context_manifest_id=m.id AND i.input_kind='steer'
            WHERE d.claimed_agent_run_id=?1 AND d.requested_mode='steer' AND d.status='claimed'
              AND (i.id IS NULL OR i.status='prepared' OR (?2='succeeded' AND i.status='not_accepted'))")?;
        query
            .query_map(params![run_id, run_status], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    // Prepared-but-unsent sources survive ordinary Run success. Dispatch-started sources never replay.
    tx.execute("UPDATE runtime_input_delivery SET status='not_accepted',resolved_at=?2,updated_at=?2
        WHERE agent_run_id=?1 AND input_kind='steer' AND status='prepared' AND dispatch_started_at IS NULL", params![run_id,now])?;
    if run_status == "succeeded" {
        tx.execute("UPDATE camp_message_delivery SET requested_mode='start',status='waiting',claimed_agent_run_id=NULL,target_execution_epoch=NULL,
        claimed_at=NULL,ended_at=NULL,updated_at=?2,version=version+1
        WHERE claimed_agent_run_id=?1 AND requested_mode='steer' AND status='claimed'
          AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id
              WHERE m.source_delivery_id=camp_message_delivery.id AND i.status IN ('prepared','accepted','delivery_unknown'))", params![run_id,now])?;
    }
    tx.execute("UPDATE runtime_input_delivery SET status='delivery_unknown',updated_at=?2
        WHERE agent_run_id=?1 AND input_kind='steer' AND status='prepared' AND dispatch_started_at IS NOT NULL", params![run_id,now])?;
    tx.execute("UPDATE camp_message_delivery SET status='failed',failure_code='input_delivery_unknown',ended_at=?2,updated_at=?2,version=version+1
        WHERE claimed_agent_run_id=?1 AND requested_mode='steer' AND status='claimed'
          AND EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id
              WHERE m.source_delivery_id=camp_message_delivery.id AND i.status='delivery_unknown')", params![run_id,now])?;
    for source in changed_sources {
        crate::execution_input::changed(tx, &source)?;
    }
    Ok(())
}
