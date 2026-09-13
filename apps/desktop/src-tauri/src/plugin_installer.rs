//! Security preflight for plugin archives.
//!
//! Plugin packages are tar.zst archives with one fixed top-level directory:
//! `harndock-plugin/`. The signed `plugin-manifest.json` is a separate GitHub
//! Release Asset, avoiding a self-referential archive digest. Preflight never
//! unpacks into an active directory. It checks the complete tar index first,
//! then compares the manifest with the Center declaration and Desktop runtime.

use std::{
    collections::{BTreeMap, HashSet},
    ffi::OsStr,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const ARCHIVE_ROOT: &str = "harndock-plugin";
const MANIFEST_FILE: &str = "plugin-manifest.json";
const PACKAGE_MANIFEST_FILE: &str = "package.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT: u64 = 100_000;
const PLUGINS_DIRECTORY: &str = "plugins";
const INSTALLED_DIRECTORY: &str = "installed";
const VERSIONS_DIRECTORY: &str = "versions";
const INSTALL_STAGING_DIRECTORY: &str = "install-staging";
const CURRENT_FILE: &str = "current.json";
#[cfg(debug_assertions)]
const DEVELOPMENT_PLUGIN_KEY_ID: &str = "marketplace-dev-rfc8032";
#[cfg(debug_assertions)]
const DEVELOPMENT_PLUGIN_PUBLIC_KEY: &str = "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginManifest {
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) plugin_types: Vec<String>,
    pub(crate) summary: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) harness: PluginHarnessCompatibility,
    pub(crate) runtime_api: u32,
    pub(crate) platforms: Vec<String>,
    pub(crate) permissions: BTreeMap<String, Vec<String>>,
    pub(crate) artifact: PluginManifestArtifact,
    pub(crate) signature: Option<PluginManifestSignature>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginHarnessCompatibility {
    pub(crate) min_version: String,
    pub(crate) max_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginManifestArtifact {
    pub(crate) sha256: String,
    pub(crate) size: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginManifestSignature {
    pub(crate) key_id: String,
    pub(crate) value: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PluginPreflightResult {
    pub(crate) manifest: PluginManifest,
    pub(crate) entry_count: u64,
    pub(crate) unpacked_bytes: u64,
    pub(crate) contains_symlinks: bool,
}

#[derive(Debug)]
pub(crate) enum PluginInstallError {
    Io(std::io::Error),
    InvalidArchive(String),
    InvalidManifest(String),
    Signature(String),
    Incompatible(String),
    AlreadyInstalled(PathBuf),
    MissingInstallation(PathBuf),
}

impl std::fmt::Display for PluginInstallError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "plugin preflight storage failed: {error}"),
            Self::InvalidArchive(message) => write!(formatter, "invalid plugin archive: {message}"),
            Self::InvalidManifest(message) => {
                write!(formatter, "invalid plugin manifest: {message}")
            }
            Self::Signature(message) => {
                write!(formatter, "plugin signature verification failed: {message}")
            }
            Self::Incompatible(message) => write!(formatter, "incompatible plugin: {message}"),
            Self::AlreadyInstalled(path) => {
                write!(
                    formatter,
                    "plugin version is already installed: {}",
                    path.display()
                )
            }
            Self::MissingInstallation(path) => {
                write!(
                    formatter,
                    "plugin installation is unavailable: {}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for PluginInstallError {}

impl From<std::io::Error> for PluginInstallError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PluginHealth {
    Pending,
    Healthy,
}

fn default_plugin_enabled() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginPointer {
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) previous_version: Option<String>,
    pub(crate) health: PluginHealth,
    #[serde(default = "default_plugin_enabled")]
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InstalledPlugin {
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) root: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ActiveInstalledPlugin {
    pub(crate) installed: InstalledPlugin,
    pub(crate) health: PluginHealth,
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPluginSnapshot {
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    pub(crate) previous_version: Option<String>,
    pub(crate) health: PluginHealth,
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PluginStore {
    root: PathBuf,
}

impl PluginStore {
    pub(crate) fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            root: app_data_dir.into().join(PLUGINS_DIRECTORY),
        }
    }

    pub(crate) fn install_archive(
        &self,
        archive_path: &Path,
        manifest_path: &Path,
        expected_plugin_id: &str,
        expected_version: &str,
        expected_sha256: &str,
        expected_size: u64,
        expected_signature: Option<(&str, &str)>,
        expected_target: &str,
        harness_version: &str,
        expected_runtime_api: u32,
    ) -> Result<InstalledPlugin, PluginInstallError> {
        validate_plugin_id(expected_plugin_id)?;
        validate_plugin_version(expected_version)?;
        verify_archive_integrity(archive_path, expected_sha256, expected_size)?;
        let _preflight = preflight_plugin_archive(
            archive_path,
            manifest_path,
            expected_plugin_id,
            expected_version,
            expected_sha256,
            expected_size,
            expected_signature,
            expected_target,
            harness_version,
            expected_runtime_api,
        )?;
        self.ensure_layout(expected_plugin_id)?;
        let destination = self.version_root(expected_plugin_id, expected_version);
        if destination.exists() {
            return Err(PluginInstallError::AlreadyInstalled(destination));
        }

        let staging = self.create_staging_directory()?;
        let result = (|| {
            unpack_archive(archive_path, &staging)?;
            let staged_root = staging.join(ARCHIVE_ROOT);
            verify_staged_plugin(&staged_root)?;
            fs::copy(manifest_path, staged_root.join(MANIFEST_FILE))?;
            fs::rename(&staged_root, &destination)?;
            let activation = (|| {
                let previous = self.current(expected_plugin_id)?;
                let previous_version = previous.as_ref().map(|pointer| pointer.version.clone());
                let enabled = previous
                    .as_ref()
                    .map(|pointer| pointer.enabled)
                    .unwrap_or(true);
                let pointer = PluginPointer {
                    plugin_id: expected_plugin_id.to_string(),
                    version: expected_version.to_string(),
                    previous_version,
                    health: PluginHealth::Pending,
                    enabled,
                };
                self.write_pointer(&pointer)?;
                Ok(InstalledPlugin {
                    plugin_id: expected_plugin_id.to_string(),
                    version: expected_version.to_string(),
                    root: destination.clone(),
                })
            })();
            if activation.is_err() {
                let _ = fs::remove_dir_all(&destination);
            }
            activation
        })();
        let _ = fs::remove_dir_all(staging);
        result
    }

    pub(crate) fn installed(
        &self,
        plugin_id: &str,
        version: &str,
    ) -> Result<InstalledPlugin, PluginInstallError> {
        validate_plugin_id(plugin_id)?;
        validate_plugin_version(version)?;
        let root = self.version_root(plugin_id, version);
        if !root.is_dir() || !root.join(MANIFEST_FILE).is_file() {
            return Err(PluginInstallError::MissingInstallation(root));
        }
        Ok(InstalledPlugin {
            plugin_id: plugin_id.to_string(),
            version: version.to_string(),
            root,
        })
    }

    pub(crate) fn current(
        &self,
        plugin_id: &str,
    ) -> Result<Option<PluginPointer>, PluginInstallError> {
        validate_plugin_id(plugin_id)?;
        let path = self.current_path(plugin_id);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let pointer: PluginPointer = serde_json::from_str(&content).map_err(|error| {
            PluginInstallError::InvalidManifest(format!("invalid plugin pointer: {error}"))
        })?;
        if pointer.plugin_id != plugin_id {
            return Err(PluginInstallError::InvalidManifest(
                "plugin pointer ID does not match its directory".into(),
            ));
        }
        self.installed(plugin_id, &pointer.version)?;
        Ok(Some(pointer))
    }

    pub(crate) fn mark_current_healthy(
        &self,
        plugin_id: &str,
    ) -> Result<PluginPointer, PluginInstallError> {
        let Some(mut pointer) = self.current(plugin_id)? else {
            return Err(PluginInstallError::MissingInstallation(
                self.plugin_root(plugin_id),
            ));
        };
        pointer.health = PluginHealth::Healthy;
        self.write_pointer(&pointer)?;
        Ok(pointer)
    }

    pub(crate) fn rollback(&self, plugin_id: &str) -> Result<PluginPointer, PluginInstallError> {
        let Some(current) = self.current(plugin_id)? else {
            return Err(PluginInstallError::MissingInstallation(
                self.plugin_root(plugin_id),
            ));
        };
        let previous = current.previous_version.clone().ok_or_else(|| {
            PluginInstallError::InvalidManifest("plugin has no previous version to restore".into())
        })?;
        self.installed(plugin_id, &previous)?;
        let pointer = PluginPointer {
            plugin_id: plugin_id.to_string(),
            version: previous,
            previous_version: Some(current.version),
            health: PluginHealth::Healthy,
            enabled: current.enabled,
        };
        self.write_pointer(&pointer)?;
        Ok(pointer)
    }

    pub(crate) fn set_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<PluginPointer, PluginInstallError> {
        let Some(mut pointer) = self.current(plugin_id)? else {
            return Err(PluginInstallError::MissingInstallation(
                self.plugin_root(plugin_id),
            ));
        };
        if pointer.health != PluginHealth::Healthy {
            return Err(PluginInstallError::InvalidManifest(
                "plugin must pass Runtime health check before it can be enabled or disabled".into(),
            ));
        }
        pointer.enabled = enabled;
        self.write_pointer(&pointer)?;
        Ok(pointer)
    }

    pub(crate) fn uninstall(&self, plugin_id: &str) -> Result<(), PluginInstallError> {
        let Some(_pointer) = self.current(plugin_id)? else {
            return Err(PluginInstallError::MissingInstallation(
                self.plugin_root(plugin_id),
            ));
        };
        fs::remove_dir_all(self.plugin_root(plugin_id))?;
        Ok(())
    }

    pub(crate) fn list_installed(
        &self,
    ) -> Result<Vec<InstalledPluginSnapshot>, PluginInstallError> {
        let installed_root = self.root.join(INSTALLED_DIRECTORY);
        if !installed_root.is_dir() {
            return Ok(Vec::new());
        }
        let mut snapshots = Vec::new();
        for entry in fs::read_dir(installed_root)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if !metadata.file_type().is_dir() {
                return Err(PluginInstallError::InvalidManifest(
                    "installed plugin root must be a directory".into(),
                ));
            }
            let plugin_id = entry.file_name().to_string_lossy().into_owned();
            validate_plugin_id(&plugin_id)?;
            if let Some(pointer) = self.current(&plugin_id)? {
                snapshots.push(InstalledPluginSnapshot {
                    plugin_id,
                    version: pointer.version,
                    previous_version: pointer.previous_version,
                    health: pointer.health,
                    enabled: pointer.enabled,
                });
            }
        }
        snapshots.sort_by(|left, right| left.plugin_id.cmp(&right.plugin_id));
        Ok(snapshots)
    }

    pub(crate) fn active_plugins(&self) -> Result<Vec<ActiveInstalledPlugin>, PluginInstallError> {
        let installed_root = self.root.join(INSTALLED_DIRECTORY);
        if !installed_root.is_dir() {
            return Ok(Vec::new());
        }
        let mut plugins = Vec::new();
        for entry in fs::read_dir(installed_root)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if !metadata.file_type().is_dir() {
                return Err(PluginInstallError::InvalidManifest(
                    "installed plugin root must be a directory".into(),
                ));
            }
            let plugin_id = entry.file_name().to_string_lossy().into_owned();
            validate_plugin_id(&plugin_id)?;
            let Some(pointer) = self.current(&plugin_id)? else {
                continue;
            };
            plugins.push(ActiveInstalledPlugin {
                installed: self.installed(&plugin_id, &pointer.version)?,
                health: pointer.health,
                enabled: pointer.enabled,
            });
        }
        plugins.sort_by(|left, right| left.installed.plugin_id.cmp(&right.installed.plugin_id));
        Ok(plugins)
    }

    pub(crate) fn mark_pending_healthy(&self) -> Result<Vec<String>, PluginInstallError> {
        let pending = self
            .active_plugins()?
            .into_iter()
            .filter(|plugin| plugin.health == PluginHealth::Pending)
            .map(|plugin| plugin.installed.plugin_id)
            .collect::<Vec<_>>();
        for plugin_id in &pending {
            self.mark_current_healthy(plugin_id)?;
        }
        Ok(pending)
    }

    pub(crate) fn rollback_pending(&self) -> Result<Vec<String>, PluginInstallError> {
        let pending = self
            .active_plugins()?
            .into_iter()
            .filter(|plugin| plugin.health == PluginHealth::Pending)
            .map(|plugin| plugin.installed.plugin_id)
            .collect::<Vec<_>>();
        let mut rolled_back = Vec::new();
        for plugin_id in pending {
            let Some(pointer) = self.current(&plugin_id)? else {
                continue;
            };
            if pointer.health != PluginHealth::Pending {
                continue;
            }
            if pointer.previous_version.is_some() {
                self.rollback(&plugin_id)?;
            } else {
                let version_root = self.version_root(&plugin_id, &pointer.version);
                fs::remove_dir_all(&version_root)?;
                fs::remove_file(self.current_path(&plugin_id))?;
            }
            rolled_back.push(plugin_id);
        }
        Ok(rolled_back)
    }

    fn ensure_layout(&self, plugin_id: &str) -> Result<(), PluginInstallError> {
        fs::create_dir_all(self.root.join(INSTALL_STAGING_DIRECTORY))?;
        fs::create_dir_all(self.plugin_root(plugin_id).join(VERSIONS_DIRECTORY))?;
        Ok(())
    }

    fn create_staging_directory(&self) -> Result<PathBuf, PluginInstallError> {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| {
                invalid_archive(format!("system clock cannot create staging: {error}"))
            })?
            .as_nanos();
        for attempt in 0..100_u32 {
            let path = self
                .root
                .join(INSTALL_STAGING_DIRECTORY)
                .join(format!("install-{}-{suffix}-{attempt}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(path),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err(invalid_archive(
            "could not allocate plugin staging directory",
        ))
    }

    fn plugin_root(&self, plugin_id: &str) -> PathBuf {
        self.root.join(INSTALLED_DIRECTORY).join(plugin_id)
    }

    fn version_root(&self, plugin_id: &str, version: &str) -> PathBuf {
        self.plugin_root(plugin_id)
            .join(VERSIONS_DIRECTORY)
            .join(version)
    }

    fn current_path(&self, plugin_id: &str) -> PathBuf {
        self.plugin_root(plugin_id).join(CURRENT_FILE)
    }

    fn write_pointer(&self, pointer: &PluginPointer) -> Result<(), PluginInstallError> {
        self.installed(&pointer.plugin_id, &pointer.version)?;
        let path = self.current_path(&pointer.plugin_id);
        let temporary = path.with_extension("json.tmp");
        let mut content = serde_json::to_vec_pretty(pointer)
            .map_err(|error| PluginInstallError::InvalidManifest(error.to_string()))?;
        content.push(b'\n');
        fs::write(&temporary, content)?;
        let result = fs::rename(&temporary, path).map_err(PluginInstallError::from);
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}

pub(crate) fn preflight_plugin_archive(
    archive_path: &Path,
    manifest_path: &Path,
    expected_plugin_id: &str,
    expected_version: &str,
    expected_sha256: &str,
    expected_size: u64,
    expected_signature: Option<(&str, &str)>,
    expected_target: &str,
    harness_version: &str,
    expected_runtime_api: u32,
) -> Result<PluginPreflightResult, PluginInstallError> {
    if !is_lower_hex(expected_sha256, 64) {
        return Err(PluginInstallError::InvalidManifest(
            "Center SHA-256 must be a lowercase 64-character hexadecimal digest".into(),
        ));
    }

    let manifest_metadata = fs::symlink_metadata(manifest_path)?;
    if !manifest_metadata.file_type().is_file() || manifest_metadata.len() > MAX_MANIFEST_BYTES {
        return Err(PluginInstallError::InvalidManifest(
            "plugin manifest asset must be a regular file no larger than 1 MiB".into(),
        ));
    }
    let manifest: PluginManifest = serde_json::from_slice(&fs::read(manifest_path)?)
        .map_err(|error| PluginInstallError::InvalidManifest(error.to_string()))?;

    let file = File::open(archive_path)?;
    let decoder = zstd::stream::read::Decoder::new(file)
        .map_err(|error| invalid_archive(format!("could not decode zstd stream: {error}")))?;
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| invalid_archive(format!("could not read tar entries: {error}")))?;
    let mut seen = HashSet::new();
    let mut entry_count = 0_u64;
    let mut unpacked_bytes = 0_u64;
    let mut has_root = false;
    let mut has_package_manifest = false;
    let mut contains_symlinks = false;

    for entry in entries {
        let entry =
            entry.map_err(|error| invalid_archive(format!("invalid tar entry: {error}")))?;
        entry_count = entry_count
            .checked_add(1)
            .ok_or_else(|| invalid_archive("archive entry count overflow"))?;
        if entry_count > MAX_ENTRY_COUNT {
            return Err(invalid_archive("archive contains too many entries"));
        }

        let entry_path = entry
            .path()
            .map_err(|error| invalid_archive(format!("invalid tar path: {error}")))?
            .into_owned();
        validate_archive_path(&entry_path)?;
        let key = entry_path
            .to_str()
            .ok_or_else(|| invalid_archive("archive paths must be UTF-8"))?
            .to_string();
        if !seen.insert(key) {
            return Err(invalid_archive(format!(
                "duplicate archive path: {}",
                entry_path.display()
            )));
        }

        let entry_type = entry.header().entry_type();
        if !(entry_type.is_file() || entry_type.is_dir() || entry_type.is_symlink()) {
            return Err(invalid_archive(format!(
                "unsupported archive entry type at {}",
                entry_path.display()
            )));
        }
        let entry_size = entry
            .header()
            .size()
            .map_err(|error| invalid_archive(format!("invalid entry size: {error}")))?;
        unpacked_bytes = unpacked_bytes
            .checked_add(entry_size)
            .ok_or_else(|| invalid_archive("archive uncompressed size overflow"))?;
        if unpacked_bytes > MAX_UNPACKED_BYTES {
            return Err(invalid_archive("archive uncompressed size is too large"));
        }

        if entry_path == Path::new(ARCHIVE_ROOT) {
            if !entry_type.is_dir() {
                return Err(invalid_archive("archive root must be a directory"));
            }
            has_root = true;
        }
        if entry_path == Path::new(ARCHIVE_ROOT).join(MANIFEST_FILE) {
            return Err(invalid_archive(
                "plugin-manifest.json is a separate Release Asset and is reserved in the archive",
            ));
        }
        if entry_path == Path::new(ARCHIVE_ROOT).join(PACKAGE_MANIFEST_FILE) {
            if !entry_type.is_file() {
                return Err(invalid_archive(
                    "package.json must be a regular file in the plugin root",
                ));
            }
            has_package_manifest = true;
        }
        if entry_type.is_symlink() {
            contains_symlinks = true;
            let target = entry
                .link_name()
                .map_err(|error| invalid_archive(format!("invalid symlink target: {error}")))?
                .ok_or_else(|| invalid_archive("archive symlink has no target"))?;
            validate_link_target(&entry_path, &target)?;
        }
    }

    if !has_root {
        return Err(invalid_archive("archive must contain harndock-plugin root"));
    }
    if !has_package_manifest {
        return Err(invalid_archive(
            "archive must contain harndock-plugin/package.json",
        ));
    }
    validate_manifest(
        &manifest,
        expected_plugin_id,
        expected_version,
        expected_sha256,
        expected_size,
        expected_signature,
        expected_target,
        harness_version,
        expected_runtime_api,
    )?;

    Ok(PluginPreflightResult {
        manifest,
        entry_count,
        unpacked_bytes,
        contains_symlinks,
    })
}

fn validate_manifest(
    manifest: &PluginManifest,
    expected_plugin_id: &str,
    expected_version: &str,
    expected_sha256: &str,
    expected_size: u64,
    expected_signature: Option<(&str, &str)>,
    expected_target: &str,
    harness_version: &str,
    expected_runtime_api: u32,
) -> Result<(), PluginInstallError> {
    if manifest.plugin_id != expected_plugin_id || manifest.version != expected_version {
        return Err(PluginInstallError::Incompatible(
            "manifest plugin ID or version does not match the Center declaration".into(),
        ));
    }
    if manifest.plugin_types.is_empty()
        || manifest
            .plugin_types
            .iter()
            .any(|value| value != "host" && value != "client")
        || has_duplicates(&manifest.plugin_types)
    {
        return Err(PluginInstallError::InvalidManifest(
            "pluginTypes must contain unique host/client values".into(),
        ));
    }
    if manifest.runtime_api != expected_runtime_api {
        return Err(PluginInstallError::Incompatible(format!(
            "runtime API {} does not match Desktop API {expected_runtime_api}",
            manifest.runtime_api
        )));
    }
    if !manifest
        .platforms
        .iter()
        .any(|value| value == expected_target)
    {
        return Err(PluginInstallError::Incompatible(format!(
            "plugin does not support Desktop target {expected_target}"
        )));
    }
    if has_duplicates(&manifest.platforms)
        || manifest.platforms.iter().any(|value| value.is_empty())
    {
        return Err(PluginInstallError::InvalidManifest(
            "platforms must contain unique non-empty values".into(),
        ));
    }
    let Some(harness) = semver_triplet(harness_version) else {
        return Err(PluginInstallError::Incompatible(
            "current Harness version is not a supported semantic version".into(),
        ));
    };
    let Some(min_version) = semver_triplet(&manifest.harness.min_version) else {
        return Err(PluginInstallError::InvalidManifest(
            "harness.minVersion is not a supported semantic version".into(),
        ));
    };
    if harness < min_version {
        return Err(PluginInstallError::Incompatible(
            "current Harness version is below the plugin minimum".into(),
        ));
    }
    if let Some(max_version) = &manifest.harness.max_version {
        let Some(max_version) = semver_triplet(max_version) else {
            return Err(PluginInstallError::InvalidManifest(
                "harness.maxVersion is not a supported semantic version".into(),
            ));
        };
        if harness >= max_version {
            return Err(PluginInstallError::Incompatible(
                "current Harness version is outside the plugin compatibility range".into(),
            ));
        }
    }
    if manifest.artifact.size != expected_size || manifest.artifact.sha256 != expected_sha256 {
        return Err(PluginInstallError::InvalidManifest(
            "manifest artifact metadata does not match the Center declaration".into(),
        ));
    }
    verify_manifest_signature(&manifest, expected_signature)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifestSigningPayload<'a> {
    plugin_id: &'a str,
    version: &'a str,
    plugin_types: &'a [String],
    summary: &'a Option<String>,
    description: &'a Option<String>,
    harness: &'a PluginHarnessCompatibility,
    runtime_api: u32,
    platforms: &'a [String],
    permissions: &'a BTreeMap<String, Vec<String>>,
    artifact: &'a PluginManifestArtifact,
}

fn manifest_signing_bytes(manifest: &PluginManifest) -> Result<Vec<u8>, PluginInstallError> {
    let payload = PluginManifestSigningPayload {
        plugin_id: &manifest.plugin_id,
        version: &manifest.version,
        plugin_types: &manifest.plugin_types,
        summary: &manifest.summary,
        description: &manifest.description,
        harness: &manifest.harness,
        runtime_api: manifest.runtime_api,
        platforms: &manifest.platforms,
        permissions: &manifest.permissions,
        artifact: &manifest.artifact,
    };
    let mut bytes = b"DSH-PLUGIN-MANIFEST-V1\0".to_vec();
    bytes.extend(serde_json::to_vec(&payload).map_err(|error| {
        PluginInstallError::Signature(format!("could not canonicalize manifest: {error}"))
    })?);
    Ok(bytes)
}

fn trusted_plugin_public_key(key_id: &str) -> Result<String, PluginInstallError> {
    if let Some(encoded_keys) = option_env!("HARNDOCK_PLUGIN_TRUSTED_KEYS_JSON") {
        let keys: BTreeMap<String, String> =
            serde_json::from_str(encoded_keys).map_err(|error| {
                PluginInstallError::Signature(format!(
                    "Desktop trusted-key configuration is invalid: {error}"
                ))
            })?;
        if let Some(value) = keys.get(key_id) {
            return Ok(value.clone());
        }
    }
    #[cfg(debug_assertions)]
    if key_id == DEVELOPMENT_PLUGIN_KEY_ID {
        return Ok(DEVELOPMENT_PLUGIN_PUBLIC_KEY.into());
    }
    Err(PluginInstallError::Signature(format!(
        "unknown key ID: {key_id}"
    )))
}

pub(crate) fn verify_manifest_signature(
    manifest: &PluginManifest,
    expected_signature: Option<(&str, &str)>,
) -> Result<(), PluginInstallError> {
    let Some(signature) = manifest.signature.as_ref() else {
        return Err(PluginInstallError::Signature(
            "plugin manifest is unsigned".into(),
        ));
    };
    let Some((expected_key_id, expected_value)) = expected_signature else {
        return Err(PluginInstallError::Signature(
            "Center did not provide a trusted signature declaration".into(),
        ));
    };
    if signature.key_id != expected_key_id || signature.value != expected_value {
        return Err(PluginInstallError::Signature(
            "Manifest signature does not match the Center declaration".into(),
        ));
    }
    let public_key = trusted_plugin_public_key(&signature.key_id)?;
    let public_key = BASE64_STANDARD.decode(public_key).map_err(|error| {
        PluginInstallError::Signature(format!("trusted public key is invalid: {error}"))
    })?;
    let public_key: [u8; 32] = public_key.try_into().map_err(|_| {
        PluginInstallError::Signature("trusted public key must contain 32 bytes".into())
    })?;
    let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|error| {
        PluginInstallError::Signature(format!("trusted public key is invalid: {error}"))
    })?;
    let signature_bytes = BASE64_STANDARD.decode(&signature.value).map_err(|error| {
        PluginInstallError::Signature(format!("signature value is not valid Base64: {error}"))
    })?;
    let signature_bytes: [u8; 64] = signature_bytes.try_into().map_err(|_| {
        PluginInstallError::Signature("Ed25519 signature must contain 64 bytes".into())
    })?;
    verifying_key
        .verify(
            &manifest_signing_bytes(manifest)?,
            &Signature::from_bytes(&signature_bytes),
        )
        .map_err(|error| PluginInstallError::Signature(error.to_string()))
}

fn validate_archive_path(path: &Path) -> Result<(), PluginInstallError> {
    let value = path
        .to_str()
        .ok_or_else(|| invalid_archive("archive paths must be UTF-8"))?;
    if value.contains('\\') {
        return Err(invalid_archive(format!("backslash archive path: {value}")));
    }
    let mut components = path.components();
    if components.next() != Some(Component::Normal(OsStr::new(ARCHIVE_ROOT))) {
        return Err(invalid_archive(format!(
            "archive path is outside {ARCHIVE_ROOT}: {value}"
        )));
    }
    if components.any(|component| !matches!(component, Component::Normal(_))) {
        return Err(invalid_archive(format!("unsafe archive path: {value}")));
    }
    Ok(())
}

fn validate_link_target(entry: &Path, target: &Path) -> Result<(), PluginInstallError> {
    let value = target
        .to_str()
        .ok_or_else(|| invalid_archive("archive link targets must be UTF-8"))?;
    if value.is_empty() || value.contains('\\') || target.is_absolute() {
        return Err(invalid_archive(format!(
            "unsafe archive symlink: {} -> {value}",
            entry.display()
        )));
    }
    let mut depth = entry.components().count().saturating_sub(2);
    for component in target.components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir if depth > 0 => depth -= 1,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid_archive(format!(
                    "archive symlink escapes root: {} -> {value}",
                    entry.display()
                )));
            }
        }
    }
    Ok(())
}

