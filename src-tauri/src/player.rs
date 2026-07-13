use rodio::{
    source::SeekError, ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player,
    SampleRate, Source,
};
use serde::Serialize;
use std::{fs::File, num::NonZeroU16, sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};

struct StereoSource<S> {
    inner: S,
    input_channels: usize,
    frame: Vec<f32>,
    pending_right: Option<f32>,
}

impl<S: Source> StereoSource<S> {
    fn new(inner: S) -> Self {
        let input_channels = inner.channels().get() as usize;
        Self {
            inner,
            input_channels,
            frame: vec![0.0; input_channels],
            pending_right: None,
        }
    }
}

impl<S: Source> Iterator for StereoSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(right) = self.pending_right.take() {
            return Some(right);
        }

        for channel in 0..self.input_channels {
            match self.inner.next() {
                Some(sample) => self.frame[channel] = sample,
                None if channel == 0 => return None,
                None => self.frame[channel] = 0.0,
            }
        }
        let (left, right) = downmix_frame(&self.frame);
        self.pending_right = Some(right);
        Some(left)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let (minimum, maximum) = self.inner.size_hint();
        let pending = usize::from(self.pending_right.is_some());
        let convert = |samples: usize| samples / self.input_channels * 2 + pending;
        (convert(minimum), maximum.map(convert))
    }
}

impl<S: Source> Source for StereoSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner
            .current_span_len()
            .map(|samples| samples / self.input_channels * 2)
    }

    fn channels(&self) -> ChannelCount {
        NonZeroU16::new(2).expect("stereo channel count is non-zero")
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(position)?;
        self.pending_right = None;
        Ok(())
    }
}

fn downmix_frame(frame: &[f32]) -> (f32, f32) {
    const CENTER: f32 = std::f32::consts::FRAC_1_SQRT_2;
    const SURROUND: f32 = std::f32::consts::FRAC_1_SQRT_2;
    const LFE: f32 = 0.5;

    let (left, right) = match frame {
        [] => (0.0, 0.0),
        [mono] => (*mono, *mono),
        [left, right] => (*left, *right),
        [left, right, center] => (*left + *center * CENTER, *right + *center * CENTER),
        [left, right, rear_left, rear_right] => (
            *left + *rear_left * SURROUND,
            *right + *rear_right * SURROUND,
        ),
        [left, right, center, rear_left, rear_right] => (
            *left + *center * CENTER + *rear_left * SURROUND,
            *right + *center * CENTER + *rear_right * SURROUND,
        ),
        [left, right, center, lfe, rear_left, rear_right] => (
            *left + *center * CENTER + *lfe * LFE + *rear_left * SURROUND,
            *right + *center * CENTER + *lfe * LFE + *rear_right * SURROUND,
        ),
        [left, right, center, lfe, rear_center, side_left, side_right] => (
            *left + *center * CENTER + *lfe * LFE + *rear_center * 0.5 + *side_left * SURROUND,
            *right + *center * CENTER + *lfe * LFE + *rear_center * 0.5 + *side_right * SURROUND,
        ),
        [left, right, center, lfe, rear_left, rear_right, side_left, side_right, rest @ ..] => {
            let mut mixed_left =
                *left + *center * CENTER + *lfe * LFE + (*rear_left + *side_left) * 0.5;
            let mut mixed_right =
                *right + *center * CENTER + *lfe * LFE + (*rear_right + *side_right) * 0.5;
            for (index, sample) in rest.iter().enumerate() {
                if index % 2 == 0 {
                    mixed_left += sample * 0.35;
                } else {
                    mixed_right += sample * 0.35;
                }
            }
            (mixed_left, mixed_right)
        }
    };
    (left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0))
}

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
        player.append(StereoSource::new(source));
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

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use std::num::NonZeroU32;

    fn close(left: f32, right: f32) {
        assert!((left - right).abs() < 0.000_01, "{left} != {right}");
    }

    #[test]
    fn mono_is_duplicated_to_both_channels() {
        assert_eq!(downmix_frame(&[0.4]), (0.4, 0.4));
    }

    #[test]
    fn stereo_channels_are_preserved() {
        assert_eq!(downmix_frame(&[0.25, -0.5]), (0.25, -0.5));
    }

    #[test]
    fn six_channel_audio_is_downmixed_instead_of_discarded() {
        let (left, right) = downmix_frame(&[0.1, 0.2, 0.1, 0.02, 0.1, 0.2]);
        close(left, 0.251_421_36);
        close(right, 0.422_132_02);
    }

    #[test]
    fn stereo_source_outputs_interleaved_left_and_right_samples() {
        let source = SamplesBuffer::new(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
            vec![0.1, 0.2, 0.3, 0.4],
        );
        assert_eq!(
            StereoSource::new(source).collect::<Vec<_>>(),
            vec![0.1, 0.2, 0.3, 0.4]
        );
    }
}
