use crate::{WebState, error};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Browse {
    path: Option<PathBuf>,
    #[serde(default)]
    offset: usize,
}

// Authenticated Owner browsing is bounded discovery, not a directory grant.
// Core's existing inspect/validate/create paths remain the business authority.
pub async fn browse(State(state): State<WebState>, Json(body): Json<Browse>) -> Response {
    let Ok(_permit) = state.requests.try_acquire() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "request_capacity");
    };
    let path = body.path.unwrap_or_else(|| {
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    });
    if !path.is_absolute() || body.offset > 1_000_000 {
        return error(StatusCode::BAD_REQUEST, "invalid_workspace_path");
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let path = tokio::fs::canonicalize(path).await?;
        let mut entries = tokio::fs::read_dir(&path).await?;
        let mut index = 0;
        let mut directories = Vec::new();
        let mut next_offset = None;
        while let Some(entry) = entries.next_entry().await? {
            index += 1;
            if index <= body.offset { continue; }
            if tokio::fs::metadata(entry.path()).await.is_ok_and(|metadata| metadata.is_dir()) {
                directories.push(json!({"name":entry.file_name().to_string_lossy(), "projectPath":entry.path()}));
            }
            if directories.len() == 256 || index - body.offset == 4096 {
                next_offset = Some(index);
                break;
            }
        }
        let mut roots = Vec::new();
        #[cfg(windows)]
        for drive in b'A'..=b'Z' {
            let root = format!("{}:\\", char::from(drive));
            if tokio::fs::metadata(&root).await.is_ok_and(|meta| meta.is_dir()) { roots.push(root); }
        }
        #[cfg(not(windows))]
        roots.push("/".to_owned());
        Ok::<_, std::io::Error>(json!({"projectPath":path, "name":path.file_name().unwrap_or(path.as_os_str()).to_string_lossy(), "parentPath":path.parent(), "roots":roots, "directories":directories, "nextOffset":next_offset}))
    }).await;
    match result {
        Ok(Ok(listing)) => Json(listing).into_response(),
        Ok(Err(_)) => error(StatusCode::BAD_REQUEST, "workspace_unavailable"),
        Err(_) => error(StatusCode::GATEWAY_TIMEOUT, "workspace_unavailable"),
    }
}
