import { describe, expect, it } from 'vitest'
import { createTitleSortedQueue, isDatabaseInsertionOrder, moveQueueItem } from './queueOrder'
import type { Track } from './types'

describe('moveQueueItem', () => {
  it('moves an item before the drop target', () => {
    expect(moveQueueItem(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('keeps the same array for invalid and no-op moves', () => {
    const queue = ['a', 'b']
    expect(moveQueueItem(queue, 'a', 'a')).toBe(queue)
    expect(moveQueueItem(queue, 'missing', 'a')).toBe(queue)
  })
})

describe('createTitleSortedQueue', () => {
  const tracks = [
    { id: 'db-12', title: 'Song 10', artist: 'Beta', valid: true },
    { id: 'db-3', title: 'Song 2', artist: 'Alpha', valid: true },
    { id: 'db-8', title: 'Another', artist: 'Gamma', valid: false },
    { id: 'db-5', title: 'Another', artist: 'Delta', valid: true },
  ] as Track[]

  it('orders valid tracks by title and then artist', () => {
    expect(createTitleSortedQueue(tracks)).toEqual(['db-5', 'db-3', 'db-12'])
  })

  it('detects a legacy database insertion order', () => {
    expect(isDatabaseInsertionOrder(['db-3', 'db-5', 'db-12'])).toBe(true)
    expect(isDatabaseInsertionOrder(['db-5', 'db-3'])).toBe(false)
  })
})
