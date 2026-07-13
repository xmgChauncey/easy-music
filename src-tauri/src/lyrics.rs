use encoding_rs::{GBK, UTF_16BE, UTF_16LE};
use lofty::{file::TaggedFileExt, tag::ItemKey};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsDto {
    pub content: String,
    pub source: String,
    pub source_path: Option<String>,
}

#[tauri::command]
pub async fn get_track_lyrics(path: String) -> Result<Option<LyricsDto>, String> {
    tauri::async_runtime::spawn_blocking(move || read_track_lyrics(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

fn read_track_lyrics(audio_path: &Path) -> Result<Option<LyricsDto>, String> {
    let sidecar = audio_path.with_extension("lrc");
    if sidecar.is_file() {
        let bytes = fs::read(&sidecar).map_err(|error| error.to_string())?;
        let content = decode_text(&bytes);
        if !content.trim().is_empty() {
            return Ok(Some(LyricsDto {
                content,
                source: "sidecar".into(),
                source_path: Some(sidecar.to_string_lossy().into_owned()),
            }));
        }
    }

    let Ok(tagged_file) = lofty::read_from_path(audio_path) else {
        return Ok(None);
    };
    let lyrics = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .and_then(|tag| {
            tag.get_string(ItemKey::Lyrics)
                .or_else(|| tag.get_string(ItemKey::UnsyncLyrics))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty());

    Ok(lyrics.map(|content| LyricsDto {
        content: content.to_string(),
        source: "embedded".into(),
        source_path: None,
    }))
}

fn decode_text(bytes: &[u8]) -> String {
    if let Some(bytes) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    if let Some(bytes) = bytes.strip_prefix(&[0xff, 0xfe]) {
        return UTF_16LE.decode(bytes).0.into_owned();
    }
    if let Some(bytes) = bytes.strip_prefix(&[0xfe, 0xff]) {
        return UTF_16BE.decode(bytes).0.into_owned();
    }
    match String::from_utf8(bytes.to_vec()) {
        Ok(text) => text,
        Err(_) => GBK.decode(bytes).0.into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::decode_text;

    #[test]
    fn decodes_utf8_bom() {
        assert_eq!(decode_text(b"\xef\xbb\xbf[00:01]hello"), "[00:01]hello");
    }

    #[test]
    fn decodes_utf16_little_endian() {
        assert_eq!(decode_text(&[0xff, 0xfe, 0x41, 0x00]), "A");
    }
}
