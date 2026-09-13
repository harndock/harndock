use std::{
    fs,
    io::Read,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::Url;

pub(crate) const MAX_FRAME_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct ControlExpectation {
    pub(crate) nonce: String,
    pub(crate) runtime_version: String,
    pub(crate) runtime_api: u32,
    pub(crate) harness_commit: String,
}

#[derive(Debug)]
pub(crate) enum ControlEvent {
    Ready(ReadyFrame),
    ShowSettings,
    RemoteSyncStatus(RemoteSyncStatusFrame),
    Failed(String),
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RemoteSyncConnectionState {
    #[default]
    Stopped,
    Connecting,
    Handshaking,
    Connected,
    Reconnecting,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteSyncStatusFrame {
    protocol_version: u32,
    event: String,
    nonce: String,
    runtime_version: String,
    runtime_api: u32,
    profile: String,
    harness_commit: String,
    pub(crate) connection_state: RemoteSyncConnectionState,
    pub(crate) observed_at_ms: u64,
    pub(crate) last_heartbeat_at_ms: Option<u64>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadyFrame {
    pub(crate) protocol_version: u32,
    pub(crate) event: String,
    pub(crate) nonce: String,
    pub(crate) runtime_version: String,
    pub(crate) runtime_api: u32,
    pub(crate) profile: String,
    pub(crate) harness_commit: String,
    pub(crate) url: String,
    pub(crate) authenticated_url: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShowSettingsFrame {
    protocol_version: u32,
    event: String,
    nonce: String,
    runtime_version: String,
    runtime_api: u32,
    profile: String,
    harness_commit: String,
}

#[cfg(unix)]
pub(crate) struct ControlListener {
    path: PathBuf,
    cancel: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[cfg(unix)]
impl ControlListener {
    pub(crate) fn bind(
        directory: PathBuf,
        expectation: ControlExpectation,
        events: Sender<ControlEvent>,
    ) -> Result<Self, String> {
        use std::{os::unix::fs::PermissionsExt, os::unix::net::UnixListener};

        fs::create_dir_all(&directory)
            .map_err(|error| format!("could not create Runtime control directory: {error}"))?;
        let path = directory.join("control.sock");
        if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!("could not replace stale Runtime control socket: {error}")
            })?;
        }
        let listener = UnixListener::bind(&path).map_err(|error| {
            format!(
                "could not bind Runtime control socket {}: {error}",
                path.display()
            )
        })?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not protect Runtime control socket: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("could not configure Runtime control socket: {error}"))?;

        let cancel = Arc::new(AtomicBool::new(false));
        let thread_cancel = Arc::clone(&cancel);
        let join = thread::spawn(move || {
            control_thread(listener, expectation, events, thread_cancel);
        });
        Ok(Self {
            path,
            cancel,
            join: Some(join),
        })
    }

    pub(crate) fn close(mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        let _ = fs::remove_file(&self.path);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

#[cfg(not(unix))]
pub(crate) struct ControlListener;

#[cfg(not(unix))]
impl ControlListener {
    pub(crate) fn bind(
        _directory: PathBuf,
        _expectation: ControlExpectation,
        _events: Sender<ControlEvent>,
    ) -> Result<Self, String> {
        Err("production Runtime control requires a Unix socket".to_string())
    }

    pub(crate) fn close(self) {}
}

#[cfg(unix)]
fn control_thread(
    listener: std::os::unix::net::UnixListener,
    expectation: ControlExpectation,
    events: Sender<ControlEvent>,
    cancel: Arc<AtomicBool>,
) {
    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let result = stream
                    .set_nonblocking(false)
                    .and_then(|_| stream.set_read_timeout(Some(Duration::from_secs(5))))
                    .and_then(|_| read_frame(&mut stream))
                    .map_err(|error| error.to_string())
                    .and_then(|body| validate_frame(&body, &expectation));
                let event = match result {
                    Ok(event) => event,
                    Err(message) => ControlEvent::Failed(message),
                };
                if events.send(event).is_err() {
                    return;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                let _ = events.send(ControlEvent::Failed(format!(
                    "Runtime control socket accept failed: {error}"
                )));
                return;
            }
        }
    }
}

#[cfg(unix)]
fn read_frame(stream: &mut std::os::unix::net::UnixStream) -> std::io::Result<Vec<u8>> {
    let mut body = Vec::with_capacity(MAX_FRAME_BYTES);
    stream
        .by_ref()
        .take((MAX_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut body)?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Runtime ready frame exceeds 8 KiB",
        ));
    }
    Ok(body)
}

