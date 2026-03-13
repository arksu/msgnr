use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Position, Size, WebviewUrl, WindowEvent};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

struct TrayState {
  _tray: Mutex<Option<TrayIcon>>,
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
  CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_badge_count(app: AppHandle, count: i32) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found".to_string())?;

  if count <= 0 {
    window.set_badge_count(None).map_err(|err| err.to_string())?;
  } else {
    window
      .set_badge_count(Some(i64::from(count)))
      .map_err(|err| err.to_string())?;
  }

  Ok(())
}

#[tauri::command]
fn play_sound(_sound_id: String) -> Result<bool, String> {
  // Placeholder for native sound routing. The web layer falls back to HTMLAudio
  // where applicable.
  Ok(false)
}

#[tauri::command]
fn show_notification(_title: String, _body: String, _icon: Option<String>) -> Result<(), String> {
  // Fallback command path when JS notification bridge is unavailable.
  Ok(())
}

#[tauri::command]
fn set_tray_title(_title: String) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
fn set_tray_tooltip(_tooltip: String) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
fn keyring_get(key: String) -> Result<Option<String>, String> {
  let entry = keyring::Entry::new("msgnr", &key).map_err(|err| err.to_string())?;
  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(err) => Err(err.to_string()),
  }
}

#[tauri::command]
fn keyring_set(key: String, value: String) -> Result<(), String> {
  let entry = keyring::Entry::new("msgnr", &key).map_err(|err| err.to_string())?;
  entry.set_password(&value).map_err(|err| err.to_string())
}

#[tauri::command]
fn keyring_delete(key: String) -> Result<(), String> {
  let entry = keyring::Entry::new("msgnr", &key).map_err(|err| err.to_string())?;
  match entry.delete_credential() {
    Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(err) => Err(err.to_string()),
  }
}

#[tauri::command]
fn request_app_restart(app: AppHandle) -> Result<(), String> {
  app.request_restart();
  Ok(())
}

fn normalize_overlay_label(overlay_label: Option<String>) -> String {
  let trimmed = overlay_label.unwrap_or_else(|| "annotation_overlay".to_string());
  if trimmed.trim().is_empty() {
    "annotation_overlay".to_string()
  } else {
    trimmed
  }
}

fn parse_display_index(share_label: &str) -> Option<usize> {
  let mut digits = String::new();
  for ch in share_label.chars() {
    if ch.is_ascii_digit() {
      digits.push(ch);
      continue;
    }
    if !digits.is_empty() {
      break;
    }
  }
  if digits.is_empty() {
    return None;
  }
  let parsed = digits.parse::<usize>().ok()?;
  parsed.checked_sub(1)
}

fn resolve_overlay_window(app: &AppHandle, overlay_label: &str) -> Result<tauri::WebviewWindow, String> {
  if let Some(existing) = app.get_webview_window(overlay_label) {
    return Ok(existing);
  }

  let mut builder = tauri::WebviewWindowBuilder::new(app, overlay_label, WebviewUrl::App("overlay.html".into()))
    .title("Msgnr Annotation Overlay")
    .disable_drag_drop_handler()
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .visible(false)
    .skip_taskbar(true);

  #[cfg(any(not(target_os = "macos"), feature = "macos-private-api"))]
  {
    builder = builder.transparent(true);
  }

  builder
    .build()
    .map_err(|err| err.to_string())
}

fn fit_overlay_to_monitor(app: &AppHandle, overlay: &tauri::WebviewWindow, share_label: &str) -> Result<(), String> {
  let main_window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found".to_string())?;

  let monitors = main_window.available_monitors().map_err(|err| err.to_string())?;
  let mut chosen = None;

  if let Some(index) = parse_display_index(share_label) {
    if let Some(monitor) = monitors.get(index) {
      chosen = Some(monitor.clone());
    }
  }

  if chosen.is_none() {
    chosen = main_window
      .primary_monitor()
      .map_err(|err| err.to_string())?;
  }

  let monitor = chosen.ok_or_else(|| "no monitor available".to_string())?;
  overlay
    .set_position(Position::Physical(*monitor.position()))
    .map_err(|err| err.to_string())?;
  overlay
    .set_size(Size::Physical(*monitor.size()))
    .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn annotation_overlay_show(app: AppHandle, overlay_label: Option<String>, share_label: Option<String>) -> Result<(), String> {
  let label = normalize_overlay_label(overlay_label);
  let overlay = resolve_overlay_window(&app, &label)?;
  let _ = overlay.set_ignore_cursor_events(true);
  let _ = overlay.set_always_on_top(true);
  fit_overlay_to_monitor(&app, &overlay, share_label.unwrap_or_default().as_str())?;
  overlay.show().map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn annotation_overlay_hide(app: AppHandle, overlay_label: Option<String>) -> Result<(), String> {
  let label = normalize_overlay_label(overlay_label);
  if let Some(window) = app.get_webview_window(&label) {
    let _ = window.eval("window.__overlayClear?.();");
    let _ = window.hide();
  }
  Ok(())
}

#[tauri::command]
fn annotation_overlay_clear(app: AppHandle, overlay_label: Option<String>) -> Result<(), String> {
  let label = normalize_overlay_label(overlay_label);
  if let Some(window) = app.get_webview_window(&label) {
    window
      .eval("window.__overlayClear?.();")
      .map_err(|err| err.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn annotation_overlay_push_segment(
  app: AppHandle,
  overlay_label: Option<String>,
  segment_json: String,
) -> Result<(), String> {
  let label = normalize_overlay_label(overlay_label);
  let window = resolve_overlay_window(&app, &label)?;
  let arg_literal = serde_json::to_string(&segment_json).map_err(|err| err.to_string())?;
  let script = format!("window.__overlayPushSegmentFromJson?.({arg_literal});");
  window.eval(script.as_str()).map_err(|err| err.to_string())
}

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
  let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
  let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
  let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

  TrayIconBuilder::new()
    .tooltip("Msgnr")
    .menu(&menu)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => show_main_window(app),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::DoubleClick { .. } = event {
        show_main_window(tray.app_handle());
      }
    })
    .build(app)
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      let tray = build_tray(app.handle())?;
      app.manage(TrayState {
        _tray: Mutex::new(Some(tray)),
      });
      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() != "main" {
        return;
      }

      if let WindowEvent::CloseRequested { api, .. } = event {
        if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      set_close_to_tray,
      set_badge_count,
      play_sound,
      show_notification,
      set_tray_title,
      set_tray_tooltip,
      keyring_get,
      keyring_set,
      keyring_delete,
      request_app_restart,
      annotation_overlay_show,
      annotation_overlay_hide,
      annotation_overlay_clear,
      annotation_overlay_push_segment
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
