mod auth;
mod operations;
mod resources;
mod uploads;

use anyhow::{Context, Result, ensure};
pub use auth::new_token;
use auth::{LoginFailure, SESSION_LIFETIME, Session, Sessions};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Extension, Path, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use rovai_core::application::CoreService;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{convert::Infallible, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    net::TcpListener,
    sync::{Semaphore, oneshot},
    task::JoinHandle,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebConfig {
    pub listen: SocketAddr,
    #[serde(default)]
    pub public_origin: Option<String>,
    #[serde(default)]
    pub allow_insecure_lan: bool,
    pub ui_directory: PathBuf,
    /// Explicit local-operator grants. Browsers select these roots, never grant
    /// new Host paths by submitting a string.
    #[serde(default)]
    pub authorized_workspaces: Vec<PathBuf>,
}

#[derive(Clone)]
struct WebState {
    core: CoreService,
    sessions: Arc<Sessions>,
    origin: String,
    authority: String,
    assets: PathBuf,
    epoch: String,
    requests: Arc<Semaphore>,
    workspaces: Arc<Vec<PathBuf>>,
    uploads: Arc<Semaphore>,
    files: Arc<resources::Handles>,
}

/// Owns only a network listener and its credentials. Stopping or dropping it
/// never stops, replaces, or creates a Core runner.
pub struct WebServer {
    pub origin: String,
    sessions: Arc<Sessions>,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<std::io::Result<()>>,
}

impl WebServer {
    pub async fn start(core: CoreService, config: WebConfig, administrator: &str) -> Result<Self> {
        ensure!(
            config.listen.ip().is_loopback() || config.allow_insecure_lan,
            "LAN HTTP must be explicitly enabled; use HTTPS or a trusted VPN on untrusted networks"
        );
        ensure!(
            config.ui_directory.is_absolute(),
            "Web UI directory must be absolute"
        );
        let assets = tokio::fs::canonicalize(&config.ui_directory)
            .await
            .context("Web UI directory is unavailable")?;
        ensure!(
            assets.is_dir() && assets.join("index.html").is_file(),
            "Web UI build is missing index.html"
        );
        let sessions = Arc::new(Sessions::new(administrator)?);
        let mut workspaces = Vec::new();
        ensure!(
            config.authorized_workspaces.len() <= 64,
            "too many workspace grants"
        );
        for root in &config.authorized_workspaces {
            ensure!(root.is_absolute(), "workspace grants must be absolute");
            let root = tokio::fs::canonicalize(root).await?;
            ensure!(root.is_dir(), "workspace grant must be a directory");
            if !workspaces.contains(&root) {
                workspaces.push(root);
            }
        }
        let listener = TcpListener::bind(config.listen)
            .await
            .context("Web address could not be bound")?;
        let address = listener.local_addr()?;
        let origin = match config.public_origin {
            Some(origin) => origin,
            None => {
                ensure!(
                    address.ip().is_loopback(),
                    "LAN requires an explicit publicOrigin"
                );
                format!("http://{address}")
            }
        };
        let url = url::Url::parse(&origin).context("invalid console origin")?;
        ensure!(
            matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
                && url.path() == "/",
            "console origin must have no credentials, path, query or fragment"
        );
        let origin = url.origin().ascii_serialization();
        let authority = origin
            .split_once("://")
            .expect("validated HTTP origin")
            .1
            .to_owned();
        let state = WebState {
            core,
            sessions: sessions.clone(),
            origin: origin.clone(),
            authority,
            assets,
            epoch: new_token()?,
            requests: Arc::new(Semaphore::new(64)),
            workspaces: Arc::new(workspaces),
            uploads: Arc::new(Semaphore::new(4)),
            files: Arc::new(resources::Handles::default()),
        };
        let app = routes(state);
        let (shutdown, stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
        });
        Ok(Self {
            origin,
            sessions,
            shutdown: Some(shutdown),
            task,
        })
    }

    pub fn status(&self) -> Value {
        json!({"enabled":!self.task.is_finished(), "origin":self.origin, "sessions":self.sessions.count(), "sessionLifetimeSeconds":SESSION_LIFETIME.as_secs()})
    }
    pub fn rotate(&self) -> Result<String> {
        let token = new_token()?;
        self.sessions.rotate(&token)?;
        Ok(token)
    }
    pub async fn stop(mut self) {
        self.sessions.close();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if tokio::time::timeout(Duration::from_secs(1), &mut self.task)
            .await
            .is_err()
        {
            self.task.abort();
        }
    }
}

