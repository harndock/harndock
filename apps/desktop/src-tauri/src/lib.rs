#[allow(dead_code)]
mod plugin_center;
#[allow(dead_code)]
mod plugin_installer;
mod remote_sync;
mod runtime;

use std::time::Duration;

use plugin_center::PluginCenterState;
use runtime::RuntimeManager;
use serde::Deserialize;
use tauri::Manager;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_deep_link::DeepLinkExt;

const REMOTE_SYNC_SETTINGS_MENU_ID: &str = "remote-sync-settings";
const REMOTE_SYNC_SETTINGS_FILE_MENU_ID: &str = "remote-sync-settings-file";
const REMOTE_SYNC_SETTINGS_LABEL: &str = "Gateway && Remote Sync...";
const PLUGIN_CENTER_MENU_ID: &str = "plugin-center";
const PLUGIN_CENTER_MENU_LABEL: &str = "Plugin Center...";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrandingConfig {
    product_name: String,
    base_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledRuntimeInfo {
    runtime_version: String,
    target: String,
}

#[derive(Debug, Deserialize)]
struct RuntimeManifestInfo {
    components: RuntimeComponentsInfo,
}

#[derive(Debug, Deserialize)]
struct RuntimeComponentsInfo {
    harness: HarnessInfo,
}

#[derive(Debug, Deserialize)]
struct HarnessInfo {
    commit: String,
}

fn about_metadata() -> AboutMetadata<'static> {
    let branding: BrandingConfig =
        serde_json::from_str(include_str!("../../../../runtime/branding.json"))
            .expect("runtime branding configuration must be valid");
    let runtime: BundledRuntimeInfo =
        serde_json::from_str(include_str!("../../../../runtime/bundled-runtime.json"))
            .expect("bundled Runtime descriptor must be valid");
    let manifest: RuntimeManifestInfo =
        serde_json::from_str(include_str!("../../../../runtime/manifest.example.json"))
            .expect("Runtime manifest must be valid");

    AboutMetadata {
        name: Some(branding.product_name),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        short_version: Some(format!(
            "Runtime {} · {}",
            runtime.runtime_version, runtime.target
        )),
        copyright: Some(format!("Based on {}", branding.base_name)),
        credits: Some(format!(
            "Based on: {}\nRuntime version: {}\nBuild target: {}\nHarness commit: {}",
            branding.base_name,
            runtime.runtime_version,
            runtime.target,
            manifest.components.harness.commit,
        )),
        ..Default::default()
    }
}

fn is_remote_sync_settings_menu(id: &str) -> bool {
    matches!(
        id,
        REMOTE_SYNC_SETTINGS_MENU_ID | REMOTE_SYNC_SETTINGS_FILE_MENU_ID
    )
}

fn is_plugin_center_menu(id: &str) -> bool {
    id == PLUGIN_CENTER_MENU_ID
}

fn plugin_id_from_deep_link(url: &tauri::Url) -> Option<String> {
    if url.scheme() != "harndock"
        || url.host_str() != Some("plugins")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let plugin_id = url.path().strip_prefix('/')?;
    if plugin_id.is_empty()
        || plugin_id.len() > 128
        || !plugin_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-'))
    {
        return None;
    }
    Some(plugin_id.to_string())
}

