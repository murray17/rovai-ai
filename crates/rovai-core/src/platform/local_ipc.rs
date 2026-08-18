use std::{
    fmt, io,
    pin::Pin,
    task::{Context as TaskContext, Poll},
};

use anyhow::{Context, Result, bail};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use crate::builtin_tool_transport::LocalIpcEndpoint;

#[cfg(unix)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use tokio::net::windows::named_pipe::{
    ClientOptions, NamedPipeClient, NamedPipeServer, PipeMode, ServerOptions,
};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

/// Platform-neutral listener for authenticated local Core traffic.
///
/// The endpoint chooses the platform adapter once during binding. Callers only
/// receive an asynchronous byte stream and never manage socket files, named
/// pipe security attributes, or replacement pipe instances themselves.
pub struct LocalIpcListener {
    #[cfg(unix)]
    listener: UnixListener,
    #[cfg(unix)]
    socket_path: PathBuf,
    #[cfg(windows)]
    listener: NamedPipeServer,
    #[cfg(windows)]
    pipe_name: String,
}

impl LocalIpcListener {
    pub fn bind(endpoint: &LocalIpcEndpoint) -> Result<Self> {
        endpoint.validate()?;
        bind_platform_listener(endpoint)
    }

    /// Accepts one connection while preserving continuous listener admission.
    ///
    /// On Windows the next protected pipe instance is created before the
    /// connected instance is returned. Any replenishment failure therefore
    /// closes admission without dispatching the accepted request.
    pub async fn accept(&mut self) -> std::result::Result<LocalIpcStream, LocalIpcAcceptError> {
        accept_platform_stream(self).await
    }
}

/// Accept failure classified without exposing which platform adapter is active.
#[derive(Debug)]
pub struct LocalIpcAcceptError {
    error: anyhow::Error,
    closes_admission: bool,
}

impl LocalIpcAcceptError {
    pub fn closes_admission(&self) -> bool {
        self.closes_admission
    }

    #[cfg(unix)]
    fn retryable(error: anyhow::Error) -> Self {
        Self {
            error,
            closes_admission: false,
        }
    }

    #[cfg(not(unix))]
    fn admission_closed(error: anyhow::Error) -> Self {
        Self {
            error,
            closes_admission: true,
        }
    }
}

impl fmt::Display for LocalIpcAcceptError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if formatter.alternate() {
            write!(formatter, "{:#}", self.error)
        } else {
            write!(formatter, "{}", self.error)
        }
    }
}

impl std::error::Error for LocalIpcAcceptError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.error.as_ref())
    }
}

#[cfg(unix)]
fn bind_platform_listener(endpoint: &LocalIpcEndpoint) -> Result<LocalIpcListener> {
    let LocalIpcEndpoint::UnixSocket { path } = endpoint else {
        bail!("Unix Core requires a Unix socket Built-in Tool endpoint");
    };
    bind_unix_socket(path)
}

#[cfg(windows)]
fn bind_platform_listener(endpoint: &LocalIpcEndpoint) -> Result<LocalIpcListener> {
    let LocalIpcEndpoint::WindowsNamedPipe { name } = endpoint else {
        bail!("Windows Core requires a named-pipe Built-in Tool endpoint");
    };
    Ok(LocalIpcListener {
        listener: create_protected_named_pipe(name, true)?,
        pipe_name: name.clone(),
    })
}

#[cfg(not(any(unix, windows)))]
fn bind_platform_listener(_endpoint: &LocalIpcEndpoint) -> Result<LocalIpcListener> {
    bail!("Built-in Tool local IPC is unsupported on this platform")
}

#[cfg(unix)]
async fn accept_platform_stream(
    listener: &mut LocalIpcListener,
) -> std::result::Result<LocalIpcStream, LocalIpcAcceptError> {
    let (stream, _) = listener
        .listener
        .accept()
        .await
        .context("failed to accept Built-in Tool Unix socket connection")
        .map_err(LocalIpcAcceptError::retryable)?;
    Ok(LocalIpcStream { stream })
}

