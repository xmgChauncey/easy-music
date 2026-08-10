import type { Track } from './types'

export type TrackSortKey = 'title' | 'artist'
export type SortDirection = 'asc' | 'desc'

export function sortTracks(tracks: Track[], key?: TrackSortKey, direction: SortDirection = 'asc') {
  if (!key) return tracks
  const factor = direction === 'asc' ? 1 : -1
  const secondary: TrackSortKey = key === 'title' ? 'artist' : 'title'
  const compare = (left: string, right: string) => left.localeCompare(right, 'zh-CN', { sensitivity: 'base', numeric: true })
  return [...tracks].sort((left, right) => factor * (compare(left[key], right[key]) || compare(left[secondary], right[secondary])))
}
