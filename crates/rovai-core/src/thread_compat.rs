//! Public naming aliases. Persisted IDs, SQL names and frozen evidence stay unchanged.

use anyhow::{Result, bail};
use serde_json::Value;

/// Host dispatch and journal identities retain their established method names.
pub(crate) fn stored_host_method(method: &str) -> String {
    let method = method.replace("Thread", "Camp");
    if let Some(suffix) = method.strip_prefix("thread.") {
        format!("camp.{suffix}")
    } else if let Some(suffix) = method.strip_prefix("threads.") {
        format!("camps.{suffix}")
    } else {
        method
            .replace(".thread.", ".camp.")
            .replace(".threads", ".camps")
    }
}

pub(crate) fn public_host_method(method: &str) -> String {
    if let Some(suffix) = method.strip_prefix("camp.") {
        format!("thread.{suffix}")
    } else if let Some(suffix) = method.strip_prefix("camps.") {
        format!("threads.{suffix}")
    } else {
        method.to_string()
    }
}

pub(crate) fn deserialize_host_method<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    let method = <String as serde::Deserialize>::deserialize(deserializer)?;
    Ok(stored_host_method(&method))
}

pub fn canonical_operation(operation: &str) -> &str {
    match operation {
        "camp.list" => "thread.list",
        "camp.search" => "thread.search",
        "camp.read" => "thread.read",
        "camp.message.send" => "thread.message.send",
        _ => operation,
    }
}

pub(crate) fn stored_operation(operation: &str) -> &str {
    match operation {
        "thread.list" => "camp.list",
        "thread.search" => "camp.search",
        "thread.read" => "camp.read",
        "thread.message.send" => "camp.message.send",
        _ => operation,
    }
}

/// Only the fields owned by this operation are aliases. Unknown keys still fail schema checks.
pub fn normalize_builtin_input(operation: &str, mut input: Value) -> Result<Value> {
    match canonical_operation(operation) {
        "thread.search" => alias(&mut input, "campId", "threadId")?,
        "thread.read" => {
            alias(&mut input, "campId", "threadId")?;
            alias(&mut input, "thread", "replyChain")?;
        }
        "history.search" => alias(&mut input, "campIds", "threadIds")?,
        _ => {}
    }
    Ok(input)
}

pub fn canonical_flag<'a>(operation: &str, flag: &'a str) -> &'a str {
    match (canonical_operation(operation), flag) {
        ("thread.search" | "thread.read", "--camp-id") => "--thread-id",
        ("thread.read", "--thread") => "--reply-chain",
        ("history.search", "--camp-ids") => "--thread-ids",
        ("thread.message.send", "--to-principal") => "--to-user",
        _ => flag,
    }
}

/// Keep pre-rename retry identities; this is not a traversal of arbitrary tool data.
pub(crate) fn stored_builtin_input(operation: &str, input: &Value) -> Result<Value> {
    let mut input = normalize_builtin_input(operation, input.clone())?;
    match canonical_operation(operation) {
        "thread.search" => alias(&mut input, "threadId", "campId")?,
        "thread.read" => {
            alias(&mut input, "threadId", "campId")?;
            alias(&mut input, "replyChain", "thread")?;
        }
        "history.search" => alias(&mut input, "threadIds", "campIds")?,
        _ => {}
    }
    Ok(input)
}

pub(crate) fn alias(input: &mut Value, old: &str, new: &str) -> Result<()> {
    if let Some(object) = input.as_object_mut()
        && let Some(value) = object.remove(old)
    {
        if object.contains_key(new) {
            bail!("{old} and {new} cannot be supplied together");
        }
        object.insert(new.to_string(), value);
    }
    Ok(())
}

pub(crate) fn stored_command_payload(mut payload: Value) -> Result<Value> {
    for (new, old) in [
        ("threadId", "campId"),
        ("threadTurnId", "campTurnId"),
        ("replyToThreadMessageId", "replyToCampMessageId"),
        ("visibleThreadTurnIds", "visibleCampTurnIds"),
    ] {
        alias(&mut payload, new, old)?;
    }
    Ok(payload)
}

