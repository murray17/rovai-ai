mod auth;
mod channels;
pub use channels::{ChannelFuture, ChannelHost, ChannelReply, ChannelRequest};
mod avatars;
mod network;
mod operations;
mod resources;
mod updates;
mod uploads;
mod workspaces;
pub use updates::{UpdateFuture, UpdateHost, UpdateRequest};

use anyhow::{Context, Result, ensure};
use auth::{LOGIN_TICKET_LIFETIME, LoginFailure, SESSION_LIFETIME, Session, Sessions, TicketGrant};
pub use auth::{Sessions as WebSessions, new_token, stored_administrator_token};
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

const HOST_WEB_PROTOCOL_VERSION: u32 = 4;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebConfig {
    pub listen: SocketAddr,
    #[serde(default)]
    pub public_origin: Option<String>,
    #[serde(default)]
    pub allow_insecure_lan: bool,
    pub ui_directory: PathBuf,
}

#[derive(Clone)]
struct WebState {
    core: CoreService,
    channels: Option<Arc<dyn ChannelHost>>,
    updates: Option<Arc<dyn UpdateHost>>,
    sessions: Arc<Sessions>,
    network: Arc<network::Network>,
    assets: PathBuf,
    cached_assets: Arc<std::collections::HashMap<String, String>>,
    epoch: String,
    requests: Arc<Semaphore>,
    uploads: Arc<Semaphore>,
    files: Arc<resources::Handles>,
}

/// Owns only a network listener and its credentials. Stopping or dropping it
/// never stops, replaces, or creates a Core runner.
pub struct WebServer {
    network: Arc<network::Network>,
    sessions: Arc<Sessions>,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<std::io::Result<()>>,
}

impl WebServer {
    pub async fn start(core: CoreService, config: WebConfig, administrator: &str) -> Result<Self> {
        Self::start_with_channels(core, config, administrator, None).await
    }

    pub async fn start_with_channels(
        core: CoreService,
        config: WebConfig,
        administrator: &str,
        channels: Option<Arc<dyn ChannelHost>>,
    ) -> Result<Self> {
        Self::start_with_sessions(
            core,
            config,
            Arc::new(Sessions::new(administrator)?),
            channels,
        )
        .await
    }

    pub async fn start_with_sessions(
        core: CoreService,
        config: WebConfig,
        sessions: Arc<Sessions>,
        channels: Option<Arc<dyn ChannelHost>>,
    ) -> Result<Self> {
        Self::start_with_services(core, config, sessions, channels, None).await
    }

    pub async fn start_with_services(
        core: CoreService,
        config: WebConfig,
        sessions: Arc<Sessions>,
        channels: Option<Arc<dyn ChannelHost>>,
        updates: Option<Arc<dyn UpdateHost>>,
    ) -> Result<Self> {
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
        let listener = TcpListener::bind(config.listen)
            .await
            .context("Web address could not be bound")?;
        let address = listener.local_addr()?;
        let network = Arc::new(network::Network::new(address, config.public_origin)?);
        let cached_assets = Arc::new(load_asset_cache(&assets).await);
        let state = WebState {
            core,
            channels,
            updates,
            sessions: sessions.clone(),
            network: network.clone(),
            assets,
            cached_assets,
            epoch: new_token()?,
            requests: Arc::new(Semaphore::new(64)),
            uploads: Arc::new(Semaphore::new(4)),
            files: Arc::new(resources::Handles::default()),
        };
        sessions.enable();
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
            network,
            sessions,
            shutdown: Some(shutdown),
            task,
        })
    }

    pub fn status(&self) -> Value {
        let addresses = self.network.addresses().unwrap_or_default();
        let mut status = json!({"enabled":!self.task.is_finished(), "addresses":addresses, "listen":self.network.listen.to_string(), "sessions":self.sessions.count(), "sessionLifetimeSeconds":SESSION_LIFETIME.as_secs()});
        if let Some(address) = addresses.first() {
            status["origin"] = json!(address.origin);
        }
        status
    }
    pub fn administrator_token(&self) -> String {
        self.sessions.administrator_token()
    }
    pub fn rotate(&self) -> Result<String> {
        let token = new_token()?;
        self.sessions.rotate(&token)?;
        Ok(token)
    }
    pub fn login_ticket(&self) -> Result<Value> {
        ensure!(!self.task.is_finished(), "Web service is disabled");
        Ok(
            json!({"ticket":self.sessions.login_ticket()?,"expiresInSeconds":LOGIN_TICKET_LIFETIME.as_secs()}),
        )
    }
    pub async fn shutdown(mut self) {
        self.sessions.suspend();
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
        self.sessions.suspend();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task.abort();
    }
}

