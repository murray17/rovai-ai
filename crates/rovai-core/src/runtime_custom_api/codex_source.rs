//! Read-only source references retained for frozen native connection snapshots.
use super::native::{self, NativeContext};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub base: PathBuf,
    pub profile: Option<PathBuf>,
    /// Only an actually old CLI may interpret the inline selector.
    pub legacy: bool,
    pub rejected_selector: bool,
    #[serde(default)]
    pub launcher_identity: String,
    #[serde(default)]
    pub field_overrides: BTreeMap<String, String>,
    #[serde(default)]
    pub selected_provider: Option<String>,
    #[serde(default)]
    pub target_unconfirmed: bool,
    #[serde(default)]
    pub read_error: Option<String>,
}
// No discovery commands are issued for the retired editor. An ordinary native
// launch uses the base file; preserved frozen contexts may still name a profile.
pub fn resolve(_context: &NativeContext) -> Option<Source> {
    None
}

pub fn read(context: &NativeContext) -> Result<Value> {
    let base = context
        .codex_source
        .as_ref()
        .map(|s| s.base.clone())
        .unwrap_or_else(|| context.directory.join("config.toml"));
    let parse = |path: &Path| -> Result<Value> {
        let doc = native::read_toml(path)?;
        let value: toml::Value = toml::from_str(&doc.to_string())?;
        Ok(serde_json::to_value(value)?)
    };
    let mut value = parse(&base)?;
    if let Some(profile) = context
        .codex_source
        .as_ref()
        .and_then(|s| s.profile.as_ref())
    {
        merge(&mut value, parse(profile)?);
    } else if context.codex_source.as_ref().is_some_and(|s| s.legacy) {
        if let Some(profile) = value["profile"]
            .as_str()
            .and_then(|p| value["profiles"].get(p))
            .cloned()
        {
            merge(&mut value, profile);
        }
    }
    Ok(value)
}
fn merge(base: &mut Value, upper: Value) {
    if let (Some(base), Some(upper)) = (base.as_object_mut(), upper.as_object()) {
        for (key, value) in upper {
            merge(
                base.entry(key.clone()).or_insert(Value::Null),
                value.clone(),
            );
        }
    } else {
        *base = upper;
    }
}
pub fn field_file(context: &NativeContext, keys: &[&str]) -> PathBuf {
    if let Some(source) = &context.codex_source {
        if let Some(profile) = &source.profile {
            if native::read_toml(profile).ok().is_some_and(|doc| {
                let mut value = doc.as_item();
                for key in keys {
                    let Some(next) = value.get(key) else {
                        return false;
                    };
                    value = next;
                }
                !value.is_none()
            }) {
                return profile.clone();
            }
        }
        return source.base.clone();
    }
    context.path()
}