fn validate_frame(body: &[u8], expectation: &ControlExpectation) -> Result<ControlEvent, String> {
    let text = std::str::from_utf8(body)
        .map_err(|_| "Runtime ready frame is not valid UTF-8".to_string())?;
    let mut lines = text.split_terminator('\n');
    let line = lines
        .next()
        .filter(|line| !line.is_empty())
        .ok_or_else(|| "Runtime ready frame is empty".to_string())?;
    if lines.next().is_some() || !text.ends_with('\n') {
        return Err("Runtime control requires exactly one NDJSON frame".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|error| format!("Runtime control frame is invalid JSON: {error}"))?;
    let event = value
        .get("event")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Runtime control frame has no event".to_string())?;
    if event == "showSettings" {
        let frame: ShowSettingsFrame = serde_json::from_value(value)
            .map_err(|error| format!("Runtime settings frame is invalid: {error}"))?;
        if frame.protocol_version != 1
            || frame.event != "showSettings"
            || frame.nonce != expectation.nonce
            || frame.runtime_version != expectation.runtime_version
            || frame.runtime_api != expectation.runtime_api
            || frame.profile != "desktop"
            || frame.harness_commit != expectation.harness_commit
        {
            return Err(
                "Runtime settings frame metadata does not match the active Runtime".to_string(),
            );
        }
        return Ok(ControlEvent::ShowSettings);
    }
    if event == "remoteSyncStatus" {
        let frame: RemoteSyncStatusFrame = serde_json::from_value(value)
            .map_err(|error| format!("Runtime remote sync status frame is invalid: {error}"))?;
        if frame.protocol_version != 1
            || frame.event != "remoteSyncStatus"
            || frame.nonce != expectation.nonce
            || frame.runtime_version != expectation.runtime_version
            || frame.runtime_api != expectation.runtime_api
            || frame.profile != "desktop"
            || frame.harness_commit != expectation.harness_commit
            || frame
                .last_heartbeat_at_ms
                .is_some_and(|heartbeat| heartbeat > frame.observed_at_ms)
        {
            return Err("Runtime remote sync status does not match the active Runtime".to_string());
        }
        return Ok(ControlEvent::RemoteSyncStatus(frame));
    }
    if event != "ready" {
        return Err("Runtime control frame event is not supported".to_string());
    }
    let frame: ReadyFrame = serde_json::from_value(value)
        .map_err(|error| format!("Runtime ready frame is invalid JSON: {error}"))?;
    if frame.protocol_version != 1
        || frame.event != "ready"
        || frame.nonce != expectation.nonce
        || frame.runtime_version != expectation.runtime_version
        || frame.runtime_api != expectation.runtime_api
        || frame.profile != "desktop"
        || frame.harness_commit != expectation.harness_commit
    {
        return Err("Runtime ready frame metadata does not match the active Runtime".to_string());
    }
    let url = Url::parse(&frame.url)
        .map_err(|error| format!("Runtime ready frame URL is invalid: {error}"))?;
    validate_loopback_url(&url, false, "Runtime ready URL")?;
    let authenticated_url = Url::parse(&frame.authenticated_url)
        .map_err(|error| format!("Runtime authenticated URL is invalid: {error}"))?;
    validate_loopback_url(&authenticated_url, true, "Runtime authenticated URL")?;
    if authenticated_url.scheme() != url.scheme()
        || authenticated_url.host_str() != url.host_str()
        || authenticated_url.port() != url.port()
        || authenticated_url.path() != url.path()
    {
        return Err("Runtime authenticated URL does not match the ready URL".to_string());
    }
    Ok(ControlEvent::Ready(frame))
}

fn validate_loopback_url(url: &Url, authenticated: bool, label: &str) -> Result<(), String> {
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/"
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!(
            "{label} must be a loopback HTTP root URL with an explicit port"
        ));
    }
    if !authenticated {
        if url.query().is_some() {
            return Err(format!("{label} must not contain a query"));
        }
        return Ok(());
    }
    let Some(query) = url.query() else {
        return Err(format!("{label} must contain a launch token"));
    };
    let Some(token) = query.strip_prefix("token=") else {
        return Err(format!("{label} must contain only a launch token"));
    };
    if token.len() != 43
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(format!("{label} contains an invalid launch token"));
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn generate_nonce() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    let mut file = fs::File::open("/dev/urandom")
        .map_err(|error| format!("could not open the system random source: {error}"))?;
    file.read_exact(&mut bytes)
        .map_err(|error| format!("could not read the system random source: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(not(unix))]
pub(crate) fn generate_nonce() -> Result<String, String> {
    Err("production Runtime control requires a Unix socket".to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        os::unix::net::UnixStream,
        sync::mpsc,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::{
        ControlEvent, ControlExpectation, ControlListener, RemoteSyncConnectionState,
        validate_frame,
    };

    fn expectation() -> ControlExpectation {
        ControlExpectation {
            nonce: "0123456789abcdef".repeat(4),
            runtime_version: "2026.08.17.1".to_string(),
            runtime_api: 1,
            harness_commit: "cd5ef8148158c3a752a658978873241fdf8e2bbc".to_string(),
        }
    }

    fn frame(url: &str) -> String {
        let authenticated_url = format!(
            "{}?token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
            url.trim_end_matches('/')
        );
        format!(
            r#"{{"protocolVersion":1,"event":"ready","nonce":"{}","runtimeVersion":"2026.08.17.1","runtimeApi":1,"profile":"desktop","harnessCommit":"cd5ef8148158c3a752a658978873241fdf8e2bbc","url":"{url}","authenticatedUrl":"{authenticated_url}"}}
"#,
            expectation().nonce
        )
    }

    fn settings_frame() -> String {
        format!(
            r#"{{"protocolVersion":1,"event":"showSettings","nonce":"{}","runtimeVersion":"2026.08.17.1","runtimeApi":1,"profile":"desktop","harnessCommit":"cd5ef8148158c3a752a658978873241fdf8e2bbc"}}
"#,
            expectation().nonce
        )
    }

    fn remote_sync_frame(connection_state: &str, heartbeat: &str) -> String {
        format!(
            r#"{{"protocolVersion":1,"event":"remoteSyncStatus","nonce":"{}","runtimeVersion":"2026.08.17.1","runtimeApi":1,"profile":"desktop","harnessCommit":"cd5ef8148158c3a752a658978873241fdf8e2bbc","connectionState":"{connection_state}","observedAtMs":1756000001000,"lastHeartbeatAtMs":{heartbeat}}}
"#,
            expectation().nonce
        )
    }

    #[test]
    fn accepts_the_exact_single_ready_frame() {
        assert!(
            validate_frame(frame("http://127.0.0.1:43127/").as_bytes(), &expectation()).is_ok()
        );
        assert!(matches!(
            validate_frame(settings_frame().as_bytes(), &expectation()),
            Ok(ControlEvent::ShowSettings)
        ));
        assert!(matches!(
            validate_frame(
                remote_sync_frame("connected", "1756000000000").as_bytes(),
                &expectation()
            ),
            Ok(ControlEvent::RemoteSyncStatus(frame))
                if frame.connection_state == RemoteSyncConnectionState::Connected
                    && frame.last_heartbeat_at_ms == Some(1_756_000_000_000)
        ));
    }

    #[test]
    fn rejects_metadata_url_and_framing_mismatches() {
        assert!(
            validate_frame(frame("http://localhost:43127/").as_bytes(), &expectation()).is_err()
        );
        assert!(
            validate_frame(
                frame("http://127.0.0.1:43127/path").as_bytes(),
                &expectation()
            )
            .is_err()
        );
        assert!(
            validate_frame(
                format!(
                    "{}{}",
                    frame("http://127.0.0.1:43127/"),
                    frame("http://127.0.0.1:43127/")
                )
                .as_bytes(),
                &expectation()
            )
            .is_err()
        );
        assert!(validate_frame(br#"{"protocolVersion":1}"#, &expectation()).is_err());
        assert!(
            validate_frame(
                remote_sync_frame("connected", "1756000002000").as_bytes(),
                &expectation()
            )
            .is_err()
        );
    }

    #[test]
    fn listener_accepts_ready_and_settings_frames_and_cleans_up() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("harndock-control-{suffix}"));
        let (sender, receiver) = mpsc::channel();
        let listener = ControlListener::bind(directory.clone(), expectation(), sender)
            .expect("control listener should bind");
        let socket_path = directory.join("control.sock");
        let mut stream = None;
        for _ in 0..20 {
            match UnixStream::connect(&socket_path) {
                Ok(value) => {
                    stream = Some(value);
                    break;
                }
                Err(_) => thread::sleep(Duration::from_millis(10)),
            }
        }
        let mut stream = stream.expect("control client should connect");
        stream
            .write_all(frame("http://127.0.0.1:43127/").as_bytes())
            .expect("control frame should be written");
        stream
            .shutdown(std::net::Shutdown::Write)
            .expect("control client should finish the frame");
        assert!(matches!(
            receiver.recv_timeout(Duration::from_secs(1)),
            Ok(ControlEvent::Ready(_))
        ));
        let mut settings_stream = UnixStream::connect(&socket_path)
            .expect("control listener should remain available after readiness");
        settings_stream
            .write_all(settings_frame().as_bytes())
            .expect("settings frame should be written");
        settings_stream
            .shutdown(std::net::Shutdown::Write)
            .expect("settings client should finish the frame");
        assert!(matches!(
            receiver.recv_timeout(Duration::from_secs(1)),
            Ok(ControlEvent::ShowSettings)
        ));
        let mut status_stream = UnixStream::connect(&socket_path)
            .expect("control listener should remain available for remote status");
        status_stream
            .write_all(remote_sync_frame("reconnecting", "null").as_bytes())
            .expect("remote sync frame should be written");
        status_stream
            .shutdown(std::net::Shutdown::Write)
            .expect("remote sync client should finish the frame");
        assert!(matches!(
            receiver.recv_timeout(Duration::from_secs(1)),
            Ok(ControlEvent::RemoteSyncStatus(frame))
                if frame.connection_state == RemoteSyncConnectionState::Reconnecting
        ));
        listener.close();
        assert!(!socket_path.exists());
        fs::remove_dir_all(directory).expect("temporary control directory should be removed");
    }
}
