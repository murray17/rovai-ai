use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::command::canonical_json_digest;

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
        if !matches!(self.profile_version, 5 | 6 | 7 | 8 | 9 | 10) {
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
        canonical_json_digest(&self.frozen_json()?)
    }

    pub fn frozen_json(self) -> Result<Value> {
        if matches!(self.profile_version, 9 | 10) {
            self.validate()?;
            Ok(json!({
                "profileVersion": self.profile_version,
                "maxSelfActiveTasks": self.max_self_active_tasks,
            }))
        } else {
            Ok(serde_json::to_value(self)?)
        }
    }

    pub fn from_frozen_json(value: &str) -> Result<Self> {
        let value: Value = serde_json::from_str(value)?;
        if matches!(value.get("profileVersion"), Some(version) if version == &json!(9) || version == &json!(10))
        {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct PublicProfile9 {
                profile_version: i64,
                max_self_active_tasks: usize,
            }
            let selected: PublicProfile9 = serde_json::from_value(value)?;
            let profile = ContextDeliveryProfile {
                profile_version: selected.profile_version,
                max_self_active_tasks: selected.max_self_active_tasks,
                ..PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V10
            };
            profile.validate()
        } else {
            serde_json::from_value::<Self>(value)?.validate()
        }
    }
}

pub const CONTEXT_DELIVERY_PROFILE_V5: ContextDeliveryProfile = ContextDeliveryProfile {
    profile_version: 5,
    max_public_messages: 15,
    max_public_history_chars: 24_000,
    max_message_body_chars: 2_000,
    max_public_reference_chain_messages: 3,
    max_self_active_tasks: 8,
};

pub const CONTEXT_DELIVERY_PROFILE_V6: ContextDeliveryProfile = ContextDeliveryProfile {
    profile_version: 6,
    ..CONTEXT_DELIVERY_PROFILE_V5
};

pub const PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V7: ContextDeliveryProfile =
    ContextDeliveryProfile {
        profile_version: 7,
        ..CONTEXT_DELIVERY_PROFILE_V6
    };

pub const PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V8: ContextDeliveryProfile =
    ContextDeliveryProfile {
        profile_version: 8,
        ..PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V7
    };

pub const CURRENT_CONTEXT_DELIVERY_PROFILE_V7: ContextDeliveryProfile = ContextDeliveryProfile {
    profile_version: 7,
    ..CONTEXT_DELIVERY_PROFILE_V6
};

pub const PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V9: ContextDeliveryProfile =
    ContextDeliveryProfile {
        profile_version: 9,
        ..PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V8
    };

pub const PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V10: ContextDeliveryProfile =
    ContextDeliveryProfile {
        profile_version: 10,
        ..PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V9
    };

pub fn current_context_delivery_profile() -> Result<ContextDeliveryProfile> {
    CURRENT_CONTEXT_DELIVERY_PROFILE_V7.validate()
}

pub fn current_public_camp_batch_context_delivery_profile() -> Result<ContextDeliveryProfile> {
    PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V10.validate()
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
    fn profile_v7_is_current_for_single_chat_and_v10_owns_public_batches() {
        assert_eq!(
            current_context_delivery_profile().unwrap(),
            CURRENT_CONTEXT_DELIVERY_PROFILE_V7
        );
        assert_eq!(
            current_public_camp_batch_context_delivery_profile().unwrap(),
            PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V10
        );
        let frozen = PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V10
            .frozen_json()
            .unwrap();
        assert_eq!(
            frozen,
            json!({"profileVersion": 10, "maxSelfActiveTasks": 8})
        );
        assert_eq!(
            ContextDeliveryProfile::from_frozen_json(&frozen.to_string()).unwrap(),
            PUBLIC_CAMP_BATCH_CONTEXT_DELIVERY_PROFILE_V10
        );
        assert_eq!(
            CONTEXT_DELIVERY_PROFILE_V5.canonical_digest().unwrap(),
            "707f88f4ed1c657b59b48f77ab82d1baf5b2663f3b8faf997a4802402e981352"
        );
    }

    #[test]
    fn profile_validation_rejects_unknown_versions_and_invalid_limits() {
        for invalid in [
            ContextDeliveryProfile {
                profile_version: 11,
                ..CONTEXT_DELIVERY_PROFILE_V6
            },
            ContextDeliveryProfile {
                max_public_messages: 0,
                ..CONTEXT_DELIVERY_PROFILE_V6
            },
            ContextDeliveryProfile {
                max_message_body_chars: 24_001,
                ..CONTEXT_DELIVERY_PROFILE_V6
            },
            ContextDeliveryProfile {
                max_public_reference_chain_messages: 4,
                ..CONTEXT_DELIVERY_PROFILE_V6
            },
            ContextDeliveryProfile {
                max_self_active_tasks: 9,
                ..CONTEXT_DELIVERY_PROFILE_V6
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
