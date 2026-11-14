//! Official Goose ACP vocabulary and projections; lifecycle stays in ACP/Fleet.
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use crate::agent_profile::{
    ModelDescriptor, PermissionOptionDescriptor, RuntimeOptionScope, ValueChoice,
};

pub(crate) const BOOTSTRAP_KEY: &str = "rovai-session-bootstrap";
pub(crate) const ASSIGNED_MCP_PREFIX: &str = "rovai_assigned_";

pub(crate) fn usage_snapshot(previous: Option<&Value>, incoming: &Value) -> Value {
    let mut snapshot = incoming.clone();
    // Sparse native updates do not reset a known cumulative cost. This cache
    // is only the next dispatch baseline; live missing cost stays unobserved.
    if snapshot["update"]["accumulatedCost"].is_null()
        && let Some(cost) = previous
            .and_then(|value| value.pointer("/update/accumulatedCost"))
            .filter(|cost| !cost.is_null())
    {
        snapshot["update"]["accumulatedCost"] = cost.clone();
    }
    snapshot
}

pub(crate) fn is_metadata(message: &Value) -> bool {
    message.get("id").is_none()
        && matches!(
            message["method"].as_str(),
            Some("session/update" | "_goose/unstable/session/update")
        )
        && matches!(
            message["params"]["update"]["sessionUpdate"].as_str(),
            Some("usage_update" | "message_usage" | "session_info_update" | "status_message")
        )
}

pub(crate) fn project_tool(message: &mut Value) {
    if message["method"] != "session/update" {
        return;
    }
    let update = &mut message["params"]["update"];
    let Some(name) = update
        .pointer("/_meta/goose/toolCall/toolName")
        .and_then(Value::as_str)
    else {
        return;
    };
    let kind = match name {
        "write" | "edit" => "edit",
        "shell" => "execute",
        "read_image" => "read",
        _ => "other",
    };
    update["kind"] = json!(kind);
}

pub(crate) fn usage(method: &str, params: &Value) -> Vec<crate::monitoring::ParsedRuntimeUsage> {
    use crate::monitoring::{
        ParsedRuntimeUsage, RuntimeInputSemantics, RuntimeUsageCounterMode, RuntimeUsageFields,
    };
    if method != "_goose/unstable/session/update" {
        return Vec::new();
    }
    let update = &params["update"];
    let integer = |value: &Value| value.as_i64().filter(|n| *n >= 0);
    let cumulative = update["sessionUpdate"] == "usage_update";
    let cache = update["sessionUpdate"] == "message_usage";
    if !cumulative && !cache {
        return Vec::new();
    }
    if cache && update["messageId"].as_str().is_none_or(str::is_empty) {
        return Vec::new();
    }
    let fields = if cumulative {
        RuntimeUsageFields {
            input_tokens: integer(&update["accumulatedInputTokens"]),
            output_tokens: integer(&update["accumulatedOutputTokens"]),
            ..Default::default()
        }
    } else {
        RuntimeUsageFields {
            cache_read_input_tokens: integer(&update["usage"]["cacheReadTokens"]),
            cache_write_input_tokens: integer(&update["usage"]["cacheWriteTokens"]),
            ..Default::default()
        }
    };
    // Totals own input/output/cost including compaction. Per-message events only
    // supply cache subsets; adding their totals would bill every call twice.
    let amount = cumulative
        .then(|| update["accumulatedCost"].as_f64())
        .flatten()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .map(|n| json!(n.to_string()));
    let cost =
        crate::monitoring::cost_from_value(amount.as_ref(), "USD", "runtime_estimate", "session");
    let observation = ParsedRuntimeUsage {
        identity_suffix: if cumulative {
            "totals".into()
        } else {
            format!(
                "cache:{}",
                update["messageId"]
                    .as_str()
                    .expect("checked message identity")
            )
        },
        dialect_id: if cumulative {
            "goose-acp-session-totals-v1".into()
        } else {
            "goose-acp-message-cache-v1".into()
        },
        source: "runtime_private_extension".into(),
        scope: if cumulative {
            "session".into()
        } else {
            "model_call".into()
        },
        counter_mode: if cumulative {
            RuntimeUsageCounterMode::Cumulative
        } else {
            RuntimeUsageCounterMode::Delta
        },
        input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
        native_session_id: params["sessionId"].as_str().map(str::to_owned),
        native_turn_id: None,
        fields,
        cost: None,
        context_model_id: None,
        occurred_at: None,
    };
    // Missing cost on a token update must not erase the preceding cost baseline.
    // The shared buffer groups sparse fields independently, so give native cost
    // its own cumulative checkpoint and emit it only when actually reported.
    let mut observations = vec![observation];
    if cumulative
        && (integer(&update["used"]).is_some() || integer(&update["contextLimit"]).is_some())
    {
        let mut context = observations[0].clone();
        context.identity_suffix = "context".into();
        context.dialect_id = "goose-acp-context-v1".into();
        context.counter_mode = RuntimeUsageCounterMode::Gauge;
        context.fields = RuntimeUsageFields {
            context_used_tokens: integer(&update["used"]),
            context_size_tokens: integer(&update["contextLimit"]),
            ..Default::default()
        };
        observations.push(context);
    }
    if let Some(cost) = cost {
        let mut observation = observations[0].clone();
        observation.identity_suffix = "cost".into();
        observation.dialect_id = "goose-acp-session-cost-v1".into();
        observation.fields = RuntimeUsageFields::default();
        observation.cost = Some(cost);
        observations.push(observation);
    }
    observations
}

