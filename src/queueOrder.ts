export function moveQueueItem(queue: string[], sourceId: string, targetId: string): string[] {
  if (sourceId === targetId) return queue
  const source = queue.indexOf(sourceId)
  const target = queue.indexOf(targetId)
  if (source < 0 || target < 0) return queue
  const next = [...queue]
  next.splice(target, 0, next.splice(source, 1)[0])
  return next
}
