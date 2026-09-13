use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::SigningKey;
use getrandom::fill;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "ai.deepseek.dsh-gui.remote-sync";
const CONFIG_DIRECTORY: &str = "remote-sync";
const CONFIG_FILE: &str = "config.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteSyncConfig {
    pub(crate) gateway_url: String,
    pub(crate) account_id: String,
    pub(crate) device_id: String,
    pub(crate) runtime_id: String,
    pub(crate) public_key: String,
    pub(crate) platform: String,
    pub(crate) outbox_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PairRemoteSyncRequest {
    pub(crate) gateway_url: String,
    pub(crate) code: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSyncStatus {
    configured: bool,
    account_id: Option<String>,
    device_id: Option<String>,
    runtime_id: Option<String>,
    gateway_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PairingResponse {
    account_id: String,
    device_id: String,
    runtime_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingRequest<'a> {
    code: &'a str,
    public_key: &'a str,
    device_name: &'a str,
    platform: &'a str,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve the application data directory: {error}"))?;
    Ok(app_data.join(CONFIG_DIRECTORY).join(CONFIG_FILE))
}

fn key_entry(device_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, device_id)
        .map_err(|error| format!("could not access the platform credential store: {error}"))
}

pub(crate) fn load_signing_key(device_id: &str) -> Result<SigningKey, String> {
    let secret = key_entry(device_id)?.get_secret().map_err(|error| {
        format!("could not load the PC private key from the platform credential store: {error}")
    })?;
    let bytes: [u8; 32] = secret
        .try_into()
        .map_err(|_| "stored PC private key has an invalid length".to_string())?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn store_signing_key(device_id: &str, key: &SigningKey) -> Result<(), String> {
    key_entry(device_id)?
        .set_secret(&key.to_bytes())
        .map_err(|error| {
            format!("could not save the PC private key to the platform credential store: {error}")
        })
}

fn delete_signing_key(device_id: &str) -> Result<(), String> {
    match key_entry(device_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) if error.to_string().to_lowercase().contains("no entry") => Ok(()),
        Err(error) => Err(format!("could not remove the PC private key: {error}")),
    }
}

fn public_key_pem(key: &SigningKey) -> String {
    // SubjectPublicKeyInfo for id-Ed25519 (RFC 8410): 12-byte prefix + 32-byte key.
    const PREFIX: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    let mut der = Vec::with_capacity(PREFIX.len() + 32);
    der.extend_from_slice(&PREFIX);
    der.extend_from_slice(&key.verifying_key().to_bytes());
    let encoded = STANDARD.encode(der);
    let mut pem = String::from("-----BEGIN PUBLIC KEY-----\n");
    for chunk in encoded.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).expect("base64 is UTF-8"));
        pem.push('\n');
    }
    pem.push_str("-----END PUBLIC KEY-----\n");
    pem
}

fn validate_platform(value: &str) -> Result<(), String> {
    if matches!(value, "macos" | "windows" | "linux") {
        Ok(())
    } else {
        Err("platform must be macos, windows, or linux".to_string())
    }
}

fn pairing_endpoint(gateway_url: &str) -> Result<(String, String), String> {
    let parsed = tauri::Url::parse(gateway_url)
        .map_err(|error| format!("gateway URL is invalid: {error}"))?;
    if parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("gateway URL must be an origin without a path or query".to_string());
    }
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("gateway URL must use http(s) and include a host".to_string());
    }
    let loopback = matches!(
        parsed.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if parsed.scheme() == "http" && !loopback {
        return Err("pairing requires HTTPS unless the Gateway is loopback".to_string());
    }
    let endpoint = format!("{}/v1/pairings/exchange", gateway_url.trim_end_matches('/'));
    let websocket_scheme = if parsed.scheme() == "https" {
        "wss"
    } else {
        "ws"
    };
    let websocket_url = format!(
        "{}{}{}",
        websocket_scheme,
        &gateway_url[parsed.scheme().len()..].trim_end_matches('/'),
        "/v1/ws",
    );
    Ok((endpoint, websocket_url))
}

fn write_private_config(path: &Path, config: &RemoteSyncConfig) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "remote sync config has no parent directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create remote sync directory: {error}"))?;
    #[cfg(unix)]
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("could not protect remote sync directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("could not serialize remote sync config: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("could not open remote sync config: {error}"))?;
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("could not protect remote sync config: {error}"))?;
    file.write_all(&body)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not write remote sync config: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("could not install remote sync config: {error}"))
}

