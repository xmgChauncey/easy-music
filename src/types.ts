export type Track = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  format: string
  year?: number
  cover: string
  url?: string
  path?: string
  favorite?: boolean
  valid?: boolean
}

export type View = 'discover' | 'songs' | 'albums' | 'artists' | 'favorites' | 'recent' | 'settings'
export type RepeatMode = 'off' | 'all' | 'one'

export type Playlist = { id: string; name: string; trackIds: string[] }
