use super::failure::HubFailure;
use serde_json::Value;
use std::io::{self, Write};
use tokio_tungstenite::tungstenite::{Error, protocol::WebSocketConfig};

// The native v1 history command returns one complete array, without pagination.
// Bound both a fragmented message and an individual frame before allocation.
// Beyond this ceiling recovery fails explicitly and leaves native history intact.
pub(super) const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

pub(super) fn socket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES))
}

pub(super) fn socket_failure(error: &Error) -> HubFailure {
    if matches!(error, Error::Capacity(_)) {
        HubFailure::Transport {
            code: "cline_hub_message_limit_exceeded",
        }
    } else {
        HubFailure::disconnected()
    }
}

pub(super) fn encode(value: &Value) -> Result<String, HubFailure> {
    struct Bounded(Vec<u8>);
    impl Write for Bounded {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if bytes.len() > MAX_MESSAGE_BYTES.saturating_sub(self.0.len()) {
                return Err(io::Error::other("Hub request exceeds message budget"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut output = Bounded(Vec::new());
    serde_json::to_writer(&mut output, value).map_err(|_| HubFailure::Transport {
        code: "cline_hub_request_limit_exceeded",
    })?;
    // serde_json emits UTF-8, including for escaped control characters.
    Ok(String::from_utf8(output.0).expect("JSON serialization emits UTF-8"))
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::{io::AsyncWriteExt, net::TcpListener};
    use tokio_tungstenite::{accept_async, connect_async_with_config, tungstenite::Message};

    #[tokio::test]
    async fn long_history_crosses_old_frame_limit_but_excess_is_rejected_before_body_allocation() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let message =
                serde_json::json!({"messages":[{"content":"x".repeat(17 * 1024 * 1024)}]});
            socket
                .send(Message::Text(encode(&message).unwrap().into()))
                .await
                .unwrap();
            // A real server frame header declares an oversized body. No body is
            // sent: the client must detect the limit instead of waiting for it.
            let mut header = vec![0x81, 127];
            header.extend_from_slice(&((MAX_MESSAGE_BYTES + 1) as u64).to_be_bytes());
            socket.get_mut().write_all(&header).await.unwrap();
        });
        let (mut socket, _) =
            connect_async_with_config(format!("ws://{address}"), Some(socket_config()), false)
                .await
                .unwrap();
        let frame = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let history: Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(
            history["messages"][0]["content"].as_str().unwrap().len(),
            17 * 1024 * 1024
        );
        let error = socket.next().await.unwrap().unwrap_err();
        assert_eq!(
            socket_failure(&error),
            HubFailure::Transport {
                code: "cline_hub_message_limit_exceeded"
            }
        );
        server.await.unwrap();
        let too_large = serde_json::json!("x".repeat(MAX_MESSAGE_BYTES));
        assert_eq!(
            encode(&too_large).unwrap_err(),
            HubFailure::Transport {
                code: "cline_hub_request_limit_exceeded"
            }
        );
    }
}
