//! A closed Desktop capability, never a generic Core or Electron RPC proxy.
use crate::{WebState, error};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{future::Future, pin::Pin};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelKind {
    Feishu,
    Lark,
    Dingtalk,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChannelRequest {
    Get {},
    #[serde(rename_all = "camelCase")]
    Publish {
        kind: ChannelKind,
        agent_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Retry {
        kind: ChannelKind,
        agent_id: String,
    },
    #[serde(rename_all = "camelCase")]
    SelectApprover {
        kind: ChannelKind,
        agent_id: String,
        user_id: String,
    },
}

impl ChannelRequest {
    pub fn valid(&self) -> bool {
        let id = |value: &str| {
            !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        };
        match self {
            Self::Get {} => true,
            Self::Publish { agent_id, .. } | Self::Retry { agent_id, .. } => id(agent_id),
            Self::SelectApprover {
                kind,
                agent_id,
                user_id,
            } => matches!(kind, ChannelKind::Dingtalk) && id(agent_id) && id(user_id),
        }
    }
}

pub type ChannelReply = Result<Value, &'static str>;
pub type ChannelFuture<'a> = Pin<Box<dyn Future<Output = ChannelReply> + Send + 'a>>;
pub trait ChannelHost: Send + Sync {
    fn call(&self, request: ChannelRequest) -> ChannelFuture<'_>;
}

pub(crate) async fn request(
    State(state): State<WebState>,
    body: Result<Json<ChannelRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Some(host) = state.channels.as_ref() else {
        return error(StatusCode::NOT_IMPLEMENTED, "channels_unsupported");
    };
    let Ok(Json(request)) = body else {
        return error(StatusCode::BAD_REQUEST, "operation_not_admitted");
    };
    if !request.valid() {
        return error(StatusCode::BAD_REQUEST, "operation_not_admitted");
    }
    match host.call(request).await {
        Ok(snapshot) => Json(json!({"result":snapshot,"error":null})).into_response(),
        Err(code) => error(StatusCode::SERVICE_UNAVAILABLE, code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn admitted(request: Value) -> bool {
        serde_json::from_value::<ChannelRequest>(request).is_ok_and(|request| request.valid())
    }

    #[test]
    fn lark_is_admitted_for_publish_and_retry_and_round_trips_its_kind() {
        for operation in ["publish", "retry"] {
            for kind in ["feishu", "lark", "dingtalk"] {
                let request = json!({"operation":operation,"kind":kind,"agentId":"agent_1"});
                assert!(admitted(request.clone()), "{operation} {kind}");
                let parsed: ChannelRequest = serde_json::from_value(request.clone()).unwrap();
                assert_eq!(serde_json::to_value(parsed).unwrap(), request);
            }
        }
    }

    #[test]
    fn select_approver_admits_only_dingtalk() {
        let select = |kind: &str| json!({"operation":"selectApprover","kind":kind,"agentId":"agent_1","userId":"user_1"});
        assert!(admitted(select("dingtalk")));
        assert!(!admitted(select("feishu")));
        assert!(!admitted(select("lark")));
    }

    #[test]
    fn unknown_or_miscased_kinds_are_rejected() {
        for kind in [
            json!("Lark"),
            json!("LARK"),
            json!("telegram"),
            json!(""),
            json!(null),
            json!(1),
        ] {
            let request = json!({"operation":"publish","kind":kind,"agentId":"agent_1"});
            assert!(!admitted(request), "{kind}");
        }
    }
}