fn open_plugin_deep_link(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    if let Some(plugin_id) = urls.iter().find_map(plugin_id_from_deep_link) {
        let _ = app
            .state::<RuntimeManager>()
            .show_plugin_center_plugin(app, Some(&plugin_id));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {}));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .manage(RuntimeManager::default())
        .manage(PluginCenterState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                open_plugin_deep_link(&app_handle, &event.urls());
            });
            Ok(())
        })
        .menu(|handle| {
            let menu = Menu::default(handle)?;

            #[cfg(target_os = "macos")]
            let application_settings = MenuItem::with_id(
                handle,
                REMOTE_SYNC_SETTINGS_MENU_ID,
                REMOTE_SYNC_SETTINGS_LABEL,
                true,
                Some("CmdOrCtrl+,"),
            )?;

            #[cfg(target_os = "macos")]
            if let Some(first_item) = menu.items()?.into_iter().next()
                && let Some(application_menu) = first_item.as_submenu()
            {
                application_menu.insert(&application_settings, 1)?;
            }

            #[cfg(target_os = "macos")]
            if let Some(first_item) = menu.items()?.into_iter().next()
                && let Some(application_menu) = first_item.as_submenu()
            {
                if let Some(default_about) = application_menu.items()?.into_iter().next() {
                    let about = PredefinedMenuItem::about(
                        handle,
                        Some("About Harndock"),
                        Some(about_metadata()),
                    )?;
                    application_menu.remove(&default_about)?;
                    application_menu.insert(&about, 0)?;
                }
            }

            let file_settings = MenuItem::with_id(
                handle,
                REMOTE_SYNC_SETTINGS_FILE_MENU_ID,
                REMOTE_SYNC_SETTINGS_LABEL,
                true,
                if cfg!(target_os = "macos") {
                    None
                } else {
                    Some("CmdOrCtrl+,")
                },
            )?;
            let plugin_center = MenuItem::with_id(
                handle,
                PLUGIN_CENTER_MENU_ID,
                PLUGIN_CENTER_MENU_LABEL,
                true,
                None::<&str>,
            )?;
            let mut file_menu = None;
            for item in menu.items()? {
                if let Some(submenu) = item.as_submenu()
                    && submenu.text()? == "File"
                {
                    file_menu = Some(submenu.clone());
                    break;
                }
            }
            if let Some(file_menu) = file_menu {
                file_menu.insert(&plugin_center, 0)?;
                file_menu.insert(&file_settings, 0)?;
            } else {
                let file_menu =
                    Submenu::with_items(handle, "File", true, &[&plugin_center, &file_settings])?;
                menu.prepend(&file_menu)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if is_remote_sync_settings_menu(event.id().as_ref()) {
                let _ = app.state::<RuntimeManager>().show_settings(app);
            } else if is_plugin_center_menu(event.id().as_ref()) {
                let _ = app.state::<RuntimeManager>().show_plugin_center(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            plugin_center::plugin_download_start,
            plugin_center::plugin_download_status,
            plugin_center::plugin_download_cancel,
            plugin_center::plugin_install_preflight,
            plugin_center::plugin_install,
            plugin_center::plugin_installed_list,
            plugin_center::plugin_rollback,
            plugin_center::plugin_enable,
            plugin_center::plugin_disable,
            plugin_center::plugin_uninstall,
            plugin_center::plugin_marketplace_list,
            plugin_center::plugin_marketplace_detail,
            runtime::runtime_status,
            runtime::runtime_logs,
            runtime::start_runtime,
            runtime::stop_runtime,
            runtime::show_runtime,
            remote_sync::pair_remote_sync,
            remote_sync::remote_sync_status,
            remote_sync::unpair_remote_sync,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            app_handle
                .state::<RuntimeManager>()
                .shutdown_blocking(app_handle, Duration::from_secs(8));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_gateway_settings_menu_entries_open_the_same_page() {
        assert!(is_remote_sync_settings_menu(REMOTE_SYNC_SETTINGS_MENU_ID));
        assert!(is_remote_sync_settings_menu(
            REMOTE_SYNC_SETTINGS_FILE_MENU_ID
        ));
        assert!(!is_remote_sync_settings_menu("close-window"));
    }

    #[test]
    fn plugin_center_menu_has_a_stable_id() {
        assert!(is_plugin_center_menu(PLUGIN_CENTER_MENU_ID));
        assert!(!is_plugin_center_menu("close-window"));
    }

    #[test]
    fn plugin_deep_link_accepts_only_the_plugin_route() {
        let url = tauri::Url::parse("harndock://plugins/dsh-at-file").unwrap();
        assert_eq!(
            plugin_id_from_deep_link(&url).as_deref(),
            Some("dsh-at-file")
        );

        for invalid in [
            "https://plugins/dsh-at-file",
            "harndock://settings/dsh-at-file",
            "harndock://plugins/",
            "harndock://plugins/dsh-at-file/extra",
            "harndock://plugins/dsh-at-file?version=1",
            "harndock://plugins/%2e%2e",
        ] {
            assert_eq!(
                plugin_id_from_deep_link(&tauri::Url::parse(invalid).unwrap()),
                None
            );
        }
    }
}