fn invalid_archive(message: impl Into<String>) -> PluginInstallError {
    PluginInstallError::InvalidArchive(message.into())
}

fn has_duplicates(values: &[String]) -> bool {
    values.iter().collect::<HashSet<_>>().len() != values.len()
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value == value.to_ascii_lowercase()
}

fn semver_triplet(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), PluginInstallError> {
    let mut previous_separator = true;
    let mut has_separator = false;
    if !(3..=128).contains(&plugin_id.len()) {
        return Err(PluginInstallError::InvalidManifest(
            "plugin ID length is invalid".into(),
        ));
    }
    for character in plugin_id.chars() {
        if character == '.' || character == '-' {
            if previous_separator {
                return Err(PluginInstallError::InvalidManifest(
                    "plugin ID contains an invalid separator".into(),
                ));
            }
            previous_separator = true;
            has_separator = true;
        } else if character.is_ascii_lowercase() || character.is_ascii_digit() {
            previous_separator = false;
        } else {
            return Err(PluginInstallError::InvalidManifest(
                "plugin ID contains unsupported characters".into(),
            ));
        }
    }
    if previous_separator || !has_separator {
        return Err(PluginInstallError::InvalidManifest(
            "plugin ID must contain separated lowercase segments".into(),
        ));
    }
    Ok(())
}

