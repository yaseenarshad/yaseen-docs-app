import type { Route } from '../app/nav'

/**
 * EXPLORE ON THE PHONE (YAZ-5472): the stack of sheets. A link (or a row of Search, or "Open page") opens the file in a
 * SHEET that slides up over where you are; a link in that sheet opens another sheet on top; a drag down closes the top
 * one, and you are back where you were. The screens under the stack (Review, Search, a page) stay mounted, so nothing
 * under it moves or scrolls.
 *
 * This file is the stack's STATE only, in the first load (a few hundred bytes): `openSheet` and `closeTop` work before
 * the sheets' own chunk (`SheetLayer.tsx`) has loaded; the chunk loads on the first open (and is preloaded when idle).
 * It is a plain store, not React state, so a caller with no React (the reader's `openLink`) can push a sheet.
 */

/** What a sheet can show: a page (a drawing page too), or a card (in a page, or a card file). */
export type SheetRoute = Extract<Route, { kind: 'page' | 'card' }>

export interface Sheet {
  /** The sheet's own number: React's key, and how the layer knows a sheet it has drawn. */
  id: number
  route: SheetRoute
  /** Where its body was scrolled when it was unmounted (a sheet more than `MAX_MOUNTED` down), for its return. */
  scroll: number
}

/** The sheets drawn at once. An older one is unmounted, and drawn again (at its scroll place) when the stack comes back to it. */
export const MAX_MOUNTED = 10
/** The stack's length: past it the oldest sheet is forgotten (a reader who follows 50 links does not come back down to the first). */
export const MAX_SHEETS = 50

export const isSheetRoute = (route: Route): route is SheetRoute => route.kind === 'page' || route.kind === 'card'

let sheets: readonly Sheet[] = []
let nextId = 1
const listeners = new Set<() => void>()
/** The layer's animated close of the top sheet; null while the layer is not drawn. True: it runs (and drops the sheet at its end). */
let animatedClose: (() => boolean) | null = null

function set(next: readonly Sheet[]): void {
  sheets = next
  for (const listener of listeners) listener()
}

/** The stack, the bottom sheet first. A new array at each change (`useSyncExternalStore`). */
export const sheetStack = (): readonly Sheet[] => sheets

export function subscribeSheets(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The sheets' chunk. Imported once; the module system keeps it. */
export const loadSheetLayer = () => import('./SheetLayer')

/** Loads the sheets' chunk now, so the first link opens with no wait (the app calls it when idle). */
export function preloadSheets(): void {
  void loadSheetLayer().catch(() => undefined)
}

/** Pushes a sheet with `route` on top of the stack. */
export function openSheet(route: SheetRoute): void {
  preloadSheets()
  set([...sheets, { id: nextId++, route, scroll: 0 }].slice(-MAX_SHEETS))
}

/** Closes the top sheet: it slides down when it is on the screen (as a drag that let go), else it goes at once. */
export function closeTop(): void {
  if (sheets.length === 0) return
  if (animatedClose?.() === true) return
  dropTop()
}

/** Takes the top sheet off the stack, with no motion (the end of a close). */
export function dropTop(): void {
  if (sheets.length > 0) set(sheets.slice(0, -1))
}

/** Every sheet goes (another vault opens; "Open full page"). */
export function closeAll(): void {
  if (sheets.length > 0) set([])
}

/** Keeps a sheet's scroll place while it is unmounted. No listener is told: nothing on the screen changes. */
export function keepScroll(id: number, scroll: number): void {
  const sheet = sheets.find((s) => s.id === id)
  if (sheet !== undefined) sheet.scroll = scroll
}

/** The layer says how it closes the top sheet with motion (null: it is gone). */
export function setAnimatedClose(close: (() => boolean) | null): void {
  animatedClose = close
}
