//! Custom-provider discovery uses Codex's effective config and the same launch
//! environment. Only public model metadata leaves this module; credentials and
//! provider responses never enter catalog diagnostics or persistence.
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, ensure};
use reqwest::{
    Client, RequestBuilder, Url,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde_json::{Value, json};

use crate::{agent_profile::AdapterKind, runtime_discovery};

const MAX_CATALOG_BYTES: usize = 4 * 1024 * 1024;
const UNCONFIGURED_API_KEY: &str = "ROVAI_UNCONFIGURED_API_KEY";
pub(crate) const CODEX_RUNTIME_DEFAULT_MODEL_ID: &str = "codex-cli://runtime-default";

// Codex owns these providers and their catalogs. A custom provider must be an
// explicit `model_providers` entry, not an OpenAI-compatible base URL override.
const BUILTIN_CODEX_PROVIDERS: &[&str] = &[
    "openai",
    "ollama",
    "lmstudio",
    "amazon-bedrock",
    "amazon-bedrock-runtime",
];

pub(crate) fn runtime_default_catalog() -> Value {
    json!({"data":[{
        "id": CODEX_RUNTIME_DEFAULT_MODEL_ID,
        "displayName": "Codex runtime default",
        "isDefault": true,
        "hidden": false,
        "supportedReasoningEfforts": []
    }]})
}

pub(crate) async fn model_catalog(
    config_read: &Value,
    codex_home: Option<&Path>,
) -> Result<Option<Value>> {
    let environment = runtime_discovery::runtime_environment(AdapterKind::CodexCli);
    let Some(request) = catalog_request(config_read, &environment, codex_home)? else {
        return Ok(None);
    };
    // Reqwest errors can contain credential-bearing URLs. Report only stage and
    // status, never the URL, headers or response body.
    let mut response = request.send().await.map_err(|_| {
        anyhow::anyhow!("Codex custom provider model discovery failed to connect (GET /models)")
    })?;
    ensure!(
        response.status().is_success(),
        "Codex custom provider GET /models returned HTTP {}",
        response.status().as_u16()
    );
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("Codex custom provider model response could not be read"))?
    {
        ensure!(
            body.len().saturating_add(chunk.len()) <= MAX_CATALOG_BYTES,
            "Codex custom provider model response exceeds 4 MiB"
        );
        body.extend_from_slice(&chunk);
    }
    let body: Value = serde_json::from_slice(&body)
        .map_err(|_| anyhow::anyhow!("Codex custom provider GET /models did not return JSON"))?;
    let default_model = config_read["config"]["model"].as_str();
    let catalog = normalize_catalog(&body, default_model);
    ensure!(
        catalog_has_usable_models(&catalog),
        "Codex custom provider GET /models returned no usable models"
    );
    Ok(Some(catalog))
}

fn catalog_has_usable_models(catalog: &Value) -> bool {
    catalog
        .get("data")
        .and_then(Value::as_array)
        .is_some_and(|models| {
            models.iter().any(|model| {
                model
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| !id.ends_with("://runtime-default"))
            })
        })
}