fn validate_plugin_version(version: &str) -> Result<(), PluginInstallError> {
    if version.len() > 64
        || version.contains("..")
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
        || semver_triplet(version).is_none()
    {
        return Err(PluginInstallError::InvalidManifest(
            "plugin version is not a safe semantic version".into(),
        ));
    }
    Ok(())
}

fn unpack_archive(archive_path: &Path, destination: &Path) -> Result<(), PluginInstallError> {
    let file = File::open(archive_path)?;
    let decoder = zstd::stream::read::Decoder::new(file)
        .map_err(|error| invalid_archive(format!("could not decode zstd stream: {error}")))?;
    tar::Archive::new(decoder)
        .unpack(destination)
        .map_err(|error| invalid_archive(format!("could not unpack plugin archive: {error}")))
}

fn verify_archive_integrity(
    archive_path: &Path,
    expected_sha256: &str,
    expected_size: u64,
) -> Result<(), PluginInstallError> {
    let metadata = fs::metadata(archive_path)?;
    if metadata.len() != expected_size {
        return Err(PluginInstallError::InvalidArchive(format!(
            "archive size {} does not match expected {expected_size}",
            metadata.len()
        )));
    }
    let mut file = File::open(archive_path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_sha256 {
        return Err(PluginInstallError::InvalidArchive(format!(
            "archive SHA-256 {actual} does not match expected {expected_sha256}"
        )));
    }
    Ok(())
}

fn verify_staged_plugin(root: &Path) -> Result<(), PluginInstallError> {
    if !root.is_dir() {
        return Err(invalid_archive(
            "archive did not produce harndock-plugin root",
        ));
    }
    let canonical_root = root.canonicalize()?;
    verify_staged_tree(root, &canonical_root)?;
    let package_manifest = root.join(PACKAGE_MANIFEST_FILE);
    let metadata = fs::symlink_metadata(&package_manifest)?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return Err(invalid_archive(
            "plugin package.json must be a regular file no larger than 1 MiB",
        ));
    }
    let package: serde_json::Value = serde_json::from_slice(&fs::read(&package_manifest)?)
        .map_err(|error| invalid_archive(format!("plugin package.json is invalid: {error}")))?;
    let name = package
        .get("name")
        .and_then(serde_json::Value::as_str)
        .filter(|value| is_safe_package_name(value))
        .ok_or_else(|| invalid_archive("plugin package.json must contain a safe name"))?;
    if name.is_empty() {
        return Err(invalid_archive(
            "plugin package.json must contain a non-empty name",
        ));
    }
    Ok(())
}

