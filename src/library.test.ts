import { describe, expect, it } from 'vitest'
import { formatTime } from './library'

describe('formatTime', () => {
  it('formats whole minutes and seconds', () => {
    expect(formatTime(252)).toBe('4:12')
  })

  it('handles invalid and negative values', () => {
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(-12)).toBe('0:00')
  })
})
