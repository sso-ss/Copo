//! Local companion windows and one native activity subscription, independent
//! of Settings visibility. Only display metadata crosses into these windows.
use super::*;
use serde_json::{json, Value};
use tauri::PhysicalPosition;

const PET: &str = "companion";
const PANEL: &str = "connections";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let (width, height) = personalization::companion_preferences(app.clone()).buddy_size.dimensions();
    let pet = WebviewWindowBuilder::new(app, PET, WebviewUrl::App("companion/index.html".into()))
        .title("CoPo Companion")
        .inner_size(width, height)
        .decorations(false).transparent(true).shadow(false)
        .resizable(false).always_on_top(true).skip_taskbar(true)
        .focused(false).build()?;
    if let Some(path) = placement_file(app) {
        if let Ok(data) = std::fs::read(path) {
            if let Ok([x, y]) = serde_json::from_slice::<[i32; 2]>(&data) {
                let _ = pet.set_position(PhysicalPosition::new(x, y));
            }
        } else if let Ok(Some(screen)) = pet.primary_monitor() {
            let size = screen.size();
            let origin = screen.position();
            let scale = screen.scale_factor();
            let _ = pet.set_position(PhysicalPosition::new(
                origin.x + size.width as i32 - (width * scale) as i32 - 40,
                origin.y + size.height as i32 - (height * scale) as i32 - 100,
            ));
        }
    }
    clamp_pet(app);
    attach_hide_on_close(app, &pet);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move { watch_activity(handle).await; });
    Ok(())
}

fn placement_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    copo_data_dir(app).map(|dir| dir.join("companion-position.json"))
}

pub fn resize_pet(app: &AppHandle, size: personalization::BuddySize) {
    let Some(pet) = app.get_webview_window(PET) else { return };
    let (width, height) = size.dimensions();
    let previous = pet.outer_position().ok().zip(pet.outer_size().ok());
    if pet.set_size(tauri::LogicalSize::new(width, height)).is_err() { return; }
    if let (Some((position, old)), Ok(new)) = (previous, pet.outer_size()) {
        // Keep the feet and horizontal center anchored while changing scale.
        let _ = pet.set_position(PhysicalPosition::new(
            position.x + (old.width as i32 - new.width as i32) / 2,
            position.y + old.height as i32 - new.height as i32,
        ));
    }
    clamp_pet(app);
    if let (Some(path), Ok(position)) = (placement_file(app), pet.outer_position()) {
        let _ = std::fs::write(path, json!([position.x, position.y]).to_string());
    }
}

fn clamp_pet(app: &AppHandle) {
    let Some(pet) = app.get_webview_window(PET) else { return };
    let Ok(position) = pet.outer_position() else { return };
    let Ok(size) = pet.outer_size() else { return };
    let screen = pet.current_monitor().ok().flatten()
        .or_else(|| pet.primary_monitor().ok().flatten());
    let Some(screen) = screen else { return };
    let origin = screen.position();
    let bounds = screen.size();
    let inset = (32.0 * screen.scale_factor()) as i32;
    let x = position.x.clamp(origin.x, (origin.x + bounds.width as i32 - size.width as i32).max(origin.x));
    let y = position.y.clamp(origin.y + inset, (origin.y + bounds.height as i32 - size.height as i32 - inset).max(origin.y + inset));
    let _ = pet.set_position(PhysicalPosition::new(x, y));
}

pub fn toggle_visibility(app: &AppHandle) {
    if let Some(pet) = app.get_webview_window(PET) {
        if pet.is_visible().unwrap_or(false) {
            reset_pet_pointer(app);
            let _ = pet.hide();
            if let Some(panel) = app.get_webview_window(PANEL) { let _ = panel.hide(); }
        } else {
            clamp_pet(app);
            let _ = pet.show();
        }
    } else if let Err(error) = create(app) {
        eprintln!("[companion] window unavailable: {error}");
    }
    let _ = refresh_tray(app, app.state::<AppStatus>().get());
}

pub fn visible(app: &AppHandle) -> bool {
    app.get_webview_window(PET).is_some_and(|pet| pet.is_visible().unwrap_or(false))
}

pub fn show_panel(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(PET).is_none() {
        create(app).map_err(|e| e.to_string())?;
    }
    if !visible(app) { toggle_visibility(app); }
    if let Some(panel) = app.get_webview_window(PANEL) {
        if panel.is_visible().unwrap_or(false) {
            reset_pet_pointer(app);
            return panel.set_focus().map_err(|e| e.to_string());
        }
    }
    toggle_panel(app)
}

