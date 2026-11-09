//! Authenticated, input-scoped Feishu communication tools. The Host owns network I/O.
use crate::{db::Database, team_tool::AuthenticatedTeamToolRun};
use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const TABLES: &[(&str, &str)] = &[
    (
        "channel_chat_input",
        "inbound_id,camp_message_id,camp_id,report_item_id,reply_outbound_id",
    ),
    (
        "channel_chat_tool_request",
        "id,agent_run_id,execution_epoch,request_id,operation,input_digest,provider,app_id,input_id,query,result_json,outbound_id,item_id,lease_owner,lease_token,lease_expires_at,created_at",
    ),
    (
        "channel_chat_target_grant",
        "target_ref,agent_run_id,execution_epoch,input_id,provider,app_id,external_id,name,department",
    ),
];

pub fn migrate(database: &mut Database) -> Result<()> {
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute_batch(r#"
        ALTER TABLE channel_chat_message ADD COLUMN mentions_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE channel_chat_outbound ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'chat_id' CHECK(target_kind IN ('chat_id','open_id'));
        ALTER TABLE channel_chat_outbound ADD COLUMN lease_token TEXT;
        ALTER TABLE channel_chat_outbound ADD COLUMN item_id TEXT REFERENCES channel_chat_item(id);
        ALTER TABLE channel_chat_outbound ADD COLUMN source_run_id TEXT REFERENCES agent_run(id);
        ALTER TABLE channel_chat_outbound ADD COLUMN source_execution_epoch INTEGER;
        CREATE TABLE channel_chat_input (
            inbound_id TEXT PRIMARY KEY REFERENCES channel_chat_message(id),
            camp_message_id TEXT NOT NULL UNIQUE REFERENCES camp_message(id),
            camp_id TEXT NOT NULL REFERENCES camp(id),
            report_item_id TEXT REFERENCES channel_chat_item(id),
            reply_outbound_id TEXT REFERENCES channel_chat_outbound(id)
        );
        CREATE TABLE channel_chat_tool_request (
            id TEXT PRIMARY KEY,
            agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
            execution_epoch INTEGER NOT NULL,
            request_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            input_digest TEXT NOT NULL,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            input_id TEXT REFERENCES channel_chat_message(id),
            query TEXT,
            result_json TEXT NOT NULL,
            outbound_id TEXT REFERENCES channel_chat_outbound(id),
            item_id TEXT REFERENCES channel_chat_item(id),
            lease_owner TEXT,
            lease_token TEXT,
            lease_expires_at INTEGER,
            created_at INTEGER NOT NULL,
            UNIQUE(agent_run_id,execution_epoch,request_id),
            UNIQUE(agent_run_id,execution_epoch,input_id,operation,input_digest)
        );
        CREATE TABLE channel_chat_target_grant (
            target_ref TEXT PRIMARY KEY,
            agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
            execution_epoch INTEGER NOT NULL,
            input_id TEXT NOT NULL REFERENCES channel_chat_message(id),
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            external_id TEXT NOT NULL,
            name TEXT NOT NULL,
            department TEXT,
            UNIQUE(agent_run_id,execution_epoch,input_id,external_id)
        );
        INSERT INTO schema_migration VALUES(225,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=175,updated_at=datetime('now') WHERE singleton=1;
    "#)?;
    anyhow::ensure!(schema_matches(&tx)?, "chat tool migration layout mismatch");
    tx.commit()?;
    Ok(())
}

pub fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    for (table, columns) in TABLES {
        let mut stmt = c.prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")?;
        let names = stmt
            .query_map([table], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if names.join(",") != *columns {
            return Ok(false);
        }
    }
    for (table, columns) in [
        ("channel_chat_message", "mentions_json"),
        (
            "channel_chat_outbound",
            "target_kind,lease_token,item_id,source_run_id,source_execution_epoch",
        ),
    ] {
        for column in columns.split(',') {
            if !c.query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name=?2)",
                params![table, column],
                |r| r.get::<_, bool>(0),
            )? {
                return Ok(false);
            }
        }
    }
    for (table, signature) in [
        ("channel_chat_input", "camp_message_id"),
        (
            "channel_chat_tool_request",
            "agent_run_id,execution_epoch,request_id",
        ),
        (
            "channel_chat_tool_request",
            "agent_run_id,execution_epoch,input_id,operation,input_digest",
        ),
        (
            "channel_chat_target_grant",
            "agent_run_id,execution_epoch,input_id,external_id",
        ),
    ] {
        let found: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM pragma_index_list(?1) l WHERE l.[unique]=1 AND (SELECT group_concat(name,',') FROM pragma_index_info(l.name))=?2)", params![table,signature], |r|r.get(0))?;
        if !found {
            return Ok(false);
        }
    }
    Ok(true)
}