/// Project a domain command's owned result fields after its stored identity is checked.
/// Nested content, quotes and evidence are deliberately opaque.
pub(crate) fn project_command_result(command_type: &str, payload: &mut Value) -> Result<()> {
    for (old, new) in [
        ("campId", "threadId"),
        ("campTurnId", "threadTurnId"),
        ("campMessageId", "threadMessageId"),
        ("campCreated", "threadCreated"),
        ("replyToCampMessageId", "replyToThreadMessageId"),
    ] {
        alias(payload, old, new)?;
    }
    project_builtin_result(canonical_operation(command_type), payload)
}

pub(crate) fn project_builtin_result(operation: &str, result: &mut Value) -> Result<()> {
    fn scope(row: &mut Value) -> Result<()> {
        alias(row, "campId", "threadId")?;
        alias(row, "campTitle", "threadTitle")?;
        alias(row, "campTurnId", "threadTurnId")
    }
    scope(result)?;
    let messages = match operation {
        "thread.read" => Some("items"),
        "thread.search" | "history.search" => Some("results"),
        "single_chat.history" => Some("messages"),
        _ => None,
    };
    if let Some(messages) = messages
        .and_then(|key| result.get_mut(key))
        .and_then(Value::as_array_mut)
    {
        for message in messages {
            project_quote_scopes(message, false);
        }
    }
    match operation {
        "thread.list" => {
            alias(result, "camps", "threads")?;
            if let Some(rows) = result.get_mut("threads").and_then(Value::as_array_mut) {
                for row in rows {
                    scope(row)?;
                }
            }
        }
        "thread.read" => {
            alias(result, "threadRootMessageId", "replyChainRootMessageId")?;
            if result.get("mode").and_then(Value::as_str) == Some("thread") {
                result["mode"] = Value::String("reply_chain".into());
            }
        }
        "thread.search" | "history.search" => {
            if let Some(rows) = result.get_mut("results").and_then(Value::as_array_mut) {
                for row in rows {
                    scope(row)?;
                }
            }
        }
        "mission.list" => {
            if let Some(rows) = result.get_mut("missions").and_then(Value::as_array_mut) {
                for row in rows {
                    scope(row)?;
                }
            }
        }
        "automation.list" => {
            if let Some(rows) = result.get_mut("automations").and_then(Value::as_array_mut) {
                for row in rows {
                    if let Some(run) = row.get_mut("lastRun") {
                        scope(run)?;
                    }
                }
            }
        }
        "automation.get" | "automation.create" | "automation.update" | "automation.close" => {
            if let Some(run) = result.get_mut("lastRun") {
                scope(run)?;
            }
        }
        "automation.run" => {
            if let Some(row) = result.as_object_mut() {
                row.remove("conversationId");
            }
        }
        _ => {}
    }
    Ok(())
}

/// Model quote metadata is owned by Rovai; quoted text and capture snapshots are opaque.
pub(crate) fn project_quote_scopes(message: &mut Value, legacy: bool) {
    if let Some(quotes) = message.get_mut("quotes").and_then(Value::as_array_mut) {
        for quote in quotes {
            let Some(source) = quote.get_mut("source").and_then(Value::as_object_mut) else {
                continue;
            };
            let renamed = match (source.get("scope").and_then(Value::as_str), legacy) {
                (Some("current_conversation_messages"), false) => Some("current_messages"),
                (Some("camp_messages"), false) => Some("thread_messages"),
                (Some("current_messages"), true) => Some("current_conversation_messages"),
                (Some("thread_messages"), true) => Some("camp_messages"),
                _ => None,
            };
            if let Some(scope) = renamed {
                source.insert("scope".into(), Value::String(scope.to_string()));
            }
        }
    }
}
