import type { Track } from './types'

export function moveQueueItem(queue: string[], sourceId: string, targetId: string): string[] {
  if (sourceId === targetId) return queue
  const source = queue.indexOf(sourceId)
  const target = queue.indexOf(targetId)
  if (source < 0 || target < 0) return queue
  const next = [...queue]
  next.splice(target, 0, next.splice(source, 1)[0])
  return next
}

export function createTitleSortedQueue(tracks: Track[]): string[] {
  const compare = (left: string, right: string) => left.localeCompare(right, 'zh-CN', { sensitivity: 'base', numeric: true })
  return tracks
    .filter((track) => track.valid !== false)
    .sort((left, right) => compare(left.title, right.title) || compare(left.artist, right.artist))
    .map((track) => track.id)
}

export function isDatabaseInsertionOrder(queue: string[]) {
  const ids = queue.map((id) => Number(id.match(/^db-(\d+)$/)?.[1]))
  return ids.length > 0 && ids.every(Number.isFinite) && ids.every((id, index) => index === 0 || ids[index - 1] <= id)
}