impl Drop for WebServer {
    fn drop(&mut self) {
        self.sessions.close();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task.abort();
    }
}

fn routes(state: WebState) -> Router {
    let api = Router::new()
        .route("/capabilities", get(capabilities))
        .route("/request", post(request))
        .route("/events", get(events))
        .route("/logout", post(logout))
        .route("/workspaces", get(workspaces))
        .route(
            "/uploads",
            post(uploads::upload).layer(DefaultBodyLimit::max(uploads::MAX_BYTES + 16384)),
        )
        .route("/uploads/reconcile", post(uploads::reconcile))
        .route("/files", post(resources::files))
        .route("/attachments", post(resources::attachment))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate));
    Router::new()
        .nest("/api/v1", api)
        .route("/api/v1/login", post(login))
        .route("/", get(index))
        .route("/assets/{*path}", get(asset))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), boundary))
        .with_state(state)
}

fn error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(json!({"error":{"code":code}}))).into_response()
}

async fn boundary(State(state): State<WebState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let origin = req.headers().get(header::ORIGIN);
    let mut response = if host != Some(&state.authority)
        || origin.is_some_and(|value| value.to_str().ok() != Some(&state.origin))
    {
        error(StatusCode::FORBIDDEN, "origin_not_allowed")
    } else if req.uri().query().is_some() {
        // Credentials and API parameters have no URL representation.
        error(StatusCode::BAD_REQUEST, "query_not_allowed")
    } else {
        next.run(req).await
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    response
}

async fn authenticate(State(state): State<WebState>, mut req: Request, next: Next) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let Some(session) = token.and_then(|token| state.sessions.authenticate(token)) else {
        return error(StatusCode::UNAUTHORIZED, "session_required");
    };
    req.extensions_mut().insert(session);
    next.run(req).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Login {
    protocol_version: u32,
    administrator_token: String,
    #[serde(default)]
    editor: Option<EditorResume>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditorResume {
    client_id: String,
    proof: String,
}

async fn login(
    State(state): State<WebState>,
    body: std::result::Result<Json<Login>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return error(StatusCode::BAD_REQUEST, "invalid_login");
    };
    if body.protocol_version != 2 {
        return error(StatusCode::CONFLICT, "protocol_incompatible");
    }
    let generation = match state.sessions.authorize_login(&body.administrator_token) {
        Ok(generation) => generation,
        Err(failure) => return login_failure(failure),
    };
    let identity = match state
        .core
        .request("host.editor.resolve", json!(body.editor))
        .await
    {
        Ok(reply) if reply.error.is_none() => reply.result.unwrap_or(Value::Null),
        _ => return error(StatusCode::UNAUTHORIZED, "editor_resume_denied"),
    };
    let Some(client_id) = identity["clientId"].as_str() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "editor_unavailable");
    };
    match state.sessions.issue(generation, client_id.to_owned()) {
        Ok((token, session)) => Json(json!({"protocolVersion":2,"token":token,"clientId":session.client_id,"editorProof":identity["proof"],"ownerId":identity["ownerId"],"expiresInSeconds":SESSION_LIFETIME.as_secs(),"epoch":state.epoch})).into_response(),
        Err(failure) => login_failure(failure),
    }
}

fn login_failure(failure: LoginFailure) -> Response {
    match failure {
        LoginFailure::Unauthorized => {
            error(StatusCode::UNAUTHORIZED, "invalid_administrator_token")
        }
        LoginFailure::Throttled | LoginFailure::Capacity => {
            error(StatusCode::TOO_MANY_REQUESTS, "login_limited")
        }
    }
}

async fn logout(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
) -> StatusCode {
    state.sessions.revoke(&session);
    StatusCode::NO_CONTENT
}