fn catalog_request(
    config_read: &Value,
    environment: &BTreeMap<String, String>,
    codex_home: Option<&Path>,
) -> Result<Option<RequestBuilder>> {
    let Some(config) = config_read.get("config").and_then(Value::as_object) else {
        return Ok(None);
    };
    let provider_id = config
        .get("model_provider")
        .and_then(Value::as_str)
        .unwrap_or("openai");
    if BUILTIN_CODEX_PROVIDERS.contains(&provider_id) {
        return Ok(None);
    }
    let Some(provider) = config
        .get("model_providers")
        .and_then(|providers| providers.get(provider_id))
        .and_then(Value::as_object)
    else {
        // A missing definition is not a custom provider we can inspect. Keep the
        // native catalog path and its existing diagnostics unchanged.
        return Ok(None);
    };
    // An explicitly configured native catalog remains authoritative. Adding
    // provider discovery must not require HTTP credentials for this older path.
    if [
        config.get("model_catalog_json"),
        config.get("model_catalog_url"),
        provider.get("model_catalog_url"),
    ]
    .into_iter()
    .flatten()
    .any(|value| value.as_str().is_some_and(|value| !value.is_empty()))
    {
        return Ok(None);
    }
    // Command-backed and AWS auth belong to Codex. Do not execute helpers or
    // substitute an unrelated account's token to populate a picker.
    ensure!(
        provider.get("auth").is_none_or(Value::is_null)
            && provider.get("aws").is_none_or(Value::is_null)
            && provider.get("gateway_oauth").is_none_or(Value::is_null),
        "Codex provider helper/AWS/OAuth auth cannot be used for GET /models; enter a model ID or use Default"
    );
    let Some(base_url) = provider.get("base_url").and_then(Value::as_str) else {
        return Ok(None);
    };
    let mut url = Url::parse(base_url)
        .map_err(|_| anyhow::anyhow!("Codex custom provider base_url is invalid"))?;
    ensure!(
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none(),
        "Codex provider base_url must be an HTTP(S) URL without embedded credentials or fragment"
    );
    url.set_path(&format!("{}/models", url.path().trim_end_matches('/')));
    if let Some(params) = provider.get("query_params").and_then(Value::as_object) {
        for (key, value) in params {
            url.query_pairs_mut().append_pair(
                key,
                value
                    .as_str()
                    .context("Codex provider query_params values must be strings")?,
            );
        }
    }
    let mut headers = HeaderMap::new();
    for (key, value) in provider
        .get("http_headers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        insert_header(
            &mut headers,
            key,
            value
                .as_str()
                .context("Codex provider header must be a string")?,
        )?;
    }
    for (key, variable) in provider
        .get("env_http_headers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let variable = variable
            .as_str()
            .context("Codex provider header environment name must be a string")?;
        if let Some(value) = environment.get(variable).filter(|value| !value.is_empty()) {
            insert_header(&mut headers, key, value)?;
        }
    }
    let key = if let Some(name) = provider
        .get("env_key")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
    {
        if name == UNCONFIGURED_API_KEY {
            None
        } else {
            Some(
                environment
                    .get(name)
                    .filter(|value| !value.trim().is_empty())
                    .with_context(|| {
                        format!(
                            "Codex provider env_key {name} is unavailable in the Runtime launch environment"
                        )
                    })?
                    .trim()
                    .to_owned(),
            )
        }
    } else if let Some(key) = provider
        .get("experimental_bearer_token")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
    {
        Some(key.to_owned())
    } else if provider
        .get("requires_openai_auth")
        .and_then(Value::as_bool)
        == Some(true)
    {
        if let Some(key) = environment
            .get("OPENAI_API_KEY")
            .filter(|value| !value.trim().is_empty())
        {
            Some(key.trim().to_owned())
        } else {
            let store = config
                .get("cli_auth_credentials_store")
                .and_then(Value::as_str)
                .unwrap_or("file");
            ensure!(
                store == "file",
                "Codex managed account auth is unavailable for GET /models; enter a model ID or use Default"
            );
            let home = codex_home
                .map(Path::to_path_buf)
                .or_else(|| {
                    environment
                        .get("CODEX_HOME")
                        .filter(|value| !value.is_empty())
                        .map(PathBuf::from)
                })
                .or_else(|| {
                    environment
                        .get(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                        .map(|home| PathBuf::from(home).join(".codex"))
                })
                .context("Codex home is unavailable for model discovery")?;
            let auth = crate::runtime_custom_api::native::read_json(&home.join("auth.json"))
                .map_err(|_| {
                    anyhow::anyhow!("Codex API-key auth file could not be read for model discovery")
                })?;
            ensure!(
                auth["auth_mode"] != "chatgpt",
                "ChatGPT account tokens are not used for custom provider model discovery"
            );
            Some(
                auth["OPENAI_API_KEY"]
                    .as_str()
                    .filter(|key| !key.is_empty())
                    .context(
                        "Codex API key is unavailable for GET /models; enter a model ID or use Default",
                    )?
                    .to_owned(),
            )
        }
    } else {
        None
    };
    if let Some(key) = key {
        insert_header(&mut headers, "authorization", &format!("Bearer {key}"))?;
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| anyhow::anyhow!("Codex model discovery HTTP client could not be created"))?;
    Ok(Some(client.get(url).headers(headers)))
}

