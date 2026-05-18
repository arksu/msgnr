#[cfg(target_os = "macos")]
mod platform {
  use block2::RcBlock;
  use objc2::runtime::AnyObject;
  use objc2::{class, msg_send, sel};
  use serde::Serialize;
  use tauri::{AppHandle, Emitter};

  #[link(name = "MediaPlayer", kind = "framework")]
  extern "C" {}

  #[derive(Clone, Serialize)]
  struct HardwareCallControlPayload {
    action: String,
  }

  fn emit_action(app: &AppHandle, action: &str) {
    let _ = app.emit(
      "hardware-call-control",
      HardwareCallControlPayload {
        action: action.to_string(),
      },
    );
  }

  unsafe fn enable_command(command: *mut AnyObject, app: AppHandle, action: &'static str) {
    if command.is_null() {
      return;
    }

    let _: () = msg_send![command, setEnabled: true];
    let block = RcBlock::new(move |_event: *mut AnyObject| -> isize {
      emit_action(&app, action);
      0
    });
    let _: *mut AnyObject = msg_send![command, addTargetWithHandler: &*block];
  }

  unsafe fn clear_command(command: *mut AnyObject) {
    if command.is_null() {
      return;
    }

    let _: () = msg_send![command, removeTarget: std::ptr::null_mut::<AnyObject>()];
    let _: () = msg_send![command, setEnabled: false];
  }

  macro_rules! enable_if_available {
    ($center:expr, $selector:ident, $app:expr, $action:expr) => {{
      let responds: bool = unsafe { msg_send![$center, respondsToSelector: sel!($selector)] };
      if responds {
        let command: *mut AnyObject = unsafe { msg_send![$center, $selector] };
        unsafe { enable_command(command, $app.clone(), $action) };
      }
    }};
  }

  macro_rules! clear_if_available {
    ($center:expr, $selector:ident) => {{
      let responds: bool = unsafe { msg_send![$center, respondsToSelector: sel!($selector)] };
      if responds {
        let command: *mut AnyObject = unsafe { msg_send![$center, $selector] };
        unsafe { clear_command(command) };
      }
    }};
  }

  pub fn set_active(app: AppHandle, _title: String, _microphone_active: bool) -> Result<(), String> {
    let center: *mut AnyObject = unsafe { msg_send![class!(MPRemoteCommandCenter), sharedCommandCenter] };
    if center.is_null() {
      return Err("MPRemoteCommandCenter is unavailable.".to_string());
    }

    clear_all(center);

    enable_if_available!(center, endCallCommand, app, "hangup");
    enable_if_available!(center, hangupCommand, app, "hangup");
    enable_if_available!(center, pauseCommand, app, "hangup");
    enable_if_available!(center, stopCommand, app, "hangup");
    enable_if_available!(center, togglePlayPauseCommand, app, "hangup");
    enable_if_available!(center, toggleMicrophoneCommand, app, "toggle-microphone");
    enable_if_available!(center, toggleMuteCommand, app, "toggle-microphone");

    Ok(())
  }

  pub fn clear() -> Result<(), String> {
    let center: *mut AnyObject = unsafe { msg_send![class!(MPRemoteCommandCenter), sharedCommandCenter] };
    if center.is_null() {
      return Ok(());
    }
    clear_all(center);
    Ok(())
  }

  fn clear_all(center: *mut AnyObject) {
    clear_if_available!(center, endCallCommand);
    clear_if_available!(center, hangupCommand);
    clear_if_available!(center, pauseCommand);
    clear_if_available!(center, stopCommand);
    clear_if_available!(center, togglePlayPauseCommand);
    clear_if_available!(center, toggleMicrophoneCommand);
    clear_if_available!(center, toggleMuteCommand);
  }
}

#[cfg(not(target_os = "macos"))]
mod platform {
  use tauri::AppHandle;

  pub fn set_active(_app: AppHandle, _title: String, _microphone_active: bool) -> Result<(), String> {
    Ok(())
  }

  pub fn clear() -> Result<(), String> {
    Ok(())
  }
}

pub fn set_active(app: tauri::AppHandle, title: String, microphone_active: bool) -> Result<(), String> {
  platform::set_active(app, title, microphone_active)
}

pub fn clear() -> Result<(), String> {
  platform::clear()
}
