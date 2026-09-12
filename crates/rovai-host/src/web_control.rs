use rovai_core::application::{
    CoreService, HostControl, HostControlError, HostControlFuture, HostWebOperation,
};
use rovai_web::{WebConfig, WebServer, new_token};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct WebControl {
    core: CoreService,
    server: Mutex<Option<WebServer>>,
}

impl WebControl {
    pub fn new(core: CoreService) -> Arc<Self> {
        Arc::new(Self {
            core,
            server: Mutex::new(None),
        })
    }

    pub async fn start(&self, config: WebConfig, token: &str) -> anyhow::Result<Value> {
        let mut server = self.server.lock().await;
        anyhow::ensure!(server.is_none(), "Web service is already running");
        let running = WebServer::start(self.core.clone(), config, token).await?;
        let status = running.status();
        *server = Some(running);
        Ok(status)
    }

    pub async fn stop(&self) {
        let server = self.server.lock().await.take();
        if let Some(server) = server {
            server.stop().await;
        }
    }
}

impl HostControl for WebControl {
    fn web(&self, operation: HostWebOperation, params: Value) -> HostControlFuture<'_> {
        Box::pin(async move {
            let invalid = || HostControlError {
                code: "HOST_WEB_INVALID_CONFIG",
                message: "Web 配置无效，请检查监听地址、公开地址和 WebUI 目录。".into(),
            };
            match operation {
                HostWebOperation::Status => Ok(self
                    .server
                    .lock()
                    .await
                    .as_ref()
                    .map(WebServer::status)
                    .unwrap_or_else(|| json!({"enabled":false,"sessions":0}))),
                HostWebOperation::Token => {
                    let server = self.server.lock().await;
                    let server = server.as_ref().ok_or(HostControlError {
                        code: "HOST_WEB_DISABLED",
                        message: "请先开启远程连接。".into(),
                    })?;
                    Ok(json!({"administratorToken":server.administrator_token()}))
                }
                HostWebOperation::Start => {
                    let config: WebConfig =
                        serde_json::from_value(params).map_err(|_| invalid())?;
                    let token = new_token().map_err(|_| HostControlError {
                        code: "HOST_RANDOM_UNAVAILABLE",
                        message: "系统随机数暂不可用。".into(),
                    })?;
                    let mut status = self.start(config, &token).await.map_err(|_| HostControlError { code: "HOST_WEB_START_FAILED", message: "Web 服务未开启。请检查端口是否被占用、WebUI 是否已构建，以及局域网访问是否已明确开启。".into() })?;
                    // The closed, parent-owned pipe returns this only to the
                    // local manager. It is absent from status and diagnostics.
                    status["administratorToken"] = json!(token);
                    Ok(status)
                }
                HostWebOperation::Stop => {
                    self.stop().await;
                    Ok(json!({"enabled":false,"sessions":0}))
                }
                HostWebOperation::Rotate => {
                    let server = self.server.lock().await;
                    let server = server.as_ref().ok_or(HostControlError {
                        code: "HOST_WEB_DISABLED",
                        message: "请先开启 Web 服务。".into(),
                    })?;
                    let token = server.rotate().map_err(|_| invalid())?;
                    let mut status = server.status();
                    status["administratorToken"] = json!(token);
                    Ok(status)
                }
            }
        })
    }
}
