use crate::library;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryChange {
    paths: Vec<String>,
}

pub struct LibraryWatcher {
    watcher: Mutex<RecommendedWatcher>,
    watched: Mutex<HashSet<PathBuf>>,
}

impl LibraryWatcher {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let event_app = app.clone();
        let watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let Ok(event) = result else { return };
            let relevant_paths: Vec<String> = event
                .paths
                .iter()
                .filter(|path| library::is_supported(path) || path.extension().is_none())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            if !relevant_paths.is_empty() {
                let _ = event_app.emit(
                    "library-changed",
                    LibraryChange {
                        paths: relevant_paths,
                    },
                );
            }
        })
        .map_err(|error| error.to_string())?;
        let service = Self {
            watcher: Mutex::new(watcher),
            watched: Mutex::new(HashSet::new()),
        };
        for folder in library::managed_folders(app)? {
            // A previously configured folder may be temporarily unavailable.
            // Keep the application usable and resume watching after the next manual scan.
            let _ = service.watch_folder(Path::new(&folder));
        }
        Ok(service)
    }

    pub fn watch_folder(&self, path: &Path) -> Result<(), String> {
        let canonical = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        let mut watched = self
            .watched
            .lock()
            .map_err(|_| "目录监听状态不可用".to_string())?;
        if watched.contains(&canonical) {
            return Ok(());
        }
        self.watcher
            .lock()
            .map_err(|_| "目录监听器不可用".to_string())?
            .watch(&canonical, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
        watched.insert(canonical);
        Ok(())
    }
}
