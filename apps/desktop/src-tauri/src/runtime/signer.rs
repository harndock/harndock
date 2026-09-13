use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};

use crate::remote_sync::load_signing_key;

const MAX_FRAME_BYTES: usize = 8 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignRequest {
    proof: String,
}

#[derive(Debug, Serialize)]
struct SignResponse<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

#[cfg(unix)]
pub(crate) struct SignerListener {
    path: PathBuf,
    cancel: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[cfg(unix)]
impl SignerListener {
    pub(crate) fn bind(directory: PathBuf, device_id: &str) -> Result<Self, String> {
        use std::os::unix::{fs::PermissionsExt, net::UnixListener};

        let key = load_signing_key(device_id)?;
        fs::create_dir_all(&directory)
            .map_err(|error| format!("could not create Runtime signer directory: {error}"))?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("could not protect Runtime signer directory: {error}"))?;
        let path = directory.join("remote-sync.sock");
        if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!("could not replace stale Runtime signer socket: {error}")
            })?;
        }
        let listener = UnixListener::bind(&path)
            .map_err(|error| format!("could not bind Runtime signer socket: {error}"))?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not protect Runtime signer socket: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("could not configure Runtime signer socket: {error}"))?;
        let cancel = Arc::new(AtomicBool::new(false));
        let thread_cancel = Arc::clone(&cancel);
        let join = thread::spawn(move || signer_thread(listener, key, thread_cancel));
        Ok(Self {
            path,
            cancel,
            join: Some(join),
        })
    }

    pub(crate) fn endpoint(&self) -> String {
        format!("unix:{}", self.path.display())
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
pub(crate) struct SignerListener;

#[cfg(not(unix))]
impl SignerListener {
    pub(crate) fn bind(_directory: PathBuf, _device_id: &str) -> Result<Self, String> {
        Err("production Runtime signer requires a Unix socket".to_string())
    }
    pub(crate) fn endpoint(&self) -> String {
        String::new()
    }
    pub(crate) fn close(self) {}
}

#[cfg(unix)]
fn signer_thread(
    listener: std::os::unix::net::UnixListener,
    key: SigningKey,
    cancel: Arc<AtomicBool>,
) {
    while !cancel.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let response = stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .and_then(|_| read_frame(&mut stream))
                    .map_err(|error| error.to_string())
                    .and_then(|body| sign_frame(&body, &key));
                let body = match response {
                    Ok(signature) => serde_json::to_string(&SignResponse {
                        signature: Some(signature),
                        error: None,
                    }),
                    Err(error) => serde_json::to_string(&SignResponse {
                        signature: None,
                        error: Some(&error),
                    }),
                };
                if let Ok(body) = body {
                    let _ = stream.write_all(body.as_bytes());
                    let _ = stream.write_all(b"\n");
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return,
        }
    }
}

#[cfg(unix)]
fn read_frame(stream: &mut std::os::unix::net::UnixStream) -> std::io::Result<Vec<u8>> {
    let mut body = Vec::with_capacity(MAX_FRAME_BYTES);
    std::io::Read::by_ref(stream)
        .take((MAX_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut body)?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "sign request is too large",
        ));
    }
    Ok(body)
}

fn sign_frame(body: &[u8], key: &SigningKey) -> Result<String, String> {
    let text = std::str::from_utf8(body).map_err(|_| "sign request is not UTF-8".to_string())?;
    let mut lines = text.split_terminator('\n');
    let line = lines
        .next()
        .filter(|line| !line.is_empty())
        .ok_or_else(|| "sign request is empty".to_string())?;
    if lines.next().is_some() || !text.ends_with('\n') {
        return Err("sign request requires exactly one NDJSON frame".to_string());
    }
    let request: SignRequest =
        serde_json::from_str(line).map_err(|error| format!("invalid sign request: {error}"))?;
    let fields = request.proof.split('\n').collect::<Vec<_>>();
    if fields.len() != 6
        || fields[0] != "dsh-sync-pc-register-v1"
        || fields[1..]
            .iter()
            .any(|field| field.is_empty() || field.contains('\r'))
        || request.proof.len() > 1024
    {
        return Err("sign proof length is invalid".to_string());
    }
    Ok(URL_SAFE_NO_PAD.encode(key.sign(request.proof.as_bytes()).to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::sign_frame;
    use ed25519_dalek::SigningKey;

    #[test]
    fn signs_only_a_single_bounded_frame() {
        let key = SigningKey::from_bytes(&[9_u8; 32]);
        let body =
            br#"{"proof":"dsh-sync-pc-register-v1\nchallenge\nnonce\naccount\ndevice\nruntime"}
"#;
        assert_eq!(sign_frame(body, &key).unwrap().len(), 86);
        assert!(sign_frame(br#"{"proof":"canonical-proof"}"#, &key).is_err());
    }
}
