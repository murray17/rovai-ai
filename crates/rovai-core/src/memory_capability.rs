//! Instance authority for Rovai Memory. Discovery files never grant access.
use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const DISABLED_CODE: &str = "memory.feature_disabled";
pub const DISABLED_MESSAGE: &str = "Rovai long-term memory is disabled.";

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryPreferences {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCapabilitySnapshot {
    pub enabled: bool,
    pub heads_up_after_global_sequence: i64,
    pub observed_through_change_sequence: i64,
}

fn preference(connection: &Connection) -> Result<(bool, i64)> {
    // Migrations initialize the singleton explicitly. Missing or invalid state
    // is an infrastructure failure, never a confirmed user disable.
    let (value, boundary): (i64, i64) = connection
        .query_row(
            "SELECT enabled, heads_up_after_global_sequence FROM memory_preference WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .context("Rovai Memory preference is unavailable")?;
    anyhow::ensure!(boundary >= 0, "Rovai Memory notice boundary is invalid");
    match value {
        0 => Ok((false, boundary)),
        1 => Ok((true, boundary)),
        _ => anyhow::bail!("Rovai Memory preference is invalid"),
    }
}

pub fn enabled(connection: &Connection) -> Result<bool> {
    Ok(preference(connection)?.0)
}

pub fn require_enabled(connection: &Connection) -> Result<()> {
    if !enabled(connection)? {
        return Err(crate::team_tool::TeamToolInvocationError {
            code: DISABLED_CODE.into(),
            message: DISABLED_MESSAGE.into(),
        }
        .into());
    }
    Ok(())
}

/// Optional input/discovery projections omit unreadable Memory. This never
/// changes authority; actual operations must still use `require_enabled`.
pub fn discoverable(connection: &Connection) -> bool {
    enabled(connection).unwrap_or(false)
}

pub fn snapshot(connection: &Connection) -> Result<MemoryCapabilitySnapshot> {
    let (enabled, heads_up_after_global_sequence) = preference(connection)?;
    Ok(MemoryCapabilitySnapshot {
        enabled,
        heads_up_after_global_sequence,
        observed_through_change_sequence: connection.query_row(
            "SELECT current_sequence FROM notification_change_clock WHERE singleton=1",
            [],
            |r| r.get(0),
        )?,
    })
}

/// Called in the settings transaction. Same-value saves repair discovery only.
pub fn set(connection: &Connection, next: bool) -> Result<bool> {
    let previous = enabled(connection)?;
    if previous == next {
        return Ok(false);
    }
    connection.execute(
        "UPDATE memory_preference SET enabled=?1,
         heads_up_after_global_sequence=CASE WHEN enabled=0 AND ?1=1
           THEN (SELECT COALESCE(MAX(global_sequence),0) FROM event_log)
           ELSE heads_up_after_global_sequence END WHERE singleton=1",
        [next],
    )?;
    connection.execute(
        "UPDATE notification_change_clock SET current_sequence=current_sequence+1 WHERE singleton=1", [])?;
    Ok(true)
}

pub fn is_read_operation(operation: &str) -> bool {
    matches!(operation, "memory.view" | "memory.search" | "memory.read")
}

pub fn is_memory_operation(operation: &str) -> bool {
    is_read_operation(operation) || operation == "memory.write"
}