fn routes(state: WebState) -> Router {
    let api = Router::new()
        .route("/capabilities", get(capabilities))
        .route("/channels", post(channels::request))
        .route("/updates", post(updates::request))
        .route("/request", post(request))
        .route("/events", get(events))
        .route("/logout", post(logout))
        .route("/session", post(resume_session))
        .route("/session/renew", post(renew_session))
        .route("/workspaces", post(workspaces::browse))
        .route(
            "/uploads",
            post(uploads::upload).layer(DefaultBodyLimit::max(uploads::MAX_BYTES + 16384)),
        )
        .route("/uploads/reconcile", post(uploads::reconcile))
        .route(
            "/avatars",
            post(avatars::avatar).layer(DefaultBodyLimit::max(24 * 1024 * 1024)),
        )
        .route("/files", post(resources::files))
        .route("/files/bytes", post(resources::binary))
        .route("/attachments", post(resources::attachment))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate));
    Router::new()
        .nest("/api/v1", api)
        .route("/api/v1/login", post(login))
        .route("/api/v1/login-ticket", post(redeem_login_ticket))
        .route("/", get(index))
        .route("/preview.html", get(preview_shell))
        .route(
            "/preview-assets/{token}/{*path}",
            get(resources::preview_asset),
        )
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
    let preview_shell = req.uri().path() == "/preview.html";
    let preview_asset = req.uri().path().starts_with("/preview-assets/")
        && matches!(
            *req.method(),
            axum::http::Method::GET | axum::http::Method::HEAD
        );
    let checked_origin = if preview_asset && origin.is_some_and(|v| v == "null") {
        None
    } else {
        origin.and_then(|v| v.to_str().ok())
    };
    let mut response = if !state.network.allows(host, checked_origin)
        || origin.is_some_and(|value| value.to_str().is_err())
    {
        error(StatusCode::FORBIDDEN, "origin_not_allowed")
    } else if req.uri().query().is_some() && !preview_asset {
        // Credentials and API parameters have no URL representation.
        error(StatusCode::BAD_REQUEST, "query_not_allowed")
    } else {
        next.run(req).await
    };
    let immutable = response.extensions().get::<ImmutableAsset>().is_some();
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if immutable {
            "public, max-age=31536000, immutable"
        } else {
            "no-store"
        }),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"));
    if preview_asset && response.status().is_success() {
        // Preserve the existing resource response policy, including direct navigation.
        response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(
            "sandbox allow-scripts; default-src 'none'; script-src http: https: data: 'unsafe-inline' 'unsafe-eval'; style-src http: https: 'unsafe-inline'; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https: ws: wss:; frame-src http: https: data:; frame-ancestors 'self'; object-src 'none'; base-uri http: https:; form-action 'none'"));
    }
    if preview_shell && response.status().is_success() {
        // Only the trusted HTML preview shell gets these capabilities. Keep its CSP
        // sandbox aligned with the Web iframe; workspace/API policies stay strict.
        response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(
            "sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals; default-src 'none'; script-src http: https: data: 'unsafe-inline' 'unsafe-eval'; style-src http: https: 'unsafe-inline'; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https: ws: wss:; frame-src http: https: data:; frame-ancestors 'self'; object-src 'none'; base-uri http: https:; form-action http: https:"));
    }
    if preview_asset {
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
    }
    let headers = response.headers_mut();
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
    if body.protocol_version != HOST_WEB_PROTOCOL_VERSION {
        return error(StatusCode::CONFLICT, "protocol_incompatible");
    }
    let generation = match state.sessions.authorize_login(&body.administrator_token) {
        Ok(generation) => generation,
        Err(failure) => return login_failure(failure),
    };
    finish_login(state, body.editor, LoginGrant::Administrator(generation)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TicketLogin {
    protocol_version: u32,
    ticket: String,
    #[serde(default)]
    editor: Option<EditorResume>,
}

enum LoginGrant {
    Administrator(u64),
    Ticket(TicketGrant),
}

async fn redeem_login_ticket(
    State(state): State<WebState>,
    body: std::result::Result<Json<TicketLogin>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return error(StatusCode::BAD_REQUEST, "invalid_login");
    };
    if body.protocol_version != HOST_WEB_PROTOCOL_VERSION {
        return error(StatusCode::CONFLICT, "protocol_incompatible");
    }
    let grant = match state.sessions.authorize_ticket(&body.ticket) {
        Ok(grant) => grant,
        Err(failure) => return ticket_failure(failure),
    };
    finish_login(state, body.editor, LoginGrant::Ticket(grant)).await
}

