/**
 * THE EMBED PICTURE CACHE'S SIZE (YAZ-4825 item 27), apart from the cache: Settings › Memory shows it, and the cache
 * itself lives in the lazy window chunk (`boardPictures.ts`), which Settings must not load. The cache writes here each
 * time a picture settles or leaves; nothing here grows.
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
