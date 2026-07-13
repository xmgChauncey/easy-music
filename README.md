# Easy Music

轻量、本地优先的桌面音乐播放器 MVP。目前仓库包含可运行的 React + TypeScript 界面原型，重点验证“导入、管理、播放”的核心交互。

## 已实现

- 歌曲库、收藏、最近播放和示例播放列表
- 按标题、歌手、专辑即时搜索
- MP3、FLAC、WAV、AAC、M4A、OGG 文件选择与拖放导入
- 使用浏览器 Audio API 播放导入的本地音频
- 播放、暂停、上一首、下一首、进度、音量、静音
- 随机、列表循环、单曲循环
- 播放队列查看和移除
- 双击歌曲播放
- 浅色/深色主题
- 本地持久化收藏、最近播放、音量与播放模式
- 空列表、导入和设置状态

示例歌曲仅用于首次启动时展示界面，不包含音频文件。点击示例歌曲的播放按钮会引导导入真实本地音乐。

## 本地运行

```powershell
npm install
npm run dev
```

生产构建和测试：

```powershell
npm run build
npm test
```

## Tauri 原生层接入边界

当前开发环境没有 Rust/Cargo，因此没有提交一个无法验证的 `src-tauri` 壳。接入 Tauri 2 时，前端保持现有页面和状态交互，文件与播放真值迁移到以下命令：

```text
library_scan(folders)          -> scan_id
library_scan_progress(scan_id) -> progress event
library_search(query, filters) -> Track[]
library_add_paths(paths)       -> Track[]
player_load(track_id)
player_play / pause / seek / set_volume
queue_get / add / remove / reorder
playlist_create / rename / delete / add_tracks / remove_tracks
settings_get / settings_patch
```

Rust 后端建议按 `LibraryService`、`MetadataService`、`PlayerService`、`PlaylistService` 和 SQLite Repository 拆分。前端的 `HTMLAudioElement` 只作为当前可运行原型的播放实现；接入 `rodio + symphonia` 后，播放状态由 Rust 事件单向同步到 Zustand，避免形成两套播放真值。

## 下一阶段

1. 安装 Rust 与 Tauri 2 CLI，生成并验证 Windows 原生容器。
2. 建立 SQLite schema 和迁移，替换示例数据及 localStorage。
3. 使用 `lofty` 后台解析元数据和封面，并用 `notify` 做增量扫描。
4. 用 `rodio + symphonia` 替换浏览器音频，优先验证 seek 精度和 AAC/M4A 兼容性。
5. 接入托盘、媒体键、窗口行为和播放状态恢复。
