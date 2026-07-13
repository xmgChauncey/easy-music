import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Album, AudioLines, ChevronDown, ChevronLeft, ChevronRight, Disc3, FolderPlus,
  Heart, Home, ListMusic, Maximize2, Minimize2, MoreHorizontal, Music2, Pause,
  Play, Plus, Repeat, Search, Settings, Shuffle, SkipBack, SkipForward, SlidersHorizontal,
  Sparkles, Star, UserRound, Volume2, VolumeX, X,
} from 'lucide-react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { demoTracks, formatTime } from './library'
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
  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
}), { name: 'easy-music-state', partialize: (state) => ({ currentId: state.currentId, volume: state.volume, repeat: state.repeat, shuffle: state.shuffle, favorites: state.favorites, recent: state.recent, playlists: state.playlists }) }))

const nav = [
  { id: 'discover', label: '发现', icon: Home },
  { id: 'songs', label: '歌曲', icon: Music2 },
  { id: 'albums', label: '专辑', icon: Album },
  { id: 'artists', label: '歌手', icon: UserRound },
] as const

function Cover({ kind, size = 'normal' }: { kind: string; size?: 'small' | 'normal' | 'large' }) {
  return <div className={`cover cover-${kind} cover-${size}`}><span>{kind === 'paper' ? '◒' : ''}</span></div>
}

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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('easy-theme') as 'light' | 'dark') || 'light')
  const fileInput = useRef<HTMLInputElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const current = state.tracks.find((track) => track.id === state.currentId) || state.tracks[0]

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('easy-theme', theme) }, [theme])
  useEffect(() => { if (audio.current) audio.current.volume = state.volume }, [state.volume])
  useEffect(() => {
    if (!audio.current || !current?.url) return
    audio.current.src = current.url
    if (playing) audio.current.play().catch(() => setPlaying(false))
  }, [current?.id])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const base = view === 'favorites' ? state.tracks.filter((track) => state.favorites.includes(track.id))
      : view === 'recent' ? state.recent.map((id) => state.tracks.find((track) => track.id === id)).filter(Boolean) as Track[]
      : state.tracks
    return query ? base.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query)) : base
  }, [search, state.tracks, state.favorites, state.recent, view])

  const playTrack = (track: Track) => {
    state.setCurrent(track.id)
    if (!track.url) { setPlaying(false); setProgress(0); return }
    setPlaying(true)
    setTimeout(() => audio.current?.play().catch(() => setPlaying(false)), 0)
  }

  const togglePlay = () => {
    if (!current?.url) { setImportOpen(true); return }
    if (playing) audio.current?.pause()
    else audio.current?.play().catch(() => setPlaying(false))
    setPlaying(!playing)
  }

  const next = (direction = 1) => {
    const queue = state.shuffle ? [...state.queue].sort(() => Math.random() - .5) : state.queue
    const index = queue.indexOf(current?.id)
    const target = queue[(index + direction + queue.length) % queue.length]
    const track = state.tracks.find((item) => item.id === target)
    if (track) playTrack(track)
  }

  const importFiles = (files: FileList | null) => {
    if (!files?.length) return
    const accepted = Array.from(files).filter((file) => /\.(mp3|flac|wav|aac|m4a|ogg)$/i.test(file.name))
    const added = accepted.map((file, index): Track => ({
      id: `local-${file.lastModified}-${file.size}-${index}`,
      title: file.name.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, ''),
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

  const pageTitle = view === 'discover' ? '下午好' : ({ songs: '歌曲', albums: '专辑', artists: '歌手', favorites: '我的收藏', recent: '最近播放', settings: '设置' } as Record<View, string>)[view]

  return <div className="app-shell">
    <audio ref={audio} onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); if (current) current.duration = Math.round(event.currentTarget.duration) }} onEnded={() => state.repeat === 'one' ? (audio.current!.currentTime = 0, audio.current!.play()) : next()} />
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={19} /></div><span>轻音乐</span></div>
      <div className="side-label">音乐库</div>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18}/>{label}</button>)}</nav>
      <div className="side-label section-gap">我的音乐</div>
      <nav>
        <button className={view === 'favorites' ? 'active' : ''} onClick={() => setView('favorites')}><Heart size={18}/>我的收藏</button>
        <button className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}><Sparkles size={18}/>最近播放</button>
      </nav>
      <div className="side-label section-gap playlist-label"><span>播放列表</span><Plus size={14}/></div>
      <nav className="playlists">{state.playlists.map((playlist) => <button key={playlist.id}><span className="playlist-dot"/>{playlist.name === 'Morning calm' ? '清晨舒缓' : playlist.name === 'On the road' ? '公路旅行' : playlist.name}</button>)}</nav>
      <div className="side-bottom"><button onClick={() => setSettingsOpen(true)}><Settings size={18}/>设置</button><div className="library-stat"><div><Disc3 size={20}/><span><b>{state.tracks.length} 首歌曲</b><small>本地音乐库</small></span></div><ChevronRight size={16}/></div></div>
    </aside>

    <main className="main">
      <header><div className="history"><button title="后退"><ChevronLeft size={19}/></button><button title="前进" disabled><ChevronRight size={19}/></button></div><label className="search"><Search size={17}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索歌曲、歌手或专辑…"/><kbd>⌘ K</kbd></label><div className="window-actions"><button title="最小化"><Minimize2 size={14}/></button><button title="最大化"><Maximize2 size={14}/></button><button title="关闭"><X size={15}/></button></div></header>
      <section className="content">
        <div className="page-heading"><div><h1>{pageTitle}</h1><p>{view === 'discover' ? '继续享受上次的音乐时光。' : `本地音乐库中共 ${filtered.length} 项`}</p></div><button className="import-button" onClick={() => setImportOpen(true)}><FolderPlus size={17}/>添加音乐</button></div>

        {view === 'discover' && <>
          <section className="hero-card"><div className="hero-art"><div className="vinyl"><div/></div><div className="hero-cover"><Cover kind={current?.cover || 'ocean'} size="large"/></div></div><div className="hero-copy"><span className="eyebrow">继续收听</span><h2>{current?.title}</h2><p>{current?.artist} · {current?.album}</p><div><button className="round-play" title={playing ? '暂停' : '播放'} onClick={togglePlay}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button className="soft-button" title="收藏" onClick={() => current && state.toggleFavorite(current.id)}><Heart size={17} fill={current && state.favorites.includes(current.id) ? 'currentColor' : 'none'}/></button><button className="soft-button" title="更多"><MoreHorizontal size={18}/></button></div></div></section>
          <div className="section-title"><h2>最近添加</h2><button onClick={() => setView('songs')}>查看全部 <ChevronRight size={15}/></button></div>
          <div className="album-grid">{state.tracks.slice(0, 4).map((track) => <button className="album-card" key={track.id} onDoubleClick={() => playTrack(track)}><div className="album-cover"><Cover kind={track.cover} size="large"/><span className="album-play" onClick={() => playTrack(track)}><Play size={18} fill="currentColor"/></span></div><strong>{track.album}</strong><span>{track.artist}</span></button>)}</div>
          <div className="section-title"><h2>静谧时刻</h2><button>查看更多 <ChevronRight size={15}/></button></div>
        </>}

        {view !== 'discover' && view !== 'settings' && <TrackTable tracks={filtered} currentId={current?.id} favorites={state.favorites} onPlay={playTrack} onFavorite={state.toggleFavorite}/>} 
        {view === 'settings' && <SettingsPanel theme={theme} setTheme={setTheme} onImport={() => setImportOpen(true)} />}
      </section>
    </main>

    <footer className="player-bar">
      <div className="now-playing"><Cover kind={current?.cover || 'ocean'} size="normal"/><div><strong>{current?.title || '暂无播放'}</strong><span>{current?.artist || '请选择歌曲'}</span></div><button title="收藏" onClick={() => current && state.toggleFavorite(current.id)}><Heart size={17} fill={current && state.favorites.includes(current.id) ? 'currentColor' : 'none'}/></button></div>
      <div className="transport"><div className="transport-buttons"><button className={state.shuffle ? 'selected' : ''} onClick={state.toggleShuffle}><Shuffle size={16}/></button><button onClick={() => next(-1)}><SkipBack size={19} fill="currentColor"/></button><button className="main-play" onClick={togglePlay}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button onClick={() => next()}><SkipForward size={19} fill="currentColor"/></button><button className={state.repeat !== 'off' ? 'selected' : ''} onClick={() => state.setRepeat(state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off')}><Repeat size={16}/>{state.repeat === 'one' && <sup>1</sup>}</button></div><div className="timeline"><span>{formatTime(progress)}</span><input type="range" min="0" max={duration || current?.duration || 1} value={progress} onChange={(e) => { const value = Number(e.target.value); setProgress(value); if (audio.current) audio.current.currentTime = value }} style={{'--value': `${progress / (duration || current?.duration || 1) * 100}%`} as React.CSSProperties}/><span>{formatTime(duration || current?.duration || 0)}</span></div></div>
      <div className="player-tools"><button onClick={() => setQueueOpen(!queueOpen)} className={queueOpen ? 'selected' : ''}><ListMusic size={18}/></button><button onClick={() => state.setVolume(state.volume ? 0 : .72)}>{state.volume ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button><input className="volume" type="range" min="0" max="1" step=".01" value={state.volume} onChange={(e) => state.setVolume(Number(e.target.value))} style={{'--value': `${state.volume * 100}%`} as React.CSSProperties}/><button><ChevronDown size={17}/></button></div>
    </footer>

    {queueOpen && <QueuePanel tracks={state.queue.map((id) => state.tracks.find((track) => track.id === id)).filter(Boolean) as Track[]} currentId={current?.id} onClose={() => setQueueOpen(false)} onPlay={playTrack} onRemove={(id) => state.setQueue(state.queue.filter((item) => item !== id))}/>} 
    {importOpen && <Modal title="添加音乐" onClose={() => setImportOpen(false)}><div className="drop-zone" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer.files) }}><div className="drop-icon"><FolderPlus size={26}/></div><h3>选择音乐文件</h3><p>也可以将文件拖放到这里</p><small>支持 MP3、FLAC、WAV、AAC、M4A 和 OGG</small><button>选择文件</button></div><input ref={fileInput} type="file" multiple accept="audio/*,.flac,.m4a,.ogg" hidden onChange={(e) => importFiles(e.target.files)}/></Modal>}
    {settingsOpen && <Modal title="设置" onClose={() => setSettingsOpen(false)}><SettingsPanel theme={theme} setTheme={setTheme} onImport={() => { setSettingsOpen(false); setImportOpen(true) }}/></Modal>}
  </div>
}

