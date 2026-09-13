mod control;
mod readiness;
mod signer;
mod store;

use std::{
    collections::VecDeque,
    env,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc, Condvar, Mutex, MutexGuard,
        mpsc::{self, Receiver, Sender, TryRecvError},
    },
    thread,
    time::{Duration, Instant},
};

use crate::plugin_installer::{ActiveInstalledPlugin, PluginStore};
use control::{
    ControlEvent, ControlExpectation, ControlListener, ReadyFrame, RemoteSyncConnectionState,
    RemoteSyncStatusFrame,
};
use readiness::parse_ready_url;
use serde::{Deserialize, Serialize};
use signer::SignerListener;
use store::RuntimeStore;
use tauri::{AppHandle, Emitter, Manager, State, Url};

const MAIN_WINDOW_LABEL: &str = "main";
const STATE_EVENT: &str = "runtime://state";
const LOG_EVENT: &str = "runtime://log";
const PLUGIN_HEALTH_EVENT: &str = "plugin://health";
const LOG_LIMIT: usize = 500;
const LOG_LINE_LIMIT: usize = 8 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);
const STOP_GRACE: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimePhase {
    #[default]
    Stopped,
    Starting,
    Ready,
    Stopping,
    Failed,
    Crashed,
}

impl RuntimePhase {
    fn can_start(self) -> bool {
        matches!(self, Self::Stopped | Self::Failed | Self::Crashed)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFailure {
    kind: RuntimeFailureKind,
    message: String,
}

impl RuntimeFailure {
    fn new(kind: RuntimeFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum RuntimeFailureKind {
    Configuration,
    ExecutableMissing,
    SpawnFailed,
    OutputClosed,
    OutputReadFailed,
    InvalidReadyUrl,
    StartupTimeout,
    ExitedBeforeReady,
    ProfileFailed,
    PortFailed,
    RuntimeExited,
    NavigationFailed,
    RuntimeUnavailable,
    ManifestInvalid,
    ControlFailed,
    RuntimeInstallFailed,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    phase: RuntimePhase,
    profile: String,
    url: Option<String>,
    pid: Option<u32>,
    error: Option<RuntimeFailure>,
    remote_sync: RemoteSyncRuntimeSnapshot,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncRuntimeSnapshot {
    connection_state: RemoteSyncConnectionState,
    gateway_connected: bool,
    runtime_online: bool,
    last_heartbeat_at_ms: Option<u64>,
    observed_at_ms: Option<u64>,
}

impl RemoteSyncRuntimeSnapshot {
    fn apply(&mut self, frame: RemoteSyncStatusFrame) {
        if self
            .observed_at_ms
            .is_some_and(|current| frame.observed_at_ms < current)
        {
            return;
        }
        self.connection_state = frame.connection_state;
        self.gateway_connected = matches!(
            frame.connection_state,
            RemoteSyncConnectionState::Handshaking | RemoteSyncConnectionState::Connected
        );
        self.runtime_online = frame.connection_state == RemoteSyncConnectionState::Connected;
        self.last_heartbeat_at_ms = frame.last_heartbeat_at_ms;
        self.observed_at_ms = Some(frame.observed_at_ms);
    }

    fn mark_stopped(&mut self) {
        self.connection_state = RemoteSyncConnectionState::Stopped;
        self.gateway_connected = false;
        self.runtime_online = false;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum RuntimeLogStream {
    Stdout,
    Stderr,
    Shell,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogLine {
    sequence: u64,
    stream: RuntimeLogStream,
    line: String,
}

#[derive(Debug)]
struct RuntimeState {
    snapshot: RuntimeSnapshot,
    generation: u64,
    control: Option<Sender<Control>>,
    bootstrap_url: Option<Url>,
    runtime_navigation_url: Option<Url>,
    logs: VecDeque<RuntimeLogLine>,
    next_log_sequence: u64,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            snapshot: RuntimeSnapshot {
                phase: RuntimePhase::Stopped,
                profile: "desktop".to_string(),
                ..RuntimeSnapshot::default()
            },
            generation: 0,
            control: None,
            bootstrap_url: None,
            runtime_navigation_url: None,
            logs: VecDeque::new(),
            next_log_sequence: 1,
        }
    }
}

#[derive(Debug, Default)]
struct Shared {
    state: Mutex<RuntimeState>,
    terminal: Condvar,
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeManager {
    shared: Arc<Shared>,
}

#[derive(Clone, Copy, Debug)]
enum Control {
    Stop,
}

#[derive(Clone, Copy, Debug)]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug)]
enum OutputEvent {
    Line(OutputStream, String),
    Closed(OutputStream),
    ReadFailed(OutputStream, String),
}

#[derive(Debug)]
struct DevRuntimeConfig {
    node: OsString,
    harness_dir: PathBuf,
    workspace_dir: PathBuf,
    dsh_home: PathBuf,
    agents_home: PathBuf,
    adapter: PathBuf,
    entry: PathBuf,
    tsx_loader_url: String,
    tsconfig: PathBuf,
}

#[derive(Debug)]
struct ProductionRuntimeConfig {
    node: PathBuf,
    runtime_root: PathBuf,
    workspace_dir: PathBuf,
    dsh_home: PathBuf,
    agents_home: PathBuf,
    entry: PathBuf,
    runtime_version: String,
    runtime_api: u32,
    harness_commit: String,
    control_dir: PathBuf,
    remote_sync: Option<(PathBuf, String)>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BundledRuntimeDescriptor {
    #[serde(rename = "$schema")]
    schema: String,
    #[serde(rename = "runtimeVersion")]
    runtime_version: String,
    target: String,
    archive: String,
}

impl ProductionRuntimeConfig {
    fn resolve(app: &AppHandle) -> Result<Self, RuntimeFailure> {
        let app_data = app.path().app_data_dir().map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::Configuration,
                format!("could not resolve the Harndock application data directory: {error}"),
            )
        })?;
        let store = RuntimeStore::new(&app_data);
        store.ensure_layout().map_err(store_failure)?;
        ensure_bundled_runtime(app, &store)?;
        let (pointer, installed) = store.current().map_err(store_failure)?.ok_or_else(|| {
            RuntimeFailure::new(
                RuntimeFailureKind::RuntimeUnavailable,
                "no active Runtime is installed",
            )
        })?;
        let manifest = store.manifest(&installed).map_err(|error| {
            RuntimeFailure::new(RuntimeFailureKind::ManifestInvalid, error.to_string())
        })?;
        if manifest.target != runtime_target() {
            return Err(RuntimeFailure::new(
                RuntimeFailureKind::ManifestInvalid,
                format!(
                    "Runtime target {} does not match this application target {}",
                    manifest.target,
                    runtime_target()
                ),
            ));
        }
        let node = require_runtime_file(&installed.root, &manifest.launch.node, "Runtime Node")?;
        let entry = require_runtime_file(
            &installed.root,
            &manifest.launch.harness_entrypoint,
            "Runtime Harness entrypoint",
        )?;
        let package_manager_entrypoint = require_runtime_file(
            &installed.root,
            &manifest.launch.package_manager_entrypoint,
            "Runtime package manager entrypoint",
        )?;
        let cwd = require_runtime_directory(&installed.root, &manifest.launch.cwd, "Runtime cwd")?;
        let dsh_home = app_data.join("harness-home");
        let workspace_dir = app_data.join("workspace");
        let agents_home = app_data.join("agents-home");
        for directory in [&dsh_home, &workspace_dir, &agents_home] {
            fs::create_dir_all(directory).map_err(|error| {
                RuntimeFailure::new(
                    RuntimeFailureKind::Configuration,
                    format!(
                        "could not create runtime directory {}: {error}",
                        directory.display()
                    ),
                )
            })?;
        }
        let plugin_store = PluginStore::new(&app_data);
        let active_plugins = plugin_store
            .active_plugins()
            .map_err(|error| {
                RuntimeFailure::new(
                    RuntimeFailureKind::RuntimeInstallFailed,
                    format!("could not inspect installed plugins: {error}"),
                )
            })?
            .into_iter()
            .filter(|plugin| plugin.enabled)
            .collect::<Vec<_>>();
        let profile_result = prepare_production_profile(
            &node,
            &entry,
            &package_manager_entrypoint,
            &installed.root,
            &dsh_home,
            &workspace_dir,
            &store.control_dir(),
            &pointer.runtime_version,
            &manifest,
            &active_plugins,
        );
        if profile_result.is_err() {
            let _ = plugin_store.rollback_pending();
        }
        profile_result?;

        let remote_sync = crate::remote_sync::read_config(app)
            .map_err(|error| RuntimeFailure::new(RuntimeFailureKind::Configuration, error))?
            .map(|(path, config)| (path, config.device_id));

        Ok(Self {
            node,
            runtime_root: installed.root,
            workspace_dir: cwd,
            dsh_home,
            agents_home,
            entry,
            runtime_version: pointer.runtime_version,
            runtime_api: manifest.runtime_api,
            harness_commit: manifest.components.harness.commit,
            control_dir: store.control_dir(),
            remote_sync,
        })
    }

    fn command(
        &self,
        endpoint: &str,
        nonce: &str,
        signer_endpoint: Option<&str>,
        remote_sync_config: Option<&Path>,
    ) -> Command {
        let mut command = Command::new(&self.node);
        command
            .arg(&self.entry)
            .current_dir(&self.workspace_dir)
            .env("DSH_HOME", &self.dsh_home)
            .env("DSH_AGENTS_HOME", &self.agents_home)
            .env("HARNDOCK_PARENT_PID", std::process::id().to_string())
            .env("HARNDOCK_CONTROL_ENDPOINT", endpoint)
            .env("HARNDOCK_CONTROL_NONCE", nonce)
            .env("HARNDOCK_RUNTIME_VERSION", &self.runtime_version)
            .env("HARNDOCK_RUNTIME_API", self.runtime_api.to_string())
            .env("HARNDOCK_HARNESS_COMMIT", &self.harness_commit)
            .arg("--profile")
            .arg("desktop")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg("0")
            .arg("--no-open")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(value) = signer_endpoint {
            command.env("HARNDOCK_REMOTE_SYNC_SIGN_ENDPOINT", value);
        }
        if let Some(path) = remote_sync_config {
            command.env("HARNDOCK_REMOTE_SYNC_CONFIG_PATH", path);
        }
        configure_process_group(&mut command);
        command
    }
}

#[allow(clippy::too_many_arguments)]
fn prepare_production_profile(
    node: &Path,
    harness_entrypoint: &Path,
    package_manager_entrypoint: &Path,
    runtime_root: &Path,
    dsh_home: &Path,
    workspace_dir: &Path,
    control_dir: &Path,
    runtime_version: &str,
    manifest: &store::RuntimeManifest,
    active_plugins: &[ActiveInstalledPlugin],
) -> Result<(), RuntimeFailure> {
    let profile_dir = dsh_home.join("profiles/desktop");
    let marker = control_dir.join("desktop-profile-version");
    let profile_marker = desktop_profile_marker(runtime_version, active_plugins);
    for plugin in active_plugins {
        if !plugin.installed.root.join("package.json").is_file() {
            return Err(RuntimeFailure::new(
                RuntimeFailureKind::RuntimeInstallFailed,
                format!(
                    "installed plugin {} v{} has no package.json entrypoint",
                    plugin.installed.plugin_id, plugin.installed.version
                ),
            ));
        }
    }
    let packages_are_present = manifest.product_packages.iter().all(|package| {
        profile_dir
            .join("node_modules")
            .join(package.name.replace('/', std::path::MAIN_SEPARATOR_STR))
            .join("package.json")
            .is_file()
    });
    let plugin_packages_are_present = active_plugins
        .iter()
        .all(|plugin| profile_contains_plugin(&profile_dir, plugin));
    if packages_are_present
        && plugin_packages_are_present
        && fs::read_to_string(&marker).is_ok_and(|value| value.trim() == profile_marker)
    {
        return Ok(());
    }

    let shim_dir = control_dir.join("profile-tools");
    fs::create_dir_all(&shim_dir).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not prepare the Runtime package manager shim: {error}"),
        )
    })?;
    let pnpm_shim = shim_dir.join("pnpm");
    fs::write(
        &pnpm_shim,
        "#!/bin/sh\nexec \"$HARNDOCK_PROFILE_NODE\" \"$HARNDOCK_PROFILE_PNPM\" \"$@\"\n",
    )
    .map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not write the Runtime package manager shim: {error}"),
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&shim_dir, fs::Permissions::from_mode(0o700)).map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::RuntimeInstallFailed,
                format!("could not protect the Runtime package manager shim: {error}"),
            )
        })?;
        fs::set_permissions(&pnpm_shim, fs::Permissions::from_mode(0o700)).map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::RuntimeInstallFailed,
                format!("could not make the Runtime package manager shim executable: {error}"),
            )
        })?;
    }
    let path = env::join_paths(
        std::iter::once(shim_dir.clone())
            .chain(env::split_paths(&env::var_os("PATH").unwrap_or_default())),
    )
    .map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not construct the Runtime package manager PATH: {error}"),
        )
    })?;
    let package_arguments = manifest
        .product_packages
        .iter()
        .map(|package| {
            format!(
                "file:{}",
                runtime_root.join(&package.path).to_string_lossy()
            )
        })
        .chain(
            active_plugins
                .iter()
                .map(|plugin| format!("file:{}", plugin.installed.root.to_string_lossy())),
        );
    let output = Command::new(node)
        .arg(harness_entrypoint)
        .args(["plugin", "--profile", "desktop", "add", "--force"])
        .args(package_arguments)
        .current_dir(workspace_dir)
        .env("DSH_HOME", dsh_home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("HARNDOCK_PROFILE_NODE", node)
        .env("HARNDOCK_PROFILE_PNPM", package_manager_entrypoint)
        .env("PATH", path)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::RuntimeInstallFailed,
                format!("could not refresh the Desktop Runtime profile: {error}"),
            )
        })?;
    if !output.status.success() {
        return Err(RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!(
                "Desktop Runtime profile refresh failed with status {}",
                output.status
            ),
        ));
    }
    normalize_profile_bundles(&profile_dir, &manifest.profile.bundles)?;
    fs::write(&marker, format!("{profile_marker}\n")).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not record the Desktop Runtime profile version: {error}"),
        )
    })?;
    Ok(())
}

