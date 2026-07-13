import { describe, expect, it } from 'vitest'
import { nextPlaybackMode, playbackStateForMode, resolvePlaybackMode } from './playbackMode'

describe('播放方式', () => {
  it('按指定顺序循环切换', () => {
    expect(nextPlaybackMode('sequence')).toBe('loop')
    expect(nextPlaybackMode('loop')).toBe('shuffle')
    expect(nextPlaybackMode('shuffle')).toBe('single')
    expect(nextPlaybackMode('single')).toBe('sequence')
  })

  it('正确映射到底层播放状态', () => {
    expect(playbackStateForMode('sequence')).toEqual({ repeat: 'off', shuffle: false })
    expect(playbackStateForMode('loop')).toEqual({ repeat: 'all', shuffle: false })
    expect(playbackStateForMode('shuffle')).toEqual({ repeat: 'all', shuffle: true })
    expect(playbackStateForMode('single')).toEqual({ repeat: 'one', shuffle: false })
  })

  it('能从持久化状态恢复播放方式', () => {
    expect(resolvePlaybackMode('off', false)).toBe('sequence')
    expect(resolvePlaybackMode('all', false)).toBe('loop')
    expect(resolvePlaybackMode('all', true)).toBe('shuffle')
    expect(resolvePlaybackMode('one', false)).toBe('single')
  })
})