fn reply(status: &str, request_id: Option<&str>, error: Option<&str>) -> Value {
    json!({"status":status,"requestId":request_id,"contacts":[],"items":[],"inputs":[],"errorCode":error})
}
fn failed(code: &str) -> Value {
    reply("failed", None, Some(code))
}
fn bounded<'a>(input: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let value = input
        .get(key)
        .and_then(Value::as_str)
        .context("invalid_input")?;
    anyhow::ensure!(
        !value.trim().is_empty() && value.chars().count() <= max,
        "invalid_input"
    );
    Ok(value)
}

#[derive(Clone)]
struct Scope {
    provider: String,
    app: String,
    chat: String,
}
#[derive(Clone)]
struct Input {
    id: String,
    author: String,
    name: String,
    owner: bool,
    quote: Option<String>,
    mentions: String,
}

fn scope(c: &Connection, run: &AuthenticatedTeamToolRun) -> Result<Option<Scope>> {
    scope_for_delivery(c, run, false)
}

fn scope_for_delivery(
    c: &Connection,
    run: &AuthenticatedTeamToolRun,
    allow_completed: bool,
) -> Result<Option<Scope>> {
    Ok(c.query_row(r#"
        SELECT mapping.provider,mapping.app_id,mapping.chat_id
        FROM agent_run r JOIN conversation v ON v.id=r.conversation_id
        JOIN camp ON camp.id=v.camp_id
        JOIN camp_member m ON m.camp_id=v.camp_id AND m.agent_id=v.agent_id
        JOIN channel_chat_conversation mapping ON mapping.camp_id=camp.id
        JOIN channel_member_bot_directory bot ON bot.provider=mapping.provider AND bot.app_id=mapping.app_id AND bot.agent_id=v.agent_id
        JOIN agent_profile p ON p.id=v.agent_id
        LEFT JOIN camp_turn t ON t.id=r.camp_turn_id
        WHERE r.id=?1 AND r.execution_epoch=?2 AND v.camp_id=?3 AND v.agent_id=?4
          AND (r.status='running' OR (?5=1 AND r.status='succeeded')) AND r.cancel_requested_at IS NULL
          AND r.runtime_recovery_required=0
          AND (?5=1 OR r.execution_lease_expires_at IS NULL OR julianday(r.execution_lease_expires_at)>julianday('now'))
          AND (r.camp_turn_id IS NULL OR (t.cancel_requested_at IS NULL AND t.status NOT IN ('cancelled','failed')))
          AND camp.deletion_operation_id IS NULL AND camp.default_lead_agent_id=v.agent_id
          AND m.status='active' AND m.leave_requested_at IS NULL
          AND m.version=CAST(json_extract(r.effective_config_json,'$.campMemberVersion') AS INTEGER)
          AND p.chat_bot_enabled=1 AND p.chat_materials_path=camp.project_path
          AND mapping.provider IN ('feishu','lark')
    "#,params![run.agent_run_id,run.execution_epoch,run.camp_id,run.agent_id,allow_completed],|r|Ok(Scope{provider:r.get(0)?,app:r.get(1)?,chat:r.get(2)?})).optional()?)
}
fn inputs(c: &Connection, run: &AuthenticatedTeamToolRun, s: &Scope) -> Result<Vec<Input>> {
    let mut stmt=c.prepare(r#"SELECT m.id,m.author_external_id,m.author_name,m.author_is_owner,m.quote_message_id,m.mentions_json
        FROM agent_run_input i JOIN channel_chat_input b ON b.camp_message_id=i.message_id
        JOIN channel_chat_message m ON m.id=b.inbound_id
        WHERE i.agent_run_id=?1 AND b.camp_id=?2 AND m.provider=?3 AND m.app_id=?4 AND m.chat_id=?5 ORDER BY i.ordinal"#)?;
    Ok(stmt
        .query_map(
            params![run.agent_run_id, run.camp_id, s.provider, s.app, s.chat],
            |r| {
                Ok(Input {
                    id: r.get(0)?,
                    author: r.get(1)?,
                    name: r.get(2)?,
                    owner: r.get(3)?,
                    quote: r.get(4)?,
                    mentions: r.get(5)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}
fn grant(
    c: &Connection,
    run: &AuthenticatedTeamToolRun,
    input: &str,
    s: &Scope,
    external: &str,
    name: &str,
    department: Option<&str>,
) -> Result<Value> {
    c.execute("INSERT INTO channel_chat_target_grant VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(agent_run_id,execution_epoch,input_id,external_id) DO NOTHING",params![Uuid::new_v4().to_string(),run.agent_run_id,run.execution_epoch,input,s.provider,s.app,external,name,department])?;
    Ok(c.query_row("SELECT target_ref,name,department FROM channel_chat_target_grant WHERE agent_run_id=?1 AND execution_epoch=?2 AND input_id=?3 AND external_id=?4",params![run.agent_run_id,run.execution_epoch,input,external],|r|Ok(json!({"targetRef":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"department":r.get::<_,Option<String>>(2)?})))?)
}

fn current_result(c: &Connection, id: &str) -> Result<Value> {
    let (raw, outbound): (String, Option<String>) = c.query_row(
        "SELECT result_json,outbound_id FROM channel_chat_tool_request WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut value: Value = serde_json::from_str(&raw)?;
    let expired:bool=c.query_row("SELECT operation='feishu.search' AND coalesce(lease_expires_at<=?2,0) FROM channel_chat_tool_request WHERE id=?1",params![id,Utc::now().timestamp_millis()],|r|r.get(0))?;
    if value["status"] == "queued" && expired {
        value["status"] = json!("unknown");
        value["errorCode"] = json!("query_timeout");
    }
    if let Some(outbound) = outbound {
        let (status, lease): (String, Option<i64>) = c.query_row(
            "SELECT status,lease_expires_at FROM channel_chat_outbound WHERE id=?1",
            [outbound],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        value["errorCode"] = match status.as_str() {
            "failed" => json!("send_failed"),
            "unknown" => json!("send_unknown"),
            _ => Value::Null,
        };
        value["status"] = json!(if status == "pending" {
            if lease.is_some_and(|x| x <= Utc::now().timestamp_millis()) {
                "unknown"
            } else {
                "queued"
            }
        } else {
            status.as_str()
        });
    }
    Ok(value)
}

pub fn execute(
    database: &mut Database,
    run: &AuthenticatedTeamToolRun,
    request_id: &str,
    operation: &str,
    input: &Value,
) -> Result<Value> {
    let Some(definition) = definitions().into_iter().find(|d| d["name"] == operation) else {
        return Ok(failed("unsupported_operation"));
    };
    let Some(object) = input.as_object() else {
        return Ok(failed("invalid_input"));
    };
    let properties = definition["inputSchema"]["properties"].as_object().unwrap();
    if request_id.is_empty()
        || request_id.len() > 1024
        || object
            .iter()
            .any(|(k, v)| !properties.contains_key(k) || !v.is_string())
    {
        return Ok(failed("invalid_input"));
    }
    if object.iter().any(|(key, value)| {
        value.as_str().is_none_or(|text| {
            text.trim().is_empty()
                || text.chars().count()
                    > properties[key]["maxLength"].as_u64().unwrap_or(512) as usize
        })
    }) {
        return Ok(failed("invalid_input"));
    }
    for required in definition["inputSchema"]["required"].as_array().unwrap() {
        if bounded(input, required.as_str().unwrap(), 16384).is_err() {
            return Ok(failed("invalid_input"));
        }
    }
    let mut canonical_input = input.clone();
    canonical_input.as_object_mut().unwrap().remove("inputRef");
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json!([operation, canonical_input]))?)
    );
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(s) = scope(&tx, run)? else {
        return Ok(failed("scope_unavailable"));
    };
    let all = inputs(&tx, run, &s)?;
    let total_inputs: i64 = tx.query_row(
        "SELECT COUNT(*) FROM agent_run_input WHERE agent_run_id=?1",
        [&run.agent_run_id],
        |r| r.get(0),
    )?;
    if all.is_empty() || total_inputs != all.len() as i64 {
        return Ok(failed("input_unbound"));
    }
    if all.len() > 100 {
        return Ok(failed("result_limit_exceeded"));
    }
    if operation == "feishu.result" {
        let wanted = bounded(input, "requestId", 1024)?;
        let id:Option<String>=tx.query_row("SELECT id FROM channel_chat_tool_request WHERE agent_run_id=?1 AND request_id=?2 AND provider=?3 AND app_id=?4 AND execution_epoch=?5",params![run.agent_run_id,wanted,s.provider,s.app,run.execution_epoch],|r|r.get(0)).optional()?;
        return match id {
            Some(id) => current_result(&tx, &id),
            None => Ok(failed("request_not_found")),
        };
    }
    if operation == "feishu.status" {
        let mut value = reply("ready", None, None);
        value["inputs"] = json!(
            all.iter()
                .map(|i| json!({"inputRef":i.id,"authorName":i.name,"isOwner":i.owner}))
                .collect::<Vec<_>>()
        );
        let mut contacts = Vec::new();
        for i in all.iter().filter(|_| all.len() == 1) {
            let mentions: Vec<crate::channel_chat::ChatMention> =
                serde_json::from_str(&i.mentions)?;
            for m in mentions {
                contacts.push(grant(&tx, run, &i.id, &s, &m.open_id, &m.name, None)?);
            }
        }
        if contacts.len() > 20 {
            return Ok(failed("result_limit_exceeded"));
        }
        value["contacts"] = json!(contacts);
        tx.commit()?;
        return Ok(value);
    }
    let selected = if let Some(reference) = input.get("inputRef").and_then(Value::as_str) {
        all.iter().find(|i| i.id == reference)
    } else if all.len() == 1 {
        all.first()
    } else {
        return Ok(failed("input_ambiguous"));
    };
    let Some(i) = selected else {
        return Ok(failed("input_not_found"));
    };
    let existing: Option<(String,String,String)> = tx.query_row(
        "SELECT id,input_digest,input_id FROM channel_chat_tool_request WHERE agent_run_id=?1 AND request_id=?2 AND execution_epoch=?3",
        params![run.agent_run_id,request_id,run.execution_epoch], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    ).optional()?;
    if let Some((id, previous, previous_input)) = existing {
        return if previous == digest && previous_input == i.id {
            current_result(&tx, &id)
        } else {
            Ok(failed("request_conflict"))
        };
    }
    // CLI transport retries may have a new request ID. Scope business replay to
    // the frozen inbound and epoch, not to a process-local replay cache.
    let business_digest = &digest;
    if matches!(
        operation,
        "feishu.search" | "feishu.forward" | "feishu.ask" | "feishu.report" | "feishu.close"
    ) {
        let previous: Option<String> = tx.query_row(
            "SELECT id FROM channel_chat_tool_request WHERE agent_run_id=?1 AND execution_epoch=?2 AND input_id=?3 AND operation=?4 AND input_digest=?5",
            params![run.agent_run_id,run.execution_epoch,i.id,operation,business_digest], |row| row.get(0),
        ).optional()?;
        if let Some(id) = previous {
            return current_result(&tx, &id);
        }
    }
    let now = Utc::now().timestamp_millis();
    let mut value = reply("ready", Some(request_id), None);
    let mut outbound: Option<String> = None;
    let mut item: Option<String> = None;
    let mut query: Option<String> = None;
    match operation {
        "feishu.search" => {
            query = Some(bounded(input, "query", 200)?.to_string());
            value["status"] = json!("queued");
        }
        "feishu.items" => {
            let mut stmt=tx.prepare("SELECT id,question,status,requester_name,target_name FROM channel_chat_item WHERE provider=?1 AND app_id=?2 AND ((requester_external_id=?3 AND destination_chat_id=?4) OR (target_external_id=?3 AND status='waiting' AND (ask_message_id=?5 OR ?6=1))) ORDER BY created_at DESC LIMIT 101")?;
            value["items"] = json!(
                stmt.query_map(
                    params![
                        s.provider,
                        s.app,
                        i.author,
                        s.chat,
                        i.quote,
                        is_private_input(&tx, &i.id)?
                    ],
                    item_json
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
            );
        }
        "feishu.forward" | "feishu.ask" => {
            let target = bounded(input, "targetRef", 512)?;
            let resolved: Option<(String, String, bool)> = if target == "owner"
                && operation == "feishu.ask"
            {
                owner(&tx, &s)?.map(|id| (id, "Owner".to_string(), true))
            } else {
                tx.query_row("SELECT external_id,name FROM channel_chat_target_grant WHERE target_ref=?1 AND agent_run_id=?2 AND input_id=?3 AND provider=?4 AND app_id=?5 AND execution_epoch=?6",params![target,run.agent_run_id,i.id,s.provider,s.app,run.execution_epoch],|r|Ok((r.get(0)?,r.get(1)?,false))).optional()?
            };
            let Some((external, name, is_owner)) = resolved else {
                return Ok(failed("target_not_authorized"));
            };
            if !valid_open_id(&external) {
                return Ok(failed("target_not_authorized"));
            }
            let body = bounded(
                input,
                if operation == "feishu.ask" {
                    "question"
                } else {
                    "text"
                },
                if operation == "feishu.ask" {
                    8192
                } else {
                    16384
                },
            )?;
            if operation == "feishu.ask" {
                let id = Uuid::new_v4().to_string();
                tx.execute("INSERT INTO channel_chat_item(id,provider,app_id,requester_external_id,requester_name,destination_chat_id,destination_kind,target_external_id,target_name,target_is_owner,question,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'chat_id',?7,?8,?9,?10,'waiting',?11,?11)",params![id,s.provider,s.app,i.author,i.name,s.chat,external,name,is_owner,body,now])?;
                value["items"] = json!([{"itemId":id,"question":body,"status":"waiting","requesterName":i.name,"targetName":name}]);
                item = Some(id);
            }
            outbound = Some(enqueue(
                &tx,
                run,
                &s,
                request_id,
                &external,
                "open_id",
                body,
                item.as_deref(),
            )?);
            value["status"] = json!("queued");
        }
        "feishu.report" | "feishu.close" => {
            let id = bounded(input, "itemId", 512)?;
            let row:Option<(String,String,String,Option<String>,Value)>=tx.query_row("SELECT target_external_id,destination_chat_id,status,ask_message_id,id,question,requester_name,target_name FROM channel_chat_item WHERE id=?1 AND provider=?2 AND app_id=?3",params![id,s.provider,s.app],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,json!({"itemId":r.get::<_,String>(4)?,"question":r.get::<_,String>(5)?,"status":r.get::<_,String>(2)?,"requesterName":r.get::<_,String>(6)?,"targetName":r.get::<_,String>(7)?})))).optional()?;
            let Some((target, destination, status, quote, mut view)) = row else {
                return Ok(failed("item_not_found"));
            };
            if operation == "feishu.close" {
                if !i.owner || owner(&tx, &s)?.as_deref() != Some(i.author.as_str()) {
                    return Ok(failed("owner_required"));
                }
                tx.execute(
                    "UPDATE channel_chat_item SET status='closed',updated_at=?2 WHERE id=?1",
                    params![id, now],
                )?;
                value["status"] = json!("closed");
                view["status"] = json!("closed");
            } else {
                if target != i.author {
                    return Ok(failed("item_not_authorized"));
                }
                let association: Option<String> = tx.query_row(
                    "SELECT report_item_id FROM channel_chat_input WHERE inbound_id=?1",
                    [&i.id],
                    |r| r.get(0),
                )?;
                if association
                    .as_deref()
                    .is_some_and(|previous| previous != id)
                {
                    return Ok(failed("input_already_associated"));
                }
                if !is_private_input(&tx, &i.id)? && i.quote.is_none() {
                    return Ok(failed("item_not_authorized"));
                }
                if status != "waiting" {
                    return Ok(failed("item_closed"));
                }
                let delivered: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM channel_chat_tool_request q JOIN channel_chat_outbound o ON o.id=q.outbound_id WHERE q.item_id=?1 AND q.operation='feishu.ask' AND o.status='sent')",
                    [id], |row| row.get(0),
                )?;
                if !delivered {
                    return Ok(failed("item_not_delivered"));
                }
                if let Some(inbound_quote) = i.quote.as_deref() {
                    if quote.as_deref() != Some(inbound_quote) {
                        return Ok(failed("item_quote_mismatch"));
                    }
                } else {
                    let count:i64=tx.query_row("SELECT COUNT(*) FROM channel_chat_item WHERE provider=?1 AND app_id=?2 AND target_external_id=?3 AND status='waiting'",params![s.provider,s.app,i.author],|r|r.get(0))?;
                    if count != 1 {
                        return Ok(failed("item_ambiguous"));
                    }
                }
                tx.execute(
                    "UPDATE channel_chat_input SET report_item_id=?2 WHERE inbound_id=?1",
                    params![i.id, id],
                )?;
                let previous_report: Option<i64> = tx.query_row(
                    "SELECT last_report_at FROM channel_chat_item WHERE id=?1",
                    [id],
                    |row| row.get(0),
                )?;
                let prefix = if previous_report.is_some() {
                    "补充"
                } else {
                    "回复"
                };
                let report = format!(
                    "关于「{}」的{}：{}",
                    view["question"].as_str().unwrap_or_default(),
                    prefix,
                    bounded(input, "text", 16384)?
                );
                outbound = Some(enqueue(
                    &tx,
                    run,
                    &s,
                    request_id,
                    &destination,
                    "chat_id",
                    &report,
                    Some(id),
                )?);
                value["status"] = json!("queued");
            }
            item = Some(id.to_string());
            value["items"] = json!([view]);
        }
        _ => return Ok(failed("unsupported_operation")),
    }
    if value["items"]
        .as_array()
        .is_some_and(|items| items.len() > 100)
    {
        return Ok(failed("result_limit_exceeded"));
    }
    if operation == "feishu.items" {
        value["requestId"] = Value::Null;
        tx.commit()?;
        return Ok(value);
    }
    tx.execute("INSERT INTO channel_chat_tool_request(id,agent_run_id,execution_epoch,request_id,operation,input_digest,provider,app_id,input_id,query,result_json,outbound_id,item_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![Uuid::new_v4().to_string(),run.agent_run_id,run.execution_epoch,request_id,operation,digest,s.provider,s.app,i.id,query,serde_json::to_string(&value)?,outbound,item,now])?;
    tx.commit()?;
    Ok(value)
}
fn valid_open_id(value: &str) -> bool {
    value.starts_with("ou_")
        && value.len() > 3
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}
fn is_private_input(c: &Connection, input: &str) -> Result<bool> {
    Ok(c.query_row(
        "SELECT conversation_kind='p2p' FROM channel_chat_message WHERE id=?1",
        [input],
        |row| row.get(0),
    )?)
}
fn item_json(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"itemId":r.get::<_,String>(0)?,"question":r.get::<_,String>(1)?,"status":r.get::<_,String>(2)?,"requesterName":r.get::<_,String>(3)?,"targetName":r.get::<_,String>(4)?}),
    )
}
fn owner(c: &Connection, s: &Scope) -> Result<Option<String>> {
    let prefix = if s.provider == "feishu" {
        "feishu"
    } else {
        "lark"
    };
    Ok(c.query_row(&format!("SELECT identity.external_id FROM {prefix}_member_bot bot JOIN {prefix}_owner_identity owner ON owner.account_id=bot.account_id JOIN {prefix}_owner_app_identity app ON app.account_id=bot.account_id AND app.app_id=bot.app_id JOIN external_principal_app_identity identity ON identity.principal_id=owner.canonical_owner_principal_id AND identity.provider=?1 AND identity.app_id=bot.app_id AND identity.identity_kind='open_id' WHERE bot.app_id=?2 AND bot.status='published'"),params![s.provider,s.app],|r|r.get(0)).optional()?)
}
fn enqueue(
    c: &Connection,
    run: &AuthenticatedTeamToolRun,
    s: &Scope,
    request: &str,
    target: &str,
    kind: &str,
    body: &str,
    item: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();
    c.execute("INSERT INTO channel_chat_outbound(id,provider,app_id,chat_id,body,source,idempotency_key,status,created_at,updated_at,target_kind,item_id,source_run_id,source_execution_epoch) VALUES(?1,?2,?3,?4,?5,'runtime_tool',?6,'pending',?7,?7,?8,?9,?10,?11)",params![id,s.provider,s.app,target,body,format!("feishu:{}:{}",run.agent_run_id,request),now,kind,item,run.agent_run_id,run.execution_epoch])?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryClaim {
    pub provider: String,
    pub app_id: String,
    pub worker_id: String,
    pub limit: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryContact {
    pub open_id: String,
    pub name: String,
    pub department: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuerySettle {
    pub provider: String,
    pub app_id: String,
    pub worker_id: String,
    pub request_id: String,
    pub lease_token: String,
    pub contacts: Vec<QueryContact>,
    pub error_code: Option<String>,
}

fn request_run(c: &Connection, id: &str) -> Result<AuthenticatedTeamToolRun> {
    Ok(c.query_row("SELECT v.camp_id,v.agent_id,q.agent_run_id,q.execution_epoch FROM channel_chat_tool_request q JOIN agent_run r ON r.id=q.agent_run_id JOIN conversation v ON v.id=r.conversation_id WHERE q.id=?1",[id],|r|Ok(AuthenticatedTeamToolRun{camp_id:r.get(0)?,agent_id:r.get(1)?,agent_run_id:r.get(2)?,execution_epoch:r.get(3)?}))?)
}
pub(crate) fn outbound_authorized(c: &Connection, id: &str) -> Result<bool> {
    let row:Option<(String,i64,String,String)>=c.query_row("SELECT o.source_run_id,o.source_execution_epoch,v.camp_id,v.agent_id FROM channel_chat_outbound o JOIN agent_run r ON r.id=o.source_run_id JOIN conversation v ON v.id=r.conversation_id WHERE o.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let Some((agent_run_id, execution_epoch, camp_id, agent_id)) = row else {
        return Ok(c.query_row("SELECT source_run_id IS NULL AND source_execution_epoch IS NULL FROM channel_chat_outbound WHERE id=?1", [id], |row| row.get(0))?);
    };
    let run = AuthenticatedTeamToolRun {
        agent_run_id,
        execution_epoch,
        camp_id,
        agent_id,
    };
    let Some(s) = scope_for_delivery(c, &run, true)? else {
        return Ok(false);
    };
    Ok(c.query_row("SELECT provider=?2 AND app_id=?3 AND (item_id IS NULL OR EXISTS(SELECT 1 FROM channel_chat_item i WHERE i.id=item_id AND i.status='waiting')) FROM channel_chat_outbound WHERE id=?1",params![id,s.provider,s.app],|r|r.get(0))?)
}
pub fn claim(database: &mut Database, p: &QueryClaim) -> Result<Vec<Value>> {
    anyhow::ensure!(
        !p.worker_id.is_empty() && p.worker_id.len() <= 256,
        "invalid worker"
    );
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = Utc::now().timestamp_millis();
    let rows = {
        let mut stmt=tx.prepare("SELECT id,request_id,query,lease_expires_at FROM channel_chat_tool_request WHERE provider=?1 AND app_id=?2 AND operation='feishu.search' AND json_extract(result_json,'$.status')='queued' ORDER BY created_at LIMIT ?3")?;
        let rows = stmt
            .query_map(params![p.provider, p.app_id, p.limit.clamp(1, 20)], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let mut result = Vec::new();
    for (id, request, query, lease) in rows {
        if let Some(expiry) = lease {
            if expiry <= now {
                tx.execute(
                    "UPDATE channel_chat_tool_request SET result_json=?2 WHERE id=?1",
                    params![
                        id,
                        serde_json::to_string(&reply(
                            "unknown",
                            Some(&request),
                            Some("query_timeout")
                        ))?
                    ],
                )?;
            }
            continue;
        }
        if scope_for_delivery(&tx, &request_run(&tx, &id)?, true)?.is_none() {
            tx.execute(
                "UPDATE channel_chat_tool_request SET result_json=?2 WHERE id=?1",
                params![
                    id,
                    serde_json::to_string(&reply(
                        "failed",
                        Some(&request),
                        Some("scope_unavailable")
                    ))?
                ],
            )?;
            continue;
        }
        let token = Uuid::new_v4().to_string();
        tx.execute("UPDATE channel_chat_tool_request SET lease_owner=?2,lease_token=?3,lease_expires_at=?4 WHERE id=?1",params![id,p.worker_id,token,now+30000])?;
        result.push(json!({"requestId":id,"leaseToken":token,"query":query}));
    }
    tx.commit()?;
    Ok(result)
}
pub fn settle(database: &mut Database, p: &QuerySettle) -> Result<Value> {
    anyhow::ensure!(
        p.contacts.len() <= 20
            && p.error_code.as_deref().is_none_or(|e| matches!(
                e,
                "permission_denied" | "unavailable" | "invalid_response"
            )),
        "invalid query result"
    );
    for contact in &p.contacts {
        anyhow::ensure!(
            valid_open_id(&contact.open_id)
                && !contact.name.trim().is_empty()
                && contact.name.chars().count() <= 200
                && contact
                    .department
                    .as_ref()
                    .is_none_or(|d| d.chars().count() <= 300),
            "invalid contact"
        );
    }
    let tx = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row:Option<(String,String,String)>=tx.query_row("SELECT request_id,agent_run_id,input_id FROM channel_chat_tool_request WHERE id=?1 AND provider=?2 AND app_id=?3 AND lease_owner=?4 AND lease_token=?5 AND lease_expires_at>?6 AND json_extract(result_json,'$.status')='queued'",params![p.request_id,p.provider,p.app_id,p.worker_id,p.lease_token,Utc::now().timestamp_millis()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let Some((request, _run_id, input)) = row else {
        return Ok(json!({"settled":false}));
    };
    let run = request_run(&tx, &p.request_id)?;
    let Some(s) = scope_for_delivery(&tx, &run, true)? else {
        return Ok(json!({"settled":false}));
    };
    let mut value = reply(
        if p.error_code.is_some() {
            "failed"
        } else {
            "ready"
        },
        Some(&request),
        p.error_code.as_deref(),
    );
    if p.error_code.is_none() {
        value["contacts"] = json!(
            p.contacts
                .iter()
                .map(|contact| grant(
                    &tx,
                    &run,
                    &input,
                    &s,
                    &contact.open_id,
                    &contact.name,
                    contact.department.as_deref()
                ))
                .collect::<Result<Vec<_>>>()?
        );
    }
    tx.execute("UPDATE channel_chat_tool_request SET result_json=?2,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=?1",params![p.request_id,serde_json::to_string(&value)?])?;
    tx.commit()?;
    Ok(json!({"settled":true}))
}

pub fn definitions() -> Vec<Value> {
    let output = json!({"type":"object","additionalProperties":false,"required":["status","requestId","contacts","items","inputs","errorCode"],"properties":{
        "status":{"type":"string","enum":["ready","queued","sent","failed","unknown","closed"]},"requestId":{"type":["string","null"]},"errorCode":{"type":["string","null"],"enum":[null,"unsupported_operation","invalid_input","scope_unavailable","input_unbound","input_ambiguous","input_not_found","request_not_found","request_conflict","target_not_authorized","item_not_found","owner_required","item_not_authorized","item_not_delivered","input_already_associated","item_closed","item_quote_mismatch","item_ambiguous","query_timeout","permission_denied","unavailable","invalid_response","result_limit_exceeded","send_failed","send_unknown"]},
        "contacts":{"type":"array","maxItems":20,"items":{"type":"object","additionalProperties":false,"required":["targetRef","name","department"],"properties":{"targetRef":{"type":"string"},"name":{"type":"string"},"department":{"type":["string","null"]}}}},
        "items":{"type":"array","maxItems":100,"items":{"type":"object","additionalProperties":false,"required":["itemId","question","status","requesterName","targetName"],"properties":{"itemId":{"type":"string"},"question":{"type":"string"},"status":{"type":"string","enum":["waiting","reported","paused","closed"]},"requesterName":{"type":"string"},"targetName":{"type":"string"}}}},
        "inputs":{"type":"array","maxItems":100,"items":{"type":"object","additionalProperties":false,"required":["inputRef","authorName","isOwner"],"properties":{"inputRef":{"type":"string"},"authorName":{"type":"string"},"isOwner":{"type":"boolean"}}}}
    }});
    [("status",vec![],false,"Inspect this Run's Bot scope and inbound references; no global directory."),("search",vec!["query"],true,"Search people within this Bot's authorized directory; returns queued. Use result; never guess between names."),("result",vec!["requestId"],false,"Read this Run's request without resending. Unknown outcomes must not be blindly retried."),("forward",vec!["targetRef","text"],true,"Send text only when explicitly delegated by the user; targetRef must be an authorized contact or current input mention."),("ask",vec!["targetRef","question"],true,"Ask only when explicitly delegated by the user; atomically creates a waiting item. Owner is a server-resolved special target."),("items",vec![],true,"List only the selected inbound author's requested or assigned items."),("report",vec!["itemId","text"],true,"Report only when delegated by the current target author and quotation or a sole waiting item identifies the request. Does not close."),("close",vec!["itemId"],true,"Close an item only for this Bot's Owner. Never closes on an inferred reply.")].into_iter().map(|(name,required,with_input,description)|{
        let mut properties=serde_json::Map::new();for key in &required{let max=match *key{"query"=>200,"question"=>8192,"text"=>16384,"requestId"=>1024,_=>512};properties.insert((*key).to_string(),json!({"type":"string","minLength":1,"maxLength":max}));}
        if with_input{properties.insert("inputRef".into(),json!({"type":"string","minLength":1,"maxLength":512}));}
        json!({"name":format!("feishu.{name}"),"description":description,"inputSchema":{"type":"object","additionalProperties":false,"properties":properties,"required":required},"outputSchema":output})
    }).collect()
}