fn desktop_profile_marker(
    runtime_version: &str,
    active_plugins: &[ActiveInstalledPlugin],
) -> String {
    let mut marker = format!("runtime={runtime_version}");
    for plugin in active_plugins {
        marker.push('\n');
        marker.push_str("plugin=");
        marker.push_str(&plugin.installed.plugin_id);
        marker.push('@');
        marker.push_str(&plugin.installed.version);
    }
    marker
}

fn profile_contains_plugin(profile_dir: &Path, plugin: &ActiveInstalledPlugin) -> bool {
    let package_path = plugin.installed.root.join("package.json");
    let Ok(content) = fs::read_to_string(package_path) else {
        return false;
    };
    let Ok(package) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(name) = package.get("name").and_then(serde_json::Value::as_str) else {
        return false;
    };
    profile_dir
        .join("node_modules")
        .join(name.replace('/', std::path::MAIN_SEPARATOR_STR))
        .join("package.json")
        .is_file()
}

fn normalize_profile_bundles(
    profile_dir: &Path,
    product_bundles: &[String],
) -> Result<(), RuntimeFailure> {
    let path = profile_dir.join("package.json");
    let content = fs::read_to_string(&path).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not read the refreshed Desktop profile: {error}"),
        )
    })?;
    let mut value: serde_json::Value = serde_json::from_str(&content).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("refreshed Desktop profile is invalid: {error}"),
        )
    })?;
    let bundles = value
        .pointer_mut("/dsh/profile/bundles")
        .and_then(serde_json::Value::as_array_mut)
        .ok_or_else(|| {
            RuntimeFailure::new(
                RuntimeFailureKind::RuntimeInstallFailed,
                "refreshed Desktop profile has no bundle list",
            )
        })?;
    if bundles.iter().any(|bundle| !bundle.is_string()) {
        return Err(RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            "refreshed Desktop profile bundle list contains a non-string value",
        ));
    }
    let product = product_bundles
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let third_party = bundles
        .iter()
        .filter_map(serde_json::Value::as_str)
        .filter(|bundle| !product.contains(*bundle))
        .map(|bundle| serde_json::Value::String(bundle.to_string()))
        .collect::<Vec<_>>();
    *bundles = product_bundles
        .iter()
        .cloned()
        .map(serde_json::Value::String)
        .chain(third_party)
        .collect();
    let serialized = serde_json::to_string_pretty(&value).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not serialize the refreshed Desktop profile: {error}"),
        )
    })?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, format!("{serialized}\n")).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not stage the refreshed Desktop profile: {error}"),
        )
    })?;
    fs::rename(&temporary, &path).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not activate the refreshed Desktop profile: {error}"),
        )
    })
}

