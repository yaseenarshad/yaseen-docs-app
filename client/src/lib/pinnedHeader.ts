/**
 * Rows that stay at the top of the scroller while a long table scrolls past (the folder page's
 * header, GRO-2136; a page table's frozen rows, YAZ-3769 S3). Native `position: sticky` cannot do it:
 * the table sits in a sideways scroll box, which is the sticky rows' scroll container. So the rows
 * are moved down by a counter-scroll offset instead (`translateY`), and that offset stops at the
 * table's end.
 */

/** The first ancestor above `node` that owns vertical scrolling. */
export function verticalScrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return parent
  }
  return null
}

/** Native-sticky boundaries expressed as a counter-scroll offset: 0 above the scroller's top, at most the table's height less the pinned rows'. */
export function pinnedHeaderOffset(scrollerTop: number, tableTop: number, tableHeight: number, headerHeight: number): number {
  return Math.max(0, Math.min(scrollerTop - tableTop, Math.max(0, tableHeight - headerHeight)))
}

/** One scroller's observer and, per watched element, who wants to know. */
interface NearWatcher {
  observer: IntersectionObserver
  targets: Map<Element, Set<(near: boolean) => void>>
}
const watchers = new WeakMap<HTMLElement, NearWatcher>()

/**
 * Calls `onNear` when `target` comes within one scroller height of `scroller`'s box (its own height above and below),
 * and again when it leaves (YAZ-4834 P4): a pinned table far off the screen does no work on a scroll. ONE
 * `IntersectionObserver` per scroller, shared by every pinned table in it; it goes when the last table stops watching.
 * The observer reports after the frame in which the table came near, so the margin keeps a fast scroll from showing a
 * table before its rows caught up. Returns the stop.
 */
export function watchNear(scroller: HTMLElement, target: Element, onNear: (near: boolean) => void): () => void {
  let watcher = watchers.get(scroller)
  if (watcher === undefined) {
    const targets: NearWatcher['targets'] = new Map()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) for (const listener of targets.get(entry.target) ?? []) listener(entry.isIntersecting)
      },
      { root: scroller, rootMargin: '100% 0px' },
    )
    watchers.set(scroller, (watcher = { observer, targets }))
  }
  const { observer, targets } = watcher
  let listeners = targets.get(target)
  if (listeners === undefined) {
    targets.set(target, (listeners = new Set()))
    observer.observe(target)
  }
  listeners.add(onNear)
  return () => {
    listeners.delete(onNear)
    if (listeners.size > 0) return
    targets.delete(target)
    observer.unobserve(target)
    if (targets.size > 0) return
    observer.disconnect()
    watchers.delete(scroller)
  }
}
