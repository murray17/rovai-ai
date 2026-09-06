use std::{collections::BTreeMap, time::Duration};

use serde::{Deserialize, Serialize};

pub const NETWORK_RECOVERY_DELAYS_SECONDS: [u64; 7] = [1, 2, 3, 5, 10, 15, 30];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkFailureCategory {
    ConnectionFailed,
    ConnectionReset,
    DnsTemporaryFailure,
    NetworkTimeout,
}

impl NetworkFailureCategory {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ConnectionFailed => "connection_failed",
            Self::ConnectionReset => "connection_reset",
            Self::DnsTemporaryFailure => "dns_temporary_failure",
            Self::NetworkTimeout => "network_timeout",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "connection_failed" => Some(Self::ConnectionFailed),
            "connection_reset" => Some(Self::ConnectionReset),
            "dns_temporary_failure" => Some(Self::DnsTemporaryFailure),
            "network_timeout" => Some(Self::NetworkTimeout),
            _ => None,
        }
    }
}

pub fn network_recovery_delay(attempt: u32) -> Duration {
    let index = attempt.saturating_sub(1) as usize;
    Duration::from_secs(
        NETWORK_RECOVERY_DELAYS_SECONDS[index.min(NETWORK_RECOVERY_DELAYS_SECONDS.len() - 1)],
    )
}

/// Classifies only failures that are strong evidence of a transient transport
/// interruption. Provider retryability and generic Runtime failures are not
/// network evidence. The structured code, when available, takes precedence;
/// the text fallback intentionally uses a small allow-list.
pub fn classify_network_failure(
    structured_code: Option<&str>,
    public_failure_code: Option<&str>,
    detail: Option<&str>,
) -> Option<NetworkFailureCategory> {
    if public_failure_code.is_some_and(is_explicitly_non_network_failure_code) {
        return None;
    }

    let lower = detail.unwrap_or_default().to_ascii_lowercase();
    if contains_explicitly_non_network_signal(&lower) {
        return None;
    }

    let structured_code = structured_code
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !structured_code.is_empty() {
        return match structured_code.as_str() {
            "econnrefused" | "enetdown" | "enetunreach" | "ehostunreach" => {
                Some(NetworkFailureCategory::ConnectionFailed)
            }
            "econnreset" | "econnaborted" => Some(NetworkFailureCategory::ConnectionReset),
            "eai_again" | "enotfound" | "dns_not_found" | "dns_temporary_failure" => {
                Some(NetworkFailureCategory::DnsTemporaryFailure)
            }
            "etimedout" | "connect_timeout" | "network_timeout" => {
                Some(NetworkFailureCategory::NetworkTimeout)
            }
            _ => None,
        };
    }

    if lower.is_empty() {
        return None;
    }
    if contains_any(
        &lower,
        &[
            "econnreset",
            "econnaborted",
            "connection reset by peer",
            "connection was reset",
            "socket hang up",
        ],
    ) {
        return Some(NetworkFailureCategory::ConnectionReset);
    }
    if contains_any(
        &lower,
        &[
            "eai_again",
            "enotfound",
            "temporary failure in name resolution",
            "name or service not known",
            "could not resolve host",
            "dns lookup failed",
            "failed to lookup address",
            "nodename nor servname provided",
        ],
    ) {
        return Some(NetworkFailureCategory::DnsTemporaryFailure);
    }
    if contains_any(
        &lower,
        &[
            "econnrefused",
            "enetdown",
            "enetunreach",
            "ehostunreach",
            "connection refused",
            "failed to connect to",
            "network is unreachable",
            "network unreachable",
            "no route to host",
            "tcp connect error",
            "client error (connect)",
        ],
    ) {
        return Some(NetworkFailureCategory::ConnectionFailed);
    }
    if contains_any(
        &lower,
        &["etimedout", "connect timeout", "connection timed out"],
    ) || (lower.contains("timed out")
        && contains_any(&lower, &["network", "socket", "dns", "connect"]))
    {
        return Some(NetworkFailureCategory::NetworkTimeout);
    }
    None
}