fn store_failure(error: store::RuntimeStoreError) -> RuntimeFailure {
    RuntimeFailure::new(RuntimeFailureKind::Configuration, error.to_string())
}

fn ensure_bundled_runtime(app: &AppHandle, store: &RuntimeStore) -> Result<(), RuntimeFailure> {
    let resource_dir = app.path().resource_dir().map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not resolve the bundled Runtime resource directory: {error}"),
        )
    })?;
    let descriptor_path = resource_dir.join("runtime/bundled-runtime.json");
    let content = fs::read_to_string(&descriptor_path).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!(
                "bundled Runtime descriptor {} is unavailable: {error}",
                descriptor_path.display()
            ),
        )
    })?;
    let descriptor: BundledRuntimeDescriptor = serde_json::from_str(&content).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!(
                "bundled Runtime descriptor {} is invalid: {error}",
                descriptor_path.display()
            ),
        )
    })?;
    let expected_archive = format!(
        "harndock-runtime-{}-{}.tar.zst",
        descriptor.runtime_version, descriptor.target
    );
    if descriptor.schema != "./bundled-runtime.schema.json"
        || descriptor.target != runtime_target()
        || !is_runtime_version(&descriptor.runtime_version)
        || descriptor.archive != expected_archive
        || descriptor.archive
            != Path::new(&descriptor.archive)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
        || descriptor.archive.contains('\\')
        || !descriptor.archive.ends_with(".tar.zst")
    {
        return Err(RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            "bundled Runtime descriptor does not match this application target",
        ));
    }
    if store
        .current()
        .map_err(store_failure)?
        .is_some_and(|(pointer, _)| {
            compare_runtime_versions(&pointer.runtime_version, &descriptor.runtime_version)
                != std::cmp::Ordering::Less
        })
    {
        return Ok(());
    }
    let archive = resource_dir.join("runtime").join(&descriptor.archive);
    if store.installed(&descriptor.runtime_version).is_ok() {
        store
            .activate(&descriptor.runtime_version)
            .map_err(store_failure)?;
        return Ok(());
    }
    match store.install_archive(&archive, &descriptor.target, &descriptor.runtime_version) {
        Ok(_) => Ok(()),
        Err(store::RuntimeStoreError::AlreadyInstalled(_)) => store
            .activate(&descriptor.runtime_version)
            .map(|_| ())
            .map_err(store_failure),
        Err(error) => Err(RuntimeFailure::new(
            RuntimeFailureKind::RuntimeInstallFailed,
            format!("could not install the bundled Runtime: {error}"),
        )),
    }
}

fn compare_runtime_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parts = |value: &str| {
        value
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or_default())
            .collect::<Vec<_>>()
    };
    parts(left).cmp(&parts(right))
}

fn is_runtime_version(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 4
        && parts[0].len() == 4
        && parts[0].chars().all(|character| character.is_ascii_digit())
        && parts[1].len() == 2
        && parts[1].chars().all(|character| character.is_ascii_digit())
        && parts[2].len() == 2
        && parts[2].chars().all(|character| character.is_ascii_digit())
        && parts[3].chars().all(|character| character.is_ascii_digit())
        && !parts[3].starts_with('0')
}

fn require_runtime_file(
    root: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, RuntimeFailure> {
    let path = root.join(relative);
    require_file(&path, label)
}

fn require_runtime_directory(
    root: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, RuntimeFailure> {
    let path = root.join(relative);
    path.canonicalize().map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::Configuration,
            format!("{label} {} is unavailable: {error}", path.display()),
        )
    })
}

fn runtime_target() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "darwin-aarch64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "darwin-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "linux-aarch64"
    } else {
        "linux-x86_64"
    }
}

fn production_mode() -> bool {
    match env::var("HARNDOCK_RUNTIME_MODE").as_deref() {
        Ok("development") => false,
        Ok("production") => true,
        _ => !cfg!(debug_assertions),
    }
}

