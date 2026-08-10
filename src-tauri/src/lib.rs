mod desktop;
mod library;
mod lyrics;
mod player;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            library::list_library_folders,
            library::remove_library_folder,
            library::scan_music_folder,
            library::set_track_favorite,
            library::get_playback_queue,
            library::save_playback_queue,
            library::get_playback_state,
            library::save_playback_state,
            library::get_recent_tracks,
            library::record_recent_track,
            library::save_recent_tracks,
            library::get_library_cache_info,
            library::clear_library_cache,
            library::get_app_settings,
            library::list_playlists,
            library::create_playlist,
            library::rename_playlist,
            library::delete_playlist,
            library::add_track_to_playlist,
            library::remove_track_from_playlist,
            library::reorder_playlist,
            desktop::set_app_settings,
            desktop::open_app_data_directory,
            lyrics::get_track_lyrics,
            player::player_load,
            player::player_play,
            player::player_pause,
            player::player_seek,
            player::player_set_volume,
            player::player_set_equalizer,
            player::player_stop,
            player::player_get_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
