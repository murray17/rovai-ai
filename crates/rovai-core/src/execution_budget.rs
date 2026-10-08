use std::{
    sync::{Mutex, OnceLock},
    time::Instant,
};

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

pub const CAMP_TURN_EXECUTION_BUDGET_SCHEMA_VERSION: i64 = 1;
pub const UNBOUNDED_EXECUTION_BUDGET_SCHEMA_VERSION: i64 = 2;
// Frozen v47 migration policy; never use this as a default for new executions.
pub const LEGACY_EXECUTION_ELAPSED_SECONDS: i64 = 86_400;
pub const PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES: i64 = 32;
pub const PRODUCT_MAX_ACCEPTED_A2A: i64 = 16;

#[derive(Debug)]
struct ProcessExecutionBudgetClock {
    started_wall: DateTime<Utc>,
    started_awake: Instant,
    last_observed: Mutex<DateTime<Utc>>,
}

static PROCESS_EXECUTION_BUDGET_CLOCK: OnceLock<ProcessExecutionBudgetClock> = OnceLock::new();

pub fn camp_turn_execution_budget_now() -> DateTime<Utc> {
    let wall_now = Utc::now();
    let clock = PROCESS_EXECUTION_BUDGET_CLOCK.get_or_init(|| ProcessExecutionBudgetClock {
        started_wall: wall_now,
        started_awake: Instant::now(),
        last_observed: Mutex::new(wall_now),
    });
    let awake_elapsed = Duration::from_std(clock.started_awake.elapsed())
        .unwrap_or_else(|_| Duration::seconds(i64::MAX));
    let awake_now = clock
        .started_wall
        .checked_add_signed(awake_elapsed)
        .unwrap_or(DateTime::<Utc>::MAX_UTC);
    let mut last_observed = clock
        .last_observed
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let observed = reconcile_execution_budget_time(wall_now, awake_now, *last_observed);
    *last_observed = observed;
    observed
}