impl DevRuntimeConfig {
    fn resolve(app: &AppHandle) -> Result<Self, RuntimeFailure> {
        let harness_dir = env::var_os("HARNDOCK_HARNESS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../..")
                    .join("vendor/deepseek-harness")
            });
        let harness_dir = harness_dir.canonicalize().map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::Configuration,
                format!(
                    "Harness source directory {} is unavailable: {error}",
                    harness_dir.display()
                ),
            )
        })?;
        let app_data = app.path().app_data_dir().map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::Configuration,
                format!("could not resolve the Harndock application data directory: {error}"),
            )
        })?;
        RuntimeStore::new(&app_data)
            .ensure_layout()
            .map_err(|error| {
                RuntimeFailure::new(
                    RuntimeFailureKind::Configuration,
                    format!("could not prepare the Runtime store: {error}"),
                )
            })?;
        let dsh_home = env::var_os("HARNDOCK_HARNESS_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data.join("harness-home"));
        let workspace_dir = app_data.join("workspace");
        let agents_home = app_data.join("agents-home");
        for directory in [&dsh_home, &workspace_dir, &agents_home] {
            fs::create_dir_all(directory).map_err(|error| {
                RuntimeFailure::new(
                    RuntimeFailureKind::Configuration,
                    format!(
                        "could not create runtime directory {}: {error}",
                        directory.display()
                    ),
                )
            })?;
        }

        let entry = require_file(
            &harness_dir.join("apps/cli/src/bin.ts"),
            "Harness CLI entry",
        )?;
        let adapter = require_file(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../scripts/dev-harness-runtime.mjs"),
            "Harndock development Runtime adapter",
        )?;
        let loader = require_file(
            &harness_dir.join("node_modules/tsx/dist/loader.mjs"),
            "Harness tsx loader (run pnpm install in vendor/deepseek-harness)",
        )?;
        let tsconfig = require_file(
            &harness_dir.join("tsconfig.json"),
            "Harness TypeScript config",
        )?;
        let tsx_loader_url = Url::from_file_path(&loader)
            .map_err(|_| {
                RuntimeFailure::new(
                    RuntimeFailureKind::Configuration,
                    format!(
                        "could not convert the tsx loader path to a file URL: {}",
                        loader.display()
                    ),
                )
            })?
            .to_string();

        Ok(Self {
            node: env::var_os("HARNDOCK_NODE").unwrap_or_else(|| OsString::from("node")),
            harness_dir,
            workspace_dir,
            dsh_home,
            agents_home,
            adapter,
            entry,
            tsx_loader_url,
            tsconfig,
        })
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.node);
        command
            .arg(&self.adapter)
            .current_dir(&self.workspace_dir)
            .env("DSH_HOME", &self.dsh_home)
            .env("DSH_AGENTS_HOME", &self.agents_home)
            .env("HARNDOCK_PARENT_PID", std::process::id().to_string())
            .env("HARNDOCK_HARNESS_ENTRY", &self.entry)
            .env("HARNDOCK_TSX_LOADER_URL", &self.tsx_loader_url)
            .env("TSX_TSCONFIG_PATH", &self.tsconfig)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_group(&mut command);
        command
    }
}

fn require_file(path: &Path, label: &str) -> Result<PathBuf, RuntimeFailure> {
    path.canonicalize().map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::Configuration,
            format!("{label} {} is unavailable: {error}", path.display()),
        )
    })
}

impl RuntimeManager {
    pub fn status(&self) -> RuntimeSnapshot {
        lock_state(&self.shared).snapshot.clone()
    }

    pub(crate) fn can_manage_plugins(&self) -> bool {
        matches!(
            lock_state(&self.shared).snapshot.phase,
            RuntimePhase::Stopped | RuntimePhase::Failed | RuntimePhase::Crashed
        )
    }

    pub fn logs(&self) -> Vec<RuntimeLogLine> {
        lock_state(&self.shared).logs.iter().cloned().collect()
    }

