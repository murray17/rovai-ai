//! Batch the display proof over the already selected canonical metadata. Modern single-row
//! carriers inspect only adjacent Core candidates, never one Run-wide SQL scan per command.
use super::*;
use std::collections::{BTreeMap, HashMap};

pub(super) fn carrier_targets(
    connection: &Connection,
    metadata: &[AgentRunExecutionEvidenceView],
) -> Result<HashMap<String, String>> {
    let mut core_by_operation: HashMap<
        (i64, String),
        BTreeMap<i64, Vec<&AgentRunExecutionEvidenceView>>,
    > = HashMap::new();
    for item in metadata {
        let Some(canonical) = &item.canonical else {
            continue;
        };
        let Some(operation) = item.payload["canonicalTool"].as_str() else {
            continue;
        };
        if canonical.source_authority != "core"
            || canonical.credibility != "core_verified"
            || item.payload["sourceAuthority"] != "core"
            || item.payload["coreEnvelope"]["ok"] != 1
            || item.payload["coreEnvelope"]["operation"] != operation
        {
            continue;
        }
        core_by_operation
            .entry((
                item.execution_epoch,
                crate::thread_compat::canonical_operation(operation).into(),
            ))
            .or_default()
            .entry(canonical.first_evidence_sequence)
            .or_default()
            .push(item);
    }
    let mut targets = HashMap::new();
    let mut historical_payloads = HashMap::new();
    for shell in metadata {
        let Some(canonical) = shell
            .canonical
            .as_ref()
            .filter(|value| value.activity_domain == "shell" && value.outcome == "succeeded")
        else {
            continue;
        };
        let Some(operation) = super::carrier::pure_builtin_operation(
            super::blocks::public_command(&shell.payload).unwrap_or(""),
        ) else {
            continue;
        };
        let Some(cores) = core_by_operation.get(&(shell.execution_epoch, operation)) else {
            continue;
        };
        let first = canonical.first_evidence_sequence;
        let last = canonical.last_evidence_sequence;
        if first <= 0 || last < first {
            continue;
        }
        let single = first == last;
        if !single && last - first <= 1 {
            continue;
        }
        let range = if single {
            first.saturating_sub(1)..=first.saturating_add(1)
        } else {
            first.saturating_add(1)..=last.saturating_sub(1)
        };
        let digest = shell.payload["resultDigest"]
            .as_str()
            .filter(|value| !value.is_empty());
        let mut matched = Vec::new();
        for core in cores.range(range).flat_map(|(_, items)| items) {
            let authority = core.canonical.as_ref().unwrap();
            let adjacent = authority.first_evidence_sequence == authority.last_evidence_sequence
                && (authority.first_evidence_sequence - first).abs() == 1;
            if (single && !adjacent) || (!single && authority.last_evidence_sequence >= last) {
                continue;
            }
            let exact = if let Some(digest) = digest {
                core.payload["agentOutputDigest"].as_str() == Some(digest)
            } else {
                // Historical evidence has no digest. Preserve v42 exact-result compatibility,
                // reading only temporal candidates and caching each payload once per request.
                let shell_payload =
                    historical_payload(connection, &mut historical_payloads, &shell.id)?;
                let output = shell_payload
                    .get("output")
                    .or_else(|| shell_payload.pointer("/item/aggregatedOutput"))
                    .or_else(|| shell_payload.pointer("/item/output"));
                let decoded = output
                    .and_then(|value| {
                        value
                            .as_str()
                            .and_then(|text| serde_json::from_str::<Value>(text.trim()).ok())
                            .or_else(|| Some(value.clone()))
                    })
                    .filter(|value| value.as_object().is_some_and(|object| !object.is_empty()));
                if decoded.is_none() {
                    break;
                }
                let core_payload =
                    historical_payload(connection, &mut historical_payloads, &core.id)?;
                super::historical_builtin_cli_result(
                    core_payload["canonicalTool"].as_str().unwrap_or(""),
                    &core_payload["coreEnvelope"]["result"],
                ) == decoded
            };
            if exact {
                matched.push(authority.operation_id.clone());
                if matched.len() > 1 {
                    break;
                }
            }
        }
        if let [target] = matched.as_slice() {
            targets.insert(shell.id.clone(), target.clone());
        }
    }
    Ok(targets)
}

fn historical_payload<'a>(
    connection: &Connection,
    cache: &'a mut HashMap<String, Value>,
    id: &str,
) -> Result<&'a Value> {
    if !cache.contains_key(id) {
        let raw: String = connection.query_row(
            "SELECT payload_preview_json FROM agent_run_execution_evidence WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        cache.insert(id.into(), serde_json::from_str(&raw)?);
    }
    Ok(cache.get(id).unwrap())
}