async fn capabilities(State(state): State<WebState>) -> Json<Value> {
    Json(
        json!({"protocolVersion":2,"epoch":state.epoch,"read":true,"composer":true,"uploads":true,"approval":true,"nativeFilePicker":false,"desktopWindow":false,"releaseQualified":false}),
    )
}

async fn workspaces(State(state): State<WebState>) -> Json<Value> {
    Json(json!(state.workspaces.iter().map(|path| json!({"projectPath":path, "name":path.file_name().and_then(|name| name.to_str()).unwrap_or("工作区")})).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationRequest {
    operation: operations::Operation,
    #[serde(default)]
    params: Value,
}

async fn request(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    body: std::result::Result<Json<OperationRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return error(StatusCode::BAD_REQUEST, "operation_not_admitted");
    };
    if !body
        .operation
        .paths_allowed(&body.params, &state.workspaces)
    {
        return error(StatusCode::FORBIDDEN, "workspace_not_authorized");
    }
    let Ok(_permit) = state.requests.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "request_capacity");
    };
    match tokio::time::timeout(
        body.operation.timeout(),
        state.core.request_for_editor(body.operation.method(), body.params, rovai_core::draft_client::DraftClient::verified_web(&session.client_id).expect("Host-created editor identity")),
    )
    .await
    {
        Ok(Ok(reply)) => Json(json!({"result":reply.result.map(|value| body.operation.project(value)),"error":reply.error})).into_response(),
        Ok(Err(_)) => error(StatusCode::SERVICE_UNAVAILABLE, "core_unavailable"),
        Err(_) => error(StatusCode::GATEWAY_TIMEOUT, "result_unavailable"),
    }
}

async fn events(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
) -> Response {
    let Ok(permit) = session.streams.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "subscription_capacity");
    };
    let mut source = state.core.subscribe();
    let mut revoked = session.revoked.subscribe();
    let expiry = tokio::time::Instant::from_std(session.expires_at);
    let stream = async_stream::stream! {
        let _permit = permit;
        let mut revision = 0u64;
        // Invalidation stream, not a replay of raw internal Core events. Every
        // reconnect and lag requires an authorized snapshot before showing live.
        yield Ok::<_, Infallible>(Event::default().event("resync").data(json!({"epoch":state.epoch,"revision":revision}).to_string()));
        loop {
            if *revoked.borrow() { break; }
            tokio::select! {
                biased;
                _ = revoked.changed() => break,
                _ = tokio::time::sleep_until(expiry) => break,
                result = source.recv() => {
                    if matches!(result, Err(tokio::sync::broadcast::error::RecvError::Closed)) { break; }
                    revision += 1;
                    let event = if result.is_err() { "resync" } else { "invalidate" };
                    yield Ok(Event::default().event(event).data(json!({"epoch":state.epoch,"revision":revision}).to_string()));
                    // Bound browser refresh work during Runtime output bursts.
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    };
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(10)))
        .into_response()
}

async fn index(State(state): State<WebState>) -> Response {
    static_file(&state, "index.html").await
}
async fn asset(State(state): State<WebState>, Path(path): Path<String>) -> Response {
    static_file(&state, &format!("assets/{path}")).await
}

async fn static_file(state: &WebState, relative: &str) -> Response {
    if relative.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains('\0')
    }) {
        return error(StatusCode::NOT_FOUND, "asset_not_found");
    }
    let path = state.assets.join(relative);
    let Ok(path) = tokio::fs::canonicalize(path).await else {
        return error(StatusCode::NOT_FOUND, "asset_not_found");
    };
    if !path.starts_with(&state.assets) {
        return error(StatusCode::NOT_FOUND, "asset_not_found");
    }
    let content_type = match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") if relative == "index.html" => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("woff2") => "font/woff2",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        _ => return error(StatusCode::NOT_FOUND, "asset_not_found"),
    };
    let Ok(metadata) = tokio::fs::metadata(&path).await else {
        return error(StatusCode::NOT_FOUND, "asset_not_found");
    };
    if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
        return error(StatusCode::NOT_FOUND, "asset_not_found");
    }
    match tokio::fs::read(path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type)], Body::from(bytes)).into_response(),
        Err(_) => error(StatusCode::NOT_FOUND, "asset_not_found"),
    }
}
