use std::{
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime, State, WindowEvent,
};

pub struct DesktopPreferences {
    close_to_tray: AtomicBool,
}

impl DesktopPreferences {
    pub fn new(close_to_tray: bool) -> Self {
        Self {
            close_to_tray: AtomicBool::new(close_to_tray),
        }
    }
}

#[tauri::command]
pub fn set_app_settings(
    close_to_tray: bool,
    restore_playback: bool,
    preferences: State<'_, DesktopPreferences>,
    app: AppHandle,
) -> Result<(), String> {
    crate::library::persist_app_settings(&app, close_to_tray, restore_playback)?;
    preferences
        .close_to_tray
        .store(close_to_tray, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn open_app_data_directory(app: AppHandle) -> Result<(), String> {
    let directory = crate::library::app_data_directory(&app)?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command
        .arg(directory)
        .spawn()
        .map_err(|error| format!("无法打开数据目录：{error}"))?;
    Ok(())
}

pub fn setup_tray<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开泡面音乐", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "play-pause", "播放 / 暂停", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &play_pause, &previous, &next, &separator, &quit],
    )?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("default icon").clone())
        .tooltip("泡面音乐")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "play-pause" | "previous" | "next" => {
                let _ = app.emit("media-command", event.id.as_ref());
            }
            "quit" => app.exit(0),
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

    if let Some(window) = app.get_webview_window("main") {
        let window_to_hide = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window_to_hide
                    .app_handle()
                    .state::<DesktopPreferences>()
                    .close_to_tray
                    .load(Ordering::Relaxed);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window_to_hide.hide();
                }
            }
        });
    }
    Ok(())
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