function TrackTable({ tracks, currentId, favorites, onPlay, onFavorite }: { tracks: Track[]; currentId?: string; favorites: string[]; onPlay: (track: Track) => void; onFavorite: (id: string) => void }) {
  if (!tracks.length) return <div className="empty"><Disc3 size={38}/><h3>这里还没有音乐</h3><p>请添加音乐文件夹，或清除当前搜索。</p></div>
  return <div className="track-table"><div className="track-head"><span>#</span><span>歌曲</span><span>专辑</span><span>格式</span><span>时长</span><span/></div>{tracks.map((track, index) => <div className={`track-row ${track.id === currentId ? 'playing' : ''}`} key={track.id} onDoubleClick={() => onPlay(track)}><span className="track-index">{track.id === currentId ? <AudioLines size={15}/> : index + 1}</span><div className="track-title"><Cover kind={track.cover} size="small"/><div><strong>{track.title}</strong><span>{track.artist}</span></div></div><span>{track.album}</span><span><em>{track.format}</em></span><span>{formatTime(track.duration)}</span><div className="row-actions"><button title="收藏" onClick={() => onFavorite(track.id)}><Heart size={15} fill={favorites.includes(track.id) ? 'currentColor' : 'none'}/></button><button title="更多"><MoreHorizontal size={17}/></button></div></div>)}</div>
}

