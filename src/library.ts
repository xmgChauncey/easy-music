import type { Track } from './types'

export const demoTracks: Track[] = [
  { id: '1', title: '地平线', artist: '海岸乐队', album: '晴空之下', duration: 252, format: 'FLAC', year: 2025, cover: 'ocean', favorite: true, valid: true },
  { id: '2', title: '柔光', artist: '米拉', album: '白日梦', duration: 218, format: 'MP3', year: 2024, cover: 'flower', valid: true },
  { id: '3', title: '余晖', artist: '夜枭乐队', album: '午夜电台', duration: 287, format: 'FLAC', year: 2023, cover: 'sunset', favorite: true, valid: true },
  { id: '4', title: '静谧时光', artist: '乔恩', album: '归家', duration: 194, format: 'M4A', year: 2025, cover: 'window', valid: true },
  { id: '5', title: '蓝色星期日', artist: '六月港湾', album: '潮汐记忆', duration: 231, format: 'WAV', year: 2022, cover: 'blue', valid: true },
  { id: '6', title: '纸飞机', artist: '米拉', album: '白日梦', duration: 206, format: 'AAC', year: 2024, cover: 'paper', valid: true },
  { id: '7', title: '小小胜利', artist: '海岸乐队', album: '晴空之下', duration: 243, format: 'OGG', year: 2025, cover: 'hills', valid: true },
]

export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
