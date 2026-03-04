//! config.rs — Central configuration store.
//!
//! Reads `~/.niom/config.json` at startup, exposes typed values,
//! and provides Tauri commands for the frontend to read/write config.
//!
//! This mirrors the sidecar's `config.ts` so both runtimes share
//! the same config file and schema.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

// ─── Defaults ─────────────────────────────────────────────

pub const DEFAULT_SIDECAR_PORT: u16 = 9741;

// ─── Schema ───────────────────────────────────────────────

/// Full NIOM config — mirrors `~/.niom/config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NiomConfig {
    #[serde(default = "default_workspace")]
    pub workspace: String,

    #[serde(default)]
    pub provider_keys: std::collections::HashMap<String, String>,

    #[serde(default = "default_provider")]
    pub provider: String,

    #[serde(default = "default_model")]
    pub model: String,

    #[serde(default = "default_sidecar_port")]
    pub sidecar_port: u16,

    #[serde(default)]
    pub search: SearchConfig,

    #[serde(default)]
    pub cortex: CortexConfig,

    #[serde(default)]
    pub mcp: Vec<McpServer>,

    #[serde(default)]
    pub models: Option<ModelOverrides>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchConfig {
    #[serde(default = "default_search_provider")]
    pub provider: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortexConfig {
    #[serde(default)]
    pub watch_paths: Vec<String>,
    #[serde(default = "default_excluded")]
    pub excluded: Vec<String>,
    #[serde(default = "default_max_events")]
    pub max_events: u32,
}

impl Default for CortexConfig {
    fn default() -> Self {
        Self {
            watch_paths: vec![],
            excluded: default_excluded(),
            max_events: default_max_events(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelOverrides {
    pub fast: Option<String>,
    pub capable: Option<String>,
    pub vision: Option<String>,
}

// ─── Default value functions ──────────────────────────────

fn default_workspace() -> String {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

fn default_provider() -> String {
    "openai".to_string()
}

fn default_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_sidecar_port() -> u16 {
    DEFAULT_SIDECAR_PORT
}

fn default_search_provider() -> String {
    "tavily".to_string()
}

fn default_excluded() -> Vec<String> {
    vec![
        "node_modules".into(),
        ".git".into(),
        "target".into(),
        "dist".into(),
        "__pycache__".into(),
        ".next".into(),
        "build".into(),
    ]
}

fn default_max_events() -> u32 {
    1000
}

// ─── Config Store ─────────────────────────────────────────

/// Global config singleton. Loaded once on startup, updated via commands.
static CONFIG: RwLock<Option<NiomConfig>> = RwLock::new(None);

/// Data directory: `~/.niom/`
pub fn data_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".niom")
}

/// Config file path: `~/.niom/config.json`
fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

/// Load config from disk and cache it. If file doesn't exist, create defaults.
pub fn load() -> NiomConfig {
    // Return cached if available
    if let Ok(guard) = CONFIG.read() {
        if let Some(ref config) = *guard {
            return config.clone();
        }
    }

    let path = config_path();
    let dir = data_dir();

    // Ensure directory exists
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }

    let config: NiomConfig = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(c) => {
                    log::info!("[config] Loaded from {:?}", path);
                    c
                }
                Err(e) => {
                    log::warn!("[config] Parse error, using defaults: {}", e);
                    serde_json::from_str("{}").unwrap()
                }
            },
            Err(e) => {
                log::warn!("[config] Read error, using defaults: {}", e);
                serde_json::from_str("{}").unwrap()
            }
        }
    } else {
        // Create default config file
        let default: NiomConfig = serde_json::from_str("{}").unwrap();
        if let Ok(json) = serde_json::to_string_pretty(&default) {
            let _ = std::fs::write(&path, &json);
            log::info!("[config] Created default config at {:?}", path);
        }
        default
    };

    // Cache it
    if let Ok(mut guard) = CONFIG.write() {
        *guard = Some(config.clone());
    }

    config
}

/// Save config to disk and update cache.
pub fn save(config: &NiomConfig) -> Result<(), String> {
    let path = config_path();
    let dir = data_dir();

    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    let json =
        serde_json::to_string_pretty(config).map_err(|e| format!("Serialize error: {}", e))?;

    std::fs::write(&path, &json).map_err(|e| format!("Write error: {}", e))?;

    // Update cache
    if let Ok(mut guard) = CONFIG.write() {
        *guard = Some(config.clone());
    }

    log::info!("[config] Saved to {:?}", path);
    Ok(())
}

/// Invalidate the cached config (next `load()` will re-read from disk).
pub fn invalidate() {
    if let Ok(mut guard) = CONFIG.write() {
        *guard = None;
    }
}

/// Quick accessor: get the sidecar port.
pub fn sidecar_port() -> u16 {
    load().sidecar_port
}

/// Quick accessor: get the sidecar health URL.
pub fn sidecar_health_url() -> String {
    format!("http://localhost:{}/health", sidecar_port())
}

// ─── Tauri Commands ───────────────────────────────────────

/// Get the full config (called from frontend).
#[tauri::command]
pub fn get_config() -> NiomConfig {
    load()
}

/// Update config fields (partial merge, called from frontend).
#[tauri::command]
pub fn save_config(config: NiomConfig) -> Result<String, String> {
    save(&config)?;
    Ok("saved".to_string())
}
