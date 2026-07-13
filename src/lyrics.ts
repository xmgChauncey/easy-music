export type LyricLine = {
  time: number | null
  text: string
}

export type ParsedLyrics = {
  lines: LyricLine[]
  synced: boolean
}

const timestampPattern = /\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g
const enhancedTimestampPattern = /[<＜](\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)[>＞]/g
const metadataPattern = /^\[(ar|al|ti|by|re|ve|length|offset):/i

function timestampSeconds(match: RegExpMatchArray, offset: number): number {
  return Math.max(0, Number(match[1]) * 60 + Number(match[2].replace(':', '.')) + offset)
}

export function parseLyrics(content: string): ParsedLyrics {
  const sourceLines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const offsetMatch = content.match(/\[offset:([+-]?\d+)\]/i)
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0
  const timed: LyricLine[] = []
  let previousEnhancedTime = -1

  for (const sourceLine of sourceLines) {
    if (metadataPattern.test(sourceLine.trim())) continue
    const timestamps = [...sourceLine.matchAll(timestampPattern)]
    const enhancedTimestamps = [...sourceLine.matchAll(enhancedTimestampPattern)]
    const text = sourceLine.replace(timestampPattern, '').replace(enhancedTimestampPattern, '').trim()
    if (!text) continue
    if (timestamps.length) {
      for (const match of timestamps) timed.push({ time: timestampSeconds(match, offset), text })
      continue
    }
    if (enhancedTimestamps.length) {
      const times = enhancedTimestamps.map((match) => timestampSeconds(match, offset))
      let lineTime = times[0]
      if (lineTime < previousEnhancedTime - .001) {
        lineTime = times.find((time) => time >= previousEnhancedTime - .001) ?? lineTime
      }
      previousEnhancedTime = lineTime
      timed.push({ time: lineTime, text })
    }
  }

  if (timed.length) {
    timed.sort((left, right) => (left.time || 0) - (right.time || 0))
    return { lines: timed, synced: true }
  }

  const plain = sourceLines
    .map((line) => line.replace(enhancedTimestampPattern, '').trim())
    .filter((line) => line && !metadataPattern.test(line))
    .map((text) => ({ time: null, text }))
  return { lines: plain, synced: false }
}

export function activeLyricIndex(lines: LyricLine[], progress: number): number {
  let active = -1
  for (let index = 0; index < lines.length; index += 1) {
    const time = lines[index].time
    if (time === null || time > progress + .08) break
    active = index
  }
  return active
}
