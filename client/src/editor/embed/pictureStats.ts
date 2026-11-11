/**
 * THE EMBED PICTURE CACHE'S SIZE (YAZ-4825 item 27), apart from the cache: Settings › Memory shows it, and the cache
 * itself lives in the lazy window chunk (`boardPictures.ts`), which Settings must not load. The cache writes here each
 * time a picture settles or leaves; nothing here grows.
 *
 * THE SLEEP'S SWEEP (item 27, A5), apart from the cache for the same reason: a tab that goes to sleep asks for it
 * (`useWorkspace`), and the window chunk, once loaded, does it — 1 s later, when the slept editors have unmounted. Before
 * the chunk loads there is no picture, and nothing to do. One timer at most.
 */
let count = 0
let bytes = 0

/** How many embed pictures the cache holds now, and their SVG text's size in bytes (an estimate of their memory). */
export function embedPictureStats(): { count: number; bytes: number } {
  return { count, bytes }
}

/** The cache's door: its new totals. */
export function setEmbedPictureStats(nextCount: number, nextBytes: number): void {
  count = nextCount
  bytes = nextBytes
}

/** The sleep's sweep waits this long: a slept editor's windows go when its editor is destroyed, after the render. */
export const SWEEP_DELAY_MS = 1000
let sweep: (() => void) | null = null
let sweepTimer: ReturnType<typeof setTimeout> | undefined

/** The window chunk's door: the sweep itself. */
export function setEmbedPictureSweep(fn: () => void): void {
  sweep = fn
}

/** A tab went to sleep: each picture that no mounted window shows leaves the cache, soon. */
export function sweepEmbedPicturesSoon(): void {
  if (sweep === null) return
  clearTimeout(sweepTimer)
  sweepTimer = setTimeout(() => {
    sweepTimer = undefined
    sweep?.()
  }, SWEEP_DELAY_MS)
}
