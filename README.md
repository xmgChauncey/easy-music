# 轻音乐

轻量、本地优先的 Windows 桌面音乐播放器 MVP，使用 Tauri 2、React、TypeScript 和 Vite 构建。

## 已实现

- 中文桌面播放器界面
- 使用 Windows 原生对话框选择音乐目录
- Rust 后台递归扫描 MP3、FLAC、WAV、AAC、M4A、OGG
- 使用 `lofty` 读取标题、歌手、专辑、时长和内嵌封面
- 使用 SQLite 持久保存音乐索引，并按文件大小和修改时间增量更新
- 扫描进度实时显示，损坏或缺少标签的文件会安全回退
- 使用 `notify` 递归监听音乐目录变化，并防抖触发增量扫描
- 使用 `rodio + symphonia` 在 Rust 后端播放本地音频
- 原生播放支持暂停、恢复、进度跳转、音量和播放结束事件
- 收藏、播放队列、当前歌曲、进度、音量和播放模式保存到 SQLite
- 启动时恢复上次播放状态，并从保存位置继续播放
- Windows 系统托盘提供打开、播放/暂停、上一首、下一首和退出菜单
- 支持播放/暂停、上一首和下一首媒体快捷键
- 关闭主窗口时进入托盘并继续运行
- 播放列表保存到 SQLite，支持创建、重命名、删除、歌曲增删和拖放排序
- “恢复播放状态”和“关闭时进入托盘”可在设置中实时开关
- 主窗口最小化、最大化和关闭按钮调用 Windows 原生窗口能力
- 可切换为紧凑迷你播放器，并恢复到主窗口
- 歌曲库搜索、收藏和最近播放
- 播放、暂停、切歌、进度、音量和静音
- 随机播放、列表循环和单曲循环
- 播放队列查看和移除
- 浅色与深色主题
- 播放偏好与收藏状态本地持久化
- Tauri 2 Windows 原生容器

Tauri 原生版本由 Rust 持有播放真值；浏览器开发模式保留 `HTMLAudioElement` 作为降级预览实现。

音乐数据库默认存储在：

```text
%APPDATA%/com.easymusic.player/music-library.sqlite3
```

## 开发运行

```powershell
npm install
npm run tauri dev
```

仅启动浏览器前端：

```powershell
npm run dev
```

## 构建与测试

```powershell
npm test
npm run build
npm run tauri build -- --no-bundle
```

Windows Release 程序生成在：

```text
src-tauri/target/release/easy-music.exe
```

生成 MSI/NSIS 安装包：

```powershell
npm run tauri build
```

安装包位于 `src-tauri/target/release/bundle/`。

## 后续规划

- Windows SMTC 锁屏媒体信息和系统音量浮层联动
- 扫描目录管理与移除
- 播放队列拖放排序
- 最近播放历史迁移到 SQLite
- 音乐库缓存清理与数据位置打开按钮