fn reconcile_execution_budget_time(
    wall_now: DateTime<Utc>,
    awake_now: DateTime<Utc>,
    last_observed: DateTime<Utc>,
) -> DateTime<Utc> {
    wall_now.max(awake_now).max(last_observed)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadTurnExecutionBudgetExhaustionReason {
    Elapsed,
    AgentRunResponsibilities,
    AcceptedA2a,
}

impl ThreadTurnExecutionBudgetExhaustionReason {
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
pub struct ThreadTurnExecutionBudgetRequest {
    #[serde(deserialize_with = "deserialize_required_time_limit")]
    pub elapsed_seconds: Option<i64>,
    pub max_agent_run_responsibilities: i64,
    pub max_accepted_a2a: i64,
}

impl ThreadTurnExecutionBudgetRequest {
    pub fn validate(&self) -> Result<()> {
        if self.elapsed_seconds.is_some_and(|seconds| seconds < 1) {
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
pub struct FrozenThreadTurnExecutionBudget {
    pub schema_version: i64,
    pub accepted_at: String,
    pub deadline_at: Option<String>,
    pub elapsed_seconds: Option<i64>,
    pub max_agent_run_responsibilities: i64,
    pub max_accepted_a2a: i64,
    pub root_agent_run_responsibilities: i64,
}

pub fn freeze_camp_turn_execution_budget(
    requested: Option<&ThreadTurnExecutionBudgetRequest>,
    accepted_at: DateTime<Utc>,
    root_agent_run_responsibilities: i64,
) -> Result<FrozenThreadTurnExecutionBudget> {
    if let Some(requested) = requested {
        requested.validate()?;
    }
    if root_agent_run_responsibilities < 1 {
        anyhow::bail!("Execution Budget requires at least one root AgentRun responsibility");
    }
    let elapsed_seconds = requested.and_then(|budget| budget.elapsed_seconds);
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
    let deadline_at = elapsed_seconds
        .map(|seconds| {
            Duration::try_seconds(seconds)
                .and_then(|duration| accepted_at.checked_add_signed(duration))
                .ok_or_else(|| anyhow::anyhow!("Execution Budget deadline overflow"))
        })
        .transpose()?;
    Ok(FrozenThreadTurnExecutionBudget {
        schema_version: if elapsed_seconds.is_none() {
            UNBOUNDED_EXECUTION_BUDGET_SCHEMA_VERSION
        } else {
            CAMP_TURN_EXECUTION_BUDGET_SCHEMA_VERSION
        },
        accepted_at: accepted_at.to_rfc3339(),
        deadline_at: deadline_at.map(|deadline| deadline.to_rfc3339()),
        elapsed_seconds,
        max_agent_run_responsibilities,
        max_accepted_a2a,
        root_agent_run_responsibilities,
    })
}

// Explicit null opts out of a time limit. An omitted field remains an error;
// omitting the entire request selects an unbounded duration with ordinary count limits.
pub fn deserialize_required_time_limit<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<i64>::deserialize(deserializer)
}

pub fn execution_deadline_elapsed(deadline: Option<&str>, now: DateTime<Utc>) -> Result<bool> {
    deadline
        .map(|value| DateTime::parse_from_rfc3339(value).map(|deadline| now >= deadline))
        .transpose()
        .map(|elapsed| elapsed.unwrap_or(false))
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    #[test]
    fn execution_budget_time_counts_suspend_wall_progress_without_ever_regressing() {
        let started = Utc.with_ymd_and_hms(2026, 8, 24, 11, 16, 47).unwrap();
        let after_suspend = Utc.with_ymd_and_hms(2026, 8, 24, 12, 0, 7).unwrap();
        let awake_only = started + Duration::seconds(5);

        assert_eq!(
            reconcile_execution_budget_time(after_suspend, awake_only, started),
            after_suspend
        );
        assert_eq!(
            reconcile_execution_budget_time(
                after_suspend - Duration::minutes(10),
                awake_only + Duration::seconds(1),
                after_suspend,
            ),
            after_suspend
        );
    }

    #[test]
    fn default_time_is_unbounded_and_explicit_time_preserves_count_limits() {
        let accepted_at = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let frozen = freeze_camp_turn_execution_budget(
            Some(&ThreadTurnExecutionBudgetRequest {
                elapsed_seconds: Some(172_800),
                max_agent_run_responsibilities: PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES + 1,
                max_accepted_a2a: PRODUCT_MAX_ACCEPTED_A2A + 1,
            }),
            accepted_at,
            2,
        )
        .unwrap();
        assert_eq!(frozen.schema_version, 1);
        assert_eq!(frozen.elapsed_seconds, Some(172_800));
        assert_eq!(
            frozen.max_agent_run_responsibilities,
            PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES
        );
        assert_eq!(frozen.max_accepted_a2a, PRODUCT_MAX_ACCEPTED_A2A);
        assert_eq!(frozen.root_agent_run_responsibilities, 2);
        assert_eq!(
            frozen.deadline_at.as_deref(),
            Some("2026-08-05T00:00:00+00:00")
        );
        assert!(
            !execution_deadline_elapsed(
                frozen.deadline_at.as_deref(),
                accepted_at + Duration::days(1)
            )
            .unwrap()
        );
        assert!(
            execution_deadline_elapsed(
                frozen.deadline_at.as_deref(),
                accepted_at + Duration::days(2)
            )
            .unwrap()
        );
        let unbounded: ThreadTurnExecutionBudgetRequest = serde_json::from_value(serde_json::json!({"elapsedSeconds":null,"maxAgentRunResponsibilities":32,"maxAcceptedA2a":16})).unwrap();
        let frozen = freeze_camp_turn_execution_budget(Some(&unbounded), accepted_at, 1).unwrap();
        assert_eq!(
            freeze_camp_turn_execution_budget(None, accepted_at, 1).unwrap(),
            frozen
        );
        assert_eq!(frozen.schema_version, 2);
        assert_eq!(frozen.elapsed_seconds, None);
        assert_eq!(frozen.deadline_at, None);
        assert!(
            !execution_deadline_elapsed(
                frozen.deadline_at.as_deref(),
                accepted_at + Duration::days(7)
            )
            .unwrap()
        );
        assert!(
            serde_json::from_value::<ThreadTurnExecutionBudgetRequest>(
                serde_json::json!({"maxAgentRunResponsibilities":32,"maxAcceptedA2a":16})
            )
            .is_err()
        );
    }

    #[test]
    fn budget_rejects_invalid_limits_and_unrepresentable_deadlines() {
        let accepted_at = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let error = freeze_camp_turn_execution_budget(
            Some(&ThreadTurnExecutionBudgetRequest {
                elapsed_seconds: Some(60),
                max_agent_run_responsibilities: 1,
                max_accepted_a2a: 0,
            }),
            accepted_at,
            2,
        )
        .unwrap_err();
        assert!(error.to_string().contains("cannot admit every root"));
        for (elapsed_seconds, expected) in [
            (0, "must be positive"),
            (-1, "must be positive"),
            (i64::MAX, "deadline overflow"),
            (Duration::MAX.num_seconds(), "deadline overflow"),
        ] {
            let error = freeze_camp_turn_execution_budget(
                Some(&ThreadTurnExecutionBudgetRequest {
                    elapsed_seconds: Some(elapsed_seconds),
                    max_agent_run_responsibilities: 1,
                    max_accepted_a2a: 0,
                }),
                accepted_at,
                1,
            )
            .unwrap_err();
            assert!(
                error.to_string().contains(expected),
                "{elapsed_seconds}: {error}"
            );
        }
    }
}