async fn finish_login(
    state: WebState,
    editor: Option<EditorResume>,
    grant: LoginGrant,
) -> Response {
    let identity = match state
        .core
        .request("host.editor.resolve", json!(editor))
        .await
    {
        Ok(reply) if reply.error.is_none() => reply.result.unwrap_or(Value::Null),
        _ => return error(StatusCode::UNAUTHORIZED, "editor_resume_denied"),
    };
    let Some(client_id) = identity["clientId"].as_str() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "editor_unavailable");
    };
    let ticket = matches!(grant, LoginGrant::Ticket(_));
    let result = match grant {
        LoginGrant::Administrator(generation) => {
            state.sessions.issue(generation, client_id.to_owned())
        }
        LoginGrant::Ticket(grant) => state.sessions.issue_ticket(grant, client_id.to_owned()),
    };
    match result {
        Ok((token, session)) => {
            let mut response = state.sessions.timing(&session);
            response.as_object_mut().expect("session timing").extend(json!({"protocolVersion":HOST_WEB_PROTOCOL_VERSION,"token":token,"clientId":session.client_id,"editorProof":identity["proof"],"ownerId":identity["ownerId"],"epoch":state.epoch,"channels":if state.channels.is_some() { "desktop" } else { "unsupported" }}).as_object().expect("session response").clone());
            Json(response).into_response()
        }
        Err(failure) if ticket => ticket_failure(failure),
        Err(failure) => login_failure(failure),
    }
}

