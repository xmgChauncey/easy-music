import type { RepeatMode } from './types'

export type PlaybackMode = 'sequence' | 'loop' | 'shuffle' | 'single'

export function resolvePlaybackMode(repeat: RepeatMode, shuffle: boolean): PlaybackMode {
  if (shuffle) return 'shuffle'
  if (repeat === 'one') return 'single'
  if (repeat === 'all') return 'loop'
  return 'sequence'
}

export function nextPlaybackMode(mode: PlaybackMode): PlaybackMode {
  return ({ sequence: 'loop', loop: 'shuffle', shuffle: 'single', single: 'sequence' } as const)[mode]
}

export function playbackStateForMode(mode: PlaybackMode): { repeat: RepeatMode; shuffle: boolean } {
  return {
    repeat: mode === 'single' ? 'one' : mode === 'sequence' ? 'off' : 'all',
    shuffle: mode === 'shuffle',
  }
}
