mod desktop;
mod library;
mod lyrics;
mod player;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let action = if shortcut == &Shortcut::new(None, Code::MediaPlayPause) {
                        Some("play-pause")
                    } else if shortcut == &Shortcut::new(None, Code::MediaTrackNext) {
                        Some("next")
                    } else if shortcut == &Shortcut::new(None, Code::MediaTrackPrevious) {
                        Some("previous")
                    } else {
                        None
                    };
                    if let Some(action) = action {
                        let _ = app.emit("media-command", action);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            library::initialize(app.handle()).map_err(std::io::Error::other)?;
            let app_settings =
                library::load_app_settings(app.handle()).map_err(std::io::Error::other)?;
            app.manage(desktop::DesktopPreferences::new(app_settings.close_to_tray));
            let watcher =
                watcher::LibraryWatcher::new(app.handle()).map_err(std::io::Error::other)?;
            app.manage(watcher);
            app.manage(player::PlayerService::default());
            player::start_state_emitter(app.handle().clone());
            desktop::setup_tray(app)?;
            for shortcut in [
                Shortcut::new(None, Code::MediaPlayPause),
                Shortcut::new(None, Code::MediaTrackNext),
                Shortcut::new(None, Code::MediaTrackPrevious),
            ] {
                if let Err(error) = app.global_shortcut().register(shortcut) {
                    log::warn!("media shortcut registration failed: {error}");
                }
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::get_library_tracks,
            library::get_library_folders,
            library::scan_music_folder,
            library::set_track_favorite,
            library::get_playback_queue,
            library::save_playback_queue,
            library::get_playback_state,
            library::save_playback_state,
            library::get_app_settings,
            library::list_playlists,
            library::create_playlist,
            library::rename_playlist,
            library::delete_playlist,
            library::add_track_to_playlist,
            library::remove_track_from_playlist,
            library::reorder_playlist,
            desktop::set_app_settings,
            lyrics::get_track_lyrics,
            player::player_load,
            player::player_play,
            player::player_pause,
            player::player_seek,
            player::player_set_volume,
            player::player_stop,
            player::player_get_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
