use std::collections::BTreeMap;

use anyhow::Result;
use rusqlite::Transaction;
use serde::Serialize;
use serde_json::Value;

/// Display metadata from the message's source Run, never the current profile.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMessageRuntimeModelView {
    pub adapter_kind: String,
    pub model_id: Option<String>,
    pub reasoning_effort: Option<String>,
}

pub(super) fn load_message_models(
    transaction: &Transaction<'_>,
    requested_message_ids_json: &str,
) -> Result<BTreeMap<String, ThreadMessageRuntimeModelView>> {
    // Start from this message window's IDs. A historical message need not have
    // its Run in CampOpen's independent bounded execution window.
    let mut statement = transaction.prepare(
        r#"
        WITH requested AS (SELECT CAST(value AS TEXT) AS id FROM json_each(?1))
        SELECT message.id, run.runtime_adapter_kind,
               run.runtime_model_selection_json, run.runtime_observed_model_id
        FROM requested
        JOIN camp_message AS message ON message.id = requested.id
        JOIN agent_run AS run ON run.id = message.source_agent_run_id
        LEFT JOIN camp_turn AS turn ON turn.id = run.camp_turn_id
        JOIN conversation ON conversation.id = run.conversation_id
                         AND conversation.agent_id = message.author_id
        WHERE message.author_type = 'agent'
          AND COALESCE(run.camp_id, turn.camp_id) = message.camp_id
        "#,
    )?;
    let rows = statement.query_map([requested_message_ids_json], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut models = BTreeMap::new();
    for row in rows {
        let (message_id, adapter, selection, observed) = row?;
        if let Some(model) = project_model(adapter.as_deref(), selection.as_deref(), observed) {
            models.insert(message_id, model);
        }
    }
    Ok(models)
}

fn project_model(
    adapter_kind: Option<&str>,
    selection: Option<&str>,
    observed_model: Option<String>,
) -> Option<ThreadMessageRuntimeModelView> {
    let adapter_kind = adapter_kind.filter(|value| !value.trim().is_empty())?;
    let selection: Value = serde_json::from_str(selection?).ok()?;
    let model_id = match selection.get("source")?.as_str()? {
        "explicit" => Some(
            selection
                .get("modelId")?
                .as_str()
                .filter(|value| !value.trim().is_empty())?
                .to_string(),
        ),
        "runtime_default" => observed_model.filter(|value| !value.trim().is_empty()),
        _ => return None,
    };
    let effort_key = if adapter_kind == "claude-code-cli" {
        "effort"
    } else {
        "reasoning_effort"
    };
    // Project only the display option, never permissions, provider credentials
    // or other fields from the frozen configuration.
    let reasoning_effort = selection
        .get("options")
        .and_then(|options| options.get(effort_key))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned);
    Some(ThreadMessageRuntimeModelView {
        adapter_kind: adapter_kind.to_string(),
        model_id,
        reasoning_effort,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_metadata_uses_frozen_options_and_default_only_observation() {
        for (adapter, selection, observed, model, effort) in [
            (
                "codex-cli",
                json!({"source":"explicit","modelId":"old-model","options":{"reasoning_effort":"high","api_key":"never-project"}}),
                Some("ignore-observation"),
                Some("old-model"),
                Some("high"),
            ),
            (
                "claude-code-cli",
                json!({"source":"explicit","modelId":"claude-model","options":{"effort":"max","reasoning_effort":"wrong-option"}}),
                None,
                Some("claude-model"),
                Some("max"),
            ),
            (
                "codex-cli",
                json!({"source":"runtime_default","modelId":"not-an-observation","options":{}}),
                None,
                None,
                None,
            ),
            (
                "codex-cli",
                json!({"source":"runtime_default"}),
                Some("observed-model"),
                Some("observed-model"),
                None,
            ),
            (
                "codex-cli",
                json!({"source":"explicit","modelId":"old-model","options":{"reasoning_effort":7}}),
                None,
                Some("old-model"),
                None,
            ),
        ] {
            let projected = project_model(
                Some(adapter),
                Some(&selection.to_string()),
                observed.map(str::to_owned),
            )
            .unwrap();
            assert_eq!(
                serde_json::to_value(projected).unwrap(),
                json!({
                    "adapterKind":adapter,"modelId":model,"reasoningEffort":effort
                })
            );
        }
        for selection in [
            None,
            Some("{invalid"),
            Some("{}"),
            Some(r#"{"source":"explicit"}"#),
            Some(r#"{"source":"legacy","modelId":"unknown"}"#),
        ] {
            assert!(project_model(Some("codex-cli"), selection, None).is_none());
        }
        assert!(project_model(None, Some(r#"{"source":"runtime_default"}"#), None).is_none());
    }
}
