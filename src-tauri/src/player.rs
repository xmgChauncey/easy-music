use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::Serialize;
use std::{fs::File, sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    track_id: Option<String>,
    path: Option<String>,
    status: String,
    position: f64,
    duration: f64,
    volume: f32,
}

pub struct PlayerService {
    inner: Mutex<PlayerInner>,
}

struct PlayerInner {
    output: Option<MixerDeviceSink>,
    player: Option<Player>,
    track_id: Option<String>,
    path: Option<String>,
    status: &'static str,
    duration: f64,
    volume: f32,
}

impl Default for PlayerService {
    fn default() -> Self {
        Self {
            inner: Mutex::new(PlayerInner {
                output: None,
                player: None,
                track_id: None,
                path: None,
                status: "stopped",
                duration: 0.0,
                volume: 0.72,
            }),
        }
    }
}

impl PlayerService {
    fn load(&self, path: String, track_id: String, volume: f32) -> Result<PlayerSnapshot, String> {
        let file = File::open(&path).map_err(|error| format!("无法打开音频文件：{error}"))?;
        let source =
            Decoder::try_from(file).map_err(|error| format!("无法解码音频文件：{error}"))?;
        let duration = source
            .total_duration()
            .map(|value| value.as_secs_f64())
            .unwrap_or(0.0);
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "播放器状态不可用".to_string())?;
        if inner.output.is_none() {
            inner.output = Some(
                DeviceSinkBuilder::open_default_sink()
                    .map_err(|error| format!("无法打开默认音频设备：{error}"))?,
            );
        }
        let player =
            Player::connect_new(inner.output.as_ref().expect("output initialized").mixer());
        let safe_volume = volume.clamp(0.0, 1.0);
        player.set_volume(safe_volume);
        player.append(source);
        player.play();
        inner.player = Some(player);
        inner.track_id = Some(track_id);
        inner.path = Some(path);
        inner.status = "playing";
        inner.duration = duration;
        inner.volume = safe_volume;
        Ok(snapshot_from_inner(&mut inner))
    }

    fn snapshot(&self) -> Result<PlayerSnapshot, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "播放器状态不可用".to_string())?;
        Ok(snapshot_from_inner(&mut inner))
    }
}

fn snapshot_from_inner(inner: &mut PlayerInner) -> PlayerSnapshot {
    let position = inner
        .player
        .as_ref()
        .map(|player| player.get_pos().as_secs_f64())
        .unwrap_or(0.0);
    if inner.status == "playing" && inner.player.as_ref().is_some_and(Player::empty) {
        inner.status = "ended";
    }
    PlayerSnapshot {
        track_id: inner.track_id.clone(),
        path: inner.path.clone(),
        status: inner.status.into(),
        position,
        duration: inner.duration,
        volume: inner.volume,
    }
}

fn update_and_emit<F>(
    app: &AppHandle,
    service: &PlayerService,
    update: F,
) -> Result<PlayerSnapshot, String>
where
    F: FnOnce(&mut PlayerInner) -> Result<(), String>,
{
    let snapshot = {
        let mut inner = service
            .inner
            .lock()
            .map_err(|_| "播放器状态不可用".to_string())?;
        update(&mut inner)?;
        snapshot_from_inner(&mut inner)
    };
    let _ = app.emit("player-state", snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub fn player_load(
    path: String,
    track_id: String,
    volume: f32,
    app: AppHandle,
    service: State<PlayerService>,
) -> Result<PlayerSnapshot, String> {
    let snapshot = service.load(path, track_id, volume)?;
    let _ = app.emit("player-state", snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub fn player_play(
    app: AppHandle,
    service: State<PlayerService>,
) -> Result<PlayerSnapshot, String> {
    update_and_emit(&app, &service, |inner| {
        let player = inner
            .player
            .as_ref()
            .ok_or_else(|| "尚未加载歌曲".to_string())?;
        if inner.status == "ended" {
            player
                .try_seek(Duration::ZERO)
                .map_err(|error| error.to_string())?;
        }
        player.play();
        inner.status = "playing";
        Ok(())
    })
}

#[tauri::command]
pub fn player_pause(
    app: AppHandle,
    service: State<PlayerService>,
) -> Result<PlayerSnapshot, String> {
    update_and_emit(&app, &service, |inner| {
        let player = inner
            .player
            .as_ref()
            .ok_or_else(|| "尚未加载歌曲".to_string())?;
        player.pause();
        inner.status = "paused";
        Ok(())
    })
}

#[tauri::command]
pub fn player_seek(
    position: f64,
    app: AppHandle,
    service: State<PlayerService>,
) -> Result<PlayerSnapshot, String> {
    update_and_emit(&app, &service, |inner| {
        let player = inner
            .player
            .as_ref()
            .ok_or_else(|| "尚未加载歌曲".to_string())?;
        player
            .try_seek(Duration::from_secs_f64(position.max(0.0)))
            .map_err(|error| format!("当前格式不支持跳转：{error}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn player_set_volume(
    volume: f32,
    app: AppHandle,
    service: State<PlayerService>,
) -> Result<PlayerSnapshot, String> {
    update_and_emit(&app, &service, |inner| {
        let safe_volume = volume.clamp(0.0, 1.0);
        inner.volume = safe_volume;
        if let Some(player) = &inner.player {
            player.set_volume(safe_volume);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn player_stop(
    app: AppHandle,
    service: State<PlayerService>,
) -> Result<PlayerSnapshot, String> {
    update_and_emit(&app, &service, |inner| {
        if let Some(player) = &inner.player {
            player.stop();
        }
        inner.status = "stopped";
        Ok(())
    })
}

#[tauri::command]
pub fn player_get_state(service: State<PlayerService>) -> Result<PlayerSnapshot, String> {
    service.snapshot()
}

pub fn start_state_emitter(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(300));
        let service = app.state::<PlayerService>();
        if let Ok(snapshot) = service.snapshot() {
            if snapshot.track_id.is_some() {
                let _ = app.emit("player-state", snapshot);
            }
        }
    });
}