    pub fn start(&self, app: &AppHandle) -> Result<RuntimeSnapshot, RuntimeFailure> {
        self.capture_bootstrap_url(app);
        let development = !production_mode();
        let dev_config = if development {
            match DevRuntimeConfig::resolve(app) {
                Ok(config) => Some(config),
                Err(failure) => {
                    self.fail_current(app, failure.clone());
                    return Err(failure);
                }
            }
        } else {
            None
        };
        let production_config = if development {
            None
        } else {
            match ProductionRuntimeConfig::resolve(app) {
                Ok(config) => Some(config),
                Err(failure) => {
                    self.fail_current(app, failure.clone());
                    return Err(failure);
                }
            }
        };

        let generation = {
            let mut state = lock_state(&self.shared);
            if !state.snapshot.phase.can_start() {
                return Ok(state.snapshot.clone());
            }
            state.generation += 1;
            state.snapshot = RuntimeSnapshot {
                phase: RuntimePhase::Starting,
                profile: "desktop".to_string(),
                ..RuntimeSnapshot::default()
            };
            state.runtime_navigation_url = None;
            state.generation
        };
        self.publish_state(app);

        let (mut command, control_listener, mut signer_listener) = if let Some(config) = dev_config
        {
            self.record_log(
                app,
                RuntimeLogStream::Shell,
                format!(
                    "starting Harness desktop profile from {}",
                    config.harness_dir.display()
                ),
            );
            (config.command(), None, None)
        } else {
            let config = production_config.expect("production config must be resolved");
            let nonce = match control::generate_nonce() {
                Ok(nonce) => nonce,
                Err(message) => {
                    let failure = RuntimeFailure::new(RuntimeFailureKind::ControlFailed, message);
                    self.fail_generation(app, generation, failure.clone());
                    return Err(failure);
                }
            };
            let socket_path = config.control_dir.join("control.sock");
            let endpoint = format!("unix:{}", socket_path.display());
            let (readiness_tx, readiness_rx) = mpsc::channel();
            let listener = match ControlListener::bind(
                config.control_dir.clone(),
                ControlExpectation {
                    nonce: nonce.clone(),
                    runtime_version: config.runtime_version.clone(),
                    runtime_api: config.runtime_api,
                    harness_commit: config.harness_commit.clone(),
                },
                readiness_tx,
            ) {
                Ok(listener) => listener,
                Err(message) => {
                    let failure = RuntimeFailure::new(RuntimeFailureKind::ControlFailed, message);
                    self.fail_generation(app, generation, failure.clone());
                    return Err(failure);
                }
            };
            let mut signer = None;
            if let Some((_, device_id)) = config.remote_sync.as_ref() {
                signer = match SignerListener::bind(config.control_dir.clone(), device_id) {
                    Ok(listener) => Some(listener),
                    Err(message) => {
                        listener.close();
                        let failure =
                            RuntimeFailure::new(RuntimeFailureKind::ControlFailed, message);
                        self.fail_generation(app, generation, failure.clone());
                        return Err(failure);
                    }
                };
            }
            let signer_endpoint = signer.as_ref().map(SignerListener::endpoint);
            let remote_sync_config = config.remote_sync.as_ref().map(|(path, _)| path.as_path());
            let command = config.command(
                &endpoint,
                &nonce,
                signer_endpoint.as_deref(),
                remote_sync_config,
            );
            self.record_log(
                app,
                RuntimeLogStream::Shell,
                format!(
                    "starting packaged Harness Runtime {} from {}",
                    config.runtime_version,
                    config.runtime_root.display()
                ),
            );
            (command, Some((listener, readiness_rx)), signer)
        };

        let (readiness_rx, mut listener) = match control_listener {
            Some((listener, readiness_rx)) => (Some(readiness_rx), Some(listener)),
            None => (None, None),
        };

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                if let Some(listener) = listener.take() {
                    listener.close();
                }
                if let Some(signer) = signer_listener.take() {
                    signer.close();
                }
                let kind = if error.kind() == std::io::ErrorKind::NotFound {
                    RuntimeFailureKind::ExecutableMissing
                } else {
                    RuntimeFailureKind::SpawnFailed
                };
                let failure = RuntimeFailure::new(
                    kind,
                    format!("could not start the configured Runtime executable: {error}"),
                );
                self.fail_generation(app, generation, failure.clone());
                return Err(failure);
            }
        };
        let pid = child.id();
        let stdout = child.stdout.take().expect("piped stdout must be available");
        let stderr = child.stderr.take().expect("piped stderr must be available");
        let (control_tx, control_rx) = mpsc::channel();
        let (output_tx, output_rx) = mpsc::channel();
        {
            let mut state = lock_state(&self.shared);
            if state.generation != generation {
                terminate_process(&mut child, STOP_GRACE);
                if let Some(listener) = listener {
                    listener.close();
                }
                if let Some(signer) = signer_listener {
                    signer.close();
                }
                return Ok(state.snapshot.clone());
            }
            state.control = Some(control_tx);
            state.snapshot.pid = Some(pid);
        }
        self.publish_state(app);
        spawn_output_reader(stdout, OutputStream::Stdout, output_tx.clone());
        spawn_output_reader(stderr, OutputStream::Stderr, output_tx);

        let shared = Arc::clone(&self.shared);
        let app_handle = app.clone();
        thread::spawn(move || {
            supervise_process(
                shared,
                app_handle,
                generation,
                child,
                control_rx,
                output_rx,
                readiness_rx,
                listener,
                signer_listener,
            );
        });

        Ok(self.status())
    }

    pub fn stop(&self, app: &AppHandle) -> RuntimeSnapshot {
        let (snapshot, control) = {
            let mut state = lock_state(&self.shared);
            let Some(control) = state.control.clone() else {
                return state.snapshot.clone();
            };
            if state.snapshot.phase != RuntimePhase::Stopping {
                state.snapshot.phase = RuntimePhase::Stopping;
                state.snapshot.url = None;
                state.snapshot.error = None;
                state.runtime_navigation_url = None;
            }
            (state.snapshot.clone(), control)
        };
        emit_state(app, &snapshot);
        let _ = control.send(Control::Stop);
        snapshot
    }

    pub fn shutdown_blocking(&self, app: &AppHandle, timeout: Duration) {
        self.stop(app);
        let state = lock_state(&self.shared);
        if state.control.is_none() {
            return;
        }
        let _ = self
            .shared
            .terminal
            .wait_timeout_while(state, timeout, |state| state.control.is_some())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }

    pub fn show_settings(&self, app: &AppHandle) -> Result<(), RuntimeFailure> {
        let bootstrap_url = lock_state(&self.shared)
            .bootstrap_url
            .clone()
            .ok_or_else(|| {
                RuntimeFailure::new(
                    RuntimeFailureKind::NavigationFailed,
                    "the Desktop settings URL is unavailable",
                )
            })?;
        let window = app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
            RuntimeFailure::new(
                RuntimeFailureKind::NavigationFailed,
                "the main WebView is unavailable",
            )
        })?;
        window.navigate(bootstrap_url).map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::NavigationFailed,
                format!("could not open Desktop settings: {error}"),
            )
        })?;
        let _ = window.show();
        let _ = window.set_focus();
        Ok(())
    }

    pub fn show_plugin_center(&self, app: &AppHandle) -> Result<(), RuntimeFailure> {
        self.show_plugin_center_plugin(app, None)
    }

    pub fn show_plugin_center_plugin(
        &self,
        app: &AppHandle,
        plugin_id: Option<&str>,
    ) -> Result<(), RuntimeFailure> {
        let mut bootstrap_url =
            lock_state(&self.shared)
                .bootstrap_url
                .clone()
                .ok_or_else(|| {
                    RuntimeFailure::new(
                        RuntimeFailureKind::NavigationFailed,
                        "the Desktop plugin center URL is unavailable",
                    )
                })?;
        {
            let mut query = bootstrap_url.query_pairs_mut();
            query.clear().append_pair("view", "plugins");
            if let Some(plugin_id) = plugin_id {
                query.append_pair("pluginId", plugin_id);
            }
        }
        let window = app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
            RuntimeFailure::new(
                RuntimeFailureKind::NavigationFailed,
                "the main WebView is unavailable",
            )
        })?;
        window.navigate(bootstrap_url).map_err(|error| {
            RuntimeFailure::new(
                RuntimeFailureKind::NavigationFailed,
                format!("could not open the Desktop plugin center: {error}"),
            )
        })?;
        let _ = window.show();
        let _ = window.set_focus();
        Ok(())
    }

    fn capture_bootstrap_url(&self, app: &AppHandle) {
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(url) = window.url() else {
            return;
        };
        let mut state = lock_state(&self.shared);
        if state.bootstrap_url.is_none() {
            state.bootstrap_url = Some(url);
        }
    }

    fn fail_current(&self, app: &AppHandle, failure: RuntimeFailure) {
        let snapshot = {
            let mut state = lock_state(&self.shared);
            if !state.snapshot.phase.can_start() {
                return;
            }
            state.snapshot.phase = RuntimePhase::Failed;
            state.snapshot.error = Some(failure);
            state.snapshot.clone()
        };
        emit_state(app, &snapshot);
    }

    fn fail_generation(&self, app: &AppHandle, generation: u64, failure: RuntimeFailure) {
        let snapshot = {
            let mut state = lock_state(&self.shared);
            if state.generation != generation {
                return;
            }
            state.control = None;
            state.snapshot.phase = RuntimePhase::Failed;
            state.snapshot.pid = None;
            state.snapshot.error = Some(failure);
            state.snapshot.clone()
        };
        self.shared.terminal.notify_all();
        emit_state(app, &snapshot);
    }

    fn publish_state(&self, app: &AppHandle) {
        emit_state(app, &self.status());
    }

    fn record_log(&self, app: &AppHandle, stream: RuntimeLogStream, line: String) {
        record_log(&self.shared, app, stream, line);
    }
}

fn lock_state(shared: &Shared) -> MutexGuard<'_, RuntimeState> {
    shared
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn emit_state(app: &AppHandle, snapshot: &RuntimeSnapshot) {
    let _ = app.emit(STATE_EVENT, snapshot);
}

fn record_log(shared: &Shared, app: &AppHandle, stream: RuntimeLogStream, line: String) {
    let line = truncate_log_line(line);
    let entry = {
        let mut state = lock_state(shared);
        let entry = RuntimeLogLine {
            sequence: state.next_log_sequence,
            stream,
            line,
        };
        state.next_log_sequence += 1;
        state.logs.push_back(entry.clone());
        while state.logs.len() > LOG_LIMIT {
            state.logs.pop_front();
        }
        entry
    };
    let _ = app.emit(LOG_EVENT, entry);
}

fn truncate_log_line(line: String) -> String {
    if line.len() > LOG_LINE_LIMIT {
        let mut end = LOG_LINE_LIMIT;
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}... [truncated]", &line[..end])
    } else {
        line
    }
}

fn spawn_output_reader<R>(reader: R, stream: OutputStream, sender: Sender<OutputEvent>)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = sender.send(OutputEvent::Closed(stream));
                    return;
                }
                Ok(_) => {
                    let value = line.trim_end_matches(['\r', '\n']).to_string();
                    if sender.send(OutputEvent::Line(stream, value)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(OutputEvent::ReadFailed(stream, error.to_string()));
                    return;
                }
            }
        }
    });
}