fn reset_pet_pointer(app: &AppHandle) {
    // The pet may already be unfocused, so opening a native panel need not
    // send its webview a blur or pointerleave event.
    let _ = app.emit_to(PET, "companion:reset-pointer", ());
}

fn toggle_panel(app: &AppHandle) -> Result<(), String> {
    reset_pet_pointer(app);
    if let Some(panel) = app.get_webview_window(PANEL) {
        if panel.is_visible().unwrap_or(false) {
            return panel.hide().map_err(|e| e.to_string());
        }
    } else {
        let panel = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("companion/index.html?panel".into()))
            .title("CoPo").inner_size(380.0, 510.0)
            .min_inner_size(340.0, 350.0).decorations(false).transparent(true)
            .always_on_top(true).skip_taskbar(true).visible(false).build()
            .map_err(|e| e.to_string())?;
        attach_hide_on_close(app, &panel);
    }
    clamp_pet(app);
    let panel = app.get_webview_window(PANEL).ok_or("Panel unavailable")?;
    if let Some(pet) = app.get_webview_window(PET) {
        if let (Ok(position), Ok(Some(screen)), Ok(size)) = (pet.outer_position(), pet.current_monitor(), panel.outer_size()) {
            let origin = screen.position();
            let bounds = screen.size();
            let x = (position.x - size.width as i32 - 12).clamp(origin.x,
                (origin.x + bounds.width as i32 - size.width as i32).max(origin.x));
            let pet_height = pet.outer_size().map(|size| size.height as i32).unwrap_or(0);
            let y = (position.y - size.height as i32 + pet_height)
                .clamp(origin.y + 32, (origin.y + bounds.height as i32 - size.height as i32 - 40).max(origin.y + 32));
            let _ = panel.set_position(PhysicalPosition::new(x, y));
        }
    }
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn companion_action(app: AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "panel" => toggle_panel(&app)?,
        "hide" => toggle_visibility(&app),
        "close" => { if let Some(panel) = app.get_webview_window(PANEL) { let _ = panel.hide(); } },
        "drag" => { if let Some(pet) = app.get_webview_window(PET) { pet.start_dragging().map_err(|e| e.to_string())?; } },
        "place" => {
            clamp_pet(&app);
            if let (Some(pet), Some(path)) = (app.get_webview_window(PET), placement_file(&app)) {
                if let Ok(position) = pet.outer_position() {
                    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
                    let _ = std::fs::write(path, json!([position.x, position.y]).to_string());
                }
            }
        },
        "retry" => {
            // A lost stream reconnects itself. Restart only when a fresh
            // metadata probe also fails, never tear down a reachable gateway.
            if companion_data(app.clone()).await.is_err()
                && app.state::<AppStatus>().get() != SidecarState::Starting {
                respawn_sidecar(&app);
            }
            let _ = app.emit("companion:stream", json!({"kind": "refresh"}));
        },
        "logs" => do_reveal_logs_dir(&app),
        "changelog" => app.opener().open_url("https://github.com/sso-ss/ModelRelay/releases", None::<&str>)
            .map_err(|_| "Could not open changelog")?,
        "documentation" => app.opener().open_url("https://github.com/sso-ss/ModelRelay#readme", None::<&str>)
            .map_err(|_| "Could not open documentation")?,
        "sign-out" => sign_out(&app).await?,
        _ => return Err("Unknown companion action".into()),
    }
    Ok(())
}

fn has_active_work(data: &Value) -> bool {
    data.pointer("/activity/activeRequests").and_then(Value::as_array)
        .is_some_and(|requests| !requests.is_empty())
        || data.pointer("/activity/activity").and_then(Value::as_array)
            .is_some_and(|entries| entries.iter().any(|entry|
                entry.get("activeRequests").and_then(Value::as_u64).unwrap_or(0) > 0))
        || data.pointer("/tasks/tasks").and_then(Value::as_array)
            .is_some_and(|tasks| tasks.iter().any(|task|
                matches!(task.get("status").and_then(Value::as_str), Some("running" | "waiting"))))
}