fn is_explicitly_non_network_failure_code(code: &str) -> bool {
    matches!(
        code,
        "runtime_authentication_required"
            | "runtime_rate_limited"
            | "runtime_server_overloaded"
            | "runtime_quota_exceeded"
            | "runtime_model_unavailable"
            | "runtime_permission_denied"
            | "runtime_cancelled"
            | "runtime_configuration_invalid"
    )
}

fn contains_explicitly_non_network_signal(value: &str) -> bool {
    contains_any(
        value,
        &[
            "not logged in",
            "not authenticated",
            "authentication failed",
            "unauthorized",
            "forbidden",
            "invalid api key",
            "api key is invalid",
            "token expired",
            "permission denied",
            "access denied",
            "proxy authentication required",
            "rate limit",
            "too many requests",
            "http 429",
            "status 429",
            "quota exceeded",
            "insufficient quota",
            "insufficient credits",
            "billing limit",
            "server overloaded",
            "at capacity",
            "invalid configuration",
            "configuration error",
            "certificate verify failed",
            "invalid certificate",
            "cancelled by user",
            "canceled by user",
        ],
    ) || contains_http_status(value, &[401, 403, 407, 429])
        || contains_http_server_status(value)
}

fn contains_http_server_status(value: &str) -> bool {
    contains_http_status(value, &(500..=599).collect::<Vec<_>>())
}

fn contains_http_status(value: &str, statuses: &[u16]) -> bool {
    statuses.iter().any(|status| {
        [
            format!("http {status}"),
            format!("http status {status}"),
            format!("status {status}"),
            format!("status code {status}"),
            format!("status code: {status}"),
        ]
        .iter()
        .any(|marker| value.contains(marker))
    })
}

