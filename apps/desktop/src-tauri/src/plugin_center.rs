//! Desktop-side transport for plugin artifacts published as GitHub Release assets.
//!
//! The Center API is the source of truth for the declaration, but it does not
//! proxy the binary. This module keeps the trust boundary in the desktop app:
//! it validates the declaration, downloads only from GitHub, and verifies the
//! advertised size and SHA-256 before a future installer can consume the file.

use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{Url, blocking::Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::plugin_installer::{InstalledPluginSnapshot, PluginStore, preflight_plugin_archive};
use crate::runtime::RuntimeManager;

const MAX_PLUGIN_ARTIFACT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PLUGIN_MANIFEST_BYTES: u64 = 1024 * 1024;
const GITHUB_DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "github-releases.githubusercontent.com",
    "release-assets.githubusercontent.com",
];
const PLUGIN_CENTER_URL_ENV: &str = "HARNDOCK_PLUGIN_CENTER_URL";
const PLUGIN_HTTP_PROXY_ENV: &str = "HARNDOCK_PLUGIN_HTTP_PROXY";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GithubPluginSource {
    pub(crate) provider: String,
    pub(crate) repository: String,
    pub(crate) release_tag: String,
    pub(crate) commit_sha: String,
    pub(crate) asset_name: String,
    pub(crate) manifest_asset_name: String,
    pub(crate) release_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginDownloadDeclaration {
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) url: String,
    pub(crate) source: GithubPluginSource,
    pub(crate) sha256: String,
    pub(crate) size: u64,
    pub(crate) signature: Option<PluginSignature>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginSignature {
    pub(crate) key_id: String,
    pub(crate) value: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginCatalogItem {
    pub(crate) plugin_id: String,
    pub(crate) name: String,
    pub(crate) slug: String,
    pub(crate) author: String,
    pub(crate) category: String,
    pub(crate) summary: String,
    pub(crate) icon_url: Option<String>,
    pub(crate) latest_published_version: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginCatalogPage {
    pub(crate) items: Vec<PluginCatalogItem>,
    pub(crate) limit: u32,
    pub(crate) offset: u32,
    pub(crate) has_more: bool,
    pub(crate) next_offset: Option<u32>,
    pub(crate) source: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginCatalogDetail {
    pub(crate) plugin_id: String,
    pub(crate) name: String,
    pub(crate) slug: String,
    pub(crate) author: String,
    pub(crate) category: String,
    pub(crate) summary: String,
    pub(crate) description: Option<String>,
    pub(crate) icon_url: Option<String>,
    pub(crate) latest_published_version: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginReleaseDetail {
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) status: String,
    pub(crate) plugin_types: Vec<String>,
    pub(crate) summary: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) permissions: HashMap<String, Vec<String>>,
    pub(crate) harness_min_version: String,
    pub(crate) runtime_api: u32,
    pub(crate) platforms: Vec<String>,
    pub(crate) created_at: String,
    pub(crate) published_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginMarketplaceDetail {
    pub(crate) plugin: PluginCatalogDetail,
    pub(crate) releases: Vec<PluginReleaseDetail>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DownloadedPluginArtifact {
    pub(crate) path: PathBuf,
    pub(crate) size: u64,
    pub(crate) sha256: String,
}

#[derive(Debug)]
pub(crate) enum PluginCenterError {
    Configuration(String),
    InvalidDeclaration(String),
    InvalidUrl(String),
    Http(String),
    Io(std::io::Error),
    Integrity(String),
    Cancelled,
}

impl std::fmt::Display for PluginCenterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Configuration(message) => {
                write!(formatter, "plugin center is not configured: {message}")
            }
            Self::InvalidDeclaration(message) => {
                write!(formatter, "invalid plugin declaration: {message}")
            }
            Self::InvalidUrl(message) => {
                write!(formatter, "invalid plugin download URL: {message}")
            }
            Self::Http(message) => write!(formatter, "plugin download failed: {message}"),
            Self::Io(error) => write!(formatter, "plugin download storage failed: {error}"),
            Self::Integrity(message) => write!(
                formatter,
                "plugin artifact integrity check failed: {message}"
            ),
            Self::Cancelled => write!(formatter, "plugin download was cancelled"),
        }
    }
}

impl std::error::Error for PluginCenterError {}

impl From<std::io::Error> for PluginCenterError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub(crate) fn download_plugin_artifact(
    declaration: &PluginDownloadDeclaration,
    staging_dir: &Path,
) -> Result<DownloadedPluginArtifact, PluginCenterError> {
    download_plugin_artifact_with_progress(declaration, staging_dir, || false, |_, _| {})
}

fn download_plugin_manifest<ShouldCancel>(
    declaration: &PluginDownloadDeclaration,
    staging_dir: &Path,
    mut should_cancel: ShouldCancel,
) -> Result<PathBuf, PluginCenterError>
where
    ShouldCancel: FnMut() -> bool,
{
    if should_cancel() {
        return Err(PluginCenterError::Cancelled);
    }
    let url = github_asset_url(&declaration.source, &declaration.source.manifest_asset_name)?;
    let destination = staging_dir.join(&declaration.source.manifest_asset_name);
    let mut response = github_download_client()?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?;
    if !response.status().is_success() {
        return Err(PluginCenterError::Http(format!(
            "GitHub returned HTTP {} for the plugin manifest",
            response.status()
        )));
    }
    if !is_allowed_github_host(response.url()) {
        return Err(PluginCenterError::InvalidUrl(format!(
            "manifest redirected to an untrusted host: {}",
            response.url()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PLUGIN_MANIFEST_BYTES)
    {
        return Err(PluginCenterError::Integrity(
            "plugin manifest is larger than 1 MiB".into(),
        ));
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)?;
    let mut size = 0_u64;
    let mut buffer = [0_u8; 16 * 1024];
    let result = (|| -> Result<(), PluginCenterError> {
        loop {
            if should_cancel() {
                return Err(PluginCenterError::Cancelled);
            }
            let read = response
                .read(&mut buffer)
                .map_err(|error| PluginCenterError::Http(error.to_string()))?;
            if read == 0 {
                break;
            }
            size = size
                .checked_add(read as u64)
                .ok_or_else(|| PluginCenterError::Integrity("manifest size overflow".into()))?;
            if size > MAX_PLUGIN_MANIFEST_BYTES {
                return Err(PluginCenterError::Integrity(
                    "plugin manifest is larger than 1 MiB".into(),
                ));
            }
            file.write_all(&buffer[..read])?;
        }
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = result {
        drop(file);
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(destination)
}

fn download_plugin_artifact_with_progress<ShouldCancel, OnProgress>(
    declaration: &PluginDownloadDeclaration,
    staging_dir: &Path,
    mut should_cancel: ShouldCancel,
    mut on_progress: OnProgress,
) -> Result<DownloadedPluginArtifact, PluginCenterError>
where
    ShouldCancel: FnMut() -> bool,
    OnProgress: FnMut(u64, u64),
{
    let url = validate_declaration(declaration)?;
    if should_cancel() {
        return Err(PluginCenterError::Cancelled);
    }
    fs::create_dir_all(staging_dir)?;

    let file_name = Path::new(&declaration.source.asset_name)
        .file_name()
        .ok_or_else(|| PluginCenterError::InvalidDeclaration("asset name is empty".into()))?;
    let destination = staging_dir.join(file_name);
    let mut response = github_download_client()?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?;

    if !response.status().is_success() {
        return Err(PluginCenterError::Http(format!(
            "GitHub returned HTTP {}",
            response.status()
        )));
    }
    if !is_allowed_github_host(response.url()) {
        return Err(PluginCenterError::InvalidUrl(format!(
            "redirected to an untrusted host: {}",
            response.url()
        )));
    }
    if let Some(content_length) = response.content_length()
        && (content_length > MAX_PLUGIN_ARTIFACT_BYTES || content_length != declaration.size)
    {
        return Err(PluginCenterError::Integrity(format!(
            "content length {content_length} does not match expected size {}",
            declaration.size
        )));
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut size = 0_u64;
    on_progress(0, declaration.size);

    let result = (|| -> Result<(), PluginCenterError> {
        loop {
            if should_cancel() {
                return Err(PluginCenterError::Cancelled);
            }
            let read = response
                .read(&mut buffer)
                .map_err(|error| PluginCenterError::Http(error.to_string()))?;
            if read == 0 {
                break;
            }
            size = size
                .checked_add(read as u64)
                .ok_or_else(|| PluginCenterError::Integrity("artifact size overflow".into()))?;
            if size > MAX_PLUGIN_ARTIFACT_BYTES || size > declaration.size {
                return Err(PluginCenterError::Integrity(format!(
                    "downloaded size exceeded expected size {}",
                    declaration.size
                )));
            }
            file.write_all(&buffer[..read])?;
            hasher.update(&buffer[..read]);
            on_progress(size, declaration.size);
        }
        file.sync_all()?;
        let actual_sha256 = format!("{:x}", hasher.finalize());
        if size != declaration.size {
            return Err(PluginCenterError::Integrity(format!(
                "downloaded size {size} does not match expected size {}",
                declaration.size
            )));
        }
        if actual_sha256 != declaration.sha256 {
            return Err(PluginCenterError::Integrity(format!(
                "downloaded SHA-256 {actual_sha256} does not match expected {}",
                declaration.sha256
            )));
        }
        Ok(())
    })();

    if let Err(error) = result {
        drop(file);
        let _ = fs::remove_file(&destination);
        return Err(error);
    }

    Ok(DownloadedPluginArtifact {
        path: destination,
        size,
        sha256: declaration.sha256.clone(),
    })
}

pub(crate) fn verify_plugin_artifact(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), PluginCenterError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() != expected_size {
        return Err(PluginCenterError::Integrity(format!(
            "file size {} does not match expected size {expected_size}",
            metadata.len()
        )));
    }

    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual_sha256 = format!("{:x}", hasher.finalize());
    if actual_sha256 != expected_sha256 {
        return Err(PluginCenterError::Integrity(format!(
            "file SHA-256 {actual_sha256} does not match expected {expected_sha256}"
        )));
    }
    Ok(())
}

fn validate_declaration(declaration: &PluginDownloadDeclaration) -> Result<Url, PluginCenterError> {
    if declaration.plugin_id.trim().is_empty() || declaration.version.trim().is_empty() {
        return Err(PluginCenterError::InvalidDeclaration(
            "plugin ID and version are required".into(),
        ));
    }
    if declaration.source.provider != "github" {
        return Err(PluginCenterError::InvalidDeclaration(
            "only the GitHub provider is supported".into(),
        ));
    }
    if !is_repository(&declaration.source.repository) {
        return Err(PluginCenterError::InvalidDeclaration(
            "repository must be in owner/name form".into(),
        ));
    }
    if !is_sha256(&declaration.sha256) {
        return Err(PluginCenterError::InvalidDeclaration(
            "sha256 must be a lowercase 64-character hexadecimal digest".into(),
        ));
    }
    if !is_commit_sha(&declaration.source.commit_sha) {
        return Err(PluginCenterError::InvalidDeclaration(
            "commit SHA must be a 40-character hexadecimal value".into(),
        ));
    }
    if declaration.size == 0 || declaration.size > MAX_PLUGIN_ARTIFACT_BYTES {
        return Err(PluginCenterError::InvalidDeclaration(
            "artifact size is outside the supported range".into(),
        ));
    }
    if !is_safe_file_name(&declaration.source.asset_name)
        || !is_safe_file_name(&declaration.source.manifest_asset_name)
    {
        return Err(PluginCenterError::InvalidDeclaration(
            "asset names must be plain file names".into(),
        ));
    }
    if declaration.source.asset_name == declaration.source.manifest_asset_name {
        return Err(PluginCenterError::InvalidDeclaration(
            "plugin archive and manifest must be separate Release Assets".into(),
        ));
    }

    let expected_url = github_asset_url(&declaration.source, &declaration.source.asset_name)?;
    let declared_url = Url::parse(&declaration.url)
        .map_err(|error| PluginCenterError::InvalidUrl(error.to_string()))?;
    if declared_url != expected_url {
        return Err(PluginCenterError::InvalidUrl(
            "URL does not match the declared GitHub repository, tag, and asset".into(),
        ));
    }
    Ok(declared_url)
}

fn github_asset_url(
    source: &GithubPluginSource,
    asset_name: &str,
) -> Result<Url, PluginCenterError> {
    let mut url = Url::parse("https://github.com/")
        .map_err(|error| PluginCenterError::InvalidUrl(error.to_string()))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| PluginCenterError::InvalidUrl("cannot build GitHub URL".into()))?;
        for part in source.repository.split('/') {
            segments.push(part);
        }
        segments.push("releases");
        segments.push("download");
        segments.push(&source.release_tag);
        segments.push(asset_name);
    }
    Ok(url)
}

fn is_allowed_github_host(url: &Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| GITHUB_DOWNLOAD_HOSTS.contains(&host))
}

fn github_download_client() -> Result<Client, PluginCenterError> {
    let mut builder = Client::builder()
        .user_agent("Harndock-Desktop-PluginCenter/1")
        .redirect(reqwest::redirect::Policy::limited(5))
        // The configured local VPN proxy only supports HTTP/1.1 CONNECT.
        .http1_only()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60));
    if let Some(proxy_url) = plugin_http_proxy_url()? {
        let proxy = reqwest::Proxy::all(proxy_url.as_str()).map_err(|error| {
            PluginCenterError::Http(format!("plugin proxy is invalid: {error}"))
        })?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| PluginCenterError::Http(error.to_string()))
}

fn plugin_http_proxy_url() -> Result<Option<Url>, PluginCenterError> {
    let configured = configured_environment_value(
        PLUGIN_HTTP_PROXY_ENV,
        option_env!("HARNDOCK_PLUGIN_HTTP_PROXY"),
    );
    plugin_http_proxy_url_from(configured.as_deref())
}

fn plugin_http_proxy_url_from(configured: Option<&str>) -> Result<Option<Url>, PluginCenterError> {
    let Some(configured) = configured else {
        return Ok(None);
    };
    let configured = configured.trim();
    if configured.is_empty() || configured.eq_ignore_ascii_case("direct") {
        return Ok(None);
    }
    let proxy_url = Url::parse(configured).map_err(|error| {
        PluginCenterError::Http(format!("plugin proxy URL is invalid: {error}"))
    })?;
    if !matches!(proxy_url.scheme(), "http" | "https") || proxy_url.host_str().is_none() {
        return Err(PluginCenterError::Http(
            "plugin proxy URL must use http(s) and include a host".into(),
        ));
    }
    Ok(Some(proxy_url))
}

fn configured_environment_value(variable: &str, built_value: Option<&str>) -> Option<String> {
    std::env::var(variable)
        .ok()
        .or(built_value.map(ToOwned::to_owned))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_repository(repository: &str) -> bool {
    let mut parts = repository.split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(name) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && !owner.is_empty()
        && !name.is_empty()
        && owner != "."
        && name != "."
        && !repository.contains('\\')
        && !repository.contains("..")
}

fn is_safe_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && file_name != "."
        && file_name != ".."
        && !file_name.contains('/')
        && !file_name.contains('\\')
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value == value.to_ascii_lowercase()
}

fn is_commit_sha(value: &str) -> bool {
    value.len() == 40
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value == value.to_ascii_lowercase()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PluginDownloadPhase {
    FetchingDeclaration,
    Downloading,
    Ready,
    Cancelling,
    Cancelled,
    Failed,
    Installed,
}

impl PluginDownloadPhase {
    fn is_active(&self) -> bool {
        matches!(
            self,
            Self::FetchingDeclaration | Self::Downloading | Self::Ready | Self::Cancelling
        )
    }

    fn is_terminal(&self) -> bool {
        matches!(self, Self::Cancelled | Self::Failed | Self::Installed)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginDownloadSnapshot {
    pub(crate) task_id: String,
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) phase: PluginDownloadPhase,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) artifact_name: Option<String>,
    pub(crate) manifest_name: Option<String>,
    pub(crate) artifact_sha256: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) updated_at_ms: u128,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallResult {
    pub(crate) task_id: String,
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) health: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallPreview {
    pub(crate) task_id: String,
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) source_repository: String,
    pub(crate) source_release_tag: String,
    pub(crate) source_commit_sha: String,
    pub(crate) artifact_sha256: String,
    pub(crate) artifact_size: u64,
    pub(crate) plugin_types: Vec<String>,
    pub(crate) permissions: std::collections::BTreeMap<String, Vec<String>>,
    pub(crate) target: String,
    pub(crate) harness_min_version: String,
    pub(crate) runtime_api: u32,
    pub(crate) entry_count: u64,
    pub(crate) unpacked_bytes: u64,
    pub(crate) contains_symlinks: bool,
    pub(crate) signature_key_id: String,
}

struct DownloadTask {
    snapshot: PluginDownloadSnapshot,
    cancel: Arc<AtomicBool>,
    artifact_path: Option<PathBuf>,
    manifest_path: Option<PathBuf>,
    declaration: Option<PluginDownloadDeclaration>,
}

#[derive(Debug)]
enum DownloadTaskReservation {
    Existing(PluginDownloadSnapshot),
    Created {
        task_id: String,
        stale_task_ids: Vec<String>,
    },
}

pub(crate) struct PluginCenterState {
    center_api_origin: Option<String>,
    tasks: Arc<Mutex<HashMap<String, DownloadTask>>>,
    sequence: AtomicU64,
}

impl Default for PluginCenterState {
    fn default() -> Self {
        Self::new(configured_environment_value(
            PLUGIN_CENTER_URL_ENV,
            option_env!("HARNDOCK_PLUGIN_CENTER_URL"),
        ))
    }
}

impl PluginCenterState {
    fn new(center_api_origin: Option<String>) -> Self {
        Self {
            center_api_origin,
            tasks: Arc::new(Mutex::new(HashMap::new())),
            sequence: AtomicU64::new(1),
        }
    }

    fn next_task_id(&self) -> String {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default();
        format!("plugin-download-{timestamp}-{sequence}")
    }

    fn center_api_origin(&self) -> Result<&str, PluginCenterError> {
        self.center_api_origin
            .as_deref()
            .ok_or_else(|| PluginCenterError::Configuration(format!("set {PLUGIN_CENTER_URL_ENV}")))
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

fn update_download_task(
    tasks: &Mutex<HashMap<String, DownloadTask>>,
    task_id: &str,
    update: impl FnOnce(&mut DownloadTask),
) -> bool {
    let Ok(mut tasks) = tasks.lock() else {
        return false;
    };
    let Some(task) = tasks.get_mut(task_id) else {
        return false;
    };
    update(task);
    task.snapshot.updated_at_ms = now_ms();
    true
}

fn clone_download_snapshot(
    tasks: &Mutex<HashMap<String, DownloadTask>>,
    task_id: &str,
) -> Option<PluginDownloadSnapshot> {
    tasks
        .lock()
        .ok()
        .and_then(|tasks| tasks.get(task_id).map(|task| task.snapshot.clone()))
}

fn reserve_download_task(
    tasks: &Mutex<HashMap<String, DownloadTask>>,
    snapshot: PluginDownloadSnapshot,
    cancel: Arc<AtomicBool>,
) -> Result<DownloadTaskReservation, String> {
    let mut tasks = tasks
        .lock()
        .map_err(|_| "plugin download state is unavailable".to_string())?;

    if let Some(active_task) = tasks.values().find(|task| {
        task.snapshot.plugin_id == snapshot.plugin_id && task.snapshot.phase.is_active()
    }) {
        if active_task.snapshot.version == snapshot.version {
            return Ok(DownloadTaskReservation::Existing(
                active_task.snapshot.clone(),
            ));
        }
        return Err(format!(
            "plugin {} already has an active download for version {}",
            snapshot.plugin_id, active_task.snapshot.version
        ));
    }

    let mut stale_task_ids = Vec::new();
    tasks.retain(|task_id, task| {
        let stale =
            task.snapshot.plugin_id == snapshot.plugin_id && task.snapshot.phase.is_terminal();
        if stale {
            stale_task_ids.push(task_id.clone());
        }
        !stale
    });
    let task_id = snapshot.task_id.clone();
    tasks.insert(
        task_id.clone(),
        DownloadTask {
            snapshot,
            cancel,
            artifact_path: None,
            manifest_path: None,
            declaration: None,
        },
    );
    Ok(DownloadTaskReservation::Created {
        task_id,
        stale_task_ids,
    })
}

fn finish_download_task(
    tasks: &Mutex<HashMap<String, DownloadTask>>,
    task_id: &str,
    staging_dir: &Path,
    phase: PluginDownloadPhase,
    error: Option<String>,
) {
    let _ = fs::remove_dir_all(staging_dir);
    update_download_task(tasks, task_id, |task| {
        task.snapshot.phase = phase;
        task.snapshot.error = error;
        task.artifact_path = None;
        task.manifest_path = None;
    });
}

fn cleanup_orphaned_staging_dirs(
    staging_root: &Path,
    tasks: &Mutex<HashMap<String, DownloadTask>>,
) {
    let Ok(tasks_guard) = tasks.lock() else {
        return;
    };
    let task_ids: std::collections::HashSet<_> = tasks_guard.keys().cloned().collect();
    let Ok(entries) = fs::read_dir(staging_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_directory = entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        let task_id = entry.file_name().to_string_lossy().into_owned();
        if is_directory && !task_ids.contains(&task_id) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn build_center_download_url(
    center_api_origin: &str,
    plugin_id: &str,
    version: &str,
) -> Result<Url, PluginCenterError> {
    build_center_api_url(
        center_api_origin,
        &[
            "v1",
            "marketplace",
            "plugins",
            plugin_id,
            "releases",
            version,
            "download",
        ],
    )
}

fn build_center_api_url(
    center_api_origin: &str,
    segments_to_append: &[&str],
) -> Result<Url, PluginCenterError> {
    let mut url = Url::parse(center_api_origin.trim_end_matches('/'))
        .map_err(|error| PluginCenterError::InvalidUrl(error.to_string()))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(PluginCenterError::InvalidUrl(
            "Center API origin must not contain credentials, query, or fragment".into(),
        ));
    }
    if url.scheme() != "https" && !is_loopback_host(&url) {
        return Err(PluginCenterError::InvalidUrl(
            "Center API must use HTTPS unless it is running on loopback".into(),
        ));
    }
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| PluginCenterError::InvalidUrl("cannot build Center API URL".into()))?;
        for segment in segments_to_append {
            segments.push(segment);
        }
    }
    Ok(url)
}

fn fetch_marketplace_page(
    center_api_origin: &str,
    query: Option<&str>,
    offset: u32,
) -> Result<PluginCatalogPage, PluginCenterError> {
    let mut url = build_center_api_url(center_api_origin, &["v1", "marketplace", "plugins"])?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("limit", "24");
        pairs.append_pair("offset", &offset.to_string());
        if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            pairs.append_pair("q", query.trim());
        }
    }
    let response = Client::builder()
        .user_agent("Harndock-Desktop-PluginCenter/1")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?;
    if !response.status().is_success() {
        return Err(PluginCenterError::Http(format!(
            "Center returned HTTP {}",
            response.status()
        )));
    }
    response
        .json()
        .map_err(|error| PluginCenterError::Http(format!("Center response is invalid: {error}")))
}

#[tauri::command]
pub(crate) fn plugin_marketplace_list(
    state: State<'_, PluginCenterState>,
    query: Option<String>,
    offset: Option<u32>,
) -> Result<PluginCatalogPage, String> {
    fetch_marketplace_page(
        state
            .center_api_origin()
            .map_err(|error| error.to_string())?,
        query.as_deref(),
        offset.unwrap_or(0),
    )
    .map_err(|error| error.to_string())
}

fn fetch_marketplace_detail(
    center_api_origin: &str,
    plugin_id: &str,
) -> Result<PluginMarketplaceDetail, PluginCenterError> {
    if plugin_id.trim().is_empty() {
        return Err(PluginCenterError::InvalidDeclaration(
            "plugin ID is required".into(),
        ));
    }
    let url = build_center_api_url(
        center_api_origin,
        &["v1", "marketplace", "plugins", plugin_id],
    )?;
    let response = Client::builder()
        .user_agent("Harndock-Desktop-PluginCenter/1")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?;
    if !response.status().is_success() {
        return Err(PluginCenterError::Http(format!(
            "Center returned HTTP {}",
            response.status()
        )));
    }
    response
        .json()
        .map_err(|error| PluginCenterError::Http(format!("Center response is invalid: {error}")))
}

#[tauri::command]
pub(crate) fn plugin_marketplace_detail(
    state: State<'_, PluginCenterState>,
    plugin_id: String,
) -> Result<PluginMarketplaceDetail, String> {
    fetch_marketplace_detail(
        state
            .center_api_origin()
            .map_err(|error| error.to_string())?,
        &plugin_id,
    )
    .map_err(|error| error.to_string())
}

fn is_loopback_host(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    )
}

fn fetch_download_declaration(
    center_api_origin: &str,
    plugin_id: &str,
    version: &str,
) -> Result<PluginDownloadDeclaration, PluginCenterError> {
    let url = build_center_download_url(center_api_origin, plugin_id, version)?;
    let response = Client::builder()
        .user_agent("Harndock-Desktop-PluginCenter/1")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| PluginCenterError::Http(error.to_string()))?;

    if !response.status().is_success() {
        return Err(PluginCenterError::Http(format!(
            "Center returned HTTP {}",
            response.status()
        )));
    }
    let declaration: PluginDownloadDeclaration = response
        .json()
        .map_err(|error| PluginCenterError::Http(format!("Center response is invalid: {error}")))?;
    validate_requested_declaration(&declaration, plugin_id, version)?;
    Ok(declaration)
}

