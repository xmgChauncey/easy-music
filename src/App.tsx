import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Album, AudioLines, ChevronDown, ChevronLeft, ChevronRight, Disc3, FolderPlus,
  Heart, Home, ListEnd, ListMusic, Maximize2, MoreHorizontal, Music2, Pause,
  Play, Plus, Repeat, Search, Settings, Shuffle, SkipBack, SkipForward, SlidersHorizontal,
  Sparkles, Star, Trash2, UserRound, Volume2, VolumeX, X,
} from 'lucide-react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { demoTracks, formatTime } from './library'
import { activeLyricIndex, parseLyrics } from './lyrics'
import { nextPlaybackMode, playbackStateForMode, resolvePlaybackMode } from './playbackMode'
import type { PlaybackMode } from './playbackMode'
import type { Playlist, RepeatMode, Track, View } from './types'

type PlayerState = {
  tracks: Track[]
  currentId: string
  queue: string[]
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  favorites: string[]
  recent: string[]
  playlists: Playlist[]
  setCurrent: (id: string) => void
  setVolume: (volume: number) => void
  toggleFavorite: (id: string) => void
  setTracks: (tracks: Track[]) => void
  setQueue: (queue: string[]) => void
  setRepeat: (repeat: RepeatMode) => void
  setFavorites: (favorites: string[]) => void
  setShuffle: (shuffle: boolean) => void
  setPlaylists: (playlists: Playlist[]) => void
  toggleShuffle: () => void
}

const usePlayer = create<PlayerState>()(persist((set) => ({
  tracks: demoTracks,
  currentId: '1',
  queue: demoTracks.map((track) => track.id),
  volume: .72,
  repeat: 'all',
  shuffle: false,
  favorites: ['1', '3'],
  recent: ['1', '4', '2'],
  playlists: [
    { id: 'morning', name: '清晨舒缓', trackIds: ['1', '2', '4'] },
    { id: 'road', name: '公路旅行', trackIds: ['3', '5', '7'] },
  ],
  setCurrent: (currentId) => set((state) => ({ currentId, recent: [currentId, ...state.recent.filter((id) => id !== currentId)].slice(0, 30) })),
  setVolume: (volume) => set({ volume }),
  toggleFavorite: (id) => set((state) => ({ favorites: state.favorites.includes(id) ? state.favorites.filter((item) => item !== id) : [...state.favorites, id] })),
  setTracks: (tracks) => set({ tracks }),
  setQueue: (queue) => set({ queue }),
  setRepeat: (repeat) => set({ repeat }),
  setFavorites: (favorites) => set({ favorites }),
  setShuffle: (shuffle) => set({ shuffle }),
  setPlaylists: (playlists) => set({ playlists }),
  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
}), { name: 'easy-music-state', partialize: (state) => ({ currentId: state.currentId, volume: state.volume, repeat: state.repeat, shuffle: state.shuffle, favorites: state.favorites, recent: state.recent, playlists: state.playlists }) }))

const nav = [
  { id: 'discover', label: '发现', icon: Home },
  { id: 'songs', label: '歌曲', icon: Music2 },
  { id: 'albums', label: '专辑', icon: Album },
  { id: 'artists', label: '歌手', icon: UserRound },
] as const

function Cover({ kind, size = 'normal' }: { kind: string; size?: 'small' | 'normal' | 'large' }) {
  if (kind.startsWith('data:image/')) return <div className={`cover cover-${size}`}><img src={kind} alt="专辑封面" /></div>
  return <div className={`cover cover-${kind} cover-${size}`}><span>{kind === 'paper' ? '◒' : ''}</span></div>
}

type ScanProgress = { processed: number; total: number; currentPath: string }
type NativePlayerState = { trackId: string | null; path: string | null; status: 'stopped' | 'playing' | 'paused' | 'ended'; position: number; duration: number; volume: number }
type SavedPlaybackState = { trackId: string | null; position: number; volume: number; repeatMode: RepeatMode; shuffle: boolean }
type AppSettings = { closeToTray: boolean; restorePlayback: boolean }
type LyricsPayload = { content: string; source: 'sidecar' | 'embedded'; sourcePath: string | null }

