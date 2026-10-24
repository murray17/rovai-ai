//! Hermes-only user-layer envelope. Acceptance remains owned by the input ledger.
use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HermesRulesEvidence {
    pub digest: String,
    pub kind: String,
    pub payload_blob_id: String,
}

pub(super) fn envelope(kind: &str, bootstrap: &str) -> String {
    let (label, introduction) = match kind {
        "initial" => ("Rovai 协作规则", ""),
        "update" => (
            "Rovai 协作规则更新",
            "以下规则替换此前的 Rovai 协作规则，继续当前会话与任务。\n\n",
        ),
        "compaction_recovery" => (
            "Rovai 协作规则恢复",
            "原生上下文压缩后，重新提供当前协作规则，继续当前会话与任务。\n\n",
        ),
        _ => unreachable!("unknown Hermes rules envelope"),
    };
    format!("[{label}]\n{introduction}{bootstrap}\n[/{label}]")
}

pub(super) fn select(
    database: &Database,
    snapshot: &RunSnapshot,
    bootstrap: &str,
    redelivery: Option<i64>,
) -> Result<(Option<String>, HermesRulesEvidence)> {
    let binding = snapshot
        .native_binding_id
        .as_deref()
        .context("Hermes input requires a Binding")?;
    let previous: Option<String> = database
        .connection()
        .query_row(
            "SELECT hermes_rules_digest FROM runtime_input_delivery
         WHERE native_binding_id=?1 AND native_binding_generation=?2
           AND status='accepted' AND hermes_rules_envelope_version=1
           AND hermes_rules_delivery_kind IN ('initial','update','compaction_recovery')
         ORDER BY rowid DESC LIMIT 1",
            params![binding, snapshot.native_binding_generation],
            |r| r.get(0),
        )
        .optional()?;
    let digest = sha256_text(bootstrap);
    let kind = match previous.as_deref() {
        Some(previous) if previous != digest => "update",
        Some(_) if redelivery.is_some() => "compaction_recovery",
        Some(_) => "none",
        None => {
            let accepted: bool = database.connection().query_row(
                "SELECT EXISTS(SELECT 1 FROM runtime_input_delivery WHERE native_binding_id=?1
                 AND native_binding_generation=?2 AND status='accepted')",
                params![binding, snapshot.native_binding_generation],
                |r| r.get(0),
            )?;
            if accepted { "update" } else { "initial" }
        }
    };
    Ok((
        (kind != "none").then(|| envelope(kind, bootstrap)),
        HermesRulesEvidence {
            digest,
            kind: kind.into(),
            payload_blob_id: String::new(),
        },
    ))
}

pub(super) fn frozen(database: &Database, manifest: &str) -> Result<Option<HermesRulesEvidence>> {
    database
        .connection()
        .query_row(
            "SELECT hermes_rules_digest,hermes_rules_delivery_kind,hermes_runtime_payload_blob_id
         FROM runtime_input_delivery WHERE context_manifest_id=?1
           AND hermes_rules_envelope_version=1 ORDER BY rowid DESC LIMIT 1",
            [manifest],
            |r| {
                Ok(HermesRulesEvidence {
                    digest: r.get(0)?,
                    kind: r.get(1)?,
                    payload_blob_id: r.get(2)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub(super) fn persist(
    tx: &Transaction<'_>,
    delivery: &str,
    evidence: Option<&HermesRulesEvidence>,
) -> Result<()> {
    if let Some(evidence) = evidence {
        anyhow::ensure!(
            !evidence.payload_blob_id.is_empty(),
            "Hermes input bytes were not frozen"
        );
        tx.execute(
            "UPDATE runtime_input_delivery SET hermes_rules_envelope_version=1,
            hermes_rules_digest=?2,hermes_rules_delivery_kind=?3,hermes_runtime_payload_blob_id=?4
            WHERE id=?1",
            params![
                delivery,
                evidence.digest,
                evidence.kind,
                evidence.payload_blob_id
            ],
        )?;
    }
    Ok(())
}
