use std::{
    collections::HashSet,
    error::Error,
    ffi::OsStr,
    fmt::{Display, Formatter},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const RUNTIME_DIRECTORY: &str = "runtime";
const VERSIONS_DIRECTORY: &str = "versions";
const STAGING_DIRECTORY: &str = "staging";
const DOWNLOADS_DIRECTORY: &str = "downloads";
const CURRENT_FILE: &str = "current.json";
const MANIFEST_FILE: &str = "runtime-manifest.json";
const CONTROL_DIRECTORY: &str = "control";
const ARCHIVE_ROOT: &str = "harndock-runtime";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RuntimeHealth {
    Pending,
    Healthy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimePointer {
    pub(crate) runtime_version: String,
    pub(crate) health: RuntimeHealth,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeManifest {
    #[serde(rename = "$schema")]
    pub(crate) schema: String,
    pub(crate) manifest_version: u32,
    pub(crate) runtime_version: String,
    pub(crate) runtime_api: u32,
    pub(crate) target: String,
    pub(crate) archive: RuntimeArchive,
    pub(crate) shell_compatibility: RuntimeShellCompatibility,
    pub(crate) launch: RuntimeLaunch,
    pub(crate) profile: RuntimeProfile,
    pub(crate) components: RuntimeComponents,
    pub(crate) product_packages: Vec<RuntimeProductPackage>,
    pub(crate) control: RuntimeControl,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeArchive {
    pub(crate) format: String,
    pub(crate) root: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeShellCompatibility {
    pub(crate) min_version: String,
    pub(crate) max_version_exclusive: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeLaunch {
    pub(crate) node: String,
    pub(crate) package_manager_entrypoint: String,
    pub(crate) harness_entrypoint: String,
    pub(crate) cwd: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeProfile {
    pub(crate) name: String,
    pub(crate) bundles: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeComponents {
    pub(crate) node: RuntimeComponent,
    pub(crate) pnpm: RuntimeComponent,
    pub(crate) harness: RuntimeHarness,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeComponent {
    pub(crate) version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeHarness {
    pub(crate) version: String,
    pub(crate) commit: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeProductPackage {
    pub(crate) name: String,
    pub(crate) role: String,
    pub(crate) path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeControl {
    pub(crate) protocol_version: u32,
    pub(crate) transport: String,
    pub(crate) schema: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InstalledRuntime {
    pub(crate) version: String,
    pub(crate) root: PathBuf,
}

#[derive(Debug)]
pub(crate) enum RuntimeStoreError {
    Io {
        operation: &'static str,
        path: PathBuf,
        source: std::io::Error,
    },
    InvalidVersion(String),
    InvalidPointer(String),
    InvalidManifest(String),
    InvalidArchive(String),
    ChecksumMismatch {
        expected: String,
        actual: String,
    },
    AlreadyInstalled(PathBuf),
    MissingRuntime(PathBuf),
}

impl Display for RuntimeStoreError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io {
                operation,
                path,
                source,
            } => {
                write!(
                    formatter,
                    "could not {operation} {}: {source}",
                    path.display()
                )
            }
            Self::InvalidVersion(version) => {
                write!(formatter, "invalid Runtime version: {version}")
            }
            Self::InvalidPointer(message) => {
                write!(formatter, "invalid Runtime pointer: {message}")
            }
            Self::InvalidManifest(message) => {
                write!(formatter, "invalid Runtime manifest: {message}")
            }
            Self::InvalidArchive(message) => {
                write!(formatter, "invalid Runtime archive: {message}")
            }
            Self::ChecksumMismatch { expected, actual } => write!(
                formatter,
                "Runtime archive SHA-256 mismatch: expected {expected}, got {actual}"
            ),
            Self::AlreadyInstalled(path) => {
                write!(
                    formatter,
                    "Runtime version is already installed: {}",
                    path.display()
                )
            }
            Self::MissingRuntime(path) => write!(
                formatter,
                "Runtime installation is unavailable: {}",
                path.display()
            ),
        }
    }
}

impl Error for RuntimeStoreError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeStore {
    root: PathBuf,
}

impl RuntimeStore {
    pub(crate) fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            root: app_data_dir.into().join(RUNTIME_DIRECTORY),
        }
    }

    pub(crate) fn ensure_layout(&self) -> Result<(), RuntimeStoreError> {
        for directory in [
            self.root.join(VERSIONS_DIRECTORY),
            self.root.join(STAGING_DIRECTORY),
            self.root.join(DOWNLOADS_DIRECTORY),
        ] {
            fs::create_dir_all(&directory).map_err(|source| RuntimeStoreError::Io {
                operation: "create Runtime directory",
                path: directory,
                source,
            })?;
        }
        let control = self.root.join(CONTROL_DIRECTORY);
        fs::create_dir_all(&control).map_err(|source| RuntimeStoreError::Io {
            operation: "create Runtime control directory",
            path: control,
            source,
        })?;
        Ok(())
    }

    pub(crate) fn installed(&self, version: &str) -> Result<InstalledRuntime, RuntimeStoreError> {
        validate_runtime_version(version)?;
        let root = self.version_root(version);
        if !root.is_dir() || !root.join(MANIFEST_FILE).is_file() {
            return Err(RuntimeStoreError::MissingRuntime(root));
        }
        Ok(InstalledRuntime {
            version: version.to_string(),
            root,
        })
    }

    pub(crate) fn manifest(
        &self,
        installed: &InstalledRuntime,
    ) -> Result<RuntimeManifest, RuntimeStoreError> {
        let path = installed.root.join(MANIFEST_FILE);
        let manifest = read_manifest(&path)?;
        validate_manifest(&manifest, &installed.version, &path)?;
        Ok(manifest)
    }

    #[allow(dead_code)]
    pub(crate) fn install_archive(
        &self,
        archive: &Path,
        expected_target: &str,
        expected_version: &str,
    ) -> Result<InstalledRuntime, RuntimeStoreError> {
        self.ensure_layout()?;
        verify_archive_checksum(archive)?;
        validate_archive(archive)?;
        let staging = self.create_staging_directory()?;
        let result = (|| {
            unpack_archive(archive, &staging)?;
            let staged_root = staging.join(ARCHIVE_ROOT);
            if !staged_root.is_dir() {
                return Err(RuntimeStoreError::InvalidArchive(
                    "archive did not produce the required harndock-runtime root".to_string(),
                ));
            }
            let manifest_path = staged_root.join(MANIFEST_FILE);
            let manifest = read_manifest(&manifest_path)?;
            validate_runtime_version(&manifest.runtime_version)?;
            validate_manifest(&manifest, &manifest.runtime_version, &manifest_path)?;
            if manifest.target != expected_target {
                return Err(RuntimeStoreError::InvalidManifest(format!(
                    "Runtime target {} does not match {expected_target}",
                    manifest.target
                )));
            }
            if manifest.runtime_version != expected_version {
                return Err(RuntimeStoreError::InvalidManifest(format!(
                    "Runtime version {} does not match {expected_version}",
                    manifest.runtime_version
                )));
            }
            verify_installed_runtime(&staged_root, &manifest)?;

            let version = manifest.runtime_version;
            let destination = self.version_root(&version);
            if destination.exists() {
                return Err(RuntimeStoreError::AlreadyInstalled(destination));
            }
            fs::rename(&staged_root, &destination).map_err(|source| RuntimeStoreError::Io {
                operation: "install Runtime version",
                path: destination,
                source,
            })?;
            self.activate(&version)
        })();
        let _ = fs::remove_dir_all(&staging);
        result
    }

    pub(crate) fn control_dir(&self) -> PathBuf {
        self.root.join(CONTROL_DIRECTORY)
    }

    fn create_staging_directory(&self) -> Result<PathBuf, RuntimeStoreError> {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| {
                RuntimeStoreError::InvalidArchive(format!(
                    "system clock cannot create a staging directory: {error}"
                ))
            })?
            .as_nanos();
        for attempt in 0..100_u32 {
            let path = self
                .root
                .join(STAGING_DIRECTORY)
                .join(format!("install-{}-{suffix}-{attempt}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(path),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(source) => {
                    return Err(RuntimeStoreError::Io {
                        operation: "create Runtime staging directory",
                        path,
                        source,
                    });
                }
            }
        }
        Err(RuntimeStoreError::InvalidArchive(
            "could not allocate a unique Runtime staging directory".to_string(),
        ))
    }

    pub(crate) fn current(
        &self,
    ) -> Result<Option<(RuntimePointer, InstalledRuntime)>, RuntimeStoreError> {
        let path = self.current_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path).map_err(|source| RuntimeStoreError::Io {
            operation: "read Runtime pointer",
            path: path.clone(),
            source,
        })?;
        let pointer: RuntimePointer = serde_json::from_str(&content).map_err(|error| {
            RuntimeStoreError::InvalidPointer(format!("{}: {error}", path.display()))
        })?;
        let installed = self.installed(&pointer.runtime_version)?;
        Ok(Some((pointer, installed)))
    }

    // The installer will call this after archive verification and before probing the Runtime.
    #[allow(dead_code)]
    pub(crate) fn activate(&self, version: &str) -> Result<InstalledRuntime, RuntimeStoreError> {
        self.ensure_layout()?;
        let installed = self.installed(version)?;
        self.write_pointer(&RuntimePointer {
            runtime_version: installed.version.clone(),
            health: RuntimeHealth::Pending,
        })?;
        Ok(installed)
    }

    pub(crate) fn mark_current_healthy(&self) -> Result<RuntimePointer, RuntimeStoreError> {
        let Some((mut pointer, _)) = self.current()? else {
            return Err(RuntimeStoreError::InvalidPointer(
                "cannot mark a missing current Runtime healthy".to_string(),
            ));
        };
        pointer.health = RuntimeHealth::Healthy;
        self.write_pointer(&pointer)?;
        Ok(pointer)
    }

    fn version_root(&self, version: &str) -> PathBuf {
        self.root.join(VERSIONS_DIRECTORY).join(version)
    }

    fn current_path(&self) -> PathBuf {
        self.root.join(CURRENT_FILE)
    }

    fn write_pointer(&self, pointer: &RuntimePointer) -> Result<(), RuntimeStoreError> {
        let path = self.current_path();
        let temporary = path.with_extension("json.tmp");
        let content = serde_json::to_vec_pretty(pointer).expect("Runtime pointer is serializable");
        let mut content = content;
        content.push(b'\n');
        fs::write(&temporary, content).map_err(|source| RuntimeStoreError::Io {
            operation: "write Runtime pointer",
            path: temporary.clone(),
            source,
        })?;
        fs::rename(&temporary, &path).map_err(|source| RuntimeStoreError::Io {
            operation: "activate Runtime pointer",
            path,
            source,
        })
    }
}

fn read_manifest(path: &Path) -> Result<RuntimeManifest, RuntimeStoreError> {
    let content = fs::read_to_string(path).map_err(|source| RuntimeStoreError::Io {
        operation: "read Runtime manifest",
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&content)
        .map_err(|error| RuntimeStoreError::InvalidManifest(format!("{}: {error}", path.display())))
}

fn validate_manifest(
    manifest: &RuntimeManifest,
    expected_version: &str,
    path: &Path,
) -> Result<(), RuntimeStoreError> {
    validate_runtime_version(&manifest.runtime_version)?;
    let expected_bundles = [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@harndock/desktop-bundle",
    ];
    let expected_packages = [
        ("@harndock/desktop-bundle", "bundle"),
        ("@harndock/client-desktop", "client"),
        ("@harndock/runtime-bridge", "host"),
        ("@harndock/remote-sync", "host"),
    ];
    let shell = semver_triplet(env!("CARGO_PKG_VERSION"));
    let min_shell = semver_triplet(&manifest.shell_compatibility.min_version);
    let max_shell = semver_triplet(&manifest.shell_compatibility.max_version_exclusive);
    let constants_are_valid = manifest.schema == "./manifest.schema.json"
        && manifest.manifest_version == 1
        && manifest.runtime_version == expected_version
        && manifest.runtime_api == 1
        && matches!(
            manifest.target.as_str(),
            "darwin-aarch64" | "darwin-x86_64" | "linux-aarch64" | "linux-x86_64"
        )
        && manifest.archive.format == "tar.zst"
        && manifest.archive.root == ARCHIVE_ROOT
        && manifest.profile.name == "desktop"
        && manifest.profile.bundles == expected_bundles
        && manifest.control.protocol_version == 1
        && manifest.control.transport == "unix"
        && manifest.control.schema == "control-protocol.schema.json"
        && is_lower_hex(&manifest.components.harness.commit, 40)
        && semver_triplet(&manifest.components.node.version).is_some()
        && semver_triplet(&manifest.components.pnpm.version).is_some()
        && semver_triplet(&manifest.components.harness.version).is_some()
        && matches!((shell, min_shell, max_shell), (Some(shell), Some(min), Some(max)) if shell >= min && shell < max)
        && manifest.product_packages.len() == expected_packages.len()
        && manifest
            .product_packages
            .iter()
            .zip(expected_packages)
            .all(|(package, expected)| package.name == expected.0 && package.role == expected.1);
    if !constants_are_valid {
        return Err(RuntimeStoreError::InvalidManifest(format!(
            "unsupported or incompatible Runtime contract in {}",
            path.display()
        )));
    }

    for value in [
        &manifest.launch.node,
        &manifest.launch.package_manager_entrypoint,
        &manifest.launch.harness_entrypoint,
        &manifest.launch.cwd,
        &manifest.control.schema,
    ]
    .into_iter()
    .chain(
        manifest
            .product_packages
            .iter()
            .map(|package| &package.path),
    ) {
        if !is_safe_artifact_path(value) {
            return Err(RuntimeStoreError::InvalidManifest(format!(
                "unsafe artifact path {value:?} in {}",
                path.display()
            )));
        }
    }
    Ok(())
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

fn verify_archive_checksum(archive: &Path) -> Result<(), RuntimeStoreError> {
    let file_name = archive.file_name().and_then(OsStr::to_str).ok_or_else(|| {
        RuntimeStoreError::InvalidArchive("archive filename is invalid".to_string())
    })?;
    let checksum_path = archive.with_file_name(format!("{file_name}.sha256"));
    let checksum = fs::read_to_string(&checksum_path).map_err(|source| RuntimeStoreError::Io {
        operation: "read Runtime checksum",
        path: checksum_path,
        source,
    })?;
    let line = checksum.trim_end_matches(['\r', '\n']);
    let Some((expected, named_file)) = line.split_once("  ") else {
        return Err(RuntimeStoreError::InvalidArchive(
            "Runtime checksum file has an invalid format".to_string(),
        ));
    };
    if line.contains('\n')
        || !is_lower_hex(expected, 64)
        || named_file != file_name
        || named_file.contains(char::is_whitespace)
    {
        return Err(RuntimeStoreError::InvalidArchive(
            "Runtime checksum file has an invalid format".to_string(),
        ));
    }

    let mut input = File::open(archive).map_err(|source| RuntimeStoreError::Io {
        operation: "open Runtime archive",
        path: archive.to_path_buf(),
        source,
    })?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|source| RuntimeStoreError::Io {
                operation: "hash Runtime archive",
                path: archive.to_path_buf(),
                source,
            })?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hash.finalize());
    if actual != expected {
        return Err(RuntimeStoreError::ChecksumMismatch {
            expected: expected.to_string(),
            actual,
        });
    }
    Ok(())
}

fn validate_archive(path: &Path) -> Result<(), RuntimeStoreError> {
    let file = File::open(path).map_err(|source| RuntimeStoreError::Io {
        operation: "open Runtime archive",
        path: path.to_path_buf(),
        source,
    })?;
    let decoder = zstd::stream::read::Decoder::new(file)
        .map_err(|error| invalid_archive(format!("could not decode zstd stream: {error}")))?;
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| invalid_archive(format!("could not read tar entries: {error}")))?;
    let mut seen = HashSet::new();
    let mut has_root = false;
    let mut has_manifest = false;
    for entry in entries {
        let entry =
            entry.map_err(|error| invalid_archive(format!("invalid tar entry: {error}")))?;
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
        if entry_path == Path::new(ARCHIVE_ROOT) {
            if !entry_type.is_dir() {
                return Err(invalid_archive("archive root must be a directory"));
            }
            has_root = true;
        }
        if entry_path == Path::new(ARCHIVE_ROOT).join(MANIFEST_FILE) {
            if !entry_type.is_file() {
                return Err(invalid_archive("Runtime manifest must be a regular file"));
            }
            has_manifest = true;
        }
        if entry_type.is_symlink() {
            let target = entry
                .link_name()
                .map_err(|error| invalid_archive(format!("invalid symlink target: {error}")))?
                .ok_or_else(|| invalid_archive("archive symlink has no target"))?;
            validate_link_target(&entry_path, &target)?;
        }
    }
    if !has_root || !has_manifest {
        return Err(invalid_archive(
            "archive must contain harndock-runtime and runtime-manifest.json",
        ));
    }
    Ok(())
}

fn validate_archive_path(path: &Path) -> Result<(), RuntimeStoreError> {
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

fn validate_link_target(entry: &Path, target: &Path) -> Result<(), RuntimeStoreError> {
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

fn unpack_archive(archive_path: &Path, destination: &Path) -> Result<(), RuntimeStoreError> {
    let file = File::open(archive_path).map_err(|source| RuntimeStoreError::Io {
        operation: "open Runtime archive",
        path: archive_path.to_path_buf(),
        source,
    })?;
    let decoder = zstd::stream::read::Decoder::new(file)
        .map_err(|error| invalid_archive(format!("could not decode zstd stream: {error}")))?;
    tar::Archive::new(decoder)
        .unpack(destination)
        .map_err(|error| invalid_archive(format!("could not unpack Runtime archive: {error}")))
}

fn verify_installed_runtime(
    root: &Path,
    manifest: &RuntimeManifest,
) -> Result<(), RuntimeStoreError> {
    if !root.join("manifest.schema.json").is_file() {
        return Err(RuntimeStoreError::InvalidManifest(
            "Runtime manifest schema is unavailable".to_string(),
        ));
    }
    for relative in [
        &manifest.launch.node,
        &manifest.launch.package_manager_entrypoint,
        &manifest.launch.harness_entrypoint,
        &manifest.control.schema,
    ] {
        if !root.join(relative).is_file() {
            return Err(RuntimeStoreError::InvalidManifest(format!(
                "Runtime file is unavailable: {relative}"
            )));
        }
    }
    if !root.join(&manifest.launch.cwd).is_dir() {
        return Err(RuntimeStoreError::InvalidManifest(format!(
            "Runtime cwd is unavailable: {}",
            manifest.launch.cwd
        )));
    }
    for package in &manifest.product_packages {
        let package_path = root.join(&package.path);
        let package_manifest =
            fs::read_to_string(package_path.join("package.json")).map_err(|source| {
                RuntimeStoreError::Io {
                    operation: "read Runtime product package",
                    path: package_path,
                    source,
                }
            })?;
        let package_manifest: serde_json::Value =
            serde_json::from_str(&package_manifest).map_err(|error| {
                RuntimeStoreError::InvalidManifest(format!(
                    "invalid product package {}: {error}",
                    package.name
                ))
            })?;
        if package_manifest
            .get("name")
            .and_then(|value| value.as_str())
            != Some(package.name.as_str())
        {
            return Err(RuntimeStoreError::InvalidManifest(format!(
                "product package identity mismatch: {}",
                package.name
            )));
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(root.join(&manifest.launch.node))
            .map_err(|source| RuntimeStoreError::Io {
                operation: "inspect Runtime Node",
                path: root.join(&manifest.launch.node),
                source,
            })?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return Err(RuntimeStoreError::InvalidManifest(
                "bundled Runtime Node is not executable".to_string(),
            ));
        }
    }

    verify_runtime_command(
        root,
        manifest,
        &["--version"],
        &format!("v{}", manifest.components.node.version),
    )?;
    let package_manager_entrypoint = root
        .join(&manifest.launch.package_manager_entrypoint)
        .to_string_lossy()
        .into_owned();
    verify_runtime_command(
        root,
        manifest,
        &[package_manager_entrypoint.as_str(), "--version"],
        &manifest.components.pnpm.version,
    )?;
    let harness_entrypoint = root
        .join(&manifest.launch.harness_entrypoint)
        .to_string_lossy()
        .into_owned();
    verify_runtime_command(
        root,
        manifest,
        &[harness_entrypoint.as_str(), "--version"],
        &manifest.components.harness.version,
    )?;
    Ok(())
}

fn verify_runtime_command(
    root: &Path,
    manifest: &RuntimeManifest,
    arguments: &[&str],
    expected: &str,
) -> Result<(), RuntimeStoreError> {
    let output = Command::new(root.join(&manifest.launch.node))
        .args(arguments)
        .current_dir(root.join(&manifest.launch.cwd))
        .env("DSH_HOME", root.join(".self-check-home"))
        .env("DSH_AGENTS_HOME", root.join(".self-check-agents"))
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("TSX_TSCONFIG_PATH")
        .output()
        .map_err(|error| invalid_archive(format!("Runtime self-check could not start: {error}")))?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != expected {
        return Err(invalid_archive(format!(
            "Runtime self-check failed for {:?}: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

fn invalid_archive(message: impl Into<String>) -> RuntimeStoreError {
    RuntimeStoreError::InvalidArchive(message.into())
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_safe_artifact_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value
            .split('/')
            .any(|part| part.is_empty() || part == ".." || part == ".")
}

fn validate_runtime_version(version: &str) -> Result<(), RuntimeStoreError> {
    let parts = version.split('.').collect::<Vec<_>>();
    let valid = parts.len() == 4
        && parts[0].len() == 4
        && parts[0].chars().all(|character| character.is_ascii_digit())
        && parts[1].len() == 2
        && parts[1].chars().all(|character| character.is_ascii_digit())
        && parts[2].len() == 2
        && parts[2].chars().all(|character| character.is_ascii_digit())
        && parts[3].chars().all(|character| character.is_ascii_digit())
        && !parts[3].starts_with('0');
    if valid {
        Ok(())
    } else {
        Err(RuntimeStoreError::InvalidVersion(version.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{RuntimeHealth, RuntimeStore, RuntimeStoreError};

    fn temporary_root() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("harndock-runtime-store-{suffix}"))
    }

    fn temporary_root_with_spaces() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("harndock runtime store {suffix}"))
    }

    fn install(store: &RuntimeStore, version: &str) {
        let root = store.root.join("versions").join(version);
        fs::create_dir_all(&root).expect("version directory should be created");
        fs::write(
            root.join("runtime-manifest.json"),
            format!(
                r#"{{
  "$schema": "./manifest.schema.json",
  "manifestVersion": 1,
  "runtimeVersion": "{version}",
  "runtimeApi": 1,
  "target": "darwin-aarch64",
  "archive": {{"format": "tar.zst", "root": "harndock-runtime"}},
  "shellCompatibility": {{"minVersion": "0.1.0", "maxVersionExclusive": "0.2.0"}},
  "launch": {{"node": "bin/node", "packageManagerEntrypoint": "tools/pnpm/bin/pnpm.cjs", "harnessEntrypoint": "app/bin.js", "cwd": "app"}},
  "profile": {{"name": "desktop", "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@harndock/desktop-bundle"]}},
  "components": {{"node": {{"version": "22.22.3"}}, "pnpm": {{"version": "11.9.0"}}, "harness": {{"version": "0.1.2-alpha.1", "commit": "cd5ef8148158c3a752a658978873241fdf8e2bbc"}}}},
  "productPackages": [
    {{"name": "@harndock/desktop-bundle", "role": "bundle", "path": "plugins/desktop-bundle"}},
    {{"name": "@harndock/client-desktop", "role": "client", "path": "plugins/client-desktop"}},
    {{"name": "@harndock/runtime-bridge", "role": "host", "path": "plugins/runtime-bridge"}},
    {{"name": "@harndock/remote-sync", "role": "host", "path": "plugins/remote-sync"}}
  ],
  "control": {{"protocolVersion": 1, "transport": "unix", "schema": "control-protocol.schema.json"}}
}}
"#
            ),
        )
        .expect("manifest should be written");
    }

    #[test]
    fn activation_writes_an_atomic_pending_pointer() {
        let root = temporary_root();
        let store = RuntimeStore::new(&root);
        store.ensure_layout().unwrap();
        install(&store, "2026.08.17.4");

        let installed = store.activate("2026.08.17.4").unwrap();
        let (pointer, current) = store.current().unwrap().unwrap();
        assert_eq!(installed, current);
        assert_eq!(pointer.runtime_version, "2026.08.17.4");
        assert_eq!(pointer.health, RuntimeHealth::Pending);
        assert!(!store.root.join("current.json.tmp").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn health_marking_updates_only_the_current_pointer() {
        let root = temporary_root();
        let store = RuntimeStore::new(&root);
        install(&store, "2026.08.17.4");
        store.activate("2026.08.17.4").unwrap();

        let pointer = store.mark_current_healthy().unwrap();
        assert_eq!(pointer.health, RuntimeHealth::Healthy);
        assert_eq!(store.current().unwrap().unwrap().0, pointer);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_or_missing_versions_are_rejected_before_pointer_write() {
        let root = temporary_root();
        let store = RuntimeStore::new(&root);
        store.ensure_layout().unwrap();
        assert!(matches!(
            store.activate("../escape"),
            Err(RuntimeStoreError::InvalidVersion(_))
        ));
        assert!(matches!(
            store.activate("2026.08.17.4"),
            Err(RuntimeStoreError::MissingRuntime(_))
        ));
        assert!(!store.root.join("current.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_rejects_unsafe_launch_paths() {
        let root = temporary_root();
        let store = RuntimeStore::new(&root);
        store.ensure_layout().unwrap();
        install(&store, "2026.08.17.4");
        let manifest = store.installed("2026.08.17.4").unwrap();
        fs::write(
            manifest.root.join("runtime-manifest.json"),
            br#"{"manifestVersion":1,"runtimeVersion":"2026.08.17.4","runtimeApi":1,"target":"darwin-aarch64","launch":{"node":"../node","harnessEntrypoint":"app/bin.js","cwd":"app"},"profile":{"name":"desktop"},"components":{"harness":{"commit":"cd5ef8148158c3a752a658978873241fdf8e2bbc"}},"control":{"protocolVersion":1,"transport":"unix"}}"#,
        )
        .unwrap();
        assert!(matches!(
            store.manifest(&manifest),
            Err(RuntimeStoreError::InvalidManifest(_))
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires the locally built Runtime artifact"]
    fn installs_the_built_runtime_artifact() {
        let root = temporary_root_with_spaces();
        let store = RuntimeStore::new(&root);
        let archive = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../dist/runtime/harndock-runtime-2026.08.31.1-darwin-aarch64.tar.zst");
        assert!(archive.is_file(), "the local Runtime artifact must exist");
        let installed = store
            .install_archive(&archive, "darwin-aarch64", "2026.08.31.1")
            .expect("the built Runtime artifact should install");
        assert_eq!(installed.version, "2026.08.31.1");
        assert_eq!(
            store.current().unwrap().unwrap().0.health,
            RuntimeHealth::Pending
        );
        assert!(installed.root.join("bin/node").is_file());
        assert!(
            store
                .root
                .join("staging")
                .read_dir()
                .unwrap()
                .next()
                .is_none()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