function App() {
  const state = usePlayer()
  const [view, setView] = useState<View>('discover')
  const [search, setSearch] = useState('')
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [queueOpen, setQueueOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress>({ processed: 0, total: 0, currentPath: '' })
  const [scanError, setScanError] = useState('')
  const [nativePlayer, setNativePlayer] = useState<NativePlayerState | null>(null)
  const [nativeReady, setNativeReady] = useState(false)
  const [activePlaylistId, setActivePlaylistId] = useState('')
  const [playlistDialog, setPlaylistDialog] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [playlistName, setPlaylistName] = useState('')
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null)
  const [closeToTray, setCloseToTray] = useState(true)
  const [restorePlayback, setRestorePlayback] = useState(true)
  const [miniMode, setMiniMode] = useState(false)
  const [miniOpacityOpen, setMiniOpacityOpen] = useState(false)
  const [miniOpacity, setMiniOpacity] = useState(() => {
    const savedOpacity = Number(localStorage.getItem('easy-mini-opacity'))
    return Number.isFinite(savedOpacity) && savedOpacity >= .45 && savedOpacity <= 1 ? savedOpacity : .92
  })
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [lyrics, setLyrics] = useState<LyricsPayload | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('easy-theme') as 'light' | 'dark') || 'light')
  const fileInput = useRef<HTMLInputElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const endedTrack = useRef<string | null>(null)
  const mediaAction = useRef<(action: string) => void>(() => undefined)
  const resumePlayback = useRef<{ trackId: string; position: number } | null>(null)
  const current = state.tracks.find((track) => track.id === state.currentId) || state.tracks[0]
  const activePlaylist = state.playlists.find((playlist) => playlist.id === activePlaylistId)
  const playbackMode = resolvePlaybackMode(state.repeat, state.shuffle)

  const setFolderInput = (node: HTMLInputElement | null) => {
    fileInput.current = node
    if (node) node.setAttribute('webkitdirectory', '')
  }

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('easy-theme', theme) }, [theme])
  useEffect(() => { if (!isTauri() && audio.current) audio.current.volume = state.volume }, [state.volume])
  useEffect(() => {
    if (!nowPlayingOpen) return
    if (!isTauri() || !current?.path) {
      setLyrics(null)
      setLyricsLoading(false)
      return
    }
    let disposed = false
    setLyricsLoading(true)
    setLyrics(null)
    void invoke<LyricsPayload | null>('get_track_lyrics', { path: current.path })
      .then((result) => { if (!disposed) setLyrics(result) })
      .catch((error) => { if (!disposed) setScanError(`歌词读取失败：${String(error)}`) })
      .finally(() => { if (!disposed) setLyricsLoading(false) })
    return () => { disposed = true }
  }, [nowPlayingOpen, current?.id, current?.path])
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let stopListening: undefined | (() => void)
    let stopLibraryChanges: undefined | (() => void)
    let refreshTimer: number | undefined
    void listen<ScanProgress>('library-scan-progress', (event) => {
      if (!disposed) setScanProgress(event.payload)
    }).then((unlisten) => {
      if (disposed) unlisten()
      else stopListening = unlisten
    })
    void listen<{ paths: string[] }>('library-changed', () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        void (async () => {
          setScanning(true)
          setScanError('')
          try {
            const folders = await invoke<string[]>('get_library_folders')
            let tracks = await invoke<Track[]>('get_library_tracks')
            for (const folder of folders) tracks = await invoke<Track[]>('scan_music_folder', { path: folder })
            if (!disposed) {
              state.setTracks(tracks)
              state.setQueue(tracks.filter((track) => track.valid !== false).map((track) => track.id))
            }
          } catch (error) {
            if (!disposed) setScanError(`自动更新音乐库失败：${String(error)}`)
          } finally {
            if (!disposed) setScanning(false)
          }
        })()
      }, 1200)
    }).then((unlisten) => {
      if (disposed) unlisten()
      else stopLibraryChanges = unlisten
    })
    void Promise.all([
      invoke<Track[]>('get_library_tracks'),
      invoke<string[]>('get_playback_queue'),
      invoke<SavedPlaybackState>('get_playback_state'),
      invoke<Playlist[]>('list_playlists'),
      invoke<AppSettings>('get_app_settings'),
    ])
      .then(([tracks, savedQueue, savedPlayback, playlists, appSettings]) => {
        if (disposed) return
        state.setTracks(tracks)
        state.setPlaylists(playlists)
        setCloseToTray(appSettings.closeToTray)
        setRestorePlayback(appSettings.restorePlayback)
        state.setFavorites(tracks.filter((track) => track.favorite).map((track) => track.id))
        const validIds = new Set(tracks.filter((track) => track.valid !== false).map((track) => track.id))
        const restoredQueue = savedQueue.filter((id) => validIds.has(id))
        state.setQueue(restoredQueue.length ? restoredQueue : [...validIds])
        const restoredTrack = appSettings.restorePlayback && savedPlayback.trackId
          ? tracks.find((track) => track.id === savedPlayback.trackId)
          : undefined
        if (restoredTrack) {
          state.setCurrent(restoredTrack.id)
          if (savedPlayback.position > 0) resumePlayback.current = { trackId: restoredTrack.id, position: savedPlayback.position }
        } else if (tracks.length) state.setCurrent(tracks[0].id)
        if (appSettings.restorePlayback) {
          state.setVolume(savedPlayback.volume)
          state.setRepeat(['off', 'all', 'one'].includes(savedPlayback.repeatMode) ? savedPlayback.repeatMode : 'all')
          state.setShuffle(savedPlayback.shuffle)
          setProgress(savedPlayback.position)
        } else {
          state.setVolume(.72)
          state.setRepeat('all')
          state.setShuffle(false)
          setProgress(0)
        }
        setNativeReady(true)
      })
      .catch((error) => { if (!disposed) setScanError(`读取音乐库失败：${String(error)}`) })
    return () => { disposed = true; stopListening?.(); stopLibraryChanges?.(); if (refreshTimer) window.clearTimeout(refreshTimer) }
  }, [])
  useEffect(() => {
    if (isTauri() || !audio.current || !current?.url) return
    audio.current.src = current.url
    if (playing) audio.current.play().catch(() => setPlaying(false))
  }, [current?.id])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const base = view === 'favorites' ? state.tracks.filter((track) => state.favorites.includes(track.id))
      : view === 'recent' ? state.recent.map((id) => state.tracks.find((track) => track.id === id)).filter(Boolean) as Track[]
      : view === 'playlist' ? (activePlaylist?.trackIds.map((id) => state.tracks.find((track) => track.id === id)).filter(Boolean) as Track[] || [])
      : state.tracks
    return query ? base.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query)) : base
  }, [search, state.tracks, state.favorites, state.recent, state.playlists, activePlaylistId, view])
  const albumCount = useMemo(() => new Set(filtered.map((track) => (track.album.trim() || '未知专辑').toLocaleLowerCase())).size, [filtered])
  const artistCount = useMemo(() => new Set(filtered.map((track) => (track.artist.trim() || '未知歌手').toLocaleLowerCase())).size, [filtered])

  const playTrack = (track: Track) => {
    state.setCurrent(track.id)
    if (isTauri() && track.path) {
      endedTrack.current = null
      setProgress(0)
      setPlaying(true)
      void invoke<NativePlayerState>('player_load', { path: track.path, trackId: track.id, volume: state.volume })
        .then(async (snapshot) => {
          const resume = resumePlayback.current
          if (resume?.trackId === track.id) {
            resumePlayback.current = null
            return invoke<NativePlayerState>('player_seek', { position: resume.position })
          }
          return snapshot
        })
        .then(setNativePlayer)
        .catch((error) => { setPlaying(false); setScanError(`播放失败：${String(error)}`) })
      return
    }
    if (!track.url) { setPlaying(false); setProgress(0); return }
    setPlaying(true)
    setTimeout(() => audio.current?.play().catch(() => setPlaying(false)), 0)
  }

  const togglePlay = () => {
    if (isTauri()) {
      if (!current?.path) { setScanError('请先选择包含音乐文件的目录'); return }
      if (nativePlayer?.trackId !== current.id || nativePlayer.status === 'ended') { playTrack(current); return }
      const command = playing ? 'player_pause' : 'player_play'
      void invoke<NativePlayerState>(command).then(setNativePlayer).catch((error) => setScanError(`播放控制失败：${String(error)}`))
      return
    }
    if (!current?.url) { setImportOpen(true); return }
    if (playing) audio.current?.pause()
    else audio.current?.play().catch(() => setPlaying(false))
    setPlaying(!playing)
  }

  const next = (direction = 1) => {
    if (!state.queue.length) return
    const target = state.shuffle
      ? (state.queue.filter((id) => id !== current?.id)[Math.floor(Math.random() * Math.max(1, state.queue.length - 1))] || state.queue[0])
      : state.queue[(state.queue.indexOf(current?.id) + direction + state.queue.length) % state.queue.length]
    const track = state.tracks.find((item) => item.id === target)
    if (track) playTrack(track)
  }

  const cyclePlaybackMode = () => {
    const nextState = playbackStateForMode(nextPlaybackMode(playbackMode))
    state.setShuffle(nextState.shuffle)
    state.setRepeat(nextState.repeat)
  }

  const handlePlaybackEnded = () => {
    if (playbackMode === 'single') {
      if (!isTauri() && audio.current) {
        audio.current.currentTime = 0
        setPlaying(true)
        void audio.current.play().catch(() => setPlaying(false))
      } else if (current) playTrack(current)
      return
    }
    const currentIndex = state.queue.indexOf(current?.id)
    if (playbackMode === 'sequence' && currentIndex >= state.queue.length - 1) {
      setPlaying(false)
      return
    }
    next()
  }

  mediaAction.current = (action) => {
    if (action === 'play-pause') togglePlay()
    else if (action === 'next') next()
    else if (action === 'previous') next(-1)
  }

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let stopListening: undefined | (() => void)
    void listen<string>('media-command', (event) => mediaAction.current(event.payload)).then((unlisten) => {
      if (disposed) unlisten()
      else stopListening = unlisten
    })
    return () => { disposed = true; stopListening?.() }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let stopListening: undefined | (() => void)
    const receiveState = (snapshot: NativePlayerState) => {
      if (disposed) return
      setNativePlayer(snapshot)
      setPlaying(snapshot.status === 'playing')
      setProgress(snapshot.position)
      if (snapshot.duration > 0) setDuration(snapshot.duration)
    }
    void listen<NativePlayerState>('player-state', (event) => receiveState(event.payload)).then((unlisten) => {
      if (disposed) unlisten()
      else stopListening = unlisten
    })
    void invoke<NativePlayerState>('player_get_state').then(receiveState).catch(() => undefined)
    return () => { disposed = true; stopListening?.() }
  }, [])

  useEffect(() => {
    if (!isTauri() || nativePlayer?.status !== 'ended' || !nativePlayer.trackId) return
    if (endedTrack.current === nativePlayer.trackId) return
    endedTrack.current = nativePlayer.trackId
    handlePlaybackEnded()
  }, [nativePlayer?.status, nativePlayer?.trackId])

  const seekPlayer = (value: number) => {
    setProgress(value)
    if (isTauri()) void invoke<NativePlayerState>('player_seek', { position: value }).then(setNativePlayer).catch((error) => setScanError(`跳转失败：${String(error)}`))
    else if (audio.current) audio.current.currentTime = value
  }

  const changeVolume = (value: number) => {
    state.setVolume(value)
    if (isTauri()) void invoke<NativePlayerState>('player_set_volume', { volume: value }).then(setNativePlayer).catch(() => undefined)
  }

  const toggleFavorite = (trackId: string) => {
    const favorite = !state.favorites.includes(trackId)
    state.toggleFavorite(trackId)
    if (isTauri() && trackId.startsWith('db-')) {
      void invoke('set_track_favorite', { trackId, favorite }).catch((error) => setScanError(`收藏同步失败：${String(error)}`))
    }
  }

  useEffect(() => {
    if (!isTauri() || !nativeReady) return
    void invoke('save_playback_queue', { trackIds: state.queue }).catch((error) => setScanError(`队列保存失败：${String(error)}`))
  }, [nativeReady, state.queue])

  useEffect(() => {
    if (!isTauri() || !nativeReady) return
    void invoke('save_playback_state', {
      trackId: current?.id || null,
      position: progress,
      volume: state.volume,
      repeatMode: state.repeat,
      shuffle: state.shuffle,
    }).catch(() => undefined)
  }, [nativeReady, current?.id, Math.floor(progress / 5), state.volume, state.repeat, state.shuffle])

  const importFiles = (files: FileList | null) => {
    if (!files?.length) return
    const accepted = Array.from(files).filter((file) => /\.(mp3|flac|wav|aac|m4a|ogg)$/i.test(file.name))
    const added = accepted.map((file, index): Track => ({
      id: `local-${file.lastModified}-${file.size}-${index}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '未知歌手', album: '本地文件', duration: 0,
      format: file.name.split('.').pop()?.toUpperCase() || 'AUDIO', cover: ['ocean', 'flower', 'sunset', 'blue'][index % 4],
      url: URL.createObjectURL(file), path: file.name, valid: true,
    }))
    const tracks = [...added, ...state.tracks.filter((track) => !added.some((item) => item.id === track.id))]
    state.setTracks(tracks)
    state.setQueue([...added.map((track) => track.id), ...state.queue])
    setImportOpen(false); setView('songs')
    if (added[0]) playTrack(added[0])
  }

  const chooseMusicFolder = async () => {
    if (!isTauri()) {
      setImportOpen(true)
      return
    }
    setScanError('')
    const selected = await open({ directory: true, multiple: false, title: '选择音乐目录' })
    if (typeof selected !== 'string') return
    setScanning(true)
    setScanProgress({ processed: 0, total: 0, currentPath: selected })
    try {
      const tracks = await invoke<Track[]>('scan_music_folder', { path: selected })
      state.setTracks(tracks)
      const playableIds = tracks.filter((track) => track.valid !== false).map((track) => track.id)
      state.setQueue(playableIds)
      if (tracks.length) state.setCurrent(tracks[0].id)
      setView('songs')
    } catch (error) {
      setScanError(`扫描失败：${String(error)}`)
    } finally {
      setScanning(false)
    }
  }

  const openPlaylistDialog = (mode: 'create' | 'rename' | 'delete') => {
    setPlaylistName(mode === 'rename' ? activePlaylist?.name || '' : '')
    setPlaylistDialog(mode)
  }

  const submitPlaylistDialog = async () => {
    try {
      if (playlistDialog === 'create') {
        if (!playlistName.trim()) return
        const playlist = isTauri()
          ? await invoke<Playlist>('create_playlist', { name: playlistName.trim() })
          : { id: `playlist-${Date.now()}`, name: playlistName.trim(), trackIds: [] }
        state.setPlaylists([...state.playlists, playlist])
        setActivePlaylistId(playlist.id)
        setView('playlist')
      } else if (playlistDialog === 'rename' && activePlaylist) {
        if (!playlistName.trim()) return
        if (isTauri()) await invoke('rename_playlist', { playlistId: activePlaylist.id, name: playlistName.trim() })
        state.setPlaylists(state.playlists.map((playlist) => playlist.id === activePlaylist.id ? { ...playlist, name: playlistName.trim() } : playlist))
      } else if (playlistDialog === 'delete' && activePlaylist) {
        if (isTauri()) await invoke('delete_playlist', { playlistId: activePlaylist.id })
        state.setPlaylists(state.playlists.filter((playlist) => playlist.id !== activePlaylist.id))
        setActivePlaylistId('')
        setView('songs')
      }
      setPlaylistDialog(null)
    } catch (error) {
      setScanError(`播放列表操作失败：${String(error)}`)
    }
  }

  const addTrackToPlaylist = async (playlist: Playlist, track: Track) => {
    if (playlist.trackIds.includes(track.id)) {
      setAddToPlaylistTrack(null)
      return
    }
    try {
      if (isTauri()) await invoke('add_track_to_playlist', { playlistId: playlist.id, trackId: track.id })
      state.setPlaylists(state.playlists.map((item) => item.id === playlist.id ? { ...item, trackIds: [...item.trackIds, track.id] } : item))
      setAddToPlaylistTrack(null)
    } catch (error) {
      setScanError(`添加到播放列表失败：${String(error)}`)
    }
  }

  const removeTrackFromPlaylist = async (trackId: string) => {
    if (!activePlaylist) return
    try {
      if (isTauri()) await invoke('remove_track_from_playlist', { playlistId: activePlaylist.id, trackId })
      state.setPlaylists(state.playlists.map((playlist) => playlist.id === activePlaylist.id ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) } : playlist))
    } catch (error) {
      setScanError(`从播放列表移除失败：${String(error)}`)
    }
  }

  const reorderActivePlaylist = (sourceId: string, targetId: string) => {
    if (!activePlaylist || sourceId === targetId) return
    const trackIds = [...activePlaylist.trackIds]
    const source = trackIds.indexOf(sourceId)
    const target = trackIds.indexOf(targetId)
    if (source < 0 || target < 0) return
    trackIds.splice(target, 0, trackIds.splice(source, 1)[0])
    state.setPlaylists(state.playlists.map((playlist) => playlist.id === activePlaylist.id ? { ...playlist, trackIds } : playlist))
    if (isTauri()) void invoke('reorder_playlist', { playlistId: activePlaylist.id, trackIds }).catch((error) => setScanError(`播放列表排序失败：${String(error)}`))
  }

  const updateAppSettings = (next: Partial<AppSettings>) => {
    const settings = { closeToTray, restorePlayback, ...next }
    setCloseToTray(settings.closeToTray)
    setRestorePlayback(settings.restorePlayback)
    if (isTauri()) void invoke('set_app_settings', settings).catch((error) => setScanError(`设置保存失败：${String(error)}`))
  }

  const windowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    if (!isTauri()) return
    const appWindow = getCurrentWindow()
    if (action === 'minimize') await appWindow.minimize()
    else if (action === 'maximize') await appWindow.toggleMaximize()
    else await appWindow.close()
  }

  const changeMiniOpacity = (value: number) => {
    const nextOpacity = Math.min(1, Math.max(.45, value))
    setMiniOpacity(nextOpacity)
    localStorage.setItem('easy-mini-opacity', String(nextOpacity))
  }

  const startMiniDragging = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isTauri() || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, a, [role="button"]')) return
    void getCurrentWindow().startDragging().catch(() => undefined)
  }

  const toggleMiniMode = async () => {
    const nextMiniMode = !miniMode
    if (!isTauri()) {
      setMiniMode(nextMiniMode)
      document.documentElement.dataset.mini = String(nextMiniMode)
      return
    }
    const appWindow = getCurrentWindow()
    try {
      if (nextMiniMode) {
        await appWindow.setMinSize(null)
        await appWindow.setDecorations(false)
        await appWindow.setAlwaysOnTop(true)
        await appWindow.setResizable(false)
        setMiniMode(true)
        document.documentElement.dataset.mini = 'true'
        await appWindow.setSize(new LogicalSize(400, 94))
      } else {
        await appWindow.setAlwaysOnTop(false)
        await appWindow.setDecorations(true)
        await appWindow.setResizable(true)
        await appWindow.setMinSize(new LogicalSize(960, 640))
        setMiniMode(false)
        document.documentElement.dataset.mini = 'false'
        await appWindow.setSize(new LogicalSize(1280, 800))
        await appWindow.center()
      }
    } catch (error) {
      setMiniMode(false)
      document.documentElement.dataset.mini = 'false'
      setScanError(`切换迷你播放器失败：${String(error)}`)
    }
  }

  const pageTitle = view === 'discover' ? '下午好' : view === 'playlist' ? activePlaylist?.name || '播放列表' : ({ songs: '歌曲', albums: '专辑', artists: '歌手', favorites: '我的收藏', recent: '最近播放', settings: '设置' } as Record<Exclude<View, 'discover' | 'playlist'>, string>)[view]

  if (miniMode) return <div className="mini-player" onMouseDown={startMiniDragging} style={{ '--mini-opacity': miniOpacity } as React.CSSProperties}>
    <audio ref={audio} onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onEnded={handlePlaybackEnded} />
    <div className="mini-content">
      <div className="mini-drag" data-tauri-drag-region="deep"><strong>{current?.title || '暂无播放'}</strong><span>{current?.artist || '请选择歌曲'} · {current?.album || '本地音乐'}</span></div>
      <div className="mini-timeline"><input type="range" min="0" max={duration || current?.duration || 1} value={progress} onChange={(event) => seekPlayer(Number(event.target.value))} style={{'--value': `${progress / (duration || current?.duration || 1) * 100}%`} as React.CSSProperties}/><div><span>{formatTime(progress)}</span><span>{formatTime(duration || current?.duration || 0)}</span></div></div>
      <div className="mini-controls"><PlaybackModeButton mode={playbackMode} onClick={cyclePlaybackMode} size={15}/><button onClick={() => next(-1)} title="上一首"><SkipBack size={16} fill="currentColor"/></button><button className="mini-play" onClick={togglePlay} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button><button onClick={() => next()} title="下一首"><SkipForward size={16} fill="currentColor"/></button><button onClick={() => changeVolume(state.volume ? 0 : .72)} title={state.volume ? `静音（当前 ${Math.round(state.volume * 100)}%）` : '取消静音'}>{state.volume ? <Volume2 size={15}/> : <VolumeX size={15}/>}</button></div>
    </div>
    {miniOpacityOpen && <div className="mini-opacity-panel">
      <div><span>透明度</span><strong>{Math.round(miniOpacity * 100)}%</strong></div>
      <input aria-label="迷你播放器透明度" type="range" min=".45" max="1" step=".01" value={miniOpacity} onChange={(event) => changeMiniOpacity(Number(event.target.value))} style={{ '--value': `${(miniOpacity - .45) / .55 * 100}%` } as React.CSSProperties}/>
    </div>}
    <div className="mini-window-actions"><button className={miniOpacityOpen ? 'active' : ''} onClick={() => setMiniOpacityOpen(!miniOpacityOpen)} title={`调节透明度（当前 ${Math.round(miniOpacity * 100)}%）`}><SlidersHorizontal size={14}/></button><button onClick={() => void toggleMiniMode()} title="返回主窗口"><Maximize2 size={14}/></button><button onClick={() => void windowAction('close')} title="关闭"><X size={15}/></button></div>
  </div>

  return <div className="app-shell">
    <audio ref={audio} onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); if (current) current.duration = Math.round(event.currentTarget.duration) }} onEnded={handlePlaybackEnded} />
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={19} /></div><span>轻音乐</span></div>
      <div className="side-label">音乐库</div>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18}/>{label}</button>)}</nav>
      <div className="side-label section-gap">我的音乐</div>
      <nav>
        <button className={view === 'favorites' ? 'active' : ''} onClick={() => setView('favorites')}><Heart size={18}/>我的收藏</button>
        <button className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}><Sparkles size={18}/>最近播放</button>
      </nav>
      <div className="side-label section-gap playlist-label"><span>播放列表</span><button title="新建播放列表" onClick={() => openPlaylistDialog('create')}><Plus size={14}/></button></div>
      <nav className="playlists">{state.playlists.map((playlist) => <button className={view === 'playlist' && activePlaylistId === playlist.id ? 'active' : ''} key={playlist.id} onClick={() => { setActivePlaylistId(playlist.id); setView('playlist') }}><span className="playlist-dot"/>{playlist.name}</button>)}</nav>
      <div className="side-bottom"><button onClick={() => setSettingsOpen(true)}><Settings size={18}/>设置</button><div className="library-stat"><div><Disc3 size={20}/><span><b>{state.tracks.length} 首歌曲</b><small>{scanning ? '正在扫描…' : '本地音乐库'}</small></span></div><ChevronRight size={16}/></div></div>
    </aside>

    <main className="main">
      <header><div className="history"><button title="后退"><ChevronLeft size={19}/></button><button title="前进" disabled><ChevronRight size={19}/></button></div><label className="search"><Search size={17}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索歌曲、歌手或专辑…"/><kbd>Ctrl K</kbd></label></header>
      <section className="content">
        <div className="page-heading"><div><h1>{pageTitle}</h1><p>{view === 'discover' ? '继续享受上次的音乐时光。' : view === 'playlist' ? `播放列表中共 ${filtered.length} 首歌曲，可拖动排序` : view === 'albums' ? `本地音乐库中共 ${albumCount} 张专辑` : view === 'artists' ? `本地音乐库中共 ${artistCount} 位歌手` : `本地音乐库中共 ${filtered.length} 项`}</p></div><div className="heading-actions">{view === 'playlist' && activePlaylist && <><button className="outline-button" onClick={() => openPlaylistDialog('rename')}>重命名</button><button className="outline-button danger" onClick={() => openPlaylistDialog('delete')}><Trash2 size={14}/>删除</button></>}<button className="import-button" disabled={scanning} onClick={chooseMusicFolder}><FolderPlus size={17}/>{scanning ? '扫描中…' : '选择目录'}</button></div></div>
        {scanError && <div className="scan-error"><span>{scanError}</span><button onClick={() => setScanError('')}><X size={15}/></button></div>}

        {view === 'discover' && <>
          <section className="hero-card"><div className="hero-art"><div className="vinyl"><div/></div><div className="hero-cover"><Cover kind={current?.cover || 'ocean'} size="large"/></div></div><div className="hero-copy"><span className="eyebrow">继续收听</span><h2>{current?.title || ''}</h2><p>{current?.artist} · {current?.album}</p><div><button className="round-play" title={playing ? '暂停' : '播放'} onClick={togglePlay}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button className="soft-button" title="收藏" onClick={() => current && toggleFavorite(current.id)}><Heart size={17} fill={current && state.favorites.includes(current.id) ? 'currentColor' : 'none'}/></button><button className="soft-button" title="更多"><MoreHorizontal size={18}/></button></div></div></section>
          <div className="section-title"><h2>最近添加</h2><button onClick={() => setView('songs')}>查看全部 <ChevronRight size={15}/></button></div>
          <div className="album-grid">{state.tracks.slice(0, 4).map((track) => <button className="album-card" key={track.id} onDoubleClick={() => playTrack(track)}><div className="album-cover"><Cover kind={track.cover} size="large"/><span className="album-play" onClick={() => playTrack(track)}><Play size={18} fill="currentColor"/></span></div><strong>{track.album}</strong><span>{track.artist}</span></button>)}</div>
          <div className="section-title"><h2>静谧时刻</h2><button>查看更多 <ChevronRight size={15}/></button></div>
        </>}

        {view === 'albums' && <AlbumBrowser tracks={filtered} currentId={current?.id} favorites={state.favorites} onPlay={playTrack} onFavorite={toggleFavorite} onAdd={setAddToPlaylistTrack}/>}
        {view === 'artists' && <ArtistBrowser tracks={filtered} currentId={current?.id} favorites={state.favorites} onPlay={playTrack} onFavorite={toggleFavorite} onAdd={setAddToPlaylistTrack}/>}
        {view !== 'discover' && view !== 'settings' && view !== 'albums' && view !== 'artists' && <TrackTable tracks={filtered} currentId={current?.id} favorites={state.favorites} onPlay={playTrack} onFavorite={toggleFavorite} onAdd={view === 'playlist' ? undefined : setAddToPlaylistTrack} onRemove={view === 'playlist' ? removeTrackFromPlaylist : undefined} onReorder={view === 'playlist' ? reorderActivePlaylist : undefined}/>}
        {view === 'settings' && <SettingsPanel theme={theme} setTheme={setTheme} onImport={chooseMusicFolder} closeToTray={closeToTray} restorePlayback={restorePlayback} onSettingsChange={updateAppSettings} />}
      </section>
    </main>

    {nowPlayingOpen && <NowPlayingPage
      track={current}
      playing={playing}
      progress={progress}
      duration={duration || current?.duration || 0}
      volume={state.volume}
      playbackMode={playbackMode}
      favorite={Boolean(current && state.favorites.includes(current.id))}
      lyrics={lyrics}
      lyricsLoading={lyricsLoading}
      onClose={() => setNowPlayingOpen(false)}
      onTogglePlay={togglePlay}
      onPrevious={() => next(-1)}
      onNext={() => next()}
      onSeek={seekPlayer}
      onVolume={changeVolume}
      onFavorite={() => current && toggleFavorite(current.id)}
      onPlaybackMode={cyclePlaybackMode}
      onQueue={() => { setNowPlayingOpen(false); setQueueOpen(true) }}
    />}

    <footer className="player-bar">
      <div className="now-playing"><button className="now-playing-info" title="打开正在播放" onClick={() => setNowPlayingOpen(true)}><Cover kind={current?.cover || 'ocean'} size="normal"/><div><strong>{current?.title || '暂无播放'}</strong><span>{current?.artist || '请选择歌曲'}</span></div></button><button title="收藏" onClick={() => current && toggleFavorite(current.id)}><Heart size={17} fill={current && state.favorites.includes(current.id) ? 'currentColor' : 'none'}/></button></div>
      <div className="transport"><div className="transport-buttons"><PlaybackModeButton mode={playbackMode} onClick={cyclePlaybackMode} size={16}/><button onClick={() => next(-1)} title="上一首"><SkipBack size={19} fill="currentColor"/></button><button className="main-play" onClick={togglePlay} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button onClick={() => next()} title="下一首"><SkipForward size={19} fill="currentColor"/></button></div><div className="timeline"><span>{formatTime(progress)}</span><input type="range" min="0" max={duration || current?.duration || 1} value={progress} onChange={(e) => seekPlayer(Number(e.target.value))} style={{'--value': `${progress / (duration || current?.duration || 1) * 100}%`} as React.CSSProperties}/><span>{formatTime(duration || current?.duration || 0)}</span></div></div>
      <div className="player-tools"><button onClick={() => setQueueOpen(!queueOpen)} className={queueOpen ? 'selected' : ''} title="播放队列"><ListMusic size={18}/></button><button onClick={() => changeVolume(state.volume ? 0 : .72)} title={state.volume ? '静音' : '取消静音'}>{state.volume ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button><input className="volume" aria-label="音量" type="range" min="0" max="1" step=".01" value={state.volume} onChange={(e) => changeVolume(Number(e.target.value))} style={{'--value': `${state.volume * 100}%`} as React.CSSProperties}/><span className="volume-percent">{Math.round(state.volume * 100)}%</span><button onClick={() => setNowPlayingOpen(true)} title="打开正在播放"><Maximize2 size={16}/></button><button onClick={() => void toggleMiniMode()} title="迷你播放器"><ChevronDown size={17}/></button></div>
    </footer>

    {queueOpen && <QueuePanel tracks={state.queue.map((id) => state.tracks.find((track) => track.id === id)).filter(Boolean) as Track[]} currentId={current?.id} onClose={() => setQueueOpen(false)} onPlay={playTrack} onRemove={(id) => state.setQueue(state.queue.filter((item) => item !== id))}/>} 
    {importOpen && <Modal title="选择音乐目录" onClose={() => setImportOpen(false)}><div className="drop-zone" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer.files) }}><div className="drop-icon"><FolderPlus size={26}/></div><h3>选择音乐文件夹</h3><p>也可以将文件夹拖放到这里</p><small>将扫描其中的 MP3、FLAC、WAV、AAC、M4A 和 OGG</small><button>选择目录</button></div><input ref={setFolderInput} type="file" multiple accept="audio/*,.flac,.m4a,.ogg" hidden onChange={(e) => importFiles(e.target.files)}/></Modal>}
    {settingsOpen && <Modal title="设置" onClose={() => setSettingsOpen(false)}><SettingsPanel theme={theme} setTheme={setTheme} onImport={() => { setSettingsOpen(false); void chooseMusicFolder() }} closeToTray={closeToTray} restorePlayback={restorePlayback} onSettingsChange={updateAppSettings}/></Modal>}
    {playlistDialog && <Modal title={playlistDialog === 'create' ? '新建播放列表' : playlistDialog === 'rename' ? '重命名播放列表' : '删除播放列表'} onClose={() => setPlaylistDialog(null)}>{playlistDialog === 'delete' ? <div className="confirm-dialog"><p>确定删除“{activePlaylist?.name}”吗？歌曲文件不会被删除。</p><div><button onClick={() => setPlaylistDialog(null)}>取消</button><button className="danger-primary" onClick={() => void submitPlaylistDialog()}>删除</button></div></div> : <div className="playlist-form"><label>名称<input autoFocus maxLength={60} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitPlaylistDialog() }} placeholder="输入播放列表名称"/></label><div><button onClick={() => setPlaylistDialog(null)}>取消</button><button className="primary" disabled={!playlistName.trim()} onClick={() => void submitPlaylistDialog()}>保存</button></div></div>}</Modal>}
    {addToPlaylistTrack && <Modal title="添加到播放列表" onClose={() => setAddToPlaylistTrack(null)}><div className="playlist-picker"><div className="picker-track"><Cover kind={addToPlaylistTrack.cover} size="small"/><span><strong>{addToPlaylistTrack.title}</strong><small>{addToPlaylistTrack.artist}</small></span></div>{state.playlists.length ? state.playlists.map((playlist) => <button key={playlist.id} disabled={playlist.trackIds.includes(addToPlaylistTrack.id)} onClick={() => void addTrackToPlaylist(playlist, addToPlaylistTrack)}><span><i className="playlist-dot"/>{playlist.name}</span><small>{playlist.trackIds.includes(addToPlaylistTrack.id) ? '已添加' : `${playlist.trackIds.length} 首`}</small></button>) : <div className="picker-empty"><p>还没有播放列表</p><button onClick={() => { setAddToPlaylistTrack(null); openPlaylistDialog('create') }}>新建播放列表</button></div>}</div></Modal>}
    {scanning && <div className="scan-overlay"><div className="scan-card"><div className="scan-spinner"><Disc3 size={25}/></div><div><strong>正在扫描音乐库</strong><p>{scanProgress.total ? `已处理 ${scanProgress.processed} / ${scanProgress.total} 个文件` : '正在查找音乐文件…'}</p><small>{scanProgress.currentPath}</small></div><div className="scan-progress"><span style={{ width: `${scanProgress.total ? scanProgress.processed / scanProgress.total * 100 : 8}%` }}/></div></div></div>}
  </div>
}

function PlaybackModeButton({ mode, onClick, size = 16 }: { mode: PlaybackMode; onClick: () => void; size?: number }) {
  const labels: Record<PlaybackMode, string> = { sequence: '顺序播放', loop: '循环播放', shuffle: '随机播放', single: '单曲循环' }
  return <button className={`playback-mode-button mode-${mode}`} onClick={onClick} title={`${labels[mode]}（点击切换）`} aria-label={labels[mode]}>{mode === 'sequence' ? <ListEnd size={size}/> : mode === 'shuffle' ? <Shuffle size={size}/> : <Repeat size={size}/>} {mode === 'single' && <sup>1</sup>}</button>
}

function NowPlayingPage({ track, playing, progress, duration, volume, playbackMode, favorite, lyrics, lyricsLoading, onClose, onTogglePlay, onPrevious, onNext, onSeek, onVolume, onFavorite, onPlaybackMode, onQueue }: {
  track?: Track
  playing: boolean
  progress: number
  duration: number
  volume: number
  playbackMode: PlaybackMode
  favorite: boolean
  lyrics: LyricsPayload | null
  lyricsLoading: boolean
  onClose: () => void
  onTogglePlay: () => void
  onPrevious: () => void
  onNext: () => void
  onSeek: (value: number) => void
  onVolume: (value: number) => void
  onFavorite: () => void
  onPlaybackMode: () => void
  onQueue: () => void
}) {
  const parsedLyrics = useMemo(() => lyrics ? parseLyrics(lyrics.content) : { lines: [], synced: false }, [lyrics])
  const activeIndex = parsedLyrics.synced ? activeLyricIndex(parsedLyrics.lines, progress) : -1
  const lyricsScroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeIndex < 0) return
    lyricsScroll.current
      ?.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIndex])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return <section className="now-playing-page">
    <div className="now-playing-background" aria-hidden="true"><Cover kind={track?.cover || 'ocean'} size="large"/></div>
    <button className="now-playing-floating-back" onClick={onClose} title="返回音乐库"><ChevronLeft size={19}/><span>返回音乐库</span></button>
    <div className="now-playing-page-header">
      <div className="now-playing-header-title"><strong>正在播放</strong><span>{track?.album || '本地音乐'}</span></div>
      <div className="now-playing-header-actions"><button onClick={onQueue} title="播放队列"><ListMusic size={18}/></button></div>
    </div>

    <div className="now-playing-page-body">
      <div className="now-playing-art-column">
        <div className={`now-playing-art ${playing ? 'is-playing' : ''}`}><div className="art-shadow"/><Cover kind={track?.cover || 'ocean'} size="large"/></div>
        <div className="now-playing-meta"><span className="now-playing-kicker">{track?.format || '本地音频'}</span><h1>{track?.title || '暂无播放'}</h1><p>{track ? `${track.artist} · ${track.album}` : '请从音乐库中选择歌曲'}</p></div>
        <div className="now-playing-progress"><input type="range" min="0" max={duration || 1} value={progress} onChange={(event) => onSeek(Number(event.target.value))} style={{'--value': `${progress / (duration || 1) * 100}%`} as React.CSSProperties}/><div><span>{formatTime(progress)}</span><span>{formatTime(duration)}</span></div></div>
        <div className="now-playing-controls"><PlaybackModeButton mode={playbackMode} onClick={onPlaybackMode} size={18}/><button onClick={onPrevious} title="上一首"><SkipBack size={24} fill="currentColor"/></button><button className="now-playing-main-play" onClick={onTogglePlay} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={25} fill="currentColor"/> : <Play size={25} fill="currentColor"/>}</button><button onClick={onNext} title="下一首"><SkipForward size={24} fill="currentColor"/></button><button className={favorite ? 'selected' : ''} onClick={onFavorite} title={favorite ? '取消收藏' : '收藏'} aria-label={favorite ? '取消收藏' : '收藏'}><Heart size={21} fill={favorite ? 'currentColor' : 'none'}/></button></div>
        <div className="now-playing-volume"><button onClick={() => onVolume(volume ? 0 : .72)} title={volume ? '静音' : '取消静音'}>{volume ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button><input aria-label="音量" type="range" min="0" max="1" step=".01" value={volume} onChange={(event) => onVolume(Number(event.target.value))} style={{'--value': `${volume * 100}%`} as React.CSSProperties}/><span className="volume-percent">{Math.round(volume * 100)}%</span></div>
      </div>

      <div className="lyrics-column">
        <div className="lyrics-heading"><div><span className="now-playing-kicker">LYRICS</span><h2>歌词</h2></div>{lyrics && <span title={lyrics.sourcePath || '音频文件标签'}>{lyrics.source === 'sidecar' ? '同名 LRC' : '音频标签'}</span>}</div>
        <div className={`lyrics-scroll ${parsedLyrics.synced ? 'synced' : 'plain'}`} ref={lyricsScroll}>
          {lyricsLoading ? <div className="lyrics-state"><Disc3 size={28}/><strong>正在读取歌词</strong><span>请稍候…</span></div>
            : parsedLyrics.lines.length ? parsedLyrics.lines.map((line, index) => <button key={`${line.time}-${index}`} data-lyric-index={index} className={index === activeIndex ? 'active' : ''} onClick={() => line.time !== null && onSeek(line.time)}>{line.text}</button>)
            : <div className="lyrics-state"><Music2 size={30}/><strong>未找到歌词</strong><span>将与歌曲同名的 .lrc 文件放入歌曲目录，重新打开本页即可显示。</span><small>也支持音频文件标签中的内嵌歌词</small></div>}
        </div>
      </div>
    </div>
  </section>
}

function AlbumBrowser({ tracks, currentId, favorites, onPlay, onFavorite, onAdd }: {
  tracks: Track[]
  currentId?: string
  favorites: string[]
  onPlay: (track: Track) => void
  onFavorite: (id: string) => void
  onAdd: (track: Track) => void
}) {
  const [selectedAlbum, setSelectedAlbum] = useState('')
  const albums = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; tracks: Track[]; artists: string[] }>()
    tracks.forEach((track) => {
      const name = track.album.trim() || '未知专辑'
      const key = name.toLocaleLowerCase()
      const group = groups.get(key)
      if (group) {
        group.tracks.push(track)
        if (!group.artists.includes(track.artist)) group.artists.push(track.artist)
      } else {
        groups.set(key, { key, name, tracks: [track], artists: [track.artist] })
      }
    })
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [tracks])
  const activeAlbum = albums.find((album) => album.key === selectedAlbum)

  if (!albums.length) return <div className="empty"><Album size={38}/><h3>这里还没有专辑</h3><p>请选择音乐目录，或清除当前搜索。</p></div>

  if (activeAlbum) {
    const artistLabel = activeAlbum.artists.join('、')
    return <div className="album-detail">
      <div className="album-detail-header">
        <button className="album-back" onClick={() => setSelectedAlbum('')} title="返回全部专辑"><ChevronLeft size={18}/></button>
        <div className="album-detail-cover"><Cover kind={activeAlbum.tracks[0].cover} size="large"/></div>
        <div className="album-detail-copy"><span>专辑</span><h2>{activeAlbum.name}</h2><p>{artistLabel} · {activeAlbum.tracks.length} 首歌曲</p></div>
        <button className="album-play-all" onClick={() => onPlay(activeAlbum.tracks[0])}><Play size={17} fill="currentColor"/>播放专辑</button>
      </div>
      <TrackTable tracks={activeAlbum.tracks} currentId={currentId} favorites={favorites} onPlay={onPlay} onFavorite={onFavorite} onAdd={onAdd}/>
    </div>
  }

  return <div className="album-library-grid">{albums.map((album) => {
    const artistLabel = album.artists.slice(0, 2).join('、') + (album.artists.length > 2 ? ' 等' : '')
    return <button className="album-card" key={album.key} onClick={() => setSelectedAlbum(album.key)}>
      <div className="album-cover"><Cover kind={album.tracks[0].cover} size="large"/><span className="album-play"><ChevronRight size={18}/></span></div>
      <strong>{album.name}</strong>
      <span>{artistLabel} · {album.tracks.length} 首</span>
    </button>
  })}</div>
}

function ArtistBrowser({ tracks, currentId, favorites, onPlay, onFavorite, onAdd }: {
  tracks: Track[]
  currentId?: string
  favorites: string[]
  onPlay: (track: Track) => void
  onFavorite: (id: string) => void
  onAdd: (track: Track) => void
}) {
  const [selectedArtist, setSelectedArtist] = useState('')
  const artists = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; tracks: Track[]; albums: string[] }>()
    tracks.forEach((track) => {
      const name = track.artist.trim() || '未知歌手'
      const album = track.album.trim() || '未知专辑'
      const key = name.toLocaleLowerCase()
      const group = groups.get(key)
      if (group) {
        group.tracks.push(track)
        if (!group.albums.includes(album)) group.albums.push(album)
      } else {
        groups.set(key, { key, name, tracks: [track], albums: [album] })
      }
    })
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [tracks])
  const activeArtist = artists.find((artist) => artist.key === selectedArtist)

  if (!artists.length) return <div className="empty"><UserRound size={38}/><h3>这里还没有歌手</h3><p>请选择音乐目录，或清除当前搜索。</p></div>

  if (activeArtist) {
    return <div className="artist-detail">
      <div className="artist-detail-header">
        <button className="artist-back" onClick={() => setSelectedArtist('')} title="返回全部歌手"><ChevronLeft size={18}/></button>
        <div className="artist-detail-avatar"><Cover kind={activeArtist.tracks[0].cover} size="large"/></div>
        <div className="artist-detail-copy"><span>歌手</span><h2>{activeArtist.name}</h2><p>{activeArtist.albums.length} 张专辑 · {activeArtist.tracks.length} 首歌曲</p></div>
        <button className="artist-play-all" onClick={() => onPlay(activeArtist.tracks[0])}><Play size={17} fill="currentColor"/>播放歌手</button>
      </div>
      <TrackTable tracks={activeArtist.tracks} currentId={currentId} favorites={favorites} onPlay={onPlay} onFavorite={onFavorite} onAdd={onAdd}/>
    </div>
  }

  return <div className="artist-library-grid">{artists.map((artist) => <button className="artist-card" key={artist.key} onClick={() => setSelectedArtist(artist.key)}>
    <div className="artist-avatar"><Cover kind={artist.tracks[0].cover} size="large"/><span className="artist-open"><ChevronRight size={18}/></span></div>
    <strong>{artist.name}</strong>
    <span>{artist.albums.length} 张专辑 · {artist.tracks.length} 首</span>
  </button>)}</div>
}

function TrackTable({ tracks, currentId, favorites, onPlay, onFavorite, onAdd, onRemove, onReorder }: {
  tracks: Track[]
  currentId?: string
  favorites: string[]
  onPlay: (track: Track) => void
  onFavorite: (id: string) => void
  onAdd?: (track: Track) => void
  onRemove?: (id: string) => void
  onReorder?: (sourceId: string, targetId: string) => void
}) {
  if (!tracks.length) return <div className="empty"><Disc3 size={38}/><h3>这里还没有音乐</h3><p>请添加音乐文件夹，或清除当前搜索。</p></div>
  return <div className="track-table"><div className="track-head"><span>#</span><span>歌曲</span><span>专辑</span><span>格式</span><span>时长</span><span/></div>{tracks.map((track, index) => <div className={`track-row ${track.id === currentId ? 'playing' : ''}`} key={track.id} draggable={Boolean(onReorder)} onDragStart={(event) => event.dataTransfer.setData('text/plain', track.id)} onDragOver={(event) => { if (onReorder) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); onReorder?.(event.dataTransfer.getData('text/plain'), track.id) }} onDoubleClick={() => onPlay(track)}><span className="track-index">{track.id === currentId ? <AudioLines size={15}/> : index + 1}</span><div className="track-title"><Cover kind={track.cover} size="small"/><div><strong>{track.title}</strong><span>{track.artist}</span></div></div><span>{track.album}</span><span><em>{track.format}</em></span><span>{formatTime(track.duration)}</span><div className="row-actions"><button title="收藏" onClick={() => onFavorite(track.id)}><Heart size={15} fill={favorites.includes(track.id) ? 'currentColor' : 'none'}/></button>{onRemove ? <button title="从播放列表移除" onClick={() => onRemove(track.id)}><X size={16}/></button> : <button title="添加到播放列表" onClick={() => onAdd?.(track)}><Plus size={16}/></button>}</div></div>)}</div>
}

function QueuePanel({ tracks, currentId, onClose, onPlay, onRemove }: { tracks: Track[]; currentId?: string; onClose: () => void; onPlay: (track: Track) => void; onRemove: (id: string) => void }) {
  return <aside className="queue-panel"><div className="panel-header"><div><h2>播放队列</h2><p>共 {tracks.length} 首歌曲</p></div><button title="关闭" onClick={onClose}><X size={18}/></button></div><div className="queue-list">{tracks.map((track) => <div className={track.id === currentId ? 'current' : ''} key={track.id} onDoubleClick={() => onPlay(track)}><span className="drag">⠿</span><Cover kind={track.cover} size="small"/><span><strong>{track.title}</strong><small>{track.artist}</small></span><small>{formatTime(track.duration)}</small><button title="从队列移除" onClick={() => onRemove(track.id)}><X size={14}/></button></div>)}</div></aside>
}

function SettingsPanel({ theme, setTheme, onImport, closeToTray, restorePlayback, onSettingsChange }: {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  onImport: () => void
  closeToTray: boolean
  restorePlayback: boolean
  onSettingsChange: (settings: Partial<AppSettings>) => void
}) {
  return <div className="settings-panel"><div className="setting-row"><div><strong>音乐文件夹</strong><span>选择轻音乐扫描音频文件的位置</span></div><button onClick={onImport}>管理</button></div><div className="setting-row"><div><strong>外观</strong><span>选择应用界面主题</span></div><div className="segmented"><button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>浅色</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>深色</button></div></div><div className="setting-row"><div><strong>恢复播放状态</strong><span>记住上次播放的歌曲、音量和模式</span></div><label className="switch"><input type="checkbox" checked={restorePlayback} onChange={(event) => onSettingsChange({ restorePlayback: event.target.checked })}/><span/></label></div><div className="setting-row"><div><strong>关闭窗口时</strong><span>进入系统托盘并继续播放；关闭后可从托盘重新打开</span></div><label className="switch"><input type="checkbox" checked={closeToTray} onChange={(event) => onSettingsChange({ closeToTray: event.target.checked })}/><span/></label></div><div className="setting-row"><div><strong>音乐库缓存</strong><span>歌曲信息和封面仅保存在本地</span></div><button title="后续版本提供">清理缓存</button></div><div className="about"><div className="brand-mark"><AudioLines size={17}/></div><span><strong>轻音乐 0.1.0</strong><small>本地优先，无需账号，不依赖云端。</small></span></div></div>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-title"><h2>{title}</h2><button onClick={onClose}><X size={18}/></button></div>{children}</div></div>
}

export default App
