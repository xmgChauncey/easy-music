use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::Accessor,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "aac", "m4a", "ogg"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u64,
    pub format: String,
    pub year: Option<u32>,
    pub cover: String,
    pub path: String,
    pub favorite: bool,
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStateDto {
    pub track_id: Option<String>,
    pub position: f64,
    pub volume: f32,
    pub repeat_mode: String,
    pub shuffle: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDto {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub close_to_tray: bool,
    pub restore_playback: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    processed: usize,
    total: usize,
    current_path: String,
}

struct ParsedTrack {
    title: String,
    artist: String,
    album: String,
    duration: u64,
    cover: Option<String>,
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let connection = open_database(app)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;

             CREATE TABLE IF NOT EXISTS library_folders (
               path TEXT PRIMARY KEY,
               added_at INTEGER NOT NULL,
               last_scanned_at INTEGER
             );

             CREATE TABLE IF NOT EXISTS tracks (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               path TEXT NOT NULL UNIQUE,
               folder_path TEXT NOT NULL,
               file_size INTEGER NOT NULL,
               modified_at INTEGER NOT NULL,
               title TEXT NOT NULL,
               artist TEXT NOT NULL,
               album TEXT NOT NULL,
               duration INTEGER NOT NULL DEFAULT 0,
               format TEXT NOT NULL,
               cover TEXT,
               favorite INTEGER NOT NULL DEFAULT 0,
               valid INTEGER NOT NULL DEFAULT 1,
               last_seen_at INTEGER NOT NULL,
               FOREIGN KEY(folder_path) REFERENCES library_folders(path) ON DELETE CASCADE
             );

             CREATE INDEX IF NOT EXISTS tracks_title_idx ON tracks(title);
             CREATE INDEX IF NOT EXISTS tracks_artist_idx ON tracks(artist);
             CREATE INDEX IF NOT EXISTS tracks_album_idx ON tracks(album);
             CREATE INDEX IF NOT EXISTS tracks_folder_idx ON tracks(folder_path);",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS playback_queue (
               position INTEGER PRIMARY KEY,
               track_id INTEGER NOT NULL UNIQUE,
               added_at INTEGER NOT NULL,
               FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS playback_state (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               track_id INTEGER,
               position REAL NOT NULL DEFAULT 0,
               volume REAL NOT NULL DEFAULT 0.72,
               repeat_mode TEXT NOT NULL DEFAULT 'all',
               shuffle INTEGER NOT NULL DEFAULT 0,
               updated_at INTEGER NOT NULL,
               FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE SET NULL
             );

             CREATE TABLE IF NOT EXISTS playlists (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );

             CREATE TABLE IF NOT EXISTS playlist_tracks (
               playlist_id INTEGER NOT NULL,
               track_id INTEGER NOT NULL,
               position INTEGER NOT NULL,
               PRIMARY KEY(playlist_id, track_id),
               FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
               FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
             );

             CREATE INDEX IF NOT EXISTS playlist_tracks_position_idx
               ON playlist_tracks(playlist_id, position);

             CREATE TABLE IF NOT EXISTS app_settings (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               close_to_tray INTEGER NOT NULL DEFAULT 1,
               restore_playback INTEGER NOT NULL DEFAULT 1
             );

             INSERT OR IGNORE INTO app_settings(singleton, close_to_tray, restore_playback)
               VALUES (1, 1, 1);",
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_app_settings(app: &AppHandle) -> Result<AppSettingsDto, String> {
    let connection = open_database(app)?;
    connection
        .query_row(
            "SELECT close_to_tray, restore_playback FROM app_settings WHERE singleton = 1",
            [],
            |row| {
                Ok(AppSettingsDto {
                    close_to_tray: row.get::<_, i64>(0)? != 0,
                    restore_playback: row.get::<_, i64>(1)? != 0,
                })
            },
        )
        .map_err(|error| error.to_string())
}

pub fn persist_app_settings(
    app: &AppHandle,
    close_to_tray: bool,
    restore_playback: bool,
) -> Result<(), String> {
    let connection = open_database(app)?;
    connection
        .execute(
            "INSERT INTO app_settings(singleton, close_to_tray, restore_playback)
             VALUES (1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE SET
               close_to_tray = excluded.close_to_tray,
               restore_playback = excluded.restore_playback",
            params![close_to_tray as i64, restore_playback as i64],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettingsDto, String> {
    load_app_settings(&app)
}

#[tauri::command]
pub fn list_playlists(app: AppHandle) -> Result<Vec<PlaylistDto>, String> {
    let connection = open_database(&app)?;
    query_playlists(&connection)
}

#[tauri::command]
pub fn create_playlist(name: String, app: AppHandle) -> Result<PlaylistDto, String> {
    let name = playlist_name(&name)?;
    let connection = open_database(&app)?;
    let timestamp = unix_timestamp(SystemTime::now());
    connection
        .execute(
            "INSERT INTO playlists(name, created_at, updated_at) VALUES (?1, ?2, ?2)",
            params![name, timestamp],
        )
        .map_err(|error| error.to_string())?;
    Ok(PlaylistDto {
        id: format!("playlist-{}", connection.last_insert_rowid()),
        name,
        track_ids: Vec::new(),
    })
}

#[tauri::command]
pub fn rename_playlist(playlist_id: String, name: String, app: AppHandle) -> Result<(), String> {
    let id = parse_playlist_id(&playlist_id)?;
    let name = playlist_name(&name)?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "UPDATE playlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, unix_timestamp(SystemTime::now())],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_playlist(playlist_id: String, app: AppHandle) -> Result<(), String> {
    let id = parse_playlist_id(&playlist_id)?;
    let connection = open_database(&app)?;
    connection
        .execute("DELETE FROM playlists WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_track_to_playlist(
    playlist_id: String,
    track_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let playlist_id = parse_playlist_id(&playlist_id)?;
    let track_id = parse_track_id(&track_id)?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position)
             SELECT ?1, ?2, COALESCE(MAX(position), -1) + 1
             FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id, track_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_track_from_playlist(
    playlist_id: String,
    track_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let playlist_id = parse_playlist_id(&playlist_id)?;
    let track_id = parse_track_id(&track_id)?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_playlist(
    playlist_id: String,
    track_ids: Vec<String>,
    app: AppHandle,
) -> Result<(), String> {
    let playlist_id = parse_playlist_id(&playlist_id)?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            [playlist_id],
        )
        .map_err(|error| error.to_string())?;
    for (position, track_id) in track_ids.iter().enumerate() {
        if let Ok(track_id) = parse_track_id(track_id) {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position)
                     SELECT ?1, id, ?3 FROM tracks WHERE id = ?2",
                    params![playlist_id, track_id, position as i64],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_track_favorite(track_id: String, favorite: bool, app: AppHandle) -> Result<(), String> {
    let id = parse_track_id(&track_id)?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "UPDATE tracks SET favorite = ?2 WHERE id = ?1",
            params![id, favorite as i64],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_playback_queue(app: AppHandle) -> Result<Vec<String>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT q.track_id FROM playback_queue q
             JOIN tracks t ON t.id = q.track_id
             WHERE t.valid = 1 ORDER BY q.position",
        )
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(ids.into_iter().map(|id| format!("db-{id}")).collect())
}

#[tauri::command]
pub fn save_playback_queue(track_ids: Vec<String>, app: AppHandle) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM playback_queue", [])
        .map_err(|error| error.to_string())?;
    let timestamp = unix_timestamp(SystemTime::now());
    for (position, track_id) in track_ids.iter().enumerate() {
        if let Ok(id) = parse_track_id(track_id) {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO playback_queue(position, track_id, added_at)
                     SELECT ?1, id, ?3 FROM tracks WHERE id = ?2 AND valid = 1",
                    params![position as i64, id, timestamp],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_playback_state(app: AppHandle) -> Result<PlaybackStateDto, String> {
    let connection = open_database(&app)?;
    connection
        .query_row(
            "SELECT track_id, position, volume, repeat_mode, shuffle
             FROM playback_state WHERE singleton = 1",
            [],
            |row| {
                let track_id: Option<i64> = row.get(0)?;
                Ok(PlaybackStateDto {
                    track_id: track_id.map(|id| format!("db-{id}")),
                    position: row.get(1)?,
                    volume: row.get(2)?,
                    repeat_mode: row.get(3)?,
                    shuffle: row.get::<_, i64>(4)? != 0,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(Ok)
        .unwrap_or_else(|| {
            Ok(PlaybackStateDto {
                track_id: None,
                position: 0.0,
                volume: 0.72,
                repeat_mode: "all".into(),
                shuffle: false,
            })
        })
}

#[tauri::command]
pub fn save_playback_state(
    track_id: Option<String>,
    position: f64,
    volume: f32,
    repeat_mode: String,
    shuffle: bool,
    app: AppHandle,
) -> Result<(), String> {
    let id = track_id
        .as_deref()
        .and_then(|value| parse_track_id(value).ok());
    let connection = open_database(&app)?;
    connection
        .execute(
            "INSERT INTO playback_state(
               singleton, track_id, position, volume, repeat_mode, shuffle, updated_at
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(singleton) DO UPDATE SET
               track_id = excluded.track_id,
               position = excluded.position,
               volume = excluded.volume,
               repeat_mode = excluded.repeat_mode,
               shuffle = excluded.shuffle,
               updated_at = excluded.updated_at",
            params![
                id,
                position.max(0.0),
                volume.clamp(0.0, 1.0),
                repeat_mode,
                shuffle as i64,
                unix_timestamp(SystemTime::now()),
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_library_tracks(app: AppHandle) -> Result<Vec<TrackDto>, String> {
    let connection = open_database(&app)?;
    query_tracks(&connection)
}

#[tauri::command]
pub fn get_library_folders(app: AppHandle) -> Result<Vec<String>, String> {
    managed_folders(&app)
}

pub fn managed_folders(app: &AppHandle) -> Result<Vec<String>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare("SELECT path FROM library_folders ORDER BY added_at")
        .map_err(|error| error.to_string())?;
    let paths = statement
        .query_map([], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(paths)
}

#[tauri::command]
pub async fn scan_music_folder(path: String, app: AppHandle) -> Result<Vec<TrackDto>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_folder(&app, &path))
        .await
        .map_err(|error| error.to_string())?
}

fn scan_folder(app: &AppHandle, folder: &str) -> Result<Vec<TrackDto>, String> {
    let folder_path = fs::canonicalize(folder).map_err(|error| error.to_string())?;
    if !folder_path.is_dir() {
        return Err("选择的路径不是文件夹".into());
    }
    app.state::<crate::watcher::LibraryWatcher>()
        .watch_folder(&folder_path)?;
    let folder_text = path_text(&folder_path);
    let scan_time = unix_timestamp(SystemTime::now());
    let mut connection = open_database(app)?;
    connection
        .execute(
            "INSERT INTO library_folders(path, added_at, last_scanned_at)
             VALUES (?1, ?2, ?2)
             ON CONFLICT(path) DO UPDATE SET last_scanned_at = excluded.last_scanned_at",
            params![folder_text, scan_time],
        )
        .map_err(|error| error.to_string())?;

    let audio_paths: Vec<PathBuf> = WalkDir::new(&folder_path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_supported(entry.path()))
        .map(|entry| entry.into_path())
        .collect();

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE tracks SET valid = 0 WHERE folder_path = ?1",
            [&folder_text],
        )
        .map_err(|error| error.to_string())?;

    for (index, audio_path) in audio_paths.iter().enumerate() {
        let _ = app.emit(
            "library-scan-progress",
            ScanProgress {
                processed: index,
                total: audio_paths.len(),
                current_path: path_text(audio_path),
            },
        );
        index_track(&transaction, audio_path, &folder_text, scan_time)?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    let _ = app.emit(
        "library-scan-progress",
        ScanProgress {
            processed: audio_paths.len(),
            total: audio_paths.len(),
            current_path: String::new(),
        },
    );
    query_tracks(&connection)
}

fn index_track(
    connection: &Connection,
    path: &Path,
    folder: &str,
    scan_time: i64,
) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let file_size = metadata.len() as i64;
    let modified_at = metadata.modified().map(unix_timestamp).unwrap_or_default();
    let path_string = path_text(path);
    let existing = connection
        .query_row(
            "SELECT file_size, modified_at FROM tracks WHERE path = ?1",
            [&path_string],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if existing == Some((file_size, modified_at)) {
        connection
            .execute(
                "UPDATE tracks SET valid = 1, last_seen_at = ?2 WHERE path = ?1",
                params![path_string, scan_time],
            )
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let parsed = parse_metadata(path);
    let format = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("audio")
        .to_uppercase();

    connection
        .execute(
            "INSERT INTO tracks(
               path, folder_path, file_size, modified_at, title, artist, album,
               duration, format, cover, valid, last_seen_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11)
             ON CONFLICT(path) DO UPDATE SET
               folder_path = excluded.folder_path,
               file_size = excluded.file_size,
               modified_at = excluded.modified_at,
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               duration = excluded.duration,
               format = excluded.format,
               cover = excluded.cover,
               valid = 1,
               last_seen_at = excluded.last_seen_at",
            params![
                path_string,
                folder,
                file_size,
                modified_at,
                parsed.title,
                parsed.artist,
                parsed.album,
                parsed.duration as i64,
                format,
                parsed.cover,
                scan_time,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn parse_metadata(path: &Path) -> ParsedTrack {
    let fallback_title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("未知歌曲")
        .to_string();
    let Ok(tagged_file) = lofty::read_from_path(path) else {
        return ParsedTrack {
            title: fallback_title,
            artist: "未知歌手".into(),
            album: "未知专辑".into(),
            duration: 0,
            cover: None,
        };
    };
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    let title = tag
        .and_then(|value| value.title())
        .map(|value| value.into_owned())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_title);
    let artist = tag
        .and_then(|value| value.artist())
        .map(|value| value.into_owned())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "未知歌手".into());
    let album = tag
        .and_then(|value| value.album())
        .map(|value| value.into_owned())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "未知专辑".into());
    let cover = tag.and_then(extract_cover);
    ParsedTrack {
        title,
        artist,
        album,
        duration: tagged_file.properties().duration().as_secs(),
        cover,
    }
}

fn extract_cover(tag: &lofty::tag::Tag) -> Option<String> {
    let picture = tag.pictures().first()?;
    let data = picture.data();
    if data.is_empty() || data.len() > 2 * 1024 * 1024 {
        return None;
    }
    let mime = if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if data.starts_with(b"GIF8") {
        "image/gif"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(data)))
}

fn query_tracks(connection: &Connection) -> Result<Vec<TrackDto>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, artist, album, duration, format, cover, path, favorite, valid
             FROM tracks
             ORDER BY valid DESC, title COLLATE NOCASE, artist COLLATE NOCASE",
        )
        .map_err(|error| error.to_string())?;
    let tracks = statement
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let cover: Option<String> = row.get(6)?;
            Ok(TrackDto {
                id: format!("db-{id}"),
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration: row.get::<_, i64>(4)?.max(0) as u64,
                format: row.get(5)?,
                year: None,
                cover: cover.unwrap_or_else(|| cover_kind(id)),
                path: row.get(7)?,
                favorite: row.get::<_, i64>(8)? != 0,
                valid: row.get::<_, i64>(9)? != 0,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(tracks)
}

fn query_playlists(connection: &Connection) -> Result<Vec<PlaylistDto>, String> {
    let mut statement = connection
        .prepare("SELECT id, name FROM playlists ORDER BY created_at, id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut playlists = Vec::with_capacity(rows.len());
    for (id, name) in rows {
        let mut tracks_statement = connection
            .prepare(
                "SELECT pt.track_id FROM playlist_tracks pt
                 JOIN tracks t ON t.id = pt.track_id
                 WHERE pt.playlist_id = ?1 AND t.valid = 1
                 ORDER BY pt.position",
            )
            .map_err(|error| error.to_string())?;
        let track_ids = tracks_statement
            .query_map([id], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|track_id| format!("db-{track_id}"))
            .collect();
        playlists.push(PlaylistDto {
            id: format!("playlist-{id}"),
            name,
            track_ids,
        });
    }
    Ok(playlists)
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Connection::open(directory.join("music-library.sqlite3")).map_err(|error| error.to_string())
}

pub(crate) fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
        .unwrap_or(false)
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn unix_timestamp(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn cover_kind(id: i64) -> String {
    const COVERS: &[&str] = &[
        "ocean", "flower", "sunset", "window", "blue", "paper", "hills",
    ];
    COVERS[id.unsigned_abs() as usize % COVERS.len()].into()
}

fn parse_track_id(track_id: &str) -> Result<i64, String> {
    track_id
        .strip_prefix("db-")
        .ok_or_else(|| "无效的歌曲编号".to_string())?
        .parse::<i64>()
        .map_err(|_| "无效的歌曲编号".to_string())
}

fn parse_playlist_id(playlist_id: &str) -> Result<i64, String> {
    playlist_id
        .strip_prefix("playlist-")
        .ok_or_else(|| "无效的播放列表编号".to_string())?
        .parse::<i64>()
        .map_err(|_| "无效的播放列表编号".to_string())
}

fn playlist_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("播放列表名称不能为空".into());
    }
    if name.chars().count() > 60 {
        return Err("播放列表名称不能超过 60 个字符".into());
    }
    Ok(name.to_string())
}