fn is_safe_package_name(value: &str) -> bool {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() > 2 || parts.iter().any(|part| part.is_empty()) {
        return false;
    }
    let name = parts.last().copied().unwrap_or_default();
    if name == "." || name == ".." {
        return false;
    }
    if !name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
    {
        return false;
    }
    parts.len() == 1
        || (parts[0].starts_with('@')
            && parts[0][1..]
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character)))
}

fn verify_staged_tree(path: &Path, canonical_root: &Path) -> Result<(), PluginInstallError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        let metadata = fs::symlink_metadata(&child)?;
        let canonical = child.canonicalize().map_err(|error| {
            invalid_archive(format!(
                "staged path cannot be resolved safely: {}: {error}",
                child.display()
            ))
        })?;
        if !canonical.starts_with(canonical_root) {
            return Err(invalid_archive(format!(
                "staged path escapes plugin root: {}",
                child.display()
            )));
        }
        let file_type = metadata.file_type();
        if file_type.is_dir() {
            verify_staged_tree(&child, canonical_root)?;
        } else if !(file_type.is_file() || file_type.is_symlink()) {
            return Err(invalid_archive(format!(
                "unsupported staged file type: {}",
                child.display()
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_path(suffix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("harndock-plugin-preflight-{unique}-{suffix}"))
    }

    fn manifest(version: &str, sha256: &str, size: u64) -> PluginManifest {
        PluginManifest {
            plugin_id: "com.example.notes".into(),
            version: version.into(),
            plugin_types: vec!["client".into()],
            summary: None,
            description: None,
            harness: PluginHarnessCompatibility {
                min_version: "0.1.0".into(),
                max_version: Some("2.0.0".into()),
            },
            runtime_api: 1,
            platforms: vec!["darwin-aarch64".into()],
            permissions: BTreeMap::new(),
            artifact: PluginManifestArtifact {
                sha256: sha256.into(),
                size,
            },
            signature: None,
        }
    }

    fn write_archive(path: &Path, entries: Vec<(&str, &[u8])>, symlink: Option<(&str, &str)>) {
        let file = File::create(path).expect("archive should be writable");
        let encoder = zstd::stream::write::Encoder::new(file, 1).expect("zstd should start");
        let mut builder = tar::Builder::new(encoder);
        let mut root = tar::Header::new_gnu();
        root.set_entry_type(tar::EntryType::Directory);
        root.set_mode(0o755);
        root.set_size(0);
        root.set_cksum();
        builder
            .append_data(&mut root, ARCHIVE_ROOT, std::io::empty())
            .expect("root should be added");
        let package = br#"{"name":"com.example.notes","version":"1.0.0","private":true}"#;
        let mut package_header = tar::Header::new_gnu();
        package_header.set_size(package.len() as u64);
        package_header.set_mode(0o644);
        package_header.set_cksum();
        builder
            .append_data(
                &mut package_header,
                format!("{ARCHIVE_ROOT}/{PACKAGE_MANIFEST_FILE}"),
                &package[..],
            )
            .expect("package manifest should be added");
        for (name, contents) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, name, contents)
                .expect("entry should be added");
        }
        if let Some((name, target)) = symlink {
            builder
                .append_link(&mut tar::Header::new_gnu(), name, target)
                .expect("symlink should be added");
        }
        let encoder = builder.into_inner().expect("tar should finish");
        encoder.finish().expect("zstd should finish");
    }

    fn archive_integrity(path: &Path) -> (String, u64) {
        let bytes = fs::read(path).expect("archive should be readable");
        (format!("{:x}", Sha256::digest(&bytes)), bytes.len() as u64)
    }

    fn signed_manifest(version: &str, sha256: &str, size: u64) -> (PluginManifest, String) {
        let mut value = manifest(version, sha256, size);
        let signing_key = SigningKey::from_bytes(&[
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec,
            0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03,
            0x1c, 0xae, 0x7f, 0x60,
        ]);
        let signature = BASE64_STANDARD.encode(
            signing_key
                .sign(&manifest_signing_bytes(&value).expect("manifest should canonicalize"))
                .to_bytes(),
        );
        value.signature = Some(PluginManifestSignature {
            key_id: DEVELOPMENT_PLUGIN_KEY_ID.into(),
            value: signature.clone(),
        });
        (value, signature)
    }

    fn write_manifest(path: &Path, version: &str, sha256: &str, size: u64) -> String {
        let (value, signature) = signed_manifest(version, sha256, size);
        fs::write(
            path,
            serde_json::to_vec(&value).expect("manifest should serialize"),
        )
        .expect("manifest should be writable");
        signature
    }

    fn install_fixture(store: &PluginStore, version: &str) -> InstalledPlugin {
        let archive_path = temp_path(&format!("{version}.tar.zst"));
        write_archive(
            &archive_path,
            vec![("harndock-plugin/client.js", version.as_bytes())],
            None,
        );
        let (digest, size) = archive_integrity(&archive_path);
        let manifest_path = temp_path(&format!("{version}-manifest.json"));
        let signature = write_manifest(&manifest_path, version, &digest, size);
        let installed = store
            .install_archive(
                &archive_path,
                &manifest_path,
                "com.example.notes",
                version,
                &digest,
                size,
                Some((DEVELOPMENT_PLUGIN_KEY_ID, &signature)),
                "darwin-aarch64",
                "0.1.0",
                1,
            )
            .expect("plugin version should install");
        let _ = fs::remove_file(archive_path);
        let _ = fs::remove_file(manifest_path);
        installed
    }

    #[test]
    fn rejects_unsigned_and_tampered_manifests() {
        let unsigned = manifest(
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            42,
        );
        assert!(matches!(
            verify_manifest_signature(&unsigned, None),
            Err(PluginInstallError::Signature(_))
        ));

        let (mut signed, signature) = signed_manifest(
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            42,
        );
        assert!(
            verify_manifest_signature(&signed, Some((DEVELOPMENT_PLUGIN_KEY_ID, &signature)))
                .is_ok()
        );
        signed
            .permissions
            .insert("network".into(), vec!["evil.example".into()]);
        assert!(matches!(
            verify_manifest_signature(&signed, Some((DEVELOPMENT_PLUGIN_KEY_ID, &signature))),
            Err(PluginInstallError::Signature(_))
        ));
    }

    #[test]
    fn signing_contract_matches_the_center_vector() {
        let (_manifest, signature) = signed_manifest(
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            42,
        );
        assert_eq!(
            signature,
            "H4xhecbyiBttGrbxazXrgDJBu4Mo9F9gR9DSNmKFivulECMPqhRZmneRE2txXfWR7daBfCiVReUWMXJBMybPDA=="
        );
    }

    #[test]
    fn accepts_a_safe_archive_and_checks_manifest_metadata() {
        let path = temp_path("safe.tar.zst");
        write_archive(&path, vec![("harndock-plugin/client.js", b"plugin")], None);
        let (digest, package_size) = archive_integrity(&path);
        let manifest_path = temp_path("safe-manifest.json");
        let signature = write_manifest(&manifest_path, "1.0.0", &digest, package_size);
        let result = preflight_plugin_archive(
            &path,
            &manifest_path,
            "com.example.notes",
            "1.0.0",
            &digest,
            package_size,
            Some((DEVELOPMENT_PLUGIN_KEY_ID, &signature)),
            "darwin-aarch64",
            "0.1.0",
            1,
        );
        assert!(result.is_ok(), "{result:?}");
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(manifest_path);
    }

    #[test]
    #[ignore = "requires HARNDOCK_TEST_PLUGIN_ARCHIVE and HARNDOCK_TEST_PLUGIN_MANIFEST"]
    fn installs_a_real_marketplace_release_in_an_isolated_store() {
        let archive_path = PathBuf::from(
            std::env::var("HARNDOCK_TEST_PLUGIN_ARCHIVE")
                .expect("real plugin archive path should be configured"),
        );
        let manifest_path = PathBuf::from(
            std::env::var("HARNDOCK_TEST_PLUGIN_MANIFEST")
                .expect("real plugin manifest path should be configured"),
        );
        let manifest: PluginManifest = serde_json::from_slice(
            &fs::read(&manifest_path).expect("real plugin manifest should be readable"),
        )
        .expect("real plugin manifest should deserialize");
        let signature = manifest
            .signature
            .as_ref()
            .expect("real plugin manifest should be signed");
        let target = std::env::var("HARNDOCK_TEST_PLUGIN_TARGET")
            .unwrap_or_else(|_| "darwin-aarch64".into());
        let app_data = temp_path("real-marketplace-store");
        fs::create_dir_all(&app_data).expect("isolated store root should be writable");
        let store = PluginStore::new(&app_data);

        let installed = store
            .install_archive(
                &archive_path,
                &manifest_path,
                &manifest.plugin_id,
                &manifest.version,
                &manifest.artifact.sha256,
                manifest.artifact.size,
                Some((&signature.key_id, &signature.value)),
                &target,
                env!("CARGO_PKG_VERSION"),
                manifest.runtime_api,
            )
            .expect("real marketplace release should install");

        assert_eq!(installed.plugin_id, manifest.plugin_id);
        assert_eq!(installed.version, manifest.version);
        let pointer = store
            .current(&installed.plugin_id)
            .expect("active pointer should be readable")
            .expect("active pointer should exist");
        assert_eq!(pointer.version, installed.version);
        assert_eq!(pointer.health, PluginHealth::Pending);
        assert!(pointer.enabled);
        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn rejects_archive_entries_outside_the_fixed_root() {
        let path = temp_path("outside.tar.zst");
        write_archive(&path, vec![("outside/escape", b"bad")], None);
        let manifest_path = temp_path("outside-manifest.json");
        write_manifest(
            &manifest_path,
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            512,
        );
        let result = preflight_plugin_archive(
            &path,
            &manifest_path,
            "com.example.notes",
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            512,
            None,
            "darwin-aarch64",
            "0.1.0",
            1,
        );
        assert!(matches!(result, Err(PluginInstallError::InvalidArchive(_))));
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(manifest_path);
    }

    #[test]
    fn rejects_symlink_escape() {
        let path = temp_path("symlink.tar.zst");
        write_archive(
            &path,
            vec![("harndock-plugin/client.js", b"plugin")],
            Some(("harndock-plugin/escape", "../../outside")),
        );
        let manifest_path = temp_path("symlink-manifest.json");
        write_manifest(
            &manifest_path,
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            512,
        );
        let result = preflight_plugin_archive(
            &path,
            &manifest_path,
            "com.example.notes",
            "1.0.0",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            512,
            None,
            "darwin-aarch64",
            "0.1.0",
            1,
        );
        assert!(matches!(result, Err(PluginInstallError::InvalidArchive(_))));
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(manifest_path);
    }

    #[test]
    fn installs_versions_atomically_and_rolls_back_the_active_pointer() {
        let app_data = temp_path("store");
        fs::create_dir_all(&app_data).expect("store root should be writable");
        let store = PluginStore::new(&app_data);

        for version in ["1.0.0", "1.1.0"] {
            let archive_path = temp_path(&format!("{version}.tar.zst"));
            write_archive(
                &archive_path,
                vec![("harndock-plugin/client.js", version.as_bytes())],
                None,
            );
            let (digest, size) = archive_integrity(&archive_path);
            let manifest_path = temp_path(&format!("{version}-manifest.json"));
            let signature = write_manifest(&manifest_path, version, &digest, size);
            let installed = store
                .install_archive(
                    &archive_path,
                    &manifest_path,
                    "com.example.notes",
                    version,
                    &digest,
                    size,
                    Some((DEVELOPMENT_PLUGIN_KEY_ID, &signature)),
                    "darwin-aarch64",
                    "0.1.0",
                    1,
                )
                .expect("plugin version should install");
            assert!(installed.root.join("client.js").is_file());
            assert!(installed.root.join(MANIFEST_FILE).is_file());
            let _ = fs::remove_file(archive_path);
            let _ = fs::remove_file(manifest_path);
        }

        let current = store
            .current("com.example.notes")
            .expect("pointer should be readable")
            .expect("pointer should exist");
        assert_eq!(current.version, "1.1.0");
        assert_eq!(current.previous_version.as_deref(), Some("1.0.0"));
        assert_eq!(current.health, PluginHealth::Pending);

        let restored = store
            .rollback("com.example.notes")
            .expect("previous version should be restorable");
        assert_eq!(restored.version, "1.0.0");
        assert_eq!(restored.health, PluginHealth::Healthy);
        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn failed_first_install_is_removed_by_pending_rollback() {
        let app_data = temp_path("pending-first-install");
        fs::create_dir_all(&app_data).expect("store root should be writable");
        let store = PluginStore::new(&app_data);
        let installed = install_fixture(&store, "1.0.0");

        assert_eq!(
            store.current("com.example.notes").unwrap().unwrap().health,
            PluginHealth::Pending
        );
        assert_eq!(store.rollback_pending().unwrap(), vec!["com.example.notes"]);
        assert!(store.current("com.example.notes").unwrap().is_none());
        assert!(!installed.root.exists());
        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn failed_upgrade_restores_the_previous_healthy_version() {
        let app_data = temp_path("pending-upgrade");
        fs::create_dir_all(&app_data).expect("store root should be writable");
        let store = PluginStore::new(&app_data);
        install_fixture(&store, "1.0.0");
        store.mark_pending_healthy().unwrap();
        install_fixture(&store, "1.1.0");

        assert_eq!(store.rollback_pending().unwrap(), vec!["com.example.notes"]);
        let current = store.current("com.example.notes").unwrap().unwrap();
        assert_eq!(current.version, "1.0.0");
        assert_eq!(current.previous_version.as_deref(), Some("1.1.0"));
        assert_eq!(current.health, PluginHealth::Healthy);
        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn upgrade_preserves_a_disabled_plugin_state() {
        let app_data = temp_path("disabled-upgrade");
        fs::create_dir_all(&app_data).expect("store root should be writable");
        let store = PluginStore::new(&app_data);
        install_fixture(&store, "1.0.0");
        store.mark_pending_healthy().unwrap();
        store
            .set_enabled("com.example.notes", false)
            .expect("healthy plugin should be disableable");

        install_fixture(&store, "1.1.0");
        let current = store.current("com.example.notes").unwrap().unwrap();
        assert_eq!(current.version, "1.1.0");
        assert!(!current.enabled);
        assert_eq!(current.health, PluginHealth::Pending);

        store.mark_pending_healthy().unwrap();
        assert!(!store.current("com.example.notes").unwrap().unwrap().enabled);
        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn healthy_plugin_lifecycle_supports_disable_enable_and_uninstall() {
        let app_data = temp_path("lifecycle");
        fs::create_dir_all(&app_data).expect("store root should be writable");
        let store = PluginStore::new(&app_data);
        let installed = install_fixture(&store, "1.0.0");

        store
            .mark_pending_healthy()
            .expect("pending plugin should become healthy");
        let disabled = store
            .set_enabled("com.example.notes", false)
            .expect("healthy plugin should be disableable");
        assert!(!disabled.enabled);
        assert_eq!(disabled.health, PluginHealth::Healthy);

        let enabled = store
            .set_enabled("com.example.notes", true)
            .expect("healthy plugin should be enableable");
        assert!(enabled.enabled);
        assert_eq!(
            store.current("com.example.notes").unwrap().unwrap().version,
            "1.0.0"
        );

        store
            .uninstall("com.example.notes")
            .expect("installed plugin should be uninstallable");
        assert!(store.current("com.example.notes").unwrap().is_none());
        assert!(!installed.root.exists());
        assert!(store.list_installed().unwrap().is_empty());
        let _ = fs::remove_dir_all(app_data);
    }
}
