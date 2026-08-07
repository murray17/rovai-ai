use anyhow::{Context, Result};
use rusqlite::Transaction;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{agent_profile::FrozenAgentRuntimeConfig, runtime::AgentRunWorkspace};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenRuntimeBasis {
    pub effective_config: Value,
    pub workspace: AgentRunWorkspace,
}

impl FrozenRuntimeBasis {
    pub fn runtime(&self) -> Result<FrozenAgentRuntimeConfig> {
        serde_json::from_value(
            self.effective_config
                .get("runtime")
                .cloned()
                .context("frozen execution basis has no Runtime configuration")?,
        )
        .context("frozen execution basis Runtime configuration is invalid")
    }
}

pub fn capture_run_runtime_basis(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
) -> Result<FrozenRuntimeBasis> {
    let (effective_config, workspace): (String, String) = transaction.query_row(
        r#"
        SELECT effective_config_json, workspace_json
        FROM agent_run
        WHERE id = ?1
        "#,
        [agent_run_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let basis = FrozenRuntimeBasis {
        effective_config: serde_json::from_str(&effective_config)
            .context("caller AgentRun effective configuration is invalid")?,
        workspace: serde_json::from_str(&workspace)
            .context("caller AgentRun workspace is invalid")?,
    };
    basis.workspace.validate()?;
    basis.runtime()?;
    Ok(basis)
}
