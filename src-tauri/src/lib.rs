use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

const SIDECAR_PORT: u16 = 3001;
const SIDECAR_HEALTH_URL: &str = "http://localhost:3001/health";

// ─── Main Window ──────────────────────────────────────

/// Show and focus the main window.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.set_focus();
            log::info!("Main window focused");
        } else {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("window-shown", ());
            log::info!("Main window shown");
        }
    }
}

// ─── Sidecar Lifecycle ───────────────────────────────────

/// Managed state for the sidecar child process.
struct SidecarState {
    process: Mutex<Option<Child>>,
}

/// Spawn the Node.js sidecar process.
/// In dev mode, Tauri's beforeDevCommand already starts it via `pnpm dev:sidecar`.
/// In production, we spawn the bundled Node.js binary with the bundled sidecar JS.
fn spawn_sidecar() -> Option<Child> {
    // In dev mode, the sidecar is started by beforeDevCommand.
    // Check if it's already running before spawning.
    if check_sidecar_health() {
        log::info!("Sidecar already running on port {}", SIDECAR_PORT);
        return None;
    }

    log::info!("Spawning sidecar process...");

    let paths = find_sidecar_paths();

    let mut cmd = Command::new(&paths.node_bin);
    cmd.arg(&paths.script)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Set NODE_PATH so bundled node_modules can be resolved
    if let Some(nm) = &paths.node_modules {
        cmd.env("NODE_PATH", nm);
        log::info!("NODE_PATH set to {:?}", nm);
    }

    match cmd.spawn() {
        Ok(child) => {
            log::info!(
                "Sidecar spawned (PID: {}, node: {:?}, script: {:?})",
                child.id(),
                paths.node_bin,
                paths.script
            );
            Some(child)
        }
        Err(e) => {
            log::error!(
                "Failed to spawn sidecar: {} (node: {:?})",
                e,
                paths.node_bin
            );
            None
        }
    }
}

/// Paths needed to run the sidecar.
struct SidecarPaths {
    node_bin: PathBuf,
    script: PathBuf,
    node_modules: Option<PathBuf>,
}

/// Find the bundled Node.js binary, sidecar script, and node_modules.
fn find_sidecar_paths() -> SidecarPaths {
    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().unwrap_or(&exe);

        // Check all possible resource locations
        let resource_dirs: Vec<PathBuf> = vec![
            // Windows/Linux: resources alongside the binary
            exe_dir.to_path_buf(),
            // macOS: Contents/Resources/
            exe_dir
                .parent()
                .map(|p| p.join("Resources"))
                .unwrap_or_default(),
        ];

        let node_bin_name = if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        };

        for res_dir in &resource_dirs {
            let bundle = res_dir.join("sidecar-bundle");
            let node = bundle.join(node_bin_name);
            let script = bundle.join("dist").join("index.js");

            if node.exists() && script.exists() {
                log::info!("Found bundled sidecar at {:?}", bundle);
                let nm = bundle.join("node_modules");
                return SidecarPaths {
                    node_bin: node,
                    script,
                    node_modules: if nm.exists() { Some(nm) } else { None },
                };
            }
        }
    }

    // Dev mode fallback: use system `node` and relative paths
    log::info!("Using dev-mode sidecar (system node)");
    SidecarPaths {
        node_bin: PathBuf::from("node"),
        script: PathBuf::from("niom-ai/dist/index.js"),
        node_modules: None,
    }
}