async fn sign_out(app: &AppHandle) -> Result<(), String> {
    // Recheck current gateway activity after the UI confirmation. This protects
    // observed requests and tasks, including tasks waiting for input.
    let data = companion_data(app.clone()).await?;
    if has_active_work(&data) { return Err("Work is still in progress".into()); }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()
        .map_err(|_| "Sign out failed")?;
    let response = client.post(format!("http://127.0.0.1:{SIDECAR_PORT}/settings/api/auth/github/sign-out"))
        .header("x-api-key", app.state::<ShellApiKey>().value())
        .send().await.map_err(|_| "Sign out failed")?
        .error_for_status().map_err(|_| "Sign out failed")?;
    let result: Value = response.json().await.map_err(|_| "Sign out failed")?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) { return Err("Sign out failed".into()); }
    respawn_sidecar(app);
    let _ = app.emit("companion:stream", json!({"kind": "refresh"}));
    Ok(())
}

#[tauri::command]
pub fn companion_boot(app: AppHandle) -> Value {
    json!({"state": boot_state(app.state::<AppStatus>().get()), "locale": app.state::<LocaleState>().get()})
}

pub(super) fn boot_state(state: SidecarState) -> &'static str {
    match state {
        SidecarState::Starting => "starting",
        SidecarState::Failed | SidecarState::Stopped => "unavailable",
        _ => "ready",
    }
}

#[tauri::command]
pub async fn companion_data(app: AppHandle) -> Result<Value, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()
        .map_err(|_| "Gateway unavailable")?;
    let response = client.get(format!("http://127.0.0.1:{SIDECAR_PORT}/settings/api/companion"))
        .header("x-api-key", app.state::<ShellApiKey>().value())
        .send().await.map_err(|_| "Gateway unavailable")?
        .error_for_status().map_err(|_| "Gateway unavailable")?;
    response.json().await.map_err(|_| "Invalid gateway response".into())
}

// Restrict mutations to existing integration toggles and named-key enablement.
// Never accept a caller-supplied URL, arbitrary method, or secret-bearing body.
fn toggle_target(id: &str) -> Result<(reqwest::Method, String), String> {
    if matches!(id, "claude-code" | "claude-desktop" | "codex") {
        return Ok((reqwest::Method::POST, format!("apps/{id}/toggle")));
    }
    if let Some(key) = id.strip_prefix("key:") {
        if !key.is_empty() && key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
            return Ok((reqwest::Method::PATCH, format!("api-keys/{key}")));
        }
    }
    Err("Unknown connection".into())
}

#[tauri::command]
pub async fn companion_toggle(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let (method, path) = toggle_target(&id)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build()
        .map_err(|_| "Connection change failed")?;
    let response = client.request(method, format!("http://127.0.0.1:{SIDECAR_PORT}/settings/api/{path}"))
        .header("x-api-key", app.state::<ShellApiKey>().value())
        .json(&json!({"enabled": enabled}))
        .send().await.map_err(|_| "gateway-unavailable")?;
    // Key mutations return the key value. Consume it only in native code;
    // emit neither the response nor upstream error text into the pet/panel.
    let status = response.status();
    let body: Value = response.json().await.map_err(|_| "Connection change failed")?;
    validate_toggle_response(&id, enabled, status, &body)?;
    let _ = app.emit("companion:stream", json!({"kind": "refresh"}));
    Ok(())
}

fn validate_toggle_response(id: &str, enabled: bool, status: reqwest::StatusCode, body: &Value) -> Result<(), String> {
    if status.is_success() && body.get("enabled").and_then(Value::as_bool) == Some(enabled) {
        return Ok(());
    }
    if id == "claude-code" {
        if status == reqwest::StatusCode::CONFLICT {
            if let Some(code @ ("claude-code-foreign-base-url" | "claude-code-foreign-api-key-helper"
                | "claude-code-missing-api-key" | "claude-code-not-installed")) = body["error"]["type"].as_str() {
                return Err(code.into());
            }
        }
        // Older sidecars returned HTTP 200 even when an enable was refused.
        if status.is_success() && enabled {
            match body["conflict"].as_str() {
                Some("foreign-base-url") => return Err("claude-code-foreign-base-url".into()),
                Some("foreign-api-key-helper") => return Err("claude-code-foreign-api-key-helper".into()),
                _ => {}
            }
        }
    }
    Err("Connection change failed".into())
}