#[cfg(windows)]
async fn accept_platform_stream(
    listener: &mut LocalIpcListener,
) -> std::result::Result<LocalIpcStream, LocalIpcAcceptError> {
    listener
        .listener
        .connect()
        .await
        .context("failed to accept Built-in Tool named-pipe connection")
        .map_err(LocalIpcAcceptError::admission_closed)?;
    let replacement = create_protected_named_pipe(&listener.pipe_name, false)
        .context("failed to replenish Built-in Tool named-pipe listener")
        .map_err(LocalIpcAcceptError::admission_closed)?;
    let stream = std::mem::replace(&mut listener.listener, replacement);
    Ok(LocalIpcStream { stream })
}

#[cfg(not(any(unix, windows)))]
async fn accept_platform_stream(
    _listener: &mut LocalIpcListener,
) -> std::result::Result<LocalIpcStream, LocalIpcAcceptError> {
    Err(LocalIpcAcceptError::admission_closed(anyhow::anyhow!(
        "Built-in Tool local IPC is unsupported on this platform"
    )))
}

impl Drop for LocalIpcListener {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            let _ = std::fs::remove_file(&self.socket_path);
        }
    }
}

/// Platform-neutral asynchronous byte stream returned by [`LocalIpcListener`].
pub struct LocalIpcStream {
    #[cfg(unix)]
    stream: UnixStream,
    #[cfg(windows)]
    stream: NamedPipeServer,
}

/// Platform-neutral client stream for the bundled `rovai` CLI.
///
/// The caller owns framing, authentication, retries, and timeouts. This seam
/// owns only endpoint selection and platform handle admission so Unix and
/// Windows cannot drift into separate request/response implementations.
pub struct LocalIpcClientStream {
    #[cfg(unix)]
    stream: UnixStream,
    #[cfg(windows)]
    stream: NamedPipeClient,
}

impl LocalIpcClientStream {
    pub async fn connect(endpoint: &LocalIpcEndpoint) -> Result<Self> {
        endpoint.validate()?;
        connect_platform_stream(endpoint).await
    }
}

impl AsyncRead for LocalIpcStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        AsyncRead::poll_read(Pin::new(&mut self.get_mut().stream), cx, buffer)
    }
}

impl AsyncWrite for LocalIpcStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        AsyncWrite::poll_write(Pin::new(&mut self.get_mut().stream), cx, buffer)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        AsyncWrite::poll_flush(Pin::new(&mut self.get_mut().stream), cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        AsyncWrite::poll_shutdown(Pin::new(&mut self.get_mut().stream), cx)
    }
}

impl AsyncRead for LocalIpcClientStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        AsyncRead::poll_read(Pin::new(&mut self.get_mut().stream), cx, buffer)
    }
}

impl AsyncWrite for LocalIpcClientStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        AsyncWrite::poll_write(Pin::new(&mut self.get_mut().stream), cx, buffer)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        AsyncWrite::poll_flush(Pin::new(&mut self.get_mut().stream), cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        AsyncWrite::poll_shutdown(Pin::new(&mut self.get_mut().stream), cx)
    }
}

#[cfg(unix)]
async fn connect_platform_stream(endpoint: &LocalIpcEndpoint) -> Result<LocalIpcClientStream> {
    let LocalIpcEndpoint::UnixSocket { path } = endpoint else {
        bail!("Unix client requires a Unix socket Built-in Tool endpoint");
    };
    let stream = UnixStream::connect(path)
        .await
        .context("failed to connect to the Built-in Tool Unix socket")?;
    Ok(LocalIpcClientStream { stream })
}

#[cfg(windows)]
async fn connect_platform_stream(endpoint: &LocalIpcEndpoint) -> Result<LocalIpcClientStream> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation};

    let LocalIpcEndpoint::WindowsNamedPipe { name } = endpoint else {
        bail!("Windows client requires a named-pipe Built-in Tool endpoint");
    };
    let stream = ClientOptions::new()
        .open(name)
        .context("failed to connect to the Built-in Tool named pipe")?;
    let non_inheritable =
        unsafe { SetHandleInformation(stream.as_raw_handle() as _, HANDLE_FLAG_INHERIT, 0) };
    if non_inheritable == 0 {
        return Err(io::Error::last_os_error())
            .context("failed to make the Built-in Tool client handle non-inheritable");
    }
    Ok(LocalIpcClientStream { stream })
}