pub(crate) fn permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "mode".into(),
        label: "mode".into(),
        description: "Goose native execution mode".into(),
        value_type: "enum".into(),
        choices: ["auto", "approve", "smart_approve"]
            .into_iter()
            .map(|value| ValueChoice {
                value: value.into(),
                label: value.into(),
            })
            .collect(),
        recommended_value: json!("auto"),
        scope: RuntimeOptionScope::Session,
        risk: "elevated".into(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

pub(crate) fn model_route(id: &str) -> Result<(&str, &str)> {
    let (provider, model) = id
        .split_once('/')
        .context("Goose model requires its native provider route")?;
    ensure!(
        !provider.is_empty() && !model.is_empty(),
        "Goose model route is empty"
    );
    Ok((provider, model))
}

pub(crate) fn selected_option<'a>(session: &'a Value, id: &str) -> Option<&'a str> {
    session["configOptions"]
        .as_array()?
        .iter()
        .find(|option| option["id"] == id)?["currentValue"]
        .as_str()
}

pub(crate) fn current_model(session: &Value) -> Option<String> {
    Some(format!(
        "{}/{}",
        selected_option(session, "provider")?,
        selected_option(session, "model")?
    ))
}

pub(crate) fn model_catalog(inventory: &Value, session: &Value) -> Result<Vec<ModelDescriptor>> {
    let selected = current_model(session).or_else(|| {
        let defaults = session.pointer("/_meta/rovaiGooseDefaults")?;
        Some(format!(
            "{}/{}",
            defaults["providerId"].as_str()?,
            defaults["modelId"].as_str()?
        ))
    });
    let mut models = Vec::new();
    for provider in inventory["entries"]
        .as_array()
        .context("Goose provider inventory missing")?
    {
        if provider["configured"] != true || provider["available"] != true {
            continue;
        }
        let provider_id = provider["providerId"]
            .as_str()
            .context("Goose provider identity missing")?;
        for model in provider["models"]
            .as_array()
            .context("Goose models missing")?
        {
            let native_id = model["id"]
                .as_str()
                .context("Goose model identity missing")?;
            let id = format!("{provider_id}/{native_id}");
            model_route(&id)?;
            models.push(ModelDescriptor {
                is_default: selected.as_deref() == Some(id.as_str()), id,
                display_name: model["name"].as_str().unwrap_or(native_id).into(),
                description: Some(provider["providerName"].as_str().unwrap_or(provider_id).into()),
                runtime_metadata: Some(json!({"providerId":provider_id,"id":native_id,"reasoning":model.get("reasoning")})),
                hidden:false, deprecated:false, options:Vec::new(),
            });
        }
    }
    ensure!(
        !models.is_empty(),
        "Goose reported no configured available models"
    );
    Ok(crate::agent_runtime_adapter::normalize_model_catalog(
        models,
    ))
}