fn supervise_process(
    shared: Arc<Shared>,
    app: AppHandle,
    generation: u64,
    mut child: Child,
    control: Receiver<Control>,
    output: Receiver<OutputEvent>,
    readiness: Option<Receiver<ControlEvent>>,
    mut control_listener: Option<ControlListener>,
    mut signer_listener: Option<SignerListener>,
) {
    let started = Instant::now();
    let mut ready = false;
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    let mut startup_output = VecDeque::new();

    loop {
        match control.try_recv() {
            Ok(Control::Stop) | Err(TryRecvError::Disconnected) => {
                terminate_process(&mut child, STOP_GRACE);
                close_control_listener(&mut control_listener);
                close_signer_listener(&mut signer_listener);
                finish_stopped(&shared, &app, generation);
                return;
            }
            Err(TryRecvError::Empty) => {}
        }

        if let Some(readiness) = readiness.as_ref() {
            while let Ok(event) = readiness.try_recv() {
                match event {
                    ControlEvent::Ready(frame) => {
                        if ready {
                            record_log(
                                &shared,
                                &app,
                                RuntimeLogStream::Shell,
                                "ignored duplicate Runtime ready frame".to_string(),
                            );
                            continue;
                        }
                        match navigate_to_runtime(&shared, &app, generation, &frame) {
                            Ok(()) => {
                                ready = true;
                            }
                            Err(failure) => {
                                terminate_process(&mut child, STOP_GRACE);
                                close_control_listener(&mut control_listener);
                                close_signer_listener(&mut signer_listener);
                                finish_failed(&shared, &app, generation, failure);
                                return;
                            }
                        }
                    }
                    ControlEvent::ShowSettings => {
                        if ready {
                            return_to_bootstrap(&shared, &app);
                        } else {
                            terminate_process(&mut child, STOP_GRACE);
                            close_control_listener(&mut control_listener);
                            close_signer_listener(&mut signer_listener);
                            finish_failed(
                                &shared,
                                &app,
                                generation,
                                RuntimeFailure::new(
                                    RuntimeFailureKind::ControlFailed,
                                    "Runtime requested Desktop settings before readiness",
                                ),
                            );
                            return;
                        }
                    }
                    ControlEvent::RemoteSyncStatus(frame) => {
                        let snapshot = {
                            let mut state = lock_state(&shared);
                            if state.generation != generation {
                                continue;
                            }
                            state.snapshot.remote_sync.apply(frame);
                            state.snapshot.clone()
                        };
                        let _ = app.emit(STATE_EVENT, snapshot);
                    }
                    ControlEvent::Failed(message) => {
                        if ready {
                            record_log(
                                &shared,
                                &app,
                                RuntimeLogStream::Shell,
                                format!("ignored invalid post-ready control frame: {message}"),
                            );
                            continue;
                        }
                        terminate_process(&mut child, STOP_GRACE);
                        close_control_listener(&mut control_listener);
                        close_signer_listener(&mut signer_listener);
                        finish_failed(
                            &shared,
                            &app,
                            generation,
                            RuntimeFailure::new(RuntimeFailureKind::ControlFailed, message),
                        );
                        return;
                    }
                }
            }
        }

        while let Ok(event) = output.try_recv() {
            match event {
                OutputEvent::Line(stream, line) => {
                    let log_stream = match stream {
                        OutputStream::Stdout => RuntimeLogStream::Stdout,
                        OutputStream::Stderr => RuntimeLogStream::Stderr,
                    };
                    record_log(&shared, &app, log_stream, line.clone());
                    if !ready {
                        startup_output.push_back(line.clone());
                        while startup_output.len() > 40 {
                            startup_output.pop_front();
                        }
                        match parse_ready_url(&line) {
                            Ok(Some(url)) => {
                                match navigate_to_url(&shared, &app, generation, &url) {
                                    Ok(()) => ready = true,
                                    Err(failure) => {
                                        terminate_process(&mut child, STOP_GRACE);
                                        close_control_listener(&mut control_listener);
                                        close_signer_listener(&mut signer_listener);
                                        finish_failed(&shared, &app, generation, failure);
                                        return;
                                    }
                                }
                            }
                            Ok(None) => {}
                            Err(message) => {
                                terminate_process(&mut child, STOP_GRACE);
                                close_control_listener(&mut control_listener);
                                close_signer_listener(&mut signer_listener);
                                finish_failed(
                                    &shared,
                                    &app,
                                    generation,
                                    RuntimeFailure::new(
                                        RuntimeFailureKind::InvalidReadyUrl,
                                        message,
                                    ),
                                );
                                return;
                            }
                        }
                    }
                }
                OutputEvent::Closed(OutputStream::Stdout) => stdout_closed = true,
                OutputEvent::Closed(OutputStream::Stderr) => stderr_closed = true,
                OutputEvent::ReadFailed(stream, message) => {
                    terminate_process(&mut child, STOP_GRACE);
                    close_control_listener(&mut control_listener);
                    close_signer_listener(&mut signer_listener);
                    finish_failed(
                        &shared,
                        &app,
                        generation,
                        RuntimeFailure::new(
                            RuntimeFailureKind::OutputReadFailed,
                            format!("failed to read Harness {stream:?}: {message}"),
                        ),
                    );
                    return;
                }
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                cleanup_process_group(child.id());
                close_control_listener(&mut control_listener);
                close_signer_listener(&mut signer_listener);
                finish_exit(&shared, &app, generation, status, ready, &startup_output);
                return;
            }
            Ok(None) => {}
            Err(error) => {
                terminate_process(&mut child, STOP_GRACE);
                close_control_listener(&mut control_listener);
                close_signer_listener(&mut signer_listener);
                finish_failed(
                    &shared,
                    &app,
                    generation,
                    RuntimeFailure::new(
                        RuntimeFailureKind::RuntimeExited,
                        format!("could not observe the Harness process: {error}"),
                    ),
                );
                return;
            }
        }

        if !ready && stdout_closed && stderr_closed {
            terminate_process(&mut child, STOP_GRACE);
            close_control_listener(&mut control_listener);
            close_signer_listener(&mut signer_listener);
            finish_failed(
                &shared,
                &app,
                generation,
                RuntimeFailure::new(
                    RuntimeFailureKind::OutputClosed,
                    "Harness closed stdout and stderr before reporting readiness",
                ),
            );
            return;
        }

        if !ready && started.elapsed() >= STARTUP_TIMEOUT {
            terminate_process(&mut child, STOP_GRACE);
            close_control_listener(&mut control_listener);
            close_signer_listener(&mut signer_listener);
            finish_failed(
                &shared,
                &app,
                generation,
                RuntimeFailure::new(
                    RuntimeFailureKind::StartupTimeout,
                    format!(
                        "Harness did not become ready within {} seconds",
                        STARTUP_TIMEOUT.as_secs()
                    ),
                ),
            );
            return;
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn close_control_listener(listener: &mut Option<ControlListener>) {
    if let Some(listener) = listener.take() {
        listener.close();
    }
}

fn close_signer_listener(listener: &mut Option<SignerListener>) {
    if let Some(listener) = listener.take() {
        listener.close();
    }
}

fn navigate_to_runtime(
    shared: &Shared,
    app: &AppHandle,
    generation: u64,
    frame: &ReadyFrame,
) -> Result<(), RuntimeFailure> {
    let public_url = Url::parse(&frame.url).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::InvalidReadyUrl,
            format!("could not parse the Runtime ready URL: {error}"),
        )
    })?;
    let authenticated_url = Url::parse(&frame.authenticated_url).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::InvalidReadyUrl,
            format!("could not parse the Runtime authenticated URL: {error}"),
        )
    })?;
    navigate_to_urls(&shared, app, generation, &authenticated_url, &public_url)
}