fn ticket_failure(failure: LoginFailure) -> Response {
    match failure {
        LoginFailure::Unauthorized => error(StatusCode::UNAUTHORIZED, "login_ticket_invalid"),
        failure => login_failure(failure),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionResume {
    #[serde(default)]
    editor: Option<EditorResume>,
    #[serde(default)]
    fork: bool,
}

// Bearer authentication is checked by the same middleware as every business API.
// Resume verifies both the Session binding and Core-owned editing proof. A copied
// tab may create a fresh editor but cannot choose another editor by submitting an ID.
async fn resume_session(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(body): Json<SessionResume>,
) -> Response {
    // A browser reopened without a tab editor uses its persisted ordinary
    // Bearer only to create a fresh editor. Restoring an existing editor always
    // requires its Core proof; a caller cannot select another tab's drafts.
    if body
        .editor
        .as_ref()
        .is_some_and(|editor| editor.client_id != session.client_id)
        || (!body.fork && body.editor.is_none())
    {
        return error(StatusCode::UNAUTHORIZED, "editor_resume_denied");
    }
    let identity = if let Some(editor) = body.editor {
        match state
            .core
            .request("host.editor.resolve", json!(editor))
            .await
        {
            Ok(reply) if reply.error.is_none() => reply.result.unwrap_or(Value::Null),
            _ => return error(StatusCode::UNAUTHORIZED, "editor_resume_denied"),
        }
    } else {
        Value::Null
    };
    if !state.sessions.is_live(&session) {
        return error(StatusCode::UNAUTHORIZED, "session_required");
    }
    let mut identity = if body.fork {
        match state.core.request("host.editor.resolve", Value::Null).await {
            Ok(reply) if reply.error.is_none() => reply.result.unwrap_or(Value::Null),
            _ => return error(StatusCode::SERVICE_UNAVAILABLE, "editor_unavailable"),
        }
    } else {
        identity
    };
    let mut timing = state.sessions.timing(&session);
    if body.fork {
        let Some(client_id) = identity["clientId"].as_str() else {
            return error(StatusCode::SERVICE_UNAVAILABLE, "editor_unavailable");
        };
        match state.sessions.fork(&session, client_id.to_owned()) {
            Ok((token, child)) => {
                timing = state.sessions.timing(&child);
                identity["token"] = json!(token);
            }
            Err(failure) => return login_failure(failure),
        }
    }
    identity
        .as_object_mut()
        .expect("Core identity")
        .extend(timing.as_object().expect("session timing").clone());
    identity["editorProof"] = identity["proof"].take();
    identity
        .as_object_mut()
        .expect("Core identity object")
        .remove("proof");
    identity["protocolVersion"] = json!(HOST_WEB_PROTOCOL_VERSION);
    identity["channels"] = json!(if state.channels.is_some() {
        "desktop"
    } else {
        "unsupported"
    });
    Json(identity).into_response()
}

fn login_failure(failure: LoginFailure) -> Response {
    match failure {
        LoginFailure::Unauthorized => {
            error(StatusCode::UNAUTHORIZED, "invalid_administrator_token")
        }
        LoginFailure::Storage => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "session_storage_unavailable",
        ),
        LoginFailure::Throttled | LoginFailure::Capacity => {
            error(StatusCode::TOO_MANY_REQUESTS, "login_limited")
        }
    }
}

async fn logout(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
) -> Response {
    match state.sessions.revoke(&session) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "session_storage_unavailable",
        ),
    }
}

async fn renew_session(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
) -> Response {
    match state.sessions.renew(&session) {
        Ok(timing) => Json(timing).into_response(),
        Err(LoginFailure::Unauthorized) => error(StatusCode::UNAUTHORIZED, "session_required"),
        Err(failure) => login_failure(failure),
    }
}