fn insert_header(headers: &mut HeaderMap, name: &str, value: &str) -> Result<()> {
    let name = HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| anyhow::anyhow!("Codex provider HTTP header name is invalid"))?;
    let mut value = HeaderValue::from_str(value)
        .map_err(|_| anyhow::anyhow!("Codex provider HTTP header value is invalid"))?;
    value.set_sensitive(true);
    headers.insert(name, value);
    Ok(())
}

/// OpenAI-compatible `/models` responses are untrusted discovery data. Keep each
/// usable entry independently, matching the shared adapter's salvage contract.
fn normalize_catalog(response: &Value, default_model: Option<&str>) -> Value {
    let entries = response.get("data").and_then(Value::as_array);
    let mut ids = BTreeSet::new();
    let mut models = Vec::new();
    for entry in entries.into_iter().flatten() {
        let Some(id) = entry.get("id").and_then(Value::as_str) else {
            continue;
        };
        let id = id.trim();
        if id.is_empty()
            || id.chars().count() > 512
            || id.ends_with("://runtime-default")
            || id.chars().any(char::is_control)
            || !ids.insert(id.to_owned())
        {
            continue;
        }
        let display_name = entry
            .get("display_name")
            .or_else(|| entry.get("name"))
            .and_then(Value::as_str)
            .map(|name| {
                name.chars()
                    .filter(|character| !character.is_control())
                    .take(200)
                    .collect::<String>()
            })
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| id.to_owned());
        let display_name = display_name.trim();
        models.push(json!({
            "id": id,
            "displayName": display_name,
            "isDefault": default_model == Some(id),
            "hidden": false,
            "supportedReasoningEfforts": []
        }));
    }
    if !models.iter().any(|model| model["isDefault"] == true) {
        // The existing Ready contract needs a default *selection*. An OpenAI
        // /models response need not advertise Codex's actual default. Reuse its
        // existing policy sentinel rather than inventing a concrete default or
        // adding an unadvertised configured ID to the provider's model list.
        models.push(runtime_default_catalog()["data"][0].clone());
    }
    json!({"data": models})
}

#[cfg(test)]
mod tests {
    use super::*;

