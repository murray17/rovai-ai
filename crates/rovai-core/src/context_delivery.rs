use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::command::canonical_json_digest;

pub const OMITTED_PUBLIC_MESSAGES_NAVIGATION_HINT: &str = "Some public messages are omitted. The sequence envelope may contain gaps and is not an executable range. Do not infer omitted content or retrieve it unless the current work requires it; use camp.search to locate relevant messages and camp.read with its canonical input to read them.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextDeliveryProfile {
    pub profile_version: i64,
    pub max_public_messages: usize,
    pub max_public_history_chars: usize,
    pub max_message_body_chars: usize,
    pub max_public_reference_chain_messages: usize,
    pub max_self_active_tasks: usize,
}

impl ContextDeliveryProfile {
    pub fn validate(self) -> Result<Self> {
        if self.profile_version != 3 {
            anyhow::bail!("unsupported Context Delivery Profile version");
        }
        if self.max_public_messages == 0
            || self.max_public_history_chars == 0
            || self.max_message_body_chars == 0
        {
            anyhow::bail!("Context Delivery Profile limits must be positive");
        }
        if self.max_message_body_chars > self.max_public_history_chars {
            anyhow::bail!("Context Delivery Profile message body limit exceeds its history budget");
        }
        if self.max_public_reference_chain_messages != 3 {
            anyhow::bail!("Context Delivery Profile reference-chain limit is invalid");
        }
        if self.max_self_active_tasks != 8 {
            anyhow::bail!("Context Delivery Profile self-active Task limit is invalid");
        }
        Ok(self)
    }

    pub fn canonical_digest(self) -> Result<String> {
        canonical_json_digest(&serde_json::to_value(self)?)
    }
}

pub const CONTEXT_DELIVERY_PROFILE_V3: ContextDeliveryProfile = ContextDeliveryProfile {
    profile_version: 3,
    max_public_messages: 15,
    max_public_history_chars: 24_000,
    max_message_body_chars: 2_000,
    max_public_reference_chain_messages: 3,
    max_self_active_tasks: 8,
};

pub fn current_context_delivery_profile() -> Result<ContextDeliveryProfile> {
    CONTEXT_DELIVERY_PROFILE_V3.validate()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyPrefix {
    pub body: String,
    pub body_length: usize,
    pub body_truncated: bool,
    pub next_body_offset: Option<usize>,
}

pub fn body_prefix(body: &str, max_chars: usize) -> BodyPrefix {
    let body_length = body.chars().count();
    let body_truncated = body_length > max_chars;
    let retained = body_length.min(max_chars);
    BodyPrefix {
        body: if body_truncated {
            body.chars().take(retained).collect()
        } else {
            body.to_string()
        },
        body_length,
        body_truncated,
        next_body_offset: body_truncated.then_some(retained),
    }
}

pub fn unicode_scalar_count(value: &str) -> usize {
    value.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_v3_is_current_and_has_a_stable_digest() {
        let profile = current_context_delivery_profile().unwrap();
        assert_eq!(profile.profile_version, 3);
        assert_eq!(profile.max_public_messages, 15);
        assert_eq!(profile.max_public_history_chars, 24_000);
        assert_eq!(profile.max_message_body_chars, 2_000);
        assert_eq!(profile.max_public_reference_chain_messages, 3);
        assert_eq!(profile.max_self_active_tasks, 8);
        assert_eq!(profile.canonical_digest().unwrap().len(), 64);
    }

    #[test]
    fn profile_validation_rejects_unknown_versions_and_invalid_limits() {
        for invalid in [
            ContextDeliveryProfile {
                profile_version: 2,
                ..CONTEXT_DELIVERY_PROFILE_V3
            },
            ContextDeliveryProfile {
                max_public_messages: 0,
                ..CONTEXT_DELIVERY_PROFILE_V3
            },
            ContextDeliveryProfile {
                max_message_body_chars: 24_001,
                ..CONTEXT_DELIVERY_PROFILE_V3
            },
            ContextDeliveryProfile {
                max_public_reference_chain_messages: 4,
                ..CONTEXT_DELIVERY_PROFILE_V3
            },
            ContextDeliveryProfile {
                max_self_active_tasks: 9,
                ..CONTEXT_DELIVERY_PROFILE_V3
            },
        ] {
            assert!(invalid.validate().is_err());
        }
    }

    #[test]
    fn body_prefix_counts_unicode_scalars_and_never_appends_an_ellipsis() {
        let prefix = body_prefix("甲😀乙丙", 3);
        assert_eq!(prefix.body, "甲😀乙");
        assert_eq!(prefix.body_length, 4);
        assert!(prefix.body_truncated);
        assert_eq!(prefix.next_body_offset, Some(3));

        let complete = body_prefix("甲😀乙", 3);
        assert_eq!(complete.body, "甲😀乙");
        assert_eq!(complete.body_length, 3);
        assert!(!complete.body_truncated);
        assert_eq!(complete.next_body_offset, None);
    }
}