async fn watch_activity(app: AppHandle) {
    let Ok(client) = reqwest::Client::builder().connect_timeout(Duration::from_secs(3)).build() else { return };
    loop {
        let _ = stream_activity(&app, &client).await;
        let _ = app.emit("companion:stream", json!({"kind": "unavailable"}));
        clamp_pet(&app);
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn stream_activity(app: &AppHandle, client: &reqwest::Client) -> Result<(), ()> {
    let mut response = client.get(format!("http://127.0.0.1:{SIDECAR_PORT}/settings/api/events"))
        .header("x-api-key", app.state::<ShellApiKey>().value())
        .send().await.map_err(|_| ())?.error_for_status().map_err(|_| ())?;
    let mut buffer = Vec::new();
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(25), response.chunk()).await
            .map_err(|_| ())?.map_err(|_| ())?.ok_or(())?;
        buffer.extend_from_slice(&chunk);
        if buffer.len() > 2_000_000 { return Err(()); }
        while let Some(end) = buffer.windows(2).position(|bytes| bytes == b"\n\n") {
            let frame = String::from_utf8_lossy(&buffer[..end]).into_owned();
            buffer.drain(..end + 2);
            let kind = frame.lines().find_map(|line| line.strip_prefix("event: ")).unwrap_or("");
            if matches!(kind, "auth.changed" | "connections.changed") {
                let _ = app.emit("companion:stream", json!({"kind": "refresh"}));
            } else if matches!(kind, "activity.snapshot" | "activity.request" | "tasks.snapshot" | "tasks.event") {
                if let Some(data) = frame.lines().find_map(|line| line.strip_prefix("data: ")) {
                    if let Ok(data) = serde_json::from_str::<Value>(data) {
                        let _ = app.emit("companion:stream", json!({"kind": kind, "data": data}));
                    }
                }
            } else if kind == "ping" {
                clamp_pet(app);
                let _ = app.emit("companion:stream", json!({"kind": "ping"}));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{has_active_work, toggle_target, validate_toggle_response};
    use reqwest::StatusCode;
    use serde_json::json;

    #[test]
    fn sign_out_checks_both_request_and_summary_activity() {
        assert!(!has_active_work(&json!({"activity":{"activeRequests":[],"activity":[]}})));
        assert!(has_active_work(&json!({"activity":{"activeRequests":[{"requestId":"r1"}],"activity":[]}})));
        assert!(has_active_work(&json!({"activity":{"activeRequests":[],"activity":[{"activeRequests":1}]}})));
        assert!(!has_active_work(&json!({"activity":{"activeRequests":[],"activity":[{"activeRequests":0}]}})));
    }

    #[test]
    fn sign_out_protects_task_gaps_and_input_waits() {
        for status in ["running", "waiting"] {
            assert!(has_active_work(&json!({"tasks":{"tasks":[{"status":status}]}})));
        }
        assert!(!has_active_work(&json!({"tasks":{"tasks":[{"status":"completed"}]}})));
    }

    #[test]
    fn toggle_paths_are_limited_to_connections() {
        assert_eq!(toggle_target("codex").unwrap(), (reqwest::Method::POST, "apps/codex/toggle".into()));
        assert_eq!(toggle_target("key:client-1").unwrap(), (reqwest::Method::PATCH, "api-keys/client-1".into()));
        for id in ["key:", "key:../enforce", "key:client?x=1", "accounts", "copilot-cli"] {
            assert!(toggle_target(id).is_err());
        }
    }

    #[test]
    fn toggle_failures_expose_only_allowlisted_codes() {
        for code in ["claude-code-foreign-base-url", "claude-code-foreign-api-key-helper",
            "claude-code-missing-api-key", "claude-code-not-installed"] {
            let body = json!({"error":{"type":code,"message":"secret"},"key":"secret"});
            assert_eq!(validate_toggle_response("claude-code", true, StatusCode::CONFLICT, &body).unwrap_err(), code);
            assert_eq!(validate_toggle_response("key:client", true, StatusCode::CONFLICT, &body).unwrap_err(), "Connection change failed");
        }
        for body in [json!({"error":{"type":"secret","message":"secret"}}),
            json!({"enabled":false,"key":"secret"}), json!({}), json!(null)] {
            assert_eq!(validate_toggle_response("claude-code", true, StatusCode::CONFLICT, &body).unwrap_err(), "Connection change failed");
        }
        assert!(validate_toggle_response("key:client", true, StatusCode::OK, &json!({"enabled":true,"key":"secret"})).is_ok());
        assert!(validate_toggle_response("claude-code", true, StatusCode::INTERNAL_SERVER_ERROR, &json!({"enabled":true})).is_err());
    }

    #[test]
    fn older_sidecar_refusals_remain_actionable() {
        let body = json!({"enabled":false,"conflict":"foreign-base-url"});
        assert_eq!(validate_toggle_response("claude-code", true, StatusCode::OK, &body).unwrap_err(), "claude-code-foreign-base-url");
        assert!(validate_toggle_response("claude-code", false, StatusCode::OK, &body).is_ok());
    }
}
