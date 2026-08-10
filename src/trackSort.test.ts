import { describe, expect, it } from 'vitest'
import { sortTracks } from './trackSort'
import type { Track } from './types'

const track = (id: string, title: string, artist: string): Track => ({
  id, title, artist, album: '', duration: 0, format: 'MP3', cover: 'ocean',
})

describe('sortTracks', () => {
  const tracks = [track('1', 'Song 10', 'Beta'), track('2', 'Song 2', 'Alpha'), track('3', 'Another', 'Gamma')]

  it('sorts by title using natural number order', () => {
    expect(sortTracks(tracks, 'title').map((item) => item.id)).toEqual(['3', '2', '1'])
  })

  it('sorts by artist in either direction', () => {
    expect(sortTracks(tracks, 'artist', 'asc').map((item) => item.id)).toEqual(['2', '1', '3'])
    expect(sortTracks(tracks, 'artist', 'desc').map((item) => item.id)).toEqual(['3', '1', '2'])
  })
})