#[cfg(not(any(unix, windows)))]
async fn connect_platform_stream(_endpoint: &LocalIpcEndpoint) -> Result<LocalIpcClientStream> {
    bail!("Built-in Tool local IPC is unsupported on this platform")
}

#[cfg(unix)]
fn bind_unix_socket(path: &str) -> Result<LocalIpcListener> {
    let socket_path = Path::new(path);
    let directory = socket_path
        .parent()
        .context("Built-in Tool socket path has no parent directory")?;
    std::fs::create_dir_all(directory).with_context(|| {
        format!(
            "failed to create private Built-in Tool directory {}",
            directory.display()
        )
    })?;
    restrict_private_directory(directory)?;
    if socket_path.exists() {
        std::fs::remove_file(socket_path).with_context(|| {
            format!(
                "failed to remove stale Built-in Tool socket {}",
                socket_path.display()
            )
        })?;
    }
    let listener = UnixListener::bind(socket_path).with_context(|| {
        format!(
            "failed to bind private Built-in Tool socket {}",
            socket_path.display()
        )
    })?;
    if let Err(error) = restrict_private_file(socket_path) {
        drop(listener);
        let _ = std::fs::remove_file(socket_path);
        return Err(error);
    }
    Ok(LocalIpcListener {
        listener,
        socket_path: socket_path.to_path_buf(),
    })
}

#[cfg(unix)]
fn restrict_private_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).with_context(|| {
        format!(
            "failed to restrict private Built-in Tool directory {}",
            path.display()
        )
    })
}

#[cfg(unix)]
fn restrict_private_file(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).with_context(|| {
        format!(
            "failed to restrict private Built-in Tool socket {}",
            path.display()
        )
    })
}

