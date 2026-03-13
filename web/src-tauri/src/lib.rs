use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

struct TrayState {
  _tray: Mutex<Option<TrayIcon>>,
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
  CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_badge_count(_app: AppHandle, _count: i32) -> Result<(), String> {
  // Badge API varies by platform/runtime. Keep command stable and no-op when
  // native badge support is unavailable.
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
      request_app_restart
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
