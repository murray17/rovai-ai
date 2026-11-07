use crate::native_interaction::{
    NativeInteractionAnswer, NativeInteractionStatus as Status, NativeInteractionView,
    NativeQuestion, NativeQuestionKind, NativeQuestionOption,
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct PiInteractions {
    pub entries: HashMap<String, PiInteraction>,
}

pub(super) struct PiInteraction {
    pub view: NativeInteractionView,
    pub answer_preview: Option<String>,
    pub native_id: Value,
    method: String,
}

impl PiInteractions {
    pub fn register(
        &mut self,
        request: &Value,
        run_id: &str,
        epoch: i64,
        received_at: i64,
    ) -> Result<bool> {
        let method = request["method"]
            .as_str()
            .context("Pi dialog omitted method")?;
        if !matches!(method, "confirm" | "select" | "input" | "editor") {
            return Ok(false);
        }
        super::value_id(&request["id"]).context("Pi dialog omitted request ID")?;
        let native_id = request["id"].clone();
        if self
            .entries
            .values()
            .any(|entry| entry.native_id == native_id)
        {
            return Ok(true);
        }
        let title = request["title"]
            .as_str()
            .context("Pi dialog omitted title")?
            .to_owned();
        let options = if method == "select" {
            request["options"]
                .as_array()
                .context("Pi select omitted options")?
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    Ok(NativeQuestionOption {
                        id: index.to_string(),
                        label: value
                            .as_str()
                            .context("Pi select option is not text")?
                            .to_owned(),
                    })
                })
                .collect::<Result<Vec<_>>>()?
        } else {
            Vec::new()
        };
        let expires_at = if method != "editor" {
            request
                .get("timeout")
                .filter(|value| !value.is_null())
                .map(|value| {
                    let milliseconds = value
                        .as_f64()
                        .filter(|n| n.is_finite() && *n >= 0.0)
                        .context("Pi dialog timeout is invalid")?;
                    // Pi only starts its native timer for a truthy timeout; zero has no deadline.
                    Ok::<Option<i64>, anyhow::Error>((milliseconds > 0.0).then(|| {
                        received_at.saturating_add(milliseconds.ceil().min(i64::MAX as f64) as i64)
                    }))
                })
                .transpose()?
                .flatten()
        } else {
            None
        };
        let id = uuid::Uuid::new_v4().to_string();
        self.entries.insert(
            id.clone(),
            PiInteraction {
                native_id,
                answer_preview: None,
                method: method.to_owned(),
                view: NativeInteractionView {
                    id,
                    agent_run_id: run_id.to_owned(),
                    execution_epoch: epoch,
                    can_skip: true,
                    created_at: received_at,
                    expires_at,
                    status: Status::Pending,
                    questions: vec![NativeQuestion {
                        id: "question".into(),
                        kind: match method {
                            "confirm" => NativeQuestionKind::Confirm,
                            "select" => NativeQuestionKind::Select,
                            _ => NativeQuestionKind::Input,
                        },
                        title,
                        description: request
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        placeholder: request
                            .get("placeholder")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        prefill: request
                            .get("prefill")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        multiline: method == "editor",
                        options,
                    }],
                },
            },
        );
        Ok(true)
    }

    pub fn pending(&mut self, now: i64) -> Vec<NativeInteractionView> {
        self.entries
            .values_mut()
            .filter_map(|entry| {
                entry.expire(now);
                matches!(entry.view.status, Status::Pending | Status::Unknown)
                    .then(|| entry.view.clone())
            })
            .collect()
    }
}

impl PiInteraction {
    pub fn expire(&mut self, now: i64) {
        if self.view.status == Status::Pending && self.view.expires_at.is_some_and(|end| now >= end)
        {
            self.view.status = Status::Expired;
            self.view.questions.clear();
        }
    }

    pub fn response(&self, answer: &NativeInteractionAnswer) -> Result<Value> {
        let mut response = json!({"type":"extension_ui_response", "id":self.native_id});
        match answer {
            NativeInteractionAnswer::Skip => response["cancelled"] = json!(true),
            NativeInteractionAnswer::Confirm { confirmed } if self.method == "confirm" => {
                response["confirmed"] = json!(confirmed)
            }
            NativeInteractionAnswer::Input { value }
                if matches!(self.method.as_str(), "input" | "editor") =>
            {
                response["value"] = json!(value)
            }
            NativeInteractionAnswer::Select { option_id } if self.method == "select" => {
                let option = self.view.questions[0]
                    .options
                    .iter()
                    .find(|option| option.id == *option_id)
                    .context("Answer does not belong to this Pi select")?;
                response["value"] = json!(option.label);
            }
            _ => bail!("Answer does not match this Pi dialog"),
        }
        Ok(response)
    }
}
