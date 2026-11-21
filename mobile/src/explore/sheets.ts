import { openOverlay } from '../app/browserHistory'
import type { Route } from '../app/nav'

/**
 * EXPLORE ON THE PHONE: the stack of sheets. A link (or a row of Search, or "Open page") opens the file in a
 * SHEET that slides up over where you are; a link in that sheet opens another sheet on top; a drag down closes the top
 * one, and you are back where you were. The screens under the stack (Review, Search, a page) stay mounted, so nothing
 * under it moves or scrolls.
 *
 * This file is the stack's STATE only, in the first load (a few hundred bytes): `openSheet` and `closeTop` work before
 * the sheets' own chunk (`SheetLayer.tsx`) has loaded; the chunk loads on the first open (and is preloaded when idle).
 * It is a plain store, not React state, so a caller with no React (the reader's `openLink`) can push a sheet.
 *
 * Each sheet is one overlay of the app's ONE overlay stack (`openOverlay`): one history entry, so Safari's
 * Back in a tab and the app's Back close the top sheet first. A second open of the route already on top (a double tap,
 * Today tapped again) opens nothing.
 */

/** What a sheet can show: a page, a card (in a page, or a card file), a drawing file, or a folder's page. */
export type SheetRoute = Extract<Route, { kind: 'page' | 'card' | 'drawing' | 'folder' }>

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

export const isSheetRoute = (route: Route): route is SheetRoute => route.kind === 'page' || route.kind === 'card' || route.kind === 'drawing' || route.kind === 'folder'

let sheets: readonly Sheet[] = []
let nextId = 1
/** Each sheet's overlay `done`: its history entry goes with it. */
const overlayDone = new Map<number, () => void>()
/** The sheets sliding down (a close under way): not "on top" for a new open. */
const closing = new Set<number>()
const listeners = new Set<() => void>()
/** The layer's animated close of the top sheet; null while the layer is not drawn. True: it runs (and drops the sheet at its end). */
let animatedClose: (() => boolean) | null = null

function set(next: readonly Sheet[]): void {
  // A sheet that leaves the stack takes its history entry with it.
  for (const sheet of sheets)
    if (!next.includes(sheet)) {
      overlayDone.get(sheet.id)?.()
      overlayDone.delete(sheet.id)
      closing.delete(sheet.id)
    }
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

/**
 * Loads the sheets' chunk now, so the first link opens with no wait (the app calls it when idle). YAZ-5589: through the
 * sheets' screen (`ExploreHost`'s `SheetLayer.preload`), so a panel's first open draws at once.
 */
let preloader: () => Promise<unknown> = loadSheetLayer
export const setSheetsPreload = (load: () => Promise<unknown>): void => void (preloader = load)
/** The chunk, loaded (a failed load is tried again at the next call). */
export function preloadSheets(): Promise<void> {
  return preloader().then(
    () => undefined,
    () => undefined,
  )
}

const sameRoute = (a: SheetRoute, b: SheetRoute): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Pushes a sheet with `route` on top of the stack; nothing when the top sheet (not one closing) already shows it. */
export function openSheet(route: SheetRoute): void {
  void preloadSheets()
  const top = [...sheets].reverse().find((s) => !closing.has(s.id))
  if (top !== undefined && sameRoute(top.route, route)) return
  const id = nextId++
  overlayDone.set(id, openOverlay(() => closeSheet(id)))
  set([...sheets, { id, route, scroll: 0 }].slice(-MAX_SHEETS))
}

/** Closes the top sheet: it slides down when it is on the screen (as a drag that let go), else it goes at once. */
export function closeTop(): void {
  const top = sheets.at(-1)
  if (top === undefined || closing.has(top.id)) return
  closing.add(top.id)
  if (animatedClose?.() === true) return
  dropSheet(top.id)
}

/** Closes the sheet `id` (a Back took its entry): the top one slides down; one under it goes at once. */
function closeSheet(id: number): void {
  if (sheets.at(-1)?.id === id) closeTop()
  else dropSheet(id)
}

/** Takes the sheet `id` off the stack, with no motion (the end of its close). */
export function dropSheet(id: number): void {
  if (sheets.some((s) => s.id === id)) set(sheets.filter((s) => s.id !== id))
}

/** Takes the top sheet off the stack, with no motion (the end of a close). */
export function dropTop(): void {
  const top = sheets.at(-1)
  if (top !== undefined) dropSheet(top.id)
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
