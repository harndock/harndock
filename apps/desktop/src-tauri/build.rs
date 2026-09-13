use std::{env, fs, path::Path};

const DESKTOP_ENV_PATH: &str = "../.env";
const PLUGIN_CENTER_URL_ENV: &str = "HARNDOCK_PLUGIN_CENTER_URL";
const PLUGIN_HTTP_PROXY_ENV: &str = "HARNDOCK_PLUGIN_HTTP_PROXY";

fn main() {
    println!("cargo:rerun-if-changed={DESKTOP_ENV_PATH}");
    for variable in [PLUGIN_CENTER_URL_ENV, PLUGIN_HTTP_PROXY_ENV] {
        println!("cargo:rerun-if-env-changed={variable}");
        if let Some(value) = env::var(variable)
            .ok()
            .or_else(|| read_desktop_env(variable))
        {
            println!("cargo:rustc-env={variable}={value}");
        }
    }
    tauri_build::build()
}

fn read_desktop_env(variable: &str) -> Option<String> {
    let content = fs::read_to_string(Path::new(DESKTOP_ENV_PATH)).ok()?;
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            (key.trim() == variable)
                .then(|| value.trim().trim_matches(&['\'', '"'][..]).to_string())
        })
        .last()
}
