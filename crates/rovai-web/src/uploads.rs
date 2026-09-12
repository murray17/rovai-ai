use super::*;
use axum::extract::Multipart;
use rovai_core::{
    draft_client::DraftClient, local_attachment_source::observe_source_attachment,
    web_upload::UploadIntent,
};
use sha2::{Digest, Sha256};

pub const MAX_BYTES: usize = 20 * 1024 * 1024;

pub async fn upload(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    mut multipart: Multipart,
) -> Response {
    let Ok(_permit) = state.uploads.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "upload_capacity");
    };
    let mut intent = None;
    let mut contents = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => return error(StatusCode::BAD_REQUEST, "invalid_upload"),
        };
        match field.name() {
            Some("intent") if intent.is_none() => {
                let Ok(text) = field.text().await else {
                    return error(StatusCode::BAD_REQUEST, "invalid_upload");
                };
                intent = serde_json::from_str::<UploadIntent>(&text).ok();
                if intent.is_none() {
                    return error(StatusCode::BAD_REQUEST, "invalid_upload");
                }
            }
            Some("file") if contents.is_none() => {
                let Ok(bytes) = field.bytes().await else {
                    return error(StatusCode::PAYLOAD_TOO_LARGE, "upload_too_large");
                };
                if bytes.len() > MAX_BYTES {
                    return error(StatusCode::PAYLOAD_TOO_LARGE, "upload_too_large");
                }
                contents = Some(bytes);
            }
            _ => return error(StatusCode::BAD_REQUEST, "invalid_upload"),
        }
    }
    let (Some(intent), Some(contents)) = (intent, contents) else {
        return error(StatusCode::BAD_REQUEST, "invalid_upload");
    };
    let hash = Sha256::digest(&contents)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if hash != intent.sha256
        || contents.len() as u64 != intent.byte_size
        || *session.revoked.borrow()
        || session.expires_at <= std::time::Instant::now()
    {
        return error(StatusCode::BAD_REQUEST, "upload_changed_or_session_expired");
    }
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    // Receipt lookup happens before creating a second temporary file.
    if let Ok(reply) = state
        .core
        .request_for_editor("host.upload.reconcile", json!(intent), client.clone())
        .await
    {
        if reply.error.is_some() {
            return error(StatusCode::CONFLICT, "upload_conflict");
        }
        if reply
            .result
            .as_ref()
            .is_some_and(|result| !result["receipt"].is_null())
        {
            return upload_draft(&state, &intent, &client).await;
        }
    } else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "core_unavailable");
    }
    // Cancellation of the HTTP handler must not remove a possibly-bound source.
    // The task owns cleanup until Core returns a definitive binding result.
    let task = tokio::spawn(async move {
        let _permit = _permit;
        let directory = std::env::temp_dir().join(format!("rovai-web-upload-{}", new_token()?));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new().mode(0o700).create(&directory)?;
        }
        #[cfg(not(unix))]
        rovai_core::platform::prepare_private_directory(&directory)?;
        let path = directory.join("source");
        let mut submitted = false;
        let bound = async {
            tokio::fs::write(&path, &contents).await?;
            let media = if contents.starts_with(b"\x89PNG\r\n\x1a\n") {
                Some("image/png")
            } else if contents.starts_with(b"\xff\xd8\xff") {
                Some("image/jpeg")
            } else if contents.starts_with(b"RIFF") && contents.get(8..12) == Some(b"WEBP") {
                Some("image/webp")
            } else {
                None
            };
            let mut source = observe_source_attachment(&path, &intent.display_name, media)?;
            source.id = intent.command_id.clone();
            submitted = true;
            let reply = state
                .core
                .request_for_editor(
                    "host.upload.bind",
                    json!({"intent":intent,"source":source}),
                    client.clone(),
                )
                .await;
            match reply {
                Ok(reply) if reply.error.is_none() => {
                    let result = reply.result.context("upload binding result missing")?;
                    // A replay belongs to its original file, so this duplicate
                    // never became a source and can be cleaned.
                    if result["replayed"] == true {
                        let _ = tokio::fs::remove_dir_all(&directory).await;
                    }
                    Ok::<_, anyhow::Error>(Json(json!({"draft":result["draft"]})).into_response())
                }
                Ok(_) => {
                    // Core can report a post-commit error. Consult the canonical
                    // receipt before deciding whether the file is still unbound.
                    if let Ok(receipt) = state
                        .core
                        .request_for_editor("host.upload.reconcile", json!(intent), client.clone())
                        .await
                    {
                        if receipt.error.is_none()
                            && receipt
                                .result
                                .as_ref()
                                .is_some_and(|value| value["receipt"].is_null())
                        {
                            let _ = tokio::fs::remove_dir_all(&directory).await;
                            return Ok(error(StatusCode::CONFLICT, "draft_changed"));
                        }
                        if receipt.error.is_none() {
                            return Ok(upload_draft(&state, &intent, &client).await);
                        }
                    }
                    Ok(error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "upload_binding_unknown",
                    ))
                }
                Err(_) => Ok(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "upload_binding_unknown",
                )),
            }
        }
        .await;
        if bound.is_err() && !submitted {
            let _ = tokio::fs::remove_dir_all(&directory).await;
        }
        bound
    });
    match task.await {
        Ok(Ok(response)) => response,
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "upload_binding_unknown"),
    }
}

async fn upload_draft(state: &WebState, intent: &UploadIntent, client: &DraftClient) -> Response {
    match state
        .core
        .request_for_editor(
            "camp.composerDraft.get",
            json!({"campId":intent.camp_id}),
            client.clone(),
        )
        .await
    {
        Ok(reply) if reply.error.is_none() => Json(json!({"draft":reply.result})).into_response(),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "upload_binding_unknown"),
    }
}

pub async fn reconcile(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(intent): Json<UploadIntent>,
) -> Response {
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    match state
        .core
        .request_for_editor("host.upload.reconcile", json!(intent), client.clone())
        .await
    {
        Ok(reply) if reply.error.is_none() => {
            if reply
                .result
                .as_ref()
                .is_some_and(|value| !value["receipt"].is_null())
            {
                upload_draft(&state, &intent, &client).await
            } else {
                Json(json!({"state":"unknown"})).into_response()
            }
        }
        _ => error(StatusCode::CONFLICT, "upload_conflict"),
    }
}