fn navigate_to_url(
    shared: &Shared,
    app: &AppHandle,
    generation: u64,
    url: &Url,
) -> Result<(), RuntimeFailure> {
    navigate_to_urls(shared, app, generation, url, url)
}

fn navigate_to_urls(
    shared: &Shared,
    app: &AppHandle,
    generation: u64,
    navigation_url: &Url,
    public_url: &Url,
) -> Result<(), RuntimeFailure> {
    let window = app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        RuntimeFailure::new(
            RuntimeFailureKind::NavigationFailed,
            "the main WebView is unavailable",
        )
    })?;
    window.navigate(navigation_url.clone()).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::NavigationFailed,
            format!("could not navigate the main WebView to the Harness runtime: {error}"),
        )
    })?;
    let snapshot = {
        let mut state = lock_state(shared);
        if state.generation != generation {
            return Ok(());
        }
        state.snapshot.phase = RuntimePhase::Ready;
        state.snapshot.url = Some(public_url.to_string());
        state.snapshot.error = None;
        state.runtime_navigation_url = Some(navigation_url.clone());
        state.snapshot.clone()
    };
    mark_current_runtime_healthy(app);
    mark_pending_plugins_healthy(app);
    emit_state(app, &snapshot);
    Ok(())
}

fn mark_current_runtime_healthy(app: &AppHandle) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let _ = RuntimeStore::new(app_data).mark_current_healthy();
}

fn mark_pending_plugins_healthy(app: &AppHandle) {
    if !production_mode() {
        return;
    }
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let store = PluginStore::new(app_data);
    match store.mark_pending_healthy() {
        Ok(plugin_ids) if !plugin_ids.is_empty() => emit_plugin_health(app, &store),
        Ok(_) => {}
        Err(error) => eprintln!("could not mark installed plugins healthy: {error}"),
    }
}

fn rollback_pending_plugins(app: &AppHandle) {
    if !production_mode() {
        return;
    }
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let store = PluginStore::new(app_data);
    match store.rollback_pending() {
        Ok(plugin_ids) if !plugin_ids.is_empty() => {
            eprintln!("rolled back pending plugins: {}", plugin_ids.join(", "));
            emit_plugin_health(app, &store);
        }
        Ok(_) => {}
        Err(error) => eprintln!("could not roll back pending plugins: {error}"),
    }
}

fn emit_plugin_health(app: &AppHandle, store: &PluginStore) {
    if let Ok(snapshots) = store.list_installed() {
        let _ = app.emit(PLUGIN_HEALTH_EVENT, snapshots);
    }
}

fn finish_stopped(shared: &Shared, app: &AppHandle, generation: u64) {
    let snapshot = finish_terminal(shared, generation, RuntimePhase::Stopped, None);
    if let Some(snapshot) = snapshot {
        emit_state(app, &snapshot);
    }
}

fn finish_failed(shared: &Shared, app: &AppHandle, generation: u64, failure: RuntimeFailure) {
    let recover_window = lock_state(shared).snapshot.phase == RuntimePhase::Ready;
    rollback_pending_plugins(app);
    let snapshot = finish_terminal(shared, generation, RuntimePhase::Failed, Some(failure));
    if let Some(snapshot) = snapshot {
        if recover_window {
            return_to_bootstrap(shared, app);
        }
        emit_state(app, &snapshot);
    }
}

fn finish_exit(
    shared: &Shared,
    app: &AppHandle,
    generation: u64,
    status: ExitStatus,
    was_ready: bool,
    startup_output: &VecDeque<String>,
) {
    let (phase, kind, prefix) = classify_exit(was_ready, startup_output);
    let failure = RuntimeFailure::new(kind, format!("{prefix} ({status})"));
    rollback_pending_plugins(app);
    let snapshot = finish_terminal(shared, generation, phase, Some(failure));
    if let Some(snapshot) = snapshot {
        if phase == RuntimePhase::Crashed {
            return_to_bootstrap(shared, app);
        }
        emit_state(app, &snapshot);
    }
}