#[cfg(windows)]
fn create_protected_named_pipe(name: &str, first_instance: bool) -> Result<NamedPipeServer> {
    use std::{ffi::c_void, os::windows::io::AsRawHandle};
    use windows_sys::Win32::{
        Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation},
        Security::SECURITY_ATTRIBUTES,
    };

    use super::windows_security::{PrivateObjectKind, PrivateSecurityDescriptor};

    let descriptor = PrivateSecurityDescriptor::new(PrivateObjectKind::NamedPipe)
        .context("failed to build the Built-in Tool named-pipe DACL")?;
    let mut attributes = descriptor.attributes();
    let mut options = ServerOptions::new();
    options
        .pipe_mode(PipeMode::Byte)
        .reject_remote_clients(true)
        .first_pipe_instance(first_instance);
    let created = unsafe {
        options.create_with_security_attributes_raw(
            name,
            &mut attributes as *mut SECURITY_ATTRIBUTES as *mut c_void,
        )
    };
    let server = created.context("failed to create protected Built-in Tool named pipe")?;
    let non_inheritable =
        unsafe { SetHandleInformation(server.as_raw_handle() as _, HANDLE_FLAG_INHERIT, 0) };
    if non_inheritable == 0 {
        return Err(std::io::Error::last_os_error())
            .context("failed to make the Built-in Tool named-pipe handle non-inheritable");
    }
    descriptor
        .verify_named_pipe_handle(server.as_raw_handle() as _)
        .context("Built-in Tool named-pipe DACL failed post-creation admission")?;
    Ok(server)
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let token = uuid::Uuid::new_v4().simple().to_string();
            let path =
                std::env::temp_dir().join(format!("ri-{}-{}", std::process::id(), &token[..8]));
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn unix_listener_owns_private_socket_lifecycle_and_byte_stream() {
        let root = TestDirectory::new();
        let socket_path = root.0.join("core.sock");
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: socket_path.to_string_lossy().into_owned(),
        };
        let mut listener = LocalIpcListener::bind(&endpoint).unwrap();

        assert_eq!(
            std::fs::metadata(&root.0).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&socket_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let client_endpoint = endpoint.clone();
        let client = tokio::spawn(async move {
            let mut stream = LocalIpcClientStream::connect(&client_endpoint)
                .await
                .unwrap();
            stream.write_all(b"ping").await.unwrap();
            let mut response = [0_u8; 4];
            stream.read_exact(&mut response).await.unwrap();
            response
        });
        let mut stream = listener.accept().await.unwrap();
        let mut request = [0_u8; 4];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(&request, b"ping");
        stream.write_all(b"pong").await.unwrap();
        assert_eq!(&client.await.unwrap(), b"pong");

        drop(listener);
        assert!(!socket_path.exists());
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use std::{os::windows::io::AsRawHandle, time::Duration};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use windows_sys::Win32::Foundation::{GetHandleInformation, HANDLE_FLAG_INHERIT};

    use super::*;

    fn test_endpoint() -> LocalIpcEndpoint {
        LocalIpcEndpoint::WindowsNamedPipe {
            name: format!(
                r"\\.\pipe\rovai-ai-test-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ),
        }
    }

    fn assert_non_inheritable(raw_handle: std::os::windows::io::RawHandle) {
        let mut flags = 0_u32;
        assert_ne!(
            unsafe { GetHandleInformation(raw_handle as _, &mut flags) },
            0,
            "GetHandleInformation failed: {}",
            io::Error::last_os_error()
        );
        assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
    }

    #[tokio::test]
    async fn windows_named_pipe_is_private_byte_mode_and_replenishes_before_dispatch() {
        tokio::time::timeout(Duration::from_secs(10), async {
            let endpoint = test_endpoint();
            let mut listener = LocalIpcListener::bind(&endpoint).unwrap();
            assert_non_inheritable(listener.listener.as_raw_handle());

            let collision = LocalIpcListener::bind(&endpoint)
                .err()
                .expect("a second first instance must be rejected");
            assert!(collision.to_string().contains("named pipe"));

            let first_endpoint = endpoint.clone();
            let first_client = tokio::spawn(async move {
                let mut stream = LocalIpcClientStream::connect(&first_endpoint)
                    .await
                    .unwrap();
                assert_non_inheritable(stream.stream.as_raw_handle());
                stream.write_all(b"pi").await.unwrap();
                tokio::task::yield_now().await;
                stream.write_all(b"ng-one").await.unwrap();
                let mut response = [0_u8; 8];
                stream.read_exact(&mut response).await.unwrap();
                response
            });
            let mut first_server = listener.accept().await.unwrap();
            assert_non_inheritable(first_server.stream.as_raw_handle());

            // The first accept replenishes the listener before returning the
            // connected instance, so a second client can connect while the
            // first request is still undispatched.
            let second_endpoint = endpoint.clone();
            let second_client = tokio::spawn(async move {
                let mut stream = LocalIpcClientStream::connect(&second_endpoint)
                    .await
                    .unwrap();
                stream.write_all(b"ping-two").await.unwrap();
                let mut response = [0_u8; 8];
                stream.read_exact(&mut response).await.unwrap();
                response
            });
            let mut second_server = listener.accept().await.unwrap();

            let mut first_request = [0_u8; 8];
            first_server.read_exact(&mut first_request).await.unwrap();
            assert_eq!(&first_request, b"ping-one");
            first_server.write_all(b"pong-one").await.unwrap();

            let mut second_request = [0_u8; 8];
            second_server.read_exact(&mut second_request).await.unwrap();
            assert_eq!(&second_request, b"ping-two");
            second_server.write_all(b"pong-two").await.unwrap();

            assert_eq!(&first_client.await.unwrap(), b"pong-one");
            assert_eq!(&second_client.await.unwrap(), b"pong-two");
        })
        .await
        .expect("Windows named-pipe lifecycle timed out");
    }
}