pub(crate) fn read_config(app: &AppHandle) -> Result<Option<(PathBuf, RemoteSyncConfig)>, String> {
    let path = config_path(app)?;
    match fs::read_to_string(&path) {
        Ok(body) => {
            let config = serde_json::from_str(&body)
                .map_err(|error| format!("remote sync config is invalid: {error}"))?;
            Ok(Some((path, config)))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read remote sync config: {error}")),
    }
}

pub(crate) fn status(app: &AppHandle) -> Result<RemoteSyncStatus, String> {
    let configured = read_config(app)?;
    Ok(match configured {
        Some((_, config)) => RemoteSyncStatus {
            configured: true,
            account_id: Some(config.account_id),
            device_id: Some(config.device_id),
            runtime_id: Some(config.runtime_id),
            gateway_url: Some(config.gateway_url),
        },
        None => RemoteSyncStatus {
            configured: false,
            account_id: None,
            device_id: None,
            runtime_id: None,
            gateway_url: None,
        },
    })
}

#[tauri::command]
pub(crate) fn pair_remote_sync(
    app: AppHandle,
    request: PairRemoteSyncRequest,
) -> Result<RemoteSyncStatus, String> {
    if read_config(&app)?.is_some() {
        return Err("remote sync is already paired; unpair before pairing again".to_string());
    }
    if request.code.len() < 16 || request.code.len() > 128 || request.device_name.is_empty() {
        return Err("pairing code or device name is invalid".to_string());
    }
    validate_platform(&request.platform)?;
    let (endpoint, websocket_url) = pairing_endpoint(&request.gateway_url)?;
    let mut secret = [0_u8; 32];
    fill(&mut secret).map_err(|error| format!("could not generate a device key: {error}"))?;
    let key = SigningKey::from_bytes(&secret);
    secret.fill(0);
    let public_key = public_key_pem(&key);
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("could not create pairing client: {error}"))?
        .post(endpoint)
        .json(&PairingRequest {
            code: &request.code,
            public_key: &public_key,
            device_name: &request.device_name,
            platform: &request.platform,
        })
        .send()
        .map_err(|error| format!("pairing request failed: {error}"))?;
    if response.status().as_u16() != 201 {
        return Err("pairing was denied by the Gateway".to_string());
    }
    let identity: PairingResponse = response
        .json()
        .map_err(|error| format!("Gateway pairing response is invalid: {error}"))?;
    store_signing_key(&identity.device_id, &key)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve the application data directory: {error}"))?;
    let config = RemoteSyncConfig {
        gateway_url: websocket_url,
        account_id: identity.account_id,
        device_id: identity.device_id,
        runtime_id: identity.runtime_id,
        public_key,
        platform: request.platform,
        outbox_path: app_data
            .join(CONFIG_DIRECTORY)
            .join("outbox.json")
            .display()
            .to_string(),
    };
    if let Err(error) = write_private_config(&config_path(&app)?, &config) {
        let _ = delete_signing_key(&config.device_id);
        return Err(error);
    }
    status(&app)
}

#[tauri::command]
pub(crate) fn remote_sync_status(app: AppHandle) -> Result<RemoteSyncStatus, String> {
    status(&app)
}

#[tauri::command]
pub(crate) fn unpair_remote_sync(app: AppHandle) -> Result<(), String> {
    let Some((path, config)) = read_config(&app)? else {
        return Ok(());
    };
    let staged_path = path.with_extension("json.unpairing");
    fs::rename(&path, &staged_path)
        .map_err(|error| format!("could not stage remote sync config for removal: {error}"))?;
    if let Err(error) = remove_file_if_exists(Path::new(&config.outbox_path), "remote sync outbox")
    {
        let _ = fs::rename(&staged_path, &path);
        return Err(error);
    }
    if let Err(error) = delete_signing_key(&config.device_id) {
        let _ = fs::rename(&staged_path, &path);
        return Err(error);
    }
    remove_file_if_exists(&staged_path, "remote sync config")
}

fn remove_file_if_exists(path: &Path, label: &str) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {label}: {error}")),
    }
}

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(test)]
mod tests {
    use super::{pairing_endpoint, public_key_pem};
    use ed25519_dalek::SigningKey;

    #[test]
    fn pairing_endpoint_derives_secure_websocket_origin() {
        assert_eq!(
            pairing_endpoint("https://sync.example.test").unwrap(),
            (
                "https://sync.example.test/v1/pairings/exchange".to_string(),
                "wss://sync.example.test/v1/ws".to_string()
            )
        );
        assert!(pairing_endpoint("https://sync.example.test/path").is_err());
        assert!(pairing_endpoint("http://sync.example.test").is_err());
        assert!(pairing_endpoint("http://127.0.0.1:8080").is_ok());
    }

    #[test]
    fn public_key_is_rfc8410_pem() {
        let key = SigningKey::from_bytes(&[7_u8; 32]);
        let pem = public_key_pem(&key);
        assert!(pem.starts_with("-----BEGIN PUBLIC KEY-----\n"));
        assert!(pem.ends_with("-----END PUBLIC KEY-----\n"));
    }
}