/// Check if the sidecar is healthy by hitting /health.
fn check_sidecar_health() -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build();

    match client {
        Ok(c) => c
            .get(SIDECAR_HEALTH_URL)
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Wait for the sidecar to become healthy (max 10 seconds).
fn wait_for_sidecar(max_retries: u32) -> bool {
    for i in 0..max_retries {
        if check_sidecar_health() {
            log::info!("Sidecar healthy after {} attempts", i + 1);
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    log::warn!("Sidecar not healthy after {} attempts", max_retries);
    false
}

// ─── Tauri Commands ──────────────────────────────────────

/// Send a native OS notification.
#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app
        .notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
    {
        log::warn!("Failed to send notification: {}", e);
    }
}

/// Get the OS account username.
#[tauri::command]
fn get_os_username() -> String {
    let name = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "User".to_string());
    // Capitalize first letter
    let mut chars = name.chars();
    match chars.next() {
        None => name,
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}

/// Get sidecar status.
#[tauri::command]
fn get_sidecar_status(sidecar: tauri::State<'_, SidecarState>) -> String {
    let has_process = sidecar.process.lock().unwrap().is_some();
    let is_healthy = check_sidecar_health();

    match (has_process || is_healthy, is_healthy) {
        (_, true) => "running".to_string(),
        (true, false) => "unhealthy".to_string(),
        (false, false) => "stopped".to_string(),
    }
}

/// Restart the sidecar process.
#[tauri::command]
fn restart_sidecar(sidecar: tauri::State<'_, SidecarState>) -> Result<String, String> {
    log::info!("Sidecar restart requested");

    // Kill existing process if we own it
    let mut proc = sidecar.process.lock().unwrap();
    if let Some(ref mut child) = *proc {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Killed existing sidecar process");
    }

    // Spawn new one
    *proc = spawn_sidecar();

    if wait_for_sidecar(10) {
        Ok("running".to_string())
    } else {
        Err("Sidecar failed to start".to_string())
    }
}

// ─── App Entry Point ─────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".niom");

    // Spawn sidecar (or detect it's already running from beforeDevCommand)
    let sidecar_child = spawn_sidecar();
    let sidecar_state = SidecarState {
        process: Mutex::new(sidecar_child),
    };

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Folder {
                        path: data_dir.clone(),
                        file_name: Some("niom".into()),
                    },
                ))
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(sidecar_state)
        .setup(move |app| {
            log::info!("NIOM data dir: {:?}", data_dir);

            // Wait for sidecar to be healthy
            let healthy = wait_for_sidecar(20);
            if healthy {
                log::info!("Sidecar is healthy on port {}", SIDECAR_PORT);
            } else {
                log::warn!("Sidecar not detected — AI features unavailable");
            }

            // ─── System Tray ───
            let invoke_i =
                MenuItem::with_id(app, "invoke", "Invoke (Ctrl+Space)", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit NIOM", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&invoke_i, &quit_i])?;

            // Decode embedded PNG icon for tray
            let tray_icon = {
                let png_bytes = include_bytes!("../icons/icon.png");
                let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes.as_slice()));
                let mut reader = decoder.read_info().expect("Failed to read PNG info");
                let mut buf = vec![0u8; reader.output_buffer_size()];
                let info = reader
                    .next_frame(&mut buf)
                    .expect("Failed to decode PNG frame");
                buf.truncate(info.buffer_size());
                tauri::image::Image::new_owned(buf, info.width, info.height)
            };

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("NIOM — Ambient Intelligence")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "invoke" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        // Kill sidecar on quit if we own it
                        let state = app.state::<SidecarState>();
                        if let Ok(mut proc) = state.process.lock() {
                            if let Some(ref mut child) = *proc {
                                let _ = child.kill();
                                log::info!("Killed sidecar on quit");
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // ─── Global Hotkey: Ctrl+Space → show main window ───
            use tauri_plugin_global_shortcut::ShortcutState;

            app.global_shortcut()
                .on_shortcut("Ctrl+Space", move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        log::info!("Global shortcut pressed: {:?}", shortcut);
                        show_main_window(app);
                    }
                })?;

            // ─── Close window: minimize to tray ───
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                        log::info!("Main window hidden to tray");
                    }
                });
            }

            log::info!("NIOM started — Ctrl+Space to summon");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_notification,
            get_os_username,
            get_sidecar_status,
            restart_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NIOM");
}