fn validate_requested_declaration(
    declaration: &PluginDownloadDeclaration,
    plugin_id: &str,
    version: &str,
) -> Result<(), PluginCenterError> {
    validate_declaration(declaration)?;
    if declaration.plugin_id != plugin_id || declaration.version != version {
        return Err(PluginCenterError::InvalidDeclaration(
            "Center response does not match the requested plugin version".into(),
        ));
    }
    if declaration.source.release_tag != version
        && declaration.source.release_tag != format!("v{version}")
    {
        return Err(PluginCenterError::InvalidDeclaration(
            "GitHub release tag does not match the requested version".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn plugin_download_start(
    app: AppHandle,
    state: State<'_, PluginCenterState>,
    plugin_id: String,
    version: String,
) -> Result<PluginDownloadSnapshot, String> {
    if plugin_id.trim().is_empty() || version.trim().is_empty() {
        return Err("plugin ID and version are required".into());
    }
    let center_api_origin = state
        .center_api_origin()
        .map_err(|error| error.to_string())?
        .to_string();
    let staging_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin staging directory: {error}"))?
        .join("plugins")
        .join("staging");
    let task_id = state.next_task_id();
    let cancel = Arc::new(AtomicBool::new(false));
    let snapshot = PluginDownloadSnapshot {
        task_id: task_id.clone(),
        plugin_id: plugin_id.clone(),
        version: version.clone(),
        phase: PluginDownloadPhase::FetchingDeclaration,
        downloaded_bytes: 0,
        total_bytes: None,
        artifact_name: None,
        manifest_name: None,
        artifact_sha256: None,
        error: None,
        updated_at_ms: now_ms(),
    };
    let reservation = reserve_download_task(&state.tasks, snapshot.clone(), cancel)?;
    let (task_id, stale_task_ids) = match reservation {
        DownloadTaskReservation::Existing(existing) => return Ok(existing),
        DownloadTaskReservation::Created {
            task_id,
            stale_task_ids,
        } => (task_id, stale_task_ids),
    };
    for stale_task_id in stale_task_ids {
        let _ = fs::remove_dir_all(staging_root.join(stale_task_id));
    }
    cleanup_orphaned_staging_dirs(&staging_root, &state.tasks);

    let tasks = Arc::clone(&state.tasks);
    let task_id_for_thread = task_id.clone();
    let staging_dir = staging_root.join(&task_id_for_thread);
    let cancel = {
        let tasks_guard = state
            .tasks
            .lock()
            .map_err(|_| "plugin download state is unavailable".to_string())?;
        tasks_guard
            .get(&task_id_for_thread)
            .map(|task| Arc::clone(&task.cancel))
            .ok_or_else(|| "plugin download task was not reserved".to_string())?
    };
    thread::spawn(move || {
        let declaration = match fetch_download_declaration(&center_api_origin, &plugin_id, &version)
        {
            Ok(declaration) => declaration,
            Err(error) => {
                finish_download_task(
                    &tasks,
                    &task_id_for_thread,
                    &staging_dir,
                    PluginDownloadPhase::Failed,
                    Some(error.to_string()),
                );
                return;
            }
        };

        if cancel.load(Ordering::Acquire) {
            finish_download_task(
                &tasks,
                &task_id_for_thread,
                &staging_dir,
                PluginDownloadPhase::Cancelled,
                None,
            );
            return;
        }

        update_download_task(&tasks, &task_id_for_thread, |task| {
            task.snapshot.phase = PluginDownloadPhase::Downloading;
            task.snapshot.total_bytes = Some(declaration.size);
            task.snapshot.artifact_name = Some(declaration.source.asset_name.clone());
            task.snapshot.manifest_name = Some(declaration.source.manifest_asset_name.clone());
            task.declaration = Some(declaration.clone());
        });

        let tasks_for_progress = Arc::clone(&tasks);
        let task_id_for_progress = task_id_for_thread.clone();
        let result = download_plugin_artifact_with_progress(
            &declaration,
            &staging_dir,
            || cancel.load(Ordering::Acquire),
            |downloaded, total| {
                update_download_task(&tasks_for_progress, &task_id_for_progress, |task| {
                    task.snapshot.downloaded_bytes = downloaded;
                    task.snapshot.total_bytes = Some(total);
                });
            },
        );

        match result {
            Ok(artifact) => {
                match download_plugin_manifest(&declaration, &staging_dir, || {
                    cancel.load(Ordering::Acquire)
                }) {
                    Ok(manifest_path) => {
                        update_download_task(&tasks, &task_id_for_thread, |task| {
                            task.snapshot.phase = PluginDownloadPhase::Ready;
                            task.snapshot.downloaded_bytes = artifact.size;
                            task.snapshot.total_bytes = Some(artifact.size);
                            task.snapshot.artifact_sha256 = Some(artifact.sha256);
                            task.artifact_path = Some(artifact.path);
                            task.manifest_path = Some(manifest_path);
                        });
                    }
                    Err(PluginCenterError::Cancelled) => {
                        finish_download_task(
                            &tasks,
                            &task_id_for_thread,
                            &staging_dir,
                            PluginDownloadPhase::Cancelled,
                            None,
                        );
                    }
                    Err(error) => {
                        finish_download_task(
                            &tasks,
                            &task_id_for_thread,
                            &staging_dir,
                            PluginDownloadPhase::Failed,
                            Some(error.to_string()),
                        );
                    }
                }
            }
            Err(PluginCenterError::Cancelled) => {
                finish_download_task(
                    &tasks,
                    &task_id_for_thread,
                    &staging_dir,
                    PluginDownloadPhase::Cancelled,
                    None,
                );
            }
            Err(error) => {
                finish_download_task(
                    &tasks,
                    &task_id_for_thread,
                    &staging_dir,
                    PluginDownloadPhase::Failed,
                    Some(error.to_string()),
                );
            }
        }
    });

    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn plugin_download_status(
    state: State<'_, PluginCenterState>,
    task_id: String,
) -> Result<PluginDownloadSnapshot, String> {
    clone_download_snapshot(&state.tasks, &task_id)
        .ok_or_else(|| "plugin download task was not found".into())
}

#[tauri::command]
pub(crate) fn plugin_download_cancel(
    state: State<'_, PluginCenterState>,
    task_id: String,
) -> Result<PluginDownloadSnapshot, String> {
    let cancelled = update_download_task(&state.tasks, &task_id, |task| {
        if matches!(
            task.snapshot.phase,
            PluginDownloadPhase::FetchingDeclaration | PluginDownloadPhase::Downloading
        ) {
            task.snapshot.phase = PluginDownloadPhase::Cancelling;
            task.cancel.store(true, Ordering::Release);
        }
    });
    if !cancelled {
        return Err("plugin download task was not found".into());
    }
    clone_download_snapshot(&state.tasks, &task_id)
        .ok_or_else(|| "plugin download task was not found".into())
}

fn current_plugin_target() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", "x86_64") => "darwin-x64",
        ("windows", "aarch64") => "windows-aarch64",
        ("windows", "x86_64") => "windows-x64",
        ("linux", "aarch64") => "linux-aarch64",
        ("linux", "x86_64") => "linux-x64",
        _ => "unsupported",
    }
}

#[tauri::command]
pub(crate) fn plugin_install_preflight(
    state: State<'_, PluginCenterState>,
    task_id: String,
) -> Result<PluginInstallPreview, String> {
    let (plugin_id, version, archive_path, manifest_path, declaration) = {
        let tasks = state
            .tasks
            .lock()
            .map_err(|_| "plugin download state is unavailable".to_string())?;
        let task = tasks
            .get(&task_id)
            .ok_or_else(|| "plugin download task was not found".to_string())?;
        if task.snapshot.phase != PluginDownloadPhase::Ready {
            return Err("plugin download is not ready for preflight".into());
        }
        (
            task.snapshot.plugin_id.clone(),
            task.snapshot.version.clone(),
            task.artifact_path
                .clone()
                .ok_or_else(|| "plugin archive is unavailable".to_string())?,
            task.manifest_path
                .clone()
                .ok_or_else(|| "plugin manifest is unavailable".to_string())?,
            task.declaration
                .clone()
                .ok_or_else(|| "plugin download declaration is unavailable".to_string())?,
        )
    };
    let target = current_plugin_target();
    if target == "unsupported" {
        return Err("this platform is not supported by the plugin installer".into());
    }
    let signature = declaration
        .signature
        .as_ref()
        .map(|value| (value.key_id.as_str(), value.value.as_str()));
    let preflight = preflight_plugin_archive(
        &archive_path,
        &manifest_path,
        &plugin_id,
        &version,
        &declaration.sha256,
        declaration.size,
        signature,
        target,
        env!("CARGO_PKG_VERSION"),
        1,
    )
    .map_err(|error| error.to_string())?;
    let signature_key_id = preflight
        .manifest
        .signature
        .as_ref()
        .map(|value| value.key_id.clone())
        .ok_or_else(|| "verified plugin signature is unavailable".to_string())?;
    Ok(PluginInstallPreview {
        task_id,
        plugin_id,
        version,
        source_repository: declaration.source.repository,
        source_release_tag: declaration.source.release_tag,
        source_commit_sha: declaration.source.commit_sha,
        artifact_sha256: declaration.sha256,
        artifact_size: declaration.size,
        plugin_types: preflight.manifest.plugin_types,
        permissions: preflight.manifest.permissions,
        target: target.into(),
        harness_min_version: preflight.manifest.harness.min_version,
        runtime_api: preflight.manifest.runtime_api,
        entry_count: preflight.entry_count,
        unpacked_bytes: preflight.unpacked_bytes,
        contains_symlinks: preflight.contains_symlinks,
        signature_key_id,
    })
}

#[tauri::command]
pub(crate) fn plugin_install(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
    state: State<'_, PluginCenterState>,
    task_id: String,
) -> Result<PluginInstallResult, String> {
    ensure_runtime_stopped(&manager)?;
    let (plugin_id, version, archive_path, manifest_path, declaration) = {
        let tasks = state
            .tasks
            .lock()
            .map_err(|_| "plugin download state is unavailable".to_string())?;
        let task = tasks
            .get(&task_id)
            .ok_or_else(|| "plugin download task was not found".to_string())?;
        if task.snapshot.phase != PluginDownloadPhase::Ready {
            return Err("plugin download is not ready for installation".into());
        }
        (
            task.snapshot.plugin_id.clone(),
            task.snapshot.version.clone(),
            task.artifact_path
                .clone()
                .ok_or_else(|| "plugin archive is unavailable".to_string())?,
            task.manifest_path
                .clone()
                .ok_or_else(|| "plugin manifest is unavailable".to_string())?,
            task.declaration
                .clone()
                .ok_or_else(|| "plugin download declaration is unavailable".to_string())?,
        )
    };

    let target = current_plugin_target();
    if target == "unsupported" {
        return Err("this platform is not supported by the plugin installer".into());
    }
    let signature = declaration
        .signature
        .as_ref()
        .map(|value| (value.key_id.as_str(), value.value.as_str()));
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin store directory: {error}"))?;
    let store = PluginStore::new(app_data_dir);
    let installed = store
        .install_archive(
            &archive_path,
            &manifest_path,
            &plugin_id,
            &version,
            &declaration.sha256,
            declaration.size,
            signature,
            target,
            env!("CARGO_PKG_VERSION"),
            1,
        )
        .map_err(|error| error.to_string())?;

    if let Some(staging_dir) = archive_path.parent() {
        let _ = fs::remove_dir_all(staging_dir);
    }
    update_download_task(&state.tasks, &task_id, |task| {
        task.snapshot.phase = PluginDownloadPhase::Installed;
        task.artifact_path = None;
        task.manifest_path = None;
    });
    Ok(PluginInstallResult {
        task_id,
        plugin_id: installed.plugin_id,
        version: installed.version,
        health: "pending".into(),
    })
}

#[tauri::command]
pub(crate) fn plugin_installed_list(
    app: AppHandle,
) -> Result<Vec<InstalledPluginSnapshot>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin store directory: {error}"))?;
    PluginStore::new(app_data_dir)
        .list_installed()
        .map_err(|error| error.to_string())
}

fn ensure_runtime_stopped(manager: &State<'_, RuntimeManager>) -> Result<(), String> {
    if manager.can_manage_plugins() {
        Ok(())
    } else {
        Err("请先停止 Runtime，再安装、更新或修改插件".into())
    }
}

fn emit_plugin_health(
    app: &AppHandle,
    store: &PluginStore,
) -> Result<Vec<InstalledPluginSnapshot>, String> {
    let snapshots = store.list_installed().map_err(|error| error.to_string())?;
    app.emit("plugin://health", snapshots.clone())
        .map_err(|error| error.to_string())?;
    Ok(snapshots)
}

#[tauri::command]
pub(crate) fn plugin_rollback(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
    plugin_id: String,
) -> Result<InstalledPluginSnapshot, String> {
    ensure_runtime_stopped(&manager)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin store directory: {error}"))?;
    let store = PluginStore::new(app_data_dir);
    let pointer = store
        .rollback(&plugin_id)
        .map_err(|error| error.to_string())?;
    Ok(InstalledPluginSnapshot {
        plugin_id,
        version: pointer.version,
        previous_version: pointer.previous_version,
        health: pointer.health,
        enabled: pointer.enabled,
    })
}

#[tauri::command]
pub(crate) fn plugin_enable(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
    plugin_id: String,
) -> Result<InstalledPluginSnapshot, String> {
    ensure_runtime_stopped(&manager)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin store directory: {error}"))?;
    let store = PluginStore::new(app_data_dir);
    store
        .set_enabled(&plugin_id, true)
        .map_err(|error| error.to_string())?;
    let snapshots = emit_plugin_health(&app, &store)?;
    snapshots
        .into_iter()
        .find(|snapshot| snapshot.plugin_id == plugin_id)
        .ok_or_else(|| format!("plugin {plugin_id} disappeared after enabling"))
}

#[tauri::command]
pub(crate) fn plugin_disable(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
    plugin_id: String,
) -> Result<InstalledPluginSnapshot, String> {
    ensure_runtime_stopped(&manager)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin store directory: {error}"))?;
    let store = PluginStore::new(app_data_dir);
    store
        .set_enabled(&plugin_id, false)
        .map_err(|error| error.to_string())?;
    let snapshots = emit_plugin_health(&app, &store)?;
    snapshots
        .into_iter()
        .find(|snapshot| snapshot.plugin_id == plugin_id)
        .ok_or_else(|| format!("plugin {plugin_id} disappeared after disabling"))
}

#[tauri::command]
pub(crate) fn plugin_uninstall(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
    plugin_id: String,
) -> Result<Vec<InstalledPluginSnapshot>, String> {
    ensure_runtime_stopped(&manager)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve plugin store directory: {error}"))?;
    let store = PluginStore::new(app_data_dir);
    store
        .uninstall(&plugin_id)
        .map_err(|error| error.to_string())?;
    emit_plugin_health(&app, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn download_snapshot(
        plugin_id: &str,
        version: &str,
        phase: PluginDownloadPhase,
    ) -> PluginDownloadSnapshot {
        PluginDownloadSnapshot {
            task_id: format!("task-{plugin_id}-{version}"),
            plugin_id: plugin_id.into(),
            version: version.into(),
            phase,
            downloaded_bytes: 0,
            total_bytes: None,
            artifact_name: None,
            manifest_name: None,
            artifact_sha256: None,
            error: None,
            updated_at_ms: now_ms(),
        }
    }

    fn declaration() -> PluginDownloadDeclaration {
        PluginDownloadDeclaration {
            plugin_id: "demo-documents".into(),
            version: "1.2.3".into(),
            url: "https://github.com/deepseek-harness/demo-documents/releases/download/v1.2.3/demo-documents-1.2.3.tar.zst".into(),
            source: GithubPluginSource {
                provider: "github".into(),
                repository: "deepseek-harness/demo-documents".into(),
                release_tag: "v1.2.3".into(),
                commit_sha: "0123456789012345678901234567890123456789".into(),
                asset_name: "demo-documents-1.2.3.tar.zst".into(),
                manifest_asset_name: "manifest.json".into(),
                release_id: Some(42),
            },
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            size: 3,
            signature: None,
        }
    }

    #[test]
    fn accepts_a_canonical_github_release_asset_url() {
        assert!(validate_declaration(&declaration()).is_ok());
    }

    #[test]
    fn plugin_download_proxy_supports_direct_mode() {
        assert!(
            plugin_http_proxy_url_from(Some("direct"))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn reuses_an_active_download_for_the_same_plugin_version() {
        let tasks = Mutex::new(HashMap::new());
        let active = download_snapshot("demo-documents", "1.2.3", PluginDownloadPhase::Downloading);
        let active_task_id = active.task_id.clone();
        tasks.lock().unwrap().insert(
            active_task_id.clone(),
            DownloadTask {
                snapshot: active.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
                artifact_path: None,
                manifest_path: None,
                declaration: None,
            },
        );

        let reservation = reserve_download_task(
            &tasks,
            download_snapshot(
                "demo-documents",
                "1.2.3",
                PluginDownloadPhase::FetchingDeclaration,
            ),
            Arc::new(AtomicBool::new(false)),
        )
        .expect("same-version download should be idempotent");
        assert!(
            matches!(reservation, DownloadTaskReservation::Existing(snapshot) if snapshot == active)
        );
        assert_eq!(tasks.lock().unwrap().len(), 1);
        assert!(tasks.lock().unwrap().contains_key(&active_task_id));
    }

    #[test]
    fn rejects_a_second_active_version_for_the_same_plugin() {
        let tasks = Mutex::new(HashMap::new());
        let active = download_snapshot("demo-documents", "1.2.3", PluginDownloadPhase::Ready);
        tasks.lock().unwrap().insert(
            active.task_id.clone(),
            DownloadTask {
                snapshot: active,
                cancel: Arc::new(AtomicBool::new(false)),
                artifact_path: None,
                manifest_path: None,
                declaration: None,
            },
        );

        let error = reserve_download_task(
            &tasks,
            download_snapshot(
                "demo-documents",
                "1.2.4",
                PluginDownloadPhase::FetchingDeclaration,
            ),
            Arc::new(AtomicBool::new(false)),
        )
        .expect_err("different active versions should conflict");
        assert!(error.contains("already has an active download"));
        assert_eq!(tasks.lock().unwrap().len(), 1);
    }

    #[test]
    fn retry_reservation_removes_terminal_tasks_but_keeps_other_plugins() {
        let tasks = Mutex::new(HashMap::new());
        for (plugin_id, version, phase) in [
            ("demo-documents", "1.2.3", PluginDownloadPhase::Failed),
            ("demo-documents", "1.2.2", PluginDownloadPhase::Cancelled),
            ("other-plugin", "1.0.0", PluginDownloadPhase::Failed),
        ] {
            let snapshot = download_snapshot(plugin_id, version, phase);
            tasks.lock().unwrap().insert(
                snapshot.task_id.clone(),
                DownloadTask {
                    snapshot,
                    cancel: Arc::new(AtomicBool::new(false)),
                    artifact_path: None,
                    manifest_path: None,
                    declaration: None,
                },
            );
        }

        let reservation = reserve_download_task(
            &tasks,
            download_snapshot(
                "demo-documents",
                "1.2.4",
                PluginDownloadPhase::FetchingDeclaration,
            ),
            Arc::new(AtomicBool::new(false)),
        )
        .expect("retry should create a new task");
        let DownloadTaskReservation::Created {
            task_id,
            stale_task_ids,
        } = reservation
        else {
            panic!("retry should not reuse a terminal task");
        };
        assert_eq!(task_id, "task-demo-documents-1.2.4");
        assert_eq!(stale_task_ids.len(), 2);
        let tasks = tasks.lock().unwrap();
        assert!(tasks.contains_key("task-demo-documents-1.2.4"));
        assert!(tasks.contains_key("task-other-plugin-1.0.0"));
        assert!(!tasks.contains_key("task-demo-documents-1.2.3"));
        assert!(!tasks.contains_key("task-demo-documents-1.2.2"));
    }

    #[test]
    fn finishing_a_download_cleans_staging_without_touching_active_install_state() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after Unix epoch")
            .as_nanos();
        let staging_dir = std::env::temp_dir().join(format!("harndock-plugin-staging-{unique}"));
        fs::create_dir_all(&staging_dir).expect("staging directory should be writable");
        fs::write(staging_dir.join("partial.tar.zst"), b"partial")
            .expect("partial artifact should be writable");

        let tasks = Mutex::new(HashMap::new());
        let snapshot =
            download_snapshot("demo-documents", "1.2.3", PluginDownloadPhase::Downloading);
        let task_id = snapshot.task_id.clone();
        tasks.lock().unwrap().insert(
            task_id.clone(),
            DownloadTask {
                snapshot,
                cancel: Arc::new(AtomicBool::new(false)),
                artifact_path: Some(staging_dir.join("partial.tar.zst")),
                manifest_path: None,
                declaration: None,
            },
        );

        finish_download_task(
            &tasks,
            &task_id,
            &staging_dir,
            PluginDownloadPhase::Failed,
            Some("network failure".into()),
        );

        assert!(!staging_dir.exists());
        let task = tasks.lock().unwrap();
        let task = task
            .get(&task_id)
            .expect("failed task should remain inspectable");
        assert_eq!(task.snapshot.phase, PluginDownloadPhase::Failed);
        assert_eq!(task.snapshot.error.as_deref(), Some("network failure"));
        assert!(task.artifact_path.is_none());
    }

    #[test]
    fn cleanup_orphaned_staging_dirs_keeps_tasks_known_to_the_current_process() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after Unix epoch")
            .as_nanos();
        let staging_root =
            std::env::temp_dir().join(format!("harndock-plugin-staging-root-{unique}"));
        let active_task_id = "task-active";
        let orphan_task_id = "task-orphan";
        fs::create_dir_all(staging_root.join(active_task_id))
            .expect("active staging should be writable");
        fs::create_dir_all(staging_root.join(orphan_task_id))
            .expect("orphan staging should be writable");

        let tasks = Mutex::new(HashMap::new());
        let snapshot =
            download_snapshot("demo-documents", "1.2.3", PluginDownloadPhase::Downloading);
        tasks.lock().unwrap().insert(
            active_task_id.into(),
            DownloadTask {
                snapshot,
                cancel: Arc::new(AtomicBool::new(false)),
                artifact_path: None,
                manifest_path: None,
                declaration: None,
            },
        );

        cleanup_orphaned_staging_dirs(&staging_root, &tasks);

        assert!(staging_root.join(active_task_id).exists());
        assert!(!staging_root.join(orphan_task_id).exists());
        let _ = fs::remove_dir_all(staging_root);
    }

    #[test]
    fn rejects_a_url_that_does_not_match_the_source() {
        let mut value = declaration();
        value.url = "https://example.com/plugin.tar.zst".into();
        assert!(matches!(
            validate_declaration(&value),
            Err(PluginCenterError::InvalidUrl(_))
        ));
    }

    #[test]
    fn builds_a_versioned_center_download_endpoint() {
        let url = build_center_download_url(
            "https://plugins.example.com/",
            "com.example.documents",
            "1.2.3",
        )
        .expect("Center origin should be valid");
        assert_eq!(
            url.as_str(),
            "https://plugins.example.com/v1/marketplace/plugins/com.example.documents/releases/1.2.3/download"
        );
    }

    #[test]
    fn rejects_non_https_center_origins_except_loopback() {
        assert!(matches!(
            build_center_download_url("http://plugins.example.com", "demo", "1.0.0"),
            Err(PluginCenterError::InvalidUrl(_))
        ));
        assert!(build_center_download_url("http://127.0.0.1:7119", "demo", "1.0.0").is_ok());
    }

    #[test]
    fn rejects_path_traversal_in_asset_names() {
        let mut value = declaration();
        value.source.asset_name = "../plugin.tar.zst".into();
        assert!(matches!(
            validate_declaration(&value),
            Err(PluginCenterError::InvalidDeclaration(_))
        ));
    }

    #[test]
    fn deserializes_the_center_download_contract() {
        let mut value = declaration();
        value.signature = Some(PluginSignature {
            key_id: "marketplace-prod-1".into(),
            value: "signature".into(),
        });
        let encoded = serde_json::to_string(&value).expect("declaration should serialize");
        let decoded: PluginDownloadDeclaration =
            serde_json::from_str(&encoded).expect("Center contract should deserialize");
        assert_eq!(decoded, value);
    }

    #[test]
    fn deserializes_marketplace_pagination_contract() {
        let page: PluginCatalogPage = serde_json::from_str(
            r#"{"items":[],"limit":24,"offset":24,"hasMore":true,"nextOffset":48,"source":"published"}"#,
        )
        .expect("Marketplace pagination contract should deserialize");
        assert!(page.items.is_empty());
        assert_eq!(page.limit, 24);
        assert_eq!(page.offset, 24);
        assert!(page.has_more);
        assert_eq!(page.next_offset, Some(48));
        assert_eq!(page.source, "published");
    }

    #[test]
    fn deserializes_marketplace_detail_contract_for_update_checks() {
        let detail: PluginMarketplaceDetail = serde_json::from_str(
            r#"{
                "plugin":{"pluginId":"demo-documents","name":"Demo Documents","slug":"demo-documents","author":"DeepSeek Harness","category":"效率","summary":"Documents","description":"Details","iconUrl":null,"latestPublishedVersion":"1.2.3","updatedAt":"2026-09-10T00:00:00.000Z"},
                "releases":[{"pluginId":"demo-documents","version":"1.2.3","status":"published","pluginTypes":["skill"],"summary":"Documents","description":"Release notes","permissions":{"filesystem":["workspace"]},"harnessMinVersion":"0.1.0","runtimeApi":1,"platforms":["darwin-aarch64"],"createdAt":"2026-09-09T00:00:00.000Z","publishedAt":"2026-09-10T00:00:00.000Z"}]
            }"#,
        )
        .expect("Marketplace detail contract should deserialize");
        assert_eq!(
            detail.plugin.latest_published_version.as_deref(),
            Some("1.2.3")
        );
        assert_eq!(detail.releases[0].version, "1.2.3");
        assert_eq!(detail.releases[0].status, "published");
        assert_eq!(detail.releases[0].runtime_api, 1);
    }

    #[test]
    fn rejects_a_center_response_for_a_different_requested_version() {
        let value = declaration();
        assert!(matches!(
            validate_requested_declaration(&value, "demo-documents", "9.9.9"),
            Err(PluginCenterError::InvalidDeclaration(_))
        ));
    }

    #[test]
    fn verifies_a_local_artifact_by_size_and_sha256() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("harndock-plugin-test-{unique}.bin"));
        fs::write(&path, b"abc").expect("test artifact should be writable");
        assert!(
            verify_plugin_artifact(
                &path,
                3,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            )
            .is_ok()
        );
        let _ = fs::remove_file(path);
    }
}