    // New owner: provider URL/header/auth resolution. No native process or DB is
    // needed; existing native snapshot tests do not make discovery requests.
    #[test]
    fn discovery_uses_only_selected_provider_and_its_credentials() {
        let root = std::env::temp_dir().join(format!("rovai-model-auth-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("auth.json"), r#"{"OPENAI_API_KEY":"file-key"}"#).unwrap();
        let environment = BTreeMap::from([
            ("CODEX_HOME".into(), root.to_string_lossy().into_owned()),
            ("RELAY_KEY".into(), "env-key".into()),
            ("RELAY_HEADER".into(), "env-header".into()),
            ("OPENAI_API_KEY".into(), "env-openai-key".into()),
        ]);
        let codex_home = Some(root.as_path());
        for (auth, expected) in [
            (json!({"env_key":"RELAY_KEY"}), Some("Bearer env-key")),
            (
                json!({"experimental_bearer_token":"inline-key"}),
                Some("Bearer inline-key"),
            ),
            (
                json!({"requires_openai_auth":true}),
                Some("Bearer env-openai-key"),
            ),
            (json!({"env_key":UNCONFIGURED_API_KEY}), None),
            (json!({}), None),
        ] {
            let mut provider = json!({"base_url":"https://relay.invalid/prefix/v1/?existing=yes",
                "query_params":{"api-version":"fixture"},
                "http_headers":{"x-trace":"static", "x-env":"old"},
                "env_http_headers":{"x-env":"RELAY_HEADER", "x-absent":"MISSING"}});
            provider
                .as_object_mut()
                .unwrap()
                .extend(auth.as_object().unwrap().clone());
            let config = json!({"config":{"model_provider":"relay", "model_providers":{
                "relay": provider, "unselected":{"base_url":"https://never.invalid"}}}});
            let request = catalog_request(&config, &environment, codex_home)
                .unwrap()
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(
                request.url().as_str(),
                "https://relay.invalid/prefix/v1/models?existing=yes&api-version=fixture"
            );
            assert_eq!(
                request
                    .headers()
                    .get("authorization")
                    .map(|value| value.to_str().unwrap()),
                expected
            );
            assert_eq!(request.headers()["x-trace"], "static");
            assert_eq!(request.headers()["x-env"], "env-header");
            assert!(!request.headers().contains_key("x-absent"));
        }
        let environment = BTreeMap::from([
            ("CODEX_HOME".into(), root.to_string_lossy().into_owned()),
            ("RELAY_KEY".into(), "env-key".into()),
        ]);
        for (auth, expected) in [
            (
                json!({"requires_openai_auth":true}),
                Some("Bearer file-key"),
            ),
            (
                json!({"requires_openai_auth":true, "env_key":UNCONFIGURED_API_KEY}),
                None,
            ),
        ] {
            let mut provider = json!({"base_url":"https://relay.invalid"});
            provider
                .as_object_mut()
                .unwrap()
                .extend(auth.as_object().unwrap().clone());
            let config = json!({"config":{"model_provider":"relay","model_providers":{
                "relay":provider}}});
            let request = catalog_request(&config, &environment, codex_home)
                .unwrap()
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(
                request
                    .headers()
                    .get("authorization")
                    .map(|value| value.to_str().unwrap()),
                expected
            );
        }
        for provider in [
            json!({"env_key":"MISSING"}),
            json!({"auth":{"command":"never-run"}}),
            json!({"aws":{"region":"fixture"}}),
            json!({"requires_openai_auth":true}),
        ] {
            let mut provider = provider;
            provider["base_url"] = json!("https://relay.invalid");
            let config = json!({"config":{"model_provider":"relay", "cli_auth_credentials_store":"keyring",
                "model_providers":{"relay":provider}}});
            assert!(
                catalog_request(&config, &environment, codex_home).is_err(),
                "never silently use another credential source"
            );
        }
        std::fs::write(root.join("auth.json"), r#"{"auth_mode":"chatgpt","OPENAI_API_KEY":"fake-openai-key","tokens":{"access_token":"private"}}"#).unwrap();
        let config = json!({"config":{"model_provider":"relay","model_providers":{"relay":{
            "base_url":"https://relay.invalid", "requires_openai_auth":true}}}});
        assert!(catalog_request(&config, &environment, codex_home).is_err());
        for id in BUILTIN_CODEX_PROVIDERS {
            assert!(
                catalog_request(
                    &json!({"config":{"model_provider":id}}),
                    &environment,
                    codex_home
                )
                .unwrap()
                .is_none()
            );
        }
        for (key, value) in [
            ("model_catalog_json", "fixture.json"),
            ("model_catalog_url", "https://native.invalid/catalog"),
        ] {
            let mut config = json!({"config":{"model_provider":"relay", "model_providers":{"relay":{
                "base_url":"https://relay.invalid", "env_key":"MISSING"}}}});
            if key == "model_catalog_json" {
                config["config"][key] = json!(value);
            } else {
                config["config"]["model_providers"]["relay"][key] = json!(value);
            }
            assert!(
                catalog_request(&config, &environment, codex_home)
                    .unwrap()
                    .is_none(),
                "explicit native catalogs retain their original auth contract"
            );
        }
        assert!(
            catalog_request(&json!({}), &environment, codex_home)
                .unwrap()
                .is_none()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn catalog_normalization_salvages_individual_entries() {
        let catalog = normalize_catalog(
            &json!({"data":[
                {"id":"first","display_name":"First"},
                {"id":"first","display_name":"Duplicate"},
                {"id":""},
                {"id":"bad\nid"},
                {"id":"codex-cli://runtime-default"},
                {"missing":"id"},
                {"id":"second","name":"Second"}
            ]}),
            Some("second"),
        );
        let models = catalog["data"].as_array().unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["id"], "first");
        assert_eq!(models[0]["displayName"], "First");
        assert_eq!(models[0]["isDefault"], false);
        assert_eq!(models[1]["id"], "second");
        assert_eq!(models[1]["displayName"], "Second");
        assert_eq!(models[1]["isDefault"], true);
        assert_eq!(models[0]["supportedReasoningEfforts"], json!([]));

        let sentinel = normalize_catalog(&json!({"data":[]}), Some("missing"));
        assert_eq!(sentinel["data"].as_array().unwrap().len(), 1);
        assert_eq!(sentinel["data"][0]["id"], CODEX_RUNTIME_DEFAULT_MODEL_ID);
        assert_eq!(sentinel["data"][0]["isDefault"], true);

        let missing_data = normalize_catalog(&json!({"unexpected":true}), None);
        assert_eq!(
            missing_data["data"][0]["id"],
            CODEX_RUNTIME_DEFAULT_MODEL_ID
        );
    }

    // New owner: actual HTTP boundary, redaction, and bounded provider response.
    // The existing JSON-RPC probe fixture cannot detect leaked headers/redirects.
    #[tokio::test]
    async fn provider_http_catalog_is_public_bounded_and_does_not_follow_redirects() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        for (status, body, expected) in [
            (
                200,
                r#"{"data":[{"id":"relay-only","display_name":"Relay Only","private_key":"DO-NOT-PERSIST"},{"id":"relay-only"},{"id":"other"},{"id":"bad\nid"}]}"#.to_owned(),
                Some(2),
            ),
            (200, r#"{"data":[]}"#.to_owned(), None),
            (
                200,
                r#"{"data":[{"id":"not-native-default"}]}"#.to_owned(),
                Some(1),
            ),
            (200, r#"{"data":[{"missing":"id"}]}"#.to_owned(), None),
            (200, "not-json DO-NOT-PERSIST".to_owned(), None),
            (200, "x".repeat(MAX_CATALOG_BYTES + 1), None),
            (401, "DO-NOT-PERSIST".to_owned(), None),
            (302, "DO-NOT-PERSIST".to_owned(), None),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let byte = stream.read_u8().await.unwrap();
                    request.push(byte);
                    assert!(request.len() < 8192);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("GET /prefix/v1/models "));
                assert!(
                    request
                        .to_lowercase()
                        .contains("authorization: bearer fixture-bearer\r\n")
                );
                let headers = format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nLocation: http://{address}/must-not-follow\r\nConnection: close\r\n\r\n", body.len());
                stream.write_all(headers.as_bytes()).await.unwrap();
                let _ = stream.write_all(body.as_bytes()).await;
            });
            let config = json!({"config":{"model_provider":"relay", "model":"relay-only", "model_providers":{"relay":{
                "base_url":format!("http://{address}/prefix/v1/"), "experimental_bearer_token":"fixture-bearer"}}}});
            let result = tokio::time::timeout(Duration::from_secs(5), model_catalog(&config, None))
                .await
                .unwrap();
            server.await.unwrap();
            if let Some(count) = expected {
                let catalog = result.unwrap().unwrap();
                let descriptors = crate::agent_runtime_adapter::codex_models(&catalog).unwrap();
                assert_eq!(
                    descriptors
                        .iter()
                        .filter(|model| !model.id.ends_with("://runtime-default"))
                        .count(),
                    count
                );
                assert!(
                    descriptors
                        .iter()
                        .any(|model| model.is_default && !model.hidden),
                    "Ready snapshot accepts missing/unlisted native defaults without fabricating a model"
                );
                assert!(!catalog.to_string().contains("DO-NOT-PERSIST"));
                if count == 2 {
                    assert_eq!(catalog["data"][0]["isDefault"], true);
                    assert_eq!(catalog["data"][0]["supportedReasoningEfforts"], json!([]));
                } else {
                    assert_eq!(
                        catalog["data"].as_array().unwrap().last().unwrap()["id"],
                        CODEX_RUNTIME_DEFAULT_MODEL_ID
                    );
                    if count == 1 {
                        assert_eq!(catalog["data"][0]["isDefault"], false);
                    }
                }
            } else {
                let error = format!("{:#}", result.unwrap_err());
                assert!(!error.contains("DO-NOT-PERSIST"));
                assert!(!error.contains("fixture-bearer"));
            }
        }
    }
}
