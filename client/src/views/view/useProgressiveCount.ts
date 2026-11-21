import { useEffect, useRef, useState, type RefObject } from 'react'

/** Initial and incremental render batch size for large ungrouped Folder Views (YAZ-6028). */
export const PROGRESSIVE_BATCH = 150

/**
 * Progressively expands the rendered slice of a large row list/grid (`> PROGRESSIVE_BATCH`) as
 * the trailing sentinel nears the viewport. When `total <= PROGRESSIVE_BATCH` or in environments
 * without `IntersectionObserver` (jsdom), renders every row immediately with zero overhead.
 */
export function useProgressiveCount(total: number, batch = PROGRESSIVE_BATCH): { shown: number; sentinelRef: RefObject<HTMLDivElement | null> } {
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const [limit, setLimit] = useState(batch)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const shown = !canObserve || total <= batch ? total : Math.min(total, limit)

  useEffect(() => {
    setLimit(batch)
  }, [batch, total <= batch])

  useEffect(() => {
    if (!canObserve || shown >= total) return
    const el = sentinelRef.current
    if (el === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((prev) => Math.min(total, prev + batch))
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [canObserve, shown, total, batch])

  return { shown, sentinelRef }
}
