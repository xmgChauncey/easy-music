import { describe, expect, it } from 'vitest'
import { moveQueueItem } from './queueOrder'

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
