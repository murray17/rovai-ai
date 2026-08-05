use std::{collections::BTreeMap, path::Path};

use anyhow::{Context, Result, bail};
use rusqlite::{Transaction, params};

use crate::codex_home;

pub const LUOKE_AGENT_ID: &str = "agent_1";
pub const MUWA_AGENT_ID: &str = "agent_2";
pub const MIANZHI_AGENT_ID: &str = "agent_3";
pub const QILU_AGENT_ID: &str = "agent_4";

pub const LEGACY_BUILT_IN_AGENT_ID_MAPPINGS: [(&str, &str); 4] = [
    ("agent-luoke", LUOKE_AGENT_ID),
    ("agent-muwa", MUWA_AGENT_ID),
    ("agent-mianzhi", MIANZHI_AGENT_ID),
    ("agent-qilu", QILU_AGENT_ID),
];

pub const FIRST_USER_AGENT_ORDINAL: i64 = 5;

pub fn format_agent_id(ordinal: i64) -> Result<String> {
    if ordinal <= 0 {
        bail!("Agent ID ordinal must be positive");
    }
    Ok(format!("agent_{ordinal}"))
}

pub fn parse_agent_id(value: &str) -> Option<i64> {
    let suffix = value.strip_prefix("agent_")?;
    if suffix.is_empty()
        || suffix.starts_with('0')
        || !suffix.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    suffix.parse::<i64>().ok().filter(|ordinal| *ordinal > 0)
}

pub fn allocate_agent_id(transaction: &Transaction<'_>) -> Result<String> {
    let ordinal: i64 = transaction
        .query_row(
            "SELECT next_value FROM agent_id_sequence WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .context("Agent ID sequence is unavailable")?;
    let next = ordinal
        .checked_add(1)
        .context("Agent ID sequence exhausted")?;
    transaction.execute(
        "UPDATE agent_id_sequence SET next_value = ?1 WHERE singleton = 1",
        params![next],
    )?;
    format_agent_id(ordinal)
}

pub fn migrate_codex_home_agent_ids(
    data_dir: &Path,
    mappings: &BTreeMap<String, String>,
) -> Result<()> {
    if mappings.is_empty() {
        return Ok(());
    }
    codex_home::migrate_agent_profile_ids(data_dir, mappings)
        .context("failed to migrate Camp-member Codex Home Agent IDs")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{format_agent_id, parse_agent_id};

    #[test]
    fn agent_ids_are_positive_canonical_decimal_values() {
        assert_eq!(format_agent_id(1).unwrap(), "agent_1");
        assert_eq!(format_agent_id(42).unwrap(), "agent_42");
        assert!(format_agent_id(0).is_err());

        assert_eq!(parse_agent_id("agent_1"), Some(1));
        assert_eq!(parse_agent_id("agent_42"), Some(42));
        assert_eq!(parse_agent_id("agent_0"), None);
        assert_eq!(parse_agent_id("agent_01"), None);
        assert_eq!(parse_agent_id("agent_-1"), None);
        assert_eq!(parse_agent_id("agent-luoke"), None);
    }
}