async fn capabilities(State(state): State<WebState>) -> Json<Value> {
    Json(
        json!({"protocolVersion":HOST_WEB_PROTOCOL_VERSION,"epoch":state.epoch,"read":true,"composer":true,"uploads":true,"approval":true,"nativeFilePicker":false,"desktopWindow":false,"releaseQualified":false,"channels":if state.channels.is_some() { "desktop" } else { "unsupported" }}),
    )
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
    let Ok(_permit) = state.requests.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "request_capacity");
    };
    let preview_release_camp_id = matches!(
        body.operation,
        operations::Operation::CampDelete | operations::Operation::CampDiscardPending
    )
    .then(|| {
        body.params["command"]["campId"]
            .as_str()
            .map(str::to_string)
    })
    .flatten();
    let result = tokio::time::timeout(
        body.operation.timeout(),
        state.core.request_for_editor(
            body.operation.method(),
            body.params,
            rovai_core::draft_client::DraftClient::verified_web(&session.client_id)
                .expect("Host-created editor identity"),
        ),
    )
    .await;
    match result {
        Ok(Ok(reply)) => {
            let accepted = reply.error.is_none()
                && reply
                    .result
                    .as_ref()
                    .and_then(|value| value.get("status"))
                    .and_then(Value::as_str)
                    .is_some_and(|status| status != "rejected");
            if accepted && let Some(camp_id) = preview_release_camp_id.as_deref() {
                state.files.release_camp(camp_id);
            }
            Json(json!({"result":reply.result.map(|value| body.operation.project(value)),"error":reply.error})).into_response()
        }
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
    let mut expiry = session.expires_at.subscribe();
    let stream = async_stream::stream! {
        let _permit = permit;
        let mut revision = 0u64;
        // Invalidation stream, not a replay of raw internal Core events. Every
        // reconnect and lag requires an authorized snapshot before showing live.
        yield Ok::<_, Infallible>(Event::default().event("resync").data(json!({"epoch":state.epoch,"revision":revision}).to_string()));
        loop {
            if !state.sessions.is_live(&session) { break; }
            let remaining = Duration::from_millis((*expiry.borrow_and_update()).saturating_sub(state.sessions.now()));
            tokio::select! {
                biased;
                _ = revoked.changed() => break,
                _ = expiry.changed() => continue,
                _ = tokio::time::sleep(remaining.min(Duration::from_secs(60))) => continue,
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
async fn preview_shell(State(state): State<WebState>) -> Response {
    static_file(&state, "preview.html").await
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
        Some("html") if matches!(relative, "index.html" | "preview.html") => {
            "text/html; charset=utf-8"
        }
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("woff2") => "font/woff2",
        Some("png") => "image/png",
        Some("avif") => "image/avif",
        Some("webp") => "image/webp",
        Some("jpg" | "jpeg") => "image/jpeg",
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
        Ok(bytes) => {
            use sha2::{Digest, Sha256};
            let immutable = state
                .cached_assets
                .get(relative)
                .is_some_and(|expected| *expected == format!("{:x}", Sha256::digest(&bytes)));
            // Public presentation metadata only. Credentials and capabilities
            // remain behind authentication; the entry itself is never cached.
            let bytes = if relative == "index.html" {
                let Ok(html) = String::from_utf8(bytes) else {
                    return error(StatusCode::INTERNAL_SERVER_ERROR, "invalid_web_entry");
                };
                html.replace(
                    "__ROVAI_HOST_KIND__",
                    if state.channels.is_some() {
                        "desktop"
                    } else {
                        "server"
                    },
                )
                .into_bytes()
            } else {
                bytes
            };
            let mut response =
                ([(header::CONTENT_TYPE, content_type)], Body::from(bytes)).into_response();
            if immutable {
                response.extensions_mut().insert(ImmutableAsset);
            }
            response
        }
        Err(_) => error(StatusCode::NOT_FOUND, "asset_not_found"),
    }
}

#[derive(Clone, Copy)]
struct ImmutableAsset;

async fn load_asset_cache(root: &std::path::Path) -> std::collections::HashMap<String, String> {
    use tokio::io::AsyncReadExt;
    let Ok(file) = tokio::fs::File::open(root.join("asset-cache.json")).await else {
        return Default::default();
    };
    let mut bytes = Vec::new();
    if file
        .take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .await
        .is_err()
        || bytes.len() > 256 * 1024
    {
        return Default::default();
    }
    let Ok(mut entries) =
        serde_json::from_slice::<std::collections::HashMap<String, String>>(&bytes)
    else {
        return Default::default();
    };
    entries.retain(|path, digest| {
        let Some(name) = path
            .strip_prefix("assets/")
            .filter(|name| !name.contains(['/', '\\']))
        else {
            return false;
        };
        let Some((stem, _extension)) = name.rsplit_once('.') else {
            return false;
        };
        let Some(hash) = stem
            .get(stem.len().saturating_sub(9)..)
            .and_then(|suffix| suffix.strip_prefix('-'))
        else {
            return false;
        };
        hash.len() == 8
            && hash
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            && digest.len() == 64
            && digest.bytes().all(|b| b.is_ascii_hexdigit())
    });
    entries
}