fn classify_exit(
    was_ready: bool,
    startup_output: &VecDeque<String>,
) -> (RuntimePhase, RuntimeFailureKind, &'static str) {
    if was_ready {
        return (
            RuntimePhase::Crashed,
            RuntimeFailureKind::RuntimeExited,
            "Harness exited after becoming ready",
        );
    }

    let output = startup_output
        .iter()
        .map(|line| line.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("\n");
    if [
        "eaddrinuse",
        "address already in use",
        "failed to bind",
        "could not bind",
        "listen eacces",
    ]
    .iter()
    .any(|needle| output.contains(needle))
    {
        return (
            RuntimePhase::Failed,
            RuntimeFailureKind::PortFailed,
            "Harness could not bind its local web port",
        );
    }
    if (output.contains("profile")
        && ["error", "failed", "invalid", "missing"]
            .iter()
            .any(|needle| output.contains(needle)))
        || (output.contains("loader") && output.contains("failed"))
    {
        return (
            RuntimePhase::Failed,
            RuntimeFailureKind::ProfileFailed,
            "Harness could not load the desktop profile",
        );
    }
    (
        RuntimePhase::Failed,
        RuntimeFailureKind::ExitedBeforeReady,
        "Harness exited before reporting readiness",
    )
}

fn finish_terminal(
    shared: &Shared,
    generation: u64,
    phase: RuntimePhase,
    failure: Option<RuntimeFailure>,
) -> Option<RuntimeSnapshot> {
    let snapshot = {
        let mut state = lock_state(shared);
        if state.generation != generation {
            return None;
        }
        state.control = None;
        state.runtime_navigation_url = None;
        state.snapshot.phase = phase;
        state.snapshot.url = None;
        state.snapshot.pid = None;
        state.snapshot.error = failure;
        state.snapshot.remote_sync.mark_stopped();
        state.snapshot.clone()
    };
    shared.terminal.notify_all();
    Some(snapshot)
}

fn return_to_bootstrap(shared: &Shared, app: &AppHandle) {
    let bootstrap_url = lock_state(shared).bootstrap_url.clone();
    let Some(url) = bootstrap_url else {
        return;
    };
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.navigate(url);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn signal_process_group(pid: u32, signal: i32) {
    // The spawned process is its own process-group leader, so a negative PID targets its tree.
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

#[cfg(unix)]
fn cleanup_process_group(pid: u32) {
    signal_process_group(pid, libc::SIGTERM);
}

#[cfg(not(unix))]
fn cleanup_process_group(_pid: u32) {}

fn terminate_process(child: &mut Child, grace: Duration) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(unix)]
    signal_process_group(child.id(), libc::SIGTERM);
    #[cfg(not(unix))]
    let _ = child.kill();

    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }

    #[cfg(unix)]
    signal_process_group(child.id(), libc::SIGKILL);
    #[cfg(not(unix))]
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn runtime_status(manager: State<'_, RuntimeManager>) -> RuntimeSnapshot {
    manager.status()
}

#[tauri::command]
pub fn runtime_logs(manager: State<'_, RuntimeManager>) -> Vec<RuntimeLogLine> {
    manager.logs()
}

#[tauri::command]
pub fn start_runtime(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
) -> Result<RuntimeSnapshot, RuntimeFailure> {
    manager.start(&app)
}

#[tauri::command]
pub fn stop_runtime(app: AppHandle, manager: State<'_, RuntimeManager>) -> RuntimeSnapshot {
    manager.stop(&app)
}

#[tauri::command]
pub fn show_runtime(
    app: AppHandle,
    manager: State<'_, RuntimeManager>,
) -> Result<RuntimeSnapshot, RuntimeFailure> {
    let (snapshot, url) = {
        let state = lock_state(&manager.shared);
        (state.snapshot.clone(), state.runtime_navigation_url.clone())
    };
    let url = url.ok_or_else(|| {
        RuntimeFailure::new(
            RuntimeFailureKind::NavigationFailed,
            "the Harness Runtime is not ready",
        )
    })?;
    let window = app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        RuntimeFailure::new(
            RuntimeFailureKind::NavigationFailed,
            "the main WebView is unavailable",
        )
    })?;
    window.navigate(url).map_err(|error| {
        RuntimeFailure::new(
            RuntimeFailureKind::NavigationFailed,
            format!("could not return to the Harness Runtime: {error}"),
        )
    })?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::plugin_installer::{ActiveInstalledPlugin, InstalledPlugin, PluginHealth};

    use super::{
        LOG_LINE_LIMIT, RemoteSyncConnectionState, RemoteSyncRuntimeSnapshot,
        RemoteSyncStatusFrame, RuntimeFailureKind, RuntimePhase, classify_exit,
        compare_runtime_versions, desktop_profile_marker, normalize_profile_bundles,
        truncate_log_line,
    };

    #[test]
    fn only_terminal_idle_phases_can_start() {
        assert!(RuntimePhase::Stopped.can_start());
        assert!(RuntimePhase::Failed.can_start());
        assert!(RuntimePhase::Crashed.can_start());
        assert!(!RuntimePhase::Starting.can_start());
        assert!(!RuntimePhase::Ready.can_start());
        assert!(!RuntimePhase::Stopping.can_start());
    }

    #[test]
    fn bundled_runtime_versions_only_move_forward() {
        use std::cmp::Ordering;

        assert_eq!(
            compare_runtime_versions("2026.08.17.1", "2026.08.24.1"),
            Ordering::Less
        );
        assert_eq!(
            compare_runtime_versions("2026.08.24.2", "2026.08.24.1"),
            Ordering::Greater
        );
        assert_eq!(
            compare_runtime_versions("2026.08.24.1", "2026.08.24.1"),
            Ordering::Equal
        );
    }

    #[test]
    fn production_profile_keeps_product_bundles_first_and_preserves_user_layers() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after Unix epoch")
            .as_nanos();
        let profile = std::env::temp_dir().join(format!("harndock-profile-{suffix}"));
        fs::create_dir_all(&profile).expect("test profile should be created");
        fs::write(
            profile.join("package.json"),
            r#"{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": { "third-party": "1.0.0" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "third-party", "@harndock/desktop-bundle"] } }
}
"#,
        )
        .expect("test profile should be written");
        let product = vec![
            "@deepseek-ai/dsh-base".to_string(),
            "@deepseek-ai/dsh-web-app".to_string(),
            "@harndock/desktop-bundle".to_string(),
        ];
        normalize_profile_bundles(&profile, &product).expect("profile bundles should normalize");
        let value: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(profile.join("package.json"))
                .expect("normalized profile should be readable"),
        )
        .expect("normalized profile should remain valid JSON");
        assert_eq!(
            value.pointer("/dsh/profile/bundles"),
            Some(&serde_json::json!([
                "@deepseek-ai/dsh-base",
                "@deepseek-ai/dsh-web-app",
                "@harndock/desktop-bundle",
                "third-party"
            ]))
        );
        assert_eq!(value["dependencies"]["third-party"], "1.0.0");
        fs::remove_dir_all(profile).expect("test profile should be removed");
    }

    #[test]
    fn production_profile_marker_tracks_active_plugin_versions() {
        let plugin = ActiveInstalledPlugin {
            installed: InstalledPlugin {
                plugin_id: "com.example.notes".into(),
                version: "1.2.3".into(),
                root: PathBuf::from("/tmp/notes"),
            },
            health: PluginHealth::Pending,
            enabled: true,
        };
        assert_eq!(
            desktop_profile_marker("2026.08.24.1", &[plugin]),
            "runtime=2026.08.24.1\nplugin=com.example.notes@1.2.3"
        );
    }

    #[test]
    fn exit_before_ready_and_runtime_crash_are_distinct() {
        assert_eq!(
            classify_exit(false, &VecDeque::new()),
            (
                RuntimePhase::Failed,
                RuntimeFailureKind::ExitedBeforeReady,
                "Harness exited before reporting readiness",
            )
        );
        assert_eq!(
            classify_exit(true, &VecDeque::new()),
            (
                RuntimePhase::Crashed,
                RuntimeFailureKind::RuntimeExited,
                "Harness exited after becoming ready",
            )
        );
    }

    #[test]
    fn startup_failures_preserve_port_and_profile_diagnostics() {
        let port_output =
            VecDeque::from(["Error: listen EADDRINUSE: address already in use".to_string()]);
        assert_eq!(
            classify_exit(false, &port_output).1,
            RuntimeFailureKind::PortFailed
        );

        let profile_output =
            VecDeque::from(["desktop profile failed schema validation".to_string()]);
        assert_eq!(
            classify_exit(false, &profile_output).1,
            RuntimeFailureKind::ProfileFailed
        );
    }

    #[test]
    fn log_truncation_keeps_utf8_boundaries() {
        let input = format!("{}界", "x".repeat(LOG_LINE_LIMIT - 1));
        let output = truncate_log_line(input);
        assert!(output.ends_with("... [truncated]"));
        assert!(output.is_char_boundary(output.len()));
    }

    #[test]
    fn remote_sync_snapshot_derives_online_state_and_ignores_stale_frames() {
        let frame = |state: &str, observed_at_ms: u64, last_heartbeat_at_ms: Option<u64>| {
            serde_json::from_value::<RemoteSyncStatusFrame>(serde_json::json!({
                "protocolVersion": 1,
                "event": "remoteSyncStatus",
                "nonce": "0123456789abcdef".repeat(4),
                "runtimeVersion": "2026.08.24.1",
                "runtimeApi": 1,
                "profile": "desktop",
                "harnessCommit": "cd5ef8148158c3a752a658978873241fdf8e2bbc",
                "connectionState": state,
                "observedAtMs": observed_at_ms,
                "lastHeartbeatAtMs": last_heartbeat_at_ms,
            }))
            .expect("test status frame should deserialize")
        };
        let mut snapshot = RemoteSyncRuntimeSnapshot::default();
        snapshot.apply(frame("connected", 2_000, Some(1_900)));
        assert_eq!(
            snapshot.connection_state,
            RemoteSyncConnectionState::Connected
        );
        assert!(snapshot.gateway_connected);
        assert!(snapshot.runtime_online);
        assert_eq!(snapshot.last_heartbeat_at_ms, Some(1_900));

        snapshot.apply(frame("reconnecting", 1_000, None));
        assert_eq!(
            snapshot.connection_state,
            RemoteSyncConnectionState::Connected
        );

        snapshot.mark_stopped();
        assert_eq!(
            snapshot.connection_state,
            RemoteSyncConnectionState::Stopped
        );
        assert!(!snapshot.gateway_connected);
        assert!(!snapshot.runtime_online);
        assert_eq!(snapshot.last_heartbeat_at_ms, Some(1_900));
    }
}