fn contains_any(value: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| value.contains(candidate))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkRecoveryRegistration {
    pub agent_run_id: String,
    pub camp_id: String,
    pub camp_turn_id: String,
    pub execution_epoch: i64,
    pub adapter_kind: String,
    pub category: NetworkFailureCategory,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkRecoveryAttempt {
    pub registration: NetworkRecoveryRegistration,
    pub attempt: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkRecoveryRegistrationOutcome {
    Scheduled { attempt: u32, delay: Duration },
    Duplicate,
    Stale,
}

#[derive(Debug, Clone)]
struct NetworkRecoveryEntry {
    registration: NetworkRecoveryRegistration,
    attempt: u32,
    due_at: std::time::Instant,
    in_flight: bool,
    wake_consumed: bool,
}

#[derive(Debug, Default)]
pub struct NetworkRecoveryQueue {
    entries: BTreeMap<String, NetworkRecoveryEntry>,
}

impl NetworkRecoveryQueue {
    pub fn register(
        &mut self,
        registration: NetworkRecoveryRegistration,
        attempt_completed_at: std::time::Instant,
    ) -> NetworkRecoveryRegistrationOutcome {
        let (attempt, wake_consumed) = match self.entries.get(&registration.agent_run_id) {
            Some(entry) if entry.registration.execution_epoch > registration.execution_epoch => {
                return NetworkRecoveryRegistrationOutcome::Stale;
            }
            Some(entry) if entry.registration.execution_epoch == registration.execution_epoch => {
                return NetworkRecoveryRegistrationOutcome::Duplicate;
            }
            Some(entry) => (entry.attempt.saturating_add(1), entry.wake_consumed),
            None => (1, false),
        };
        let delay = network_recovery_delay(attempt);
        self.entries.insert(
            registration.agent_run_id.clone(),
            NetworkRecoveryEntry {
                registration,
                attempt,
                due_at: attempt_completed_at + delay,
                in_flight: false,
                wake_consumed,
            },
        );
        NetworkRecoveryRegistrationOutcome::Scheduled { attempt, delay }
    }

    pub fn next_deadline(&self) -> Option<std::time::Instant> {
        self.entries
            .values()
            .filter(|entry| !entry.in_flight)
            .map(|entry| entry.due_at)
            .min()
    }

    pub fn take_due(&mut self, now: std::time::Instant) -> Vec<NetworkRecoveryAttempt> {
        let mut due = self
            .entries
            .values_mut()
            .filter(|entry| !entry.in_flight && entry.due_at <= now)
            .map(|entry| {
                entry.in_flight = true;
                NetworkRecoveryAttempt {
                    registration: entry.registration.clone(),
                    attempt: entry.attempt,
                }
            })
            .collect::<Vec<_>>();
        due.sort_by(|left, right| {
            left.registration
                .agent_run_id
                .cmp(&right.registration.agent_run_id)
        });
        due
    }

    /// A connectivity hint only wakes one waiting check in a failure cycle. It
    /// never starts a second attempt while an existing attempt owns the Run,
    /// and repeated hints cannot bypass later backoff stages.
    pub fn wake_waiting(&mut self, now: std::time::Instant) -> usize {
        let mut woken = 0;
        for entry in self
            .entries
            .values_mut()
            .filter(|entry| !entry.in_flight && !entry.wake_consumed)
        {
            if entry.due_at > now {
                entry.due_at = now;
                entry.wake_consumed = true;
                woken += 1;
            }
        }
        woken
    }

    pub fn contains(&self, agent_run_id: &str, execution_epoch: i64) -> bool {
        self.entries
            .get(agent_run_id)
            .is_some_and(|entry| entry.registration.execution_epoch <= execution_epoch)
    }

    pub fn complete(
        &mut self,
        agent_run_id: &str,
        through_execution_epoch: i64,
    ) -> Option<NetworkRecoveryAttempt> {
        if !self.contains(agent_run_id, through_execution_epoch) {
            return None;
        }
        self.entries
            .remove(agent_run_id)
            .map(|entry| NetworkRecoveryAttempt {
                registration: entry.registration,
                attempt: entry.attempt,
            })
    }

    /// A terminal event may close only a recovery attempt from a newer epoch.
    /// A repeated terminal callback from the epoch that opened the failure
    /// cycle is stale and must not erase its pending retry state.
    pub fn complete_after_terminal(
        &mut self,
        agent_run_id: &str,
        terminal_execution_epoch: i64,
    ) -> Option<NetworkRecoveryAttempt> {
        let entry = self.entries.get(agent_run_id)?;
        if entry.registration.execution_epoch >= terminal_execution_epoch {
            return None;
        }
        self.entries
            .remove(agent_run_id)
            .map(|entry| NetworkRecoveryAttempt {
                registration: entry.registration,
                attempt: entry.attempt,
            })
    }

    /// Releases a failed coordinator-side safety check without consuming a
    /// Runtime recovery attempt. A newer epoch owns the logical Run and must
    /// never be moved by an older worker.
    pub fn defer_check(
        &mut self,
        agent_run_id: &str,
        execution_epoch: i64,
        completed_at: std::time::Instant,
    ) -> Option<(NetworkRecoveryAttempt, Duration)> {
        let entry = self.entries.get_mut(agent_run_id)?;
        if entry.registration.execution_epoch != execution_epoch || !entry.in_flight {
            return None;
        }
        let delay = network_recovery_delay(entry.attempt);
        entry.due_at = completed_at + delay;
        entry.in_flight = false;
        Some((
            NetworkRecoveryAttempt {
                registration: entry.registration.clone(),
                attempt: entry.attempt,
            },
            delay,
        ))
    }

    pub fn drain(&mut self) -> Vec<NetworkRecoveryAttempt> {
        let mut entries = std::mem::take(&mut self.entries)
            .into_values()
            .map(|entry| NetworkRecoveryAttempt {
                registration: entry.registration,
                attempt: entry.attempt,
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            left.registration
                .agent_run_id
                .cmp(&right.registration.agent_run_id)
        });
        entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration(epoch: i64) -> NetworkRecoveryRegistration {
        NetworkRecoveryRegistration {
            agent_run_id: "run-1".to_string(),
            camp_id: "camp-1".to_string(),
            camp_turn_id: "turn-1".to_string(),
            execution_epoch: epoch,
            adapter_kind: "opencode-cli".to_string(),
            category: NetworkFailureCategory::ConnectionReset,
            source: "acp_prompt_terminal".to_string(),
        }
    }

    #[test]
    fn fixed_backoff_is_capped_without_jitter() {
        let observed = (1..=10)
            .map(|attempt| network_recovery_delay(attempt).as_secs())
            .collect::<Vec<_>>();
        assert_eq!(observed, vec![1, 2, 3, 5, 10, 15, 30, 30, 30, 30]);
        let cumulative = observed
            .iter()
            .scan(0, |elapsed, delay| {
                *elapsed += delay;
                Some(*elapsed)
            })
            .collect::<Vec<_>>();
        assert_eq!(cumulative, vec![1, 3, 6, 11, 21, 36, 66, 96, 126, 156]);
    }

    #[test]
    fn classifier_accepts_transport_evidence_and_rejects_provider_failures() {
        let cases = [
            (
                Some("ECONNRESET"),
                None,
                None,
                Some(NetworkFailureCategory::ConnectionReset),
            ),
            (
                None,
                Some("runtime_prompt_runtime_error"),
                Some("temporary failure in name resolution"),
                Some(NetworkFailureCategory::DnsTemporaryFailure),
            ),
            (
                None,
                Some("runtime_prompt_runtime_error"),
                Some("connect operation timed out"),
                Some(NetworkFailureCategory::NetworkTimeout),
            ),
            (
                Some("EAI_AGAIN"),
                Some("runtime_authentication_required"),
                Some("token expired"),
                None,
            ),
            (
                Some("ECONNRESET"),
                Some("runtime_prompt_runtime_error"),
                Some("request failed with HTTP status 503"),
                None,
            ),
            (
                None,
                Some("runtime_prompt_runtime_error"),
                Some("HTTP 503 service unavailable"),
                None,
            ),
            (
                None,
                Some("runtime_prompt_runtime_error"),
                Some("error sending request for url due to an invalid certificate"),
                None,
            ),
            (
                None,
                Some("runtime_rate_limited"),
                Some("connection reset after HTTP 429"),
                None,
            ),
            (None, None, Some("request failed"), None),
        ];
        for (structured, code, detail, expected) in cases {
            assert_eq!(classify_network_failure(structured, code, detail), expected);
        }
    }

    #[test]
    fn queue_counts_completed_attempts_and_coalesces_wake_signals() {
        let start = std::time::Instant::now();
        let mut queue = NetworkRecoveryQueue::default();
        assert_eq!(
            queue.register(registration(1), start),
            NetworkRecoveryRegistrationOutcome::Scheduled {
                attempt: 1,
                delay: Duration::from_secs(1),
            }
        );
        assert!(queue.take_due(start).is_empty());
        assert_eq!(queue.wake_waiting(start), 1);
        assert_eq!(queue.wake_waiting(start), 0);
        let due = queue.take_due(start);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].attempt, 1);
        assert!(queue.take_due(start + Duration::from_secs(60)).is_empty());

        let (deferred, delay) = queue
            .defer_check("run-1", 1, start + Duration::from_secs(1))
            .expect("in-flight check should be deferred");
        assert_eq!(deferred.attempt, 1);
        assert_eq!(delay, Duration::from_secs(1));
        assert!(
            queue
                .take_due(start + Duration::from_millis(1_999))
                .is_empty()
        );
        assert_eq!(queue.take_due(start + Duration::from_secs(2))[0].attempt, 1);
        assert!(
            queue
                .defer_check("run-1", 2, start + Duration::from_secs(2))
                .is_none()
        );

        assert_eq!(
            queue.register(registration(2), start + Duration::from_secs(4)),
            NetworkRecoveryRegistrationOutcome::Scheduled {
                attempt: 2,
                delay: Duration::from_secs(2),
            }
        );
        assert_eq!(queue.wake_waiting(start + Duration::from_secs(4)), 0);
        assert!(queue.take_due(start + Duration::from_secs(5)).is_empty());
        assert_eq!(queue.take_due(start + Duration::from_secs(6))[0].attempt, 2);
        assert_eq!(
            queue.register(registration(2), start + Duration::from_secs(7)),
            NetworkRecoveryRegistrationOutcome::Duplicate
        );
        assert_eq!(queue.len(), 1);
        assert!(queue.complete_after_terminal("run-1", 2).is_none());
        assert!(queue.complete_after_terminal("run-1", 3).is_some());
        assert!(queue.is_empty());
    }
}
