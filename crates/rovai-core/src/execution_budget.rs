use std::{sync::OnceLock, time::Instant};

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

pub const CAMP_TURN_EXECUTION_BUDGET_SCHEMA_VERSION: i64 = 1;
pub const PRODUCT_MAX_EXECUTION_ELAPSED_SECONDS: i64 = 86_400;
pub const PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES: i64 = 32;
pub const PRODUCT_MAX_ACCEPTED_A2A: i64 = 16;

#[derive(Debug)]
struct ProcessMonotonicUtcClock {
    started_wall: DateTime<Utc>,
    started_monotonic: Instant,
}

static PROCESS_MONOTONIC_UTC_CLOCK: OnceLock<ProcessMonotonicUtcClock> = OnceLock::new();

pub fn camp_turn_execution_budget_now() -> DateTime<Utc> {
    let clock = PROCESS_MONOTONIC_UTC_CLOCK.get_or_init(|| ProcessMonotonicUtcClock {
        started_wall: Utc::now(),
        started_monotonic: Instant::now(),
    });
    let elapsed = Duration::from_std(clock.started_monotonic.elapsed())
        .unwrap_or_else(|_| Duration::seconds(i64::MAX));
    clock
        .started_wall
        .checked_add_signed(elapsed)
        .unwrap_or(DateTime::<Utc>::MAX_UTC)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampTurnExecutionBudgetExhaustionReason {
    Elapsed,
    AgentRunResponsibilities,
    AcceptedA2a,
}

impl CampTurnExecutionBudgetExhaustionReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Elapsed => "elapsed",
            Self::AgentRunResponsibilities => "agent_run_responsibilities",
            Self::AcceptedA2a => "accepted_a2a",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampTurnExecutionBudgetRequest {
    pub elapsed_seconds: i64,
    pub max_agent_run_responsibilities: i64,
    pub max_accepted_a2a: i64,
}

impl CampTurnExecutionBudgetRequest {
    pub fn validate(&self) -> Result<()> {
        if self.elapsed_seconds < 1 {
            anyhow::bail!("Execution Budget elapsedSeconds must be positive");
        }
        if self.max_agent_run_responsibilities < 1 {
            anyhow::bail!("Execution Budget maxAgentRunResponsibilities must be positive");
        }
        if self.max_accepted_a2a < 0 {
            anyhow::bail!("Execution Budget maxAcceptedA2a must not be negative");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenCampTurnExecutionBudget {
    pub schema_version: i64,
    pub accepted_at: String,
    pub deadline_at: String,
    pub elapsed_seconds: i64,
    pub max_agent_run_responsibilities: i64,
    pub max_accepted_a2a: i64,
    pub root_agent_run_responsibilities: i64,
}

pub fn freeze_camp_turn_execution_budget(
    requested: Option<&CampTurnExecutionBudgetRequest>,
    accepted_at: DateTime<Utc>,
    root_agent_run_responsibilities: i64,
) -> Result<FrozenCampTurnExecutionBudget> {
    if let Some(requested) = requested {
        requested.validate()?;
    }
    if root_agent_run_responsibilities < 1 {
        anyhow::bail!("Execution Budget requires at least one root AgentRun responsibility");
    }
    let elapsed_seconds = requested
        .map(|budget| budget.elapsed_seconds)
        .unwrap_or(PRODUCT_MAX_EXECUTION_ELAPSED_SECONDS)
        .min(PRODUCT_MAX_EXECUTION_ELAPSED_SECONDS);
    let max_agent_run_responsibilities = requested
        .map(|budget| budget.max_agent_run_responsibilities)
        .unwrap_or(PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES)
        .min(PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES);
    let max_accepted_a2a = requested
        .map(|budget| budget.max_accepted_a2a)
        .unwrap_or(PRODUCT_MAX_ACCEPTED_A2A)
        .min(PRODUCT_MAX_ACCEPTED_A2A);
    if root_agent_run_responsibilities > max_agent_run_responsibilities {
        anyhow::bail!("Execution Budget cannot admit every root AgentRun responsibility");
    }
    let deadline_at = accepted_at
        .checked_add_signed(Duration::seconds(elapsed_seconds))
        .ok_or_else(|| anyhow::anyhow!("Execution Budget deadline overflow"))?;
    Ok(FrozenCampTurnExecutionBudget {
        schema_version: CAMP_TURN_EXECUTION_BUDGET_SCHEMA_VERSION,
        accepted_at: accepted_at.to_rfc3339(),
        deadline_at: deadline_at.to_rfc3339(),
        elapsed_seconds,
        max_agent_run_responsibilities,
        max_accepted_a2a,
        root_agent_run_responsibilities,
    })
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    #[test]
    fn requested_budget_is_clamped_by_product_safety_maxima() {
        let accepted_at = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let frozen = freeze_camp_turn_execution_budget(
            Some(&CampTurnExecutionBudgetRequest {
                elapsed_seconds: PRODUCT_MAX_EXECUTION_ELAPSED_SECONDS + 1,
                max_agent_run_responsibilities: PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES + 1,
                max_accepted_a2a: PRODUCT_MAX_ACCEPTED_A2A + 1,
            }),
            accepted_at,
            2,
        )
        .unwrap();
        assert_eq!(
            frozen.elapsed_seconds,
            PRODUCT_MAX_EXECUTION_ELAPSED_SECONDS
        );
        assert_eq!(
            frozen.max_agent_run_responsibilities,
            PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES
        );
        assert_eq!(frozen.max_accepted_a2a, PRODUCT_MAX_ACCEPTED_A2A);
        assert_eq!(frozen.root_agent_run_responsibilities, 2);
        assert_eq!(frozen.deadline_at, "2026-08-04T00:00:00+00:00");
    }

    #[test]
    fn budget_rejects_a_root_execution_that_cannot_fit() {
        let accepted_at = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let error = freeze_camp_turn_execution_budget(
            Some(&CampTurnExecutionBudgetRequest {
                elapsed_seconds: 60,
                max_agent_run_responsibilities: 1,
                max_accepted_a2a: 0,
            }),
            accepted_at,
            2,
        )
        .unwrap_err();
        assert!(error.to_string().contains("cannot admit every root"));
    }
}