function QueuePanel({ tracks, currentId, onClose, onPlay, onRemove }: { tracks: Track[]; currentId?: string; onClose: () => void; onPlay: (track: Track) => void; onRemove: (id: string) => void }) {
  return <aside className="queue-panel"><div className="panel-header"><div><h2>播放队列</h2><p>共 {tracks.length} 首歌曲</p></div><button title="关闭" onClick={onClose}><X size={18}/></button></div><div className="queue-list">{tracks.map((track) => <div className={track.id === currentId ? 'current' : ''} key={track.id} onDoubleClick={() => onPlay(track)}><span className="drag">⠿</span><Cover kind={track.cover} size="small"/><span><strong>{track.title}</strong><small>{track.artist}</small></span><small>{formatTime(track.duration)}</small><button title="从队列移除" onClick={() => onRemove(track.id)}><X size={14}/></button></div>)}</div></aside>
}

function SettingsPanel({ theme, setTheme, onImport }: { theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void; onImport: () => void }) {
  return <div className="settings-panel"><div className="setting-row"><div><strong>音乐文件夹</strong><span>选择轻音乐扫描音频文件的位置</span></div><button onClick={onImport}>管理</button></div><div className="setting-row"><div><strong>外观</strong><span>选择应用界面主题</span></div><div className="segmented"><button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>浅色</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>深色</button></div></div><div className="setting-row"><div><strong>恢复播放状态</strong><span>记住上次播放的歌曲、音量和模式</span></div><label className="switch"><input type="checkbox" defaultChecked/><span/></label></div><div className="setting-row"><div><strong>关闭窗口时</strong><span>进入系统托盘并继续播放</span></div><label className="switch"><input type="checkbox"/><span/></label></div><div className="setting-row"><div><strong>音乐库缓存</strong><span>歌曲信息和封面仅保存在本地</span></div><button>清理缓存</button></div><div className="about"><div className="brand-mark"><AudioLines size={17}/></div><span><strong>轻音乐 0.1.0</strong><small>本地优先，无需账号，不依赖云端。</small></span></div></div>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-title"><h2>{title}</h2><button onClick={onClose}><X size={18}/></button></div>{children}</div></div>
}

export default App
