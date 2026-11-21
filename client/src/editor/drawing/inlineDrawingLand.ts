/**
 * LANDING ON AN INLINE DRAWING IN ITS PAGE (YAZ-6143 / Show in page): mirrors `landOnCard` /
 * `watchCardLanding` / `takeCardLanding` in `editor/card/cardOpen.ts`.
 *
 * `landOnInlineDrawing(path, index)` asks for a smooth scroll + yellow highlight flash (`landWhenShown`)
 * on the `index`-th (0-based) inline drawing of `path`. If its `InlineDrawingView` is already mounted
 * (the page is already open), the watcher takes it immediately; otherwise the next view mounted for
 * `(path, index)` consumes it via `takeInlineDrawingLanding`.
 */
import { landWhenShown } from '../card/cardOpen'

export { landWhenShown }

const LANDING_MS = 5 * 60 * 1000
const landings = new Map<string, number>()
const landingKey = (path: string, index: number): string => `${path}\n${index}`

const madeViews = new Set<(path: string, index: number) => boolean>()

/** Registers an already-mounted inline drawing view to take future landings for its `(path, index)`. */
export function watchInlineDrawingLanding(take: (path: string, index: number) => boolean): () => void {
  madeViews.add(take)
  return () => void madeViews.delete(take)
}

/** Schedules a smooth scroll + highlight landing on inline drawing `#index` of `path`. */
export function landOnInlineDrawing(path: string, index: number, now = Date.now()): void {
  for (const [key, at] of landings) if (now - at > LANDING_MS) landings.delete(key)
  for (const take of madeViews) if (take(path, index)) return
  landings.set(landingKey(path, index), now)
}

/** Consumes a pending landing for `(path, index)`, returning `true` once if one was waiting. */
export function takeInlineDrawingLanding(path: string | null | undefined, index: number, now = Date.now()): boolean {
  if (path == null || index < 0 || landings.size === 0) return false
  const key = landingKey(path, index)
  const at = landings.get(key)
  if (at === undefined) return false
  landings.delete(key)
  return now - at <= LANDING_MS
}
